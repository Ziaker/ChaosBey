// ============================================================
// SFX LAB — MIX POLICY (silence and priority as part of the design)
// Pure decision logic, no Web Audio, so it is unit-tested directly. For
// every sound request it decides: play, or not, and why.
//
// - gate: magnitude too small to be worth a sound (a light graze stays silent);
// - cooldown: the same event on the same side just played (no machine gun);
// - voices: too many copies of this event → the oldest copy is cut;
// - budget: too many one-shots overall → the least important playing sound
//   is cut if the new one matters more, otherwise the new one is dropped;
// - duck: big moments (KO, Ring-Out, Clash, Break…) ask the engine to pull
//   the continuous and routine sounds down while they play, so they "cut
//   through" instead of adding to a wall of audio.
//
// Auditioning a single sound in the Lab uses `force` to skip gate and
// cooldown (you pressed play; you want to hear it), but it still counts
// toward voices and budget.
// ============================================================

import type { MixRule } from '../catalog';

export type Rejection = 'gate' | 'cooldown' | 'budget';

export interface VoiceRecord {
  readonly id: number;
  readonly eventId: string;
  readonly priority: number;
  readonly startMs: number;
  readonly endMs: number;
}

export interface MixRequest {
  readonly eventId: string;
  readonly rule: MixRule;
  /** Cooldown slot within the event (e.g. 'first' / 'second' side). */
  readonly key?: string;
  readonly magnitude: number;
  readonly nowMs: number;
  readonly durationMs: number;
  readonly force?: boolean;
}

export type MixDecision =
  | { readonly accepted: true; readonly voiceId: number; readonly stolen: readonly number[]; readonly duck: MixRule['duck'] | null }
  | { readonly accepted: false; readonly reason: Rejection };

export const DEFAULT_ONE_SHOT_BUDGET = 10;

export class MixPolicy {
  private readonly lastPlayMs = new Map<string, number>();
  private voices: VoiceRecord[] = [];
  private nextVoiceId = 1;

  constructor(private readonly oneShotBudget = DEFAULT_ONE_SHOT_BUDGET) {}

  request(request: MixRequest): MixDecision {
    const { eventId, rule, nowMs } = request;
    this.prune(nowMs);
    const slot = `${eventId}|${request.key ?? ''}`;
    if (!request.force) {
      if (request.magnitude < rule.gate) return { accepted: false, reason: 'gate' };
      const last = this.lastPlayMs.get(slot);
      if (last !== undefined && nowMs - last < rule.cooldownMs) return { accepted: false, reason: 'cooldown' };
    }

    // Plan the cuts first; nothing changes unless the new sound really plays.
    // Too many copies of this very event: the newest wins, the oldest are cut.
    const same = this.voices.filter((v) => v.eventId === eventId).sort((a, b) => a.startMs - b.startMs);
    const sameCuts = same.slice(0, Math.max(0, same.length - rule.maxVoices + 1));
    const remaining = this.voices.filter((v) => !sameCuts.includes(v));
    // Too many sounds overall: cut the least important one, if the new one matters more.
    let budgetCut: VoiceRecord | null = null;
    if (remaining.length >= this.oneShotBudget) {
      const victim = [...remaining].sort((a, b) => a.priority - b.priority || a.startMs - b.startMs)[0]!;
      if (victim.priority >= rule.priority) return { accepted: false, reason: 'budget' };
      budgetCut = victim;
    }
    const stolen = [...sameCuts, ...(budgetCut ? [budgetCut] : [])].map((v) => v.id);
    for (const id of stolen) this.remove(id);

    const voice: VoiceRecord = { id: this.nextVoiceId++, eventId, priority: rule.priority, startMs: nowMs, endMs: nowMs + Math.max(1, request.durationMs) };
    this.voices.push(voice);
    this.lastPlayMs.set(slot, nowMs);
    return { accepted: true, voiceId: voice.id, stolen, duck: rule.duck ?? null };
  }

  /** A voice finished (or was stopped by the engine). */
  release(voiceId: number): void {
    this.remove(voiceId);
  }

  activeVoices(nowMs: number): readonly VoiceRecord[] {
    this.prune(nowMs);
    return this.voices;
  }

  reset(): void {
    this.voices = [];
    this.lastPlayMs.clear();
  }

  private prune(nowMs: number): void {
    this.voices = this.voices.filter((v) => v.endMs > nowMs);
  }

  private remove(voiceId: number): void {
    this.voices = this.voices.filter((v) => v.id !== voiceId);
  }
}

/**
 * The strongest duck still active at `nowMs` (dB ≤ 0). Several big moments
 * can overlap; the deepest one wins, and each lasts its own `ms`.
 */
export class DuckTracker {
  private ducks: { readonly db: number; readonly untilMs: number }[] = [];

  add(duck: { readonly db: number; readonly ms: number }, nowMs: number): void {
    this.ducks.push({ db: Math.min(0, duck.db), untilMs: nowMs + duck.ms });
  }

  levelDb(nowMs: number): number {
    this.ducks = this.ducks.filter((d) => d.untilMs > nowMs);
    return this.ducks.reduce((deepest, d) => Math.min(deepest, d.db), 0);
  }

  reset(): void {
    this.ducks = [];
  }
}
