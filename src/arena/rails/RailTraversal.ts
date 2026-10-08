// ============================================================
// RAIL TRAVERSAL — the explicit state a Bey on a rail is in, and the tuning it will need (Rail Grinding preparation, 0.50.0)
// docs/planning/RAIL_GRINDING_FUTURE_UPDATE.md §4.2/§5/§12. NOT wired into any gameplay: how a Bey enters, leaves or is
// interrupted on a rail is undecided (ASK FIRST), so this only fixes WHAT must be observable (replay, telemetry, Debug Lab,
// AI, tests) and WHERE the tuning lives, so the implementation does not spread booleans through MovementController or magic
// numbers through the code. Names of the reasons are provisional.
// ============================================================

export type RailEntryReason = 'jump' | 'proximity' | 'input' | 'scripted';
export type RailExitReason = 'end' | 'voluntary' | 'interrupted' | 'hit' | 'ring-out' | 'scripted';
export type RailDirection = 1 | -1;

/** What the runtime must be able to expose about a Bey that is (or just was) on a rail. */
export interface RailTraversalState {
  /** null = not on a rail. */
  readonly railId: string | null;
  readonly progressM: number;
  readonly direction: RailDirection;
  /** Speed along the rail (m/s). */
  readonly speedMps: number;
  /** Horizontal speed the Bey had when it attached (m/s). */
  readonly entrySpeedMps: number;
  readonly timeOnRailS: number;
  readonly entryReason: RailEntryReason | null;
  /** Why the last traversal ended (null while on the rail, and before any). */
  readonly exitReason: RailExitReason | null;
}

export const NOT_ON_RAIL: RailTraversalState = {
  railId: null,
  progressM: 0,
  direction: 1,
  speedMps: 0,
  entrySpeedMps: 0,
  timeOnRailS: 0,
  entryReason: null,
  exitReason: null,
};

export function isOnRail(state: RailTraversalState): boolean {
  return state.railId !== null;
}

/**
 * Every tuning value the doc lists (§12) so none is a magic number later. The VALUES are not decided: nothing reads this
 * in gameplay, and `PLACEHOLDER_RAIL_TUNING` exists only so prototypes and tests have something to build against.
 */
export interface RailTuning {
  /** Distance/volume within which a Bey can attach (m). */
  readonly captureRadiusM: number;
  /** Angular tolerance of the entry, between the Bey's velocity and the rail's tangent (rad). */
  readonly entryAngleTolRad: number;
  /** Least horizontal speed to attach (m/s), 0 = none. */
  readonly minEntrySpeedMps: number;
  /** The grind never starts slower than this (m/s): a Bey that jumped in standing still still travels the rail. */
  readonly startSpeedMps: number;
  /** Acceleration along the rail (m/s²). */
  readonly accelerationMps2: number;
  /** Speed the grind pulls toward (m/s). */
  readonly targetSpeedMps: number;
  /** Speed above which the grind no longer adds (m/s). */
  readonly maxSpeedMps: number;
  /** 0..1: how much of the entry speed carries into the grind. */
  readonly entrySpeedCarry: number;
  /** 0..1: how much of the grind's speed carries out. */
  readonly exitSpeedCarry: number;
  /** 0..1: blend of the rail's tangent against the Bey's heading when leaving. */
  readonly exitTangentBlend: number;
  /** Upward speed on leaving (m/s), 0 = none. */
  readonly exitLiftMps: number;
  /** Time before the Bey can attach again after leaving (s). */
  readonly reattachCooldownS: number;
  /** Stamina drained per second on a rail, 0 = none. */
  readonly staminaDrainPerS: number;
  /** How fast the Bey is pulled onto the rail's line when it grabs it (1/s) — a short, observable correction, never a snap. */
  readonly attachCorrectionPerS: number;
  /** The most that correction may add (m/s). */
  readonly attachCorrectionMaxMps: number;
}

/** PLACEHOLDER values for prototypes and tests ONLY — not a decision, not used by the game. */
export const PLACEHOLDER_RAIL_TUNING: RailTuning = {
  captureRadiusM: 1.5,
  entryAngleTolRad: Math.PI / 2,
  minEntrySpeedMps: 0,
  startSpeedMps: 8,
  accelerationMps2: 10,
  targetSpeedMps: 30,
  maxSpeedMps: 45,
  entrySpeedCarry: 1,
  exitSpeedCarry: 1,
  exitTangentBlend: 1,
  exitLiftMps: 0,
  reattachCooldownS: 0.5,
  staminaDrainPerS: 0,
  attachCorrectionPerS: 14,
  attachCorrectionMaxMps: 10,
};

/**
 * The tuning the game plays with (0.51.0). The owner closed HOW the rail works (jump toward it to grab it, there and back
 * along the same route, only charging the attack and jumping while on it, a jump leaves it for the arena) but gave no
 * numbers: every value here is PROVISIONAL, to be tuned by playtest in this one place.
 */
export const RAIL_TUNING: RailTuning = {
  captureRadiusM: 1.8,
  entryAngleTolRad: Math.PI / 2,
  minEntrySpeedMps: 0,
  startSpeedMps: 8,
  accelerationMps2: 12,
  targetSpeedMps: 32,
  maxSpeedMps: 40,
  entrySpeedCarry: 1,
  exitSpeedCarry: 1,
  exitTangentBlend: 1,
  exitLiftMps: 0,
  reattachCooldownS: 0.5,
  staminaDrainPerS: 0,
  attachCorrectionPerS: 14,
  attachCorrectionMaxMps: 10,
};
