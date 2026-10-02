// ============================================================
// VFX DIRECTOR
// The routing seam for future combat effects:
//
//   PresentationEvent  →  VfxDirector  →  VfxEffect implementations
//
// An effect says which event kinds it reacts to and what to do; the director
// delivers them, forwards update/reset/dispose, and counts what is alive.
// Gameplay never creates an effect: combat code does not call
// spawnCelCyclone(); it produces the facts an event is derived from.
//
// The director ships with NO effects. The current M4 effects (VfxManager's
// sparks / landing bursts / trails / speed lines, DriftVfx) keep their direct
// wiring in MatchSession untouched; they move behind this seam when the
// approved Hybrid language replaces them, not before. Effects ask for a
// position through the anchor provider (`getVfxAnchor('first', 'tip')`)
// instead of knowing a Bey's mesh hierarchy.
// ============================================================

import type { PresentationContext, PresentationSystem } from './hub';
import type { PresentationEvent, PresentationEventKind, PresentationSide } from './events';
import type { MatchPresentationState } from './state';

export interface VfxEffectContext {
  /** Writes the anchor's world position into `out`; false if the Bey/anchor is unknown. */
  getVfxAnchor(side: PresentationSide, name: string, out: { x: number; y: number; z: number }): boolean;
}

export interface VfxEffect {
  /** Unique within a director. */
  readonly id: string;
  /** The event kinds this effect reacts to. */
  readonly kinds: readonly PresentationEventKind[];
  /** Called once when the director is created by its hub. */
  create?(context: VfxEffectContext): void;
  handle(event: PresentationEvent, state: MatchPresentationState, context: VfxEffectContext): void;
  update?(dtSeconds: number, state: MatchPresentationState | null): void;
  reset?(): void;
  dispose(): void;
  /** Alive one-shot effects, particles, trails... (observability). */
  getCounts?(): Readonly<Record<string, number>>;
}

export const VFX_DIRECTOR_ID = 'vfx-director';

export class VfxDirector implements PresentationSystem {
  readonly id = VFX_DIRECTOR_ID;
  private readonly effects: VfxEffect[] = [];
  private context: VfxEffectContext | null = null;
  private disposed = false;

  /** Registers an effect. Before or after the director is attached; an id can be used once. */
  register(effect: VfxEffect): void {
    if (this.disposed) throw new Error(`VfxDirector.register("${effect.id}"): the director is disposed.`);
    if (this.effects.some((existing) => existing.id === effect.id)) throw new Error(`VfxDirector.register("${effect.id}"): an effect with this id is already registered.`);
    this.effects.push(effect);
    if (this.context) effect.create?.(this.context);
  }

  effectIds(): readonly string[] {
    return this.effects.map((effect) => effect.id);
  }

  create(context: PresentationContext): void {
    this.context = { getVfxAnchor: (side, name, out) => context.getVfxAnchor(side, name, out) };
    for (const effect of this.effects) effect.create?.(this.context);
  }

  onEvents(events: readonly PresentationEvent[], state: MatchPresentationState): void {
    const context = this.context;
    if (!context) return;
    for (const event of events) {
      for (const effect of this.effects) {
        if (effect.kinds.includes(event.kind)) effect.handle(event, state, context);
      }
    }
  }

  update(frame: { readonly dtSeconds: number; readonly state: MatchPresentationState | null }): void {
    for (const effect of this.effects) effect.update?.(frame.dtSeconds, frame.state);
  }

  reset(): void {
    for (const effect of this.effects) effect.reset?.();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    while (this.effects.length > 0) this.effects.pop()?.dispose();
    this.context = null;
  }

  getStats(): Readonly<Record<string, number>> {
    const stats: Record<string, number> = { effects: this.effects.length };
    for (const effect of this.effects) {
      const counts = effect.getCounts?.();
      if (!counts) continue;
      for (const [name, value] of Object.entries(counts)) stats[`${effect.id}.${name}`] = value;
    }
    return stats;
  }
}
