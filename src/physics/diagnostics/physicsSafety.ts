// ============================================================
// PHYSICS SAFETY DIAGNOSTICS
// Catastrophic-numerical-state detection (GDD section 82). This module only
// detects and reports; it must never silently mutate simulation state.
// ============================================================

// Diagnostic-only ceiling. Anything faster than this is reported as
// suspicious; it does not clamp gameplay velocity (that is a movement/
// combat tuning concern, not a diagnostics concern).
export const MAX_SANE_LINEAR_SPEED_MPS = 200;
export const MAX_SANE_ANGULAR_SPEED_RAD_S = 500;

export interface PhysicsAnomaly {
  kind: 'non-finite-value' | 'excessive-linear-speed' | 'excessive-angular-speed';
  detail: string;
}

/** Checks a body's linear velocity components for NaN/Infinity or implausible magnitude. */
export function checkLinearVelocity(x: number, y: number, z: number): PhysicsAnomaly | null {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return { kind: 'non-finite-value', detail: `linear velocity (${x}, ${y}, ${z}) contains a non-finite component` };
  }
  const speed = Math.sqrt(x * x + y * y + z * z);
  if (speed > MAX_SANE_LINEAR_SPEED_MPS) {
    return { kind: 'excessive-linear-speed', detail: `linear speed ${speed.toFixed(2)} m/s exceeds ${MAX_SANE_LINEAR_SPEED_MPS} m/s` };
  }
  return null;
}

/** Checks a body's angular velocity components for NaN/Infinity or implausible magnitude. */
export function checkAngularVelocity(x: number, y: number, z: number): PhysicsAnomaly | null {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return { kind: 'non-finite-value', detail: `angular velocity (${x}, ${y}, ${z}) contains a non-finite component` };
  }
  const speed = Math.sqrt(x * x + y * y + z * z);
  if (speed > MAX_SANE_ANGULAR_SPEED_RAD_S) {
    return { kind: 'excessive-angular-speed', detail: `angular speed ${speed.toFixed(2)} rad/s exceeds ${MAX_SANE_ANGULAR_SPEED_RAD_S} rad/s` };
  }
  return null;
}
