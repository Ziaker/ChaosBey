// ============================================================
// BEY FLOW FX LAB — ANIME DUST (three ideas)
// The owner asked for a dust that is "more anime, more epic" and wants to
// compare ideas, so the same emitter has three looks (texture, shape and
// animation all differ). Each fits both the trail behind the tip and the
// bursts of a Dash release and a hit.
//
//   roll     ROLO DE POEIRA: a lumpy dust wave that hugs the floor, stretched along
//            the path with a torn tail; it grows, boils a little and lifts.
//   bubbles  BOLHAS DESENHADAS: hand-drawn round puffs in small clusters that pop in
//            with squash and stretch and pop out one by one, animated "on twos" (12 fps).
//   shards   LASCAS EM LEQUE: white blades flung up and back in a fan that fall
//            on a ballistic arc (the floor crown of the reference sheets).
//
// Presentation only: it emits effects into a FxLayer (the game's own, from
// src/vfx/hybrid/fx); it never reads or writes the simulation.
// ============================================================

import * as THREE from 'three';
import type { FxItem, FxLayer } from '../../../../src/vfx/hybrid/fx/FxLayer';
import { floorHeight } from '../sim/FlowSim';
import { bubble, bubbleCluster, rollCloud, ROLL_VARIANTS, shard } from './animeTextures';

// ---------------- TUNING ----------------
// The texture is 2:1 and its lumps are round: keep the wave near 2:1 (length : height) or they stretch into leaves.
const ROLL_LENGTH_TRAIL = [2.6, 3.6] as const;   // × the dust size
const ROLL_LENGTH_BURST = [2.2, 3.2] as const;   // × the burst size
const ROLL_HEIGHT = [1.2, 1.6] as const;         // × the size
const ROLL_RISE_M = 0.25;
const ROLL_YAW_JITTER_RAD = 0.12;
const ROLL_BOIL_HZ = 3;
const ROLL_BOIL_AMOUNT = 0.07;
const BUBBLE_FPS = 12;                           // "on twos"
const BUBBLE_INFLATE = 0.22;                     // fraction of life to inflate
const BUBBLE_POP_AT = 0.65;
const BUBBLE_POP_SPAN = 0.12;
const BUBBLE_STAGGER = 0.05;
const BUBBLE_OVERSHOOT = 1.25;
const BUBBLE_DRIFT_MPS = 1.2;
const BUBBLE_RISE_MPS = 0.7;
const SHARDS_PER_PUFF = 3;
const SHARD_GRAVITY = 7;
const SHARD_LENGTH = [1.4, 2.4] as const;        // × the size
const SHARD_ASPECT = 0.42;                       // width / length
const SHARD_FLOOR_CLEARANCE_M = 0.05;
// -----------------------------------------

export type DustStyle = 'roll' | 'bubbles' | 'shards';

export interface DustStyleInfo {
  readonly id: DustStyle;
  readonly label: string;
  readonly description: string;
}

export const DUST_STYLES: readonly DustStyleInfo[] = [
  { id: 'roll', label: '1 · Rolo de poeira', description: 'Onda de poeira rente ao chão, esticada pelo caminho, com cauda rasgada. Cresce, ferve um pouco e sobe.' },
  { id: 'bubbles', label: '2 · Bolhas desenhadas', description: 'Bolhas de desenho à mão em cachos: inflam com esticar-e-achatar, estouram uma a uma, animadas "de dois em dois" quadros.' },
  { id: 'shards', label: '3 · Lascas em leque', description: 'Lâminas brancas lançadas para cima e para trás em leque; caem em arco. É a coroa das folhas de referência.' },
];

const ease = (k: number): number => 1 - Math.pow(1 - k, 3);
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** A rolling dust wave: head fixed where it was born, body stretched along `back`, standing on the floor. */
function rollFx(o: { tex: THREE.Texture; start: THREE.Vector3; back: THREE.Vector3; length: number; height: number; life: number }): FxItem {
  const mat = new THREE.MeshBasicMaterial({ map: o.tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  const holder = new THREE.Group();
  holder.add(mesh);
  const axis = o.back.clone().normalize();
  const phase = Math.random() * Math.PI * 2;
  return {
    object: holder,
    life: o.life,
    axisBillboard: axis,
    update(k) {
      const len = o.length * (0.35 + 0.65 * ease(Math.min(1, k * 3)));
      const hgt = o.height * (0.3 + 0.9 * ease(Math.min(1, k * 2.2))) * (1 + ROLL_BOIL_AMOUNT * Math.sin(phase + k * o.life * ROLL_BOIL_HZ * Math.PI * 2));
      holder.position.copy(o.start).addScaledVector(axis, len / 2);
      holder.position.y += ROLL_RISE_M * k;
      mesh.scale.set(len, hgt, 1);
      mesh.position.y = 0.24 * hgt; // the texture's flat base sits on the holder's height
      mat.opacity = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
    },
  };
}

/** A cluster of hand-drawn bubbles popping in and out "on twos". */
function bubblesFx(o: { tex: THREE.Texture; center: THREE.Vector3; back: THREE.Vector3; size: number; count: number; variant: number; life: number }): FxItem {
  const cluster = bubbleCluster(o.variant, o.count);
  const sprites = cluster.map(() => {
    const mat = new THREE.SpriteMaterial({ map: o.tex, transparent: true, depthWrite: false, fog: false });
    return new THREE.Sprite(mat);
  });
  const group = new THREE.Group();
  sprites.forEach((s) => group.add(s));
  const frame = 1 / (o.life * BUBBLE_FPS);
  return {
    object: group,
    life: o.life,
    update(k) {
      const kq = Math.floor(k / frame) * frame; // quantised time: the drawing changes at 12 fps
      const t = kq * o.life;
      cluster.forEach((b, i) => {
        const sprite = sprites[i]!;
        const born = i * BUBBLE_STAGGER;
        const popAt = BUBBLE_POP_AT + i * 0.05;
        const inflate = clamp01((kq - born) / BUBBLE_INFLATE);
        const pop = clamp01((kq - popAt) / BUBBLE_POP_SPAN);
        if (kq < born || pop >= 1) {
          sprite.visible = false;
          return;
        }
        sprite.visible = true;
        // Overshoot then settle; squashed wide at the start, stretched tall near the peak.
        const s = inflate < 0.6 ? lerp(0, BUBBLE_OVERSHOOT, inflate / 0.6) : lerp(BUBBLE_OVERSHOOT, 1, (inflate - 0.6) / 0.4);
        const sx = s * (1 + 0.18 * (1 - inflate)) * (1 - pop);
        const sy = s * (1 - 0.12 * (1 - inflate)) * (1 - pop);
        const d = o.size * b.r;
        sprite.scale.set(d * sx, d * sy, 1);
        sprite.position.set(
          o.center.x + b.x * o.size + o.back.x * BUBBLE_DRIFT_MPS * t,
          o.center.y + b.y * o.size + BUBBLE_RISE_MPS * t,
          o.center.z + b.x * o.size * 0.4 + o.back.z * BUBBLE_DRIFT_MPS * t,
        );
      });
    },
  };
}

/** One white blade on a ballistic arc, always lying along its direction of flight. */
function shardFx(o: { tex: THREE.Texture; pos: THREE.Vector3; vel: THREE.Vector3; length: number; life: number }): FxItem {
  const mat = new THREE.MeshBasicMaterial({ map: o.tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  const holder = new THREE.Group();
  holder.add(mesh);
  const pos = o.pos.clone();
  const vel = o.vel.clone();
  const axis = vel.clone().normalize();
  return {
    object: holder,
    life: o.life,
    axisBillboard: axis,
    update(k, dt) {
      vel.y -= SHARD_GRAVITY * dt;
      pos.addScaledVector(vel, dt);
      const floor = floorHeight(Math.hypot(pos.x, pos.z)) + SHARD_FLOOR_CLEARANCE_M;
      if (pos.y < floor) {
        pos.y = floor;
        vel.y = Math.abs(vel.y) * 0.25;
        vel.x *= 0.6;
        vel.z *= 0.6;
      }
      if (vel.lengthSq() > 0.04) axis.copy(vel).normalize();
      holder.position.copy(pos);
      const len = o.length * (0.4 + 0.6 * ease(Math.min(1, k * 6)));
      mesh.scale.set(len, len * SHARD_ASPECT, 1);
      mat.opacity = k < 0.65 ? 1 : 1 - (k - 0.65) / 0.35;
    },
  };
}

export class AnimeDust {
  style: DustStyle = 'roll';
  /** Emissions so far (a roll, a bubble cluster or a fan of shards each count once). */
  emitted = 0;

  constructor(
    private readonly layer: FxLayer,
    private readonly rng: () => number,
  ) {}

  private rand(a: number, b: number): number {
    return a + this.rng() * (b - a);
  }

  private onFloor(p: THREE.Vector3, lift: number): THREE.Vector3 {
    p.y = floorHeight(Math.hypot(p.x, p.z)) + lift;
    return p;
  }

  /** One trail emission at `tip`: `back` is the unit horizontal direction behind the motion. */
  puff(tip: THREE.Vector3, back: THREE.Vector3, speedK: number, size: number, life: number): void {
    this.emitted++;
    const side = new THREE.Vector3(-back.z, 0, back.x);
    if (this.style === 'roll') {
      const start = this.onFloor(tip.clone().addScaledVector(back, this.rand(0.1, 0.5)).addScaledVector(side, this.rand(-0.35, 0.35)), 0.02);
      const dir = back.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), this.rand(-ROLL_YAW_JITTER_RAD, ROLL_YAW_JITTER_RAD));
      this.layer.add(
        rollFx({
          tex: rollCloud(Math.floor(this.rng() * ROLL_VARIANTS)),
          start,
          back: dir,
          length: size * this.rand(ROLL_LENGTH_TRAIL[0], ROLL_LENGTH_TRAIL[1]) * (0.6 + 0.6 * speedK),
          height: size * this.rand(ROLL_HEIGHT[0], ROLL_HEIGHT[1]),
          life,
        }),
      );
    } else if (this.style === 'bubbles') {
      const center = this.onFloor(tip.clone().addScaledVector(back, this.rand(0.2, 0.8)).addScaledVector(side, this.rand(-0.4, 0.4)), size * 0.5);
      this.layer.add(bubblesFx({ tex: bubble(), center, back, size: size * this.rand(0.9, 1.3), count: 3 + Math.floor(this.rng() * 2), variant: Math.floor(this.rng() * 3), life }));
    } else {
      for (let i = 0; i < SHARDS_PER_PUFF; i++) {
        const vel = back.clone().multiplyScalar(this.rand(2, 5)).addScaledVector(side, this.rand(-1.4, 1.4));
        vel.y = this.rand(1.2, 2.6);
        this.layer.add(shardFx({ tex: shard(), pos: this.onFloor(tip.clone(), 0.15), vel, length: size * this.rand(SHARD_LENGTH[0], SHARD_LENGTH[1]), life }));
      }
    }
  }

  /**
   * A burst from `origin`: `baseDir` null = all around (a hit), otherwise a fan of half-width `spread` radians around
   * that unit horizontal direction (a Dash release fans behind the Bey).
   */
  burst(origin: THREE.Vector3, baseDir: THREE.Vector3 | null, spread: number, count: number, size: number, life: number): void {
    const baseAngle = baseDir ? Math.atan2(baseDir.z, baseDir.x) : 0;
    const angleAt = (i: number): number => (baseDir ? baseAngle + this.rand(-spread, spread) : (i / count) * Math.PI * 2 + this.rand(-0.25, 0.25));
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < count; i++) {
      this.emitted++;
      const a = angleAt(i);
      const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      if (this.style === 'roll') {
        const start = this.onFloor(origin.clone().addScaledVector(dir, 0.3), 0.02);
        this.layer.add(
          rollFx({
            tex: rollCloud(Math.floor(this.rng() * ROLL_VARIANTS)),
            start,
            back: dir,
            length: size * this.rand(ROLL_LENGTH_BURST[0], ROLL_LENGTH_BURST[1]),
            height: size * this.rand(ROLL_HEIGHT[0], ROLL_HEIGHT[1]),
            life: life * this.rand(0.85, 1.15),
          }),
        );
      } else if (this.style === 'bubbles') {
        if (i % 2 === 1) continue; // a cluster is several bubbles: half as many emissions
        const center = this.onFloor(origin.clone().addScaledVector(dir, this.rand(0.3, 1.2)), size * 0.5);
        this.layer.add(bubblesFx({ tex: bubble(), center, back: dir, size: size * this.rand(1, 1.5), count: 4, variant: Math.floor(this.rng() * 3), life: life * this.rand(0.85, 1.15) }));
      } else {
        const vel = dir.clone().multiplyScalar(this.rand(3, 7));
        vel.addScaledVector(up, this.rand(2.4, 4.4));
        this.layer.add(shardFx({ tex: shard(), pos: this.onFloor(origin.clone().addScaledVector(dir, 0.3), 0.2), vel, length: size * this.rand(SHARD_LENGTH[0] + 0.2, SHARD_LENGTH[1] + 0.6), life: life * this.rand(0.85, 1.15) }));
      }
    }
  }
}
