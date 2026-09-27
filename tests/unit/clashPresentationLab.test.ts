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
import { createFxRng } from '../../prototypes/clash-presentation-concepts/src/fx/rng';
import * as THREE from 'three';
import { ARENA_FLOOR_RADIUS, ARENA_WALL_HEIGHT } from '../../src/arena/colliders/ArenaTuning';
import { CONTACT_SEPARATION_M } from '../../prototypes/clash-presentation-concepts/src/harness/scenarios';
import { computeVisualPose, hudShare } from '../../prototypes/clash-presentation-concepts/src/presentation/contactPose';
import { ClashPresenter, type PresentationHost } from '../../prototypes/clash-presentation-concepts/src/presentation/ClashPresenter';
import { DIRECTIONS, DIRECTION_IDS } from '../../prototypes/clash-presentation-concepts/src/presentation/directions';
import { TIE_STYLE_IDS } from '../../prototypes/clash-presentation-concepts/src/presentation/tieStyles';
import type { ClashFx } from '../../prototypes/clash-presentation-concepts/src/fx/ClashFx';
import type { TieStyleId } from '../../prototypes/clash-presentation-concepts/src/presentation/types';

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

describe('determinism — stage and FX (shot-for-shot A/B/C comparison)', () => {
  // The lab's restart (R / loop) builds a fresh stage exactly like this, because
  // re-using a Rapier world after a resolution does not replay identically.
  it('a freshly built Rapier stage replays a scenario identically (restart = fresh build)', async () => {
    for (const id of ['balanced', 'resolution-ring-out', 'tie']) {
      const a = await runStageScenario(id);
      const b = await runStageScenario(id);
      expect(JSON.stringify(b.sim.frame)).toBe(JSON.stringify(a.sim.frame));
      a.sim.dispose();
      b.sim.dispose();
    }
  }, 40000);

  it('the FX spark scatter is seeded (no Math.random): the same seed yields the same sequence', () => {
    const a = createFxRng();
    const b = createFxRng();
    const seqA = Array.from({ length: 64 }, a);
    expect(Array.from({ length: 64 }, b)).toEqual(seqA);
    for (const v of seqA) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(new Set(seqA).size).toBe(seqA.length);
  });
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

// ---------------- Presentation revision: contact, bowl, HUD, no result pause ----------------

describe('stage harness — the Clash starts from real contact, resting on the floor', () => {
  it('every scenario holds the two Beys exactly in collider contact, resting on the floor (no hovering) for the whole Active beat', async () => {
    for (const scenario of SCENARIOS) {
      const sim = await ClashStageSim.create(scenario);
      sim.beginApproach();
      const driver = new ScriptedMashDriver(mashSourceFor(scenario.first.mash), mashSourceFor(scenario.second.mash));
      let activeTicks = 0;
      for (let i = 0; i < 400 && sim.harness.phase !== 'Cooldown'; i++) {
        const mash = sim.harness.phase === 'Active' ? driver.sample(sim.harness.elapsedActiveS) : { first: false, second: false };
        sim.tick(DT, mash.first, mash.second);
        if (sim.harness.phase !== 'Active') continue;
        activeTicks++;
        const { first, second } = sim.frame;
        expect(Math.hypot(first.position.x - second.position.x, first.position.z - second.position.z), scenario.id).toBeCloseTo(CONTACT_SEPARATION_M, 5);
        expect(first.position.y, `${scenario.id}: first rests on the floor`).toBeCloseTo(sim.restHeights[0], 5);
        expect(second.position.y, `${scenario.id}: second rests on the floor`).toBeCloseTo(sim.restHeights[1], 5);
        expect(first.airborne || second.airborne, `${scenario.id}: grounded`).toBe(false);
      }
      expect(activeTicks, scenario.id).toBeGreaterThan(200);
      sim.dispose();
    }
  }, 60000);

  it('the ring-out scenario is a clean airborne flight over the wall, not a Bey sinking through the wall collider', async () => {
    const scenario = scenarioById('resolution-ring-out');
    const sim = await ClashStageSim.create(scenario);
    sim.beginApproach();
    const driver = new ScriptedMashDriver(mashSourceFor(scenario.first.mash), mashSourceFor(scenario.second.mash));
    let crossedAtY: number | null = null;
    let prevR = 0;
    for (let i = 0; i < 700 && crossedAtY === null; i++) {
      const mash = sim.harness.phase === 'Active' ? driver.sample(sim.harness.elapsedActiveS) : { first: false, second: false };
      sim.tick(DT, mash.first, mash.second);
      const p = sim.frame.second.position;
      const r = Math.hypot(p.x, p.z);
      if (prevR < ARENA_FLOOR_RADIUS && r >= ARENA_FLOOR_RADIUS) crossedAtY = p.y;
      prevR = r;
    }
    expect(crossedAtY).not.toBeNull();
    expect(crossedAtY!).toBeGreaterThan(ARENA_WALL_HEIGHT);
    sim.dispose();
  }, 20000);
});

describe('visual pose layer (contact lean + bowl), visual only', () => {
  const flat = (): number => 0;
  const base = {
    bodyQuaternion: new THREE.Quaternion(),
    tipDropM: 0.2,
    leanScale: 1,
    params: { leanRad: THREE.MathUtils.degToRad(11), wobbleRad: 0, wobbleHz: 10 },
    timeS: 0,
    phase: 0,
  };

  it('leans each Bey into the contact by the configured angle, pivoting on its tip (the tip stays on the floor)', () => {
    const pose = computeVisualPose({ ...base, bodyPosition: new THREE.Vector3(-0.65, 0.2, 0), towardOpponent: new THREE.Vector2(1, 0), contactWeight: 1, floorHeightAt: flat });
    expect(THREE.MathUtils.radToDeg(pose.extraTiltRad)).toBeCloseTo(11, 4);
    const top = new THREE.Vector3(0, 1, 0).applyQuaternion(pose.quaternion);
    expect(top.x, 'leans toward +x, the opponent').toBeGreaterThan(0.15);
    const tip = new THREE.Vector3(0, -0.2, 0).applyQuaternion(pose.quaternion).add(pose.position);
    expect(tip.y).toBeCloseTo(0, 6);
    // Rims keep meeting: the lean carries the body-origin height forward, the pose steps back by the same amount.
    const rimCenter = new THREE.Vector3(0, 0, 0).applyQuaternion(pose.quaternion).add(pose.position);
    expect(rimCenter.x).toBeCloseTo(-0.65, 2);
  });

  it('has no lean at all outside the contact, and a live shudder inside it', () => {
    const still = computeVisualPose({ ...base, bodyPosition: new THREE.Vector3(0, 0.2, 0), towardOpponent: new THREE.Vector2(1, 0), contactWeight: 0, floorHeightAt: flat });
    expect(still.extraTiltRad).toBeCloseTo(0, 9);
    const tilts = [0, 0.02, 0.04, 0.06].map((t) => computeVisualPose({ ...base, params: { ...base.params, wobbleRad: THREE.MathUtils.degToRad(2) }, timeS: t, bodyPosition: new THREE.Vector3(0, 0.2, 0), towardOpponent: new THREE.Vector2(1, 0), contactWeight: 1, floorHeightAt: flat }).extraTiltRad);
    expect(Math.max(...tilts) - Math.min(...tilts)).toBeGreaterThan(THREE.MathUtils.degToRad(0.5));
  });

  it('seats the Bey on the approved bowl: lifted to h(r) and tilted to the local slope, tip on the surface', () => {
    const bowl = (r: number): number => 3.2 * Math.pow(Math.min(r, 12) / 12, 2); // Foundry's approved h(r)
    const r = 6;
    const pose = computeVisualPose({ ...base, bodyPosition: new THREE.Vector3(r, 0.2, 0), towardOpponent: null, contactWeight: 0, floorHeightAt: bowl });
    const tip = new THREE.Vector3(0, -0.2, 0).applyQuaternion(pose.quaternion).add(pose.position);
    expect(tip.y).toBeCloseTo(bowl(r), 2);
    expect(tip.x).toBeCloseTo(r, 6);
    const slopeDeg = THREE.MathUtils.radToDeg(Math.atan((2 * 3.2 * r) / (12 * 12)));
    expect(THREE.MathUtils.radToDeg(pose.extraTiltRad)).toBeCloseTo(slopeDeg, 1);
  });
});

describe('Clash HUD share (real ClashPower advantage → bar proportion)', () => {
  it('is even when even, grows toward the leader, flips exactly when the lead flips, and stays inside the bar', () => {
    expect(hudShare(0.7, 0.7, 4)).toBe(0.5);
    expect(hudShare(0.8, 0.7, 4)).toBeGreaterThan(0.5);
    expect(hudShare(0.7, 0.8, 4)).toBeLessThan(0.5);
    expect(hudShare(0.8, 0.7, 4)).toBeCloseTo(1 - hudShare(0.7, 0.8, 4), 12);
    expect(hudShare(0.9, 0.7, 4)).toBeGreaterThan(hudShare(0.8, 0.7, 4));
    expect(hudShare(5, 0, 4)).toBeLessThan(1);
    expect(hudShare(0, 0, 4)).toBe(0.5);
  });
});

describe('ClashPresenter — show, don\'t tell: the resolution never pauses', () => {
  const fxStub = (): ClashFx => {
    const noop = (): void => {};
    return { clear: noop, emitContactDust: noop, dustBurst: noop, impactStar: noop, mashPulse: noop, shockwave: noop, spawnSparks: noop } as unknown as ClashFx;
  };

  async function run(scenarioId: string, directionId: 'A' | 'B' | 'C', tieStyle: TieStyleId) {
    const scenario = scenarioById(scenarioId);
    const sim = await ClashStageSim.create(scenario);
    const calls: Array<{ tick: number; kind: string; value: number }> = [];
    let tick = 0;
    const host: PresentationHost = {
      requestHitstop: (s) => calls.push({ tick, kind: 'hitstop', value: s }),
      requestSlowMo: (_f, s) => calls.push({ tick, kind: 'slowmo', value: s }),
      setArenaClashIntensity: () => {},
      flashScreen: () => {},
    };
    const presenter = new ClashPresenter(DIRECTIONS[directionId], tieStyle, fxStub(), host);
    const driver = new ScriptedMashDriver(mashSourceFor(scenario.first.mash), mashSourceFor(scenario.second.mash));
    sim.beginApproach();
    let resolvedTick = -1;
    let winnerIsFirst: boolean | null = null;
    const samples: Array<{ tick: number; phase: string; contact: number; speed: number; hud: number; share: number }> = [];
    for (; tick < 520; tick++) {
      const mash = sim.harness.phase === 'Active' ? driver.sample(sim.harness.elapsedActiveS) : { first: false, second: false };
      const result = sim.tick(DT, mash.first, mash.second);
      const f = result.fightFrame;
      presenter.handleTick(DT, sim, result, { first: new THREE.Vector3(f.first.position.x, f.first.position.y, f.first.position.z), second: new THREE.Vector3(f.second.position.x, f.second.position.y, f.second.position.z), floorHeightAt: () => 0, dustColor: new THREE.Color(), sparkColor: new THREE.Color() });
      if (result.resolution) {
        resolvedTick = tick;
        winnerIsFirst = result.resolution.loserIsFirst === null ? null : !result.resolution.loserIsFirst;
      }
      samples.push({ tick, phase: sim.harness.phase, contact: presenter.contactWeight, speed: presenter.speedlineLevel, hud: presenter.hudOpacity, share: presenter.hudShareFirst });
    }
    sim.dispose();
    return { calls, resolvedTick, winnerIsFirst, samples };
  }

  it('A/B/C × every tie style: no hitstop or slow motion from the resolution on, and the contact/HUD/speedlines let go within a fraction of a second', async () => {
    for (const d of DIRECTION_IDS) {
      for (const [scenarioId, tie] of [['balanced', DIRECTIONS[d].defaultTieStyle], ...TIE_STYLE_IDS.map((t) => ['tie', t] as const)] as const) {
        const r = await run(scenarioId, d, tie);
        expect(r.resolvedTick, `${d}/${scenarioId}`).toBeGreaterThan(0);
        expect(r.calls.filter((c) => c.tick >= r.resolvedTick), `${d}/${scenarioId}/${tie}: no pause on the result`).toEqual([]);
        const after = (s: number) => r.samples[r.resolvedTick + Math.round(s * 60)]!;
        expect(after(0.2).contact).toBe(0);
        expect(after(0.4).speed).toBe(0);
        expect(after(0.4).hud).toBe(0);
        const active = r.samples.filter((s) => s.phase === 'Active' && s.tick > r.resolvedTick - 120);
        for (const s of active) {
          expect(s.contact).toBe(1);
          expect(s.speed).toBeGreaterThan(0.1);
          expect(s.hud).toBe(1);
        }
        // The bar lands on the real result as the impact happens.
        const landed = r.samples[r.resolvedTick]!.share;
        if (r.winnerIsFirst === null) expect(landed).toBe(0.5);
        else expect(landed > 0.5).toBe(r.winnerIsFirst);
      }
    }
  }, 120000);

  it('the HUD follows the lead: in the comeback scenario the player trails far behind, surges back in the last second, and the bar lands on the player as they win', async () => {
    const r = await run('comeback', 'B', 'mirror');
    const active = r.samples.filter((s) => s.phase === 'Active');
    const lastSecond = active.slice(-60);
    expect(lastSecond[0]!.share, 'still far behind one second from the end').toBeLessThan(0.1);
    expect(lastSecond[lastSecond.length - 1]!.share, 'surged back').toBeGreaterThan(0.35);
    expect(r.winnerIsFirst).toBe(true);
    expect(r.samples[r.resolvedTick]!.share).toBeGreaterThan(0.5);
  }, 20000);

  it('no direction carries a banner, a resolution hitstop or a resolution slow motion in its config', () => {
    for (const d of DIRECTION_IDS) {
      const res = DIRECTIONS[d].resolution as Record<string, unknown>;
      expect(Object.keys(res).sort()).toEqual(['burstRings', 'dustBurst', 'flash', 'sparks']);
      expect(DIRECTIONS[d]).not.toHaveProperty('energy');
    }
  });
});
