// GDD 67 anomaly detector: fault injection per condition, freeze awareness,
// one report per episode — and the ext-32 wall bug's own seed, which now
// plays clean (M11 lane 3 fixed the wall collider; see arenaWall.test.ts).

import { ARENA_FLOOR_RADIUS } from '../../src/arena/colliders/ArenaTuning';
import { resolveMatchConfig, type MatchConfig } from '../../src/config/match/MatchConfig';
import { describe, expect, it } from 'vitest';
import { ATTACK_ARCHETYPE, DEFENSE_ARCHETYPE, STAMINA_ARCHETYPE } from '../../src/bey/archetype/BeyArchetypes';
import { ClashState, type ClashController } from '../../src/combat/clash/ClashController';
import type { RoundState } from '../../src/combat/round-rules/RoundState';
import { DodgeState } from '../../src/dodge/DodgeController';
import type { ControllerActions } from '../../src/input/actions/Action';
import { IdleController } from '../../src/automation/scripted-scenarios/IdleController';
import { FIXED_DELTA_SECONDS } from '../../src/physics/fixed-step/FixedTimestepLoop';
import { SelfTestMatchWorld } from '../../src/self-test/SelfTestMatchWorld';
import { simulateAiMatch } from '../../src/self-test/AiMatchSimulation';
import { DEFAULT_ANOMALY_THRESHOLDS, MatchAnomalyDetector, anomalyThresholdsFor, type AnomalyTickInput, type DetectedAnomaly } from '../../src/self-test/anomalies/MatchAnomalyDetector';

const idle = new IdleController();
const noActions = (): ControllerActions => idle.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS });

function clashStub(state: ClashState, cooldownRemainingS = 0): ClashController {
  return { getState: () => state, getCooldownRemainingS: () => cooldownRemainingS } as unknown as ClashController;
}

async function run(
  ticks: number,
  mutate: (world: SelfTestMatchWorld, tick: number) => Partial<AnomalyTickInput> | void,
  aiSides = { first: false, second: false },
  detector = new MatchAnomalyDetector(),
  matchConfigOverrides: Partial<MatchConfig> = {},
): Promise<DetectedAnomaly[]> {
  const world = await SelfTestMatchWorld.build({ firstDefinition: ATTACK_ARCHETYPE, secondDefinition: DEFENSE_ARCHETYPE, matchConfigOverrides });
  const found: DetectedAnomaly[] = [];
  try {
    for (let tick = 0; tick < ticks; tick++) {
      const a = noActions();
      const b = noActions();
      const result = world.tick(a, b);
      const overrides = mutate(world, tick) ?? {};
      found.push(
        ...detector.check({
          tick,
          first: world.first,
          second: world.second,
          result,
          roundState: world.roundState,
          clash: world.clash.controller,
          firstActions: a,
          secondActions: b,
          aiSides,
          ...overrides,
        }),
      );
    }
  } finally {
    world.dispose();
  }
  return found;
}

describe('MatchAnomalyDetector — clean baseline', () => {
  it('reports nothing on a quiet match', async () => {
    expect(await run(600, () => undefined)).toEqual([]);
  });
});

describe('MatchAnomalyDetector — each GDD 67 condition is caught, once per episode', () => {
  it('invalid rotation', async () => {
    const found = await run(20, (w, tick) => {
      // Rapier normalizes quaternions on write, so a corrupted rotation can
      // only be simulated by corrupting the read.
      if (tick === 10) w.first.body.rotation = () => ({ x: 0, y: 0, z: 0, w: 2 });
    });
    expect(found.filter((d) => d.kind === 'invalid-rotation')).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: 'invalid-rotation', side: 'first', tick: 10, severity: 'invalid-state', knownIssue: null });
  });

  it('left the world without a ring-out', async () => {
    const found = await run(20, (w, tick) => {
      if (tick >= 10) w.second.body.setTranslation({ x: DEFAULT_ANOMALY_THRESHOLDS.leftWorldRadiusM + 1, y: 0.6, z: 0 }, false);
    });
    expect(found.filter((d) => d.kind === 'left-world')).toHaveLength(1);
  });

  it('a Bey that left over the wall is not flagged while its ring-out delay runs, even back under the bowl (owner, 2026-10-02)', async () => {
    const pending = { isOver: false, ringOutClock: { first: 0, second: 0.5 } } as unknown as RoundState;
    const found = await run(30, (w, tick) => {
      if (tick >= 10) w.second.body.setTranslation({ x: DEFAULT_ANOMALY_THRESHOLDS.leftWorldRadiusM + 1, y: -3, z: 0 }, false);
      if (tick >= 20) w.second.body.setTranslation({ x: 9, y: -40, z: -7 }, false); // slipped under the bowl
      return tick >= 10 ? { roundState: pending } : {};
    });
    expect(found.filter((d) => d.kind === 'left-world' || d.kind === 'below-floor')).toEqual([]);
  });

  it('a Bey through the floor inside the arena is still flagged even once its ring-out clock runs', async () => {
    const pending = { isOver: false, ringOutClock: { first: 0.5, second: 0 } } as unknown as RoundState;
    const found = await run(20, (w, tick) => {
      if (tick >= 5) w.first.body.setTranslation({ x: 0, y: -3, z: 0 }, false);
      return tick >= 5 ? { roundState: pending } : {};
    });
    expect(found.filter((d) => d.kind === 'below-floor')).toHaveLength(1);
  });

  it('through the floor (inside the arena) — not attributed to a known issue', async () => {
    const found = await run(20, (w, tick) => {
      if (tick >= 5) w.first.body.setTranslation({ x: 0, y: -3, z: 0 }, false);
    });
    const floor = found.filter((d) => d.kind === 'below-floor');
    expect(floor).toHaveLength(1);
    expect(floor[0]!.knownIssue).toBeNull();
  });

  it('stuck inside the wall, after the threshold only', async () => {
    const found = await run(DEFAULT_ANOMALY_THRESHOLDS.stuckInWallTicks + 5, (w) => {
      w.second.body.setTranslation({ x: ARENA_FLOOR_RADIUS + 0.1, y: 0.3, z: 0 }, false);
      w.second.body.setLinvel({ x: 0, y: 0, z: 0 }, false);
    });
    const wall = found.filter((d) => d.kind === 'stuck-in-wall');
    expect(wall).toHaveLength(1);
    expect(wall[0]!.knownIssue).toBeNull(); // ext-32 is fixed: a Bey in the wall is an unknown invalid state again
    expect(wall[0]!.tick).toBe(DEFAULT_ANOMALY_THRESHOLDS.stuckInWallTicks - 1);
  });

  it('resource out of range', async () => {
    const found = await run(10, (w, tick) => {
      if (tick === 3) Object.defineProperty(w.first.stamina.resource, 'value', { get: () => -5 });
    });
    expect(found.filter((d) => d.kind === 'resource-out-of-range')).toHaveLength(1);
  });

  it('Broken above the recovery floor is a state contradiction', async () => {
    const found = await run(10, (w, tick) => {
      if (tick === 2) Object.defineProperty(w.second.stability, 'isBroken', { get: () => true });
    });
    expect(found.filter((d) => d.kind === 'state-contradiction' && d.side === 'second')).toHaveLength(1);
  });

  it('permanent invulnerability and a dodge cooldown that never ends — but not while frozen', async () => {
    const dodging = await run(DEFAULT_ANOMALY_THRESHOLDS.maxDodgingTicks + 2, (w) => {
      w.first.dodge.getState = () => DodgeState.Dodging;
    });
    expect(dodging.filter((d) => d.kind === 'permanent-invulnerability')).toHaveLength(1);

    const frozenByClash = await run(DEFAULT_ANOMALY_THRESHOLDS.maxDodgeCooldownTicks * 2, (w) => {
      w.first.dodge.getState = () => DodgeState.Cooldown;
      return { clash: clashStub(ClashState.Active) };
    });
    expect(frozenByClash.filter((d) => d.kind === 'cooldown-never-ending')).toHaveLength(0);

    const cooldown = await run(DEFAULT_ANOMALY_THRESHOLDS.maxDodgeCooldownTicks + 2, (w) => {
      w.first.dodge.getState = () => DodgeState.Cooldown;
    });
    expect(cooldown.filter((d) => d.kind === 'cooldown-never-ending')).toHaveLength(1);
  });

  it('permanent Clash, a Clash cooldown past its length, and a Clash after the round ended', async () => {
    const stuck = await run(DEFAULT_ANOMALY_THRESHOLDS.maxClashActiveTicks + 2, () => ({ clash: clashStub(ClashState.Active) }));
    expect(stuck.filter((d) => d.kind === 'permanent-clash')).toHaveLength(1);
    const badCooldown = await run(3, () => ({ clash: clashStub(ClashState.Cooldown, 99) }));
    expect(badCooldown.filter((d) => d.kind === 'cooldown-never-ending')).toHaveLength(1);
    const afterRound = await run(3, (w) => {
      w.roundState.resolveTick({ firstKoed: true, secondKoed: false, firstRingOut: false, secondRingOut: false });
      return { clash: clashStub(ClashState.Active) };
    });
    expect(afterRound.filter((d) => d.kind === 'state-contradiction' && d.side === 'match')).toHaveLength(1);
  });

  it('two Clashes one cooldown apart are not one never-ending cooldown (the streak ends when the next Clash goes Active)', async () => {
    const cooldownTicks = DEFAULT_ANOMALY_THRESHOLDS.maxClashCooldownTicks - 20; // just inside the limit
    const span = cooldownTicks * 2 + 60;
    const found = await run(span, (_w, tick) => {
      // cooldown (inside the limit) → a new Clash goes Active for 60 ticks → another cooldown (inside the limit)
      if (tick < cooldownTicks) return { clash: clashStub(ClashState.Cooldown, 5) };
      if (tick < cooldownTicks + 60) return { clash: clashStub(ClashState.Active) };
      return { clash: clashStub(ClashState.Cooldown, 5) };
    });
    expect(found.filter((d) => d.kind === 'cooldown-never-ending')).toEqual([]);
    // ...while one cooldown that really outlasts its limit is still reported.
    const stuck = await run(DEFAULT_ANOMALY_THRESHOLDS.maxClashCooldownTicks + 2, () => ({ clash: clashStub(ClashState.Cooldown, 5) }));
    expect(stuck.filter((d) => d.kind === 'cooldown-never-ending')).toHaveLength(1);
  });

  it('permanent hitstop (live sessions pass hitstopActive)', async () => {
    const found = await run(DEFAULT_ANOMALY_THRESHOLDS.maxHitstopTicks + 2, () => ({ hitstopActive: true }));
    expect(found.filter((d) => d.kind === 'permanent-hitstop')).toHaveLength(1);
  });

  it('wobble explosion and non-finite spin', async () => {
    const found = await run(5, (w, tick) => {
      if (tick === 2) {
        const result = w.tick(noActions(), noActions());
        return { result: { ...result, first: { ...result.first, spin: { ...result.first.spin, wobbleEnergy: 5, spinRateRadPerSec: Number.NaN } } } };
      }
    });
    expect(found.filter((d) => d.kind === 'wobble-explosion')).toHaveLength(1);
    expect(found.filter((d) => d.kind === 'non-finite-spin')).toHaveLength(1);
  });

  it('a physics body that disappears', async () => {
    const found = await run(6, (w, tick) => {
      // Removing the body for real would break the next world.tick(); the
      // detector only needs the body to report itself invalid.
      if (tick === 3) w.second.body.isValid = () => false;
    });
    const missing = found.filter((d) => d.kind === 'body-missing');
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({ side: 'second', tick: 3 });
  });

  it('an AI side that presses nothing for too long is a warning, not an invalid state', async () => {
    const found = await run(DEFAULT_ANOMALY_THRESHOLDS.aiInactiveTicks + 2, () => undefined, { first: true, second: false });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: 'ai-inactive', severity: 'warning', side: 'first' });
  });

  it('an AI side pressing nothing does not accumulate ai-inactive while hitstop freezes gameplay (same freeze rule as every other streak)', async () => {
    // Same shape as the "permanent hitstop" case above, but held well below
    // maxHitstopTicks so permanent-hitstop itself never fires — isolating
    // whether ai-inactive respects the freeze on its own.
    const found = await run(DEFAULT_ANOMALY_THRESHOLDS.aiInactiveTicks + 2, () => ({ hitstopActive: true }), { first: true, second: false });
    expect(found.filter((d) => d.kind === 'ai-inactive')).toHaveLength(0);
  });
});

describe('ext-32 regression: the seed that reproduced the wall bug now plays clean', () => {
  // Before M11 lane 3 this seed wedged a Bey in the wall and then dropped it
  // off the rim with no ring-out (stuck-in-wall + below-floor, both tagged
  // ext-32). The wall collider fix removes both; nothing else may appear.
  it('self-test-32/defense-vs-stamina: no anomaly at all, deterministically', async () => {
    const setup = { seed: 'self-test-32/defense-prototype-vs-stamina-prototype', firstDefinition: DEFENSE_ARCHETYPE, secondDefinition: STAMINA_ARCHETYPE };
    const a = await simulateAiMatch(setup);
    const b = await simulateAiMatch(setup);
    expect(a.detections).toEqual([]);
    expect(b.detections).toEqual([]);
    expect(a.stats.outcome).toBe(b.stats.outcome);
  }, 60_000);
});

describe('MatchAnomalyDetector — follows the match\'s own rules (found in the 0.43.1 review)', () => {
  it('a Bey inside a bigger stage is not "left the world" or "stuck in the wall" (stage size slider)', async () => {
    // The default stage's limits (37.9 m, 35.7 m) flagged every Bey past 36 m on a 90 m stage (x2.5 flagged 3-10 findings per match).
    const big = { arenaSizeScale: 2.5 };
    const found = await run(40, (w, tick) => {
      if (tick >= 5) w.second.body.setTranslation({ x: 50, y: 0.6, z: 0 }, false);
    }, undefined, undefined, big);
    expect(found.filter((d) => d.kind === 'left-world' || d.kind === 'stuck-in-wall')).toEqual([]);
    // ...and past that stage's own ring-out line it still is.
    const out = await run(40, (w, tick) => {
      if (tick >= 5) w.second.body.setTranslation({ x: 95, y: 0.6, z: 0 }, false);
    }, undefined, undefined, big);
    expect(out.filter((d) => d.kind === 'left-world')).toHaveLength(1);
  });

  it('a long dodge cooldown (the Pregame slider goes to 6 s) is not "never ending"', async () => {
    const config = resolveMatchConfig({ dodgeCooldownS: 6 });
    const thresholds = anomalyThresholdsFor(config);
    expect(thresholds.maxDodgeCooldownTicks).toBeGreaterThan(DEFAULT_ANOMALY_THRESHOLDS.maxDodgeCooldownTicks);
    const found = await run(
      DEFAULT_ANOMALY_THRESHOLDS.maxDodgeCooldownTicks + 60,
      (w) => {
        w.first.dodge.getState = () => DodgeState.Cooldown;
      },
      { first: false, second: false },
      new MatchAnomalyDetector(thresholds),
    );
    expect(found.filter((d) => d.kind === 'cooldown-never-ending')).toEqual([]);
  });
});
