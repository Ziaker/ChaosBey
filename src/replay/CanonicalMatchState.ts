// ============================================================
// CANONICAL MATCH STATE V1 (M9-A)
// A plain-data snapshot of everything about a match that (a) affects what
// happens on the NEXT tick and (b) isn't already fixed at match setup
// (Bey definitions, match config — see ReplayHeader in contracts.ts for
// those). Deliberately NOT Rapier.World.takeSnapshot(): that's an opaque
// binary blob tied to the physics engine's own internal layout, unusable
// for a per-field divergence breakdown and not guaranteed stable across
// Rapier versions. Every field here is named and independently meaningful,
// so StateHash.ts (a later M9-A piece) can report exactly which section —
// even which field — first diverged between two runs.
//
// Built from each subsystem's own getCanonicalState()-style getter (added
// alongside this file to DodgeController, DriftController, AttackController,
// MovementController, SpinController and SeededRng) rather than their
// existing getDebugState()/getSnapshot() methods: those are UI/derived-
// value shaped and free to change independently (e.g. a cooldown reported
// as "remaining" rather than "elapsed"). Canonical state instead mirrors
// each class's raw private fields one-to-one, so a hash mismatch always
// traces back to one real piece of persistent state, never a display
// transform.
//
// Excluded on purpose: MovementController's lastHeadingForward/
// lastLateralGripPerS/intendedVelocityThisTick (recomputed fresh every
// applyPreStep before anything reads them again — see
// MovementCanonicalState's doc comment); the "gameplay"/"cosmetic" RNG
// streams (allocated but not actually consumed by any tick-order-dependent
// decision today, so they carry no divergence risk to detect); controller
// kind/BeyDefinition ids/MatchConfig (session setup, not evolving state —
// already ReplayHeader's job).
// ============================================================

import { CANONICAL_STATE_VERSION } from './contracts';
import type { Bey } from '../bey/core/Bey';
import type { RoundState, RoundOutcome } from '../combat/round-rules/RoundState';
import type { ClashController, ClashState, ClashResult } from '../combat/clash/ClashController';
import type { SeededRng } from '../rng/SeededRng';
import type { DriftCanonicalState } from '../drift/DriftController';
import type { DodgeCanonicalState } from '../dodge/DodgeController';
import type { AttackCanonicalState } from '../combat/attacks/AttackController';
import type { MovementCanonicalState } from '../bey/movement/MovementController';

export interface CanonicalVec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface CanonicalQuat {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

export interface CanonicalSpinState {
  readonly spinRateRadPerSec: number;
  readonly visualSpinAngleRad: number;
  readonly wobbleEnergy: number;
  readonly wobbleTimeAccumulatorS: number;
}

export interface CanonicalResourceState {
  readonly value: number;
}

export interface CanonicalBeyState {
  /** Rapier's own rigid body state — the one piece of "physics-engine" data here, but as named fields (never the engine's opaque snapshot blob). */
  readonly positionM: CanonicalVec3;
  readonly rotation: CanonicalQuat;
  readonly linvelMps: CanonicalVec3;
  readonly angvelRadPerS: CanonicalVec3;
  readonly movement: MovementCanonicalState;
  readonly spin: CanonicalSpinState;
  readonly drift: DriftCanonicalState;
  readonly dodge: DodgeCanonicalState;
  readonly attack: AttackCanonicalState;
  readonly stamina: CanonicalResourceState;
  readonly stability: CanonicalResourceState & { readonly broken: boolean; readonly timeSinceLastDamageS: number };
  readonly attackEnergy: CanonicalResourceState & { readonly timeSinceLastConsumptionS: number };
  /** This side's own AI decision stream's raw internal counter (see SeededRng.getInternalStateUint32()) — present even while this side isn't currently AI-driven (MatchSession/the headless self-test loop both allocate it unconditionally), so switching controllers mid-match never changes CanonicalMatchStateV1's shape. */
  readonly aiRngState: number;
}

export interface CanonicalClashState {
  readonly state: ClashState;
  readonly elapsedS: number;
  readonly cooldownRemainingS: number;
  readonly firstMashEventCount: number;
  readonly secondMashEventCount: number;
  readonly firstStaminaFractionAtStart: number;
  readonly secondStaminaFractionAtStart: number;
  readonly firstSpeedMpsAtStart: number;
  readonly secondSpeedMpsAtStart: number;
  /** The most recently COMPLETED Clash's result — persists (and matters, e.g. for UI/telemetry) well past the tick it happened on, so it's real state, not a one-tick event. */
  readonly lastResult: ClashResult | null;
}

export interface CanonicalMatchStateV1 {
  readonly canonicalStateVersion: typeof CANONICAL_STATE_VERSION;
  readonly tick: number;
  readonly first: CanonicalBeyState;
  readonly second: CanonicalBeyState;
  readonly roundOutcome: RoundOutcome;
  readonly clash: CanonicalClashState;
}

function vec3(v: { x: number; y: number; z: number }): CanonicalVec3 {
  return { x: v.x, y: v.y, z: v.z };
}

function buildBeyState(bey: Bey, aiRng: SeededRng): CanonicalBeyState {
  const spinSnapshot = bey.spin.getSnapshot(bey.body);
  return {
    positionM: vec3(bey.body.translation()),
    rotation: { ...bey.body.rotation() },
    linvelMps: vec3(bey.body.linvel()),
    angvelRadPerS: vec3(bey.body.angvel()),
    movement: bey.movement.getCanonicalState(),
    spin: {
      spinRateRadPerSec: spinSnapshot.spinRateRadPerSec,
      visualSpinAngleRad: spinSnapshot.visualSpinAngleRad,
      wobbleEnergy: spinSnapshot.wobbleEnergy,
      wobbleTimeAccumulatorS: bey.spin.getWobbleTimeAccumulatorS(),
    },
    drift: bey.drift.getCanonicalState(),
    dodge: bey.dodge.getCanonicalState(),
    attack: bey.attack.getCanonicalState(),
    stamina: { value: bey.stamina.resource.value },
    stability: {
      value: bey.stability.resource.value,
      broken: bey.stability.isBroken,
      timeSinceLastDamageS: bey.stability.getTimeSinceLastDamageS(),
    },
    attackEnergy: {
      value: bey.attackEnergy.resource.value,
      timeSinceLastConsumptionS: bey.attackEnergy.getTimeSinceLastConsumptionS(),
    },
    aiRngState: aiRng.getInternalStateUint32(),
  };
}

/**
 * Builds one tick's canonical state. Callable identically from the live
 * game/Debug Lab (MatchSession) and the headless self-test/AI batch runner
 * (AiMatchSimulation) — both already hold exactly these pieces (two Beys, a
 * RoundState, a ClashController, and one SeededRng per side's AI decisions)
 * with nothing else to adapt.
 */
export function buildCanonicalMatchState(
  tick: number,
  first: Bey,
  second: Bey,
  roundState: RoundState,
  clash: ClashController,
  firstAiRng: SeededRng,
  secondAiRng: SeededRng,
): CanonicalMatchStateV1 {
  return {
    canonicalStateVersion: CANONICAL_STATE_VERSION,
    tick,
    first: buildBeyState(first, firstAiRng),
    second: buildBeyState(second, secondAiRng),
    roundOutcome: roundState.result,
    clash: {
      state: clash.getState(),
      elapsedS: clash.getElapsedS(),
      cooldownRemainingS: clash.getCooldownRemainingS(),
      firstMashEventCount: clash.getFirstMashEventCount(),
      secondMashEventCount: clash.getSecondMashEventCount(),
      firstStaminaFractionAtStart: clash.getFirstStaminaFractionAtStart(),
      secondStaminaFractionAtStart: clash.getSecondStaminaFractionAtStart(),
      firstSpeedMpsAtStart: clash.getFirstSpeedMpsAtStart(),
      secondSpeedMpsAtStart: clash.getSecondSpeedMpsAtStart(),
      lastResult: clash.getLastResult(),
    },
  };
}
