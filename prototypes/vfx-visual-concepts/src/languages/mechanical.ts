// ============================================================
// LANGUAGE A — MECHANICAL / PHYSICAL
// Everything reads as real material reacting: hot metal sparks that fall
// and bounce, metal chips, dust, scuff marks left on the floor, short
// camera shake and short hitstop. Color comes from the arena's spark
// palette, never from "energy".
// ============================================================

import * as THREE from 'three';
import { debrisFx, flatFx, ghostFx, spriteFx } from '../fx/primitives';
import { scuffMark, smokePuff, softDot } from '../fx/textures';
import type { FxContext, LanguageRuntime, VfxLanguage } from './types';

// ---------------- TUNING ----------------
const DUST_COLOR = 0x8c877e;          // Dust/smoke tint.
const CHIP_COLOR = 0x9aa0a8;          // Metal chip color.
const HIT_SPARKS = [40, 160] as const; // Spark count at m = 0 / m = 1.
const HIT_SHAKE = [0.03, 0.14] as const; // Shake amplitude (m) at m = 0 / 1.
const HIT_STOP = [0.015, 0.06] as const; // Hitstop seconds at m = 0 / 1.
const DECAL_LIFE = 5;                 // Seconds scuff marks stay on the floor.
// -----------------------------------------

const lerp = (r: readonly [number, number], m: number): number => r[0] + (r[1] - r[0]) * m;
const rand = (a: number, b: number): number => a + Math.random() * (b - a);

export const MECHANICAL: VfxLanguage = {
  id: 'A',
  name: 'Mechanical',
  summary: 'Physical and grounded: metal sparks with gravity, chips, dust, floor scuffs, short shake/hitstop.',
  notes: {
    hit: 'Tangential spark shower + metal chips + dust puff + scuff decal. Short hitstop.',
    dash: 'Tip grinds sparks and dust while charging; dust burst and skid marks on release.',
    circular: 'Ring of kicked-up dust and spinning sparks; circular scuff on the floor.',
    dodge: 'Short slow motion, grey motion ghosts, dust kick.',
    break: 'Bolts and chips fly off, smoke wisps, wobbling tip grinds sparks.',
    landing: 'Dust ring pushed outward, pebbles, impact scuff. Shake only.',
    scrape: 'Grinder-style spark stream along the wall + scuffs.',
    ringout: 'Heavy spark/debris burst at the wall crest, dust cloud.',
    burst: 'Dust kicked up behind the Bey (no stylized wind).',
  },
  create(ctx: FxContext): LanguageRuntime {
    const [hot, cool] = ctx.arenaSparks;
    let skidTimer = 0;
    let ghostTimer = 0;
    let dustTimer = 0;
    const floorY = (p: THREE.Vector3): number => ctx.floorHeightAt(Math.hypot(p.x, p.z));

    const dust = (at: THREE.Vector3, n: number, spread: number, size: number, life = 1.2): void => {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        ctx.layer.add(spriteFx({
          tex: smokePuff(), color: DUST_COLOR, additive: false, opacity: 0.55,
          pos: at.clone().add(new THREE.Vector3(Math.cos(a) * 0.2, 0.1, Math.sin(a) * 0.2)),
          vel: new THREE.Vector3(Math.cos(a) * spread, rand(0.2, 0.8), Math.sin(a) * spread),
          drag: 2.5, size: [size * 0.4, size * rand(1.2, 1.8)], life: life * rand(0.7, 1.2), fadeIn: 0.1, spin: rand(-0.6, 0.6),
        }));
      }
    };
    const chips = (at: THREE.Vector3, n: number, dir: THREE.Vector3, speed: number, size = 0.07): void => {
      for (let i = 0; i < n; i++) {
        const v = dir.clone().add(new THREE.Vector3(rand(-0.8, 0.8), rand(0.3, 1.1), rand(-0.8, 0.8))).normalize().multiplyScalar(speed * rand(0.5, 1.1));
        ctx.layer.add(debrisFx({ pos: at, vel: v, size: size * rand(0.6, 1.3), color: CHIP_COLOR, metal: true, life: rand(1.2, 2.2), floorHeightAt: ctx.floorHeightAt }));
      }
    };
    const scuff = (at: THREE.Vector3, size: number, opacity = 0.55): void => {
      ctx.layer.add(flatFx({ tex: scuffMark(), color: 0x000000, pos: new THREE.Vector3(at.x, floorY(at) + 0.02, at.z), size: [size, size], life: DECAL_LIFE, opacity, hold: 0.7, rotation: Math.random() * 6 }));
    };
    const tipPos = (p: THREE.Vector3): THREE.Vector3 => new THREE.Vector3(p.x, floorY(p) + 0.03, p.z);

    return {
      hit(e) {
        const m = e.m;
        const tangent = new THREE.Vector3(-e.normal.z, 0, e.normal.x);
        for (const side of [1, -1]) {
          ctx.sparks.emit(e.pos, { count: Math.round(lerp(HIT_SPARKS, m) / 2), speed: 5 + 8 * m, dir: tangent.clone().multiplyScalar(side), spread: 1.8, life: [0.25, 0.6 + 0.5 * m], hot, cool, stretch: 0.03, upBias: 0.6 });
        }
        chips(e.pos, Math.round(2 + 8 * m), e.normal, 3 + 5 * m);
        dust(tipPos(e.pos), Math.round(3 + 6 * m), 1 + 2 * m, 0.8 + 1.4 * m);
        scuff(e.pos, 0.9 + 1.2 * m);
        ctx.flash(e.pos, 0xffc27a, 15 + 60 * m);
        ctx.shake(lerp(HIT_SHAKE, m), 0.12 + 0.15 * m);
        ctx.hitstop(lerp(HIT_STOP, m));
      },
      dashCharge(e, dt) {
        const tip = tipPos(e.pos);
        if (Math.random() < 0.3 + 0.7 * e.progress) {
          const a = Math.random() * Math.PI * 2;
          ctx.sparks.emit(tip, { count: 1 + Math.round(3 * e.progress * (0.5 + e.m)), speed: 2 + 3 * e.progress, dir: new THREE.Vector3(Math.cos(a), 0.2, Math.sin(a)), spread: 0.6, life: [0.1, 0.3], hot, cool, stretch: 0.02, upBias: 0.3 });
        }
        dustTimer -= dt;
        if (dustTimer <= 0) {
          dustTimer = 0.12 - 0.07 * e.progress;
          dust(tip, 1, 1.2 + 1.5 * e.progress, 0.5 + 0.6 * e.progress, 0.8);
        }
        if (e.progress > 0.75) ctx.shake(0.01 + 0.02 * e.m, 0.05);
      },
      dashRelease(e) {
        const back = e.dir.clone().negate();
        const tip = tipPos(e.pos);
        for (let i = 0; i < 6 + 6 * e.m; i++) dust(tip.clone().addScaledVector(back, 0.3), 1, 2 + 3 * e.m, 0.9 + e.m, 1.1);
        ctx.sparks.emit(tip, { count: 20 + 40 * e.m, speed: 4 + 5 * e.m, dir: back, spread: 1.2, life: [0.15, 0.45], hot, cool, upBias: 0.3 });
        scuff(tip, 1 + e.m);
        ctx.shake(0.03 + 0.05 * e.m, 0.12);
      },
      fastMove(e, dt) {
        skidTimer -= dt;
        const speed = e.vel.length();
        if (skidTimer <= 0) {
          skidTimer = 0.035;
          ctx.layer.add(flatFx({ tex: softDot(), color: 0x000000, pos: new THREE.Vector3(e.pos.x, floorY(e.pos) + 0.015, e.pos.z), size: [0.28, 0.28], life: 2.5, opacity: 0.35, hold: 0.6 }));
        }
        if (Math.random() < Math.min(0.9, speed / 25)) {
          ctx.sparks.emit(tipPos(e.pos), { count: 1, speed: 2, dir: e.vel.clone().normalize().negate(), spread: 0.8, life: [0.08, 0.2], hot, cool, upBias: 0.2 });
        }
      },
      circularSweep(e, t) {
        const tip = tipPos(e.pos);
        for (let i = 0; i < 4; i++) {
          const a = Math.random() * Math.PI * 2;
          const p = tip.clone().add(new THREE.Vector3(Math.cos(a) * 0.75, 0.05, Math.sin(a) * 0.75));
          ctx.sparks.emit(p, { count: 1, speed: 4 + 4 * e.m, dir: new THREE.Vector3(-Math.sin(a), 0.1, Math.cos(a)), spread: 0.4, life: [0.15, 0.35], hot, cool, upBias: 0.2 });
        }
        if (t < 0.08) {
          for (let i = 0; i < 10; i++) dust(tip, 1, 2.5 + 2 * e.m, 0.7 + 0.6 * e.m, 0.9);
          ctx.layer.add(flatFx({ tex: scuffMark(), color: 0x000000, pos: tip.clone().setY(tip.y + 0.005), size: [2.2, 2.2], life: DECAL_LIFE, opacity: 0.4, hold: 0.7 }));
          ctx.shake(0.02 + 0.04 * e.m, 0.2);
        }
      },
      perfectDodge(e) {
        ctx.slowMotion(0.45, 0.55);
        dust(tipPos(e.pos), 5, 1.5, 0.9, 1);
        ctx.flash(e.pos, 0xdfe6ff, 12);
      },
      dodgeMove(_e, dt) {
        ghostTimer -= dt;
        if (ghostTimer > 0) return;
        ghostTimer = 0.07;
        const mat = new THREE.MeshBasicMaterial({ color: 0x9aa3ad, transparent: true, opacity: 0.25, depthWrite: false });
        ctx.layer.add(ghostFx(ctx.ghost(0, mat), mat, 0.35, 0.25));
      },
      stabilityBreak(e) {
        chips(e.pos, Math.round(6 + 10 * e.m), new THREE.Vector3(0, 1, 0), 3 + 3 * e.m, 0.06);
        ctx.sparks.emit(e.pos, { count: 50 + 60 * e.m, speed: 5 + 4 * e.m, dir: new THREE.Vector3(0, 1, 0), spread: 2.2, life: [0.2, 0.6], hot, cool, upBias: 0.5 });
        for (let i = 0; i < 4; i++) {
          ctx.layer.add(spriteFx({ tex: smokePuff(), color: 0x4a4a4a, additive: false, opacity: 0.6, pos: e.pos.clone(), vel: new THREE.Vector3(rand(-0.3, 0.3), rand(0.8, 1.4), rand(-0.3, 0.3)), size: [0.4, 1.4], life: 1.6, fadeIn: 0.15, spin: 0.5 }));
        }
        ctx.flash(e.pos, 0xffb070, 25 + 30 * e.m);
        ctx.shake(0.06 + 0.06 * e.m, 0.25);
        ctx.hitstop(0.03);
      },
      wobble(e, dt) {
        if (Math.random() < 0.6) {
          const a = Math.random() * Math.PI * 2;
          ctx.sparks.emit(tipPos(e.pos).add(new THREE.Vector3(Math.cos(a) * 0.3, 0, Math.sin(a) * 0.3)), { count: 1, speed: 2.5, dir: new THREE.Vector3(Math.cos(a), 0.3, Math.sin(a)), spread: 0.5, life: [0.1, 0.25], hot, cool, upBias: 0.3 });
        }
        dustTimer -= dt;
        if (dustTimer <= 0) {
          dustTimer = 0.35;
          ctx.layer.add(spriteFx({ tex: smokePuff(), color: 0x55524d, additive: false, opacity: 0.35, pos: e.pos.clone(), vel: new THREE.Vector3(0, 0.6, 0), size: [0.3, 0.9], life: 1.2, fadeIn: 0.2 }));
        }
      },
      landing(e) {
        const tip = tipPos(e.pos);
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          ctx.layer.add(spriteFx({ tex: smokePuff(), color: DUST_COLOR, additive: false, opacity: 0.55, pos: tip.clone().add(new THREE.Vector3(0, 0.15, 0)), vel: new THREE.Vector3(Math.cos(a) * (3 + 4 * e.m), 0.3, Math.sin(a) * (3 + 4 * e.m)), drag: 3.5, size: [0.4, 1.1 + 1.2 * e.m], life: 1.1, fadeIn: 0.05 }));
        }
        chips(tip, Math.round(3 + 5 * e.m), new THREE.Vector3(0, 1, 0), 2 + 2 * e.m, 0.05);
        scuff(tip, 1.2 + 1.6 * e.m, 0.6);
        ctx.shake(0.03 + 0.12 * e.m, 0.18);
      },
      scrape(e) {
        const dir = e.tangent.clone().negate().addScaledVector(e.normal, 0.3);
        ctx.sparks.emit(e.pos, { count: Math.round(2 + 5 * e.m), speed: 5 + 5 * e.m, dir, spread: 0.7, life: [0.15, 0.5], hot, cool, stretch: 0.03, upBias: 0.5 });
        if (Math.random() < 0.15) ctx.flash(e.pos, 0xffc27a, 8 + 10 * e.m);
        if (Math.random() < 0.2) scuff(e.pos.clone().addScaledVector(e.normal, 0.3), 0.5, 0.4);
      },
      windBurst(e) {
        // Physical reading of a sudden advance: a dust kick behind the Bey.
        const back = e.dir.clone().negate();
        const tip = tipPos(e.pos);
        for (let i = 0; i < 5 + 5 * e.m; i++) dust(tip.clone().addScaledVector(back, 0.4), 1, 1.5 + 2 * e.m, 0.7 + 0.6 * e.m, 0.9);
      },
      ringOut(e) {
        ctx.sparks.emit(e.pos, { count: 120, speed: 9, dir: e.dir, spread: 2, life: [0.3, 0.9], hot, cool, upBias: 0.6 });
        chips(e.pos, 14, e.dir, 6);
        for (let i = 0; i < 10; i++) dust(e.pos, 1, 3, 1.8, 1.6);
        ctx.flash(e.pos, 0xffc27a, 90);
        ctx.shake(0.16, 0.45);
        ctx.hitstop(0.05);
      },
      tick() {},
    };
  },
};
