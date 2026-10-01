// ============================================================
// HITSTOP (simulation state — owner decision, M9)
// A strong impact freezes gameplay for a short, magnitude-scaled window:
// tickMatch() doesn't run on a frozen tick. Because it decides whether the
// simulation advances, hitstop is simulation state, owned here. The camera
// and VFX only read it (they used to own the timer).
//
// The rule and the arithmetic are the ones CombatCameraController applied
// before M9, so live play freezes on exactly the same ticks:
// - every impact of magnitude >= HITSTOP_MIN_MAGNITUDE sets the
//   remaining time to max(remaining, min(MAX, magnitude * PER_MAGNITUDE));
// - the remaining time then decays by the fixed delta on every tick,
//   frozen or not, so the freeze always ends;
// - while a Clash is Active the Clash already freezes the match, so
//   hitstop does not report a freeze on those ticks.
// ============================================================

import { HITSTOP_DURATION_PER_MAGNITUDE_S, HITSTOP_MAX_DURATION_S, HITSTOP_MIN_MAGNITUDE } from './HitstopTuning';
import type { CanonicalRecord } from '../../replay/state/CanonicalValue';

export class HitstopClock {
  private remainingS = 0;
  private suppressedByClash = false;

  /** Whether gameplay is frozen on the tick about to run. Read before sampling controllers. */
  isFreezing(): boolean {
    return !this.suppressedByClash && this.remainingS > 0;
  }

  getRemainingS(): number {
    return this.remainingS;
  }

  /**
   * Called once per tick, after the (possibly skipped) simulation step,
   * with the impact magnitudes that tick produced (none on a frozen tick).
   */
  advance(impactMagnitudes: readonly number[], clashActive: boolean, fixedDeltaSeconds: number): void {
    for (const magnitude of impactMagnitudes) {
      if (magnitude >= HITSTOP_MIN_MAGNITUDE) {
        const duration = Math.min(HITSTOP_MAX_DURATION_S, magnitude * HITSTOP_DURATION_PER_MAGNITUDE_S);
        this.remainingS = Math.max(this.remainingS, duration);
      }
    }
    this.remainingS = Math.max(0, this.remainingS - fixedDeltaSeconds);
    this.suppressedByClash = clashActive;
  }

  /** Read-only: this system's part of CanonicalMatchStateV1 (M9 state hash). */
  getDeterministicState(): CanonicalRecord {
    return { remainingS: this.remainingS, suppressedByClash: this.suppressedByClash };
  }
}
