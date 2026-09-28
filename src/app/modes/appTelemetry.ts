// ============================================================
// APP-LEVEL TELEMETRY HOOKS
// Boot metadata and uncaught errors (GDD sections 72, 116, 117) — shared
// by every app mode so none of them can forget to report errors.
// ============================================================

import { TelemetryEventKind } from '../../telemetry/events/TelemetryEvent';
import type { TelemetryRecorder } from '../../telemetry/recording/TelemetryRecorder';

export function recordAppBoot(telemetry: TelemetryRecorder): void {
  telemetry.record({ kind: TelemetryEventKind.AppBoot, buildVersion: __APP_BUILD_VERSION__, commitHash: __APP_COMMIT_HASH__ });
}

/** Errors must reach telemetry, not just the console (GDD section 117). */
export function recordError(telemetry: TelemetryRecorder, error: unknown): void {
  telemetry.record({
    kind: TelemetryEventKind.Error,
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? (error.stack ?? null) : null,
  });
}

/** Routes window errors into `getTelemetry()`'s current recorder — a getter, so a mode that replaces its recorder (Debug Lab restart) keeps reporting into the live one. */
export function recordUncaughtErrors(telemetry: TelemetryRecorder | (() => TelemetryRecorder)): void {
  const current = typeof telemetry === 'function' ? telemetry : () => telemetry;
  window.addEventListener('error', (event) => recordError(current(), event.error ?? event.message));
  window.addEventListener('unhandledrejection', (event) => recordError(current(), event.reason));
}
