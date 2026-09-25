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
import { isGrounded } from '../../physics/collision/GroundCheck';
import type { PhysicsWorld } from '../../physics/world/PhysicsWorld';
import { normalize, subtract, type Vec2 } from '../../physics/Vec2';

export interface BeySnapshot {
  movement: MovementSnapshot;
  spin: SpinSnapshot;
  grounded: boolean;
  driftState: DriftState;
  attackState: AttackState;
  dashChargeFraction: number;
  staminaFraction: number;
  stabilityFraction: number;
  isBroken: boolean;
  attackEnergyFraction: number;
}

export interface MatchTickResult {
  first: BeySnapshot;
  second: BeySnapshot;
  hitEvents: HitEvent[];
  ringOutFirst: boolean;
  ringOutSecond: boolean;
}

function positionXZ(body: Bey['body']): Vec2 {
  const t = body.translation();
  return { x: t.x, z: t.z };
}

/** Builds a BeySnapshot purely from current, already-settled state — no physics stepping, no advancing any system's internal timers. Used once the round is over so a frozen post-round snapshot can still be reported without the simulation silently continuing underneath it. */
function buildFrozenSnapshot(physics: PhysicsWorld, bey: Bey): BeySnapshot {
  const grounded = isGrounded(physics, bey.collider);
  return {
    movement: bey.movement.postStep(bey.body, grounded),
    spin: bey.spin.getSnapshot(bey.body),
    grounded,
    driftState: bey.drift.getState(),
    attackState: bey.attack.getState(),
    dashChargeFraction: bey.attack.getChargeFraction(),
    staminaFraction: bey.stamina.resource.fraction,
    stabilityFraction: bey.stability.resource.fraction,
    isBroken: bey.stability.isBroken,
    attackEnergyFraction: bey.attackEnergy.resource.fraction,
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
): MatchTickResult {
  if (roundState.isOver) {
    return {
      first: buildFrozenSnapshot(physics, first),
      second: buildFrozenSnapshot(physics, second),
      hitEvents: [],
      ringOutFirst: false,
      ringOutSecond: false,
    };
  }

  const firstGrounded = isGrounded(physics, first.collider);
  const secondGrounded = isGrounded(physics, second.collider);

  const firstDrift = first.drift.tick(first.body, firstActions, firstGrounded, fixedDeltaSeconds);
  const secondDrift = second.drift.tick(second.body, secondActions, secondGrounded, fixedDeltaSeconds);

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
    lateralGripOverridePerS: firstDrift.lateralGripOverridePerS,
    staminaAccelFactor: firstCondition.accelFactor,
    dashOverride: firstAttack.dashOverride,
  });
  second.movement.applyPreStep(second.body, {
    actions: secondActions,
    fixedDeltaSeconds,
    grounded: secondGrounded,
    lateralGripOverridePerS: secondDrift.lateralGripOverridePerS,
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
  const hitEvents = detectHits(
    { positionXZ: firstPos, positionYM: firstYM, hitbox: firstAttack.activeHitbox, state: firstAttack.state },
    { positionXZ: secondPos, positionYM: secondYM, hitbox: secondAttack.activeHitbox, state: secondAttack.state },
  );

  let firstKoed = false;
  let secondKoed = false;

  for (const hit of hitEvents) {
    const attacker = hit.attackerIsFirst ? first : second;
    const defender = hit.attackerIsFirst ? second : first;
    const attackerMovement = hit.attackerIsFirst ? firstMovement : secondMovement;
    const defenderMovement = hit.attackerIsFirst ? secondMovement : firstMovement;
    const attackerPos = hit.attackerIsFirst ? firstPos : secondPos;
    const defenderPos = hit.attackerIsFirst ? secondPos : firstPos;

    attacker.attack.registerHitConfirmed();

    if (hit.caughtOpponentDashing) {
      // GDD section 23/107: Circular Attack catching an active Dash Attack
      // launches the attacker's *target* upward instead of normal knockback.
      const vel = defender.body.linvel();
      defender.body.setLinvel({ x: vel.x, y: vel.y + CIRCULAR_CATCHES_DASH_LAUNCH_UP_MPS, z: vel.z }, true);
      defender.stability.applyDamage(computeStabilityDamage(hit.hitbox.stabilityDamage));
      continue;
    }

    const knockback = computeKnockback({
      baseForce: hit.hitbox.knockbackForce,
      attackerSpeedMps: attackerMovement.speedMps,
      defenderSpeedMps: defenderMovement.speedMps,
      defenderStabilityFraction: defender.stability.resource.fraction,
      defenderStaminaPenaltyFraction: 1 - defender.stamina.resource.fraction,
      attackerVelocityXZ: attackerMovement.actualVelocityVector,
      impactDirectionXZ: normalize(subtract(defenderPos, attackerPos)),
    });
    applyKnockback(defender.body, attackerPos, defenderPos, knockback);

    const { isQualifyingKoHit } = defender.stability.applyDamage(computeStabilityDamage(hit.hitbox.stabilityDamage));
    if (isQualifyingKoHit) {
      if (hit.attackerIsFirst) secondKoed = true;
      else firstKoed = true;
    }
  }

  const ringOutFirst = isRingOut(firstPos);
  const ringOutSecond = isRingOut(secondPos);
  roundState.resolveTick({ firstKoed, secondKoed, firstRingOut: ringOutFirst, secondRingOut: ringOutSecond });

  return {
    first: {
      movement: firstMovement,
      spin: first.spin.getSnapshot(first.body),
      grounded: firstGrounded,
      driftState: firstDrift.driftState,
      attackState: firstAttack.state,
      dashChargeFraction: firstAttack.chargeFraction,
      staminaFraction: first.stamina.resource.fraction,
      stabilityFraction: first.stability.resource.fraction,
      isBroken: first.stability.isBroken,
      attackEnergyFraction: first.attackEnergy.resource.fraction,
    },
    second: {
      movement: secondMovement,
      spin: second.spin.getSnapshot(second.body),
      grounded: secondGrounded,
      driftState: secondDrift.driftState,
      attackState: secondAttack.state,
      dashChargeFraction: secondAttack.chargeFraction,
      staminaFraction: second.stamina.resource.fraction,
      stabilityFraction: second.stability.resource.fraction,
      isBroken: second.stability.isBroken,
      attackEnergyFraction: second.attackEnergy.resource.fraction,
    },
    hitEvents,
    ringOutFirst,
    ringOutSecond,
  };
}
