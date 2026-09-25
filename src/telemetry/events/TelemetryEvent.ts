// ============================================================
// TELEMETRY EVENT TYPES
// Full gameplay event catalog (GDD section 74) grows with each milestone.
// Only the foundational events exist yet; combat/AI/replay events are added
// alongside the systems that produce them.
// ============================================================

export enum TelemetryEventKind {
  AppBoot = 'AppBoot',
  Error = 'Error',
  PhysicsAnomaly = 'PhysicsAnomaly',
}

export interface TelemetryEventBase {
  kind: TelemetryEventKind;
  /** Fixed-simulation tick index at the moment this event was recorded, or -1 outside of an active simulation. */
  tick: number;
  /** Wall-clock time for correlating with browser logs. */
  timestampMs: number;
}

export interface AppBootEvent extends TelemetryEventBase {
  kind: TelemetryEventKind.AppBoot;
  buildVersion: string;
  commitHash: string | null;
}

export interface ErrorEvent extends TelemetryEventBase {
  kind: TelemetryEventKind.Error;
  message: string;
  stack: string | null;
}

export interface PhysicsAnomalyEvent extends TelemetryEventBase {
  kind: TelemetryEventKind.PhysicsAnomaly;
  anomalyKind: string;
  detail: string;
}

export type TelemetryEvent = AppBootEvent | ErrorEvent | PhysicsAnomalyEvent;
