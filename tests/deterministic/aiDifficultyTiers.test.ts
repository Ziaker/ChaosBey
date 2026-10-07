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
    //
    // Movement/weight/dodge playtest pass, Fix 1 (dodge replaced with a
    // short, flat, latched-direction burst instead of one that adds to and
    // keeps riding existing momentum — see DodgeController.ts): a real,
    // reported consequence of that physics change, not masked by retuning
    // AI/stats here (that pass's own section 20 forbids it). The flat burst
    // travels less far than momentum-stacked old bursts at high closing
    // speed, so hitsDodged's margin narrows a bit: errors 156 vs 371, hits
    // dodged 234 vs 173 (1.35x, was 1.5x+), dodges 98 vs 55 (1.78x), wins 45
    // vs 27. Ace still clearly hesitates less, dodges more often and more
    // effectively, and wins more — only the hitsDodged threshold moves, to
    // stay below the new measured ratio with margin.
    expect(totals.ace.deliberateErrors).toBeLessThan(totals.rookie.deliberateErrors * 0.7);
    // Lote 5 (owner, 2026-10-02: the dodge goes 40% farther, 9 -> 12.6 m/s; Stamina 0 is a spin-out, so the AI keeps a
    // 15-Stamina reserve before dodging): measured errors 330 vs 749, hits dodged 12 vs 10, dodges 133 vs 72, wins
    // 38 vs 34. The longer burst carries the Bey clear of the hitbox, so most dodges now avoid the hit by distance
    // instead of overlapping it inside the i-frames — "dodged" (an i-frame nullification) collapses for both tiers
    // (at 9 m/s this same run still passes the old 1.25x). Ace still dodges far more often and wins more.
    // Owner audit fixes (2026-10-03), with the AI's dodge reserve raised 15 -> 45 Stamina (Ace was losing 18 of these
    // rounds by spin-out): errors 409 vs 856, hits dodged 14 vs 8, dodges 87 vs 54, wins 45 vs 25.
    // Owner, 2026-10-04 (0.37.0: wall/rim impacts no longer take the controls away at speed): errors 484 vs 1028, hits
    // dodged 7 vs 8, dodges 88 vs 32, wins 36 vs 30 (0.36.0: 449/937, 9/6, 87/34, 41/27). "Hits dodged" (an i-frame
    // nullification) is single digits for both tiers since Lote 5 and flips with any change to the fights' paths; Ace
    // still dodges far more often and wins more. It may trail by a couple, no more.
    expect(totals.ace.hitsDodged + 2).toBeGreaterThanOrEqual(totals.rookie.hitsDodged);
    expect(totals.ace.dodges).toBeGreaterThan(totals.rookie.dodges * 1.4);
    expect(totals.ace.wins).toBeGreaterThan(totals.rookie.wins);
  }, 300_000);
});
