// ============================================================
// LANGUAGE C — HYBRID (owner direction, round 2 of the VFX lab)
// "Loved both": combine them instead of picking one.
//   - From A (Mechanical): metal sparks / chips / dust / scuffs on CONTACT
//     (hits, wall scrape, grinding) and while moving at HIGH SPEED.
//   - From B (Anime): hit stars, shockwaves, spark lines, focus lines,
//     Dash charge/release, trails, Circular slashes, Perfect Dodge,
//     Stability Break, landing, ring-out.
//   - Impact frame (negative flash) ONLY on HIGH (heavy) attacks.
//   - NEW: anime wind burst — a spiky, twisting funnel of wind (a small
//     hurricane) behind the Bey on every sudden advance: Dash release
//     and dodge activation.
// ============================================================

import * as THREE from 'three';
import { windFunnelFx } from '../fx/primitives';
import { createAnime } from './anime';
import { MECHANICAL } from './mechanical';
import type { LanguageRuntime, VfxLanguage } from './types';

// ---------------- TUNING ----------------
const IMPACT_FRAME_MIN_M = 0.9;     // HIGH attacks only (heavy intensity in the lab = 1.0).
const WIND_LENGTH = [2.2, 4.2] as const;   // Funnel length (m) at m = 0 / 1.
const WIND_MOUTH = [1.1, 2.0] as const;    // Funnel mouth radius (m) at m = 0 / 1.
const WIND_LIFE = 0.5;              // Seconds.
const WIND_COLOR = 0xe6f4ff;        // Pale wind; the inner layer takes the Bey's color.
// -----------------------------------------

const lerp = (r: readonly [number, number], m: number): number => r[0] + (r[1] - r[0]) * m;

export const HYBRID: VfxLanguage = {
  id: 'C',
  name: 'Hybrid',
  summary: 'A\'s contact and high-speed sparks + B\'s hit, dash, speed-line and state effects; impact frame only on HIGH attacks; new wind-burst funnel on dash and dodge.',
  notes: {
    hit: 'A sparks, chips and dust on contact + B stars, shockwave and focus lines. Impact frame only on HEAVY.',
    dash: 'B aura charge; on release a spiky wind funnel (mini hurricane) + B focus lines; A sparks while speeding.',
    circular: 'B colored slashes + shockwave; A contact sparks on the counter hit.',
    dodge: 'Wind funnel burst on activation + B slow motion, tint and afterimages.',
    break: 'B shards, rings and dazed rings; A grinding sparks while wobbling.',
    landing: 'B double shockwave, crack and cartoon dust.',
    scrape: 'A grinder-style sparks along the wall.',
    ringout: 'B star, beam and focus lines (impact frame only on HEAVY).',
    burst: 'Wind funnel on a short, sharp advance: the core of the new wind language.',
  },
  create(ctx): LanguageRuntime {
    const a = MECHANICAL.create(ctx);
    const b = createAnime(ctx, { impactFrameMinM: IMPACT_FRAME_MIN_M });

    const funnel = (pos: THREE.Vector3, moveDir: THREE.Vector3, m: number, slot: 0 | 1): void => {
      const back = moveDir.clone().normalize().negate();
      const origin = pos.clone().addScaledVector(back, 0.25);
      const length = lerp(WIND_LENGTH, m);
      const mouth = lerp(WIND_MOUTH, m);
      ctx.layer.add(windFunnelFx({ origin, dir: back, length, mouthRadius: mouth, color: WIND_COLOR, life: WIND_LIFE, spikes: 16, twist: 1.0, spin: 12, opacity: 0.95 }));
      ctx.layer.add(windFunnelFx({ origin, dir: back, length: length * 0.8, mouthRadius: mouth * 0.7, color: ctx.beyColor(slot), life: WIND_LIFE * 0.85, spikes: 10, twist: -0.8, spin: -9, opacity: 0.7 }));
    };

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
        funnel(e.pos, e.dir, e.m, e.slot);
        b.windBurst(e);
        a.windBurst(e);
      },
      ringOut(e) { b.ringOut(e); },
      tick(dt) { a.tick(dt); b.tick(dt); },
    };
  },
};
