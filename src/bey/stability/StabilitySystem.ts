// ============================================================
// STABILITY SYSTEM
// Model C — Stability Break (GDD section 29): zero Stability enters a
// Broken (vulnerable) state rather than ending the round outright. Only a
// subsequent qualifying hit while Broken causes a KO. This module only
// tracks that state; round-rules decides what a KO actually does.
// ============================================================

import { Resource } from '../core/Resource';
import {
  STABILITY_BROKEN_RECOVERY_DELAY_AFTER_HIT_S,
  STABILITY_BROKEN_RECOVERY_FLOOR,
  STABILITY_MAX,
  STABILITY_QUALIFYING_HIT_MIN_DAMAGE,
  STABILITY_RECOVERY_DELAY_AFTER_HIT_S,
  STABILITY_RECOVERY_PER_S,
} from './StabilityTuning';
import type { CanonicalRecord } from '../../replay/state/CanonicalValue';

/** The Stability recovery numbers of a match: the game's own by default; a Bey Real match fills them from its sliders. */
export interface StabilityRecoveryTuning {
  /** Seconds without taking damage before Stability starts to climb back. */
  readonly recoveryDelayS: number;
  readonly recoveryPerS: number;
  /**
   * null = the classic Broken (recovers after STABILITY_BROKEN_RECOVERY_DELAY_AFTER_HIT_S, then climbs to the floor).
   * A number = Broken ends this many seconds after the last damage, back at the recovery floor (Bey Real's "Tempo Quebrado").
   */
  readonly brokenDurationS: number | null;
}

export const DEFAULT_STABILITY_RECOVERY: StabilityRecoveryTuning = {
  recoveryDelayS: STABILITY_RECOVERY_DELAY_AFTER_HIT_S,
  recoveryPerS: STABILITY_RECOVERY_PER_S,
  brokenDurationS: null,
};

export class StabilitySystem {
  readonly resource = new Resource(STABILITY_MAX);

  constructor(private readonly recovery: StabilityRecoveryTuning = DEFAULT_STABILITY_RECOVERY) {}

  /** Seconds since the last Stability damage (Infinity if never hit) — Debug Lab inspection only (GDD section 69). */
  getTimeSinceLastDamageS(): number {
    return this.timeSinceLastDamageS;
  }
  private timeSinceLastDamageS = Number.POSITIVE_INFINITY;
  private broken = false;

  get isBroken(): boolean {
    return this.broken;
  }

  /** Owner decision (2026-09-25): Broken is recoverable — avoiding hits for long enough (a longer delay than normal in-fight recovery) climbs Stability back to a small floor and exits Broken, rather than staying broken forever until KO/next round. */
  tick(fixedDeltaSeconds: number): void {
    this.timeSinceLastDamageS += fixedDeltaSeconds;

    if (this.broken) {
      if (this.recovery.brokenDurationS !== null) {
        if (this.timeSinceLastDamageS >= this.recovery.brokenDurationS) {
          this.resource.set(Math.max(this.resource.value, STABILITY_BROKEN_RECOVERY_FLOOR));
          this.broken = false;
        }
        return;
      }
      if (this.timeSinceLastDamageS >= STABILITY_BROKEN_RECOVERY_DELAY_AFTER_HIT_S) {
        this.resource.add(this.recovery.recoveryPerS * fixedDeltaSeconds);
        if (this.resource.value >= STABILITY_BROKEN_RECOVERY_FLOOR) {
          this.broken = false;
        }
      }
      return;
    }

    if (this.timeSinceLastDamageS >= this.recovery.recoveryDelayS) {
      this.resource.add(this.recovery.recoveryPerS * fixedDeltaSeconds);
    }
  }

  /** Applies Stability damage from a hit/wall impact. Returns true if this specific hit qualifies as KO-causing (damage above threshold AND the Bey was already Broken when it landed). */
  applyDamage(amount: number): { causedBreak: boolean; isQualifyingKoHit: boolean } {
    const wasBrokenBeforeThisHit = this.broken;
    this.timeSinceLastDamageS = 0;
    this.resource.subtract(amount);

    let causedBreak = false;
    if (this.resource.isEmpty && !this.broken) {
      this.broken = true;
      causedBreak = true;
    }

    const isQualifyingKoHit = wasBrokenBeforeThisHit && amount >= STABILITY_QUALIFYING_HIT_MIN_DAMAGE;
    return { causedBreak, isQualifyingKoHit };
  }

  /**
   * Debug Lab "set Stability" (GDD section 70) — an explicit mutation, never
   * called by gameplay. 0 enters Broken exactly like a hit would; a value at
   * or above the Broken recovery floor exits it; anything in between keeps
   * the current Broken state.
   */
  debugSetValue(value: number): void {
    this.resource.set(value);
    if (this.resource.isEmpty) this.broken = true;
    else if (this.resource.value >= STABILITY_BROKEN_RECOVERY_FLOOR) this.broken = false;
  }

  /** Only round-rules calls this, once a KO has actually been resolved — resets Broken for the next round. */
  resetForNewRound(): void {
    this.broken = false;
    this.timeSinceLastDamageS = Number.POSITIVE_INFINITY;
    this.resource.set(this.resource.max);
  }

  /** Read-only: this system's part of CanonicalMatchStateV1 (M9 state hash). */
  getDeterministicState(): CanonicalRecord {
    return { resource: this.resource.value, timeSinceLastDamageS: this.timeSinceLastDamageS, broken: this.broken };
  }
}
