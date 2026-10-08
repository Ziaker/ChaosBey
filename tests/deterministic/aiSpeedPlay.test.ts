// Owner audit G2 (2026-10-03): speed-led play, measured. The AI already attacks on the move: over 36 AI-vs-AI rounds
// mean speed 7.33 m/s (of 11), Circulars started at 7.83 m/s, 5.5 hits per side, rounds 28.0 s, 0 unfinished. A scoring
// change that damped standstill Circulars and added a run-up bonus moved that only to 8.11 m/s / 6.0 hits (rounds
// 32.3 s) while changing many AI decisions — not kept; what "speed-based fighting" should add is the owner's call.
// This guards the measured baseline. (Seeds re-picked for 0.52.0, 0.56.0 (speed19): rails are on by default and change AI runs; a defense mirror stalls in about half its rounds with or without them, so the seed was picked where both finish.)

import { describe, expect, it } from 'vitest';
import { ALL_BEY_ARCHETYPES } from '../../src/bey/archetype/BeyArchetypes';
import { INTENDED_MAX_SPEED_MPS } from '../../src/bey/movement/MovementTuning';
import { RoundOutcome } from '../../src/combat/round-rules/RoundState';
import { simulateAiMatch } from '../../src/self-test/AiMatchSimulation';

describe('AI speed-led play — measured baseline (owner audit G2)', () => {
  it('12 AI rounds: all finish, Circulars start at ≥ 60% of top speed on average, hits land', async () => {
    let circ = 0;
    let circSpeed = 0;
    let hits = 0;
    for (const a of ALL_BEY_ARCHETYPES) {
      for (const b of ALL_BEY_ARCHETYPES.slice(0, 2)) {
        for (let i = 0; i < 2; i++) {
          const r = await simulateAiMatch({ seed: `speed19-${a.id}-${b.id}-${i}`, firstDefinition: a, secondDefinition: b });
          expect(r.stats.outcome).not.toBe(RoundOutcome.Ongoing);
          for (const s of [r.stats.first, r.stats.second]) {
            circ += s.circularAttacks;
            circSpeed += s.meanCircularStartSpeedMps * s.circularAttacks;
            hits += s.hitsLanded;
          }
        }
      }
    }
    expect(circ).toBeGreaterThan(10);
    expect(circSpeed / circ).toBeGreaterThan(0.6 * INTENDED_MAX_SPEED_MPS);
    expect(hits).toBeGreaterThan(24);
  }, 300_000);
});
