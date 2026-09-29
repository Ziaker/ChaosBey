// ============================================================
// SFX LAB — ENGINE (Web Audio graph + mix rules in action)
//
//   voice ─┬─ [drive] ─ pan ─ bus volume ─ bus duck ─┐
//          └─ air send ─ short slap ────────────────┤
//                                            master ─ limiter ─ out
//
// Buses: gameplay, moments, loops, ui (GDD 61: separate volume
// categories). Big moments duck `loops` and `gameplay` so they cut
// through; MixPolicy decides what plays at all. Everything is logged so
// the Lab can show what was heard AND what the mix chose to drop.
// ============================================================

import { BUSES, eventById, type BusId, type SfxEvent } from '../catalog';
import { DIRECTIONS, type DirectionId, type DirectionPalette } from '../directions';
import { trimGain } from './levels';
import { createLoop, type LoopHandle, type LoopOptions } from './loops';
import { DuckTracker, MixPolicy, type Rejection } from './MixPolicy';
import { NOMINAL_LENGTH_S, RECIPES } from './recipes';
import { createNoiseBuffer, driveCurve, driveMakeup, type VoiceContext } from './synth';
import { NEUTRAL_VARIATION, VariationSource, type Variation } from './variation';

export interface TriggerOptions {
  readonly direction: DirectionId;
  readonly magnitude?: number;
  /** 'first' | 'second' for per-side events (cooldown slot + default pan). */
  readonly side?: 'first' | 'second';
  readonly pan?: number;
  /** Extra level (distance attenuation), multiplies the voice. */
  readonly gain?: number;
  /** Audition: skip gate and cooldown. */
  readonly force?: boolean;
  /** Seconds from now. */
  readonly delayS?: number;
}

export interface SfxLogEntry {
  readonly t: number;
  readonly eventId: string;
  readonly direction: DirectionId;
  readonly magnitude: number;
  readonly side?: 'first' | 'second';
  readonly played: boolean;
  readonly reason?: Rejection;
  readonly stolen: number;
}

export interface EngineStats {
  readonly played: number;
  readonly dropped: Readonly<Record<Rejection, number>>;
  readonly stolen: number;
  readonly activeVoices: number;
  readonly duckDb: number;
}

const DUCKED_BUSES: readonly BusId[] = ['loops', 'gameplay'];

function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

/** Builds one voice's routing: input → [drive] → pan → fader → dest, plus the air send. */
function buildVoiceChain(ctx: BaseAudioContext, p: DirectionPalette, dest: AudioNode, airIn: AudioNode | null, pan: number, outGain: number, t0: number): { readonly input: GainNode; readonly outlet: GainNode } {
  const input = ctx.createGain();
  let tail: AudioNode = input;
  if (p.drive > 0.05) {
    const shaper = ctx.createWaveShaper();
    shaper.curve = driveCurve(p.drive);
    shaper.oversample = '2x';
    const makeup = ctx.createGain();
    makeup.gain.setValueAtTime(driveMakeup(p.drive), t0);
    tail.connect(shaper).connect(makeup);
    tail = makeup;
  }
  const panner = ctx.createStereoPanner();
  panner.pan.setValueAtTime(Math.max(-1, Math.min(1, pan)), t0);
  // The fader: loudness trim and distance (after the drive, so they stay
  // linear), and what the engine pulls down when the mix cuts this voice.
  const outlet = ctx.createGain();
  outlet.gain.setValueAtTime(outGain, t0);
  tail.connect(panner).connect(outlet).connect(dest);
  if (airIn && p.air > 0) {
    const send = ctx.createGain();
    send.gain.setValueAtTime(p.air, t0);
    outlet.connect(send).connect(airIn);
  }
  return { input, outlet };
}

/** Renders one recipe into `dest` on any context (live or offline). Returns its length (s). */
export function renderRecipe(ctx: BaseAudioContext, dest: AudioNode, eventId: string, direction: DirectionId, magnitude: number, variation: Variation, noiseBuffer: AudioBuffer, t0: number, opts: { pan?: number; gain?: number; airIn?: AudioNode | null } = {}): { readonly lengthS: number; readonly outlet: GainNode } {
  const recipe = RECIPES[eventId];
  if (!recipe) throw new Error(`no recipe for ${eventId}`);
  const p = DIRECTIONS[direction];
  const chain = buildVoiceChain(ctx, p, dest, opts.airIn ?? null, opts.pan ?? 0, p.level * trimGain(direction, eventId) * (opts.gain ?? 1), t0);
  const vc: VoiceContext = { ctx, out: chain.input, t0, p, m: Math.max(0, Math.min(1, magnitude)), v: variation, noise: noiseBuffer };
  return { lengthS: recipe(vc), outlet: chain.outlet };
}

/** The master limiter: the same settings live and in offline measurement. */
export function createLimiter(ctx: BaseAudioContext): DynamicsCompressorNode {
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -8;
  limiter.knee.value = 4;
  limiter.ratio.value = 16;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.18;
  return limiter;
}

export class SfxEngine {
  readonly ctx: AudioContext;
  private readonly master: GainNode;
  private readonly buses = new Map<BusId, { readonly volume: GainNode; readonly duck: GainNode }>();
  private readonly airIn: GainNode;
  private readonly noiseBuffer: AudioBuffer;
  private readonly policy = new MixPolicy();
  private readonly ducks = new DuckTracker();
  private readonly variations = new VariationSource();
  private readonly voices = new Map<number, GainNode>();
  private readonly loops = new Map<string, { readonly handle: LoopHandle; readonly direction: DirectionId }>();
  private readonly listeners: ((entry: SfxLogEntry) => void)[] = [];
  private duckReleaseTimer: ReturnType<typeof setTimeout> | null = null;
  private stats = { played: 0, stolen: 0, dropped: { gate: 0, cooldown: 0, budget: 0 } as Record<Rejection, number> };

  constructor(ctx?: AudioContext) {
    this.ctx = ctx ?? new AudioContext({ latencyHint: 'interactive' });
    const limiter = createLimiter(this.ctx);
    limiter.connect(this.ctx.destination);
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(limiter);
    for (const bus of BUSES) {
      const volume = this.ctx.createGain();
      const duck = this.ctx.createGain();
      volume.connect(duck).connect(this.master);
      this.buses.set(bus.id, { volume, duck });
    }
    // Short "arena air": a single slap, no long reverb (keeps the mix dry and readable).
    this.airIn = this.ctx.createGain();
    const delay = this.ctx.createDelay(0.5);
    delay.delayTime.value = 0.055;
    const feedback = this.ctx.createGain();
    feedback.gain.value = 0.28;
    const tone = this.ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 3500;
    const wet = this.ctx.createGain();
    wet.gain.value = 0.5;
    this.airIn.connect(delay).connect(tone).connect(feedback).connect(delay);
    tone.connect(wet).connect(this.master);
    this.noiseBuffer = createNoiseBuffer(this.ctx);
  }

  async resume(): Promise<void> {
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }

  onLog(listener: (entry: SfxLogEntry) => void): void {
    this.listeners.push(listener);
  }

  setMasterVolume(volume: number): void {
    this.master.gain.setTargetAtTime(Math.max(0, Math.min(1, volume)), this.ctx.currentTime, 0.03);
  }

  setBusVolume(bus: BusId, volume: number): void {
    this.buses.get(bus)?.volume.gain.setTargetAtTime(Math.max(0, Math.min(1, volume)), this.ctx.currentTime, 0.03);
  }

  /** Plays a one-shot through the mix rules. Returns whether it played. */
  trigger(eventId: string, opts: TriggerOptions): boolean {
    const event = eventById(eventId);
    if (event.kind !== 'oneShot') throw new Error(`${eventId} is a loop; use setLoop`);
    const magnitude = Math.max(0, Math.min(1, opts.magnitude ?? 1));
    const nowMs = (this.ctx.currentTime + (opts.delayS ?? 0)) * 1000;
    const decision = this.policy.request({
      eventId,
      rule: event.mix,
      key: opts.side,
      magnitude,
      nowMs,
      durationMs: (NOMINAL_LENGTH_S[eventId] ?? 0.5) * 1000,
      force: opts.force,
    });
    if (!decision.accepted) {
      this.stats.dropped[decision.reason]++;
      this.emit({ t: nowMs / 1000, eventId, direction: opts.direction, magnitude, side: opts.side, played: false, reason: decision.reason, stolen: 0 });
      return false;
    }
    for (const id of decision.stolen) this.cutVoice(id);
    this.stats.stolen += decision.stolen.length;
    const t0 = this.ctx.currentTime + 0.005 + (opts.delayS ?? 0);
    const variation = this.variations.next(eventId, opts.side ?? '');
    const pan = opts.pan ?? (opts.side === 'first' ? -0.3 : opts.side === 'second' ? 0.3 : 0);
    const { lengthS, outlet } = renderRecipe(this.ctx, this.busInput(event), eventId, opts.direction, magnitude, variation, this.noiseBuffer, t0, { pan, gain: opts.gain ?? 1, airIn: this.airIn });
    this.voices.set(decision.voiceId, outlet);
    setTimeout(() => this.finishVoice(decision.voiceId), (lengthS + (opts.delayS ?? 0) + 0.3) * 1000);
    if (decision.duck) this.applyDuck(decision.duck, t0);
    this.stats.played++;
    this.emit({ t: t0, eventId, direction: opts.direction, magnitude, side: opts.side, played: true, stolen: decision.stolen.length });
    return true;
  }

  /**
   * Steers a loop. `key` separates instances (e.g. 'spinHum:first').
   * A level of 0 fades it to silence; changing direction rebuilds it.
   * `direction: null` (SEM SOM) stops it.
   */
  setLoop(eventId: string, key: string, direction: DirectionId | null, level: number, param: number, opts: { pan?: number; aux?: number; gain?: number } & LoopOptions = {}): void {
    const existing = this.loops.get(key);
    if (existing && (direction === null || existing.direction !== direction)) {
      existing.handle.stop();
      this.loops.delete(key);
    }
    if (direction === null) return;
    let loop = this.loops.get(key);
    if (!loop) {
      if (level <= 0.001) return; // don't build a loop just to keep it silent
      const event = eventById(eventId);
      loop = { handle: createLoop(eventId, this.ctx, this.busInput(event), DIRECTIONS[direction], this.noiseBuffer, { archetypeId: opts.archetypeId, trim: trimGain(direction, eventId) }), direction };
      this.loops.set(key, loop);
    }
    loop.handle.set(level, param, { pan: opts.pan, aux: opts.aux, gain: opts.gain });
  }

  stopLoops(prefix = ''): void {
    for (const [key, loop] of this.loops) {
      if (!key.startsWith(prefix)) continue;
      loop.handle.stop();
      this.loops.delete(key);
    }
  }

  activeLoopKeys(): string[] {
    return [...this.loops.keys()];
  }

  getStats(): EngineStats {
    const nowMs = this.ctx.currentTime * 1000;
    return { played: this.stats.played, dropped: { ...this.stats.dropped }, stolen: this.stats.stolen, activeVoices: this.policy.activeVoices(nowMs).length, duckDb: this.ducks.levelDb(nowMs) };
  }

  resetStats(): void {
    this.stats = { played: 0, stolen: 0, dropped: { gate: 0, cooldown: 0, budget: 0 } };
  }

  /** Stop everything and forget cooldowns/variation counters (a fresh listening pass). */
  silence(): void {
    this.stopLoops();
    for (const id of [...this.voices.keys()]) this.cutVoice(id);
    this.policy.reset();
    this.ducks.reset();
    this.variations.reset();
    for (const bus of DUCKED_BUSES) this.buses.get(bus)?.duck.gain.setTargetAtTime(1, this.ctx.currentTime, 0.05);
  }

  private busInput(event: SfxEvent): AudioNode {
    return this.buses.get(event.mix.bus)!.volume;
  }

  private applyDuck(duck: { db: number; ms: number }, t0: number): void {
    const nowMs = t0 * 1000;
    this.ducks.add(duck, nowMs);
    const target = dbToGain(this.ducks.levelDb(nowMs));
    for (const bus of DUCKED_BUSES) this.buses.get(bus)?.duck.gain.setTargetAtTime(target, t0, 0.012);
    if (this.duckReleaseTimer) clearTimeout(this.duckReleaseTimer);
    const release = () => {
      const now = this.ctx.currentTime * 1000;
      const level = this.ducks.levelDb(now);
      for (const bus of DUCKED_BUSES) this.buses.get(bus)?.duck.gain.setTargetAtTime(dbToGain(level), this.ctx.currentTime, 0.12);
      if (level < 0) this.duckReleaseTimer = setTimeout(release, 60);
      else this.duckReleaseTimer = null;
    };
    this.duckReleaseTimer = setTimeout(release, duck.ms);
  }

  private cutVoice(voiceId: number): void {
    const outlet = this.voices.get(voiceId);
    if (!outlet) return;
    // Fast fade on the voice's own fader instead of a click, then let it go.
    const now = this.ctx.currentTime;
    outlet.gain.cancelScheduledValues(now);
    outlet.gain.setTargetAtTime(0, now, 0.012);
    setTimeout(() => {
      try {
        outlet.disconnect();
      } catch {
        // already disconnected
      }
    }, 120);
    this.voices.delete(voiceId);
    this.policy.release(voiceId);
  }

  private finishVoice(voiceId: number): void {
    const outlet = this.voices.get(voiceId);
    if (outlet) {
      try {
        outlet.disconnect();
      } catch {
        // already disconnected
      }
    }
    this.voices.delete(voiceId);
    this.policy.release(voiceId);
  }

  private emit(entry: SfxLogEntry): void {
    for (const listener of this.listeners) listener(entry);
  }
}

export { NEUTRAL_VARIATION };
