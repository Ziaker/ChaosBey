// Bey Real, the rest of the sliders (0.60.0): the attack, dodge, stability, contact and AI numbers reach the systems that own
// them, the contact model behaves like two real tops, and no slider the Pregame shows is dead.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AI_DIFFICULTY_TIERS } from '../../src/ai/difficulty/AiDifficultyTiers';
import { ATTACK_AI_PERSONALITY } from '../../src/ai/personalities/AiArchetypePersonalities';
import { attackProfileOf, attackTuningOf, dodgeTuningOf, realSecondSpinDir, stabilityRecoveryOf } from '../../src/bey/real/realTunings';
import { realAiDifficulty, realAiPersonality } from '../../src/bey/real/realAi';
import { resolveRealContact, RIM_SPEED_MPS, type ContactBody } from '../../src/bey/real/RealContact';
import { REAL_BASE_PARAMS, REAL_PARAM_SPEC, realModeConfigOf } from '../../src/bey/real/RealTuning';
import { realMatchOverrides } from '../../src/bey/real/realMatchRules';
import { StabilitySystem } from '../../src/bey/stability/StabilitySystem';
import { StaminaSystem } from '../../src/bey/stamina/StaminaSystem';
import { AttackController, AttackState, DEFAULT_ATTACK_TUNING } from '../../src/combat/attacks/AttackController';
import { DEFAULT_BEY_DEFINITION } from '../../src/bey/archetype/BeyDefinition';
import { DODGE_ACTIVE_DURATION_S, DODGE_PERFECT_WINDOW_S } from '../../src/dodge/DodgeTuning';
import { DodgeController, DodgeState, DEFAULT_DODGE_TUNING } from '../../src/dodge/DodgeController';
import { Action, type ControllerActions } from '../../src/input/actions/Action';

const config = realModeConfigOf(REAL_BASE_PARAMS);
const DT = 1 / 60;
const idle: ControllerActions = { held: new Set(), pressedThisFrame: new Set(), attackHoldDurationSeconds: 0, jumpDriftHoldDurationSeconds: 0 };
const body = (vx: number, vz: number, spin = 1, dir: 1 | -1 = 1, mass = 1): ContactBody => ({ velocity: { x: vx, z: vz }, mass, spin, dir });

describe('Bey Real: every slider the Pregame shows is wired', () => {
  it('all 69 values are live, and each key is read by the engine outside the tuning list and the Pregame panel', () => {
    expect(REAL_PARAM_SPEC.filter((s) => !s.live).map((s) => s.key)).toEqual([]);
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (path.endsWith('.ts')) files.push(path);
      }
    };
    walk(resolve(__dirname, '../../src'));
    const engine = files.filter((f) => !/RealTuning\.ts$|RealModePanel\.ts$/.test(f)).map((f) => readFileSync(f, 'utf8')).join('\n');
    const unread = REAL_PARAM_SPEC.filter((s) => !new RegExp(`\\b${s.key}\\b`).test(engine)).map((s) => s.key);
    expect(unread, 'sliders nothing reads').toEqual([]);
  });
});

describe('Bey Real attack numbers', () => {
  const chargeAndRelease = (attack: AttackController, holdS: number): AttackState => {
    const press: ControllerActions = { ...idle, held: new Set([Action.Attack]), pressedThisFrame: new Set([Action.Attack]) };
    const held: ControllerActions = { ...idle, held: new Set([Action.Attack]) };
    const at = (actions: ControllerActions) => attack.tick(actions, 0, { x: 0, z: 0 }, { x: 8, z: 0 }, DT, 0, { x: 0, z: 0 });
    at(press);
    for (let i = 0; i < Math.round(holdS / DT); i++) at(held);
    return at(idle).state;
  };

  it('the game\'s own constants are the default (nothing changes outside the mode)', () => {
    expect(DEFAULT_ATTACK_TUNING).toMatchObject({ dashMaxChargeS: 1.2, dashActiveDurationS: 0.5, dashWhiffRecoveryS: 0.6, circularActiveDurationS: 0.25, circularRecoveryS: 0.3 });
    expect(DEFAULT_DODGE_TUNING).toEqual({ activeDurationS: DODGE_ACTIVE_DURATION_S, burstDurationS: DODGE_ACTIVE_DURATION_S, perfectWindowS: DODGE_PERFECT_WINDOW_S });
  });

  it('the mode\'s values fill them: durations, recoveries, lock-on, damage, knockback scale', () => {
    const t = attackTuningOf(config);
    expect(t).toMatchObject({ dashMaxChargeS: 1.6, dashActiveDurationS: 0.8, dashWhiffRecoveryS: 1.6, dashSnapRadPerS: 40, dashSnapWindowS: 0.08, dashLockOnRadPerS: 5, dashMinStabilityDamage: 10, dashMaxStabilityDamage: 25, circularActiveDurationS: 0.35, circularRecoveryS: 0.95, circularStabilityDamage: 12 });
    expect(t.dashKnockbackScale).toBeCloseTo(1, 9); // the owner's 1.8 is the game's own throw
    const p = attackProfileOf(DEFAULT_BEY_DEFINITION.attack, config);
    expect(p).toMatchObject({ dashMinSpeedMps: 10, dashMaxSpeedMps: 30, circularHitboxRadiusM: 1.55 });
  });

  it('a longer Dash lasts longer, and a longer whiff recovery keeps the Bey vulnerable longer', () => {
    const run = (dashDurationS: number, whiffS: number) => {
      const attack = new AttackController(attackProfileOf(DEFAULT_BEY_DEFINITION.attack, config), 1.5, false, 1, true, { ...attackTuningOf(config), dashActiveDurationS: dashDurationS, dashWhiffRecoveryS: whiffS });
      chargeAndRelease(attack, 0.5);
      let active = 0;
      let recovery = 0;
      for (let i = 0; i < 600; i++) {
        const r = attack.tick(idle, 0, { x: 0, z: 0 }, { x: 80, z: 0 }, DT, 0, { x: 0, z: 0 });
        if (r.state === AttackState.DashActive) active++;
        if (r.state === AttackState.DashRecovery) recovery++;
      }
      return { active: active * DT, recovery: recovery * DT };
    };
    const short = run(0.3, 0.3);
    const long = run(0.9, 1.5);
    expect(long.active).toBeGreaterThan(short.active + 0.4);
    expect(long.recovery).toBeGreaterThan(short.recovery + 0.9);
  });

  it('the charge reaches the maximum at the slider\'s time; the Circular lasts as long as the slider says', () => {
    const fractionAfter = (maxS: number, holdS: number) => {
      const attack = new AttackController(DEFAULT_BEY_DEFINITION.attack, 1.5, false, 1, true, { ...DEFAULT_ATTACK_TUNING, dashMaxChargeS: maxS });
      const press: ControllerActions = { ...idle, held: new Set([Action.Attack]), pressedThisFrame: new Set([Action.Attack]) };
      const held: ControllerActions = { ...idle, held: new Set([Action.Attack]) };
      attack.tick(press, 0, { x: 0, z: 0 }, { x: 8, z: 0 }, DT);
      let fraction = 0;
      for (let i = 0; i < Math.round(holdS / DT); i++) fraction = attack.tick(held, 0, { x: 0, z: 0 }, { x: 8, z: 0 }, DT).chargeFraction;
      return fraction;
    };
    expect(fractionAfter(0.6, 0.6)).toBeCloseTo(1, 2);
    expect(fractionAfter(2, 0.6)).toBeLessThan(0.4);
    const circularTicks = (durationS: number) => {
      const attack = new AttackController(DEFAULT_BEY_DEFINITION.attack, 1.5, false, 1, true, { ...DEFAULT_ATTACK_TUNING, circularActiveDurationS: durationS });
      attack.tick({ ...idle, held: new Set([Action.Attack]), pressedThisFrame: new Set([Action.Attack]) }, 0, { x: 0, z: 0 }, { x: 8, z: 0 }, DT);
      let n = 0;
      for (let i = 0; i < 120; i++) if (attack.tick(idle, 0, { x: 0, z: 0 }, { x: 8, z: 0 }, DT).state === AttackState.CircularActive) n++;
      return n * DT;
    };
    expect(circularTicks(0.6)).toBeGreaterThan(circularTicks(0.2) + 0.25);
  });

  it('the Dash turns toward the opponent fast right after the release, then at the lock-on rate', () => {
    const headingAfter = (snapRadPerS: number) => {
      const attack = new AttackController(DEFAULT_BEY_DEFINITION.attack, 1.5, false, 1, true, { ...DEFAULT_ATTACK_TUNING, dashSnapRadPerS: snapRadPerS, dashSnapWindowS: 0.1, dashLockOnRadPerS: 1 });
      const press: ControllerActions = { ...idle, held: new Set([Action.Attack]), pressedThisFrame: new Set([Action.Attack]) };
      const held: ControllerActions = { ...idle, held: new Set([Action.Attack]) };
      attack.tick(press, 0, { x: 0, z: 0 }, { x: 8, z: 0 }, DT);
      for (let i = 0; i < 12; i++) attack.tick(held, 0, { x: 0, z: 0 }, { x: 8, z: 0 }, DT);
      attack.tick(idle, 0, { x: 0, z: 0 }, { x: 8, z: 0 }, DT);
      // the opponent jumps to the other side: the Dash has to turn round
      let heading = 0;
      for (let i = 0; i < 6; i++) heading = attack.tick(idle, 0, { x: 0, z: 0 }, { x: 0, z: 8 }, DT).dashOverride?.headingRad ?? heading;
      return heading;
    };
    expect(Math.abs(headingAfter(40) - headingAfter(1))).toBeGreaterThan(0.1);
  });
});

describe('Bey Real dodge numbers', () => {
  it('the invulnerable time, the burst and the Perfect window follow the sliders', () => {
    expect(dodgeTuningOf(config)).toEqual({ activeDurationS: 0.5, burstDurationS: 0.17, perfectWindowS: 0.2 });
    const dodge = new DodgeController(1, 0, 1, true, null, { activeDurationS: 0.4, burstDurationS: 0.1, perfectWindowS: 0.05 });
    const press: ControllerActions = { ...idle, held: new Set([Action.Dodge]), pressedThisFrame: new Set([Action.Dodge]) };
    const tick = (actions: ControllerActions) => dodge.tick({} as never, actions, 0, true, 100, DT);
    let out = tick(press);
    expect(out.state).toBe(DodgeState.Dodging);
    expect(out.dodgeOverride).not.toBeNull();
    let burstTicks = 0;
    let dodgingTicks = 0;
    let perfectTicks = 0;
    for (let i = 0; i < 90; i++) {
      out = tick(idle);
      if (out.dodgeOverride) burstTicks++;
      if (out.state === DodgeState.Dodging) dodgingTicks++;
      if (out.isPerfectWindow) perfectTicks++;
    }
    expect(burstTicks * DT).toBeLessThan(0.15);
    expect(dodgingTicks * DT).toBeGreaterThan(0.3);
    expect(dodgingTicks * DT).toBeLessThan(0.45);
    expect(perfectTicks * DT).toBeLessThan(0.1);
  });

  it('the dodge costs the slider\'s share of the spin (points = share × 100)', () => {
    expect(realMatchOverrides(config).dodgeStaminaCost).toBeCloseTo(1, 9);
    expect(realMatchOverrides({ ...config, dodgeSpinCost: 0.06 }).dodgeStaminaCost).toBeCloseTo(6, 9);
  });
});

describe('Bey Real stability numbers', () => {
  it('Stability climbs back at the slider\'s rate after the wait', () => {
    const climb = (perS: number) => {
      const s = new StabilitySystem({ recoveryDelayS: 1.5, recoveryPerS: perS, brokenDurationS: 2.4 });
      s.applyDamage(50);
      for (let i = 0; i < 60 * 3; i++) s.tick(DT);
      return s.resource.value;
    };
    expect(climb(20)).toBeGreaterThan(climb(2) + 10);
  });

  it('Broken ends the slider\'s time after the last hit, at the recovery floor', () => {
    const s = new StabilitySystem(stabilityRecoveryOf(config));
    s.applyDamage(1000);
    expect(s.isBroken).toBe(true);
    for (let i = 0; i < Math.round(2.2 / DT); i++) s.tick(DT);
    expect(s.isBroken).toBe(true);
    for (let i = 0; i < Math.round(0.4 / DT); i++) s.tick(DT);
    expect(s.isBroken).toBe(false);
    expect(s.resource.value).toBeGreaterThanOrEqual(20);
    // the classic Broken is untouched
    const classic = new StabilitySystem();
    classic.applyDamage(1000);
    for (let i = 0; i < Math.round(3 / DT); i++) classic.tick(DT);
    expect(classic.isBroken).toBe(true);
  });
});

describe('Bey Real contact', () => {
  const head = { x: 1, z: 0 };

  it('two Beys driving at each other bounce apart; a spent spin rebounds less than a full one', () => {
    const full = resolveRealContact(config, body(6, 0, 1), body(-6, 0, 1, -1), head)!;
    const tired = resolveRealContact(config, body(6, 0, 0.05), body(-6, 0, 0.05, -1), head)!;
    expect(full.velocityA.x).toBeLessThan(0);
    expect(full.velocityB.x).toBeGreaterThan(0);
    expect(Math.abs(full.velocityA.x)).toBeGreaterThan(Math.abs(tired.velocityA.x));
    // momentum along the normal is conserved (equal masses, no friction through the line of centres)
    expect(full.velocityA.x + full.velocityB.x).toBeCloseTo(0, 6);
  });

  it('nothing happens to Beys that are not approaching', () => {
    expect(resolveRealContact(config, body(-1, 0), body(1, 0), head)).toBeNull();
    expect(resolveRealContact(config, body(0, 0), body(0, 0), head)).toBeNull();
  });

  it('the heavier Bey is moved less', () => {
    const out = resolveRealContact(config, body(5, 0, 1, 1, 1), body(-5, 0, 1, -1, 3), head)!;
    expect(Math.abs(out.velocityA.x - 5)).toBeGreaterThan(Math.abs(out.velocityB.x + 5));
  });

  it('rim friction drags the Beys sideways, and spin moves between them: opposite spins mesh, the same spin grinds', () => {
    const opposite = resolveRealContact(config, body(5, 0, 1, 1), body(-5, 0, 1, -1), head)!;
    const same = resolveRealContact(config, body(5, 0, 1, 1), body(-5, 0, 1, 1), head)!;
    // opposite spins: the two rims move the same way at the contact — they mesh, nothing rubs
    expect(Math.abs(opposite.velocityA.z)).toBeCloseTo(0, 9);
    // the same spin: the rims move against each other — they grind, and the friction drags both sideways
    expect(Math.abs(same.velocityA.z)).toBeGreaterThan(0.5);
    const noFriction = resolveRealContact({ ...config, rimFriction: 0 }, body(5, 0, 1, 1), body(-5, 0, 1, -1), head)!;
    expect(noFriction.velocityA.z).toBeCloseTo(0, 9);
    expect(noFriction.spinDeltaA).toBeLessThan(0); // an impact still wears the spin
    // the friction is bounded by the slider times the impulse
    const capped = resolveRealContact({ ...config, rimFriction: 0.1 }, body(5, 0, 1, 1), body(-5, 0, 1, 1), head)!;
    expect(Math.abs(capped.velocityA.z)).toBeLessThanOrEqual(0.1 * capped.impulse + 1e-9);
    expect(RIM_SPEED_MPS).toBe(10);
  });

  it('impacts and rubbing wear the spin; the exchange moves it between the Beys', () => {
    const base = resolveRealContact(config, body(5, 0, 1, 1), body(-5, 0, 1, -1), head)!;
    const gentle = resolveRealContact({ ...config, hitSpinLoss: 0, rubSpinLoss: 0, spinExchange: 0 }, body(5, 0, 1, 1), body(-5, 0, 1, -1), head)!;
    expect(gentle.spinDeltaA).toBeCloseTo(0, 12);
    expect(base.spinDeltaA).toBeLessThan(gentle.spinDeltaA);
    // a Bey that also slides along the other's rim: the friction is not zero, and the two spin the other way round
    const exchange = resolveRealContact({ ...config, hitSpinLoss: 0, rubSpinLoss: 0, spinExchange: 0.05 }, body(5, 3, 1, 1), body(-5, 0, 1, -1), head)!;
    expect(exchange.spinDeltaA).not.toBeCloseTo(0, 6);
    expect(exchange.spinDeltaA).toBeCloseTo(-exchange.spinDeltaB, 9);
  });

  it('the impulse (what Stability pays for) grows with the closing speed', () => {
    const slow = resolveRealContact(config, body(2, 0), body(-2, 0, 1, -1), head)!;
    const fast = resolveRealContact(config, body(8, 0), body(-8, 0, 1, -1), head)!;
    expect(fast.impulse).toBeGreaterThan(slow.impulse * 3);
  });

  it('the spin energy pools: Stamina takes signed shares of the full spin', () => {
    const stamina = new StaminaSystem(1);
    stamina.addSpinShare(-0.1);
    expect(stamina.resource.fraction).toBeCloseTo(0.9, 9);
    stamina.addSpinShare(0.05);
    expect(stamina.resource.fraction).toBeCloseTo(0.95, 9);
    stamina.addSpinShare(0.5);
    expect(stamina.resource.fraction).toBe(1);
    stamina.spendSpinShare(0.25);
    expect(stamina.resource.fraction).toBeCloseTo(0.75, 9);
  });
});

describe('Bey Real spin direction and AI', () => {
  it('the second Bey spins the opposite way unless the slider says the same', () => {
    expect(realSecondSpinDir(config)).toBe(-1);
    expect(realSecondSpinDir({ ...config, sameSpin: 1 })).toBe(1);
  });

  it('the AI sliders replace the personality\'s aggression and the difficulty\'s reaction, error and evasion', () => {
    const personality = realAiPersonality(ATTACK_AI_PERSONALITY, { ...config, aiAggression: 0.2 });
    expect(personality.aggression).toBe(0.2);
    expect(personality.reactionDelaySeconds).toBe(ATTACK_AI_PERSONALITY.reactionDelaySeconds);
    const base = AI_DIFFICULTY_TIERS[0]!.profile;
    const sloppy = realAiDifficulty(base, { ...config, aiSkill: 0 });
    const sharp = realAiDifficulty(base, { ...config, aiSkill: 1 });
    expect(sharp.reactionDelayMultiplier).toBeLessThan(sloppy.reactionDelayMultiplier);
    expect(sharp.errorRateMultiplier).toBeLessThan(sloppy.errorRateMultiplier);
    expect(sharp.errorRateMultiplier).toBeGreaterThan(0); // never perfect
    expect(sharp.evasionMultiplier).toBeGreaterThan(sloppy.evasionMultiplier);
    expect(sharp.predictionStrength).toBe(base.predictionStrength);
    expect(sharp.adaptationMultiplier).toBe(base.adaptationMultiplier);
  });
});

describe('Bey Real match rules from the sliders (the rest)', () => {
  it('the classic top-speed scale does not multiply the mode\'s Dash', () => {
    expect(realMatchOverrides(config).topSpeedScale).toBe(1);
  });
});
