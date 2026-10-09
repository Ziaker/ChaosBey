// ============================================================
// BEY REAL — FROM THE SLIDERS TO EACH SYSTEM'S OWN NUMBERS
// The attack, the dodge and the stability each take a small tuning object (the game's own constants by default). A Bey Real match
// fills them from MatchConfig.real here, so no system has to know the mode exists and the classic game never reaches this file.
// ============================================================

import type { AttackTuningValues } from '../../combat/attacks/AttackController';
import type { DodgeTuningValues } from '../../dodge/DodgeController';
import type { StabilityRecoveryTuning } from '../stability/StabilitySystem';
import type { BeyAttackProfile } from '../archetype/BeyAttackProfile';
import type { RealModeConfig } from './RealTuning';

/** The Dash's mass boost the game's own knockback already has (the owner's base is 1.8): at that value the Dash throws as it always did. */
export const DASH_MASS_BOOST_BASELINE = 1.8;
/** Bey Real's wait before Stability starts to climb back (s): the lab's. */
const STABILITY_REGEN_DELAY_S = 1.5;

export function attackTuningOf(real: RealModeConfig): AttackTuningValues {
  return {
    dashMaxChargeS: real.dashChargeMaxS,
    dashActiveDurationS: real.dashDurationS,
    dashWhiffRecoveryS: real.dashWhiffRecoveryS,
    dashSnapRadPerS: real.dashSnapRadPerS,
    dashSnapWindowS: real.dashSnapWindowS,
    dashLockOnRadPerS: real.dashLockRadPerS,
    dashMinStabilityDamage: real.dashStabilityMin,
    dashMaxStabilityDamage: real.dashStabilityMax,
    dashKnockbackScale: real.dashMassBoost / DASH_MASS_BOOST_BASELINE,
    circularActiveDurationS: real.circularDurationS,
    circularRecoveryS: real.circularRecoveryS,
    circularStabilityDamage: real.circularStability,
  };
}

/** The Bey's attack profile with the mode's Dash speeds and Circular reach (every Bey gets the same, as in the lab). */
export function attackProfileOf(profile: BeyAttackProfile, real: RealModeConfig): BeyAttackProfile {
  return { ...profile, dashMinSpeedMps: real.dashMinSpeedMps, dashMaxSpeedMps: real.dashMaxSpeedMps, circularHitboxRadiusM: real.circularRadiusM };
}

export function dodgeTuningOf(real: RealModeConfig): DodgeTuningValues {
  return { activeDurationS: real.dodgeInvulnS, burstDurationS: Math.min(real.dodgeBurstS, real.dodgeInvulnS), perfectWindowS: real.dodgePerfectS };
}

export function stabilityRecoveryOf(real: RealModeConfig): StabilityRecoveryTuning {
  return { recoveryDelayS: STABILITY_REGEN_DELAY_S, recoveryPerS: real.stabilityRegenPerS, brokenDurationS: real.brokenS };
}


/** The Stamina drain of a Bey Real match (StaminaSystem.realDrain): shares of the full spin. */
export function realSpinDrainOf(real: RealModeConfig): { readonly decayPerS: number; readonly perMeter: number; readonly perSteer: number } {
  return { decayPerS: real.spinDecayPerS, perMeter: real.spinMoveLossPerM, perSteer: real.spinSteerLoss };
}

/** The way the second Bey spins: opposite to the first by default, the same way with the "Sentido do giro" slider up. */
export function realSecondSpinDir(real: RealModeConfig): 1 | -1 {
  return real.sameSpin >= 0.5 ? 1 : -1;
}
