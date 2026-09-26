// ============================================================
// LANGUAGE C — HYBRID (owner direction, VFX lab round 2)
// "Loved both": combine them instead of picking one.
//   - From A (Mechanical): metal sparks / chips / dust / scuffs on CONTACT
//     (hits, wall scrape, grinding) and while moving at HIGH SPEED.
//   - From B (Anime): hit stars, shockwaves, spark lines, focus lines,
//     Dash charge/release, trails, Circular slashes, Perfect Dodge,
//     Stability Break, landing, ring-out.
//   - Impact frame (negative flash) ONLY on HIGH (heavy) attacks.
//   - Wind burst on every sudden advance (Dash release, dodge start).
//
// Wind burst styles (round 3, from the owner's reference image):
//   funnel — v1: spiky twisting funnel (kept for comparison)
//   sonic  — 1 Sonic Boom: jagged vertical shockwave rings, compact
//   comet  — 2 Comet Wake: long torn streaks anchored to the path + spiral
//   cel    — 3 Cel Cyclone: full reference, opaque cel shapes: rings + wake
//            + spiral + toon dust clouds + debris
// ============================================================

import * as THREE from 'three';
import { debrisFx, jaggedRingFx, spiralWrapFx, spriteFx, wakeStreakFx, windFunnelFx, type WindLook } from '../fx/primitives';
import { jaggedRing, toonSmoke, tornStreak } from '../fx/textures';
import { createAnime } from './anime';
import { MECHANICAL } from './mechanical';
import type { DirEvent, FxContext, LanguageRuntime, VfxLanguage } from './types';

// ---------------- TUNING ----------------
const IMPACT_FRAME_MIN_M = 0.9;          // HIGH attacks only (heavy intensity in the lab = 1.0).
const WIND_WHITE = 0xf4f8ff;
const WIND_GREY = 0xc9d0da;
// v1 funnel
const FUNNEL_LENGTH = [2.2, 4.2] as const;
const FUNNEL_MOUTH = [1.1, 2.0] as const;
// Rings (sonic / cel)
const RING_SIZE = [2.6, 5.2] as const;   // Final ring diameter (m) at m = 0 / 1.
const RING_STAGGER = 0.07;               // Seconds between successive rings.
// Wake (comet / cel)
const WAKE_STREAKS = [8, 16] as const;   // Count at m = 0 / 1.
const WAKE_OVERSHOOT = [1.5, 3.5] as const; // How far the wake extends behind the start point (m).
// -----------------------------------------

export type WindStyle = 'funnel' | 'sonic' | 'comet' | 'cel';

export const WIND_STYLES: ReadonlyArray<{ id: WindStyle; label: string; summary: string }> = [
  { id: 'sonic', label: '1 · Sonic Boom', summary: '3 jagged vertical shockwave rings (vapor-cone look), staggered; compact, reads instantly. Light dust.' },
  { id: 'comet', label: '2 · Comet Wake', summary: 'Long torn wind streaks stretched along the real path + spiral lines wrapping the Bey; accent color only on thin streaks.' },
  { id: 'cel', label: '3 · Cel Cyclone', summary: 'The full reference in solid cel shading: rings + torn wake + spiral + toon dust clouds + debris. Heaviest.' },
  { id: 'funnel', label: 'v1 · Funnel', summary: 'Previous version: short spiky twisting funnel (additive glow).' },
];

const lerp = (r: readonly [number, number], m: number): number => r[0] + (r[1] - r[0]) * m;
const rand = (a: number, b: number): number => a + Math.random() * (b - a);

function perpendicular(dir: THREE.Vector3): [THREE.Vector3, THREE.Vector3] {
  const up = Math.abs(dir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const u = new THREE.Vector3().crossVectors(dir, up).normalize();
  const v = new THREE.Vector3().crossVectors(u, dir).normalize();
  return [u, v];
}

function windBurst(ctx: FxContext, e: DirEvent, style: WindStyle): void {
  const dir = e.dir.clone().normalize();
  const back = dir.clone().negate();
  const follow = (): THREE.Vector3 => ctx.beyPos(e.slot);
  const accent = ctx.beyColor(e.slot);
  const m = e.m;

  const rings = (count: number, look: WindLook): void => {
    for (let i = 0; i < count; i++) {
      const size = lerp(RING_SIZE, m) * (1 - i * 0.18);
      ctx.layer.add(jaggedRingFx({
        tex: jaggedRing(), follow, dir, color: i === count - 1 && !look.cel ? accent : WIND_WHITE,
        size: [0.6, size], life: 0.42, delay: i * RING_STAGGER, drift: 0.6 + i * 0.5, look,
        groundAt: (p) => ctx.floorHeightAt(Math.hypot(p.x, p.z)),
      }));
    }
  };
  const wake = (look: WindLook, widthScale: number): void => {
    const n = Math.round(lerp(WAKE_STREAKS, m));
    const [u, v] = perpendicular(dir);
    const origin = follow();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rand(-0.3, 0.3);
      const r = rand(0.15, 0.9 + 0.5 * m);
      // Keep streaks above the floor: squash the lower half.
      const offset = u.clone().multiplyScalar(Math.cos(a) * r).addScaledVector(v, Math.max(-0.25, Math.sin(a) * r * 0.8));
      const isAccent = i % 5 === 0;
      ctx.layer.add(wakeStreakFx({
        tex: tornStreak(), origin, follow, dir, offset,
        color: isAccent ? accent : i % 2 === 0 ? WIND_WHITE : WIND_GREY,
        width: (isAccent ? 0.14 : rand(0.45, 1.05)) * widthScale * (0.7 + 0.5 * m),
        minLength: 1.5 + 1.5 * m, overshoot: lerp(WAKE_OVERSHOOT, m) * rand(0.6, 1.1), life: rand(0.55, 0.8), look,
      }));
    }
  };
  const spiral = (count: number, opacity: number): void => {
    for (let i = 0; i < count; i++) {
      ctx.layer.add(spiralWrapFx({
        follow, dir, radius: 0.85 + 0.25 * m, turns: 0.8, length: 1.6 + 1.2 * m, color: i === 0 ? accent : WIND_WHITE,
        thickness: i === 0 ? 0.02 : 0.035, phase: (i / count) * Math.PI * 2, spin: 9, life: 0.5, opacity,
      }));
    }
  };
  const toonDust = (n: number): void => {
    const origin = follow();
    for (let i = 0; i < n; i++) {
      const p = origin.clone().addScaledVector(back, rand(0.3, 2.2 + 1.5 * m));
      p.y = ctx.floorHeightAt(Math.hypot(p.x, p.z)) + rand(0.2, 0.5);
      const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(rand(-1.5, 1.5));
      ctx.layer.add(spriteFx({
        tex: toonSmoke(), color: 0xffffff, additive: false, opacity: 1, pos: p,
        vel: back.clone().multiplyScalar(rand(0.8, 2)).add(side).setY(rand(0.2, 0.6)), drag: 1.5,
        size: [0.6, rand(1.4, 2.4) * (0.7 + 0.5 * m)], life: rand(0.8, 1.2), fadeIn: 0.08,
      }));
    }
  };
  const debris = (n: number): void => {
    const origin = follow();
    for (let i = 0; i < n; i++) {
      const vel = back.clone().multiplyScalar(rand(2, 5)).add(new THREE.Vector3(rand(-1.5, 1.5), rand(1.5, 3.5), rand(-1.5, 1.5)));
      ctx.layer.add(debrisFx({ pos: origin.clone().setY(origin.y - 0.4), vel, size: rand(0.04, 0.09), color: 0x2b2d31, life: rand(0.9, 1.4), floorHeightAt: ctx.floorHeightAt }));
    }
  };

  switch (style) {
    case 'funnel': {
      const origin = follow().addScaledVector(back, 0.25);
      ctx.layer.add(windFunnelFx({ origin, dir: back, length: lerp(FUNNEL_LENGTH, m), mouthRadius: lerp(FUNNEL_MOUTH, m), color: 0xe6f4ff, life: 0.5, spikes: 16, twist: 1.0, spin: 12, opacity: 0.95 }));
      ctx.layer.add(windFunnelFx({ origin, dir: back, length: lerp(FUNNEL_LENGTH, m) * 0.8, mouthRadius: lerp(FUNNEL_MOUTH, m) * 0.7, color: accent, life: 0.42, spikes: 10, twist: -0.8, spin: -9, opacity: 0.7 }));
      break;
    }
    case 'sonic':
      rings(3, { cel: false, opacity: 0.85 });
      ctx.focusLines(follow(), 0.3 + 0.2 * m, 0.18, 'rgba(235,245,255,0.6)');
      break;
    case 'comet':
      wake({ cel: false, opacity: 0.8 }, 1);
      spiral(3, 0.85);
      break;
    case 'cel':
      rings(2, { cel: true, opacity: 1 });
      wake({ cel: true, opacity: 1 }, 1.15);
      spiral(4, 1);
      toonDust(Math.round(5 + 5 * m));
      debris(Math.round(4 + 6 * m));
      break;
  }
}

export function makeHybrid(style: WindStyle): VfxLanguage {
  const styleInfo = WIND_STYLES.find((s) => s.id === style)!;
  return {
    id: 'C',
    name: `Hybrid · wind ${styleInfo.label}`,
    summary: 'A\'s contact and high-speed sparks + B\'s hit, dash, speed-line and state effects; impact frame only on HIGH attacks; wind burst on dash and dodge.',
    notes: {
      hit: 'A sparks, chips and dust on contact + B stars, shockwave and focus lines. Impact frame only on HEAVY.',
      dash: `B aura charge; on release: wind burst (${styleInfo.label}) + B focus lines; A sparks while speeding.`,
      circular: 'B colored slashes + shockwave; A contact sparks on the counter hit.',
      dodge: `Wind burst (${styleInfo.label}) on activation + B slow motion, tint and afterimages.`,
      burst: `${styleInfo.label}: ${styleInfo.summary}`,
      break: 'B shards, rings and dazed rings; A grinding sparks while wobbling.',
      landing: 'B double shockwave, crack and cartoon dust.',
      scrape: 'A grinder-style sparks along the wall.',
      ringout: 'B star, beam and focus lines (impact frame only on HEAVY).',
    },
    create(ctx): LanguageRuntime {
      const a = MECHANICAL.create(ctx);
      const b = createAnime(ctx, { impactFrameMinM: IMPACT_FRAME_MIN_M });
      return {
        hit(e) { a.hit(e); b.hit(e); },
        dashCharge(e, dt) { b.dashCharge(e, dt); },
        dashRelease(e) { b.dashRelease(e); },
        fastMove(e, dt) { a.fastMove(e, dt); b.fastMove(e, dt); },
        circularSweep(e, t, dt) { b.circularSweep(e, t, dt); },
        perfectDodge(e) { b.perfectDodge(e); },
        dodgeMove(e, dt) { b.dodgeMove(e, dt); },
        stabilityBreak(e) { b.stabilityBreak(e); },
        wobble(e, dt) { a.wobble(e, dt); b.wobble(e, dt); },
        landing(e) { b.landing(e); },
        scrape(e, dt) { a.scrape(e, dt); },
        windBurst(e) {
          windBurst(ctx, e, style);
          if (style === 'funnel') b.windBurst(e);
          a.windBurst(e);
        },
        ringOut(e) { b.ringOut(e); },
        tick(dt) { a.tick(dt); b.tick(dt); },
      };
    },
  };
}

/** Default hybrid (Sonic Boom wind) — kept as a named export for callers that want one language. */
export const HYBRID = makeHybrid('sonic');
