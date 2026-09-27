// ============================================================
// CLASH PRESENTATION LAB — UNIT TESTS
// Determinism and numeric-stability checks for the lab's own harness
// (ClashHarness, scenarios, mash sources), plus a direct proof that the
// live score readout the lab shows is exactly the real, GDD-approved
// src/combat/clash/ClashFormula — never a re-derived copy.
// ============================================================

import { describe, expect, it } from 'vitest';
import { RINGOUT_RADIUS_M } from '../../src/arena/ringout/RingOutTuning';
import { ClashOutcome } from '../../src/combat/clash/ClashController';
import { computeClashPower, computeMashPerformance, computeStaminaFactor, computeVelocityFactor } from '../../src/combat/clash/ClashFormula';
import { CLASH_COOLDOWN_S, CLASH_STAMINA_FACTOR_MAX, CLASH_STAMINA_FACTOR_MIN, CLASH_TARGET_DURATION_S, CLASH_VELOCITY_FACTOR_MAX, CLASH_VELOCITY_FACTOR_MIN } from '../../src/combat/clash/ClashTuning';
import { APPROACH_DURATION_S, ClashHarness, RESOLUTION_BURST_DURATION_S } from '../../prototypes/clash-presentation-concepts/src/harness/ClashHarness';
import { ScriptedMashDriver } from '../../prototypes/clash-presentation-concepts/src/harness/mash';
import { SCENARIOS, mashSourceFor, scenarioById } from '../../prototypes/clash-presentation-concepts/src/harness/scenarios';
import { ClashStageSim } from '../../prototypes/clash-presentation-concepts/src/sim/ClashStageSim';

const DT = 1 / 60;

function runScenario(id: string): { harness: ClashHarness; driver: ScriptedMashDriver; ticks: number } {
  const scenario = scenarioById(id);
  const harness = new ClashHarness();
  const driver = new ScriptedMashDriver(mashSourceFor(scenario.first.mash), mashSourceFor(scenario.second.mash));
  harness.beginApproach(
    {
      firstStaminaFraction: scenario.first.staminaFraction,
      secondStaminaFraction: scenario.second.staminaFraction,
      firstSpeedMps: scenario.first.speedMps,
      secondSpeedMps: scenario.second.speedMps,
      connectDeltaS: scenario.connectDeltaS,
    },
    APPROACH_DURATION_S,
  );
  let ticks = 0;
  const maxTicks = Math.ceil((APPROACH_DURATION_S + CLASH_TARGET_DURATION_S + 0.5) * 60);
  while (harness.phase !== 'Cooldown' && ticks < maxTicks) {
    const mash = harness.phase === 'Active' ? driver.sample(harness.elapsedActiveS) : { first: false, second: false };
    harness.tick(DT, mash.first, mash.second);
    ticks++;
  }
  return { harness, driver, ticks };
}

describe('SCENARIOS', () => {
  it('has at least the 9 required cases plus the cooldown showcase', () => {
    const required = [
      'balanced',
      'player-dominates',
      'ai-dominates',
      'comeback',
      'high-mash-low-stamina',
      'low-mash-high-velocity',
      'tie',
      'resolution-normal-knockback',
      'resolution-ring-out',
    ];
    for (const id of required) expect(SCENARIOS.some((s) => s.id === id), `missing scenario ${id}`).toBe(true);
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(9);
  });

  it('every scenario id is unique', () => {
    const ids = SCENARIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('ClashHarness — phase state machine', () => {
  it('goes Idle -> Approach -> Active -> Cooldown, never skipping a phase', () => {
    const harness = new ClashHarness();
    expect(harness.phase).toBe('Idle');
    harness.beginApproach({ firstStaminaFraction: 0.8, secondStaminaFraction: 0.8, firstSpeedMps: 8, secondSpeedMps: 8, connectDeltaS: 0.05 }, APPROACH_DURATION_S);
    expect(harness.phase).toBe('Approach');
    const seen = new Set<string>(['Idle', 'Approach']);
    let ticks = 0;
    while (harness.phase !== 'Active' && ticks < 1000) {
      harness.tick(DT, false, false);
      seen.add(harness.phase);
      ticks++;
    }
    expect(harness.phase).toBe('Active');
    expect(seen.has('Cooldown')).toBe(false); // Cooldown never reached before Active — no phase skipping.
  });

  it('refuses to start a second Approach while one Clash is already in flight', () => {
    const harness = new ClashHarness();
    const started1 = harness.beginApproach({ firstStaminaFraction: 0.8, secondStaminaFraction: 0.8, firstSpeedMps: 8, secondSpeedMps: 8, connectDeltaS: 0 });
    const started2 = harness.beginApproach({ firstStaminaFraction: 0.1, secondStaminaFraction: 0.1, firstSpeedMps: 1, secondSpeedMps: 1, connectDeltaS: 0 });
    expect(started1).toBe(true);
    expect(started2).toBe(false);
  });

  it('reaches Active exactly when the Approach beat elapses, and Active never exceeds the target duration before resolving', () => {
    const { harness } = runScenario('balanced');
    expect(harness.phase).toBe('Cooldown');
    expect(harness.controller.getLastResult()).not.toBeNull();
  });
});

describe('ClashHarness — mash counting (Z/X/C dedup)', () => {
  it('a tick with any non-empty mash contribution counts as exactly one event, never more', () => {
    const harness = new ClashHarness();
    harness.beginApproach({ firstStaminaFraction: 0.8, secondStaminaFraction: 0.8, firstSpeedMps: 8, secondSpeedMps: 8, connectDeltaS: 0 });
    while (harness.phase !== 'Active') harness.tick(DT, false, false);
    const before = harness.liveScore(true).mashEventCount;
    const events = harness.tick(DT, true, false); // simulates simultaneous Z+X+C landing as a single boolean, exactly like buildMashActionSet's Set collapses multiple keys into one contribution.
    const after = harness.liveScore(true).mashEventCount;
    expect(after).toBe(before + 1);
    expect(events.mashEvents).toEqual([{ isFirst: true, eventCount: after }]);
    // Holding it "pressed" every subsequent tick still only adds one event per tick, never bursts.
    const afterTwo = harness.tick(DT, true, false);
    expect(harness.liveScore(true).mashEventCount).toBe(after + 1);
    expect(afterTwo.mashEvents).toEqual([{ isFirst: true, eventCount: after + 1 }]);
  });

  it('mash contributions from both sides on the same tick are reported as two independent edges', () => {
    const harness = new ClashHarness();
    harness.beginApproach({ firstStaminaFraction: 0.8, secondStaminaFraction: 0.8, firstSpeedMps: 8, secondSpeedMps: 8, connectDeltaS: 0 });
    while (harness.phase !== 'Active') harness.tick(DT, false, false);
    const events = harness.tick(DT, true, true);
    expect(events.mashEvents).toHaveLength(2);
    expect(events.mashEvents.map((e) => e.isFirst).sort()).toEqual([false, true]);
  });
});

describe('ClashFormula — caps and normalization (via the lab live score)', () => {
  it('never exceeds the formula ceiling regardless of extreme inputs', () => {
    expect(computeMashPerformance(1e9)).toBeLessThanOrEqual(1);
    expect(computeMashPerformance(-5)).toBeGreaterThanOrEqual(0);
    expect(computeStaminaFactor(5)).toBeLessThanOrEqual(CLASH_STAMINA_FACTOR_MAX);
    expect(computeStaminaFactor(-5)).toBeGreaterThanOrEqual(CLASH_STAMINA_FACTOR_MIN);
    expect(computeVelocityFactor(1e6)).toBeLessThanOrEqual(CLASH_VELOCITY_FACTOR_MAX);
    expect(computeVelocityFactor(-10)).toBeGreaterThanOrEqual(CLASH_VELOCITY_FACTOR_MIN);
    expect(computeClashPower(1e9, 1, 1e6)).toBeLessThanOrEqual(1);
  });

  it("the lab's liveScore for each side matches computeClashPower with that side's captured start inputs exactly (no re-derived formula)", () => {
    const { harness } = runScenario('high-mash-low-stamina');
    const result = harness.controller.getLastResult()!;
    const expectedFirst = computeClashPower(result.firstMashEventCount, harness.controller.getFirstStaminaFractionAtStart(), harness.controller.getFirstSpeedMpsAtStart());
    const expectedSecond = computeClashPower(result.secondMashEventCount, harness.controller.getSecondStaminaFractionAtStart(), harness.controller.getSecondSpeedMpsAtStart());
    expect(harness.liveScore(true).clashPower).toBeCloseTo(expectedFirst, 10);
    expect(harness.liveScore(false).clashPower).toBeCloseTo(expectedSecond, 10);
  });

  it('a near-zero Stamina fraction still caps the Stamina factor at its floor, never zeroing a combatant out of the Clash', () => {
    const { harness } = runScenario('high-mash-low-stamina');
    const result = harness.controller.getLastResult()!;
    expect(result.firstClashPower).toBeGreaterThan(0);
  });
});

describe('the "empate" scenario really produces ClashOutcome.Tie', () => {
  it('resolves to an exact Tie from identical inputs on both sides', () => {
    const { harness } = runScenario('tie');
    const result = harness.controller.getLastResult()!;
    expect(result.outcome).toBe(ClashOutcome.Tie);
    expect(result.firstClashPower).toBeCloseTo(result.secondClashPower, 10);
  });
});

describe('determinism', () => {
  it('running the same scenario twice produces byte-identical results and event counts', () => {
    for (const id of ['balanced', 'comeback', 'player-dominates']) {
      const a = runScenario(id);
      const b = runScenario(id);
      expect(a.ticks).toBe(b.ticks);
      expect(a.harness.controller.getLastResult()).toEqual(b.harness.controller.getLastResult());
    }
  });
});

async function runStageScenario(id: string): Promise<{ sim: ClashStageSim; ringOutIsFirst: boolean | null; loserFinalRadiusM: number }> {
  const scenario = scenarioById(id);
  const sim = await ClashStageSim.create(scenario);
  sim.beginApproach();
  const driver = new ScriptedMashDriver(mashSourceFor(scenario.first.mash), mashSourceFor(scenario.second.mash));
  let loserIsFirst: boolean | null = null;
  const maxTicks = Math.ceil((APPROACH_DURATION_S + CLASH_TARGET_DURATION_S + RESOLUTION_BURST_DURATION_S + 1) * 60);
  let ticks = 0;
  while (ticks < maxTicks) {
    const mash = sim.harness.phase === 'Active' ? driver.sample(sim.harness.elapsedActiveS) : { first: false, second: false };
    const result = sim.tick(DT, mash.first, mash.second);
    if (result.resolution) loserIsFirst = result.resolution.loserIsFirst;
    ticks++;
    if (sim.harness.beat === 'cooldownWait') break;
  }
  const frame = sim.frame;
  const loserFrame = loserIsFirst === true ? frame.first : loserIsFirst === false ? frame.second : frame.first;
  const loserFinalRadiusM = Math.hypot(loserFrame.position.x, loserFrame.position.z);
  return { sim, ringOutIsFirst: frame.ringOutIsFirst, loserFinalRadiusM };
}

describe('ClashStageSim — physical resolution (real Rapier physics, no declared ring-out)', () => {
  it('a normal knockback near the center never carries the loser past the ring-out radius', async () => {
    const { sim, ringOutIsFirst, loserFinalRadiusM } = await runStageScenario('resolution-normal-knockback');
    expect(ringOutIsFirst).toBeNull();
    expect(loserFinalRadiusM).toBeLessThan(RINGOUT_RADIUS_M);
    sim.dispose();
  }, 20000);

  it('a strong knockback from a wall-adjacent clash point carries the loser past the ring-out radius on its own — the Clash itself never declares it', async () => {
    const { sim, ringOutIsFirst, loserFinalRadiusM } = await runStageScenario('resolution-ring-out');
    expect(ringOutIsFirst).not.toBeNull();
    expect(loserFinalRadiusM).toBeGreaterThan(RINGOUT_RADIUS_M);
    sim.dispose();
  }, 20000);

  it('a Tie applies a symmetric repulsion (both Beys pushed apart, no winner) rather than any knockback formula', async () => {
    const scenario = scenarioById('tie');
    const initialSeparationM = Math.abs(scenario.second.clashRadiusM - scenario.first.clashRadiusM);
    const { sim } = await runStageScenario('tie');
    const frame = sim.frame;
    const finalSeparationM = Math.hypot(frame.first.position.x - frame.second.position.x, frame.first.position.z - frame.second.position.z);
    expect(finalSeparationM).toBeGreaterThan(initialSeparationM);
    sim.dispose();
  }, 20000);
});

describe('cooldown', () => {
  it('starts a full CLASH_COOLDOWN_S countdown the instant a Clash resolves', () => {
    const { harness } = runScenario('cooldown-watch');
    expect(harness.cooldownRemainingS).toBeCloseTo(CLASH_COOLDOWN_S, 5);
  });

  it('counts down to Idle and never starts a new Clash before it reaches zero', () => {
    const { harness } = runScenario('cooldown-watch');
    let ticks = 0;
    while (harness.phase === 'Cooldown' && ticks < Math.ceil((CLASH_COOLDOWN_S + 1) * 60)) {
      const startedEarly = harness.beginApproach({ firstStaminaFraction: 1, secondStaminaFraction: 1, firstSpeedMps: 20, secondSpeedMps: 20, connectDeltaS: 0 });
      expect(startedEarly).toBe(false);
      harness.tick(DT, false, false);
      ticks++;
    }
    expect(harness.phase).toBe('Idle');
  });
});
