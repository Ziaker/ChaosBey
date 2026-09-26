// ============================================================
// AI JUMP/DRIFT — REAL PHYSICS INTEGRATION TEST (MILESTONE 7)
// Regression for the M7 part 1 review: a unit test proving ActionSelection
// presses JumpDrift for one tick is NOT proof the AI can actually drift —
// DriftController only transitions Hopping->Drifting if JumpDrift AND
// steering are BOTH still held the moment it re-lands. This drives the
// real ActionSelector against a real CombatHarness/DriftController and
// requires the state machine to actually reach DriftState.Drifting, then
// recover correctly once the intent stops.
// ============================================================

import { describe, expect, it } from 'vitest';
import { AttackState } from '../../src/combat/attacks/AttackController';
import { DodgeState } from '../../src/dodge/DodgeController';
import { DriftState } from '../../src/drift/DriftController';
import { ActionSelector } from '../../src/ai/decision/ActionSelection';
import { AiIntent } from '../../src/ai/decision/Intent';
import { buildWorldState } from '../../src/ai/decision/WorldState';
import { perceiveCombatant, type CombatantRawState } from '../../src/ai/perception/AiPerception';
import { ATTACK_AI_PERSONALITY } from '../../src/ai/personalities/AiArchetypePersonalities';
import { ClashState } from '../../src/combat/clash/ClashController';
import { isGrounded } from '../../src/physics/collision/GroundCheck';
import { FIXED_DELTA_SECONDS } from '../../src/physics/fixed-step/FixedTimestepLoop';
import { CombatHarness } from './combatHarness';

describe('AI jump/drift — real physics', () => {
  it('sustains JumpDrift through Hopping into a real DriftState.Drifting, then recovers once the intent stops', async () => {
    const harness = await CombatHarness.create();
    const selector = new ActionSelector();

    // A fixed, off-heading target 90 degrees to the side (not the harness's
    // real opponent) keeps ActionSelection's steering output constantly
    // active for the whole run — the point of this test is proving the
    // hop-into-drift sequence itself, not depending on the Bey's own
    // heading happening to already point at a real opponent.
    const fixedSideTargetXZ = { x: 100, z: 0 };

    function currentWorldState(intent: AiIntent) {
      const body = harness.second.body;
      const translation = body.translation();
      const velocity = body.linvel();
      const ownRaw: CombatantRawState = {
        positionXZ: { x: translation.x, z: translation.z },
        velocityXZ: { x: velocity.x, z: velocity.z },
        headingRad: harness.second.movement.getHeadingRad(),
        grounded: isGrounded(harness.physics, harness.second.collider),
        attackState: harness.second.attack.getState(),
        dashChargeFraction: 0,
        dodgeState: harness.second.dodge.getState(),
        driftState: harness.second.drift.getState(),
        staminaFraction: 1,
        stabilityFraction: 1,
        isBroken: false,
        attackEnergyFraction: 1,
      };
      const opponentRaw: CombatantRawState = {
        ...ownRaw,
        positionXZ: fixedSideTargetXZ,
        velocityXZ: { x: 0, z: 0 },
        attackState: AttackState.Neutral,
        dodgeState: DodgeState.Idle,
        driftState: DriftState.Idle,
      };
      return buildWorldState(0, perceiveCombatant(ownRaw), perceiveCombatant(opponentRaw), { state: ClashState.Idle, cooldownRemainingS: 0 });
    }

    let reachedHopping = false;
    let reachedDrifting = false;
    let recoveredAfterDrifting = false;
    let intent = AiIntent.UseJumpDrift;

    for (let i = 0; i < 240; i++) {
      const driftState = harness.second.drift.getState();
      if (driftState === DriftState.Hopping) reachedHopping = true;
      if (driftState === DriftState.Drifting) reachedDrifting = true;
      // Stop willing JumpDrift once a real Drifting period has been
      // observed for a while — proves release/recovery works too, not just
      // entry.
      if (reachedDrifting && driftState !== DriftState.Idle) {
        intent = AiIntent.Circle; // any non-UseJumpDrift intent releases the button.
      }
      if (reachedDrifting && (driftState === DriftState.Idle || driftState === DriftState.Recovering)) {
        recoveredAfterDrifting = true;
      }

      const world = currentWorldState(intent);
      const secondActions = selector.selectActions(intent, world, ATTACK_AI_PERSONALITY, false, FIXED_DELTA_SECONDS);
      const firstActions = { held: new Set<never>(), pressedThisFrame: new Set<never>(), attackHoldDurationSeconds: 0, jumpDriftHoldDurationSeconds: 0 };
      harness.tick(firstActions, secondActions);

      if (recoveredAfterDrifting) break;
    }

    expect(reachedHopping).toBe(true);
    expect(reachedDrifting).toBe(true);
    expect(recoveredAfterDrifting).toBe(true);
  });
});
