// ============================================================
// TELEMETRY RECORDER SANITY (M7 ALPHA-READINESS HARDENING)
// GDD section 72/116/117: telemetry is the record of what actually
// happened (errors, hits, round outcomes) — no test existed for this
// foundational class before. Covers tick/timestamp stamping, ordering,
// getLastEvent(), and the ring-buffer cap that keeps a long run's memory
// bounded (GDD section 72's own "not raw per-frame dumps" reasoning).
// ============================================================

import { describe, expect, it } from 'vitest';
import { TelemetryEventKind } from '../../src/telemetry/events/TelemetryEvent';
import { TelemetryRecorder } from '../../src/telemetry/recording/TelemetryRecorder';

describe('TelemetryRecorder', () => {
  it('stamps each event with the current tick and a timestamp', () => {
    const recorder = new TelemetryRecorder();
    recorder.setCurrentTick(42);
    recorder.record({ kind: TelemetryEventKind.AppBoot, buildVersion: '0.0.0', commitHash: 'abc123' });

    const [event] = recorder.getEvents();
    expect(event?.tick).toBe(42);
    expect(event?.timestampMs).toBeGreaterThan(0);
  });

  it('defaults to tick -1 before any simulation tick has run', () => {
    const recorder = new TelemetryRecorder();
    recorder.record({ kind: TelemetryEventKind.AppBoot, buildVersion: '0.0.0', commitHash: null });
    expect(recorder.getEvents()[0]?.tick).toBe(-1);
  });

  it('preserves recording order and getLastEvent() matches the most recent one', () => {
    const recorder = new TelemetryRecorder();
    recorder.record({ kind: TelemetryEventKind.Ko, targetIsFirst: true });
    recorder.record({ kind: TelemetryEventKind.RingOut, targetIsFirst: false });

    const events = recorder.getEvents();
    expect(events.map((e) => e.kind)).toEqual([TelemetryEventKind.Ko, TelemetryEventKind.RingOut]);
    expect(recorder.getLastEvent()?.kind).toBe(TelemetryEventKind.RingOut);
  });

  it('getLastEvent() is null before anything has been recorded', () => {
    expect(new TelemetryRecorder().getLastEvent()).toBeNull();
  });

  it('bounds memory with a ring buffer: the oldest events are dropped once the cap is exceeded', () => {
    const recorder = new TelemetryRecorder();
    const CAP = 5000;
    for (let i = 0; i < CAP + 10; i++) {
      recorder.record({ kind: TelemetryEventKind.Ko, targetIsFirst: i % 2 === 0 });
    }
    const events = recorder.getEvents();
    expect(events.length).toBe(CAP);
    const last = recorder.getLastEvent();
    const first = events[0];
    if (last?.kind !== TelemetryEventKind.Ko || first?.kind !== TelemetryEventKind.Ko) throw new Error('expected only Ko events');
    // The 10 oldest records were dropped, so the last event recorded (i = CAP + 9, odd -> targetIsFirst false) is still the most recent...
    expect(last.targetIsFirst).toBe(false);
    // ...and the first surviving one is the 11th ever recorded (i = 10, even -> targetIsFirst true), not the very first (i = 0).
    expect(first.targetIsFirst).toBe(true);
  });
});
