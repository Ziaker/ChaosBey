// ============================================================
// OVERLAY STATE FROM A MATCH SESSION
// Reads (never mutates) a MatchSession into the F3 overlay's flat state.
// Moved out of main.ts unchanged so the game and the Debug Lab show the
// same numbers.
// ============================================================

import { AIController } from '../../ai/controllers/AIController';
import type { MatchSession } from '../../app/session/MatchSession';
import { computeClashPower, computeMashPerformance, computeStaminaFactor, computeVelocityFactor } from '../../combat/clash/ClashFormula';
import type { DebugOverlayState } from './DebugOverlay';

export type CombatOverlayFields = Omit<DebugOverlayState, 'fps' | 'frameTimeMs' | 'physicsStepTimeMs' | 'tickIndex' | 'seedText' | 'gameState'>;

/** Null until the session has run its first tick. */
export function buildCombatOverlayFields(session: MatchSession): CombatOverlayFields | null {
  const result = session.getLastResult();
  const camera = session.getLastCameraOutput();
  if (!result || !camera) return null;
  const clash = session.clash.controller;
  const firstMash = clash.getFirstMashEventCount();
  const secondMash = clash.getSecondMashEventCount();
  const secondController = session.getController('second');

  return {
    intendedSteeringVector: result.first.movement.intendedSteeringVector,
    actualVelocityVector: result.first.movement.actualVelocityVector,
    speedMps: result.first.movement.speedMps,
    headingRad: result.first.movement.headingRad,
    desiredMoveIntent: session.getLastActions('first')?.moveIntent ?? null,
    slipAngleRad: result.first.movement.slipAngleRad,
    lateralGripPerS: result.first.movement.lateralGripPerS,
    longitudinalDragPerS: result.first.movement.longitudinalDragPerS,
    grounded: result.first.grounded,
    driftState: result.first.driftState,
    dodgeState: result.first.dodgeState,
    angularVelocity: result.first.spin.angularVelocity,
    spinRateRadPerSec: result.first.spin.spinRateRadPerSec,
    tiltRad: result.first.spin.tiltRad,
    wobbleEnergy: result.first.spin.wobbleEnergy,
    firstAttackState: result.first.attackState,
    firstDashChargeFraction: result.first.dashChargeFraction,
    firstStaminaFraction: result.first.staminaFraction,
    firstStabilityFraction: result.first.stabilityFraction,
    firstIsBroken: result.first.isBroken,
    firstAttackEnergyFraction: result.first.attackEnergyFraction,
    secondAttackState: result.second.attackState,
    secondStaminaFraction: result.second.staminaFraction,
    secondStabilityFraction: result.second.stabilityFraction,
    secondIsBroken: result.second.isBroken,
    roundResult: session.roundState.result,
    cameraFovDeg: camera.fovDeg,
    cameraShakeOffsetM: camera.shakeOffsetM,
    isHitstopActive: camera.isHitstopActive,
    hitstopRemainingS: camera.hitstopRemainingS,
    cameraHighSpeedBlend: camera.highSpeedBlend,
    clashState: clash.getState(),
    clashElapsedS: clash.getElapsedS(),
    clashCooldownRemainingS: clash.getCooldownRemainingS(),
    clashOutcome: clash.getLastResult()?.outcome ?? '-',
    firstClashMashEventCount: firstMash,
    secondClashMashEventCount: secondMash,
    // Stamina/Velocity read the values captured at tryStart() (frozen for
    // this Clash's whole Active + Cooldown lifetime), not a live
    // recomputation: that is what actually decided (or is deciding) the
    // outcome (GDD section 152's Debug Lab requirement).
    firstClashMashPerformance: computeMashPerformance(firstMash),
    firstClashStaminaFactor: computeStaminaFactor(clash.getFirstStaminaFractionAtStart()),
    firstClashVelocityFactor: computeVelocityFactor(clash.getFirstSpeedMpsAtStart()),
    firstClashPower: computeClashPower(firstMash, clash.getFirstStaminaFractionAtStart(), clash.getFirstSpeedMpsAtStart()),
    secondClashMashPerformance: computeMashPerformance(secondMash),
    secondClashStaminaFactor: computeStaminaFactor(clash.getSecondStaminaFractionAtStart()),
    secondClashVelocityFactor: computeVelocityFactor(clash.getSecondSpeedMpsAtStart()),
    secondClashPower: computeClashPower(secondMash, clash.getSecondStaminaFractionAtStart(), clash.getSecondSpeedMpsAtStart()),
    clashImpactMultiplier: session.matchConfig.clashImpactMultiplier,
    aiDebug: secondController instanceof AIController ? secondController.getDebugState() : null,
  };
}
