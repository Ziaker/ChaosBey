// M10: the player-facing AI tiers change how the AI really plays, not just
// what the Pregame screen says. Ace vs Rookie mirror matches (every
// archetype, both sides) through the real headless runtime.

import { describe, expect, it } from 'vitest';
import { ACE_TIER, ROOKIE_TIER } from '../../src/ai/difficulty/AiDifficultyTiers';
import { ATTACK_ARCHETYPE, DEFENSE_ARCHETYPE, STAMINA_ARCHETYPE } from '../../src/bey/archetype/BeyArchetypes';
import { simulateAiMatch } from '../../src/self-test/AiMatchSimulation';

interface TierTotals {
  deliberateErrors: number;
  hitsDodged: number;
  dodges: number;
  wins: number;
}

/** Per archetype, Ace first and Ace second each: 3 × 12 × 2 = 72 matches. */
const MATCHES_PER_ARCHETYPE_AND_SIDE = 12;

describe('AI difficulty tiers in real matches', () => {
  it('Ace hesitates less, dodges more and wins more than Rookie', async () => {
    const totals: Record<'ace' | 'rookie', TierTotals> = {
      ace: { deliberateErrors: 0, hitsDodged: 0, dodges: 0, wins: 0 },
      rookie: { deliberateErrors: 0, hitsDodged: 0, dodges: 0, wins: 0 },
    };
    for (const definition of [ATTACK_ARCHETYPE, DEFENSE_ARCHETYPE, STAMINA_ARCHETYPE]) {
      for (let i = 0; i < MATCHES_PER_ARCHETYPE_AND_SIDE; i++) {
        for (const aceFirst of [true, false]) {
          const record = await simulateAiMatch({
            seed: `tier-${definition.id}-${i}`,
            firstDefinition: definition,
            secondDefinition: definition,
            firstDifficulty: aceFirst ? ACE_TIER.profile : ROOKIE_TIER.profile,
            secondDifficulty: aceFirst ? ROOKIE_TIER.profile : ACE_TIER.profile,
          });
          const sides = aceFirst ? { ace: record.stats.first, rookie: record.stats.second } : { ace: record.stats.second, rookie: record.stats.first };
          for (const tier of ['ace', 'rookie'] as const) {
            totals[tier].deliberateErrors += sides[tier].deliberateErrors;
            totals[tier].hitsDodged += sides[tier].hitsDodged;
            totals[tier].dodges += sides[tier].dodges;
          }
          const outcome = String(record.stats.outcome);
          const firstWon = outcome.startsWith('FirstWins');
          const secondWon = outcome.startsWith('SecondWins');
          if ((aceFirst && firstWon) || (!aceFirst && secondWon)) totals.ace.wins++;
          else if (firstWon || secondWon) totals.rookie.wins++;
        }
      }
    }
    // Motion Lab integration (M11, direction B), 72 matches (24 is too noisy under the new
    // movement: hits dodged measured 18 vs 45 in one 24-match run):
    //   before (old movement):  errors 142 vs 332, hits dodged 118 vs 109, dodges 64 vs 41, wins 41 vs 31
    //   after:                  errors 144 vs 359, hits dodged 204 vs 113, dodges 103 vs 59, wins 53 vs 18
    // (with a Circular catch stopping the Dash it catches, knockback opening the grip window and
    // stacked Beys sliding off; before those fixes a caught Dash flew on over the wall, which
    // punished Ace's commitment: wins 35 vs 35). Thresholds as before.
    // Measured after the ext-32 wall fix (M11 lane 3), 24 matches: errors 49 vs 105, hits dodged
    // 40 vs 24, dodges 20 vs 13, wins 17 vs 7 (48 matches: 95/216, 102/61, 45/29, 30/18). Before
    // the fix (a wall with gaps) it was hits dodged 51 vs 8 and dodges 23 vs 7, so the 2x margins
    // were partly the broken arena; Ace still clearly dodges more and wins more.
    expect(totals.ace.deliberateErrors).toBeLessThan(totals.rookie.deliberateErrors * 0.7);
    expect(totals.ace.hitsDodged).toBeGreaterThan(totals.rookie.hitsDodged * 1.5);
    expect(totals.ace.dodges).toBeGreaterThan(totals.rookie.dodges * 1.4);
    expect(totals.ace.wins).toBeGreaterThan(totals.rookie.wins);
  }, 300_000);
});
