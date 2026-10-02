// ============================================================
// AI EDGE + THREAT — INTEGRATION TEST (MILESTONE 7 PART 2b)
// Real physics + real tickMatch(): an AI facing out of the ring near the
// edge (recovering) is hit with a quick Dash from the center side — the
// attacker stands between it and the center. It must answer the live hit
// with an edge-safe dodge (not keep walking into it), send the burst
// tangentially/inward (never out of the ring), resume edge recovery once
// the hit is over, not flip back and forth between evading and
// recovering, and not get rung out. Several seeds, same script.
// ============================================================

import { describe, expect, it } from 'vitest';
import { RINGOUT_RADIUS_M } from '../../src/arena/ringout/RingOutTuning';
import { AIController } from '../../src/ai/controllers/AIController';
import { AiIntent } from '../../src/ai/decision/Intent';
import { DEFAULT_AI_DIFFICULTY_PROFILE } from '../../src/ai/difficulty/AiDifficultyProfile';
import { DEFENSE_AI_PERSONALITY } from '../../src/ai/personalities/AiArchetypePersonalities';
import { ScriptedController } from '../../src/automation/scripted-scenarios/ScriptedController';
import { AttackState } from '../../src/combat/attacks/AttackController';
import { NullAiMashSource } from '../../src/combat/clash/ClashMash';
import { Action } from '../../src/input/actions/Action';
import { FIXED_DELTA_SECONDS } from '../../src/physics/fixed-step/FixedTimestepLoop';
import { SeededRng } from '../../src/rng/SeededRng';
import { CombatHarness } from './combatHarness';

const TICKS = 180;
/** sin(22.5°) — Dodge directions are quantized to the player's 8 key combinations. */
const QUANTIZATION_SLACK = 0.383;
/** No loop: over the whole episode, evade<->recover switches stay this few (one Dash = one evade, one return). */
const MAX_EVADE_RECOVER_SWITCHES = 3;

interface Episode {
  edgeSafeDodgePressTick: number | null;
  burstOutwardComponent: number | null;
  intentAfterHit: AiIntent | null;
  evadeRecoverSwitches: number;
  ringOut: boolean;
}

async function runEpisode(seed: string): Promise<Episode> {
  // AI on the +Z edge facing +Z (heading 0 = out of the ring); the dasher
  // sits between it and the center and releases a short-charge Dash.
  const harness = await CombatHarness.create({ x: 0, y: 0.5, z: RINGOUT_RADIUS_M - 5.3 }, { x: 0, y: 0.5, z: RINGOUT_RADIUS_M - 1.7 }, {}, new NullAiMashSource());
  const personality = { ...DEFENSE_AI_PERSONALITY, dodgeSkill: 1, errorRate: 0, counterAffinity: 0 };
  const ai = new AIController(harness.physics, harness.second, harness.first, harness.clash.controller, personality, DEFAULT_AI_DIFFICULTY_PROFILE, SeededRng.fromSeedText(seed));
  const dasher = new ScriptedController([
    { fromTick: 0, held: [Action.Attack] },
    { fromTick: 12, held: [] },
  ]);

  const episode: Episode = { edgeSafeDodgePressTick: null, burstOutwardComponent: null, intentAfterHit: null, evadeRecoverSwitches: 0, ringOut: false };
  let previousIntent: AiIntent | null = null;
  let dashSeen = false;

  for (let tick = 0; tick < TICKS && !harness.roundState.isOver; tick++) {
    const velocityBefore = harness.second.body.linvel();
    const result = harness.tick(dasher.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }), ai.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }));
    const debug = ai.getDebugState();
    if (result.ringOutSecond) episode.ringOut = true;

    if (episode.edgeSafeDodgePressTick === null && debug.chosenActionSummary === 'dodge' && debug.activeIntentReason.includes('edge-safe dodge')) {
      episode.edgeSafeDodgePressTick = tick;
      // The press applied its burst during this tick's tickMatch: compare
      // velocity before/after. Outward = away from the center at the AI.
      const velocityAfter = harness.second.body.linvel();
      const delta = { x: velocityAfter.x - velocityBefore.x, z: velocityAfter.z - velocityBefore.z };
      const deltaLength = Math.hypot(delta.x, delta.z);
      const position = harness.second.body.translation();
      const radius = Math.hypot(position.x, position.z);
      episode.burstOutwardComponent = deltaLength > 1e-6 ? (delta.x * position.x + delta.z * position.z) / (deltaLength * radius) : null;
    }

    if (harness.first.attack.getState() === AttackState.DashActive) dashSeen = true;
    const dashOver = dashSeen && harness.first.attack.getState() !== AttackState.DashActive;
    if (dashOver && episode.intentAfterHit === null && debug.activeIntent !== AiIntent.DodgeThreat) episode.intentAfterHit = debug.activeIntent;

    const evadeOrRecover = debug.activeIntent === AiIntent.DodgeThreat || debug.activeIntent === AiIntent.RecoverFromEdge;
    if (evadeOrRecover && previousIntent !== null && previousIntent !== debug.activeIntent && (previousIntent === AiIntent.DodgeThreat || previousIntent === AiIntent.RecoverFromEdge)) {
      episode.evadeRecoverSwitches++;
    }
    previousIntent = debug.activeIntent;
  }
  return episode;
}

describe('AI edge + threat (real physics)', () => {
  const seeds = ['edge-threat-0', 'edge-threat-1', 'edge-threat-2', 'edge-threat-3', 'edge-threat-4'];

  it('answers a live Dash at the edge with an edge-safe dodge, resumes recovery, never loops, never rings out', async () => {
    let edgeSafeDodges = 0;
    for (const seed of seeds) {
      const episode = await runEpisode(seed);
      expect(episode.ringOut, `${seed}: rung out`).toBe(false);
      expect(episode.evadeRecoverSwitches, `${seed}: evade/recover loop`).toBeLessThanOrEqual(MAX_EVADE_RECOVER_SWITCHES);
      if (episode.edgeSafeDodgePressTick !== null) {
        edgeSafeDodges++;
        expect(episode.burstOutwardComponent, `${seed}: dodge burst measured`).not.toBeNull();
        expect(episode.burstOutwardComponent!, `${seed}: dodge burst leads out of the ring`).toBeLessThanOrEqual(QUANTIZATION_SLACK);
        // Recovery (not normal play) is what follows the evasion while
        // still in edge danger.
        expect(episode.intentAfterHit, `${seed}: intent once the Dash was over`).toBe(AiIntent.RecoverFromEdge);
      }
    }
    // The combined case must actually be exercised, not just survived.
    expect(edgeSafeDodges).toBeGreaterThanOrEqual(3);
  }, 60000);
});
