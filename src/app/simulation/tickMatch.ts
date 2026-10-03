// ============================================================
// TICK MATCH — PER-FIXED-TICK ORCHESTRATION FOR TWO BEYS
// Both main.ts and the deterministic test harness call this so production
// and tests always exercise the exact same tick order (GDD section 114: a
// self-test must be able to catch real gameplay bugs, not a simplified
// stand-in). Pure wiring — every real decision still lives in the owning
// system; this only sequences calls and passes their outputs along.
//
// Order: drift -> attack (may set dashOverride) -> movement pre-step ->
// spin pre-step -> physics.step() [once, for the whole world] -> movement
// post-step -> spin impact -> stamina/stability tick -> hit detection ->
// knockback/stability-damage -> ring-out check -> resolve this tick's
// round outcome (all at once, never per-event — see RoundState).
//
// Combat vs. RoundEnd are separate global states (GDD): once the round is
// over, this function stops advancing the simulation entirely (no more
// input, movement, attacks, resource changes, physics stepping) and just
// returns a frozen snapshot of however things stood at the moment it
// ended, rather than letting the fight silently continue in the background.
// ============================================================

import { floorNormalAt } from '../../arena/floor/ArenaFloorProfile';
import type { Bey } from '../../bey/core/Bey';
import { AttackState } from '../../combat/attacks/AttackController';
import { detectHits, type HitEvent } from '../../combat/hit-detection/HitDetection';
import { applyKnockback, computeKnockback, computeStabilityDamage, type KnockbackComponents } from '../../combat/knockback/Knockback';
import { CIRCULAR_BASE_KNOCKBACK_FORCE, CIRCULAR_CATCHES_DASH_HORIZONTAL_KEEP, CIRCULAR_CATCHES_DASH_LAUNCH_UP_MPS, CIRCULAR_STABILITY_DAMAGE } from '../../combat/attacks/AttackTuning';
import {
  BODY_COLLISION_CONTACT_SLOP_M,
  BODY_COLLISION_COOLDOWN_S,
  BODY_COLLISION_MIN_CLOSING_SPEED_MPS,
  BODY_COLLISION_MIN_DAMAGE,
  BODY_COLLISION_REFERENCE_SPEED_DIFF_MPS,
} from '../../bey/momentum/MomentumTuning';
import { isOutOfArena } from '../../arena/ringout/RingOut';
import { RoundState } from '../../combat/round-rules/RoundState';
import type { ControllerActions } from '../../input/actions/Action';
import { WALL_IMPACT_STABILITY_DAMAGE_PER_MPS } from '../../bey/stability/StabilityTuning';
import type { MovementSnapshot } from '../../bey/movement/MovementController';
import type { SpinSnapshot } from '../../bey/spin/SpinController';
import { DriftState } from '../../drift/DriftController';
import type { DodgeState } from '../../dodge/DodgeController';
import { isGrounded } from '../../physics/collision/GroundCheck';
import type { PhysicsWorld } from '../../physics/world/PhysicsWorld';
import { dot, length, normalize, subtract, type Vec2 } from '../../physics/Vec2';
import { ClashState, type ClashResult } from '../../combat/clash/ClashController';
import { ClashOrchestration, type HitSnapshotInput, type ResolvedHitToApply } from './ClashOrchestration';

export interface BeySnapshot {
  movement: MovementSnapshot;
  spin: SpinSnapshot;
  grounded: boolean;
  driftState: DriftState;
  dodgeState: DodgeState;
  attackState: AttackState;
  dashChargeFraction: number;
  staminaFraction: number;
  stabilityFraction: number;
  isBroken: boolean;
  /** 0..1: Dash cooldown readiness (AttackController.getDashReadiness(); 1 = a Dash can start charging). Owner, 2026-10-02: replaces Attack Energy. */
  dashReadiness: number;
  /** 0..1: momentum (owner, 2026-10-02, Lote 3). */
  momentum: number;
  /** True for exactly one tick: this Bey just landed (any cause) — see DriftController. Milestone 4 data, no gameplay effect. */
  justLanded: boolean;
  /** Only meaningful when justLanded is true. */
  landingDescentSpeedMps: number;
  /** Only meaningful when justLanded is true. */
  landingIntensity: number;
  /** Only meaningful when justLanded is true. */
  landingJumpAssistElapsedS: number;
}

/**
 * Structured combat facts from this tick, for telemetry (GDD section 74:
 * Hit is already covered by hitEvents above; this adds StabilityDamage,
 * StabilityBreak, Knockback, RingOut and Ko). Deliberately decoupled from
 * the telemetry module's own event types — this is just "what happened",
 * not "how it's recorded".
 */
export type CombatEvent =
  | { kind: 'stabilityDamage'; targetIsFirst: boolean; amount: number }
  | { kind: 'stabilityBreak'; targetIsFirst: boolean }
  | {
      kind: 'knockback';
      targetIsFirst: boolean;
      force: number;
      /** Formula breakdown for a normal hit (absent for a Clash resolution, whose knockback is built by ClashOrchestration). */
      components?: KnockbackComponents;
      /** Horizontal launch direction (unit, attacker -> defender) for a normal hit — debug visualization only. */
      directionXZ?: Vec2;
    }
  | { kind: 'ko'; targetIsFirst: boolean }
  | { kind: 'ringOut'; targetIsFirst: boolean }
  /** An attack that would have connected was nullified by the target's dodge i-frames (Milestone 3). */
  | { kind: 'dodged'; targetIsFirst: boolean }
  /** A dodged hit whose i-frames were within the tighter "perfect" sub-window. Detection only — no gameplay reward is implemented yet, per the GDD's explicit approval gate on Perfect Dodge's reward. */
  | { kind: 'perfectDodge'; targetIsFirst: boolean }
  /**
   * Owner, 2026-10-02 (Lote 3): the Beys touched without an attack. targetIsFirst = the slower one (the one that took
   * the speed-difference damage); damage = the larger of the two Stability damages dealt (presentation magnitude).
   */
  | { kind: 'bodyCollision'; targetIsFirst: boolean; damage: number; speedDifferenceMps: number };

export interface MatchTickResult {
  first: BeySnapshot;
  second: BeySnapshot;
  hitEvents: HitEvent[];
  combatEvents: CombatEvent[];
  ringOutFirst: boolean;
  ringOutSecond: boolean;
  /** Non-null on exactly the tick a Clash's Active -> Cooldown transition happened this call — main.ts uses this single edge to fire ClashResult telemetry and the resolution's presentation beat. Null every other tick, including throughout Active itself (poll the ClashOrchestration passed into this call directly for live state/mash counts — see ClashController.getState()/getElapsedS()/getFirstMashEventCount() etc.). */
  clashResolvedThisTick: ClashResult | null;
}

function positionXZ(body: Bey['body']): Vec2 {
  const t = body.translation();
  return { x: t.x, z: t.z };
}

/** Builds a BeySnapshot purely from current, already-settled state — no physics stepping, no advancing any system's internal timers. Used once the round is over so a frozen post-round snapshot can still be reported without the simulation silently continuing underneath it. */
function buildFrozenSnapshot(physics: PhysicsWorld, bey: Bey): BeySnapshot {
  const grounded = isGrounded(physics, bey.collider);
  return {
    movement: bey.movement.getSnapshot(bey.body, grounded),
    spin: bey.spin.getSnapshot(bey.body),
    grounded,
    driftState: bey.drift.getState(),
    dodgeState: bey.dodge.getState(),
    attackState: bey.attack.getState(),
    dashChargeFraction: bey.attack.getChargeFraction(),
    staminaFraction: bey.stamina.resource.fraction,
    stabilityFraction: bey.stability.resource.fraction,
    isBroken: bey.stability.isBroken,
    dashReadiness: bey.attack.getDashReadiness(),
    momentum: bey.momentum.value,
    justLanded: false,
    landingDescentSpeedMps: 0,
    landingIntensity: 0,
    landingJumpAssistElapsedS: 0,
  };
}

export function tickMatch(
  physics: PhysicsWorld,
  first: Bey,
  second: Bey,
  firstActions: ControllerActions,
  secondActions: ControllerActions,
  fixedDeltaSeconds: number,
  roundState: RoundState,
  clash: ClashOrchestration,
): MatchTickResult {
  if (roundState.isOver) {
    return {
      first: buildFrozenSnapshot(physics, first),
      second: buildFrozenSnapshot(physics, second),
      hitEvents: [],
      combatEvents: [],
      ringOutFirst: false,
      ringOutSecond: false,
      clashResolvedThisTick: null,
    };
  }

  // Clash (Milestone 5): while Active, the entire normal simulation is
  // frozen for the ~4s mash-contest presentation — no physics step, no
  // movement/attack/resource ticking — mirroring Milestone 4's hitstop
  // freeze pattern, just for the whole contest instead of a few frames.
  // Real Z/X/C mash input is still sampled live every tick (it is NOT
  // gated by hitstop's simulationFrozen flag — see main.ts). The instant
  // the contest resolves (Active -> Cooldown), the real physical
  // consequence (knockback for FirstWins/SecondWins, symmetric repulsion
  // for Tie) is applied immediately; physics.step() on a later, normal
  // tick then decides everything from there, including any ring-out —
  // Clash itself never declares one.
  if (clash.controller.getState() === ClashState.Active) {
    const { resolution } = clash.tickActive(fixedDeltaSeconds, firstActions, secondActions);
    const combatEvents: CombatEvent[] = [];
    let firstKoed = false;
    let secondKoed = false;

    if (resolution) {
      const applied = clash.applyResolution(resolution, physics, first, second);
      if (applied.loserIsFirst !== undefined) {
        combatEvents.push({ kind: 'knockback', targetIsFirst: applied.loserIsFirst, force: applied.knockbackForce! });
        combatEvents.push({ kind: 'stabilityDamage', targetIsFirst: applied.loserIsFirst, amount: applied.stabilityDamageAmount! });
        if (applied.causedBreak) combatEvents.push({ kind: 'stabilityBreak', targetIsFirst: applied.loserIsFirst });
        if (applied.isQualifyingKoHit) {
          combatEvents.push({ kind: 'ko', targetIsFirst: applied.loserIsFirst });
          if (applied.loserIsFirst) firstKoed = true;
          else secondKoed = true;
        }
      }
      roundState.resolveTick({ firstKoed, secondKoed, firstRingOut: false, secondRingOut: false });
    }

    return {
      first: buildFrozenSnapshot(physics, first),
      second: buildFrozenSnapshot(physics, second),
      hitEvents: [],
      combatEvents,
      ringOutFirst: false,
      ringOutSecond: false,
      clashResolvedThisTick: resolution ? resolution.result : null,
    };
  }

  // Advances Cooldown's countdown (a no-op while Idle) — the Active branch
  // above already advances the Clash via its own tickActive() call, so
  // this only needs to run on the normal (non-Active) path.
  clash.tickIdleOrCooldown(fixedDeltaSeconds);

  const firstGrounded = isGrounded(physics, first.collider);
  const secondGrounded = isGrounded(physics, second.collider);

  const firstDrift = first.drift.tick(first.body, firstActions, firstGrounded, fixedDeltaSeconds, first.movement.getHeadingRad());
  const secondDrift = second.drift.tick(second.body, secondActions, secondGrounded, fixedDeltaSeconds, second.movement.getHeadingRad());

  const firstDodge = first.dodge.tick(
    first.body,
    firstActions,
    first.movement.getHeadingRad(),
    firstGrounded,
    first.stamina.resource.value,
    fixedDeltaSeconds,
  );
  const secondDodge = second.dodge.tick(
    second.body,
    secondActions,
    second.movement.getHeadingRad(),
    secondGrounded,
    second.stamina.resource.value,
    fixedDeltaSeconds,
  );
  if (firstDodge.staminaCostThisTick > 0) first.stamina.resource.subtract(firstDodge.staminaCostThisTick);
  if (secondDodge.staminaCostThisTick > 0) second.stamina.resource.subtract(secondDodge.staminaCostThisTick);
  if (firstDodge.triggeredAirRecovery) first.spin.applyAirRecovery(first.body);
  if (secondDodge.triggeredAirRecovery) second.spin.applyAirRecovery(second.body);

  const firstAttack = first.attack.tick(
    firstActions,
    first.movement.getHeadingRad(),
    positionXZ(first.body),
    positionXZ(second.body),
    fixedDeltaSeconds,
  );
  const secondAttack = second.attack.tick(
    secondActions,
    second.movement.getHeadingRad(),
    positionXZ(second.body),
    positionXZ(first.body),
    fixedDeltaSeconds,
  );

  const firstCondition = first.stamina.getPhysicalCondition();
  const secondCondition = second.stamina.getPhysicalCondition();

  first.movement.applyPreStep(first.body, {
    actions: firstActions,
    fixedDeltaSeconds,
    grounded: firstGrounded,
    lateralGripOverridePerS: firstDodge.lateralGripOverridePerS ?? firstDrift.lateralGripOverridePerS,
    staminaAccelFactor: firstCondition.accelFactor,
    topSpeedMultiplier: first.momentum.topSpeedMultiplier,
    dashOverride: firstAttack.dashOverride,
    dodgeOverride: firstDodge.dodgeOverride,
    floorNormal: floorNormalUnder(first, firstGrounded),
  });
  second.movement.applyPreStep(second.body, {
    actions: secondActions,
    fixedDeltaSeconds,
    grounded: secondGrounded,
    lateralGripOverridePerS: secondDodge.lateralGripOverridePerS ?? secondDrift.lateralGripOverridePerS,
    staminaAccelFactor: secondCondition.accelFactor,
    topSpeedMultiplier: second.momentum.topSpeedMultiplier,
    dashOverride: secondAttack.dashOverride,
    dodgeOverride: secondDodge.dodgeOverride,
    floorNormal: floorNormalUnder(second, secondGrounded),
  });

  first.spin.tick(first.body, fixedDeltaSeconds, firstCondition, firstGrounded, firstDrift.driftState === DriftState.Drifting ? first.movement.getHeadingRad() : null);
  second.spin.tick(second.body, fixedDeltaSeconds, secondCondition, secondGrounded, secondDrift.driftState === DriftState.Drifting ? second.movement.getHeadingRad() : null);


  // Body collisions (owner, 2026-10-02) judge the speeds the Beys had going into the contact, before the solver
  // bounces them apart.
  const firstVelBefore = horizontalVelocity(first.body);
  const secondVelBefore = horizontalVelocity(second.body);
  const gapBefore = length(subtract(positionXZ(second.body), positionXZ(first.body)));
  physics.step();

  const firstMovement = first.movement.postStep(first.body, firstGrounded);
  const secondMovement = second.movement.postStep(second.body, secondGrounded);

  // Note: a wall/floor bounce does NOT call dodge.registerLaunch() — GDD
  // section 21 grants Air Recovery only for being launched/knocked
  // airborne, not merely "some impact occurred" (a wall clip while still
  // grounded must never arm it for a later, unrelated normal jump).
  if (firstMovement.impactDeltaSpeedMps > 0) {
    first.spin.registerImpact(first.body, firstMovement.impactDeltaSpeedMps, firstMovement.impactDirection);
    first.stability.applyDamage(firstMovement.impactDeltaSpeedMps * WALL_IMPACT_STABILITY_DAMAGE_PER_MPS);
  }
  if (secondMovement.impactDeltaSpeedMps > 0) {
    second.spin.registerImpact(second.body, secondMovement.impactDeltaSpeedMps, secondMovement.impactDirection);
    second.stability.applyDamage(secondMovement.impactDeltaSpeedMps * WALL_IMPACT_STABILITY_DAMAGE_PER_MPS);
  }

  first.stamina.tick(firstMovement.speedMps, fixedDeltaSeconds);
  second.stamina.tick(secondMovement.speedMps, fixedDeltaSeconds);
  // Momentum (owner, 2026-10-02): builds with sustained fast, straight movement; a wall impact costs part of it.
  tickMomentum(first, firstMovement, firstGrounded, fixedDeltaSeconds);
  tickMomentum(second, secondMovement, secondGrounded, fixedDeltaSeconds);
  first.stability.tick(fixedDeltaSeconds);
  second.stability.tick(fixedDeltaSeconds);

  const firstPos = positionXZ(first.body);
  const secondPos = positionXZ(second.body);
  const firstYM = first.body.translation().y;
  const secondYM = second.body.translation().y;
  const rawHitEvents = detectHits(
    { positionXZ: firstPos, positionYM: firstYM, hitbox: firstAttack.activeHitbox, state: firstAttack.state, colliderRadiusM: first.definition.physical.colliderRadiusM },
    { positionXZ: secondPos, positionYM: secondYM, hitbox: secondAttack.activeHitbox, state: secondAttack.state, colliderRadiusM: second.definition.physical.colliderRadiusM },
  );

  let firstKoed = false;
  let secondKoed = false;
  const combatEvents: CombatEvent[] = [];

  // I-frames (Milestone 3): a hit that would otherwise connect is nullified
  // entirely — no knockback, no Stability damage, no registerHitConfirmed
  // (the attack stays a whiff from the attacker's own recovery-timing
  // perspective). Filtered out before the resolution loop below, not
  // inside it, so a dodged hit is indistinguishable from one that never
  // overlapped at all except for the dodged/perfectDodge telemetry.
  const hitEvents: HitEvent[] = [];
  for (const hit of rawHitEvents) {
    const defenderIsFirst = !hit.attackerIsFirst;
    const defenderDodge = defenderIsFirst ? firstDodge : secondDodge;
    if (defenderDodge.hasIFrames) {
      // Nullified on every overlapping tick; reported once per (dodge, opponent attack).
      const defender = defenderIsFirst ? first : second;
      const attacker = defenderIsFirst ? second : first;
      if (defender.dodge.firstEvasionOf(attacker.attack.getActivationId())) {
        combatEvents.push({ kind: 'dodged', targetIsFirst: defenderIsFirst });
        if (defenderDodge.isPerfectWindow) combatEvents.push({ kind: 'perfectDodge', targetIsFirst: defenderIsFirst });
      }
      continue;
    }
    hitEvents.push(hit);
  }

  // Shared by both hit-resolution paths below (normal knockback and
  // Circular-catches-Dash) so a qualifying KO is detected and telemetered
  // identically either way — previously only the normal path fed
  // firstKoed/secondKoed, so a Circular Attack catching a Dash Attack could
  // deal qualifying Stability damage to an already-Broken defender without
  // ever actually ending the round.
  function applyStabilityDamageAndTrackKo(defenderIsFirst: boolean, defender: Bey, amount: number): void {
    const { causedBreak, isQualifyingKoHit } = defender.stability.applyDamage(amount);
    combatEvents.push({ kind: 'stabilityDamage', targetIsFirst: defenderIsFirst, amount });
    if (causedBreak) combatEvents.push({ kind: 'stabilityBreak', targetIsFirst: defenderIsFirst });
    if (isQualifyingKoHit) {
      combatEvents.push({ kind: 'ko', targetIsFirst: defenderIsFirst });
      if (defenderIsFirst) firstKoed = true;
      else secondKoed = true;
    }
  }

  // An attack's own recovery timing reacts to landing regardless of what
  // happens to it downstream (normal knockback or Clash) — fired for
  // every connecting hit up front, before Clash gets a chance to
  // intercept the knockback/Stability consequence below.
  for (const hit of hitEvents) {
    (hit.attackerIsFirst ? first : second).attack.registerHitConfirmed();
  }

  // Milestone 5: snapshot everything each connecting hit's normal
  // knockback/Stability resolution would need, then hand them to
  // ClashOrchestration — a hit connecting while the defender's own attack
  // is also compatible (active/imminent) within the GDD's 150ms window is
  // either withheld entirely (a fresh Clash starts) or resolved with the
  // cooldown "slower suffers more" alternative multiplier instead of a
  // plain 1x; anything else comes back completely untouched.
  const hitSnapshots: HitSnapshotInput[] = hitEvents.map((hit) => {
    const attacker = hit.attackerIsFirst ? first : second;
    const defender = hit.attackerIsFirst ? second : first;
    const attackerMovement = hit.attackerIsFirst ? firstMovement : secondMovement;
    const defenderMovement = hit.attackerIsFirst ? secondMovement : firstMovement;
    return {
      hit,
      attackerPositionXZ: hit.attackerIsFirst ? firstPos : secondPos,
      defenderPositionXZ: hit.attackerIsFirst ? secondPos : firstPos,
      attackerVelocityXZ: attackerMovement.actualVelocityVector,
      attackerSpeedMps: attackerMovement.speedMps,
      attackerStaminaFraction: attacker.stamina.resource.fraction,
      defenderSpeedMps: defenderMovement.speedMps,
      defenderStabilityFraction: defender.stability.resource.fraction,
      defenderStaminaPenaltyFraction: 1 - defender.stamina.resource.fraction,
      defenderAttackState: hit.attackerIsFirst ? secondAttack.state : firstAttack.state,
    };
  });
  const { toResolveNormally } = clash.processTickHits(fixedDeltaSeconds, hitSnapshots);

  for (const resolved of toResolveNormally) {
    const hit = resolved.hit;
    const defenderIsFirst = !hit.attackerIsFirst;
    const attacker = hit.attackerIsFirst ? first : second;
    const defender = hit.attackerIsFirst ? second : first;

    if (hit.caughtOpponentDashing) {
      // GDD section 23/107: Circular Attack catching an active Dash Attack
      // launches the attacker's *target* upward instead of normal knockback.
      // Never routed through Clash (see ClashOrchestration.processTickHits).
      // The catch stops the Dash: the dasher keeps only part of its
      // horizontal speed. (The old movement's heavy air and overspeed drag
      // used to stop the flight short; with the Motion Lab's air model a
      // caught 15 m/s Dash flew on ~18 m, over the wall from the centre.)
      const vel = defender.body.linvel();
      const keep = CIRCULAR_CATCHES_DASH_HORIZONTAL_KEEP;
      defender.body.setLinvel({ x: vel.x * keep, y: vel.y + CIRCULAR_CATCHES_DASH_LAUNCH_UP_MPS, z: vel.z * keep }, true);
      defender.movement.registerKnockback();
      // A genuine launch: arm Air Recovery immediately if the defender was
      // already airborne (no further grounded->airborne transition would
      // ever come this period), otherwise arm the short pending window
      // until it actually leaves the ground.
      defender.dodge.registerLaunch(!isGrounded(physics, defender.collider));
      applyStabilityDamageAndTrackKo(
        defenderIsFirst,
        defender,
        computeStabilityDamage(hit.hitbox.stabilityDamage, attacker.stats.attack, defender.stats.defense),
      );
      continue;
    }

    const knockback = computeKnockback({
      baseForce: hit.hitbox.knockbackForce * resolved.forceMultiplier,
      attackerSpeedMps: resolved.attackerSpeedMps,
      defenderSpeedMps: resolved.defenderSpeedMps,
      defenderStabilityFraction: resolved.defenderStabilityFraction,
      defenderStaminaPenaltyFraction: resolved.defenderStaminaPenaltyFraction,
      attackStat: attacker.stats.attack,
      defenseStat: defender.stats.defense,
      attackerVelocityXZ: resolved.attackerVelocityXZ,
      impactDirectionXZ: normalize(subtract(resolved.defenderPositionXZ, resolved.attackerPositionXZ)),
    });
    applyKnockback(defender.body, resolved.attackerPositionXZ, resolved.defenderPositionXZ, knockback, defender.motion);
    defender.movement.registerKnockback();
    defender.momentum.loseOnCollision();
    // Same immediate-vs-pending arming as the catch-launch path above.
    defender.dodge.registerLaunch(!isGrounded(physics, defender.collider));
    combatEvents.push({
      kind: 'knockback',
      targetIsFirst: defenderIsFirst,
      force: knockback.force,
      components: knockback.components,
      directionXZ: normalize(subtract(resolved.defenderPositionXZ, resolved.attackerPositionXZ)),
    });

    applyStabilityDamageAndTrackKo(
      defenderIsFirst,
      defender,
      computeStabilityDamage(hit.hitbox.stabilityDamage, attacker.stats.attack, defender.stats.defense) * resolved.forceMultiplier,
    );
  }

  // Body collision (owner, 2026-10-02, item 9): the Beys touch with no attack connecting this tick.
  if (hitEvents.length === 0 && rawHitEvents.length === 0 && !roundState.isOver) {
    const contactReach = first.definition.physical.colliderRadiusM + second.definition.physical.colliderRadiusM + BODY_COLLISION_CONTACT_SLOP_M;
    const firstToSecond = subtract(secondPos, firstPos);
    const closingSpeed = dot(subtract(firstVelBefore, secondVelBefore), normalize(firstToSecond));
    // Touching after the step, or would have met during it (a fast contact can bounce them apart within the tick).
    const touched = Math.min(length(firstToSecond), gapBefore - closingSpeed * fixedDeltaSeconds) <= contactReach;
    if (
      touched &&
      Math.abs(firstYM - secondYM) <= contactReach &&
      closingSpeed >= BODY_COLLISION_MIN_CLOSING_SPEED_MPS &&
      first.momentum.collisionCooldownRemainingS === 0 &&
      second.momentum.collisionCooldownRemainingS === 0
    ) {
      resolveBodyCollision();
    }
  }

  function resolveBodyCollision(): void {
    const scaleDamage = first.rules.bodyCollisionDamage;
    const firstSpeed = length(firstVelBefore);
    const secondSpeed = length(secondVelBefore);
    const diff = Math.abs(firstSpeed - secondSpeed);
    const firstIsSlower = firstSpeed < secondSpeed;
    const slower = firstIsSlower ? first : second;
    const faster = firstIsSlower ? second : first;
    // Dodge i-frames and a defensive Circular (item 13) make a Bey immune to the collision's damage and push.
    const immune = (bey: Bey, dodge: { hasIFrames: boolean }, attackState: AttackState): boolean => dodge.hasIFrames || attackState === AttackState.CircularActive;
    const firstImmune = immune(first, firstDodge, firstAttack.state);
    const secondImmune = immune(second, secondDodge, secondAttack.state);
    const slowerImmune = firstIsSlower ? firstImmune : secondImmune;
    const fasterImmune = firstIsSlower ? secondImmune : firstImmune;
    const minDamage = BODY_COLLISION_MIN_DAMAGE * scaleDamage;
    const slowerDamage = minDamage + (CIRCULAR_STABILITY_DAMAGE / BODY_COLLISION_REFERENCE_SPEED_DIFF_MPS) * diff * scaleDamage;
    first.momentum.startCollisionCooldown(BODY_COLLISION_COOLDOWN_S);
    second.momentum.startCollisionCooldown(BODY_COLLISION_COOLDOWN_S);
    faster.momentum.loseOnCollision();
    let dealt = 0;
    if (!slowerImmune && slowerDamage > 0) {
      applyStabilityDamageAndTrackKo(firstIsSlower, slower, slowerDamage);
      dealt = slowerDamage;
      if (diff > 0 && scaleDamage > 0) {
        const fasterPos = firstIsSlower ? secondPos : firstPos;
        const slowerPos = firstIsSlower ? firstPos : secondPos;
        const knockback = computeKnockback({
          baseForce: (CIRCULAR_BASE_KNOCKBACK_FORCE * diff * scaleDamage) / BODY_COLLISION_REFERENCE_SPEED_DIFF_MPS,
          attackerSpeedMps: firstIsSlower ? secondSpeed : firstSpeed,
          defenderSpeedMps: firstIsSlower ? firstSpeed : secondSpeed,
          defenderStabilityFraction: slower.stability.resource.fraction,
          defenderStaminaPenaltyFraction: 1 - slower.stamina.resource.fraction,
          attackStat: 1,
          defenseStat: 1,
          attackerVelocityXZ: firstIsSlower ? secondVelBefore : firstVelBefore,
          impactDirectionXZ: normalize(subtract(slowerPos, fasterPos)),
        });
        applyKnockback(slower.body, fasterPos, slowerPos, knockback, slower.motion);
        slower.movement.registerKnockback();
        combatEvents.push({ kind: 'knockback', targetIsFirst: firstIsSlower, force: knockback.force, components: knockback.components, directionXZ: normalize(subtract(slowerPos, fasterPos)) });
      }
    }
    if (!fasterImmune && minDamage > 0) {
      applyStabilityDamageAndTrackKo(!firstIsSlower, faster, minDamage);
      dealt = Math.max(dealt, minDamage);
    }
    combatEvents.push({ kind: 'bodyCollision', targetIsFirst: firstIsSlower, damage: dealt, speedDifferenceMps: diff });
  }

  // Outside the ring-out radius only counts after the match's ring-out delay (owner, 2026-10-02).
  const ringedOut = roundState.trackRingOut(isOutOfArena(first.body.translation(), first.arenaFloor), isOutOfArena(second.body.translation(), second.arenaFloor), fixedDeltaSeconds);
  const ringOutFirst = ringedOut.first;
  const ringOutSecond = ringedOut.second;
  if (ringOutFirst) combatEvents.push({ kind: 'ringOut', targetIsFirst: true });
  if (ringOutSecond) combatEvents.push({ kind: 'ringOut', targetIsFirst: false });
  roundState.resolveTick({ firstKoed, secondKoed, firstRingOut: ringOutFirst, secondRingOut: ringOutSecond });

  return {
    first: {
      movement: firstMovement,
      spin: first.spin.getSnapshot(first.body),
      grounded: firstGrounded,
      driftState: firstDrift.driftState,
      dodgeState: firstDodge.state,
      attackState: firstAttack.state,
      dashChargeFraction: firstAttack.chargeFraction,
      staminaFraction: first.stamina.resource.fraction,
      stabilityFraction: first.stability.resource.fraction,
      isBroken: first.stability.isBroken,
      dashReadiness: first.attack.getDashReadiness(),
      momentum: first.momentum.value,
      justLanded: firstDrift.justLanded,
      landingDescentSpeedMps: firstDrift.landingDescentSpeedMps,
      landingIntensity: firstDrift.landingIntensity,
      landingJumpAssistElapsedS: firstDrift.landingJumpAssistElapsedS,
    },
    second: {
      movement: secondMovement,
      spin: second.spin.getSnapshot(second.body),
      grounded: secondGrounded,
      driftState: secondDrift.driftState,
      dodgeState: secondDodge.state,
      attackState: secondAttack.state,
      dashChargeFraction: secondAttack.chargeFraction,
      staminaFraction: second.stamina.resource.fraction,
      stabilityFraction: second.stability.resource.fraction,
      isBroken: second.stability.isBroken,
      dashReadiness: second.attack.getDashReadiness(),
      momentum: second.momentum.value,
      justLanded: secondDrift.justLanded,
      landingDescentSpeedMps: secondDrift.landingDescentSpeedMps,
      landingIntensity: secondDrift.landingIntensity,
      landingJumpAssistElapsedS: secondDrift.landingJumpAssistElapsedS,
    },
    hitEvents,
    combatEvents,
    ringOutFirst,
    ringOutSecond,
    clashResolvedThisTick: null,
  };
}

/**
 * The floor's normal where a grounded Bey touches a bowl (M11 lane 4); null
 * on the flat arena or in the air. An upright flat base in a concave floor
 * rests on its outer rim (the side farther from the centre, where the floor
 * is higher), so that is where the slope that carries it is measured — the
 * slope under its centre is shallower, and following it would lift the rim
 * off the floor when rolling downhill.
 */
function horizontalVelocity(body: Bey['body']): Vec2 {
  const v = body.linvel();
  return { x: v.x, z: v.z };
}

/** Momentum bookkeeping after the physics step (owner, 2026-10-02, Lote 3; see bey/momentum/). */
function tickMomentum(bey: Bey, movement: MovementSnapshot, grounded: boolean, fixedDeltaSeconds: number): void {
  const v = movement.actualVelocityVector;
  const heading = movement.speedMps > 0.5 ? Math.atan2(v.x, v.z) : null;
  bey.momentum.tick(movement.speedMps, bey.movement.getMaxSpeedMps() * bey.momentum.topSpeedMultiplier, heading, grounded, fixedDeltaSeconds);
  if (movement.impactDeltaSpeedMps > 0) bey.momentum.loseOnCollision();
}

function floorNormalUnder(bey: Bey, grounded: boolean): { x: number; y: number; z: number } | null {
  if (!grounded || bey.arenaFloor === 'flat') return null;
  const p = bey.body.translation();
  const r = Math.hypot(p.x, p.z);
  if (r < 1e-6) return floorNormalAt(bey.arenaFloor, p.x, p.z);
  const rim = (r + bey.definition.physical.colliderRadiusM) / r;
  return floorNormalAt(bey.arenaFloor, p.x * rim, p.z * rim);
}
