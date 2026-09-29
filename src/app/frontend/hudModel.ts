// ============================================================
// HUD MODEL — WHAT THE COMBAT HUD SHOWS, AS PLAIN DATA (M10)
// Reads a finished tick's result into the numbers the HUD draws, and holds
// the approved Clash bar rule (clash-presentation-approval.md 3.5), so both
// are unit-testable without a DOM. Read-only: nothing here feeds back into
// the match.
// ============================================================

import { AttackState } from '../../combat/attacks/AttackController';

/** Clash bar gain and limits (approved behavior; the gain may only change by playtest, GDD 167). */
export const CLASH_BAR_GAIN = 4;
export const CLASH_BAR_MIN_SHARE = 0.04;
export const CLASH_BAR_MAX_SHARE = 0.96;
/** How fast the bar follows the live power (per second). */
export const CLASH_BAR_FOLLOW_PER_S = 8;

/**
 * The first side's share of the tug-of-war bar: 0.5 + 0.5 × advantage × 4,
 * advantage = (P1 − P2) / (P1 + P2), limited to 4%–96%. Even when nobody
 * has power yet.
 */
export function clashBarShare(firstPower: number, secondPower: number): number {
  const total = firstPower + secondPower;
  const advantage = total > 0 ? (firstPower - secondPower) / total : 0;
  return Math.min(CLASH_BAR_MAX_SHARE, Math.max(CLASH_BAR_MIN_SHARE, 0.5 + 0.5 * advantage * CLASH_BAR_GAIN));
}

/** Moves `current` toward `target` at CLASH_BAR_FOLLOW_PER_S (frame-rate independent). */
export function followClashBar(current: number, target: number, frameDeltaSeconds: number): number {
  const t = 1 - Math.exp(-CLASH_BAR_FOLLOW_PER_S * Math.max(0, frameDeltaSeconds));
  return current + (target - current) * t;
}

export interface HudSide {
  readonly stamina: number;
  readonly stability: number;
  readonly broken: boolean;
  readonly attackEnergy: number;
  /** Dash charge 0..1 while charging, else 0. */
  readonly dashCharge: number;
  /** Short state tag for the card ("DASH", "BROKEN"...), or null. */
  readonly tag: string | null;
}

export interface TickSideFacts {
  readonly staminaFraction: number;
  readonly stabilityFraction: number;
  readonly isBroken: boolean;
  readonly attackEnergyFraction: number;
  readonly dashChargeFraction: number;
  readonly attackState: AttackState;
}

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

export function hudSide(facts: TickSideFacts): HudSide {
  const charging = facts.attackState === AttackState.ChargingDash;
  let tag: string | null = null;
  if (facts.isBroken) tag = 'BROKEN';
  else if (charging) tag = 'CHARGING';
  else if (facts.attackState === AttackState.DashActive) tag = 'DASH';
  else if (facts.attackState === AttackState.CircularActive) tag = 'SPIN';
  return {
    stamina: clamp01(facts.staminaFraction),
    stability: clamp01(facts.stabilityFraction),
    broken: facts.isBroken,
    attackEnergy: clamp01(facts.attackEnergyFraction),
    dashCharge: charging ? clamp01(facts.dashChargeFraction) : 0,
    tag,
  };
}

/** "RING OUT!", "K.O.!" or "DRAW" for the round-end banner. */
export function roundEndBanner(outcome: string): string | null {
  if (outcome.includes('RingOut')) return 'RING OUT!';
  if (outcome.includes('Ko')) return 'K.O.!';
  if (outcome === 'Draw') return 'DRAW';
  return null;
}
