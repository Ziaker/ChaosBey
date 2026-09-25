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

export class StabilitySystem {
  readonly resource = new Resource(STABILITY_MAX);
  private timeSinceLastDamageS = Number.POSITIVE_INFINITY;
  private broken = false;

  get isBroken(): boolean {
    return this.broken;
  }

  /** Owner decision (2026-09-25): Broken is recoverable — avoiding hits for long enough (a longer delay than normal in-fight recovery) climbs Stability back to a small floor and exits Broken, rather than staying broken forever until KO/next round. */
  tick(fixedDeltaSeconds: number): void {
    this.timeSinceLastDamageS += fixedDeltaSeconds;

    if (this.broken) {
      if (this.timeSinceLastDamageS >= STABILITY_BROKEN_RECOVERY_DELAY_AFTER_HIT_S) {
        this.resource.add(STABILITY_RECOVERY_PER_S * fixedDeltaSeconds);
        if (this.resource.value >= STABILITY_BROKEN_RECOVERY_FLOOR) {
          this.broken = false;
        }
      }
      return;
    }

    if (this.timeSinceLastDamageS >= STABILITY_RECOVERY_DELAY_AFTER_HIT_S) {
      this.resource.add(STABILITY_RECOVERY_PER_S * fixedDeltaSeconds);
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

  /** Only round-rules calls this, once a KO has actually been resolved — resets Broken for the next round. */
  resetForNewRound(): void {
    this.broken = false;
    this.timeSinceLastDamageS = Number.POSITIVE_INFINITY;
    this.resource.set(this.resource.max);
  }
}
