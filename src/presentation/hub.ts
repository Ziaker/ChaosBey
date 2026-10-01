// ============================================================
// PRESENTATION HUB
// Owns the lifecycle of presentation systems for one match session.
//
//   create(context) → onEvents(...) / update(...) per tick/frame
//                   → reset() on a restart → dispose()
//
// A session builds one hub and feeds it after every tick; systems attach to
// it (a future Cel Cyclone, condition layer, Clash presentation, HUD
// adapter). With nothing attached the hub only derives events and state, which
// is cheap, read-only and invisible. It never touches gameplay: it receives a
// finished tick and returns nothing the simulation reads.
//
// Lifecycle guarantees (each has a test):
//   - one system per id (a second attach of the same id throws, so a system
//     cannot subscribe twice);
//   - detach / dispose release a system exactly once, in reverse attach order;
//   - a system that throws is isolated and counted, never allowed to break the
//     match or the other systems;
//   - after dispose nothing is delivered and nothing can attach;
//   - reset forgets edge state, so a restarted round sees no stale event.
// ============================================================

import type { PresentationFeatures } from './features';
import { PresentationEventDeriver, type PresentationEvent, type PresentationSide, type PresentationTickInput } from './events';
import { foldRecentImpact, type MatchPresentationState, type RecentImpact } from './state';

/** What a system is told once, when it attaches. */
export interface PresentationContext {
  readonly features: PresentationFeatures;
  readonly beys: readonly { readonly side: PresentationSide; readonly definitionId: string }[];
  /** World position of a named VFX anchor on a Bey (see beyVisual.ts). Returns false if the anchor is unknown. */
  getVfxAnchor(side: PresentationSide, name: string, out: { x: number; y: number; z: number }): boolean;
}

export interface PresentationFrame {
  readonly dtSeconds: number;
  /** The latest state, or null before the first tick. */
  readonly state: MatchPresentationState | null;
}

export interface PresentationSystem {
  /** Unique within a hub. */
  readonly id: string;
  create?(context: PresentationContext): void;
  /** Called after every tick that produced events or changed state. `events` may be empty. */
  onEvents?(events: readonly PresentationEvent[], state: MatchPresentationState): void;
  /** Called once per rendered frame. */
  update?(frame: PresentationFrame): void;
  /** A restart: drop everything running (particles, trails, timers) and forget stale references. */
  reset?(): void;
  /** Release meshes, materials, listeners. Called exactly once. */
  dispose(): void;
  /** Live counters for observability (active effects, particles...). */
  getStats?(): Readonly<Record<string, number>>;
}

export interface PresentationHubStats {
  readonly systems: number;
  readonly ticksDispatched: number;
  readonly eventsDispatched: number;
  readonly systemErrors: number;
  readonly perSystem: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

export interface PresentationHubOptions {
  /** Called when a system throws. Default: console.error once per system id. */
  readonly onSystemError?: (systemId: string, error: unknown) => void;
}

/** Id under which the hub's own derivation errors are reported. */
export const HUB_ERROR_ID = 'presentation-hub';

const NO_IMPACT: Readonly<Record<PresentationSide, RecentImpact | null>> = { first: null, second: null };

export class PresentationHub {
  private readonly systems: PresentationSystem[] = [];
  private readonly deriver = new PresentationEventDeriver();
  private readonly reportedErrors = new Set<string>();
  private recentImpact = NO_IMPACT;
  private latestState: MatchPresentationState | null = null;
  private ticksDispatched = 0;
  private eventsDispatched = 0;
  private systemErrors = 0;
  private disposed = false;

  constructor(
    private readonly context: PresentationContext,
    private readonly options: PresentationHubOptions = {},
  ) {}

  get features(): PresentationFeatures {
    return this.context.features;
  }

  /** Attaches a system and calls its create(). Returns a function that detaches (and disposes) it. */
  attach(system: PresentationSystem): () => void {
    if (this.disposed) throw new Error(`PresentationHub.attach("${system.id}"): the hub is disposed.`);
    if (this.has(system.id)) throw new Error(`PresentationHub.attach("${system.id}"): a system with this id is already attached.`);
    this.systems.push(system);
    this.guard(system, () => system.create?.(this.context));
    return () => this.detach(system.id);
  }

  /** Detaches and disposes one system. No-op if it is not attached. */
  detach(id: string): void {
    const index = this.systems.findIndex((system) => system.id === id);
    if (index < 0) return;
    const [system] = this.systems.splice(index, 1);
    if (system) this.guard(system, () => system.dispose());
  }

  has(id: string): boolean {
    return this.systems.some((system) => system.id === id);
  }

  systemIds(): readonly string[] {
    return this.systems.map((system) => system.id);
  }

  /** The latest state a tick produced, or null before the first. */
  getState(): MatchPresentationState | null {
    return this.latestState;
  }

  /**
   * Feeds one finished tick: derives the events, folds them into the recent
   * impact memory, builds the state with `buildState` and delivers both.
   * `buildState` receives the folded recent-impact record so the state it
   * returns carries it.
   */
  onTick(input: PresentationTickInput, buildState: (recentImpact: Readonly<Record<PresentationSide, RecentImpact | null>>) => MatchPresentationState): PresentationEvent[] {
    if (this.disposed) return [];
    // Deriving and building state is presentation work too: if it ever throws it
    // is counted and skipped, never allowed to take the simulation's tick down.
    let events: PresentationEvent[];
    let state: MatchPresentationState;
    try {
      events = this.deriver.derive(input);
      this.recentImpact = foldRecentImpact(this.recentImpact, events);
      state = buildState(this.recentImpact);
    } catch (error) {
      this.recordError(HUB_ERROR_ID, error);
      return [];
    }
    this.latestState = state;
    this.ticksDispatched++;
    this.eventsDispatched += events.length;
    for (const system of [...this.systems]) {
      this.guard(system, () => system.onEvents?.(events, state));
    }
    return events;
  }

  /** Per rendered frame. */
  update(dtSeconds: number): void {
    if (this.disposed) return;
    const frame: PresentationFrame = { dtSeconds, state: this.latestState };
    for (const system of [...this.systems]) {
      this.guard(system, () => system.update?.(frame));
    }
  }

  /** A restart of the round inside the same session: edge state and every system's running effects are dropped. */
  reset(): void {
    if (this.disposed) return;
    this.deriver.reset();
    this.recentImpact = NO_IMPACT;
    this.latestState = null;
    for (const system of [...this.systems]) {
      this.guard(system, () => system.reset?.());
    }
  }

  /** Disposes every system, newest first. Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    while (this.systems.length > 0) {
      const system = this.systems.pop();
      if (system) this.guard(system, () => system.dispose());
    }
    this.latestState = null;
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  getStats(): PresentationHubStats {
    const perSystem: Record<string, Readonly<Record<string, number>>> = {};
    for (const system of this.systems) {
      if (system.getStats) perSystem[system.id] = system.getStats();
    }
    return { systems: this.systems.length, ticksDispatched: this.ticksDispatched, eventsDispatched: this.eventsDispatched, systemErrors: this.systemErrors, perSystem };
  }

  private guard(system: PresentationSystem, action: () => void): void {
    try {
      action();
    } catch (error) {
      this.recordError(system.id, error);
    }
  }

  private recordError(id: string, error: unknown): void {
    this.systemErrors++;
    if (this.options.onSystemError) {
      this.options.onSystemError(id, error);
    } else if (!this.reportedErrors.has(id)) {
      this.reportedErrors.add(id);
      console.error(`PresentationHub: "${id}" threw and was isolated.`, error);
    }
  }
}
