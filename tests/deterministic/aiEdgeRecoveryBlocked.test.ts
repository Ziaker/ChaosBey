// ============================================================
// EDGE RECOVERY AROUND A BLOCKING OPPONENT — INTEGRATION (M7 PART 2b)
// Real physics + real tickMatch(): the AI starts in edge danger with an
// idle opponent standing between it and the center, slightly off the
// straight line. It must recover around the opponent (sideways, away from
// the opponent's offset) instead of reversing straight into it, and the
// two mirrored setups must produce mirrored recoveries.
// ============================================================

import { describe, expect, it } from 'vitest';
import { AIController } from '../../src/ai/controllers/AIController';
import { AiIntent } from '../../src/ai/decision/Intent';
import { DEFAULT_AI_DIFFICULTY_PROFILE } from '../../src/ai/difficulty/AiDifficultyProfile';
import { DEFENSE_AI_PERSONALITY } from '../../src/ai/personalities/AiArchetypePersonalities';
import { IdleController } from '../../src/automation/scripted-scenarios/IdleController';
import { NullAiMashSource } from '../../src/combat/clash/ClashMash';
import { RoundOutcome } from '../../src/combat/round-rules/RoundState';
import { FIXED_DELTA_SECONDS } from '../../src/physics/fixed-step/FixedTimestepLoop';
import { SeededRng } from '../../src/rng/SeededRng';
import { CombatHarness } from './combatHarness';

const AI_Z = 11;
const BLOCKER_Z = 9;
const RUN_TICKS = 150;

async function recover(blockerOffsetX: number) {
  const harness = await CombatHarness.create({ x: blockerOffsetX, y: 0.5, z: BLOCKER_Z }, { x: 0, y: 0.5, z: AI_Z }, {}, new NullAiMashSource());
  const ai = new AIController(
    harness.physics,
    harness.second,
    harness.first,
    harness.clash.controller,
    { ...DEFENSE_AI_PERSONALITY, errorRate: 0, counterAffinity: 0 },
    DEFAULT_AI_DIFFICULTY_PROFILE,
    SeededRng.fromSeedText('edge-recovery-blocked'),
  );
  const idle = new IdleController();
  const recovery: { x: number; z: number; edgeRisk: number; distanceToBlocker: number }[] = [];
  let everRecovering = true;
  for (let i = 0; i < RUN_TICKS && !harness.roundState.isOver; i++) {
    const actions = ai.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS });
    harness.tick(idle.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }), actions);
    const debug = ai.getDebugState();
    const p = harness.second.body.translation();
    const o = harness.first.body.translation();
    expect(Number.isFinite(p.x) && Number.isFinite(p.z), `tick ${i}: finite position`).toBe(true);
    everRecovering = everRecovering && debug.activeIntent === AiIntent.RecoverFromEdge;
    // The recovery phase: from the start until the first other intent.
    if (everRecovering) recovery.push({ x: p.x, z: p.z, edgeRisk: debug.edgeRiskFraction, distanceToBlocker: Math.hypot(p.x - o.x, p.z - o.z) });
  }
  return { recovery, outcome: harness.roundState.result };
}

describe('AI edge recovery around a blocking opponent (M7 Part 2b, real physics)', () => {
  it('recovers sideways around the blocker (away from its offset), not straight into it, mirror-symmetric, no ring-out', async () => {
    const right = await recover(0.3);
    const left = await recover(-0.3);

    for (const run of [right, left]) {
      expect(run.recovery.length, 'a recovery phase happened').toBeGreaterThan(30);
      expect(run.outcome).not.toBe(RoundOutcome.FirstWinsByRingOut);
      const first = run.recovery[0]!;
      const last = run.recovery[run.recovery.length - 1]!;
      expect(last.edgeRisk, 'edge danger went down').toBeLessThan(first.edgeRisk - 0.2);
      expect(last.z, 'moved inward').toBeLessThan(first.z);
      // Never pushed into the blocker: the gap never closes below its start by more than a small margin.
      const minGap = Math.min(...run.recovery.map((r) => r.distanceToBlocker));
      expect(minGap).toBeGreaterThan(first.distanceToBlocker - 0.4);
    }
    // Around, on the side away from the blocker's offset.
    expect(right.recovery[right.recovery.length - 1]!.x).toBeLessThan(-0.8);
    expect(left.recovery[left.recovery.length - 1]!.x).toBeGreaterThan(0.8);
    // Mirror symmetry, tick for tick (to 5 cm: the physics solver is not
    // bit-exactly mirror-symmetric, the decisions are).
    expect(left.recovery.length).toBe(right.recovery.length);
    for (let i = 0; i < right.recovery.length; i++) {
      expect(left.recovery[i]!.x).toBeCloseTo(-right.recovery[i]!.x, 1);
      expect(left.recovery[i]!.z).toBeCloseTo(right.recovery[i]!.z, 1);
    }
  });
});
