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

export class AttackEnergySystem {
  readonly resource = new Resource(ATTACK_ENERGY_MAX);
  private timeSinceLastConsumptionS = Number.POSITIVE_INFINITY;

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
}
