// ============================================================
// BEY FLOW FX LAB — ANIME WIND AND DUST
// The continuous "epic" layer the owner asked for:
//   * anime dust in real volume behind the tip (three compositions, see AnimeDust);
//   * torn wind streaks streaming behind the Bey;
//   * on a Dash release AND on the contact of a hit: jagged shock rings born in the
//     middle of the Bey (or of the contact), facing the way the attack goes and
//     flying backward; at the contact also the floor crowns and the flat star;
//   * and a dust burst with both.
// The rings, crowns, star and streaks are the approved Cel Cyclone pieces
// (src/vfx/hybrid/fx); the dust is the lab's own (AnimeDust).
//
// Every direction here is the Bey's own heading (the way it moves, or the way it
// is being fired) or the direction of the attack: never an unrelated vector.
//
// Presentation only: it reads a FlowBey and emits effects into an FxLayer.
// ============================================================

import * as THREE from 'three';
import { burstFx, flatFx, jaggedRingFx, wakeStreakFx, type WindLook } from '../../../../src/vfx/hybrid/fx/primitives';
import type { FxLayer } from '../../../../src/vfx/hybrid/fx/FxLayer';
import { impactStar, jaggedRing, tornStreak } from '../../../../src/vfx/hybrid/fx/textures';
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
const CROWN_LIFE_S = 0.55;
const CROWN_LIFT_M = 0.05;
const CROWN_COUNT = 2;
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

function perpendicular(dir: THREE.Vector3): [THREE.Vector3, THREE.Vector3] {
  const up = Math.abs(dir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const u = new THREE.Vector3().crossVectors(dir, up).normalize();
  const v = new THREE.Vector3().crossVectors(u, dir).normalize();
  return [u, v];
}

/** A unit horizontal vector from (x, z), or +x when it is (almost) zero. */
function unit(x: number, z: number): THREE.Vector3 {
  const len = Math.hypot(x, z);
  return len > 1e-6 ? new THREE.Vector3(x / len, 0, z / len) : new THREE.Vector3(1, 0, 0);
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
    scene: THREE.Object3D,
    seed = 7,
  ) {
    this.rng = makeRng(seed);
    this.dust = new AnimeDust(scene, camera, this.rng);
  }

  /** The dust composition in use (wave, crown or cloud). */
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

  /** Dust puffs alive and the lumps (instances) they draw. */
  get dustPuffs(): number {
    return this.dust.puffCount;
  }

  get dustLumps(): number {
    return this.dust.lumpCount;
  }

  /** The instanced mesh the dust is drawn with (for the tests). */
  get dustMesh(): THREE.InstancedMesh {
    return this.dust.mesh;
  }

  /** Ages the dust one frame, with the opacity, fade and shrink the tuning asks for. */
  update(dt: number, tuning: Tuning): void {
    this.dust.update(dt, { opacity: tuning.dustOpacity, fade: tuning.dustFade, shrink: tuning.dustShrink });
  }

  clear(): void {
    this.dust.clear();
  }

  dispose(): void {
    this.dust.dispose();
  }

  private rand(a: number, b: number): number {
    return a + this.rng() * (b - a);
  }

  /** Per rendered frame, per Bey: dust and wind streaks in proportion to the speed. `tip` is the contact point. */
  trail(i: 0 | 1, b: FlowBey, tip: THREE.Vector3, dt: number, tuning: Tuning, flags: WindFlags): void {
    this.follow[i]!.set(tip.x, tip.y + BEY_MID_HEIGHT_M, tip.z);
    if (b.speed < TRAIL_MIN_SPEED_MPS || dt <= 0) return;
    const speedK = smoothstep(TRAIL_MIN_SPEED_MPS, TRAIL_FULL_SPEED_MPS, b.speed);
    const dashK = b.dashing ? tuning.dustDashBoost : 0;
    // The Bey's own heading (its Dash direction while it dashes), not the velocity that lags behind it.
    const dir = unit(b.headX, b.headZ);
    const back = dir.clone().negate();

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
   * Jagged shock rings born at `origin` (already at the height of the middle of the body), facing `dir` (the way the attack
   * goes) and flying backward along it.
   */
  private shockRings(origin: THREE.Vector3, dir: THREE.Vector3, tuning: Tuning): void {
    const rings = Math.round(tuning.crownCount);
    for (let n = 0; n < rings; n++) {
      this.layer.add(
        jaggedRingFx({
          tex: jaggedRing(),
          follow: () => origin,
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
  }

  /**
   * A Dash was released: the shock rings born in the middle of the Bey, facing the way it is being fired (toward the
   * target) and flying backward, plus a fan of dust behind it.
   */
  dashStart(i: 0 | 1, b: FlowBey, tuning: Tuning, flags: WindFlags): void {
    if (!flags.crown) return;
    const dir = unit(b.dashDirX, b.dashDirZ);
    const floor = floorHeight(Math.hypot(b.x, b.z));
    // The simulation is ahead of the last rendered frame: place the rings from the Bey's own position.
    const head = this.follow[i]!.set(b.x, floor + BEY_MID_HEIGHT_M, b.z);
    this.shockRings(head.clone(), dir, tuning);
    this.dust.burst(new THREE.Vector3(b.x, floor, b.z), dir.clone().negate(), DASH_FAN_RAD, DASH_BURST, tuning.burstSizeM * tuning.intensity, BURST_LIFE_S);
  }

  /**
   * A hit, at the contact of the two Beys: the shock rings born at the contact and facing the attack, the crowns on the
   * floor and the flat star (the approved impact), plus the dust burst of the chosen composition.
   */
  impact(x: number, z: number, m: number, dirX: number, dirZ: number, tuning: Tuning, flags: WindFlags): void {
    if (!flags.crown) return;
    const y = floorHeight(Math.hypot(x, z));
    const dir = unit(dirX, dirZ);
    this.shockRings(new THREE.Vector3(x, y + BEY_MID_HEIGHT_M, z), dir, tuning);
    const size = tuning.crownSizeM * tuning.intensity * (0.7 + 0.6 * m);
    for (let n = 0; n < CROWN_COUNT; n++) {
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
    this.layer.add(
      burstFx({
        tex: impactStar(STAR_SPIKES),
        color: 0xffffff,
        pos: new THREE.Vector3(x, y + STAR_HEIGHT_M, z),
        size: [1, tuning.burstSizeM * 0.9 * (0.8 + 0.5 * m)],
        life: STAR_LIFE_S,
        rotation: this.rng() * Math.PI,
        additive: false,
      }),
    );
    const n = Math.round(BURST_COUNT_MIN + (BURST_COUNT_MAX - BURST_COUNT_MIN) * m);
    this.dust.burst(new THREE.Vector3(x, y, z), null, 0, n, tuning.burstSizeM * (0.8 + 0.5 * m) * tuning.intensity, BURST_LIFE_S);
  }
}
