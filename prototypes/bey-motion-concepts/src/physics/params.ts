// ============================================================
// BEY MOTION LAB — PHYSICS PARAMETERS AND PRESETS A / B / C
// PROTOTYPE values for comparing motion languages. None of them is
// balance, none is used by the game, and the preset names are lab
// identifiers only (not game modes). The owner picks or mixes behaviors
// here; only an approved, recorded set is ever integrated.
//
// Where a parameter has a game counterpart, preset B starts from the
// game's current value (src/bey/movement/MovementTuning.ts,
// src/bey/spin/SpinTuning.ts, src/arena) so "B" is roughly "the game
// today, made more physical"; A and C bracket it.
// ============================================================

export interface PhysicsParams {
  // --- Drive ---
  accel: number;
  maxSpeed: number;
  turnRate: number;
  // --- Grip / slip ---
  lateralGrip: number;
  longitudinalGrip: number;
  slipThreshold: number;
  slipGrip: number;
  gripRecovery: number;
  airGrip: number;
  // --- Tilt / lean ---
  leanStrength: number;
  speedTilt: number;
  maxTilt: number;
  // --- Wobble / precession ---
  wobbleAmplitude: number;
  wobbleFrequency: number;
  wobbleFromImpact: number;
  wobbleDecay: number;
  precession: number;
  // --- Upright recovery ---
  uprightStrength: number;
  recoveryDamping: number;
  postImpactRecovery: number;
  // --- Impacts / bounce ---
  restitutionBey: number;
  floorBounce: number;
  wallBounce: number;
  wallFriction: number;
  impactAngularImpulse: number;
  linearToAngular: number;
  knockbackScale: number;
  knockbackLift: number;
  tumbleStrength: number;
  tumbleThreshold: number;
  angularDamping: number;
  // --- Stability limits ---
  maxLinearSpeed: number;
  maxAngularSpeed: number;
}

export type ParamKey = keyof PhysicsParams;

export interface ParamSpec {
  readonly key: ParamKey;
  readonly label: string;
  readonly group: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly unit: string;
  readonly help: string;
}

export const PARAM_SPECS: readonly ParamSpec[] = [
  { key: 'accel', group: 'Drive', label: 'Acceleration', min: 4, max: 30, step: 0.5, unit: 'm/s²', help: 'Thrust along the heading (game: 14).' },
  { key: 'maxSpeed', group: 'Drive', label: 'Top speed', min: 5, max: 20, step: 0.5, unit: 'm/s', help: 'Speed the thrust stops adding at (game: 11).' },
  { key: 'turnRate', group: 'Drive', label: 'Turn rate', min: 0.5, max: 8, step: 0.1, unit: 'rad/s', help: 'How fast the heading follows the steering (game: 2.6).' },

  { key: 'lateralGrip', group: 'Grip / slip', label: 'Lateral grip', min: 0, max: 20, step: 0.1, unit: '1/s', help: 'How fast sideways velocity is killed (game: 5.5). Low = slides, high = on rails.' },
  { key: 'longitudinalGrip', group: 'Grip / slip', label: 'Longitudinal grip', min: 0, max: 4, step: 0.05, unit: '1/s', help: 'Rolling drag along the heading when coasting (game: 0.6).' },
  { key: 'slipThreshold', group: 'Grip / slip', label: 'Slip threshold', min: 0.5, max: 10, step: 0.1, unit: 'm/s', help: 'Sideways speed above which the tip breaks loose.' },
  { key: 'slipGrip', group: 'Grip / slip', label: 'Grip while slipping', min: 0, max: 1, step: 0.01, unit: '×', help: 'Lateral grip multiplier once slipping (and right after an impact).' },
  { key: 'gripRecovery', group: 'Grip / slip', label: 'Grip recovery', min: 0.2, max: 12, step: 0.1, unit: '1/s', help: 'How fast grip comes back after slipping or an impact.' },
  { key: 'airGrip', group: 'Grip / slip', label: 'Airborne grip', min: 0, max: 3, step: 0.05, unit: '1/s', help: 'Sideways damping in the air (game: 0.4).' },

  { key: 'leanStrength', group: 'Tilt / lean', label: 'Lean into acceleration', min: 0, max: 0.08, step: 0.001, unit: 'rad per m/s²', help: 'How far the Bey leans into turns and speed changes.' },
  { key: 'speedTilt', group: 'Tilt / lean', label: 'Speed-to-tilt', min: 0, max: 0.03, step: 0.0005, unit: 'rad per m/s', help: 'Forward lean from travel speed.' },
  { key: 'maxTilt', group: 'Tilt / lean', label: 'Maximum tilt', min: 5, max: 60, step: 1, unit: '°', help: 'Clamp for normal lean (game reference: 35°). Tumbles may exceed it.' },

  { key: 'wobbleAmplitude', group: 'Wobble / precession', label: 'Wobble amplitude', min: 0, max: 20, step: 0.5, unit: '°', help: 'Wobble swing at full wobble energy (game: 6°).' },
  { key: 'wobbleFrequency', group: 'Wobble / precession', label: 'Wobble frequency', min: 1, max: 20, step: 0.5, unit: 'Hz', help: 'Game: 7 Hz.' },
  { key: 'wobbleFromImpact', group: 'Wobble / precession', label: 'Wobble per impact', min: 0, max: 0.4, step: 0.01, unit: 'per m/s', help: 'Wobble energy added per m/s of impact (game: 0.12).' },
  { key: 'wobbleDecay', group: 'Wobble / precession', label: 'Wobble decay', min: 0.1, max: 5, step: 0.05, unit: '1/s', help: 'Game: 1.2.' },
  { key: 'precession', group: 'Wobble / precession', label: 'Precession-like response', min: 0, max: 12, step: 0.1, unit: '', help: 'Gyroscopic coupling: a push on the tilt turns sideways and circles (0 = plain rocking).' },

  { key: 'uprightStrength', group: 'Recovery', label: 'Upright recovery', min: 5, max: 200, step: 1, unit: '1/s²', help: 'Spring pulling the tilt back to its target (game gain: 9, different units).' },
  { key: 'recoveryDamping', group: 'Recovery', label: 'Recovery damping', min: 0.5, max: 30, step: 0.1, unit: '1/s', help: 'Damps the tilt swing (game: 2.4).' },
  { key: 'postImpactRecovery', group: 'Recovery', label: 'Post-impact recovery time', min: 0, max: 3, step: 0.05, unit: 's', help: 'After an impact the upright spring fades back in over this time (gradual recovery).' },

  { key: 'restitutionBey', group: 'Impacts / bounce', label: 'Bey-Bey restitution', min: 0, max: 1, step: 0.01, unit: '', help: 'Bounciness of Bey-on-Bey contact.' },
  { key: 'floorBounce', group: 'Impacts / bounce', label: 'Floor bounce', min: 0, max: 0.9, step: 0.01, unit: '', help: 'Vertical restitution on landing.' },
  { key: 'wallBounce', group: 'Impacts / bounce', label: 'Wall bounce', min: 0, max: 1, step: 0.01, unit: '', help: 'Restitution against the wall.' },
  { key: 'wallFriction', group: 'Impacts / bounce', label: 'Wall friction / scrape', min: 0, max: 6, step: 0.05, unit: '1/s', help: 'Speed lost sliding along the wall.' },
  { key: 'impactAngularImpulse', group: 'Impacts / bounce', label: 'Impact angular impulse', min: 0, max: 0.6, step: 0.005, unit: 'rad/s per m/s', help: 'Tilt kick per m/s of impact.' },
  { key: 'linearToAngular', group: 'Impacts / bounce', label: 'Linear-to-angular transfer', min: 0, max: 2, step: 0.02, unit: '', help: 'Glancing impact speed turned into body whirl and spin change.' },
  { key: 'knockbackScale', group: 'Impacts / bounce', label: 'Knockback strength', min: 0, max: 2, step: 0.02, unit: '×', help: 'Multiplier on scripted attack knockback.' },
  { key: 'knockbackLift', group: 'Impacts / bounce', label: 'Knockback lift', min: 0, max: 0.6, step: 0.01, unit: '', help: 'Fraction of knockback sent upward (launches).' },
  { key: 'tumbleStrength', group: 'Impacts / bounce', label: 'Knockback tumble', min: 0, max: 3, step: 0.02, unit: 'rad/s per m/s', help: 'Whirl/tumble from impact speed above the threshold.' },
  { key: 'tumbleThreshold', group: 'Impacts / bounce', label: 'Tumble threshold', min: 2, max: 20, step: 0.25, unit: 'm/s', help: 'Impact speed below which there is no tumble.' },
  { key: 'angularDamping', group: 'Impacts / bounce', label: 'Angular damping', min: 0.2, max: 8, step: 0.05, unit: '1/s', help: 'How fast whirl/tumble dies out.' },

  { key: 'maxLinearSpeed', group: 'Stability limits', label: 'Max linear speed', min: 10, max: 40, step: 1, unit: 'm/s', help: 'Hard clamp (numerical safety, not gameplay).' },
  { key: 'maxAngularSpeed', group: 'Stability limits', label: 'Max angular speed', min: 5, max: 60, step: 1, unit: 'rad/s', help: 'Hard clamp on tilt rate and whirl (numerical safety).' },
];

export type PresetId = 'A' | 'B' | 'C';

export interface Preset {
  readonly id: PresetId;
  readonly name: string;
  readonly summary: string;
  readonly params: PhysicsParams;
}

const B: PhysicsParams = {
  accel: 14, maxSpeed: 11, turnRate: 2.6,
  lateralGrip: 5.5, longitudinalGrip: 0.6, slipThreshold: 2.5, slipGrip: 0.35, gripRecovery: 3, airGrip: 0.4,
  leanStrength: 0.022, speedTilt: 0.006, maxTilt: 35,
  wobbleAmplitude: 6, wobbleFrequency: 7, wobbleFromImpact: 0.12, wobbleDecay: 1.2, precession: 4,
  uprightStrength: 60, recoveryDamping: 7, postImpactRecovery: 0.6,
  restitutionBey: 0.55, floorBounce: 0.35, wallBounce: 0.5, wallFriction: 1.2, impactAngularImpulse: 0.12, linearToAngular: 0.5,
  knockbackScale: 1, knockbackLift: 0.18, tumbleStrength: 0.6, tumbleThreshold: 9, angularDamping: 1.6,
  maxLinearSpeed: 26, maxAngularSpeed: 30,
};

export const PRESETS: readonly Preset[] = [
  {
    id: 'A',
    name: 'Stable Arcade',
    summary: 'Firm and readable: little tilt, wobble or tumble, grip and uprightness come back fast.',
    params: {
      ...B,
      turnRate: 3.4, lateralGrip: 9, slipThreshold: 5.5, slipGrip: 0.6, gripRecovery: 7,
      leanStrength: 0.01, speedTilt: 0.002, maxTilt: 18,
      wobbleAmplitude: 3, wobbleFromImpact: 0.06, wobbleDecay: 2.5, precession: 1,
      uprightStrength: 140, recoveryDamping: 16, postImpactRecovery: 0.15,
      restitutionBey: 0.45, floorBounce: 0.15, wallBounce: 0.35, wallFriction: 1.8, impactAngularImpulse: 0.05, linearToAngular: 0.2,
      knockbackScale: 0.85, knockbackLift: 0.06, tumbleStrength: 0.15, tumbleThreshold: 14, angularDamping: 3.5,
    },
  },
  {
    id: 'B',
    name: 'Physical Hybrid',
    summary: 'Weight and inertia you can feel: expressive slip and tilt, impacts transfer spin and lean, recovery physical but controlled.',
    params: B,
  },
  {
    id: 'C',
    name: 'Wild Mechanical',
    summary: 'Strong angular reactions: big tilt, wobble, bounce and tumble, dramatic ricochets — still clamped to stay numerically stable.',
    params: {
      ...B,
      turnRate: 2.2, lateralGrip: 3.2, slipThreshold: 2.2, slipGrip: 0.18, gripRecovery: 1.4,
      leanStrength: 0.04, speedTilt: 0.012, maxTilt: 48,
      wobbleAmplitude: 11, wobbleFrequency: 6, wobbleFromImpact: 0.22, wobbleDecay: 0.6, precession: 8,
      uprightStrength: 30, recoveryDamping: 3.5, postImpactRecovery: 1.4,
      restitutionBey: 0.75, floorBounce: 0.55, wallBounce: 0.75, wallFriction: 0.6, impactAngularImpulse: 0.26, linearToAngular: 1.1,
      knockbackScale: 1.25, knockbackLift: 0.32, tumbleStrength: 1.4, tumbleThreshold: 6, angularDamping: 0.8,
    },
  },
];

export function presetParams(id: PresetId): PhysicsParams {
  return { ...PRESETS.find((p) => p.id === id)!.params };
}
