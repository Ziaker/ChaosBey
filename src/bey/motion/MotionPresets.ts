// ============================================================
// MOTION DIRECTIONS A / B / C — THE APPROVED MOTION LAB PRESETS (M11)
// The three movement languages of the Bey Motion Lab
// (prototypes/bey-motion-concepts), integrated into the real controllers
// on the owner's order after the M11 playtest ("eu sempre aprovei ...
// ajeita tudo logo"; docs/design-decisions/motion-approval.md §16).
//
// The 33 values below are the Lab's PRESETS, copied exactly
// (prototypes/bey-motion-concepts/src/physics/params.ts, commit 53289b5).
// Gameplay: the choice changes the simulation, so it lives in MatchConfig
// and is recorded in every replay. B (Physical Hybrid) is the default:
// the Lab built B from the game's own values, so it is the "middle".
//
// The game runs Rapier, not the Lab's hand-written model, so the numbers
// are applied the way motion-approval.md §14.3 asks — as behaviour, not a
// literal copy: planar drive and grip are the Lab's formulas; where the
// game already has a tuned counterpart in other units (upright torque,
// impact tilt impulse, knockback, per-archetype handling), a preset
// scales it by its ratio to B, so B keeps the game's validated numbers and
// Attack/Defense/Stamina keep their differences.
// ============================================================

export type MotionDirectionId = 'A' | 'B' | 'C';

export const MOTION_DIRECTION_IDS: readonly MotionDirectionId[] = ['A', 'B', 'C'];
export const DEFAULT_MOTION_DIRECTION: MotionDirectionId = 'B';

/** The Lab's PhysicsParams, same keys and units. */
export interface MotionParams {
  // Drive
  readonly accel: number;
  readonly maxSpeed: number;
  readonly turnRate: number;
  // Grip / slip
  readonly lateralGrip: number;
  readonly longitudinalGrip: number;
  readonly slipThreshold: number;
  readonly slipGrip: number;
  readonly gripRecovery: number;
  readonly airGrip: number;
  // Tilt / lean
  readonly leanStrength: number;
  readonly speedTilt: number;
  /** Degrees. */
  readonly maxTilt: number;
  // Wobble / precession
  /** Degrees. */
  readonly wobbleAmplitude: number;
  readonly wobbleFrequency: number;
  readonly wobbleFromImpact: number;
  readonly wobbleDecay: number;
  readonly precession: number;
  // Upright recovery
  readonly uprightStrength: number;
  readonly recoveryDamping: number;
  readonly postImpactRecovery: number;
  // Impacts / bounce
  readonly restitutionBey: number;
  readonly floorBounce: number;
  readonly wallBounce: number;
  readonly wallFriction: number;
  readonly impactAngularImpulse: number;
  readonly linearToAngular: number;
  readonly knockbackScale: number;
  readonly knockbackLift: number;
  readonly tumbleStrength: number;
  readonly tumbleThreshold: number;
  readonly angularDamping: number;
  // Stability limits (numerical safety, not gameplay)
  readonly maxLinearSpeed: number;
  readonly maxAngularSpeed: number;
}

export interface MotionDirection {
  readonly id: MotionDirectionId;
  readonly name: string;
  readonly summary: string;
  readonly params: MotionParams;
}

/**
 * Owner, 2026-10-02 (Lote 6, item 10): the lean — leanStrength, speedTilt and maxTilt — of every direction (A/B/C)
 * is 25% smaller. Render-only (the attitude never feeds the physics; see SpinController).
 */
export const LEAN_SCALE = 0.75;

const B: MotionParams = {
  accel: 14, maxSpeed: 11, turnRate: 2.6,
  lateralGrip: 5.5, longitudinalGrip: 0.6, slipThreshold: 2.5, slipGrip: 0.35, gripRecovery: 3, airGrip: 0.4,
  leanStrength: 0.022 * LEAN_SCALE, speedTilt: 0.006 * LEAN_SCALE, maxTilt: 35 * LEAN_SCALE,
  wobbleAmplitude: 6, wobbleFrequency: 7, wobbleFromImpact: 0.12, wobbleDecay: 1.2, precession: 4,
  uprightStrength: 60, recoveryDamping: 7, postImpactRecovery: 0.6,
  restitutionBey: 0.55, floorBounce: 0.35, wallBounce: 0.5, wallFriction: 1.2, impactAngularImpulse: 0.12, linearToAngular: 0.5,
  knockbackScale: 1, knockbackLift: 0.18, tumbleStrength: 0.6, tumbleThreshold: 9, angularDamping: 1.6,
  maxLinearSpeed: 60, maxAngularSpeed: 30, // 26 → 60 (owner, 2026-10-04: +45% speed and a bigger momentum need room; numerical safety only)
};

export const MOTION_DIRECTIONS: Readonly<Record<MotionDirectionId, MotionDirection>> = {
  A: {
    id: 'A',
    name: 'A — Stable Arcade',
    summary: 'Firm and readable: little tilt, wobble or tumble, grip and uprightness come back fast.',
    params: {
      ...B,
      turnRate: 3.4, lateralGrip: 9, slipThreshold: 5.5, slipGrip: 0.6, gripRecovery: 7,
      leanStrength: 0.01 * LEAN_SCALE, speedTilt: 0.002 * LEAN_SCALE, maxTilt: 18 * LEAN_SCALE,
      wobbleAmplitude: 3, wobbleFromImpact: 0.06, wobbleDecay: 2.5, precession: 1,
      uprightStrength: 140, recoveryDamping: 16, postImpactRecovery: 0.15,
      restitutionBey: 0.45, floorBounce: 0.15, wallBounce: 0.35, wallFriction: 1.8, impactAngularImpulse: 0.05, linearToAngular: 0.2,
      knockbackScale: 0.85, knockbackLift: 0.06, tumbleStrength: 0.15, tumbleThreshold: 14, angularDamping: 3.5,
    },
  },
  B: {
    id: 'B',
    name: 'B — Physical Hybrid',
    summary: 'Weight and inertia you can feel: expressive slip and tilt, impacts transfer spin and lean, recovery physical but controlled.',
    params: B,
  },
  C: {
    id: 'C',
    name: 'C — Wild Mechanical',
    summary: 'Strong angular reactions: big tilt, wobble, bounce and tumble, dramatic ricochets — still clamped to stay numerically stable.',
    params: {
      ...B,
      turnRate: 2.2, lateralGrip: 3.2, slipThreshold: 2.2, slipGrip: 0.18, gripRecovery: 1.4,
      leanStrength: 0.04 * LEAN_SCALE, speedTilt: 0.012 * LEAN_SCALE, maxTilt: 48 * LEAN_SCALE,
      wobbleAmplitude: 11, wobbleFrequency: 6, wobbleFromImpact: 0.22, wobbleDecay: 0.6, precession: 8,
      uprightStrength: 30, recoveryDamping: 3.5, postImpactRecovery: 1.4,
      restitutionBey: 0.75, floorBounce: 0.55, wallBounce: 0.75, wallFriction: 0.6, impactAngularImpulse: 0.26, linearToAngular: 1.1,
      knockbackScale: 1.25, knockbackLift: 0.32, tumbleStrength: 1.4, tumbleThreshold: 6, angularDamping: 0.8,
    },
  },
};

/** B: the reference the ratio-scaled values are measured against. */
export const REFERENCE_MOTION: MotionParams = B;

export function motionParams(id: MotionDirectionId = DEFAULT_MOTION_DIRECTION): MotionParams {
  return MOTION_DIRECTIONS[id].params;
}

export function isMotionDirectionId(value: unknown): value is MotionDirectionId {
  return value === 'A' || value === 'B' || value === 'C';
}

/** A preset's value relative to B (1 for B). */
export function motionRatio(params: MotionParams, key: keyof MotionParams): number {
  return params[key] / REFERENCE_MOTION[key];
}

// --- Contact restitution (Rapier) ---------------------------------------
// Rapier combines two colliders' restitution by a rule; MULTIPLY on the
// Bey (it outranks the default AVERAGE on the arena) lets one direction set
// all three bounces independently: the Bey's own coefficient is
// √restitutionBey (Bey × Bey = restitutionBey) and every arena surface
// divides its target bounce by the same √ (Bey × surface = the target).

/** The Bey collider's own restitution coefficient (combined by MULTIPLY). */
export function beyColliderRestitution(params: MotionParams): number {
  return Math.sqrt(params.restitutionBey);
}

/** The coefficient an arena surface needs so that its contact with a Bey bounces `target`. */
export function surfaceColliderRestitution(target: number, params: MotionParams): number {
  return target / beyColliderRestitution(params);
}

/**
 * The game detects an impact as the velocity CHANGE it caused, which for a
 * bounce is the incoming speed times (1 + restitution); the Motion Lab's
 * impact responses (tilt kick, whirl, tumble threshold) are per m/s of
 * INCOMING speed. This converts, with the direction's wall bounce as the
 * restitution (the detector cannot tell a wall from a Bey).
 */
export function labImpactSpeed(impactDeltaSpeedMps: number, params: MotionParams): number {
  return impactDeltaSpeedMps / (1 + params.wallBounce);
}
