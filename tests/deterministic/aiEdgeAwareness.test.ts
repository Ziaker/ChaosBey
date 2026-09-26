// ============================================================
// AI EDGE / RING-OUT AWARENESS — INTEGRATION TEST (MILESTONE 7)
// GDD section 129: the AI must know when it is at risk near the boundary
// and attempt recovery, without any hidden teleport — recovery must be a
// real, physically-driven movement toward the center.
// ============================================================

import { describe, expect, it } from 'vitest';
import { AIController } from '../../src/ai/controllers/AIController';
import { DEFAULT_AI_DIFFICULTY_PROFILE } from '../../src/ai/difficulty/AiDifficultyProfile';
import { DEFENSE_AI_PERSONALITY } from '../../src/ai/personalities/AiArchetypePersonalities';
import { IdleController } from '../../src/automation/scripted-scenarios/IdleController';
import { RINGOUT_RADIUS_M } from '../../src/arena/ringout/RingOutTuning';
import { isRingOut } from '../../src/arena/ringout/RingOut';
import { FIXED_DELTA_SECONDS } from '../../src/physics/fixed-step/FixedTimestepLoop';
import { SeededRng } from '../../src/rng/SeededRng';
import { CombatHarness } from './combatHarness';

describe('AI edge/ring-out awareness', () => {
  it('moves back toward the center instead of standing still or wandering further out when spawned near the boundary', async () => {
    const nearEdgeZ = RINGOUT_RADIUS_M - 1;
    const harness = await CombatHarness.create({ x: 0, y: 0.6, z: -2 }, { x: 0, y: 0.6, z: nearEdgeZ });
    const ai = new AIController(
      harness.physics,
      harness.second,
      harness.first,
      harness.clash.controller,
      DEFENSE_AI_PERSONALITY,
      DEFAULT_AI_DIFFICULTY_PROFILE,
      SeededRng.fromSeedText('edge-awareness-seed'),
    );
    const idle = new IdleController();

    let neverRingedOut = true;
    let closestApproachToEdge = Number.POSITIVE_INFINITY;
    let furthestFromEdgeAfterSettling = 0;

    for (let i = 0; i < 300; i++) {
      const firstActions = idle.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS });
      const secondActions = ai.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS });
      const result = harness.tick(firstActions, secondActions);
      if (result.ringOutSecond) neverRingedOut = false;

      const t = harness.second.body.translation();
      const distanceFromCenter = Math.hypot(t.x, t.z);
      closestApproachToEdge = Math.min(closestApproachToEdge, RINGOUT_RADIUS_M - distanceFromCenter);
      if (i > 60) {
        furthestFromEdgeAfterSettling = Math.max(furthestFromEdgeAfterSettling, RINGOUT_RADIUS_M - distanceFromCenter);
      }
    }

    expect(neverRingedOut).toBe(true);
    expect(isRingOut({ x: harness.second.body.translation().x, z: harness.second.body.translation().z })).toBe(false);
    // Having spawned only 1m from the boundary, a working edge-recovery
    // reflex should manage to put real distance (several meters) between
    // itself and the boundary at some point during the run.
    expect(furthestFromEdgeAfterSettling).toBeGreaterThan(2);
  });
});
