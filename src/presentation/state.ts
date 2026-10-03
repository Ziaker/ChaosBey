// ============================================================
// PRESENTATION STATE (pure selectors)
// What a Bey is doing right now, as plain normalized numbers a visual system
// can read without touching Rapier, the AI or the camera director. Derived,
// never stored in gameplay, never written back. Every selector is a pure
// function of its arguments: same input, same output, input untouched.
//
// Deliberately no visual thresholds here (when does a Bey "look tired"?).
// Those are tuning of the approved condition visuals and belong to the system
// that integrates them. This layer only offers the raw normalized values and
// two plain deficits.
// ============================================================

import type { BeySnapshot } from '../app/simulation/tickMatch';
import { AttackState } from '../combat/attacks/AttackController';
import type { DodgeState } from '../dodge/DodgeController';
import type { DriftState } from '../drift/DriftController';
import type { PresentationSide, PresentationEvent } from './events';
import type { ClashPresentationSnapshot } from './clash';

/** The slice of a BeySnapshot the selector reads (a BeySnapshot satisfies it). */
export type BeyPresentationFacts = Pick<
  BeySnapshot,
  'grounded' | 'driftState' | 'dodgeState' | 'attackState' | 'dashChargeFraction' | 'staminaFraction' | 'stabilityFraction' | 'isBroken' | 'dashReadiness'
> & {
  readonly movement: { readonly speedMps: number };
  readonly spin: { readonly spinRateRadPerSec: number; readonly wobbleEnergy: number; readonly tiltRad: number; readonly isTumbling: boolean };
};

export interface BeyPresentationMeta {
  readonly side: PresentationSide;
  /** The gameplay BeyDefinition id (an archetype today). */
  readonly definitionId: string;
  /** The Bey's own top speed, to normalize speed. */
  readonly maxSpeedMps: number;
}

export interface BeyPresentationState {
  readonly side: PresentationSide;
  readonly definitionId: string;
  /** 0..1 */
  readonly stamina: number;
  /** 0..1 */
  readonly stability: number;
  readonly broken: boolean;
  /** 0..1 */
  readonly dashReadiness: number;
  /** 0..1 while charging a Dash, else 0. */
  readonly dashCharge: number;
  readonly speedMps: number;
  /** Speed over this Bey's own top speed, 0..1 (above 1 clamps: a Dash or a knockback can exceed it). */
  readonly speedFraction: number;
  readonly airborne: boolean;
  readonly driftState: DriftState;
  readonly attackState: AttackState;
  readonly dodgeState: DodgeState;
  readonly spinRateRadPerSec: number;
  /** The spin controller's wobble energy, 0..1. */
  readonly wobbleSeverity: number;
  readonly tiltRad: number;
  readonly tumbling: boolean;
  /** 1 − stamina, 0..1. A plain deficit, not a threshold. */
  readonly staminaDeficit: number;
  /** 1 − stability, 0..1. */
  readonly stabilityDeficit: number;
  /** The larger of the two deficits, 0..1. */
  readonly lowResourceSeverity: number;
}

/** The most recent impact-type event on one side, so a system can fade an effect by `tick − lastImpact.tick`. */
export interface RecentImpact {
  readonly kind: 'hitResolved' | 'collisionResolved' | 'knockbackStarted';
  /** 0..1 for a hit or collision; for a knockback the force (not 0..1). */
  readonly magnitude: number;
  readonly tick: number;
}

export interface RoundPresentationState {
  readonly over: boolean;
  readonly outcome: string;
}

/**
 * A read-only copy of what the camera director decided this tick, for systems
 * that need to know the shot (a HUD that avoids the action, a VFX that scales
 * with FOV). The CameraDirector stays the only authority over the camera: this
 * is data going out, and nothing in presentation can send anything back.
 */
export interface CameraPresentationSnapshot {
  /** The director's active mode name (CombatFollow, Clash, RingOut...). */
  readonly mode: string;
  /** The player's chosen preset (A, B or C). */
  readonly preset: string;
  readonly fovDeg: number;
  readonly distanceM: number;
  readonly yawDeg: number;
  /** 0..1 share of the forced Clash camera on screen. */
  readonly clashBlend: number;
  readonly highSpeedBlend: number;
  readonly hitstopActive: boolean;
  readonly hitstopRemainingS: number;
}

export interface MatchPresentationState {
  readonly tick: number;
  readonly round: RoundPresentationState;
  readonly first: BeyPresentationState;
  readonly second: BeyPresentationState;
  readonly clash: ClashPresentationSnapshot;
  /** The shot this tick, or null before the camera has run. */
  readonly camera: CameraPresentationSnapshot | null;
  readonly recentImpact: Readonly<Record<PresentationSide, RecentImpact | null>>;
}

const clamp01 = (value: number): number => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);

export function selectBeyPresentationState(facts: BeyPresentationFacts, meta: BeyPresentationMeta): BeyPresentationState {
  const stamina = clamp01(facts.staminaFraction);
  const stability = clamp01(facts.stabilityFraction);
  const staminaDeficit = 1 - stamina;
  const stabilityDeficit = 1 - stability;
  const charging = facts.attackState === AttackState.ChargingDash;
  return {
    side: meta.side,
    definitionId: meta.definitionId,
    stamina,
    stability,
    broken: facts.isBroken,
    dashReadiness: clamp01(facts.dashReadiness),
    dashCharge: charging ? clamp01(facts.dashChargeFraction) : 0,
    speedMps: facts.movement.speedMps,
    speedFraction: meta.maxSpeedMps > 0 ? clamp01(facts.movement.speedMps / meta.maxSpeedMps) : 0,
    airborne: !facts.grounded,
    driftState: facts.driftState,
    attackState: facts.attackState,
    dodgeState: facts.dodgeState,
    spinRateRadPerSec: facts.spin.spinRateRadPerSec,
    wobbleSeverity: clamp01(facts.spin.wobbleEnergy),
    tiltRad: facts.spin.tiltRad,
    tumbling: facts.spin.isTumbling,
    staminaDeficit,
    stabilityDeficit,
    lowResourceSeverity: Math.max(staminaDeficit, stabilityDeficit),
  };
}

/** Folds this tick's events into the per-side "most recent impact" memory. Pure: returns a new record. */
export function foldRecentImpact(previous: Readonly<Record<PresentationSide, RecentImpact | null>>, events: readonly PresentationEvent[]): Readonly<Record<PresentationSide, RecentImpact | null>> {
  let next: Record<PresentationSide, RecentImpact | null> | null = null;
  for (const event of events) {
    let side: PresentationSide;
    let recent: RecentImpact;
    if (event.kind === 'hitResolved') {
      side = event.defenderSide;
      recent = { kind: 'hitResolved', magnitude: event.magnitude, tick: event.tick };
    } else if (event.kind === 'collisionResolved') {
      side = event.side;
      recent = { kind: 'collisionResolved', magnitude: event.magnitude, tick: event.tick };
    } else if (event.kind === 'knockbackStarted') {
      side = event.side;
      recent = { kind: 'knockbackStarted', magnitude: event.force, tick: event.tick };
    } else {
      continue;
    }
    next ??= { ...previous };
    next[side] = recent;
  }
  return next ?? previous;
}
