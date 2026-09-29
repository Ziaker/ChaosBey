// ============================================================
// SFX LAB — SYNTH PRIMITIVES (Web Audio building blocks)
// Every sound in the Lab is built at play time from these few pieces: a
// tone with a pitch glide, a filtered noise burst, a cluster of partials
// (inharmonic = metal, harmonic = synth), a note sequence and a soft
// saturator. No samples, no network: it runs from the repository and on
// GitHub Pages as is. Works on AudioContext and OfflineAudioContext alike
// (the Lab measures every recipe offline in its smoke test).
// ============================================================

import type { DirectionPalette } from '../directions';
import type { Variation } from './variation';

/** What a recipe gets: where to build, when, in which direction, how strong. */
export interface VoiceContext {
  readonly ctx: BaseAudioContext;
  /** The voice's own output (already routed to pan, drive, bus and air). */
  readonly out: AudioNode;
  readonly t0: number;
  readonly p: DirectionPalette;
  /** 0..1 real magnitude (impact force, charge, progress…). */
  readonly m: number;
  readonly v: Variation;
  readonly noise: AudioBuffer;
}

const SILENT = 0.0001;

export function createNoiseBuffer(ctx: BaseAudioContext, seconds = 2): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  // Deterministic noise: same buffer every session.
  let state = 0x9e3779b9;
  for (let i = 0; i < data.length; i++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    data[i] = ((state >>> 0) / 4294967296) * 2 - 1;
  }
  return buffer;
}

/** Pre-gain into the saturator for a drive `amount` 0..1. */
export function driveGain(amount: number): number {
  return 1 + 5 * Math.max(0, amount);
}

/**
 * Saturation curve: tanh(G·x)/tanh(G), so a full-scale input still peaks
 * at 1 and loud parts get squashed and gritty. Quiet parts are boosted by
 * G/tanh(G); driveMakeup() takes half of that back (in dB) so a driven
 * direction is gritty, not simply louder.
 */
export function driveCurve(amount: number, samples = 2048): Float32Array<ArrayBuffer> {
  const g = driveGain(amount);
  const norm = Math.tanh(g);
  const curve = new Float32Array(new ArrayBuffer(samples * 4));
  for (let i = 0; i < samples; i++) {
    const x = (i / (samples - 1)) * 2 - 1;
    curve[i] = Math.tanh(g * x) / norm;
  }
  return curve;
}

export function driveMakeup(amount: number): number {
  const g = driveGain(amount);
  return 1 / Math.sqrt(g / Math.tanh(g));
}

/** Attack/decay envelope on a gain param; returns the end time. */
export function envelope(param: AudioParam, t0: number, attackS: number, peak: number, decayS: number): number {
  const attack = Math.max(0.001, attackS);
  const decay = Math.max(0.005, decayS);
  param.setValueAtTime(SILENT, t0);
  param.linearRampToValueAtTime(Math.max(SILENT, peak), t0 + attack);
  param.exponentialRampToValueAtTime(SILENT, t0 + attack + decay);
  return t0 + attack + decay;
}

export interface ToneSpec {
  readonly wave: OscillatorType;
  readonly hz: number;
  readonly hzEnd?: number;
  readonly glideS?: number;
  readonly attackS?: number;
  readonly decayS: number;
  readonly gain: number;
  readonly detuneCents?: number;
  /** Vibrato: rate Hz and depth in cents. */
  readonly vibrato?: { readonly hz: number; readonly cents: number };
  readonly at?: number;
  readonly dest?: AudioNode;
}

export function tone(vc: VoiceContext, spec: ToneSpec): number {
  const { ctx } = vc;
  const t = vc.t0 + (spec.at ?? 0);
  const osc = ctx.createOscillator();
  osc.type = spec.wave;
  osc.frequency.setValueAtTime(Math.max(1, spec.hz), t);
  if (spec.hzEnd !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, spec.hzEnd), t + Math.max(0.005, spec.glideS ?? spec.decayS));
  if (spec.detuneCents) osc.detune.setValueAtTime(spec.detuneCents, t);
  const gain = ctx.createGain();
  const end = envelope(gain.gain, t, spec.attackS ?? 0.002, spec.gain, spec.decayS);
  osc.connect(gain).connect(spec.dest ?? vc.out);
  if (spec.vibrato) {
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    lfo.frequency.setValueAtTime(spec.vibrato.hz, t);
    depth.gain.setValueAtTime(spec.vibrato.cents, t);
    lfo.connect(depth).connect(osc.detune);
    lfo.start(t);
    lfo.stop(end + 0.02);
  }
  osc.start(t);
  osc.stop(end + 0.02);
  return end - vc.t0;
}

export interface NoiseSpec {
  readonly filter: BiquadFilterType;
  readonly hz: number;
  readonly hzEnd?: number;
  readonly q?: number;
  readonly attackS?: number;
  readonly decayS: number;
  readonly gain: number;
  /** Playback rate (<1 darker/grainier). */
  readonly rate?: number;
  readonly at?: number;
  readonly dest?: AudioNode;
}

export function noise(vc: VoiceContext, spec: NoiseSpec): number {
  const { ctx } = vc;
  const t = vc.t0 + (spec.at ?? 0);
  const src = ctx.createBufferSource();
  src.buffer = vc.noise;
  src.loop = true;
  src.playbackRate.setValueAtTime(spec.rate ?? 1, t);
  const filter = ctx.createBiquadFilter();
  filter.type = spec.filter;
  filter.frequency.setValueAtTime(Math.max(20, spec.hz), t);
  if (spec.hzEnd !== undefined) filter.frequency.exponentialRampToValueAtTime(Math.max(20, spec.hzEnd), t + (spec.attackS ?? 0.001) + spec.decayS);
  filter.Q.setValueAtTime(spec.q ?? 0.8, t);
  const gain = ctx.createGain();
  const end = envelope(gain.gain, t, spec.attackS ?? 0.001, spec.gain, spec.decayS);
  // A random start point in the buffer: noise bursts never line up.
  const offset = ((vc.v.seed % 997) / 997) * (vc.noise.duration - 0.05);
  src.connect(filter).connect(gain).connect(spec.dest ?? vc.out);
  src.start(t, offset);
  src.stop(end + 0.02);
  return end - vc.t0;
}

export interface PartialsSpec {
  readonly wave: OscillatorType;
  readonly hz: number;
  readonly ratios: readonly number[];
  readonly decayS: number;
  readonly gain: number;
  /** Pitch drop over the decay (semitones). */
  readonly dropSemis?: number;
  readonly at?: number;
  readonly dest?: AudioNode;
}

/** A struck object: several partials, higher ones quieter and shorter. */
export function partials(vc: VoiceContext, spec: PartialsSpec): number {
  let end = 0;
  spec.ratios.forEach((ratio, i) => {
    const hz = spec.hz * ratio;
    const drop = spec.dropSemis ? hz * Math.pow(2, -spec.dropSemis / 12) : undefined;
    end = Math.max(
      end,
      tone(vc, {
        wave: spec.wave,
        hz,
        hzEnd: drop,
        glideS: spec.decayS,
        decayS: spec.decayS / (1 + i * 0.45),
        gain: spec.gain / Math.pow(i + 1, 0.85),
        at: spec.at,
        dest: spec.dest,
      }),
    );
  });
  return end;
}

export interface NotesSpec {
  readonly steps: readonly number[];
  readonly rootHz: number;
  readonly noteS: number;
  /** How much each note rings past the next one starts (×noteS). */
  readonly ring?: number;
  readonly gain: number;
  readonly at?: number;
  /** Play all steps at once (a chord) instead of in sequence. */
  readonly chord?: boolean;
}

/** A short motif in the direction's own sting style. */
export function notes(vc: VoiceContext, spec: NotesSpec): number {
  const { p } = vc;
  let end = 0;
  // Chords sum their notes: keep a chord about as loud as one note.
  const gain = spec.chord ? spec.gain / Math.sqrt(spec.steps.length) : spec.gain;
  spec.steps.forEach((step, i) => {
    const at = (spec.at ?? 0) + (spec.chord ? 0 : i * spec.noteS);
    const hz = spec.rootHz * Math.pow(2, step / 12);
    const decay = spec.noteS * (spec.ring ?? 2.2) * (i === spec.steps.length - 1 ? 1.8 : 1);
    if (p.sting.style === 'metal') {
      end = Math.max(end, partials(vc, { wave: 'sine', hz, ratios: [1, 2.76, 5.4], decayS: decay * 1.6, gain: gain, at }));
    } else if (p.sting.style === 'melodic') {
      end = Math.max(end, tone(vc, { wave: p.sting.wave, hz, decayS: decay, gain: gain, at, attackS: 0.004 }));
      if (p.sting.shimmer > 0) end = Math.max(end, tone(vc, { wave: 'triangle', hz: hz * 2, decayS: decay * 1.3, gain: gain * p.sting.shimmer * 0.5, at: at + 0.01 }));
    } else {
      end = Math.max(end, tone(vc, { wave: p.sting.wave, hz, decayS: decay, gain: gain, at, detuneCents: -18, attackS: 0.006 }));
      end = Math.max(end, tone(vc, { wave: p.sting.wave, hz, decayS: decay, gain: gain * 0.8, at, detuneCents: 23, attackS: 0.006 }));
    }
  });
  return end;
}

/** Amplitude modulation (tremolo/swirl) between `source` and `dest`; returns the node to feed. */
export function amNode(vc: VoiceContext, dest: AudioNode, hz: number, depth: number, untilS: number, wave: OscillatorType = 'sine'): GainNode {
  const { ctx } = vc;
  const node = ctx.createGain();
  node.gain.setValueAtTime(1 - depth / 2, vc.t0);
  const lfo = ctx.createOscillator();
  lfo.type = wave;
  lfo.frequency.setValueAtTime(hz, vc.t0);
  const amount = ctx.createGain();
  amount.gain.setValueAtTime(depth / 2, vc.t0);
  lfo.connect(amount).connect(node.gain);
  lfo.start(vc.t0);
  lfo.stop(vc.t0 + untilS + 0.05);
  node.connect(dest);
  return node;
}

export function pannedNode(vc: VoiceContext, pan: number): AudioNode {
  const panner = vc.ctx.createStereoPanner();
  panner.pan.setValueAtTime(Math.max(-1, Math.min(1, pan)), vc.t0);
  panner.connect(vc.out);
  return panner;
}

export function semis(n: number): number {
  return Math.pow(2, n / 12);
}
