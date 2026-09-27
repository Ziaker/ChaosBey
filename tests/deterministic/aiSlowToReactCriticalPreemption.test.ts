// ============================================================
// AI "SLOW TO REACT" vs A NEW CRITICAL EDGE SITUATION (MILESTONE 7 PART 2b)
// Real physics + real tickMatch(). The RNG is forced so every non-critical
// decision rolls the "slow to react" deliberate error with its maximum
// extra delay (0.4 s): the decision is held pending while the previous
// intent keeps acting.
//
// A (control): nothing new happens — the late decision lands only once
//   its full delay has run out (humanization still exists).
// B: right after the late decision is made, the AI is knocked outward
//   hard (an outward velocity, what a real hit does): its projected edge
//   risk becomes critical. At the next normal reaction-cadence read the
//   critical edge recovery replaces the pending decision, well before the
//   old delay would have run out.
// C (control): a milder outward knock — at the reaction read the AI is in
//   edge danger, but not critical. Nothing preempts: the late decision
//   still lands after its full delay (a normal edge recovery stays
//   subject to deliberate errors, as before).
// ============================================================

import { describe, expect, it } from 'vitest';
import { AIController } from '../../src/ai/controllers/AIController';
import { AiIntent } from '../../src/ai/decision/Intent';
import { DEFAULT_AI_DIFFICULTY_PROFILE } from '../../src/ai/difficulty/AiDifficultyProfile';
import { DEFENSE_AI_PERSONALITY } from '../../src/ai/personalities/AiArchetypePersonalities';
import { IdleController } from '../../src/automation/scripted-scenarios/IdleController';
import { NullAiMashSource } from '../../src/combat/clash/ClashMash';
import { FIXED_DELTA_SECONDS } from '../../src/physics/fixed-step/FixedTimestepLoop';
import { EDGE_PROJECTION_HORIZON_S, EDGE_RISK_MARGIN_M } from '../../src/ai/perception/AiPerception';
import { edgeRiskFraction } from '../../src/ai/perception/EdgeAwareness';
import { SeededRng } from '../../src/rng/SeededRng';
import { CombatHarness } from './combatHarness';

/** IntentionalError's MAX_EXTRA_DELAY_S — the forced late-reaction delay. */
const FORCED_EXTRA_DELAY_S = 0.4;
const FORCED_DELAY_TICKS = Math.round(FORCED_EXTRA_DELAY_S / FIXED_DELTA_SECONDS);

/** Every deliberate-error roll succeeds and always picks "slow to react" (the 0.5 coin flip) with the maximum delay; everything else is a normal seeded RNG. */
function forcedSlowToReactRng(): SeededRng {
  const base = SeededRng.fromSeedText('slow-to-react-critical');
  const rng = Object.create(base) as SeededRng;
  rng.nextBool = (probability = 0.5) => (probability === 0.5 ? true : base.nextBool(probability));
  rng.nextRange = (_min: number, max: number) => max;
  return rng;
}

interface Tick {
  tick: number;
  activeIntent: AiIntent;
  pendingIntent: AiIntent | null;
  /** The AI's own edge risk as its perception computes it (max of where it is and where its velocity carries it in EDGE_PROJECTION_HORIZON_S). */
  edgeRisk: number;
}

/**
 * The AI (at z = 9.5, heading for an idle opponent 12 m away: a plain
 * Approach) runs until it holds a late decision pending, then gets
 * `outwardKickMps` of outward (+z) velocity; returns the ticks from that
 * moment on.
 */
async function run(outwardKickMps: number): Promise<{ pendingIntent: AiIntent; activeAtPending: AiIntent; after: Tick[] }> {
  const harness = await CombatHarness.create({ x: 0, y: 0.5, z: -2.5 }, { x: 0, y: 0.5, z: 9.5 }, {}, new NullAiMashSource());
  const ai = new AIController(
    harness.physics,
    harness.second,
    harness.first,
    harness.clash.controller,
    { ...DEFENSE_AI_PERSONALITY, errorRate: 1, counterAffinity: 0 },
    DEFAULT_AI_DIFFICULTY_PROFILE,
    forcedSlowToReactRng(),
  );
  const idle = new IdleController();
  const step = (): Tick => {
    const actions = ai.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS });
    const debug = ai.getDebugState();
    const p = harness.second.body.translation();
    const v = harness.second.body.linvel();
    const edgeRisk = Math.max(
      edgeRiskFraction({ x: p.x, z: p.z }, EDGE_RISK_MARGIN_M),
      edgeRiskFraction({ x: p.x + v.x * EDGE_PROJECTION_HORIZON_S, z: p.z + v.z * EDGE_PROJECTION_HORIZON_S }, EDGE_RISK_MARGIN_M),
    );
    harness.tick(idle.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }), actions);
    return { tick: 0, activeIntent: debug.activeIntent, pendingIntent: debug.pendingIntent, edgeRisk };
  };

  // Settle, then wait for a fresh late decision (pending appears) made
  // while the AI is nowhere near the edge.
  for (let i = 0; i < 30; i++) step();
  let previous = step();
  let current = step();
  for (let i = 0; i < 300 && !(previous.pendingIntent === null && current.pendingIntent !== null); i++) {
    previous = current;
    current = step();
  }
  expect(current.pendingIntent, 'a slow-to-react decision is pending').not.toBeNull();
  const pos = harness.second.body.translation();
  expect(Math.hypot(pos.x, pos.z), 'made away from the edge').toBeLessThan(10.5);

  if (outwardKickMps > 0) {
    const v = harness.second.body.linvel();
    const r = Math.hypot(pos.x, pos.z);
    harness.second.body.setLinvel({ x: v.x + (pos.x / r) * outwardKickMps, y: v.y, z: v.z + (pos.z / r) * outwardKickMps }, true);
  }

  const after: Tick[] = [];
  for (let tick = 1; tick <= FORCED_DELAY_TICKS + 10; tick++) after.push({ ...step(), tick });
  return { pendingIntent: current.pendingIntent!, activeAtPending: current.activeIntent, after };
}

const reactionTicks = Math.ceil(
  (DEFENSE_AI_PERSONALITY.reactionDelaySeconds * DEFAULT_AI_DIFFICULTY_PROFILE.reactionDelayMultiplier) / FIXED_DELTA_SECONDS - 1e-9,
);

describe('slow to react vs a new critical edge situation (real physics)', () => {
  it('A — control: with nothing new, the late decision is held for its whole delay, then lands', async () => {
    const { pendingIntent, activeAtPending, after } = await run(0);
    const landed = after.find((t) => t.pendingIntent === null);
    expect(landed, 'the late decision lands').toBeDefined();
    // Held the full delay (it was made on tick 0; ±1 tick for where the countdown starts).
    expect(landed!.tick).toBeGreaterThanOrEqual(FORCED_DELAY_TICKS - 1);
    expect(landed!.tick).toBeLessThanOrEqual(FORCED_DELAY_TICKS + 1);
    expect(landed!.activeIntent, 'the late decision is what lands').toBe(pendingIntent);
    for (const t of after.filter((x) => x.tick < landed!.tick)) {
      expect(t.activeIntent, `tick ${t.tick}: previous intent keeps acting`).toBe(activeAtPending);
      expect(t.pendingIntent).toBe(pendingIntent);
    }
  }, 30000);

  it('B — a critical edge risk that appears during the delay takes over at the next reaction read, not after the old delay', async () => {
    const { after } = await run(10);
    const critical = after.find((t) => t.activeIntent === AiIntent.RecoverFromEdge || t.activeIntent === AiIntent.DodgeThreat);
    expect(critical, 'a critical edge decision became active').toBeDefined();
    expect(critical!.pendingIntent, 'the late decision was dropped').toBeNull();
    expect(critical!.edgeRisk, 'critical edge risk when it took over').toBeGreaterThanOrEqual(0.85);
    // Seen at the normal reaction cadence (the timer restarted when the
    // late decision was made) — not instantly, and not after the old delay.
    expect(critical!.tick).toBeLessThanOrEqual(reactionTicks + 1);
    expect(critical!.tick).toBeLessThan(FORCED_DELAY_TICKS - 5);
  }, 30000);

  it('C — control: a non-critical edge danger during the delay does not preempt it', async () => {
    const { pendingIntent, after } = await run(7);
    // At the reaction read the AI is in edge danger (>= the 0.55 entry) but not critical.
    const read = after.find((t) => t.tick === reactionTicks)!;
    expect(read.edgeRisk).toBeGreaterThanOrEqual(0.55);
    expect(read.edgeRisk).toBeLessThan(0.85);
    const landed = after.find((t) => t.pendingIntent === null);
    expect(landed, 'the late decision lands').toBeDefined();
    expect(landed!.tick).toBeGreaterThanOrEqual(FORCED_DELAY_TICKS - 1);
    expect(landed!.activeIntent).toBe(pendingIntent);
  }, 30000);
});
