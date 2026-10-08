// ============================================================
// BEY FLOW FX LAB — ANIME WIND AND DUST
// The continuous "epic" layer the owner asked for: cartoon clouds rolling
// out behind the tip, torn wind streaks streaming behind the Bey, and, on a
// Dash release or a hit, jagged shock rings, a floor crown and a cloud burst.
// All of it is built from the approved Cel Cyclone pieces (src/vfx/hybrid/fx:
// spriteFx, wakeStreakFx, jaggedRingFx, flatFx, burstFx and their textures)
// plus the lab's own cartoon cloud, so it lives in the same cel look.
//
// Presentation only: it reads a FlowBey and emits effects into an FxLayer.
// ============================================================

import * as THREE from 'three';
import { burstFx, flatFx, jaggedRingFx, spriteFx, wakeStreakFx, type WindLook } from '../../../../src/vfx/hybrid/fx/primitives';
import type { FxLayer } from '../../../../src/vfx/hybrid/fx/FxLayer';
import { impactStar, jaggedRing, tornStreak } from '../../../../src/vfx/hybrid/fx/textures';
import { floorHeight, type FlowBey } from '../sim/FlowSim';
import type { Tuning } from '../tuning';
import { CLOUD_VARIANTS, toonCloud } from './animeTextures';

// ---------------- TUNING ----------------
const TRAIL_MIN_SPEED_MPS = 2;
const TRAIL_FULL_SPEED_MPS = 10;
const WIND_WHITE = 0xffffff;
const WIND_GREY = 0xaab6c8;
const CEL_LOOK: WindLook = { cel: true, opacity: 1 };
const RING_STAGGER_S = 0.05;
const RING_LIFE_S = 0.42;
const RING_SHRINK_PER_RING = 0.18;
const CROWN_LIFE_S = 0.55;
const CROWN_LIFT_M = 0.05;
const DASH_CLOUDS = 6;
const BURST_CLOUDS_MIN = 6;
const BURST_CLOUDS_MAX = 12;
const STAR_LIFE_S = 0.25;
const STAR_HEIGHT_M = 1;
const STAR_SPIKES = 10;
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

/** Small deterministic generator so a replayed lab shows the same clouds (mulberry32). */
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
  private cloudCount = 0;

  constructor(
    private readonly layer: FxLayer,
    seed = 7,
  ) {
    this.rng = makeRng(seed);
  }

  /** Clouds and streaks emitted so far (observability for the stats line and the tests). */
  get emittedClouds(): number {
    return this.cloudCount;
  }

  private rand(a: number, b: number): number {
    return a + this.rng() * (b - a);
  }

  private cloud(p: THREE.Vector3, vel: THREE.Vector3, size: [number, number], life: number): void {
    this.cloudCount++;
    this.layer.add(
      spriteFx({
        tex: toonCloud(Math.floor(this.rng() * CLOUD_VARIANTS)),
        color: 0xffffff,
        additive: false,
        opacity: 1,
        pos: p,
        vel,
        drag: 1.6,
        size,
        life,
        fadeIn: 0.06,
      }),
    );
  }

  /** Per rendered frame, per Bey: dust clouds and wind streaks in proportion to the speed. `tip` is the contact point. */
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
        const p = tip.clone().addScaledVector(back, this.rand(0.1, 0.9));
        p.addScaledVector(side, this.rand(-0.5, 0.5));
        p.y = floorHeight(Math.hypot(p.x, p.z)) + this.rand(0.15, 0.4);
        const vel = back
          .clone()
          .multiplyScalar(b.speed * 0.18)
          .addScaledVector(side, this.rand(-1.2, 1.2))
          .setY(this.rand(0.3, 0.8));
        const grow = tuning.dustSizeM * this.rand(0.7, 1.2) * (0.6 + 0.5 * speedK + 0.15 * dashK);
        this.cloud(p, vel, [grow * 0.3, grow], tuning.dustLifeS * this.rand(0.8, 1.15));
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

  /** A Dash was released: jagged shock rings behind the Bey and a puff of clouds. */
  dashStart(i: 0 | 1, b: FlowBey, tip: THREE.Vector3, tuning: Tuning, flags: WindFlags): void {
    if (!flags.crown || b.speed < 0.5) return;
    const dir = new THREE.Vector3(b.vx / b.speed, 0, b.vz / b.speed);
    const back = dir.clone().negate();
    const head = this.follow[i]!;
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
          groundAt: (p) => floorHeight(Math.hypot(p.x, p.z)),
        }),
      );
    }
    for (let n = 0; n < DASH_CLOUDS; n++) {
      const p = tip.clone().addScaledVector(back, this.rand(0.3, 2));
      p.y = floorHeight(Math.hypot(p.x, p.z)) + this.rand(0.2, 0.5);
      const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(this.rand(-1.5, 1.5));
      const grow = tuning.burstSizeM * this.rand(0.5, 0.9);
      this.cloud(p, back.clone().multiplyScalar(this.rand(0.8, 2)).add(side).setY(this.rand(0.2, 0.6)), [0.6, grow], this.rand(0.8, 1.2));
    }
  }

  /** A hit: a jagged crown on the floor, a cloud burst flung outward and a flat impact star. */
  impact(x: number, z: number, m: number, tuning: Tuning, flags: WindFlags): void {
    if (!flags.crown) return;
    const y = floorHeight(Math.hypot(x, z));
    const size = tuning.crownSizeM * tuning.intensity * (0.7 + 0.6 * m);
    for (let n = 0; n < 2; n++) {
      this.layer.add(
        flatFx({
          tex: jaggedRing(),
          color: WIND_WHITE,
          pos: new THREE.Vector3(x, y + CROWN_LIFT_M, z),
          size: [0.8, size * (1 - n * 0.3)],
          life: CROWN_LIFE_S * (1 - n * 0.2),
          opacity: 1,
          additive: false,
          rotation: this.rng() * Math.PI,
          conform: { floorHeightAt: (r) => floorHeight(r), lift: CROWN_LIFT_M },
        }),
      );
    }
    const n = Math.round(BURST_CLOUDS_MIN + (BURST_CLOUDS_MAX - BURST_CLOUDS_MIN) * m);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + this.rand(-0.25, 0.25);
      const speed = this.rand(2, 5) * (0.6 + 0.6 * m);
      const p = new THREE.Vector3(x + Math.cos(a) * 0.3, y + this.rand(0.3, 0.8), z + Math.sin(a) * 0.3);
      const vel = new THREE.Vector3(Math.cos(a) * speed, this.rand(0.4, 1.2), Math.sin(a) * speed);
      this.cloud(p, vel, [0.7, tuning.burstSizeM * this.rand(0.6, 1)], this.rand(0.75, 1.1));
    }
    this.layer.add(
      burstFx({
        tex: impactStar(STAR_SPIKES),
        color: 0xffffff,
        pos: new THREE.Vector3(x, y + STAR_HEIGHT_M, z),
        size: [1, tuning.burstSizeM * 0.9],
        life: STAR_LIFE_S,
        rotation: this.rng() * Math.PI,
        additive: false,
      }),
    );
  }
}

function perpendicular(dir: THREE.Vector3): [THREE.Vector3, THREE.Vector3] {
  const up = Math.abs(dir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const u = new THREE.Vector3().crossVectors(dir, up).normalize();
  const v = new THREE.Vector3().crossVectors(u, dir).normalize();
  return [u, v];
}
