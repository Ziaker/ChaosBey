// ============================================================
// SFX LAB — OFFLINE MEASUREMENT (every option is audible, none clips)
// Renders each recipe on an OfflineAudioContext (no speakers, no
// real-time), through the same master limiter the player hears, and
// measures it: peak, plain RMS, perceived loudness and how long it
// actually sounds. The smoke test uses this to prove every event ×
// direction produces sound without clipping; levels.ts uses the loudness
// to keep A, B and C level-matched, so the comparison is about character,
// not about which one is louder.
//
// Loudness is K-weighted (ITU-R BS.1770, the filter behind LUFS) over the
// audible part, without gating: plain RMS rates a dark sub drop (C) as
// loud as a bright "shing" (B) that the ear hears as much louder.
// ============================================================

import { EVENTS } from '../catalog';
import { DIRECTIONS, DIRECTION_IDS, type DirectionId } from '../directions';
import { createLoop } from './loops';
import { NOMINAL_LENGTH_S } from './recipes';
import { trimGain } from './levels';
import { createLimiter, renderRecipe } from './SfxEngine';
import { createNoiseBuffer } from './synth';
import { NEUTRAL_VARIATION } from './variation';

export interface Measurement {
  readonly eventId: string;
  readonly direction: DirectionId;
  readonly magnitude: number;
  readonly peak: number;
  readonly rmsDb: number;
  /** K-weighted loudness (LUFS-like, ungated) over the audible part. */
  readonly lufs: number;
  readonly audibleS: number;
}

// BS.1770 publishes the K-weighting coefficients for 48 kHz.
const SAMPLE_RATE = 48000;
const AUDIBLE = 0.001; // -60 dBFS
const K_SHELF = { b: [1.53512485958697, -2.69169618940638, 1.19839281085285], a: [-1.69065929318241, 0.73248077421585] };
const K_HIGHPASS = { b: [1, -2, 1], a: [-1.99004745483398, 0.99007225036621] };

function biquad(input: Float32Array, { b, a }: { b: number[]; a: number[] }): Float32Array {
  const out = new Float32Array(input.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x = input[i]!;
    const y = b[0]! * x + b[1]! * x1 + b[2]! * x2 - a[0]! * y1 - a[1]! * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    out[i] = y;
  }
  return out;
}

export function analyse(buffer: AudioBuffer): { peak: number; rmsDb: number; lufs: number; audibleS: number } {
  let peak = 0;
  let last = 0;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      const a = Math.abs(data[i]!);
      if (a > peak) peak = a;
      if (a > AUDIBLE) last = Math.max(last, i);
    }
  }
  const n = last + 1;
  let plain = 0;
  let weighted = 0;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    const k = biquad(biquad(data, K_SHELF), K_HIGHPASS);
    let sumPlain = 0;
    let sumK = 0;
    for (let i = 0; i < n; i++) {
      sumPlain += data[i]! * data[i]!;
      sumK += k[i]! * k[i]!;
    }
    plain += sumPlain / n / buffer.numberOfChannels;
    weighted += sumK / n; // BS.1770: channel mean squares add up (L/R weight 1)
  }
  return {
    peak,
    rmsDb: 10 * Math.log10(Math.max(1e-18, plain)),
    lufs: -0.691 + 10 * Math.log10(Math.max(1e-18, weighted)),
    audibleS: last / buffer.sampleRate,
  };
}

export async function measureOneShot(eventId: string, direction: DirectionId, magnitude: number): Promise<Measurement> {
  const seconds = (NOMINAL_LENGTH_S[eventId] ?? 1) + 1.2;
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * SAMPLE_RATE), SAMPLE_RATE);
  const limiter = createLimiter(ctx);
  limiter.connect(ctx.destination);
  renderRecipe(ctx, limiter, eventId, direction, magnitude, NEUTRAL_VARIATION, createNoiseBuffer(ctx), 0.01);
  const buffer = await ctx.startRendering();
  return { eventId, direction, magnitude, ...analyse(buffer) };
}

export async function measureLoop(eventId: string, direction: DirectionId, param: number): Promise<Measurement> {
  const ctx = new OfflineAudioContext(2, Math.ceil(1.2 * SAMPLE_RATE), SAMPLE_RATE);
  const limiter = createLimiter(ctx);
  limiter.connect(ctx.destination);
  const loop = createLoop(eventId, ctx, limiter, DIRECTIONS[direction], createNoiseBuffer(ctx), { archetypeId: 'attack-prototype', trim: trimGain(direction, eventId) });
  loop.set(1, param, { aux: 0.3 });
  const buffer = await ctx.startRendering();
  return { eventId, direction, magnitude: param, ...analyse(buffer) };
}

/** Every event × direction at its strongest audition magnitude. */
export async function measureAll(): Promise<Measurement[]> {
  const out: Measurement[] = [];
  for (const event of EVENTS) {
    const magnitude = Math.max(...event.auditionMagnitudes);
    for (const direction of DIRECTION_IDS) {
      out.push(event.kind === 'loop' ? await measureLoop(event.id, direction, Math.max(0.6, magnitude)) : await measureOneShot(event.id, direction, magnitude));
    }
  }
  return out;
}
