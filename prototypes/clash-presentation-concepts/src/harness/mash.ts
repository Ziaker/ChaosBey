// ============================================================
// CLASH PRESENTATION LAB — MASH SOURCES
// Z, X and C are the mash keys (GDD-fixed). This file only ever produces
// one "did this side contribute a mash event this tick" boolean per side
// per tick — the same shape ClashHarness.tick() (and, in the real game,
// ClashOrchestration.tickActive()) expects, so simultaneous Z+X+C always
// collapses into exactly one event, and a scripted side reuses the exact
// same real src/combat/clash/ClashMash abstraction the AI will eventually
// plug into (GDD: "a IA participa do mash" — simulated here via harness,
// not a real AIController).
// ============================================================

import { FixedIntervalAiMashSource, NullAiMashSource, type ClashAiMashSource } from '../../../../src/combat/clash/ClashMash';

const TICK_RATE = 60;

/** A steady mash rate in events/second, reusing the real FixedIntervalAiMashSource unchanged. */
export function constantRateMash(eventsPerSecond: number): ClashAiMashSource {
  if (eventsPerSecond <= 0) return new NullAiMashSource();
  const intervalTicks = Math.max(1, Math.round(TICK_RATE / eventsPerSecond));
  return new FixedIntervalAiMashSource(intervalTicks);
}

/** No mash at all — an explicit alias for readability in scenario tables. */
export function silentMash(): ClashAiMashSource {
  return new NullAiMashSource();
}

/**
 * Two-phase rate: `beforeEventsPerSecond` until `switchAtS`, then
 * `afterEventsPerSecond` for the rest of the Clash — the "comeback in the
 * last second" scenario's mash source. Deterministic and reproducible
 * like every other scripted source here.
 */
export function rampMash(beforeEventsPerSecond: number, afterEventsPerSecond: number, switchAtS: number): ClashAiMashSource {
  const before = constantRateMash(beforeEventsPerSecond);
  const after = constantRateMash(afterEventsPerSecond);
  return {
    sampleTick(tickIndex: number, clashElapsedS: number): boolean {
      return clashElapsedS < switchAtS ? before.sampleTick(tickIndex, clashElapsedS) : after.sampleTick(tickIndex - Math.round(switchAtS * TICK_RATE), clashElapsedS - switchAtS);
    },
  };
}

/**
 * Drives two ClashAiMashSource instances (one per side) tick by tick,
 * owning the shared tick-index-since-Active-start both sources are
 * sampled against. Used for fully scripted comparisons (both sides
 * scripted) so a scenario replays byte-identical every time; a "manual"
 * side simply isn't driven through this and instead reads
 * KeyboardMashCapture directly at the call site.
 */
export class ScriptedMashDriver {
  private tickIndex = 0;
  constructor(
    private readonly first: ClashAiMashSource,
    private readonly second: ClashAiMashSource,
  ) {}

  reset(): void {
    this.tickIndex = 0;
  }

  sample(elapsedActiveS: number): { first: boolean; second: boolean } {
    const out = { first: this.first.sampleTick(this.tickIndex, elapsedActiveS), second: this.second.sampleTick(this.tickIndex, elapsedActiveS) };
    this.tickIndex++;
    return out;
  }
}

/** One entry per fixed tick where this side's keys changed, for the mash debug log (confirms simultaneous presses count once). */
export interface MashLogEntry {
  tick: number;
  keys: readonly string[];
  countedAsEvent: boolean;
  runningCount: number;
}

const MASH_KEYS: Readonly<Record<string, string>> = { KeyZ: 'Z', KeyX: 'X', KeyC: 'C' };

/**
 * Captures real Z/X/C keyboard presses for the "manual" side, at the
 * fixed tick rate — mirroring the real input system's "pressed this
 * frame" semantics (a key transitioning to down counts once; holding it
 * down does not repeat until released and pressed again).
 */
export class KeyboardMashCapture {
  private readonly held = new Set<string>();
  private readonly pressedSinceLastSample = new Set<string>();
  private attached = false;

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    const label = MASH_KEYS[e.code];
    if (!label || e.repeat) return;
    if (!this.held.has(label)) this.pressedSinceLastSample.add(label);
    this.held.add(label);
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    const label = MASH_KEYS[e.code];
    if (!label) return;
    this.held.delete(label);
  };

  attach(): void {
    if (this.attached) return;
    this.attached = true;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
  }

  /** Currently-held keys, for a small "held now" HUD indicator. */
  get heldNow(): ReadonlySet<string> {
    return this.held;
  }

  /** Consumes and returns this tick's freshly-pressed keys (empty most ticks). */
  sampleTick(): ReadonlySet<string> {
    if (this.pressedSinceLastSample.size === 0) return this.pressedSinceLastSample;
    const out = new Set(this.pressedSinceLastSample);
    this.pressedSinceLastSample.clear();
    return out;
  }
}
