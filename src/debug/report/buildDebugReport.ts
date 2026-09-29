// ============================================================
// DEBUG REPORT (GDD sections 70 "export debug report", 72, 77 "Copy Debug Report")
// One JSON snapshot of a live Debug Lab match: build/commit, match ID,
// seed, tick, controllers, rules, the full GDD 69 inspection, every debug
// mutation, physics anomalies and errors, and the recent telemetry. Enough
// to reproduce or triage a bug without the person who saw it.
// Replay reproduction proper (input timeline, periodic hashes) is
// Milestone 9 (GDD sections 76, 145); the report says so explicitly.
// ============================================================

import type { MatchSession } from '../../app/session/MatchSession';
import { TelemetryEventKind, type TelemetryEvent } from '../../telemetry/events/TelemetryEvent';
import { buildInspection, type InspectionFrameStats, type InspectorSection } from '../inspectors/buildInspection';

// ============================================================
// DEBUG REPORT — TUNING
// ============================================================

/** Most recent telemetry events copied into a report (the recorder keeps more). */
export const DEBUG_REPORT_RECENT_EVENT_COUNT = 400;

export const DEBUG_REPORT_FORMAT = 'ChaosBeyDebugReportV1';

export interface DebugReport {
  readonly format: typeof DEBUG_REPORT_FORMAT;
  readonly generatedAtIso: string;
  readonly build: { readonly version: string; readonly commit: string | null };
  readonly match: {
    readonly matchId: string;
    readonly seed: string;
    readonly tick: number;
    readonly roundResult: string;
    readonly controllers: { readonly first: string; readonly second: string };
    readonly beys: { readonly first: string; readonly second: string };
    readonly rules: Record<string, unknown>;
  };
  /** True once any Debug Lab mutation ran: the seed alone no longer reproduces this state. */
  readonly mutated: boolean;
  readonly mutations: readonly { readonly tickIndex: number; readonly description: string }[];
  readonly anomalies: readonly TelemetryEvent[];
  readonly errors: readonly TelemetryEvent[];
  readonly inspection: readonly InspectorSection[];
  readonly telemetry: { readonly retainedCount: number; readonly recent: readonly TelemetryEvent[] };
  /** M9: the match's state hash now, and whether it is being recorded or replayed (full replays are separate ChaosBeyReplayV1 files). */
  readonly replay: {
    readonly status: 'recording' | 'replaying' | 'idle';
    readonly stateHash: string;
    readonly ticksCompleted: number;
    readonly detail: string;
  };
}

export function buildDebugReport(session: MatchSession, frame: InspectionFrameStats, now: Date = new Date()): DebugReport {
  const events = session.telemetry.getEvents();
  const mutations = session.getDebugMutations();
  return {
    format: DEBUG_REPORT_FORMAT,
    generatedAtIso: now.toISOString(),
    build: { version: __APP_BUILD_VERSION__, commit: __APP_COMMIT_HASH__ },
    match: {
      matchId: session.matchId,
      seed: session.rngStreams.rootSeedText,
      tick: session.getTickIndex(),
      roundResult: session.roundState.result,
      controllers: { first: session.describeController('first'), second: session.describeController('second') },
      beys: { first: session.getBey('first').definition.id, second: session.getBey('second').definition.id },
      rules: { ...(session.matchConfig as unknown as Record<string, unknown>) },
    },
    mutated: mutations.length > 0,
    mutations: [...mutations],
    anomalies: events.filter((e) => e.kind === TelemetryEventKind.PhysicsAnomaly),
    errors: events.filter((e) => e.kind === TelemetryEventKind.Error),
    inspection: buildInspection(session, frame),
    telemetry: { retainedCount: events.length, recent: events.slice(-DEBUG_REPORT_RECENT_EVENT_COUNT) },
    replay: {
      status: session.isCapturingReplay() ? 'recording' : frame.replayState !== undefined ? 'replaying' : 'idle',
      stateHash: session.getStateHash(),
      ticksCompleted: session.getTickIndex(),
      detail: frame.replayState ?? 'not recording or replaying; record from the Debug Lab Replay panel for a ChaosBeyReplayV1 file',
    },
  };
}

export function debugReportFileName(report: DebugReport): string {
  const safeSeed = report.match.seed.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
  return `chaosbey-debug-${safeSeed}-t${report.match.tick}.json`;
}
