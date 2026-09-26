// ============================================================
// LANGUAGE B — ANIME IMPACT
// Graphic, readable, exaggerated: impact frames (negative flash), spiky
// impact stars, flat shockwave rings, long stylized spark lines, screen
// focus lines, colored slashes and afterimages in each Bey's signature
// color, longer hitstop and stronger shake (Smash / ZZZ-style readability,
// GDD sections 3, 26 and 51). Nothing is copied from those games.
// ============================================================

import * as THREE from 'three';
import { beamFx, burstFx, debrisFx, flatFx, ghostFx, slashArcFx, spriteFx } from '../fx/primitives';
import { crackMark, impactStar, ringTexture, smokePuff, softDot } from '../fx/textures';
import type { FxContext, LanguageRuntime, VfxLanguage } from './types';

// ---------------- TUNING ----------------
const HIT_STOP = [0.04, 0.13] as const;       // Hitstop seconds at m = 0 / 1 (longer than A).
const HIT_SHAKE = [0.05, 0.24] as const;      // Shake amplitude (m).
const IMPACT_FRAME_MIN_M = 0.5;               // Impact frame only on medium/heavy hits.
const STAR_SIZE = [1.6, 4.4] as const;        // Impact star final size (m) at m = 0 / 1.
const WHITE = 0xffffff;
// -----------------------------------------

const lerp = (r: readonly [number, number], m: number): number => r[0] + (r[1] - r[0]) * m;
const rand = (a: number, b: number): number => a + Math.random() * (b - a);

export const ANIME: VfxLanguage = {
  id: 'B',
  name: 'Anime impact',
  summary: 'Graphic and exaggerated: impact frames, impact stars, shockwave rings, focus lines, colored slashes/afterimages, longer hitstop.',
  notes: {
    hit: 'Impact frame (medium/heavy), white + colored impact stars, floor shockwave, long spark lines, focus lines, long hitstop.',
    dash: 'Colored aura rings contract while charging; focus lines, flash and energy trail on release.',
    circular: 'Colored crescent slashes spinning around the Bey + shockwave; counter launches with a star.',
    dodge: 'Strong slow motion, blue tint, colored afterimages, focus lines.',
    break: 'Impact frame, shattering colored shards, double ring, "dazed" rings above the Bey.',
    landing: 'Double shockwave ring, stylized ground crack, cartoon dust.',
    scrape: 'Long bright spark lines with small star flashes.',
    ringout: 'Impact frame, huge star and a colored beam shooting out of the arena.',
  },
  create(ctx: FxContext): LanguageRuntime {
    let chargeTimer = 0;
    let chargedFlash = false;
    let ghostTimer = 0;
    let trailTimer = 0;
    let dazeTimer = 0;
    let sweepStarted = false;
    const floorY = (p: THREE.Vector3): number => ctx.floorHeightAt(Math.hypot(p.x, p.z));
    const onFloor = (p: THREE.Vector3, lift = 0.03): THREE.Vector3 => new THREE.Vector3(p.x, floorY(p) + lift, p.z);

    const stars = (at: THREE.Vector3, color: THREE.Color, m: number, life = 0.26): void => {
      const size = lerp(STAR_SIZE, m);
      ctx.layer.add(burstFx({ tex: impactStar(12), color, pos: at, size: [size * 0.4, size * 1.25], life: life * 1.2, rotation: Math.random() * 6 }));
      ctx.layer.add(burstFx({ tex: impactStar(8), color: WHITE, pos: at, size: [size * 0.25, size * 0.8], life, rotation: Math.random() * 6 }));
    };
    const shockwave = (at: THREE.Vector3, color: THREE.ColorRepresentation, r: number, life: number): void => {
      ctx.layer.add(flatFx({ tex: ringTexture(), color, pos: onFloor(at, 0.04), size: [0.4, r * 2], life, additive: true, opacity: 1 }));
    };
    const lines = (at: THREE.Vector3, color: THREE.Color, count: number, speed: number, dir = new THREE.Vector3(0, 1, 0), spread = 2.2): void => {
      ctx.sparks.emit(at, { count, speed, dir, spread, life: [0.12, 0.35], hot: WHITE, cool: color.getHex(), stretch: 0.085, upBias: 0.3 });
    };

    return {
      hit(e) {
        const m = e.m;
        const color = ctx.beyColor(e.attacker);
        if (m >= IMPACT_FRAME_MIN_M) ctx.impactFrame(0.035 + 0.06 * m);
        stars(e.pos, color, m);
        shockwave(e.pos, color, 1.5 + 3.5 * m, 0.35 + 0.15 * m);
        lines(e.pos, color, Math.round(16 + 34 * m), 10 + 12 * m, e.normal, 2.4);
        ctx.focusLines(e.pos, 0.45 + 0.55 * m, 0.16 + 0.22 * m);
        ctx.flash(e.pos, WHITE, 40 + 110 * m);
        ctx.shake(lerp(HIT_SHAKE, m), 0.16 + 0.22 * m);
        ctx.hitstop(lerp(HIT_STOP, m));
      },
      dashCharge(e, dt) {
        const color = ctx.beyColor(e.slot);
        chargeTimer -= dt;
        if (e.progress < 0.05) chargedFlash = false;
        if (chargeTimer <= 0) {
          chargeTimer = 0.13 - 0.07 * e.progress;
          const center = e.pos.clone().setY(e.pos.y - 0.1);
          ctx.layer.add(flatFx({ tex: ringTexture(), color, pos: onFloor(center, 0.05), size: [2.6 - 0.4 * e.progress, 0.3], life: 0.32, additive: true, opacity: 0.4 + 0.6 * e.progress }));
          for (let i = 0; i < 2 + Math.round(4 * e.progress); i++) {
            const a = Math.random() * Math.PI * 2;
            const r = rand(1.0, 1.6);
            const start = e.pos.clone().add(new THREE.Vector3(Math.cos(a) * r, rand(-0.2, 0.6), Math.sin(a) * r));
            ctx.layer.add(spriteFx({ tex: softDot(), color, pos: start, vel: e.pos.clone().sub(start).multiplyScalar(3.2), size: [0.22, 0.05], life: 0.3 }));
          }
        }
        if (e.progress > 0.97 && !chargedFlash) {
          chargedFlash = true;
          ctx.layer.add(burstFx({ tex: impactStar(6), color: WHITE, pos: e.pos, size: [0.3, 1.6], life: 0.18 }));
          ctx.focusLines(e.pos, 0.3, 0.15, 'rgba(255,255,255,0.6)');
        }
      },
      dashRelease(e) {
        const color = ctx.beyColor(e.slot);
        ctx.focusLines(e.pos, 0.85 + 0.15 * e.m, 0.4, 'rgba(255,255,255,0.85)');
        ctx.layer.add(burstFx({ tex: impactStar(10), color, pos: e.pos, size: [0.5, 2.6], life: 0.2 }));
        shockwave(e.pos, color, 2.2, 0.3);
        ctx.shake(0.05 + 0.06 * e.m, 0.15);
      },
      fastMove(e, dt) {
        trailTimer -= dt;
        if (trailTimer > 0) return;
        trailTimer = 0.012;
        const color = ctx.beyColor(e.slot);
        const p = e.pos.clone();
        ctx.layer.add(spriteFx({ tex: softDot(), color, pos: p, size: [0.95 + 0.5 * e.m, 0.15], life: 0.32, opacity: 0.8 }));
        ctx.layer.add(spriteFx({ tex: softDot(), color: WHITE, pos: p, size: [0.35, 0.05], life: 0.2, opacity: 0.9 }));
      },
      circularSweep(e, t) {
        const color = ctx.beyColor(e.slot);
        if (t < 0.1 && !sweepStarted) {
          sweepStarted = true;
          const c = e.pos.clone().setY(e.pos.y + 0.05);
          ctx.layer.add(slashArcFx({ center: c, radius: 1.25 + 0.3 * e.m, width: 0.28, color, start: 0, sweep: 4.4, spin: 16, life: 0.45 }));
          ctx.layer.add(slashArcFx({ center: c.clone().setY(c.y + 0.18), radius: 1.0, width: 0.16, color: WHITE, start: 2.2, sweep: 3.6, spin: 16, life: 0.35 }));
          shockwave(e.pos, color, 1.8 + e.m, 0.3);
        }
        if (t > 0.9) sweepStarted = false;
        if (Math.random() < 0.5) {
          const a = Math.random() * Math.PI * 2;
          ctx.layer.add(spriteFx({ tex: softDot(), color, pos: e.pos.clone().add(new THREE.Vector3(Math.cos(a) * 1.2, 0, Math.sin(a) * 1.2)), size: [0.25, 0.05], life: 0.25 }));
        }
      },
      perfectDodge(e) {
        ctx.slowMotion(0.2, 0.9);
        ctx.tint('rgba(70,130,255,0.20)', 0.9);
        ctx.focusLines(e.pos, 0.7, 0.6, 'rgba(170,215,255,0.85)');
        ctx.layer.add(burstFx({ tex: impactStar(8), color: 0x7fd0ff, pos: e.pos, size: [0.4, 2.2], life: 0.3 }));
        ctx.flash(e.pos, 0x7fd0ff, 50);
      },
      dodgeMove(e, dt) {
        ghostTimer -= dt;
        if (ghostTimer > 0) return;
        ghostTimer = 0.05;
        const mat = new THREE.MeshBasicMaterial({ color: ctx.beyColor(e.slot), transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });
        ctx.layer.add(ghostFx(ctx.ghost(e.slot, mat), mat, 0.5, 0.55));
      },
      stabilityBreak(e) {
        const color = ctx.beyColor(e.slot);
        ctx.impactFrame(0.08);
        for (let i = 0; i < 12 + 10 * e.m; i++) {
          const v = new THREE.Vector3(rand(-1, 1), rand(0.5, 1.6), rand(-1, 1)).normalize().multiplyScalar(rand(3, 6 + 3 * e.m));
          ctx.layer.add(debrisFx({ pos: e.pos, vel: v, size: rand(0.06, 0.13), color: color.getHex(), life: rand(0.8, 1.4), floorHeightAt: ctx.floorHeightAt }));
        }
        stars(e.pos, color, Math.max(0.7, e.m), 0.32);
        shockwave(e.pos, WHITE, 2.5, 0.35);
        shockwave(e.pos, color, 4, 0.55);
        ctx.focusLines(e.pos, 0.9, 0.35);
        ctx.shake(0.2 + 0.06 * e.m, 0.35);
        ctx.hitstop(0.12);
      },
      wobble(e, dt) {
        dazeTimer -= dt;
        if (dazeTimer > 0) return;
        dazeTimer = 0.14;
        ctx.layer.add(spriteFx({ tex: ringTexture(), color: 0xffe066, pos: e.pos.clone().setY(e.pos.y + 0.75), size: [0.5, 0.8], life: 0.3, opacity: 0.8 }));
        const a = Math.random() * Math.PI * 2;
        ctx.layer.add(spriteFx({ tex: softDot(), color: 0xffe066, pos: e.pos.clone().add(new THREE.Vector3(Math.cos(a) * 0.4, 0.8, Math.sin(a) * 0.4)), vel: new THREE.Vector3(0, 0.6, 0), size: [0.18, 0.05], life: 0.4 }));
      },
      landing(e) {
        const color = ctx.beyColor(e.slot);
        shockwave(e.pos, WHITE, 1.5 + 2.5 * e.m, 0.3);
        shockwave(e.pos, color, 2.5 + 3.5 * e.m, 0.5);
        ctx.layer.add(flatFx({ tex: crackMark(), color: 0x000000, pos: onFloor(e.pos, 0.02), size: [1.4 + 2.4 * e.m, 1.4 + 2.4 * e.m], life: 3, opacity: 0.8, hold: 0.7, rotation: Math.random() * 6 }));
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          ctx.layer.add(spriteFx({ tex: smokePuff(), color: 0xf2f2f2, additive: false, opacity: 0.85, pos: onFloor(e.pos, 0.2), vel: new THREE.Vector3(Math.cos(a) * (2.5 + 3 * e.m), 0.5, Math.sin(a) * (2.5 + 3 * e.m)), drag: 4, size: [0.5, 1 + e.m], life: 0.55 }));
        }
        if (e.m > 0.5) ctx.focusLines(e.pos, 0.5, 0.2);
        ctx.shake(0.06 + 0.16 * e.m, 0.22);
        ctx.hitstop(0.03 * e.m);
      },
      scrape(e) {
        const color = ctx.beyColor(e.slot);
        lines(e.pos, color, Math.round(3 + 5 * e.m), 8 + 7 * e.m, e.tangent.clone().negate().addScaledVector(e.normal, 0.4), 0.7);
        if (Math.random() < 0.12) ctx.layer.add(burstFx({ tex: impactStar(6), color: WHITE, pos: e.pos, size: [0.2, 0.9], life: 0.12 }));
      },
      ringOut(e) {
        const color = ctx.beyColor(e.slot);
        ctx.impactFrame(0.12);
        stars(e.pos, color, 1, 0.4);
        ctx.layer.add(beamFx({ pos: e.pos, dir: e.dir, color, length: 34, width: 1.4, life: 1.0 }));
        ctx.layer.add(beamFx({ pos: e.pos, dir: e.dir, color: WHITE, length: 34, width: 0.5, life: 0.7 }));
        ctx.focusLines(e.pos, 1, 0.6);
        ctx.tint('rgba(255,255,255,0.25)', 0.12);
        ctx.flash(e.pos, WHITE, 160);
        ctx.shake(0.3, 0.55);
        ctx.hitstop(0.1);
      },
      tick() {},
    };
  },
};
