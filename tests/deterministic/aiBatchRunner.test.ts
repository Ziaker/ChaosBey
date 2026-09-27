// ============================================================
// AI VS AI BATCH ORCHESTRATOR — SELF-TEST (MILESTONE 8A1)
// Verifies the orchestration/aggregation layer itself, not AI behavior:
// - a batch with no injected fault reports zero failures;
// - a physics anomaly (excessive linear speed) injected mid-match is
//   captured with the exact seed/tick/side/kind that produced it, proving
//   the wiring from runAiMatch's own detectors through to the batch report
//   actually works end to end.
// ============================================================

import { describe, expect, it } from 'vitest';
import { ATTACK_ARCHETYPE, DEFENSE_ARCHETYPE } from '../../src/bey/archetype/BeyArchetypes';
import { MAX_SANE_LINEAR_SPEED_MPS } from '../../src/physics/diagnostics/physicsSafety';
import { runAiBatch, type AiBatchMatchup } from './aiBatchRunner';

const MATCHUP: AiBatchMatchup = {
  label: 'attack-prototype vs defense-prototype',
  firstDefinition: ATTACK_ARCHETYPE,
  secondDefinition: DEFENSE_ARCHETYPE,
};

describe('AI batch orchestrator', () => {
  it('reports zero failures across a small clean batch', async () => {
    const report = await runAiBatch({
      seeds: ['batch-clean-0', 'batch-clean-1'],
      matchups: [MATCHUP],
      maxTicks: 300,
    });

    expect(report.totalMatches).toBe(2);
    expect(report.results).toHaveLength(2);
    expect(report.failures).toEqual([]);
  });

  it('captures an injected excessive-speed anomaly with its exact seed/tick/side', async () => {
    const injectAtTick = 5;
    let injected = false;

    const report = await runAiBatch({
      seeds: ['batch-anomaly-probe'],
      matchups: [MATCHUP],
      maxTicks: 10,
      onTick: (tick, harness) => {
        if (tick === injectAtTick && !injected) {
          injected = true;
          // A real, finite but implausible velocity — safe for Rapier to step
          // (unlike NaN/Infinity, which risks corrupting the whole physics
          // world) while still tripping checkLinearVelocity's ceiling.
          harness.first.body.setLinvel({ x: MAX_SANE_LINEAR_SPEED_MPS * 2, y: 0, z: 0 }, true);
        }
      },
    });

    expect(report.failures.length).toBeGreaterThan(0);
    const failure = report.failures[0]!;
    expect(failure.seed).toBe('batch-anomaly-probe');
    expect(failure.side).toBe('first');
    expect(failure.kind).toBe('excessive-linear-speed');
    expect(failure.tick).toBe(injectAtTick + 1);
  });
});
