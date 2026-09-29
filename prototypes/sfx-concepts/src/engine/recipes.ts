// ============================================================
// SFX LAB — RECIPES (one per event, shared by the three directions)
// Every event has ONE recipe; the direction's palette decides its timbre.
// That is what makes A, B and C coherent: B's hit, Dash, Clash and KO are
// built from the same B impact/whoosh/sting pieces. The recipe decides
// the event's silhouette (what makes a hit read as a hit, a KO as a KO),
// so switching direction never changes WHAT the sound says, only HOW.
//
// Magnitude (0..1) comes from real gameplay numbers and scales level,
// brightness and length (GDD 51: stronger impact → stronger sound).
// Returns the sound's length in seconds.
// ============================================================

import { amNode, noise, notes, pannedNode, partials, semis, tone, type VoiceContext } from './synth';

export type Recipe = (vc: VoiceContext) => number;

function at(vc: VoiceContext, offsetS: number, patch: Partial<Pick<VoiceContext, 'm' | 'out'>> = {}): VoiceContext {
  return { ...vc, t0: vc.t0 + offsetS, ...patch };
}

interface ImpactShape {
  readonly thump: number;
  readonly snap: number;
  readonly ring: number;
  readonly pitch: number;
  readonly length: number;
  readonly level: number;
}

/** The shared impact: body (thump) + transient (snap) + material (ring). */
function impact(vc: VoiceContext, s: ImpactShape): number {
  const { p, v } = vc;
  const i = p.impact;
  const pitch = s.pitch * v.pitch;
  const length = s.length * v.length;
  const level = s.level * v.gain;
  let end = 0;
  if (s.thump > 0) end = Math.max(end, tone(vc, { wave: 'sine', hz: i.thumpHz * pitch, hzEnd: i.thumpEndHz * pitch, glideS: i.thumpDecayS * length * 0.8, decayS: i.thumpDecayS * length, gain: i.thumpGain * s.thump * level }));
  if (s.snap > 0) end = Math.max(end, noise(vc, { filter: i.snapFilter, hz: i.snapHz * pitch * (0.75 + 0.5 * vc.m), q: i.snapQ, decayS: i.snapDecayS * length, gain: i.snapGain * s.snap * level }));
  if (s.ring > 0) end = Math.max(end, partials(vc, { wave: i.ringWave, hz: i.ringHz * pitch, ratios: i.ringRatios, decayS: i.ringDecayS * length, gain: i.ringGain * s.ring * level, dropSemis: i.ringDropSemis }));
  return end;
}

/** Magnitude → level/length curves shared by every scaled event. */
const lvl = (m: number) => 0.35 + 0.65 * m;
const len = (m: number) => 0.7 + 0.6 * m;
const LAYER_PITCH = [1, 1.06, 0.94] as const;

interface WhooshShape {
  readonly up: boolean;
  readonly length: number;
  readonly pitch: number;
  readonly level: number;
  readonly swirl?: boolean;
}

/** Air moving: filtered noise sweep (+ a synth rider in B/C, + swirl for spins). */
function whoosh(vc: VoiceContext, s: WhooshShape): number {
  const { p, v } = vc;
  const w = p.whoosh;
  const [lo, hi] = w.startHz < w.endHz ? [w.startHz, w.endHz] : [w.endHz, w.startHz];
  // A falls/rises as the palette says; `up` flips it for events that must feel upward.
  const from = (s.up ? lo : hi) * s.pitch * v.pitch;
  const to = (s.up ? hi : lo) * s.pitch * v.pitch;
  const length = w.lengthS * s.length * v.length;
  const dest = s.swirl ? amNode(vc, vc.out, w.swirlHz * v.pitch, 0.8, length + 0.05) : vc.out;
  let end = noise(vc, { filter: 'bandpass', hz: from, hzEnd: to, q: w.q, attackS: length * 0.35, decayS: length * 0.65, gain: w.gain * s.level * v.gain, dest });
  if (w.toneWave) {
    end = Math.max(end, tone(vc, { wave: w.toneWave, hz: from / 4, hzEnd: to / 4, glideS: length, attackS: length * 0.3, decayS: length * 0.7, gain: w.toneGain * s.level * v.gain, detuneCents: 12, dest }));
    if (p.id === 'C') end = Math.max(end, tone(vc, { wave: w.toneWave, hz: from / 4.1, hzEnd: to / 4.3, glideS: length, attackS: length * 0.3, decayS: length * 0.7, gain: w.toneGain * s.level * v.gain * 0.8, detuneCents: -31, dest }));
  }
  return end;
}

/** A direction's signature stab for "positive" (up) or "negative" (down) moments. */
function sting(vc: VoiceContext, direction: 'up' | 'down', opts: { steps?: number; speed?: number; level?: number; octave?: number; chord?: boolean } = {}): number {
  const s = vc.p.sting;
  const all = direction === 'up' ? s.up : s.down;
  const steps = all.slice(0, opts.steps ?? all.length);
  return notes(vc, { steps, rootHz: s.rootHz * semis(12 * (opts.octave ?? 0)), noteS: s.noteS / (opts.speed ?? 1), gain: s.gain * (opts.level ?? 1), chord: opts.chord });
}

function subDrop(vc: VoiceContext, fromHz: number, toHz: number, lengthS: number, gain: number): number {
  return tone(vc, { wave: 'sine', hz: fromHz, hzEnd: toHz, glideS: lengthS, decayS: lengthS, gain });
}

function click(vc: VoiceContext, gain: number, hz = 6000): number {
  return noise(vc, { filter: 'highpass', hz, decayS: 0.012, gain });
}

// ------------------------------------------------------------ recipes ---

export const RECIPES: Readonly<Record<string, Recipe>> = {
  beyContact: (vc) => {
    const m = vc.m;
    const pitch = 1.1 * LAYER_PITCH[vc.v.layer % 3]!;
    return impact(vc, { thump: 0.55, snap: 1, ring: 0.85, pitch, length: len(m) * 0.75, level: lvl(m) * 0.8 });
  },

  wallImpact: (vc) => {
    const m = vc.m;
    let end = impact(vc, { thump: 1.1, snap: 0.8, ring: 0.4, pitch: 0.78 * LAYER_PITCH[vc.v.layer % 3]!, length: len(m), level: lvl(m) });
    if (vc.p.id === 'A' && m > 0.4) {
      // Metal rim rattling after a hard bounce.
      for (let k = 1; k <= 3; k++) end = Math.max(end, noise(at(vc, 0.05 * k), { filter: 'bandpass', hz: 2600, q: 2, decayS: 0.03, gain: 0.25 * m / k }));
    }
    if (vc.p.id === 'C' && m > 0.5) end = Math.max(end, subDrop(vc, 70, 28, 0.35 * len(m), 0.5 * m));
    return end;
  },

  landing: (vc) => {
    const m = vc.m;
    const end = impact(vc, { thump: 1.25, snap: 0.45, ring: 0.22, pitch: 0.7 * LAYER_PITCH[vc.v.layer % 3]!, length: len(m) * 0.9, level: lvl(m) * 0.9 });
    return Math.max(end, noise(vc, { filter: 'lowpass', hz: 900, decayS: 0.16 * len(m), gain: 0.25 * lvl(m) }));
  },

  hit: (vc) => {
    const { m, p } = vc;
    const pitch = LAYER_PITCH[vc.v.layer % 3]!;
    let end = impact(vc, { thump: 1, snap: 1.15, ring: 1, pitch, length: len(m), level: lvl(m) });
    if (m > 0.55) {
      const heavy = (m - 0.55) / 0.45;
      if (p.id === 'A') end = Math.max(end, partials(vc, { wave: 'sine', hz: p.impact.ringHz * 0.62 * pitch, ratios: p.impact.ringRatios, decayS: 0.55 * (0.6 + heavy), gain: 0.22 * heavy }));
      if (p.id === 'B') {
        end = Math.max(end, tone(vc, { wave: 'sawtooth', hz: 1760 * pitch, hzEnd: 2640 * pitch, glideS: 0.05, decayS: 0.2, gain: 0.1 * heavy, attackS: 0.003 }));
        end = Math.max(end, noise(vc, { filter: 'highpass', hz: 3000, decayS: 0.35 * heavy + 0.1, gain: 0.22 * heavy }));
      }
      if (p.id === 'C') end = Math.max(end, subDrop(vc, 82 * pitch, 26, 0.45 * (0.5 + heavy), 0.6 * heavy));
    }
    return end;
  },

  counter: (vc) => {
    const { p } = vc;
    let end = RECIPES.hit!({ ...vc, m: 1 });
    end = Math.max(end, whoosh(at(vc, 0.03), { up: true, length: 1.6, pitch: 1, level: 0.9 }));
    if (p.id === 'A') end = Math.max(end, tone(at(vc, 0.05), { wave: 'triangle', hz: 330, hzEnd: 660, glideS: 0.25, decayS: 0.35, gain: 0.18, vibrato: { hz: 28, cents: 60 } }));
    if (p.id === 'B') end = Math.max(end, sting(at(vc, 0.06), 'up', { speed: 2.2, level: 0.8, octave: 1 }));
    if (p.id === 'C') end = Math.max(end, noise(at(vc, 0.02), { filter: 'bandpass', hz: 300, hzEnd: 4000, q: 3, attackS: 0.25, decayS: 0.08, gain: 0.45 }));
    return end;
  },

  circularStart: (vc) => {
    const { p } = vc;
    let end = whoosh(vc, { up: true, length: 1.25, pitch: 0.9, level: 0.9, swirl: true });
    if (p.id === 'A') end = Math.max(end, partials(vc, { wave: 'triangle', hz: 700 * vc.v.pitch, ratios: [1, 1.5], decayS: 0.18, gain: 0.08 }));
    if (p.id === 'B') end = Math.max(end, tone(vc, { wave: 'square', hz: 440 * vc.v.pitch, hzEnd: 880 * vc.v.pitch, glideS: 0.18, decayS: 0.2, gain: 0.07 }));
    if (p.id === 'C') end = Math.max(end, tone(vc, { wave: 'sawtooth', hz: 90 * vc.v.pitch, hzEnd: 180, glideS: 0.25, decayS: 0.28, gain: 0.16 }));
    return end;
  },

  dashFull: (vc) => {
    const { p } = vc;
    if (p.id === 'A') {
      // Ratchet locking: two hard clicks and a high metal tick.
      let end = click(vc, 0.55, 3000);
      end = Math.max(end, click(at(vc, 0.045), 0.6, 2600));
      return Math.max(end, partials(at(vc, 0.05), { wave: 'sine', hz: 2200, ratios: [1, 2.41], decayS: 0.2, gain: 0.18 }));
    }
    if (p.id === 'B') return sting(vc, 'up', { steps: 2, speed: 1.6, level: 0.9, octave: 1 });
    let end = tone(vc, { wave: 'sawtooth', hz: 240, hzEnd: 1400, glideS: 0.08, decayS: 0.14, gain: 0.2 });
    end = Math.max(end, click(at(vc, 0.08), 0.4, 2000));
    return end;
  },

  dashRelease: (vc) => {
    const { m, p } = vc;
    let end = noise(vc, { filter: 'bandpass', hz: 1200, q: 0.8, decayS: 0.05, gain: 0.5 * lvl(m) });
    end = Math.max(end, whoosh(vc, { up: p.id !== 'C', length: 0.8 + 0.6 * m, pitch: 1.1, level: lvl(m) }));
    end = Math.max(end, tone(vc, { wave: 'sine', hz: p.impact.thumpHz * 0.8, hzEnd: p.impact.thumpEndHz, glideS: 0.08, decayS: 0.1, gain: 0.35 * lvl(m) }));
    if (p.id === 'B') end = Math.max(end, tone(vc, { wave: 'sawtooth', hz: 300, hzEnd: 1200 + 800 * m, glideS: 0.12, decayS: 0.16, gain: 0.07 * lvl(m) }));
    if (p.id === 'C') end = Math.max(end, subDrop(vc, 64, 34, 0.2 + 0.2 * m, 0.45 * lvl(m)));
    return end;
  },

  dodge: (vc) => whoosh(vc, { up: true, length: 0.65, pitch: 1.35, level: 0.62 }),

  dodged: (vc) => {
    let end = whoosh(vc, { up: false, length: 0.5, pitch: 1.6, level: 0.32 });
    end = Math.max(end, click(at(vc, 0.02), 0.12, 7000));
    return end;
  },

  perfectDodge: (vc) => {
    const { p } = vc;
    let end = whoosh(vc, { up: false, length: 2, pitch: 0.55, level: 0.45 });
    if (p.id === 'A') {
      end = Math.max(end, partials(at(vc, 0.02), { wave: 'sine', hz: 2400, ratios: [1, 2.76], decayS: 0.45, gain: 0.2 }));
      end = Math.max(end, partials(at(vc, 0.1), { wave: 'sine', hz: 3200, ratios: [1, 2.76], decayS: 0.5, gain: 0.16 }));
    }
    if (p.id === 'B') {
      end = Math.max(end, sting(at(vc, 0.02), 'up', { speed: 2.4, level: 0.8, octave: 1 }));
      end = Math.max(end, noise(at(vc, 0.05), { filter: 'highpass', hz: 7000, attackS: 0.05, decayS: 0.4, gain: 0.12 }));
    }
    if (p.id === 'C') {
      end = Math.max(end, noise(vc, { filter: 'lowpass', hz: 300, hzEnd: 6000, q: 4, attackS: 0.22, decayS: 0.05, gain: 0.35 }));
      end = Math.max(end, sting(at(vc, 0.24), 'up', { chord: true, level: 0.9 }));
    }
    return end;
  },

  jump: (vc) => {
    const { p } = vc;
    let end = whoosh(vc, { up: true, length: 0.55, pitch: 1.1, level: 0.45 });
    if (p.id === 'A') end = Math.max(end, tone(vc, { wave: 'triangle', hz: 260 * vc.v.pitch, hzEnd: 360, glideS: 0.12, decayS: 0.16, gain: 0.14, vibrato: { hz: 34, cents: 80 } }));
    if (p.id === 'B') end = Math.max(end, tone(vc, { wave: 'square', hz: 420 * vc.v.pitch, hzEnd: 980, glideS: 0.1, decayS: 0.12, gain: 0.08 }));
    if (p.id === 'C') end = Math.max(end, tone(vc, { wave: 'sawtooth', hz: 120 * vc.v.pitch, hzEnd: 420, glideS: 0.12, decayS: 0.16, gain: 0.14 }));
    return end;
  },

  stabilityBreak: (vc) => {
    const { p } = vc;
    let end = impact(vc, { thump: 1.1, snap: 1.4, ring: 1.2, pitch: 0.85, length: 1.6, level: 1 });
    if (p.id === 'A') {
      end = Math.max(end, partials(vc, { wave: 'sine', hz: 610, ratios: [1, 2.13, 3.47, 5.9, 8.2], decayS: 0.9, gain: 0.2 }));
      for (let k = 1; k <= 5; k++) end = Math.max(end, noise(at(vc, 0.06 * k + 0.04), { filter: 'bandpass', hz: 2200 + 400 * k, q: 3, decayS: 0.03, gain: 0.3 / k }));
    }
    if (p.id === 'B') {
      end = Math.max(end, noise(vc, { filter: 'highpass', hz: 4500, decayS: 0.4, gain: 0.3 }));
      end = Math.max(end, sting(at(vc, 0.08), 'down', { speed: 1.6 }));
    }
    if (p.id === 'C') {
      end = Math.max(end, noise(vc, { filter: 'lowpass', hz: 2200, decayS: 0.3, gain: 0.55 }));
      end = Math.max(end, subDrop(vc, 80, 25, 0.6, 0.6));
      end = Math.max(end, sting(at(vc, 0.05), 'down', { chord: true, level: 0.8 }));
    }
    return end;
  },

  stabilityRecover: (vc) => {
    const { p } = vc;
    if (p.id === 'A') {
      let end = click(vc, 0.45, 2800);
      end = Math.max(end, partials(at(vc, 0.04), { wave: 'sine', hz: 880, ratios: [1, 2.41], decayS: 0.3, gain: 0.16 }));
      return Math.max(end, partials(at(vc, 0.12), { wave: 'sine', hz: 1320, ratios: [1, 2.41], decayS: 0.35, gain: 0.14 }));
    }
    if (p.id === 'B') return sting(vc, 'up', { steps: 3, speed: 1.5, level: 0.8 });
    return tone(vc, { wave: 'sawtooth', hz: 110, hzEnd: 330, glideS: 0.3, attackS: 0.05, decayS: 0.35, gain: 0.18 });
  },

  staminaLow: (vc) => {
    const { p } = vc;
    let end = 0;
    for (const offset of [0, 0.2]) {
      const pulse = at(vc, offset);
      if (p.id === 'A') end = Math.max(end, impact(pulse, { thump: 0.9, snap: 0.3, ring: 0.5, pitch: 0.55, length: 1, level: 0.6 }));
      if (p.id === 'B') end = Math.max(end, tone(pulse, { wave: 'square', hz: offset === 0 ? 880 : 660, decayS: 0.12, gain: 0.14 }));
      if (p.id === 'C') end = Math.max(end, tone(pulse, { wave: 'sawtooth', hz: 92, decayS: 0.16, gain: 0.3, vibrato: { hz: 30, cents: 120 } }));
    }
    return end;
  },

  energyEmpty: (vc) => {
    const { p } = vc;
    if (p.id === 'A') {
      let end = 0;
      [0, 0.05, 0.12].forEach((t, k) => (end = Math.max(end, click(at(vc, t), 0.4 / (k + 1), 2400 - 400 * k))));
      return end;
    }
    if (p.id === 'B') return tone(vc, { wave: 'square', hz: 900, hzEnd: 280, glideS: 0.16, decayS: 0.18, gain: 0.12 });
    // Sputtering out: gated bursts over a dying growl.
    let end = tone(vc, { wave: 'sawtooth', hz: 180, hzEnd: 55, glideS: 0.24, decayS: 0.26, gain: 0.22 });
    [0, 0.05, 0.11, 0.18].forEach((t, k) => (end = Math.max(end, noise(at(vc, t), { filter: 'lowpass', hz: 1600 - 280 * k, decayS: 0.04, gain: 0.8 / (k + 1) }))));
    return end;
  },

  clashStart: (vc) => {
    const { p } = vc;
    let end = impact(vc, { thump: 1.3, snap: 1.3, ring: 1.3, pitch: 0.9, length: 1.4, level: 1 });
    end = Math.max(end, noise(at(vc, 0.03), { filter: 'bandpass', hz: 300, hzEnd: 3500, q: 2.5, attackS: 0.4, decayS: 0.08, gain: 0.35 }));
    if (p.id === 'A') end = Math.max(end, partials(vc, { wave: 'sine', hz: 300, ratios: [1, 2.41, 3.87], decayS: 0.9, gain: 0.18 }));
    if (p.id === 'B') end = Math.max(end, sting(at(vc, 0.05), 'up', { chord: true, level: 0.9 }));
    if (p.id === 'C') end = Math.max(end, subDrop(vc, 70, 30, 0.6, 0.55));
    return end;
  },

  clashMash: (vc) => {
    const { m, p } = vc;
    const rise = 0.8 + 0.9 * m;
    let end = impact(vc, { thump: 0.3, snap: 0.6, ring: 0.5, pitch: rise, length: 0.5, level: 0.5 });
    if (p.id === 'B') {
      const step = [0, 2, 4, 7, 9, 12][Math.min(5, Math.floor(m * 6))]!;
      end = Math.max(end, tone(vc, { wave: 'square', hz: 523.25 * semis(step), decayS: 0.05, gain: 0.05 }));
    }
    return end;
  },

  clashResolve: (vc) => {
    const { p } = vc;
    let end = impact(vc, { thump: 1.5, snap: 1.5, ring: 1.4, pitch: 0.8, length: 1.8, level: 1 });
    end = Math.max(end, noise(vc, { filter: 'lowpass', hz: 6000, hzEnd: 300, decayS: 1.1, gain: 0.4 }));
    if (p.id === 'A') end = Math.max(end, partials(vc, { wave: 'sine', hz: 260, ratios: [1, 2.41, 3.87, 5.31, 7.12, 9.4], decayS: 1.6, gain: 0.22 }));
    if (p.id === 'B') end = Math.max(end, sting(at(vc, 0.04), 'up', { chord: true, level: 1 }));
    if (p.id === 'C') {
      end = Math.max(end, subDrop(vc, 90, 22, 1.0, 0.7));
      end = Math.max(end, sting(at(vc, 0.03), 'up', { chord: true, level: 0.8 }));
    }
    return end;
  },

  clashTie: (vc) => {
    const { p } = vc;
    // Symmetric: the same hit from both sides at once, then a neutral stop.
    let end = 0;
    for (const pan of [-0.65, 0.65]) end = Math.max(end, impact({ ...vc, out: pannedNode(vc, pan) }, { thump: 1.1, snap: 1.2, ring: 1, pitch: 0.9, length: 1.3, level: 0.85 }));
    if (p.id === 'A') end = Math.max(end, partials(at(vc, 0.05), { wave: 'sine', hz: 440, ratios: [1, 2.41], decayS: 0.7, gain: 0.14 }));
    if (p.id === 'B') end = Math.max(end, notes(at(vc, 0.06), { steps: [0, 0], rootHz: p.sting.rootHz, noteS: 0.1, gain: p.sting.gain * 0.7 }));
    if (p.id === 'C') end = Math.max(end, noise(at(vc, 0.05), { filter: 'lowpass', hz: 900, decayS: 0.5, gain: 0.3 }));
    return end;
  },

  roundStart: (vc) => {
    const { p } = vc;
    if (p.id === 'A') {
      let end = click(vc, 0.5, 2600);
      end = Math.max(end, click(at(vc, 0.18), 0.5, 2600));
      return Math.max(end, whoosh(at(vc, 0.34), { up: true, length: 1.8, pitch: 0.8, level: 0.9 }));
    }
    if (p.id === 'B') {
      let end = tone(vc, { wave: 'square', hz: 659.25, decayS: 0.1, gain: 0.12 });
      end = Math.max(end, tone(at(vc, 0.16), { wave: 'square', hz: 659.25, decayS: 0.1, gain: 0.12 }));
      return Math.max(end, sting(at(vc, 0.32), 'up', { chord: true, level: 1 }));
    }
    let end = tone(vc, { wave: 'sawtooth', hz: 55, hzEnd: 220, glideS: 0.45, attackS: 0.3, decayS: 0.2, gain: 0.3 });
    end = Math.max(end, impact(at(vc, 0.45), { thump: 1.2, snap: 1, ring: 0.8, pitch: 0.8, length: 1.2, level: 0.9 }));
    return end;
  },

  ringOut: (vc) => {
    const { p } = vc;
    let end = whoosh(vc, { up: false, length: 2.4, pitch: 0.8, level: 0.9 });
    const far = at(vc, 0.38);
    end = Math.max(end, impact(far, { thump: 1.2, snap: 0.7, ring: 0.7, pitch: 0.6, length: 1.8, level: 0.7 }));
    if (p.id === 'B') end = Math.max(end, sting(at(vc, 0.05), 'down', { speed: 1.4, level: 0.7 }));
    if (p.id === 'C') end = Math.max(end, subDrop(far, 75, 22, 0.9, 0.6));
    return end;
  },

  ko: (vc) => {
    const { p } = vc;
    let end = impact(vc, { thump: 1.5, snap: 1.3, ring: 1.3, pitch: 0.75, length: 1.8, level: 1 });
    // Spinning down: a pitch that falls while its wobble slows.
    const spin = p.loops.spin;
    const down = amNode(vc, vc.out, 18, 0.7, 1.2);
    end = Math.max(end, tone(vc, { wave: spin.wave, hz: (spin.baseHz + spin.rangeHz) * 2, hzEnd: spin.baseHz * 0.7, glideS: 1.1, attackS: 0.05, decayS: 1.1, gain: 0.3, dest: down }));
    if (p.id === 'A') end = Math.max(end, partials(at(vc, 0.02), { wave: 'sine', hz: 330, ratios: [1, 2.41, 3.87, 5.31], decayS: 1.3, gain: 0.2 }));
    if (p.id === 'B') end = Math.max(end, sting(at(vc, 0.1), 'down', { level: 0.8 }));
    if (p.id === 'C') end = Math.max(end, subDrop(vc, 85, 20, 1.4, 0.7));
    return end;
  },

  victory: (vc) => {
    const { p } = vc;
    if (p.id === 'A') {
      let end = partials(vc, { wave: 'sine', hz: 392, ratios: [1, 2.76, 5.4], decayS: 1.1, gain: 0.3 });
      return Math.max(end, partials(at(vc, 0.2), { wave: 'sine', hz: 587.33, ratios: [1, 2.76, 5.4], decayS: 1.4, gain: 0.3 }));
    }
    if (p.id === 'B') {
      const end = sting(vc, 'up', { level: 1 });
      return Math.max(end, sting(at(vc, 0.32), 'up', { chord: true, level: 0.9, octave: 1 }));
    }
    let end = notes(vc, { steps: [0, 7, 12], rootHz: 110, noteS: 0.02, gain: 0.22, chord: true, ring: 30 });
    end = Math.max(end, noise(vc, { filter: 'lowpass', hz: 200, hzEnd: 4000, attackS: 0.3, decayS: 0.4, gain: 0.25 }));
    return end;
  },

  defeat: (vc) => {
    const { p } = vc;
    if (p.id === 'A') {
      let end = partials(vc, { wave: 'sine', hz: 294, ratios: [1, 2.76, 5.4], decayS: 1.1, gain: 0.28 });
      return Math.max(end, partials(at(vc, 0.24), { wave: 'sine', hz: 196, ratios: [1, 2.76, 5.4], decayS: 1.5, gain: 0.3 }));
    }
    if (p.id === 'B') return sting(vc, 'down', { speed: 0.8, level: 1 });
    let end = notes(vc, { steps: [0, 6, 11], rootHz: 98, noteS: 0.02, gain: 0.2, chord: true, ring: 35 });
    end = Math.max(end, subDrop(vc, 60, 25, 1.2, 0.4));
    return end;
  },

  draw: (vc) => {
    const { p } = vc;
    if (p.id === 'A') {
      let end = partials(vc, { wave: 'sine', hz: 392, ratios: [1, 2.76], decayS: 0.8, gain: 0.26 });
      return Math.max(end, partials(at(vc, 0.22), { wave: 'sine', hz: 392, ratios: [1, 2.76], decayS: 1, gain: 0.26 }));
    }
    if (p.id === 'B') return notes(vc, { steps: [0, 0, 7], rootHz: p.sting.rootHz / 2, noteS: 0.16, gain: p.sting.gain });
    let end = tone(vc, { wave: 'sawtooth', hz: 110, decayS: 0.3, gain: 0.2 });
    end = Math.max(end, tone(at(vc, 0.22), { wave: 'sawtooth', hz: 110, decayS: 0.5, gain: 0.2, detuneCents: 50 }));
    return end;
  },

  uiFocus: (vc) => {
    const { p } = vc;
    const u = p.ui;
    let end = tone(vc, { wave: u.wave, hz: u.baseHz * vc.v.pitch, decayS: u.decayS * 0.6, gain: u.gain * 0.5 });
    if (u.click > 0) end = Math.max(end, click(vc, u.click * 0.25, 5000));
    return end;
  },

  uiConfirm: (vc) => {
    const { p } = vc;
    const u = p.ui;
    let end = tone(vc, { wave: u.wave, hz: u.baseHz, decayS: u.decayS, gain: u.gain });
    end = Math.max(end, tone(at(vc, 0.06), { wave: u.wave, hz: u.baseHz * 1.5, decayS: u.decayS * 2, gain: u.gain }));
    if (u.click > 0) end = Math.max(end, click(vc, u.click * 0.4, 3500));
    return end;
  },

  uiBack: (vc) => {
    const { p } = vc;
    const u = p.ui;
    let end = tone(vc, { wave: u.wave, hz: u.baseHz * 1.2, decayS: u.decayS, gain: u.gain * 0.9 });
    end = Math.max(end, tone(at(vc, 0.06), { wave: u.wave, hz: u.baseHz * 0.8, decayS: u.decayS * 1.6, gain: u.gain * 0.9 }));
    if (u.click > 0) end = Math.max(end, click(vc, u.click * 0.3, 3000));
    return end;
  },

  uiError: (vc) => {
    const { p } = vc;
    const u = p.ui;
    let end = 0;
    for (const offset of [0, 0.1]) end = Math.max(end, tone(at(vc, offset), { wave: p.id === 'A' ? 'triangle' : u.wave, hz: u.baseHz * 0.25, decayS: 0.07, gain: u.gain * 1.1 }));
    if (u.click > 0) end = Math.max(end, noise(vc, { filter: 'lowpass', hz: 600, decayS: 0.06, gain: u.click * 0.4 }));
    return end;
  },
};

/** Upper bound of each recipe's length (s), for the mix policy before the sound is built. */
export const NOMINAL_LENGTH_S: Readonly<Record<string, number>> = {
  beyContact: 0.3, wallImpact: 0.45, landing: 0.3, hit: 0.7, counter: 0.9, circularStart: 0.4, dashFull: 0.35,
  dashRelease: 0.5, dodge: 0.2, dodged: 0.2, perfectDodge: 0.9, jump: 0.25, stabilityBreak: 1.1, stabilityRecover: 0.6,
  staminaLow: 0.45, energyEmpty: 0.3, clashStart: 1.0, clashMash: 0.12, clashResolve: 1.8, clashTie: 1.0,
  roundStart: 1.2, ringOut: 1.9, ko: 1.8, victory: 1.8, defeat: 1.8, draw: 1.2, uiFocus: 0.08, uiConfirm: 0.2, uiBack: 0.2, uiError: 0.25,
};
