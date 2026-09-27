// ============================================================
// AI AIR DASH AFTER A LAUNCH — ORGANIC AI-vs-AI SWEEP (MILESTONE 7 HOTFIX)
// Every archetype pairing over several seeds, real physics + tickMatch().
// Owner decision (after PR #16): a Dash charge the AI is holding when it is
// launched/knocked airborne is kept held through that flight — through the
// reaction delay, AirRecover and any later decision — until it is back on
// the ground. So, per side and per airborne period, this counts Dash
// releases (ChargingDash -> DashActive while airborne) and classifies them:
// - bug class: after the launch was seen (the air-recovery window, armed
//   only by DodgeController.registerLaunch, never by a normal jump) with a
//   charge already held at that moment, the AI stopped holding Attack;
// - resource end: same situation, but Attack was still held — Attack
//   Energy ran out and AttackController ended the charge itself (allowed);
// - other: a release in a flight with no launch before it (a voluntary
//   jump/hop — air attacks stay allowed), or a charge started after the
//   launch was seen. Reported only.
// ============================================================

import { describe, expect, it } from 'vitest';
import { ALL_BEY_ARCHETYPES } from '../../src/bey/archetype/BeyArchetypes';
import { AttackState } from '../../src/combat/attacks/AttackController';
import { Action, type ControllerActions } from '../../src/input/actions/Action';
import { isGrounded } from '../../src/physics/collision/GroundCheck';
import type { CombatHarness } from './combatHarness';
import { runAiMatch } from './aiMatchRunner';

const SEEDS = Array.from({ length: 40 }, (_, i) => `airdash-${i}`);
const MAX_TICKS = 3600;

export interface AirDashCounts {
  /** Launches seen while a charge (or the Attack hold that becomes one) was already held. */
  launchesWhileCharging: number;
  /** The bug class: in such a flight, a Dash released because the AI stopped holding Attack. */
  releasedByAi: number;
  /** In such a flight, the charge ended with Attack still held (Attack Energy ran out). */
  releasedByResources: number;
  /** Airborne releases outside that situation (voluntary jumps, or charges started after the launch). */
  otherAirReleases: number;
}

interface FlightTracker {
  airborne: boolean;
  launchSeen: boolean;
  /** A charge was held at the moment the launch was first seen in this flight. */
  chargeHeldAtLaunch: boolean;
  previousAttackState: AttackState;
}

function track(t: FlightTracker, bey: CombatHarness['first'], actions: ControllerActions, harness: CombatHarness, counts: AirDashCounts): void {
  const state = bey.attack.getState();
  // t.airborne is still the state at the start of this tick.
  if (t.airborne && t.previousAttackState === AttackState.ChargingDash && state === AttackState.DashActive) {
    if (t.chargeHeldAtLaunch) {
      if (actions.held.has(Action.Attack)) counts.releasedByResources++;
      else counts.releasedByAi++;
    } else {
      counts.otherAirReleases++;
    }
    t.chargeHeldAtLaunch = false;
  } else if (t.chargeHeldAtLaunch && state !== AttackState.Buffering && state !== AttackState.ChargingDash) {
    // The hold held at launch ended some other way (a Buffering tap became a
    // Circular): any later charge in this flight is a new press.
    t.chargeHeldAtLaunch = false;
  }

  const grounded = isGrounded(harness.physics, bey.collider);
  if (!t.airborne && !grounded) {
    t.airborne = true;
    t.launchSeen = false;
    t.chargeHeldAtLaunch = false;
  } else if (t.airborne && grounded) {
    t.airborne = false;
  }
  if (t.airborne && !t.launchSeen && bey.dodge.isAirRecoveryAvailable()) {
    t.launchSeen = true;
    t.chargeHeldAtLaunch = state === AttackState.ChargingDash || state === AttackState.Buffering;
    if (t.chargeHeldAtLaunch) counts.launchesWhileCharging++;
  }
  t.previousAttackState = state;
}

export async function sweepAirDashes(seeds: readonly string[], maxTicks: number): Promise<AirDashCounts> {
  const counts: AirDashCounts = { launchesWhileCharging: 0, releasedByAi: 0, releasedByResources: 0, otherAirReleases: 0 };
  for (const firstDefinition of ALL_BEY_ARCHETYPES) {
    for (const secondDefinition of ALL_BEY_ARCHETYPES) {
      for (const seed of seeds) {
        const first: FlightTracker = { airborne: false, launchSeen: false, chargeHeldAtLaunch: false, previousAttackState: AttackState.Neutral };
        const second: FlightTracker = { ...first };
        await runAiMatch({
          seed: `${seed}/${firstDefinition.id}-vs-${secondDefinition.id}`,
          firstDefinition,
          secondDefinition,
          maxTicks,
          onTick: (_tick, harness, firstActions, secondActions) => {
            track(first, harness.first, firstActions, harness, counts);
            track(second, harness.second, secondActions, harness, counts);
          },
        });
      }
    }
  }
  return counts;
}

describe('AI air Dash after a launch — organic AI-vs-AI sweep', () => {
  it('never lets go of a charge it was holding when launched while still in that flight', async () => {
    const counts = await sweepAirDashes(SEEDS, MAX_TICKS);
    console.log(`[air-dash sweep] ${JSON.stringify(counts)}`);
    // The sweep must actually contain the situation, or it proves nothing.
    expect(counts.launchesWhileCharging).toBeGreaterThan(5);
    expect(counts.releasedByAi).toBe(0);
  }, 600_000);
});
