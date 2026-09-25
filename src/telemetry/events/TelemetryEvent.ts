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
  MovementImpact = 'MovementImpact',
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

/**
 * A significant, unmodeled velocity change detected on the Bey body — a
 * wall/floor bounce today. Provisional/generic until combat exists to
 * distinguish WallImpact from BeyCollision etc. (GDD section 74).
 */
export interface MovementImpactEvent extends TelemetryEventBase {
  kind: TelemetryEventKind.MovementImpact;
  speedDeltaMps: number;
}

export type TelemetryEvent = AppBootEvent | ErrorEvent | PhysicsAnomalyEvent | MovementImpactEvent;
