// ============================================================
// SFX LAB — CONTINUOUS SOUNDS (spin, scrape, wall grind, charge, tension)
// A loop is built once and then steered every frame: `level` (0..1, how
// loud it should be right now) and `param` (0..1, what it is describing:
// spin rate, speed, charge, Clash progress). Both glide, never jump.
//
// Loops are the easiest way to make a game exhausting, so they are quiet
// by design (palette gains are low), they fade to true silence when their
// level is 0, and the engine ducks them under every big moment.
// ============================================================

import { archetypeSpin, type DirectionPalette } from '../directions';
import { driveCurve, driveMakeup } from './synth';

export interface LoopHandle {
  readonly eventId: string;
  /**
   * level/param in 0..1; pan -1..1; aux 0..1 (spin: wobble when Broken;
   * tension: advantage); gain: distance attenuation, applied after the
   * drive like the trim (level is intensity and does drive the grit).
   */
  set(level: number, param: number, opts?: { readonly pan?: number; readonly aux?: number; readonly gain?: number }): void;
  stop(): void;
}

export interface LoopOptions {
  readonly archetypeId?: string;
  /** Linear loudness trim (levels.ts), applied after the drive. */
  readonly trim?: number;
}

const GLIDE_S = 0.06;

class LoopBuilder {
  readonly sources: AudioScheduledSourceNode[] = [];
  readonly level: GainNode;
  readonly trim: GainNode;
  readonly baseTrim: number;
  readonly panner: StereoPannerNode;

  constructor(
    readonly ctx: BaseAudioContext,
    out: AudioNode,
    readonly p: DirectionPalette,
    readonly noiseBuffer: AudioBuffer,
    trim = 1,
  ) {
    this.level = ctx.createGain();
    this.level.gain.value = 0;
    this.trim = ctx.createGain();
    this.baseTrim = p.level * trim;
    this.trim.gain.value = this.baseTrim;
    this.panner = ctx.createStereoPanner();
    let tail: AudioNode = this.level;
    if (p.drive > 0.05) {
      const shaper = ctx.createWaveShaper();
      shaper.curve = driveCurve(p.drive * 0.6);
      const makeup = ctx.createGain();
      makeup.gain.value = driveMakeup(p.drive * 0.6);
      tail.connect(shaper).connect(makeup);
      tail = makeup;
    }
    tail.connect(this.trim).connect(this.panner).connect(out);
  }

  osc(wave: OscillatorType, hz: number): OscillatorNode {
    const o = this.ctx.createOscillator();
    o.type = wave;
    o.frequency.value = hz;
    this.sources.push(o);
    return o;
  }

  noise(rate = 1): AudioBufferSourceNode {
    const n = this.ctx.createBufferSource();
    n.buffer = this.noiseBuffer;
    n.loop = true;
    n.playbackRate.value = rate;
    this.sources.push(n);
    return n;
  }

  gain(value: number): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = value;
    return g;
  }

  filter(type: BiquadFilterType, hz: number, q = 0.8): BiquadFilterNode {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = hz;
    f.Q.value = q;
    return f;
  }

  /** node → AM (lfo) → dest; returns the modulated gain and the LFO so rate/depth can be steered. */
  am(dest: AudioNode, hz: number, depth: number, wave: OscillatorType = 'sine'): { readonly node: GainNode; readonly lfo: OscillatorNode; readonly depth: GainNode } {
    const node = this.gain(1 - depth / 2);
    const lfo = this.osc(wave, hz);
    const amount = this.gain(depth / 2);
    lfo.connect(amount).connect(node.gain);
    node.connect(dest);
    return { node, lfo, depth: amount };
  }

  start(): void {
    const t = this.ctx.currentTime;
    for (const s of this.sources) s.start(t);
  }

  glide(param: AudioParam, value: number): void {
    param.setTargetAtTime(value, this.ctx.currentTime, GLIDE_S);
  }

  stop(): void {
    const t = this.ctx.currentTime;
    this.level.gain.cancelScheduledValues(t);
    this.level.gain.setTargetAtTime(0, t, 0.05);
    for (const s of this.sources) {
      try {
        s.stop(t + 0.4);
      } catch {
        // already stopped
      }
    }
    setTimeout(() => this.panner.disconnect(), 600);
  }
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));

function spinHum(b: LoopBuilder, opts: LoopOptions): LoopHandle['set'] {
  const s = b.p.loops.spin;
  const arch = archetypeSpin(opts.archetypeId);
  const trem = b.am(b.level, 6, s.tremolo);
  const o1 = b.osc(s.wave, s.baseHz);
  const o2 = b.osc(s.wave, s.baseHz * 2.01);
  const o2g = b.gain(0.3 * arch.rough);
  o1.connect(trem.node);
  o2.connect(o2g).connect(trem.node);
  const whirr = b.filter('bandpass', s.baseHz * 9, 1.5);
  const n = b.noise();
  n.connect(whirr).connect(b.gain(s.noise * 0.7 * arch.rough)).connect(trem.node);
  // Wobble vibrato (Broken / low stamina).
  const vib = b.osc('sine', 7);
  const vibDepth = b.gain(0);
  vib.connect(vibDepth);
  vibDepth.connect(o1.detune);
  vibDepth.connect(o2.detune);
  b.start();
  return (level, param, o) => {
    const hz = (s.baseHz + s.rangeHz * clamp01(param)) * arch.pitch;
    b.glide(o1.frequency, hz);
    b.glide(o2.frequency, hz * 2.01);
    b.glide(whirr.frequency, hz * 9);
    b.glide(trem.lfo.frequency, 3 + 16 * clamp01(param));
    b.glide(vibDepth.gain, 70 * clamp01(o?.aux ?? 0));
    b.glide(b.level.gain, s.gain * clamp01(level));
  };
}

function floorScrape(b: LoopBuilder): LoopHandle['set'] {
  const s = b.p.loops.scrape;
  const band = b.filter('bandpass', s.centerHz, s.q);
  b.noise().connect(band).connect(b.level);
  const grit = b.filter('highpass', 4200, 0.7);
  const gritAm = b.am(b.level, 17, 0.9, 'square');
  b.noise(0.5).connect(grit).connect(b.gain(s.grit * 0.6)).connect(gritAm.node);
  b.start();
  return (level, param) => {
    b.glide(band.frequency, s.centerHz * (0.6 + 0.8 * clamp01(param)));
    b.glide(gritAm.lfo.frequency, 9 + 26 * clamp01(param));
    b.glide(b.level.gain, s.gain * clamp01(level));
  };
}

function wallGrind(b: LoopBuilder): LoopHandle['set'] {
  const s = b.p.loops.grind;
  const band = b.filter('bandpass', s.centerHz, s.q);
  b.noise(0.8).connect(band).connect(b.level);
  const ringAm = b.am(b.level, 11, 0.8);
  const ring = b.osc('triangle', s.ringHz);
  ring.connect(b.gain(0.12)).connect(ringAm.node);
  b.start();
  return (level, param) => {
    b.glide(band.frequency, s.centerHz * (0.8 + 0.5 * clamp01(param)));
    b.glide(ring.frequency, s.ringHz * (0.9 + 0.25 * clamp01(param)));
    b.glide(b.level.gain, s.gain * clamp01(level));
  };
}

function dashCharge(b: LoopBuilder): LoopHandle['set'] {
  const s = b.p.loops.charge;
  const ratchet = s.ratchetHz > 0 ? b.am(b.level, s.ratchetHz, 0.85, 'square') : null;
  const o = b.osc(s.wave, s.startHz);
  const lp = b.filter('lowpass', 1200, 2);
  o.connect(lp).connect(ratchet ? ratchet.node : b.level);
  if (b.p.id === 'B') {
    const vib = b.osc('sine', 6);
    vib.connect(b.gain(25)).connect(o.detune);
  }
  const hiss = b.filter('bandpass', 1500, 2);
  const hissGain = b.gain(0);
  b.noise().connect(hiss).connect(hissGain).connect(b.level);
  b.start();
  return (level, param) => {
    const x = Math.pow(clamp01(param), 0.8);
    b.glide(o.frequency, s.startHz + (s.endHz - s.startHz) * x);
    b.glide(lp.frequency, 700 + 4200 * x);
    b.glide(hiss.frequency, 900 + 5000 * x);
    b.glide(hissGain.gain, 0.25 * x);
    if (ratchet) b.glide(ratchet.lfo.frequency, s.ratchetHz * (1 + 2.2 * x));
    b.glide(b.level.gain, s.gain * clamp01(level));
  };
}

function clashTension(b: LoopBuilder): LoopHandle['set'] {
  const s = b.p.loops.tension;
  const lp = b.filter('lowpass', 400, 1.4);
  lp.connect(b.level);
  const o1 = b.osc(s.wave, s.baseHz);
  const o2 = b.osc(s.wave, s.baseHz + s.beatHz);
  const o3 = b.osc('sine', s.baseHz / 2);
  o1.connect(lp);
  o2.connect(lp);
  o3.connect(b.gain(0.6)).connect(b.level);
  const band = b.filter('bandpass', 900, 1.2);
  b.noise().connect(band).connect(b.gain(s.noise * 0.4)).connect(lp);
  b.start();
  return (level, param, o) => {
    const x = clamp01(param);
    const lift = 1 + 0.5 * x + 0.12 * clamp01(o?.aux ?? 0);
    b.glide(o1.frequency, s.baseHz * lift);
    b.glide(o2.frequency, (s.baseHz + s.beatHz * (1 + 1.5 * x)) * lift);
    b.glide(o3.frequency, (s.baseHz / 2) * lift);
    b.glide(lp.frequency, 300 + 3600 * x);
    b.glide(band.frequency, 700 + 2500 * x);
    b.glide(b.level.gain, s.gain * clamp01(level) * (0.7 + 0.3 * x));
  };
}

const BUILDERS: Readonly<Record<string, (b: LoopBuilder, opts: LoopOptions) => LoopHandle['set']>> = {
  spinHum,
  floorScrape: (b) => floorScrape(b),
  wallGrind: (b) => wallGrind(b),
  dashCharge: (b) => dashCharge(b),
  clashTension: (b) => clashTension(b),
};

export const LOOP_EVENT_IDS = Object.keys(BUILDERS);

export function createLoop(eventId: string, ctx: BaseAudioContext, out: AudioNode, p: DirectionPalette, noiseBuffer: AudioBuffer, opts: LoopOptions = {}): LoopHandle {
  const build = BUILDERS[eventId];
  if (!build) throw new Error(`no loop recipe for ${eventId}`);
  const b = new LoopBuilder(ctx, out, p, noiseBuffer, opts.trim ?? 1);
  const setInner = build(b, opts);
  return {
    eventId,
    set(level, param, o) {
      setInner(level, param, o);
      if (o?.pan !== undefined) b.glide(b.panner.pan, Math.max(-1, Math.min(1, o.pan)));
      if (o?.gain !== undefined) b.glide(b.trim.gain, b.baseTrim * Math.max(0, o.gain));
    },
    stop: () => b.stop(),
  };
}
