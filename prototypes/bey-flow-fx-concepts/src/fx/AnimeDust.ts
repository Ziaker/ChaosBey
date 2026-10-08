// ============================================================
// BEY FLOW FX LAB — ANIME DUST (three compositions, one drawing language)
// The first two rounds drew the dust as stickers: circle clusters with a dark
// outline, opaque, popping in and out over an invented floor. This round it is
// built the way the owner's reference sheets are drawn (see fx/dustArt.ts) and
// it sits in the scene instead of on it:
//
//   * flat white cutouts with one soft grey tone, no outline;
//   * they DISSOLVE by erosion (an alpha test that creeps up eats the shape from
//     the edge, thin tails and spikes first), they are opaque cutouts so the Beys
//     and the arena occlude them correctly, and they take the arena's fog and tint;
//   * they stand on the real floor: upright cutouts face the camera around the
//     vertical axis only, the crown lies on the floor following its slope.
//
// Three compositions use that same art (Q, W, E in the lab):
//   wave   ONDA COM CAUDA: dust waves with a swept tail stream behind the Bey
//          (and roll outward from an impact); a crown at the big moments.
//   crown  COROA DE RESPINGO: small ground crowns are left behind the tip like a
//          splash trail; big ones at the Dash and the hit.
//   cloud  NUVEM DE EXPLOSÃO: scalloped puffs behind the Bey; a blast cloud with
//          needles at the Dash and the hit.
//
// Presentation only: it emits effects into the game's own FxLayer and never reads
// or writes the simulation.
// ============================================================

import * as THREE from 'three';
import type { FxItem, FxLayer } from '../../../../src/vfx/hybrid/fx/FxLayer';
import { floorHeight, floorSlope } from '../sim/FlowSim';
import { dustTexture } from './animeTextures';
import { DUST_SIZES, DUST_VARIANTS, type DustKind } from './dustArt';

// ---------------- TUNING ----------------
const ERODE_START = 0.3;          // fraction of life the shape stays whole before it starts to erode
const ERODE_FROM = 0.03;          // alpha-test threshold at the start of the erosion (never 0: the test stays compiled in)
const ERODE_TO = 0.98;
const ERODE_POWER = 1.6;
const GROW_FROM = 0.55;           // upright cutouts start this fraction of their size
const GROW_TIME = 0.32;           // fraction of life to reach full size
const WAVE_STRETCH = [1.0, 1.5] as const;
const WAVE_FAN_RAD = 0.7;
const CROWN_GROW_FROM = 0.35;
const CROWN_GROW_TIME = 0.25;
const CROWN_LIFT_M = 0.04;
const CROWN_TRAIL_SIZE = 2.2;     // × the dust size: the small crown of the splash trail
const DRAG_PER_S = 1.5;
const RISE_MPS = 0.35;
const BURST_BIG = 1.2;            // × the burst size: a blast cloud
const TOWARD_CAMERA_DOT = 0.2;    // a burst heading within ~78° of the camera starts to shrink…
const TOWARD_CAMERA_FULL = 0.8;   // …and is smallest straight at it
const TOWARD_CAMERA_MIN = 0.4;    // × its size, so it never hides the fight
const WAVE_MIN_AWAY = 0.75;       // a wave lying along the line of sight looks like a tube: below this it becomes an upright puff
// -----------------------------------------

export type DustStyle = 'wave' | 'crown' | 'cloud';

export interface DustStyleInfo {
  readonly id: DustStyle;
  readonly label: string;
  readonly description: string;
}

export const DUST_STYLES: readonly DustStyleInfo[] = [
  { id: 'wave', label: 'Q · Onda com cauda', description: 'Ondas de poeira com cauda varrida escorrem atrás do Bey e rolam para fora no impacto. Folhas 1 e 2.' },
  { id: 'crown', label: 'W · Coroa de respingo', description: 'Pequenas coroas de espinhos ficam no chão atrás da ponta, como um rastro de respingo; grandes no Dash e no golpe. Folhas 1 e 3.' },
  { id: 'cloud', label: 'E · Nuvem de explosão', description: 'Nuvens recortadas em gomos atrás do Bey; no Dash e no golpe, uma nuvem de explosão com agulhas. Folha 1.' },
];

const ease = (k: number): number => 1 - Math.pow(1 - k, 3);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Alpha-test threshold for a life fraction: 0.03 while whole, then creeping to the top so the shape erodes away. */
export function erosionThreshold(k: number): number {
  if (k <= ERODE_START) return ERODE_FROM;
  const t = Math.min(1, (k - ERODE_START) / (1 - ERODE_START));
  return lerp(ERODE_FROM, ERODE_TO, Math.pow(t, ERODE_POWER));
}

function cutoutMaterial(tex: THREE.Texture, tint: THREE.Color): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ map: tex, color: tint, side: THREE.DoubleSide, alphaTest: ERODE_FROM, alphaToCoverage: true });
}

interface Standing {
  tex: THREE.Texture;
  tint: THREE.Color;
  /** Where the base of the cutout stands. */
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  /** Height in metres (the width follows the texture's aspect). */
  height: number;
  life: number;
  camera: THREE.Camera;
  kind: DustKind;
  /** Wave only: the unit direction the tail points to along the floor, and the length stretch. */
  axis?: THREE.Vector3;
  stretch?: number;
}

/** An upright cutout: it faces the camera around the vertical axis (a wave lies along its axis instead) and erodes away. */
function standingFx(o: Standing): FxItem {
  const mat = cutoutMaterial(o.tex, o.tint);
  const geo = new THREE.PlaneGeometry(1, 1);
  const mesh = new THREE.Mesh(geo, mat);
  const holder = new THREE.Group();
  holder.add(mesh);
  const size = DUST_SIZES[o.kind];
  const aspect = size.w / size.h;
  const pos = o.pos.clone();
  const vel = o.vel.clone();
  const item: FxItem = {
    object: holder,
    life: o.life,
    update(k, dt) {
      vel.multiplyScalar(Math.max(0, 1 - DRAG_PER_S * dt));
      pos.addScaledVector(vel, dt);
      pos.y += RISE_MPS * dt;
      const grow = lerp(GROW_FROM, 1, ease(Math.min(1, k / GROW_TIME)));
      const h = o.height * grow;
      const w = h * aspect * (o.stretch ?? 1);
      holder.position.copy(pos);
      if (!o.axis) {
        // Face the camera around the vertical axis only, so the cutout stands on the floor.
        const cam = o.camera.position;
        holder.rotation.y = Math.atan2(cam.x - pos.x, cam.z - pos.z);
        mesh.scale.set(w, h, 1);
        mesh.position.y = h * 0.5 - h * 0.04;
      } else {
        // A wave: the texture's tail (left) points along -axis, so the plane's +x runs along the axis; face the camera around it.
        mesh.scale.set(w, h, 1);
        mesh.position.set(w * 0.5, h * 0.34, 0);
      }
      mat.alphaTest = erosionThreshold(k);
    },
  };
  if (o.axis) {
    // FxLayer turns the holder so its +x lies on the axis and its plane faces the camera.
    (item as { axisBillboard?: THREE.Vector3 }).axisBillboard = o.axis.clone().normalize();
  }
  return item;
}

interface Crown {
  tex: THREE.Texture;
  tint: THREE.Color;
  center: THREE.Vector3;
  size: number;
  life: number;
  delay: number;
  spin: number;
}

/** A crown lying on the floor, tilted to the floor's slope, growing fast and then eroding. */
function crownFx(o: Crown): FxItem {
  const mat = cutoutMaterial(o.tex, o.tint);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), mat);
  const holder = new THREE.Group();
  holder.add(mesh);
  const r = Math.hypot(o.center.x, o.center.z);
  const slope = floorSlope(r);
  const rx = r > 1e-6 ? o.center.x / r : 0;
  const rz = r > 1e-6 ? o.center.z / r : 0;
  const normal = new THREE.Vector3(-rx * slope, 1, -rz * slope).normalize();
  holder.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
  holder.position.copy(o.center);
  holder.position.y = floorHeight(r) + CROWN_LIFT_M;
  mesh.rotation.y = o.spin;
  const total = o.delay + o.life;
  return {
    object: holder,
    life: total,
    update(k) {
      const t = k * total;
      if (t < o.delay) {
        holder.visible = false;
        return;
      }
      holder.visible = true;
      const kk = (t - o.delay) / o.life;
      const s = o.size * lerp(CROWN_GROW_FROM, 1, ease(Math.min(1, kk / CROWN_GROW_TIME)));
      mesh.scale.set(s, 1, s);
      mat.alphaTest = erosionThreshold(kk);
    },
  };
}

export class AnimeDust {
  style: DustStyle = 'wave';
  /** Emissions so far (a wave, a cloud or a crown each count once). */
  emitted = 0;
  /** Multiplies the cutouts' colour: the arena's light, so white is not the same white in every arena. */
  readonly tint = new THREE.Color(1, 1, 1);

  constructor(
    private readonly layer: FxLayer,
    private readonly camera: THREE.Camera,
    private readonly rng: () => number,
  ) {}

  private rand(a: number, b: number): number {
    return a + this.rng() * (b - a);
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

  private variant(): number {
    return Math.floor(this.rng() * DUST_VARIANTS);
  }

  private onFloor(p: THREE.Vector3, lift: number): THREE.Vector3 {
    p.y = floorHeight(Math.hypot(p.x, p.z)) + lift;
    return p;
  }

  private wave(start: THREE.Vector3, dir: THREE.Vector3, height: number, life: number, speed: number): void {
    this.layer.add(
      standingFx({
        tex: dustTexture('wave', this.variant()),
        tint: this.tint,
        pos: this.onFloor(start, 0.02),
        vel: dir.clone().multiplyScalar(speed),
        height,
        life,
        camera: this.camera,
        kind: 'wave',
        axis: dir,
        stretch: this.rand(WAVE_STRETCH[0], WAVE_STRETCH[1]),
      }),
    );
  }

  private cloud(kind: 'puff' | 'burst', start: THREE.Vector3, vel: THREE.Vector3, height: number, life: number): void {
    this.layer.add(
      standingFx({ tex: dustTexture(kind, this.variant()), tint: this.tint, pos: start, vel, height, life, camera: this.camera, kind }),
    );
  }

  private crown(center: THREE.Vector3, size: number, life: number, delay = 0): void {
    this.layer.add(crownFx({ tex: dustTexture('crown', this.variant()), tint: this.tint, center, size, life, delay, spin: this.rng() * Math.PI * 2 }));
  }

  /** One trail emission at `tip`: `back` is the unit horizontal direction behind the motion. */
  puff(tip: THREE.Vector3, back: THREE.Vector3, speedK: number, size: number, life: number): void {
    this.emitted++;
    const side = new THREE.Vector3(-back.z, 0, back.x);
    if (this.style === 'wave') {
      const start = tip.clone().addScaledVector(side, this.rand(-0.3, 0.3));
      const dir = back.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), this.rand(-0.1, 0.1));
      const height = size * this.rand(1.3, 1.9) * (0.7 + 0.5 * speedK);
      if (this.awayFromCamera(tip, dir) < WAVE_MIN_AWAY) {
        // Running toward or away from the camera: a wave along the line of sight would be a tube, so an upright puff takes its place.
        this.cloud('puff', this.onFloor(start, 0), dir.clone().multiplyScalar(this.rand(0.5, 1.5)), height, life);
      } else {
        this.wave(start, dir, height, life, this.rand(0.5, 1.5));
      }
    } else if (this.style === 'crown') {
      this.crown(this.onFloor(tip.clone().addScaledVector(back, this.rand(0, 0.4)), 0), size * CROWN_TRAIL_SIZE * (0.7 + 0.5 * speedK), life * 1.2);
    } else {
      const start = this.onFloor(tip.clone().addScaledVector(back, this.rand(0.1, 0.6)).addScaledVector(side, this.rand(-0.4, 0.4)), 0);
      this.cloud('puff', start, back.clone().multiplyScalar(this.rand(0.8, 2)).addScaledVector(side, this.rand(-0.5, 0.5)), size * this.rand(1.5, 2.2) * (0.7 + 0.5 * speedK), life);
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
    const centre = this.onFloor(origin.clone(), 0);
    if (this.style === 'wave') {
      const n = Math.max(3, count);
      for (let i = 0; i < n; i++) {
        const dir = dirAt(i, n);
        const f = this.awayFromCamera(centre, dir);
        const height = size * this.rand(0.8, 1.2) * f;
        const at = centre.clone().addScaledVector(dir, 0.3);
        if (f < WAVE_MIN_AWAY) this.cloud('puff', this.onFloor(at, 0), dir.clone().multiplyScalar(this.rand(1, 2)), height * 1.4, life * this.rand(0.85, 1.15));
        else this.wave(at, dir, height, life * this.rand(0.85, 1.15), this.rand(2, 4));
      }
      this.crown(centre, size * 2.6, life * 0.9);
    } else if (this.style === 'crown') {
      this.crown(centre, size * 2.6, life);
      this.crown(centre, size * 1.8, life * 0.85, 0.06);
      this.crown(centre, size * 3.4, life * 1.1, 0.12);
    } else {
      const n = Math.max(2, Math.round(count / 2));
      for (let i = 0; i < n; i++) {
        const dir = dirAt(i, n);
        const f = this.awayFromCamera(centre, dir);
        const start = this.onFloor(centre.clone().addScaledVector(dir, this.rand(0.5, 1.2)), 0);
        this.cloud('burst', start, dir.clone().multiplyScalar(this.rand(1.5, 3.5)), size * this.rand(BURST_BIG * 0.7, BURST_BIG) * f, life * this.rand(0.85, 1.15));
      }
      this.crown(centre, size * 2.4, life * 0.8);
    }
  }
}
