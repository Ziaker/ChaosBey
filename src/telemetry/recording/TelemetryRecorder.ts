// ============================================================
// TELEMETRY RECORDER
// Foundational skeleton (GDD section 72). Records structured events rather
// than raw per-frame dumps. Combat/replay milestones extend this with
// periodic state checkpoints (GDD section 75) and match/seed metadata.
// ============================================================

import type { TelemetryEvent } from '../events/TelemetryEvent';

// Ring-buffer cap so a long self-test batch run can't grow this unbounded
// in memory. Export/report tooling should flush before this is reached.
const MAX_RETAINED_EVENTS = 5000;

// Plain `Omit` does not distribute over a discriminated union: it collapses
// TelemetryEvent to its common keys first, which would drop each variant's
// own fields (e.g. buildVersion, anomalyKind). The `T extends any` naked
// type parameter forces per-member distribution instead.
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

export class TelemetryRecorder {
  private readonly events: TelemetryEvent[] = [];
  private currentTick = -1;

  setCurrentTick(tick: number): void {
    this.currentTick = tick;
  }

  record(event: DistributiveOmit<TelemetryEvent, 'tick' | 'timestampMs'>): void {
    const fullEvent = {
      ...event,
      tick: this.currentTick,
      timestampMs: Date.now(),
    } as TelemetryEvent;

    this.events.push(fullEvent);
    if (this.events.length > MAX_RETAINED_EVENTS) {
      this.events.shift();
    }
  }

  getEvents(): readonly TelemetryEvent[] {
    return this.events;
  }

  getLastEvent(): TelemetryEvent | null {
    return this.events.length > 0 ? this.events[this.events.length - 1]! : null;
  }
}
