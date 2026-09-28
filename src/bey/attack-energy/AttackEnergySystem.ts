// ============================================================
// ATTACK ENERGY SYSTEM
// See AttackEnergyTuning.ts for the approved conceptual regen model.
// ============================================================

import { Resource } from '../core/Resource';
import {
  ATTACK_ENERGY_CONSUMPTION_PER_S,
  ATTACK_ENERGY_MAX,
  ATTACK_ENERGY_RECOVERY_DELAY_S,
  ATTACK_ENERGY_RECOVERY_PER_S,
} from './AttackEnergyTuning';
import type { CanonicalRecord } from '../../replay/state/CanonicalValue';

export class AttackEnergySystem {
  readonly resource = new Resource(ATTACK_ENERGY_MAX);
  private timeSinceLastConsumptionS = Number.POSITIVE_INFINITY;

  /** Seconds since Attack Energy was last consumed (Infinity if never) — Debug Lab inspection only (GDD section 69). */
  getTimeSinceLastConsumptionS(): number {
    return this.timeSinceLastConsumptionS;
  }

  /** Call once per fixed tick. `isConsuming` = the Bey is actively charging (holding Attack). */
  tick(isConsuming: boolean, fixedDeltaSeconds: number): void {
    if (isConsuming) {
      this.resource.subtract(ATTACK_ENERGY_CONSUMPTION_PER_S * fixedDeltaSeconds);
      this.timeSinceLastConsumptionS = 0;
      return;
    }

    this.timeSinceLastConsumptionS += fixedDeltaSeconds;
    if (this.timeSinceLastConsumptionS >= ATTACK_ENERGY_RECOVERY_DELAY_S) {
      this.resource.add(ATTACK_ENERGY_RECOVERY_PER_S * fixedDeltaSeconds);
    }
  }

  /** Read-only: this system's part of CanonicalMatchStateV1 (M9 state hash). */
  getDeterministicState(): CanonicalRecord {
    return { resource: this.resource.value, timeSinceLastConsumptionS: this.timeSinceLastConsumptionS };
  }
}
