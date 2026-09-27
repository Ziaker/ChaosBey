// ============================================================
// AI VS AI ARCHETYPE MATRIX — HEADLESS LONG-RUN SELF-TEST (MILESTONE 7)
// GDD section 64/66/67/162/163: every archetype pairing, several seeds,
// full rounds through the production tickMatch() orchestration. Asserts:
// - no degenerate behavior in any match (an attack intent that never
//   presses, button spam outside a Clash, both sides frozen at once, a
//   round that never resolves for AI reasons);
// - observable behavior differences between Attack/Defense/Stamina,
//   measured from what each AI actually pressed and caused — not from its
//   internal scores;
// - determinism of a full AI-vs-AI round.
// Thresholds are deliberately loose (roughly half the measured gaps) so
// ordinary retuning doesn't break them, while a regression that erases an
// archetype's identity does.
// ============================================================

import { beforeAll, describe, expect, it } from 'vitest';
import { AiIntent } from '../../src/ai/decision/Intent';
import { ALL_BEY_ARCHETYPES, ATTACK_ARCHETYPE, DEFENSE_ARCHETYPE, STAMINA_ARCHETYPE } from '../../src/bey/archetype/BeyArchetypes';
import { RoundOutcome } from '../../src/combat/round-rules/RoundState';
import { FIXED_DELTA_SECONDS } from '../../src/physics/fixed-step/FixedTimestepLoop';
import { intentShare, runAiMatch, type AiMatchStats, type AiSideStats } from './aiMatchRunner';

const SEEDS = ['matrix-0', 'matrix-1', 'matrix-2', 'matrix-3', 'matrix-4', 'matrix-5'];
const TICKS_PER_SECOND = Math.round(1 / FIXED_DELTA_SECONDS);

/** An attack intent that goes this long without a press (in range, with energy) is the "wants to attack but never does" failure. */
const MAX_STALLED_ATTACK_TICKS = Math.round(0.5 * TICKS_PER_SECOND);
/** Outside a Clash, presses/second above this is spam (a real Dodge/attack cadence is far lower). */
const MAX_PRESSES_PER_SECOND = 6;
/** Both sides holding nothing at the same time for longer than this is a stalemate. */
const MAX_MUTUAL_IDLE_TICKS = 2 * TICKS_PER_SECOND;
/** A Bey wedged in the wall this long (see AiSideStats.longestWedgedTicks) explains a round that never resolved. */
const WEDGED_EXPLAINS_STALL_TICKS = 5 * TICKS_PER_SECOND;

interface ArchetypeTotals {
  minutes: number;
  attacks: number;
  dashes: number;
  /** Attacks started on an open opponent (recovery/Broken) plus Circular counters that caught a Dash — both are "punishing commitment". */
  punishes: number;
  /** Circular counters that caught the opponent's active Dash. */
  counters: number;
  passiveShare: number;
  /** Stamina fraction spent (1 - final), summed over sides. */
  staminaSpent: number;
  sides: number;
}

const matches: { label: string; stats: AiMatchStats }[] = [];
const totals = new Map<string, ArchetypeTotals>();

function accumulate(stats: AiSideStats, match: AiMatchStats): void {
  const key = stats.personalityId;
  const entry = totals.get(key) ?? { minutes: 0, attacks: 0, dashes: 0, punishes: 0, counters: 0, passiveShare: 0, staminaSpent: 0, sides: 0 };
  entry.minutes += (match.ticks - match.clashActiveTicks) / TICKS_PER_SECOND / 60;
  entry.attacks += stats.circularAttacks + stats.dashAttacks;
  entry.dashes += stats.dashAttacks;
  entry.punishes += stats.punishAttacks + stats.counterHits;
  entry.counters += stats.counterHits;
  entry.passiveShare += intentShare(stats, [AiIntent.Circle, AiIntent.Wait, AiIntent.Retreat]);
  entry.staminaSpent += 1 - stats.finalStaminaFraction;
  entry.sides++;
  totals.set(key, entry);
}

function archetype(personalityId: string): ArchetypeTotals {
  const entry = totals.get(personalityId);
  if (!entry) throw new Error(`no matches recorded for ${personalityId}`);
  return entry;
}

describe('AI vs AI archetype matrix', () => {
  beforeAll(async () => {
    for (const first of ALL_BEY_ARCHETYPES) {
      for (const second of ALL_BEY_ARCHETYPES) {
        for (const seed of SEEDS) {
          const stats = await runAiMatch({ seed, firstDefinition: first, secondDefinition: second });
          matches.push({ label: `${first.id} vs ${second.id} (${seed})`, stats });
          accumulate(stats.first, stats);
          accumulate(stats.second, stats);
        }
      }
    }
  }, 120000);

  it('never shows degenerate behavior in any match', () => {
    expect(matches.length).toBe(ALL_BEY_ARCHETYPES.length ** 2 * SEEDS.length);
    for (const { label, stats } of matches) {
      for (const side of [stats.first, stats.second]) {
        expect(side.longestStalledAttackTicks, `${label} ${side.personalityId}: attack intent without pressing`).toBeLessThanOrEqual(MAX_STALLED_ATTACK_TICKS);
        expect(side.maxPressesPerSecond, `${label} ${side.personalityId}: button spam`).toBeLessThanOrEqual(MAX_PRESSES_PER_SECOND);
      }
      expect(stats.longestMutualIdleTicks, `${label}: both sides idle at once`).toBeLessThanOrEqual(MAX_MUTUAL_IDLE_TICKS);
    }
  });

  it('resolves every round, except where a Bey is physically wedged in the wall (a collision issue no input can fix)', () => {
    const unresolved = matches.filter(({ stats }) => stats.outcome === RoundOutcome.Ongoing);
    for (const { label, stats } of unresolved) {
      const wedged = Math.max(stats.first.longestWedgedTicks, stats.second.longestWedgedTicks);
      expect(wedged, `${label}: round never resolved and no Bey was wedged — an AI stalemate`).toBeGreaterThanOrEqual(WEDGED_EXPLAINS_STALL_TICKS);
    }
    // The wedge is rare; the matrix must still mostly produce real results.
    expect(unresolved.length).toBeLessThanOrEqual(Math.ceil(matches.length * 0.05));
  });

  // Thresholds sit below the weakest margin measured over three
  // independent 54-match seed sets (see the M7 Part 2b PR) — loose enough
  // for ordinary retuning, tight enough to catch an archetype losing its
  // identity.
  it('Attack initiates far more — and far more Dashes — than Defense and Stamina (GDD section 64: seeks engagement, uses charge opportunities)', () => {
    const attack = archetype('attack-ai-personality');
    const defense = archetype('defense-ai-personality');
    const stamina = archetype('stamina-ai-personality');
    const rate = (t: ArchetypeTotals, n: number) => n / t.minutes;
    expect(rate(attack, attack.attacks)).toBeGreaterThan(1.2 * Math.max(rate(defense, defense.attacks), rate(stamina, stamina.attacks)));
    expect(rate(attack, attack.dashes)).toBeGreaterThan(2 * Math.max(rate(defense, defense.dashes), rate(stamina, stamina.dashes)));
  });

  it('Defense counters Dashes far more than Attack and punishes commitment more often (GDD section 64: uses counter opportunities, punishes commitment)', () => {
    const attack = archetype('attack-ai-personality');
    const defense = archetype('defense-ai-personality');
    expect(defense.counters / defense.minutes).toBeGreaterThan(1.5 * (attack.counters / attack.minutes));
    expect(defense.punishes / defense.attacks).toBeGreaterThan(attack.punishes / attack.attacks + 0.03);
  });

  it('Stamina plays the most patient game, Dashes least and spends its Stamina slowest (GDD section 64: preserves resources, avoids heavy collisions)', () => {
    const attack = archetype('attack-ai-personality');
    const defense = archetype('defense-ai-personality');
    const stamina = archetype('stamina-ai-personality');
    expect(stamina.passiveShare / stamina.sides).toBeGreaterThan(defense.passiveShare / defense.sides + 0.08);
    expect(stamina.passiveShare / stamina.sides).toBeGreaterThan(attack.passiveShare / attack.sides + 0.2);
    expect(stamina.dashes / stamina.minutes).toBeLessThan(defense.dashes / defense.minutes);
    // Per minute of play: matches are short, so end-of-match Stamina alone
    // barely separates anyone.
    expect(stamina.staminaSpent / stamina.minutes).toBeLessThan(0.92 * (defense.staminaSpent / defense.minutes));
    expect(stamina.staminaSpent / stamina.minutes).toBeLessThan(0.8 * (attack.staminaSpent / attack.minutes));
  });
});

describe('AI vs AI determinism', () => {
  it('replays a full round identically from the same seed', async () => {
    const setup = { seed: 'determinism', firstDefinition: STAMINA_ARCHETYPE, secondDefinition: DEFENSE_ARCHETYPE };
    const a = await runAiMatch(setup);
    const b = await runAiMatch(setup);
    expect(b).toEqual(a);
    const c = await runAiMatch({ ...setup, firstDefinition: ATTACK_ARCHETYPE });
    expect(c).not.toEqual(a);
  }, 60000);
});
