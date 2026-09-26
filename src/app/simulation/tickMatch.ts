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

import type { Bey } from '../../bey/core/Bey';
import { AttackState } from '../../combat/attacks/AttackController';
import { detectHits, type HitEvent } from '../../combat/hit-detection/HitDetection';
import { applyKnockback, computeKnockback, computeStabilityDamage } from '../../combat/knockback/Knockback';
import { CIRCULAR_CATCHES_DASH_LAUNCH_UP_MPS } from '../../combat/attacks/AttackTuning';
import { isRingOut } from '../../arena/ringout/RingOut';
import { RoundState } from '../../combat/round-rules/RoundState';
import type { ControllerActions } from '../../input/actions/Action';
import { WALL_IMPACT_STABILITY_DAMAGE_PER_MPS } from '../../bey/stability/StabilityTuning';
import type { MovementSnapshot } from '../../bey/movement/MovementController';
import type { SpinSnapshot } from '../../bey/spin/SpinController';
import type { DriftState } from '../../drift/DriftController';
import type { DodgeState } from '../../dodge/DodgeController';
import { isGrounded } from '../../physics/collision/GroundCheck';
import type { PhysicsWorld } from '../../physics/world/PhysicsWorld';
import { normalize, subtract, type Vec2 } from '../../physics/Vec2';
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
  attackEnergyFraction: number;
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
  | { kind: 'knockback'; targetIsFirst: boolean; force: number }
  | { kind: 'ko'; targetIsFirst: boolean }
  | { kind: 'ringOut'; targetIsFirst: boolean }
  /** An attack that would have connected was nullified by the target's dodge i-frames (Milestone 3). */
  | { kind: 'dodged'; targetIsFirst: boolean }
  /** A dodged hit whose i-frames were within the tighter "perfect" sub-window. Detection only — no gameplay reward is implemented yet, per the GDD's explicit approval gate on Perfect Dodge's reward. */
  | { kind: 'perfectDodge'; targetIsFirst: boolean };

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
    attackEnergyFraction: bey.attackEnergy.resource.fraction,
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

  const firstGrounded = isGrounded(physics, first.collider);
  const secondGrounded = isGrounded(physics, second.collider);

  const firstDrift = first.drift.tick(first.body, firstActions, firstGrounded, fixedDeltaSeconds);
  const secondDrift = second.drift.tick(second.body, secondActions, secondGrounded, fixedDeltaSeconds);

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
    first.attackEnergy.resource.fraction,
    fixedDeltaSeconds,
  );
  const secondAttack = second.attack.tick(
    secondActions,
    second.movement.getHeadingRad(),
    positionXZ(second.body),
    positionXZ(first.body),
    second.attackEnergy.resource.fraction,
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
    dashOverride: firstAttack.dashOverride,
  });
  second.movement.applyPreStep(second.body, {
    actions: secondActions,
    fixedDeltaSeconds,
    grounded: secondGrounded,
    lateralGripOverridePerS: secondDodge.lateralGripOverridePerS ?? secondDrift.lateralGripOverridePerS,
    staminaAccelFactor: secondCondition.accelFactor,
    dashOverride: secondAttack.dashOverride,
  });

  first.spin.tick(first.body, fixedDeltaSeconds, firstCondition);
  second.spin.tick(second.body, fixedDeltaSeconds, secondCondition);

  first.attackEnergy.tick(firstAttack.isConsumingAttackEnergy, fixedDeltaSeconds);
  second.attackEnergy.tick(secondAttack.isConsumingAttackEnergy, fixedDeltaSeconds);

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
  first.stability.tick(fixedDeltaSeconds);
  second.stability.tick(fixedDeltaSeconds);

  const firstPos = positionXZ(first.body);
  const secondPos = positionXZ(second.body);
  const firstYM = first.body.translation().y;
  const secondYM = second.body.translation().y;
  const rawHitEvents = detectHits(
    { positionXZ: firstPos, positionYM: firstYM, hitbox: firstAttack.activeHitbox, state: firstAttack.state },
    { positionXZ: secondPos, positionYM: secondYM, hitbox: secondAttack.activeHitbox, state: secondAttack.state },
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
      combatEvents.push({ kind: 'dodged', targetIsFirst: defenderIsFirst });
      if (defenderDodge.isPerfectWindow) combatEvents.push({ kind: 'perfectDodge', targetIsFirst: defenderIsFirst });
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
  // ClashOrchestration — a same-tick double connect (both sides landing
  // within the same fixed tick, GDD's "150ms window") is either withheld
  // entirely (a fresh Clash starts) or resolved with the cooldown
  // "slower suffers more" alternative multiplier instead of a plain 1x;
  // anything else comes back completely untouched.
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
    };
  });
  const { toResolveNormally } = clash.processTickHits(hitSnapshots);

  for (const resolved of toResolveNormally) {
    const hit = resolved.hit;
    const defenderIsFirst = !hit.attackerIsFirst;
    const defender = hit.attackerIsFirst ? second : first;

    if (hit.caughtOpponentDashing) {
      // GDD section 23/107: Circular Attack catching an active Dash Attack
      // launches the attacker's *target* upward instead of normal knockback.
      // Never routed through Clash (see ClashOrchestration.processTickHits).
      const vel = defender.body.linvel();
      defender.body.setLinvel({ x: vel.x, y: vel.y + CIRCULAR_CATCHES_DASH_LAUNCH_UP_MPS, z: vel.z }, true);
      // A genuine launch: arm Air Recovery immediately if the defender was
      // already airborne (no further grounded->airborne transition would
      // ever come this period), otherwise arm the short pending window
      // until it actually leaves the ground.
      defender.dodge.registerLaunch(!isGrounded(physics, defender.collider));
      applyStabilityDamageAndTrackKo(defenderIsFirst, defender, computeStabilityDamage(hit.hitbox.stabilityDamage));
      continue;
    }

    const knockback = computeKnockback({
      baseForce: hit.hitbox.knockbackForce * resolved.forceMultiplier,
      attackerSpeedMps: resolved.attackerSpeedMps,
      defenderSpeedMps: resolved.defenderSpeedMps,
      defenderStabilityFraction: resolved.defenderStabilityFraction,
      defenderStaminaPenaltyFraction: resolved.defenderStaminaPenaltyFraction,
      attackerVelocityXZ: resolved.attackerVelocityXZ,
      impactDirectionXZ: normalize(subtract(resolved.defenderPositionXZ, resolved.attackerPositionXZ)),
    });
    applyKnockback(defender.body, resolved.attackerPositionXZ, resolved.defenderPositionXZ, knockback);
    // Same immediate-vs-pending arming as the catch-launch path above.
    defender.dodge.registerLaunch(!isGrounded(physics, defender.collider));
    combatEvents.push({ kind: 'knockback', targetIsFirst: defenderIsFirst, force: knockback.force });

    applyStabilityDamageAndTrackKo(defenderIsFirst, defender, computeStabilityDamage(hit.hitbox.stabilityDamage) * resolved.forceMultiplier);
  }

  const ringOutFirst = isRingOut(firstPos);
  const ringOutSecond = isRingOut(secondPos);
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
      attackEnergyFraction: first.attackEnergy.resource.fraction,
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
      attackEnergyFraction: second.attackEnergy.resource.fraction,
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
