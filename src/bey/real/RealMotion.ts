// ============================================================
// BEY REAL — THE MOTION MODEL (physics only: nobody steers the Bey but the stage)
// Owner, 2026-10-10 ("os beys estão só sendo controlados por uma IA ao invés de realmente estarem apenas sendo influenciados pela
// física do stage … re-direcionamentos estranhos onde simplesmente param de ser influenciados pelo momentum"): there is no
// autopilot any more. A Bey's velocity is its state, and only physical forces change it, every tick:
//   - the bowl: gravity along the funnel's slope, toward the low point (realBowl.ts). It is what turns a Bey round: it dives to
//     the centre fast, climbs the slope slowing down, stops, slides back down and across — up and down and to the sides, the
//     flower pattern of a real top (owner, 2026-10-10: "a ideia é eles irem pro centro e depois voltarem, subindo e descendo e
//     indo para os lados também, seguindo uma física coesa");
//   - the tip's drive: the spin feeds the motion. It pushes only along the way of travel and only to keep the Bey's mechanical
//     energy (speed² / 2 + the bowl's height) at what the spin can sustain — crossing the low point at the rolling speed. It
//     never picks a direction or a circle: where the Bey goes is the bowl's doing, and a knock that throws it high up the slope
//     plays out in full and comes back down by itself;
//   - the player's lean: the stick (× influence) leans the top, a force capped by the same grip — it bends the path, it never
//     replaces the velocity;
//   - the tip's bite across the slope (it leans into the bowl: it slides up and down freely, not round), which is what sends the
//     Bey back through the centre instead of round and round;
//   - the tip's friction and the air's drag, the wobble of a tired spin, and precession (the spin bends the path).
// Collisions are not here: the physics world changes the velocity, the next tick starts from it.
// Pure arithmetic on plain vectors, so the unit tests and the headless balancing can run it; MovementController owns the instance
// and writes the result into the body.
// ============================================================

import type { Vec2 } from '../../physics/Vec2';
import { naturalBowlGravity } from './realBowl';
import type { RealModeConfig } from './RealTuning';

/** How fast the tip's drive brings the motion's energy back to what the spin sustains (1/s), before the grip caps it. */
const DRIVE_RESPONSE_PER_S = 4;
/** Slope (dh/dr) from which the tip leans fully into the bowl (its bite across the slope is whole); flatter, it bites less. */
const LEAN_FULL_SLOPE = 0.05;
/** Under this speed (m/s) there is no way of travel to push along (a top resting at the low point stays there). */
const ROLL_MIN_SPEED_MPS = 0.5;
/** The drive's force is energy rate / rolling speed: never worked out at less than this (a spin so low it barely rolls). */
const DRIVE_MIN_SPEED_MPS = 3;
/** The spin below which the Bey starts to lose grip (share of full spin). */
const GRIP_FULL_SPIN = 0.25;
/** Grip left to a Broken Bey. */
const BROKEN_GRIP = 0.3;
/** Stability (0..100) under which the Bey starts to wobble. */
const UNSTABLE_BELOW = 40;
/** The wobble's rate (rad/s): calm and tired. Fast, because the Bey is (0.64.0: ×5 with the speed). */
const WOBBLE_RATE_RAD_S = 40;
const WOBBLE_RATE_TIRED_RAD_S = 70;
/** How fast the velocity chases the stick's in the air when air control is on (1/s). */
const AIR_RESPONSE_PER_S = 3;

export interface RealStepInput {
  readonly velocity: Vec2;
  /** The player's lean: world X/Z, length 0..1 (already × influence; zero = none, always zero for the AI). */
  readonly intent: Vec2;
  /** Height of the floor under the Bey above the arena's low point (m): the bowl's potential energy is the bowl's gravity × it. */
  readonly floorHeightM: number;
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
  /** The tip's work this tick (drive + lean, m/s²), for the spin it costs. */
  readonly steerEffortMps2: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** The speed the tip can roll the Bey at with this much spin left (m/s). */
export function rollingSpeedMps(config: RealModeConfig, spin: number): number {
  return config.cruiseSpeedMps * (config.cruiseMinShare + (1 - config.cruiseMinShare) * Math.sqrt(clamp(spin, 0, 1)));
}

export class RealMotion {
  private wobblePhase = 0;
  /** The bowl's gravity per unit of slope (realBowl.naturalBowlGravity × the slider). */
  private readonly bowlGravity: number;

  constructor(
    private readonly config: RealModeConfig,
    /** +1 / -1: the way the spin turns, so the way the tip rolls and the path curves. */
    private readonly spinDir: 1 | -1,
  ) {
    this.bowlGravity = config.bowlPull * naturalBowlGravity(config);
  }

  step(input: RealStepInput): RealStepResult {
    const { config, spinDir } = this;
    const { dt, spin } = input;
    let vx = input.velocity.x;
    let vz = input.velocity.z;
    let ax = 0;
    let az = 0;
    let effort = 0;

    if (!input.grounded) {
      // In the air: momentum only. The player picks the moment of the jump, not the direction — unless air control is on.
      if (input.airControl > 0) {
        ax += (input.intent.x * config.cruiseSpeedMps - vx) * AIR_RESPONSE_PER_S * input.airControl;
        az += (input.intent.z * config.cruiseSpeedMps - vz) * AIR_RESPONSE_PER_S * input.airControl;
      }
    } else {
      const grip = clamp(spin / GRIP_FULL_SPIN, 0, 1) * (input.broken ? BROKEN_GRIP : 1);
      const cap = config.steerAccelMps2 * grip;
      const speed = Math.hypot(vx, vz);

      // The bowl: gravity along the slope, toward the low point. On a slope the tip leans into it: it slides freely up and down
      // the slope but bites when the Bey slips across it (round the arena) — that bite is what takes the round-the-arena motion
      // away and sends the Bey back through the centre, a pendulum whose swing the precession and every hit keep turning.
      const n = input.floorNormal;
      if (n && n.y > 1e-6) {
        const horizontal = Math.hypot(n.x, n.z);
        if (horizontal > 1e-9) {
          const ix = n.x / horizontal;
          const iz = n.z / horizontal;
          const slope = horizontal / n.y;
          ax += ix * this.bowlGravity * slope;
          az += iz * this.bowlGravity * slope;
          const bite = config.crossGripPerS * clamp(slope / LEAN_FULL_SLOPE, 0, 1);
          const across = vx * -iz + vz * ix;
          ax -= -iz * across * bite;
          az -= ix * across * bite;
        }
      }

      // The tip's drive: along the way of travel only, toward the energy the spin sustains (½·rolling speed² at the low point).
      if (speed > ROLL_MIN_SPEED_MPS) {
        const roll = rollingSpeedMps(config, spin);
        const energy = 0.5 * speed * speed + this.bowlGravity * Math.max(0, input.floorHeightM);
        // The push is the energy rate over the rolling speed, not over the current speed: it works where the Bey runs fast (across
        // the low point, mostly up and down the slope), not where it stalls at the top of its climb and drifts sideways — so it
        // feeds the swing through the centre and never winds the Bey up into circling the arena.
        const drive = clamp((DRIVE_RESPONSE_PER_S * (0.5 * roll * roll - energy)) / Math.max(roll, DRIVE_MIN_SPEED_MPS), -cap, cap);
        ax += (vx / speed) * drive;
        az += (vz / speed) * drive;
        effort += Math.abs(drive);
      }

      // The player's lean: a force, capped by the same grip — it bends the path, it does not replace the velocity.
      ax += input.intent.x * cap;
      az += input.intent.z * cap;
      effort += Math.hypot(input.intent.x, input.intent.z) * cap;

      // The tip's friction (more when the spin is low) and the drag.
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
    return { velocity: { x: vx, z: vz }, steerEffortMps2: effort };
  }

  private wobble(vx: number, vz: number, spin: number, broken: boolean, stability: number, dt: number): Vec2 {
    const { config } = this;
    const tired = clamp((config.wobbleSpin - spin) / Math.max(1e-3, config.wobbleSpin), 0, 1);
    const unstable = broken ? 1 : clamp(1 - stability / UNSTABLE_BELOW, 0, 1) * 0.5;
    const amplitude = config.wobbleAccelMps2 * Math.max(tired * tired, unstable);
    this.wobblePhase += (WOBBLE_RATE_RAD_S + WOBBLE_RATE_TIRED_RAD_S * Math.max(tired, unstable)) * dt;
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
