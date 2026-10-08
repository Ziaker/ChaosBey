// ============================================================
// BEY FLOW FX LAB — ANIME WIND AND DUST
// The continuous "epic" layer the owner asked for: anime dust behind the
// tip (three ideas, see AnimeDust), torn wind streaks streaming behind the
// Bey, and, on a Dash release or a hit, jagged shock rings, a floor crown and
// a dust burst.
// All of it is built from the approved Cel Cyclone pieces (src/vfx/hybrid/fx:
// wakeStreakFx, jaggedRingFx and their textures), so it lives
// in the same cel look; the dust is the lab's own (AnimeDust).
//
// Presentation only: it reads a FlowBey and emits effects into an FxLayer.
// ============================================================

import * as THREE from 'three';
import { jaggedRingFx, wakeStreakFx, type WindLook } from '../../../../src/vfx/hybrid/fx/primitives';
import type { FxLayer } from '../../../../src/vfx/hybrid/fx/FxLayer';
import { jaggedRing, tornStreak } from '../../../../src/vfx/hybrid/fx/textures';
import { floorHeight, type FlowBey } from '../sim/FlowSim';
import type { Tuning } from '../tuning';
import { AnimeDust, type DustStyle } from './AnimeDust';

// ---------------- TUNING ----------------
const TRAIL_MIN_SPEED_MPS = 2;
const TRAIL_FULL_SPEED_MPS = 10;
const WIND_WHITE = 0xffffff;
const WIND_GREY = 0xaab6c8;
const CEL_LOOK: WindLook = { cel: true, opacity: 1 };
const BEY_MID_HEIGHT_M = 0.55;       // the middle of the Bey's body above the floor: the shock rings are born here
const RING_STAGGER_S = 0.05;
const RING_LIFE_S = 0.42;
const RING_SHRINK_PER_RING = 0.18;
const DASH_BURST = 6;
const DASH_FAN_RAD = 0.7;
const BURST_LIFE_S = 1;
const BURST_COUNT_MIN = 6;
const BURST_COUNT_MAX = 12;
// -----------------------------------------

export interface WindFlags {
  dust: boolean;
  wind: boolean;
  crown: boolean;
}

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Small deterministic generator so a replayed lab shows the same dust (mulberry32). */
function makeRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class AnimeWind {
  private readonly rng: () => number;
  private readonly dustCarry = [0, 0];
  private readonly windCarry = [0, 0];
  /** Where each Bey's rim is now: the streaks' heads follow this while they are young. */
  private readonly follow = [new THREE.Vector3(), new THREE.Vector3()];
  private readonly dust: AnimeDust;

  constructor(
    private readonly layer: FxLayer,
    camera: THREE.Camera,
    seed = 7,
  ) {
    this.rng = makeRng(seed);
    this.dust = new AnimeDust(layer, camera, this.rng);
  }

  /** The colour the dust cutouts are multiplied by (the arena's light). */
  get dustTint(): THREE.Color {
    return this.dust.tint;
  }

  /** The dust idea in use (roll, bubbles or shards). */
  get dustStyle(): DustStyle {
    return this.dust.style;
  }

  set dustStyle(style: DustStyle) {
    this.dust.style = style;
  }

  /** Dust emissions so far (observability for the stats line and the tests). */
  get emittedDust(): number {
    return this.dust.emitted;
  }

  private rand(a: number, b: number): number {
    return a + this.rng() * (b - a);
  }

  /** Per rendered frame, per Bey: dust and wind streaks in proportion to the speed. `tip` is the contact point. */
  trail(i: 0 | 1, b: FlowBey, tip: THREE.Vector3, dt: number, tuning: Tuning, flags: WindFlags): void {
    const rimY = tip.y + 0.55;
    this.follow[i]!.set(tip.x, rimY, tip.z);
    if (b.speed < TRAIL_MIN_SPEED_MPS || dt <= 0) return;
    const speedK = smoothstep(TRAIL_MIN_SPEED_MPS, TRAIL_FULL_SPEED_MPS, b.speed);
    const dashK = b.dashing ? tuning.dustDashBoost : 0;
    const dir = new THREE.Vector3(b.vx / b.speed, 0, b.vz / b.speed);
    const back = dir.clone().negate();
    const side = new THREE.Vector3(-dir.z, 0, dir.x);

    if (flags.dust) {
      this.dustCarry[i] = this.dustCarry[i]! + tuning.dustRate * tuning.intensity * speedK * (1 + dashK) * dt;
      while (this.dustCarry[i]! >= 1) {
        this.dustCarry[i] = this.dustCarry[i]! - 1;
        const size = tuning.dustSizeM * this.rand(0.7, 1.2) * (0.6 + 0.5 * speedK + 0.15 * dashK);
        this.dust.puff(tip, back, speedK, size, tuning.dustLifeS * this.rand(0.8, 1.15));
      }
    }

    if (flags.wind) {
      this.windCarry[i] = this.windCarry[i]! + tuning.windRate * tuning.intensity * speedK * (1 + 0.5 * dashK) * dt;
      const [u, v] = perpendicular(dir);
      const origin = this.follow[i]!.clone();
      while (this.windCarry[i]! >= 1) {
        this.windCarry[i] = this.windCarry[i]! - 1;
        const a = this.rng() * Math.PI * 2;
        const r = this.rand(0.2, 0.95);
        // Keep streaks above the floor: squash the lower half.
        const offset = u.clone().multiplyScalar(Math.cos(a) * r).addScaledVector(v, Math.max(-0.25, Math.sin(a) * r * 0.8));
        const head = this.follow[i]!;
        this.layer.add(
          wakeStreakFx({
            tex: tornStreak(),
            origin,
            follow: () => head,
            dir,
            offset,
            color: this.rng() < 0.5 ? WIND_WHITE : WIND_GREY,
            width: tuning.windWidthM * this.rand(0.5, 1.1),
            minLength: tuning.windLengthM * 0.6,
            overshoot: tuning.windLengthM * this.rand(0.5, 1),
            life: tuning.windLifeS * this.rand(0.85, 1.15),
            look: CEL_LOOK,
          }),
        );
      }
    }
  }

  /**
   * A Dash was released: jagged shock rings born in the middle of the Bey, facing the way it is being fired (toward the
   * target, not along its old orbit velocity) and flying backward, plus a fan of dust behind it.
   */
  dashStart(i: 0 | 1, b: FlowBey, tuning: Tuning, flags: WindFlags): void {
    if (!flags.crown) return;
    const len = Math.hypot(b.dashDirX, b.dashDirZ);
    const dir = len > 1e-6 ? new THREE.Vector3(b.dashDirX / len, 0, b.dashDirZ / len) : new THREE.Vector3(1, 0, 0);
    const back = dir.clone().negate();
    const floor = floorHeight(Math.hypot(b.x, b.z));
    // The simulation is ahead of the last rendered frame: place the rings from the Bey's own position.
    const head = this.follow[i]!.set(b.x, floor + BEY_MID_HEIGHT_M, b.z);
    const rings = Math.round(tuning.crownCount);
    for (let n = 0; n < rings; n++) {
      this.layer.add(
        jaggedRingFx({
          tex: jaggedRing(),
          follow: () => head,
          dir,
          color: WIND_WHITE,
          size: [0.6, tuning.crownSizeM * tuning.intensity * (1 - n * RING_SHRINK_PER_RING)],
          life: RING_LIFE_S,
          delay: n * RING_STAGGER_S,
          drift: 0.6 + n * 0.5,
          look: CEL_LOOK,
        }),
      );
    }
    this.dust.burst(new THREE.Vector3(b.x, floor, b.z), back, DASH_FAN_RAD, DASH_BURST, tuning.burstSizeM * tuning.intensity, BURST_LIFE_S);
  }

  /** A hit: the dust burst of the chosen composition (its crowns and clouds), flung outward from the contact point. */
  impact(x: number, z: number, m: number, tuning: Tuning, flags: WindFlags): void {
    if (!flags.crown) return;
    const y = floorHeight(Math.hypot(x, z));
    const n = Math.round(BURST_COUNT_MIN + (BURST_COUNT_MAX - BURST_COUNT_MIN) * m);
    this.dust.burst(new THREE.Vector3(x, y, z), null, 0, n, tuning.burstSizeM * (0.8 + 0.5 * m) * tuning.intensity, BURST_LIFE_S);
  }
}

function perpendicular(dir: THREE.Vector3): [THREE.Vector3, THREE.Vector3] {
  const up = Math.abs(dir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const u = new THREE.Vector3().crossVectors(dir, up).normalize();
  const v = new THREE.Vector3().crossVectors(u, dir).normalize();
  return [u, v];
}
