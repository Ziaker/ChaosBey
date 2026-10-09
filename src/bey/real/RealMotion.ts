// ============================================================
// BEY REAL — THE MOTION MODEL
// What moves a Bey that is not driven like a kart: its velocity is the state, and a handful of forces change it every tick —
// the bowl (gravity along the funnel's slope), the tip's friction and the air's drag, the steering the autopilot and the player
// ask for (limited by the grip a tired or broken spin has left), the sideways shake of a tired spin (wobble), and the curve the
// spin gives the path (precession). Collisions are not here: the physics world changes the velocity, the next tick starts
// from it. Pure arithmetic on plain vectors, so the unit tests and the headless balancing can run it; MovementController owns
// the instance and writes the result into the body.
//
// Same model and constants as the lab (prototypes/bey-real-physics-concepts/src/sim/RealSim.ts, `move`).
// ============================================================

import type { Vec2 } from '../../physics/Vec2';
import type { RealModeConfig } from './RealTuning';

/** How fast the velocity chases the one the steering asks for (1/s). */
const STEER_RESPONSE_PER_S = 3;
/** The spin below which the Bey starts to lose grip (share of full spin). */
const GRIP_FULL_SPIN = 0.25;
/** Grip left to a Broken Bey. */
const BROKEN_GRIP = 0.3;
/** Stability (0..100) under which the Bey starts to wobble. */
const UNSTABLE_BELOW = 40;

export interface RealStepInput {
  readonly velocity: Vec2;
  /** The steering asked for: world X/Z, length 0..1 (zero = none). Already the autopilot/stick blend. */
  readonly intent: Vec2;
  /** The floor's unit normal under the Bey (grounded), or null on flat ground / in the air. */
  readonly floorNormal: { readonly x: number; readonly y: number; readonly z: number } | null;
  readonly grounded: boolean;
  readonly dt: number;
  /** Share of the full spin left, 0..1. */
  readonly spin: number;
  readonly broken: boolean;
  /** Stability, 0..100. */
  readonly stability: number;
  /** MatchConfig.airControl: how much it can still steer in the air (0 = none). */
  readonly airControl: number;
}

export interface RealStepResult {
  readonly velocity: Vec2;
  /** The steering acceleration actually applied (m/s²), for the spin it costs. */
  readonly steerEffortMps2: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export class RealMotion {
  private wobblePhase = 0;

  constructor(
    private readonly config: RealModeConfig,
    /** +1 / -1: the way the spin turns, so the way the path curves. */
    private readonly spinDir: 1 | -1,
  ) {}

  step(input: RealStepInput): RealStepResult {
    const { config, spinDir } = this;
    const { dt, spin } = input;
    let vx = input.velocity.x;
    let vz = input.velocity.z;
    let ax = 0;
    let az = 0;
    let steerEffort = 0;
    // Winding up a Dash does not slow or stop the Bey (owner, 2026-10-09): it keeps moving at full pace while it charges.
    const cruise = config.cruiseSpeedMps * (config.cruiseMinShare + (1 - config.cruiseMinShare) * Math.sqrt(clamp(spin, 0, 1)));

    if (!input.grounded) {
      // In the air: momentum only. The player picks the moment of the jump, not the direction — unless air control is on.
      if (input.airControl > 0) {
        ax += (input.intent.x * config.cruiseSpeedMps - vx) * STEER_RESPONSE_PER_S * input.airControl;
        az += (input.intent.z * config.cruiseSpeedMps - vz) * STEER_RESPONSE_PER_S * input.airControl;
      }
    } else {
      // The bowl: gravity along the slope, toward the low point.
      const n = input.floorNormal;
      if (n && n.y > 1e-6) {
        const horizontal = Math.hypot(n.x, n.z);
        if (horizontal > 1e-9) {
          const pull = (config.bowlPull * horizontal) / n.y;
          ax += (n.x / horizontal) * pull;
          az += (n.z / horizontal) * pull;
        }
      }
      // Steering, limited by grip.
      const grip = clamp(spin / GRIP_FULL_SPIN, 0, 1) * (input.broken ? BROKEN_GRIP : 1);
      let sax = (input.intent.x * cruise - vx) * STEER_RESPONSE_PER_S;
      let saz = (input.intent.z * cruise - vz) * STEER_RESPONSE_PER_S;
      const cap = config.steerAccelMps2 * grip;
      const length = Math.hypot(sax, saz);
      if (length > cap) {
        sax *= cap / Math.max(1e-9, length);
        saz *= cap / Math.max(1e-9, length);
      }
      ax += sax;
      az += saz;
      steerEffort = Math.hypot(sax, saz);
      // The tip's friction (more when the spin is low) and the drag.
      const speed = Math.hypot(vx, vz);
      if (speed > 1e-6) {
        const friction = Math.min(speed / dt, config.tipFrictionMps2 * (1 + 2 * (1 - clamp(spin / config.wobbleSpin, 0, 1))));
        ax -= (vx / speed) * friction;
        az -= (vz / speed) * friction;
      }
      ax -= vx * config.dragPerS;
      az -= vz * config.dragPerS;
      // The wobble of a tired or broken spin.
      const wobble = this.wobble(vx, vz, spin, input.broken, input.stability, dt);
      ax += wobble.x;
      az += wobble.z;
    }

    vx += ax * dt;
    vz += az * dt;
    if (input.grounded) {
      // Precession: the spin bends the path the way the top turns.
      const omega = config.precessionRadPerS * clamp(spin, 0, 1) * spinDir * dt;
      const c = Math.cos(omega);
      const s = Math.sin(omega);
      const nvx = vx * c - vz * s;
      const nvz = vx * s + vz * c;
      vx = nvx;
      vz = nvz;
    }
    return { velocity: { x: vx, z: vz }, steerEffortMps2: steerEffort };
  }

  private wobble(vx: number, vz: number, spin: number, broken: boolean, stability: number, dt: number): Vec2 {
    const { config } = this;
    const tired = clamp((config.wobbleSpin - spin) / Math.max(1e-3, config.wobbleSpin), 0, 1);
    const unstable = broken ? 1 : clamp(1 - stability / UNSTABLE_BELOW, 0, 1) * 0.5;
    const amplitude = config.wobbleAccelMps2 * Math.max(tired * tired, unstable);
    this.wobblePhase += (8 + 14 * Math.max(tired, unstable)) * dt;
    const speed = Math.hypot(vx, vz);
    if (amplitude <= 1e-6 || speed < 1e-3) return { x: 0, z: 0 };
    const s = Math.sin(this.wobblePhase);
    return { x: (-vz / speed) * amplitude * s, z: (vx / speed) * amplitude * s };
  }

  /** The motion state for the match's state hash (the wobble's phase is the only thing it remembers). */
  getPhase(): number {
    return this.wobblePhase;
  }
}
