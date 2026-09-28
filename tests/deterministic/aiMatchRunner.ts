// ============================================================
// AI VS AI MATCH RUNNER — TEST ADAPTER
// The match simulation itself now lives in the runtime self-test core
// (src/self-test/AiMatchSimulation.ts), shared with the M8 batch runner.
// This adapter keeps the deterministic suite's API and behavior unchanged:
// same seeds, same closer harness spawns (±2 m), same AiMatchStats result.
// ============================================================

import {
  DEFAULT_AI_MATCH_MAX_TICKS,
  intentShare,
  simulateAiMatch,
  type AiMatchSetup,
  type AiMatchStats,
  type AiSideStats,
} from '../../src/self-test/AiMatchSimulation';
import { HARNESS_FIRST_SPAWN, HARNESS_SECOND_SPAWN } from './combatHarness';

export { DEFAULT_AI_MATCH_MAX_TICKS, intentShare };
export type { AiMatchSetup, AiMatchStats, AiSideStats };

export async function runAiMatch(setup: AiMatchSetup): Promise<AiMatchStats> {
  const record = await simulateAiMatch({
    ...setup,
    firstSpawn: setup.firstSpawn ?? HARNESS_FIRST_SPAWN,
    secondSpawn: setup.secondSpawn ?? HARNESS_SECOND_SPAWN,
  });
  return record.stats;
}
