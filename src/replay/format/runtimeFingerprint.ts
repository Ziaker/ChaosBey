// ============================================================
// RUNTIME FINGERPRINT (M9 lane B — owner decision 6, GDD 77)
// Which build recorded a replay. Chromium is the only reference browser,
// so the fingerprint is general: build version, commit and Rapier version.
// A mismatch is reported to the caller, never silently ignored; whether it
// refuses playback is the playback side's decision.
// ============================================================

import RAPIER from '@dimforge/rapier3d-compat';
import type { RuntimeFingerprint } from '../contracts';

/** The running build's fingerprint. Initializes Rapier if needed (idempotent). */
export async function currentRuntimeFingerprint(): Promise<RuntimeFingerprint> {
  await RAPIER.init();
  return { buildVersion: __APP_BUILD_VERSION__, commit: __APP_COMMIT_HASH__, rapierVersion: RAPIER.version() };
}

export interface FingerprintMismatch {
  readonly field: keyof RuntimeFingerprint;
  readonly recorded: string | null;
  readonly current: string | null;
}

/** Every field where the recording's build differs from the current one (empty = same build). */
export function compareFingerprints(recorded: RuntimeFingerprint, current: RuntimeFingerprint): FingerprintMismatch[] {
  const fields: (keyof RuntimeFingerprint)[] = ['buildVersion', 'commit', 'rapierVersion'];
  return fields.filter((field) => recorded[field] !== current[field]).map((field) => ({ field, recorded: recorded[field], current: current[field] }));
}
