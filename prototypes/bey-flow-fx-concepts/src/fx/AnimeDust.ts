// ============================================================
// BEY FLOW FX LAB — ANIME DUST (three compositions of real volume)
// The dust is geometry now (see dustVolume.ts): piles of cel-shaded spheres
// and thin ellipsoids standing in the scene, not pictures laid over it. This
// file decides WHAT is spawned and WHERE:
//
//   wave   ONDA COM CAUDA: a billowing wave hugging the floor with swept tails that
//          run back toward the Bey; it streams behind the Bey along the Bey's
//          heading and rolls outward from an impact.
//   crown  COROA DE RESPINGO: a ring of puffs with spikes lying on the floor
//          (tilted to the funnel's slope), left behind the tip like a splash trail
//          and big at the Dash and the hit.
//   cloud  NUVEM DE EXPLOSÃO: heaps behind the Bey; a blast heap with needles at
//          the Dash and the hit.
//
// Directions follow the Bey's own heading (the way it is going, or being fired),
// like the shock rings, never an unrelated vector.
// Presentation only: it reads nothing but what it is handed.
// ============================================================

import * as THREE from 'three';
import { floorHeight, floorSlope } from '../sim/FlowSim';
import { DustVolume, type VolumeKind, type VolumeParams } from './dustVolume';

// ---------------- TUNING ----------------
const WAVE_HEIGHT_TRAIL = [1.3, 1.9] as const;   // × the dust size
const WAVE_HEIGHT_BURST = [0.65, 0.95] as const;   // × the burst size
const CLOUD_HEIGHT_TRAIL = [1.2, 1.8] as const;
const CLOUD_HEIGHT_BURST = [0.75, 1.1] as const;
const CROWN_TRAIL = 1.3;                         // × the dust size: ring radius of the splash trail
const CROWN_BURST = [1.1, 0.75, 1.5] as const;    // × the burst size: three stacked crowns
const TOWARD_CAMERA_DOT = 0;                     // a burst heading within 90° of the camera starts to shrink…
const TOWARD_CAMERA_FULL = 0.6;                  // …and is smallest straight at it
const TOWARD_CAMERA_MIN = 0.25;                  // × its size, so it never hides the fight
const WAVE_SPEED_TRAIL = [0.5, 1.5] as const;
const WAVE_SPEED_BURST = [2, 4] as const;
const CLOUD_SPEED_BURST = [1.5, 3.5] as const;
const SEED_RANGE = 1_000_000;
// -----------------------------------------

export type DustStyle = 'wave' | 'crown' | 'cloud';

export interface DustStyleInfo {
  readonly id: DustStyle;
  readonly label: string;
  readonly description: string;
}

export const DUST_STYLES: readonly DustStyleInfo[] = [
  { id: 'wave', label: 'Q · Onda com cauda', description: 'Uma onda de poeira em volume, rente ao chão, com caudas varridas, escorre atrás do Bey pela direção dele e rola para fora no impacto.' },
  { id: 'crown', label: 'W · Coroa de respingo', description: 'Pequenas coroas de espinhos em volume ficam no chão atrás da ponta, acompanhando a inclinação do funil; grandes no Dash e no golpe.' },
  { id: 'cloud', label: 'E · Nuvem de explosão', description: 'Montes de nuvem em volume atrás do Bey; no Dash e no golpe, um monte de explosão com agulhas.' },
];

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** The rotation about the vertical axis that turns a puff's +x onto the horizontal direction (dx, dz). */
export function yawToward(dx: number, dz: number): number {
  return Math.atan2(-dz, dx);
}

export class AnimeDust {
  style: DustStyle = 'wave';
  /** Emissions so far (a wave, a heap or a crown each count once). */
  emitted = 0;
  private readonly volume: DustVolume;

  constructor(
    scene: THREE.Object3D,
    private readonly camera: THREE.Camera,
    private readonly rng: () => number,
  ) {
    this.volume = new DustVolume(scene);
  }

  get puffCount(): number {
    return this.volume.puffCount;
  }

  get lumpCount(): number {
    return this.volume.lumpCount;
  }

  get mesh(): THREE.InstancedMesh {
    return this.volume.mesh;
  }

  update(dt: number, params: VolumeParams): void {
    this.volume.update(dt, params);
  }

  clear(): void {
    this.volume.clear();
  }

  dispose(): void {
    this.volume.dispose();
  }

  private rand(a: number, b: number): number {
    return a + this.rng() * (b - a);
  }

  private seed(): number {
    return Math.floor(this.rng() * SEED_RANGE);
  }

  private onFloor(p: THREE.Vector3): THREE.Vector3 {
    p.y = floorHeight(Math.hypot(p.x, p.z));
    return p;
  }

  /** 1 for a burst heading away from or across the camera, shrinking to TOWARD_CAMERA_MIN as it points straight at it: the dust must not hide the Beys. */
  private awayFromCamera(origin: THREE.Vector3, dir: THREE.Vector3): number {
    const cx = this.camera.position.x - origin.x;
    const cz = this.camera.position.z - origin.z;
    const len = Math.hypot(cx, cz) || 1;
    const dot = (dir.x * cx + dir.z * cz) / len;
    const t = Math.min(1, Math.max(0, (dot - TOWARD_CAMERA_DOT) / (TOWARD_CAMERA_FULL - TOWARD_CAMERA_DOT)));
    return lerp(1, TOWARD_CAMERA_MIN, t);
  }

  /** The tilt that lays a puff on the floor under `p` (the funnel is not flat). */
  private floorTilt(p: THREE.Vector3): THREE.Quaternion {
    const r = Math.hypot(p.x, p.z);
    const slope = floorSlope(r);
    const rx = r > 1e-6 ? p.x / r : 0;
    const rz = r > 1e-6 ? p.z / r : 0;
    const normal = new THREE.Vector3(-rx * slope, 1, -rz * slope).normalize();
    return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
  }

  private spawn(kind: VolumeKind, pos: THREE.Vector3, dir: THREE.Vector3, size: number, life: number, speed: number, flat = false): void {
    this.volume.spawn({
      kind,
      pos,
      yaw: yawToward(dir.x, dir.z),
      size,
      life,
      vel: dir.clone().multiplyScalar(speed),
      seed: this.seed(),
      tilt: flat ? this.floorTilt(pos) : undefined,
      rise: flat ? 0 : undefined,
      growFrom: flat ? 0.4 : undefined,
    });
  }

  /** One trail emission at `tip`: `back` is the unit horizontal direction behind the Bey's heading. */
  puff(tip: THREE.Vector3, back: THREE.Vector3, speedK: number, size: number, life: number): void {
    this.emitted++;
    const side = new THREE.Vector3(-back.z, 0, back.x);
    const grow = 0.7 + 0.5 * speedK;
    if (this.style === 'wave') {
      const start = this.onFloor(tip.clone().addScaledVector(side, this.rand(-0.3, 0.3)));
      const dir = back.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), this.rand(-0.1, 0.1));
      this.spawn('wave', start, dir, size * this.rand(WAVE_HEIGHT_TRAIL[0], WAVE_HEIGHT_TRAIL[1]) * grow, life, this.rand(WAVE_SPEED_TRAIL[0], WAVE_SPEED_TRAIL[1]));
    } else if (this.style === 'crown') {
      const start = this.onFloor(tip.clone().addScaledVector(back, this.rand(0, 0.4)));
      this.spawn('crown', start, back, size * CROWN_TRAIL * grow, life * 1.2, 0, true);
    } else {
      const start = this.onFloor(tip.clone().addScaledVector(back, this.rand(0.1, 0.6)).addScaledVector(side, this.rand(-0.4, 0.4)));
      this.spawn('puff', start, back, size * this.rand(CLOUD_HEIGHT_TRAIL[0], CLOUD_HEIGHT_TRAIL[1]) * grow, life, this.rand(0.8, 2));
    }
  }

  /**
   * A burst from `origin`: `baseDir` null = all around (a hit), otherwise a fan of half-width `spread` radians around
   * that unit horizontal direction (a Dash release fans behind the Bey).
   */
  burst(origin: THREE.Vector3, baseDir: THREE.Vector3 | null, spread: number, count: number, size: number, life: number): void {
    this.emitted++;
    const baseAngle = baseDir ? Math.atan2(baseDir.z, baseDir.x) : 0;
    const dirAt = (i: number, n: number): THREE.Vector3 => {
      const a = baseDir ? baseAngle + (n > 1 ? lerp(-spread, spread, i / (n - 1)) : 0) + this.rand(-0.08, 0.08) : (i / n) * Math.PI * 2 + this.rand(-0.2, 0.2);
      return new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    };
    const centre = this.onFloor(origin.clone());
    if (this.style === 'wave') {
      const n = Math.max(3, count);
      for (let i = 0; i < n; i++) {
        const dir = dirAt(i, n);
        const f = this.awayFromCamera(centre, dir);
        const at = this.onFloor(centre.clone().addScaledVector(dir, 0.3));
        this.spawn('wave', at, dir, size * this.rand(WAVE_HEIGHT_BURST[0], WAVE_HEIGHT_BURST[1]) * f, life * this.rand(0.85, 1.15), this.rand(WAVE_SPEED_BURST[0], WAVE_SPEED_BURST[1]) * f);
      }
    } else if (this.style === 'crown') {
      const facing = baseDir ?? new THREE.Vector3(1, 0, 0);
      CROWN_BURST.forEach((s, i) => this.spawn('crown', centre.clone(), facing, size * s, life * (1 + 0.1 * i), 0, true));
    } else {
      const n = Math.max(2, Math.round(count / 2));
      for (let i = 0; i < n; i++) {
        const dir = dirAt(i, n);
        const f = this.awayFromCamera(centre, dir);
        const at = this.onFloor(centre.clone().addScaledVector(dir, this.rand(0.5, 1.2)));
        this.spawn('burst', at, dir, size * this.rand(CLOUD_HEIGHT_BURST[0], CLOUD_HEIGHT_BURST[1]) * f, life * this.rand(0.85, 1.15), this.rand(CLOUD_SPEED_BURST[0], CLOUD_SPEED_BURST[1]) * f);
      }
    }
  }
}
