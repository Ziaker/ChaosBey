// ============================================================
// BEY REAL — THE AUTOPILOT AND THE PLAYER'S SHARE
// Where a Bey that steers itself wants to go (orbit the way its spin turns it, a little pursuit of the opponent, keep off the
// wall), and how the player's stick is mixed into that. Pure: positions in, a world X/Z vector (length 0..1) out. The same
// model as the lab (prototypes/bey-real-physics-concepts/src/sim/RealSim.ts, `autopilot` / `move`), so the numbers carry over.
// ============================================================

import type { Vec2 } from '../../physics/Vec2';
import type { RealModeConfig } from './RealTuning';

/** The Bey's radius the arena edge is measured with is not needed here: the containment starts at 82% of the stage. */
const EDGE_FRACTION = 0.82;
/** The orbit radius breathes (so two Beys on the same orbit meet): its amplitude and rate are sliders; each side has its own phase. */
const ORBIT_PHASE = [0, 2.1] as const;
/** Close up the pursuit fades out so two Beys do not lean on each other. */
const PURSUIT_FADE_START_M = 1.8;
const PURSUIT_FADE_SPAN_M = 2.7;

export interface AutopilotInput {
  readonly position: Vec2;
  readonly opponentPosition: Vec2;
  /** The opponent's spin, 0..1 (pursuit grows as it gets tired). */
  readonly opponentSpin: number;
  /** +1 / -1: the way this Bey's spin turns it. */
  readonly spinDir: 1 | -1;
  /** 0 for the first Bey, 1 for the second (their orbit breathes out of step). */
  readonly side: 0 | 1;
  readonly timeS: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** A unit-or-shorter world vector for where this Bey wants to go. */
export function autopilotIntent(config: RealModeConfig, input: AutopilotInput): Vec2 {
  const { position, opponentPosition } = input;
  const radius = Math.hypot(position.x, position.z) || 1e-6;
  const rx = position.x / radius;
  const rz = position.z / radius;
  // Orbit the way the spin turns it.
  const tx = -rz * input.spinDir;
  const tz = rx * input.spinDir;
  const target = config.stageRadiusM * config.orbitRadiusFrac * (1 + config.orbitBreath * Math.sin(config.orbitBreathRadPerS * input.timeS + ORBIT_PHASE[input.side]));
  const radial = clamp((target - radius) / 3, -1, 1) * 0.9;
  const edge = EDGE_FRACTION * config.stageRadiusM;
  const contain = radius > edge ? -clamp((radius - edge) / Math.max(1e-6, config.stageRadiusM - edge), 0, 1) * 2 : 0;
  // Pursuit grows as the opponent gets tired, and fades when the two are close.
  const ox = opponentPosition.x - position.x;
  const oz = opponentPosition.z - position.z;
  const distance = Math.hypot(ox, oz) || 1;
  const near = clamp((distance - PURSUIT_FADE_START_M) / PURSUIT_FADE_SPAN_M, 0, 1);
  const pursuit = config.pursuit * near * (0.4 + 0.6 * clamp(1 - input.opponentSpin, 0, 1) + 0.3 * clamp(4 / distance, 0, 1));
  let ix = tx + rx * (radial + contain) + (ox / distance) * pursuit;
  let iz = tz + rz * (radial + contain) + (oz / distance) * pursuit;
  const magnitude = Math.hypot(ix, iz);
  if (magnitude > 1) {
    ix /= magnitude;
    iz /= magnitude;
  }
  return { x: ix, z: iz };
}

/**
 * The steering the Bey is given: the autopilot's, with the player's stick taking `influence × stick strength` of it.
 * No stick = the autopilot alone; `influence` 1 with the stick held = the stick alone. `stick` is the world vector the input
 * layer produced (length 0..1); the AI side passes zero.
 */
export function blendSteering(auto: Vec2, stick: Vec2, influence: number): Vec2 {
  const strength = Math.min(1, Math.hypot(stick.x, stick.z));
  if (strength < 1e-6) return auto;
  const w = clamp(influence, 0, 1) * strength;
  const length = Math.hypot(stick.x, stick.z);
  return { x: auto.x * (1 - w) + (stick.x / length) * w, z: auto.z * (1 - w) + (stick.z / length) * w };
}
