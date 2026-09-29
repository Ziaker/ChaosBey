// ============================================================
// AI VS AI EXTENDED STABILITY BATCH (MILESTONE 7 — STABILIZATION)
// GDD section 66/67/162/163: a much larger AI-vs-AI sweep than the regular
// suite (tests/deterministic/aiArchetypeMatrix.test.ts, aiBatchSelfTest.test.ts)
// runs — same real tickMatch()/CombatHarness path, many more seeds — hunting
// for rare degenerate behavior that a small seed set can miss: hangs,
// decision loops, excessive inactivity, suspiciously early ring-outs, or an
// invalid controller/physics value.
//
// Skipped by default (it would roughly 10x the AI test time for every CI
// run). Set AI_STABILITY_BATCH=1 to run it, e.g. before/after a change to
// src/ai, or periodically as an M7 stabilization sweep. See src/ai/README.md
// "Observability"/"Tests".
//
// Two categories below are logged, not asserted on. Both were investigated
// (2026 M7 stabilization pass) and traced to the physics/collision layer,
// not an AI decision bug — fixing them means touching knockback or arena
// collision tuning, which M7 is explicitly holding off while Bey Motion Lab
// prototypes movement/physics separately. These are candidate test
// scenarios for that lab's isolated prototype (presets/sliders, owner
// approval, only then production tuning) — not a mandate to retune
// production knockback/collision directly:
// - "early ring-out": a Circular counter landing on an active Dash can
//   launch the dasher (KnockbackTuning's upward-launch component) far and
//   high enough to carry it out of the arena mid-air, before any
//   air-recovery input has a chance to matter. Reproduces reliably on
//   attack-prototype vs attack-prototype, seed "ext-0" (and several other
//   seeds), deciding the round in ~1.7s.
// - "same intent held" long streaks: an AI can get physically wedged
//   against the arena's edge collider (this file's own longestWedgedTicks
//   already names this "a collision problem, not an AI decision" — see
//   aiMatchRunner.ts) while still correctly choosing to press forward; the
//   match still resolves normally by KO once the pinned side's Stamina
//   runs out, so it isn't caught by aiArchetypeMatrix's
//   "unresolved round" wedge check. Reproduces on attack-prototype vs
//   defense-prototype, seed "ext-32" (defense side wedged at roughly
//   (x=-9.2, z=4.8) from ~t960 to the match's end at t2307). FIXED in M11
//   lane 3: it was the wall collider (segments rotated the wrong way,
//   leaving gaps around ±45°/±135°), not the AI — see arenaWall.test.ts.
// ============================================================

import { describe, expect, it } from 'vitest';
import { AiIntent } from '../../src/ai/decision/Intent';
import { ALL_BEY_ARCHETYPES } from '../../src/bey/archetype/BeyArchetypes';
import { RoundOutcome } from '../../src/combat/round-rules/RoundState';
import { FIXED_DELTA_SECONDS } from '../../src/physics/fixed-step/FixedTimestepLoop';
import { runAiMatch, type AiMatchStats } from './aiMatchRunner';

const RUN_EXTENDED = process.env.AI_STABILITY_BATCH === '1';
const TICKS_PER_SECOND = Math.round(1 / FIXED_DELTA_SECONDS);

// 40 seeds x 9 archetype pairings = 360 full matches.
const SEED_COUNT = 40;
const SEEDS = Array.from({ length: SEED_COUNT }, (_, i) => `ext-${i}`);

/** A round decided by ring-out this early smells like a knockback launch carrying the loser out mid-air rather than a fought exchange — see file header. Logged, not asserted (known physics cause). */
const SUSPICIOUSLY_EARLY_RINGOUT_TICKS = 2 * TICKS_PER_SECOND;
const MAX_STALLED_ATTACK_TICKS = Math.round(0.5 * TICKS_PER_SECOND);
const MAX_PRESSES_PER_SECOND = 6;
const MAX_MUTUAL_IDLE_TICKS = 2 * TICKS_PER_SECOND;
const WEDGED_EXPLAINS_STALL_TICKS = 5 * TICKS_PER_SECOND;
/** A wedge episode this long, even inside a match that still resolves, is worth a line in the report — see file header. Logged, not asserted (known physics cause). */
const WEDGED_REPORT_THRESHOLD_TICKS = 3 * TICKS_PER_SECOND;
/** Longest a single side may run without ever changing its active intent — a candidate "decision loop" (stuck re-picking the same thing every reaction tick). Logged, not asserted: in practice this coincides with the wedge case above, not a decision bug. */
const MAX_SAME_INTENT_STREAK_TICKS = 20 * TICKS_PER_SECOND;

describe.skipIf(!RUN_EXTENDED)('AI vs AI extended stability batch (M7 stabilization, opt-in)', () => {
  it(
    `runs ${ALL_BEY_ARCHETYPES.length ** 2 * SEEDS.length} matches across every archetype pairing and ${SEED_COUNT} seeds without degenerate behavior`,
    async () => {
      const matches: { label: string; stats: AiMatchStats }[] = [];
      const knownPhysicsNotes: string[] = [];

      for (const first of ALL_BEY_ARCHETYPES) {
        for (const second of ALL_BEY_ARCHETYPES) {
          for (const seed of SEEDS) {
            const sameIntentStreak: [number, number] = [0, 0];
            const maxSameIntentStreak: [number, number] = [0, 0];
            const lastIntent: [AiIntent | null, AiIntent | null] = [null, null];
            const stats = await runAiMatch({
              seed,
              firstDefinition: first,
              secondDefinition: second,
              onTick: (_tick, _harness, _fa, _sa, firstAi, secondAi) => {
                const intents: [AiIntent, AiIntent] = [firstAi.getDebugState().activeIntent, secondAi.getDebugState().activeIntent];
                for (const i of [0, 1] as const) {
                  sameIntentStreak[i] = intents[i] === lastIntent[i] ? sameIntentStreak[i] + 1 : 0;
                  maxSameIntentStreak[i] = Math.max(maxSameIntentStreak[i], sameIntentStreak[i]);
                  lastIntent[i] = intents[i];
                }
              },
            });
            const label = `${first.id} vs ${second.id} (${seed})`;
            matches.push({ label, stats });

            if (
              (stats.outcome === RoundOutcome.FirstWinsByRingOut || stats.outcome === RoundOutcome.SecondWinsByRingOut) &&
              stats.ticks <= SUSPICIOUSLY_EARLY_RINGOUT_TICKS
            ) {
              knownPhysicsNotes.push(`${label}: [known: knockback launch] ring-out decided the round in ${(stats.ticks / TICKS_PER_SECOND).toFixed(2)}s`);
            }
            for (const i of [0, 1] as const) {
              const side = i === 0 ? stats.first : stats.second;
              if (side.longestWedgedTicks >= WEDGED_REPORT_THRESHOLD_TICKS) {
                knownPhysicsNotes.push(`${label} side ${i} (${side.personalityId}): [known: wall wedge] pinned for ${(side.longestWedgedTicks / TICKS_PER_SECOND).toFixed(1)}s`);
              }
              if (maxSameIntentStreak[i] > MAX_SAME_INTENT_STREAK_TICKS) {
                knownPhysicsNotes.push(`${label} side ${i} (${side.personalityId}): same intent held for ${(maxSameIntentStreak[i] / TICKS_PER_SECOND).toFixed(1)}s straight (longestWedgedTicks=${(side.longestWedgedTicks / TICKS_PER_SECOND).toFixed(1)}s)`);
              }
            }
          }
        }
      }

      console.log(
        [`AI extended stability batch: ${matches.length} matches, ${knownPhysicsNotes.length} known-physics notes (see file header; not failures).`, ...knownPhysicsNotes].join('\n'),
      );

      // Genuine AI-behavior regressions (not the physics-layer categories above): these fail the batch.
      for (const { label, stats } of matches) {
        for (const side of [stats.first, stats.second]) {
          expect(side.longestStalledAttackTicks, `${label} ${side.personalityId}: attack intent without pressing`).toBeLessThanOrEqual(MAX_STALLED_ATTACK_TICKS);
          expect(side.maxPressesPerSecond, `${label} ${side.personalityId}: button spam`).toBeLessThanOrEqual(MAX_PRESSES_PER_SECOND);
        }
        expect(stats.longestMutualIdleTicks, `${label}: both sides idle at once`).toBeLessThanOrEqual(MAX_MUTUAL_IDLE_TICKS);
      }

      const unresolved = matches.filter(({ stats }) => stats.outcome === RoundOutcome.Ongoing);
      for (const { label, stats } of unresolved) {
        const wedged = Math.max(stats.first.longestWedgedTicks, stats.second.longestWedgedTicks);
        expect(wedged, `${label}: round never resolved and no Bey was wedged — an AI stalemate`).toBeGreaterThanOrEqual(WEDGED_EXPLAINS_STALL_TICKS);
      }
      expect(unresolved.length, 'unresolved rounds should stay rare across the extended batch').toBeLessThanOrEqual(Math.ceil(matches.length * 0.05));
    },
    30 * 60_000,
  );
});
