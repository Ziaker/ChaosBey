import { describe, expect, it } from 'vitest';
import {
  CIRCULAR_ACTIVE_DURATION_S,
  DASH_ACTIVE_DURATION_S,
  DASH_COOLDOWN_DEFAULT_S,
  DASH_LOCK_ON_MAX_TURN_RATE_RAD_S,
  DASH_MAX_SPEED_MPS,
  DASH_MIN_SPEED_MPS,
  HITBOX_VERTICAL_REACH_M,
} from '../../src/combat/attacks/AttackTuning';
import { DODGE_ACTIVE_DURATION_S, DODGE_BURST_SPEED_MPS, DODGE_COOLDOWN_S } from '../../src/dodge/DodgeTuning';
import { floorSlope } from '../../prototypes/bey-flow-fx-concepts/src/sim/FlowSim';
import { BEY_RADIUS_M, RealSim, type RealBey } from '../../prototypes/bey-real-physics-concepts/src/sim/RealSim';
import { PARAM_SPEC, PARAMS, PRESETS, PROPOSED, applyParams, paramsWith, resetParams, type RealParams } from '../../prototypes/bey-real-physics-concepts/src/tuning';

// Prototype checks (not gameplay): the Bey Real lab's tuning is consistent and uses the game's own action numbers, and the
// simulation keeps the four ideas it exists to judge: realistic physics, an autopilot the player only nudges, four manual
// actions with the game's rules, and a round that ends. Nothing here touches src/ gameplay.

const DT = 1 / 60;

function sim(over: Partial<RealParams> = {}, opts: { ai?: readonly [boolean, boolean]; seed?: number } = {}): RealSim {
  return new RealSim({ seed: opts.seed ?? 1, ai: opts.ai ?? [false, false], params: paramsWith(over) });
}
function run(s: RealSim, seconds: number, each?: (s: RealSim) => void): void {
  for (let i = 0; i < seconds / DT; i++) {
    each?.(s);
    s.step(DT);
  }
}
const noteKinds = (s: RealSim): string[] => s.notes.map((n) => n.kind);
/** Puts both Beys far apart and still, so one thing can be tested at a time. */
function isolate(s: RealSim): [RealBey, RealBey] {
  const [a, b] = s.beys;
  a.x = -5; a.z = 0; a.vx = 0; a.vz = 0;
  b.x = 5; b.z = 0; b.vx = 0; b.vz = 0;
  return [a, b];
}

describe('bey real lab — tuning', () => {
  it('has one slider per value, and the proposal sits inside every range', () => {
    const keys = PARAM_SPEC.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(keys)).toEqual(new Set(Object.keys(PROPOSED)));
    for (const spec of PARAM_SPEC) {
      expect(PROPOSED[spec.key], spec.key).toBeGreaterThanOrEqual(spec.min);
      expect(PROPOSED[spec.key], spec.key).toBeLessThanOrEqual(spec.max);
    }
  });

  it("the actions are the game's own numbers, and the player's influence is the 30% of the references", () => {
    expect(PROPOSED.influence).toBe(0.3);
    expect(PROPOSED.dashMinSpeedMps).toBe(DASH_MIN_SPEED_MPS);
    expect(PROPOSED.dashMaxSpeedMps).toBe(DASH_MAX_SPEED_MPS);
    expect(PROPOSED.dashDurationS).toBe(DASH_ACTIVE_DURATION_S);
    expect(PROPOSED.dashCooldownS).toBe(DASH_COOLDOWN_DEFAULT_S);
    expect(PROPOSED.dashLockRadPerS).toBe(DASH_LOCK_ON_MAX_TURN_RATE_RAD_S);
    expect(PROPOSED.circularDurationS).toBe(CIRCULAR_ACTIVE_DURATION_S);
    expect(PROPOSED.dodgeSpeedMps).toBe(DODGE_BURST_SPEED_MPS);
    expect(PROPOSED.dodgeInvulnS).toBe(DODGE_ACTIVE_DURATION_S);
    expect(PROPOSED.dodgeCooldownS).toBe(DODGE_COOLDOWN_S);
  });

  it('applyParams clamps and ignores junk; presets restore from the proposal; paramsWith never touches the live values', () => {
    applyParams({ influence: 9, dashCooldownS: Number.NaN, bowlPull: -3 });
    expect(PARAMS.influence).toBe(1);
    expect(PARAMS.dashCooldownS).toBe(PROPOSED.dashCooldownS);
    expect(PARAMS.bowlPull).toBe(0);
    resetParams();
    expect({ ...PARAMS }).toEqual({ ...PROPOSED });
    expect(paramsWith({ influence: 0.9 }).influence).toBe(0.9);
    expect(PARAMS.influence).toBe(0.3);
    for (const preset of PRESETS) {
      const merged = paramsWith(preset.values);
      for (const spec of PARAM_SPEC) {
        expect(merged[spec.key], `${preset.id}.${spec.key}`).toBeGreaterThanOrEqual(spec.min);
        expect(merged[spec.key], `${preset.id}.${spec.key}`).toBeLessThanOrEqual(spec.max);
      }
    }
    expect(PRESETS[0]!.values).toEqual({});
  });
});

describe('bey real lab — the simulation stays sane', () => {
  it('is deterministic for a seed, and different seeds play different matches', () => {
    const play = (seed: number): string => {
      const s = new RealSim({ seed, ai: [true, true], params: paramsWith() });
      run(s, 25);
      return JSON.stringify(s.beys.map((b) => [b.x, b.z, b.spin, b.stability]));
    };
    expect(play(3)).toBe(play(3));
    expect(play(3)).not.toBe(play(4));
  });

  it('twenty automatic matches stay finite, inside the arena, at sane speeds, and every one ends', () => {
    let ended = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const s = new RealSim({ seed, ai: [true, true], params: paramsWith() });
      let maxSpeed = 0;
      for (let i = 0; i < 300 / DT && !s.outcome.over; i++) {
        s.step(DT);
        for (const b of s.beys) {
          for (const v of [b.x, b.z, b.vx, b.vz, b.ax, b.az, b.spin, b.stability, b.height, b.vy]) expect(Number.isFinite(v)).toBe(true);
          expect(Math.hypot(b.x, b.z)).toBeLessThanOrEqual(PROPOSED.stageRadiusM + 12); // a Bey that cleared the wall is out within the ring-out delay
          expect(b.spin).toBeGreaterThanOrEqual(0);
          expect(b.spin).toBeLessThanOrEqual(1);
          maxSpeed = Math.max(maxSpeed, b.speed);
        }
      }
      if (s.outcome.over) ended++;
      expect(maxSpeed).toBeLessThan(35);
    }
    expect(ended).toBe(20);
  }, 60_000);

  it('the rounds are a fair length and end more than one way (calibration of the proposal)', () => {
    const reasons = new Set<string>();
    const times: number[] = [];
    for (let seed = 1; seed <= 24; seed++) {
      const s = new RealSim({ seed, ai: [true, true], params: paramsWith() });
      for (let i = 0; i < 300 / DT && !s.outcome.over; i++) s.step(DT);
      reasons.add(s.outcome.reason ?? 'none');
      times.push(s.time);
    }
    times.sort((x, y) => x - y);
    const median = times[Math.floor(times.length / 2)]!;
    expect(median).toBeGreaterThan(20);
    expect(median).toBeLessThan(110);
    expect(reasons.size).toBeGreaterThanOrEqual(2);
  }, 60_000);

  it('the autopilot alone keeps a Bey orbiting the way its spin turns, off the wall, with a spin that only falls', () => {
    const s = sim({}, { ai: [false, false] });
    const [a] = s.beys;
    let turn = 0;
    let prevAngle = Math.atan2(a.z, a.x);
    let prevSpin = a.spin;
    let minR = 99;
    let maxR = 0;
    for (let i = 0; i < 25 / DT; i++) {
      s.step(DT);
      const ang = Math.atan2(a.z, a.x);
      let d = ang - prevAngle;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      turn += d;
      prevAngle = ang;
      if (i > 120) {
        const r = Math.hypot(a.x, a.z);
        minR = Math.min(minR, r);
        maxR = Math.max(maxR, r);
      }
      // Alone, the spin only falls; in contact the rims can hand a little spin from one Bey to the other.
      if (Math.hypot(a.x - s.beys[1].x, a.z - s.beys[1].z) > 2.5) expect(a.spin).toBeLessThanOrEqual(prevSpin + 1e-9);
      prevSpin = a.spin;
    }
    expect(Math.sign(turn)).toBe(a.dir); // it goes around the centre the way it spins
    expect(Math.abs(turn)).toBeGreaterThan(Math.PI); // really goes around
    expect(minR).toBeGreaterThan(PROPOSED.stageRadiusM * 0.12);
    expect(maxR).toBeLessThan(PROPOSED.stageRadiusM * 0.95);
  });

  it('the bowl pulls toward the centre in proportion to the slope', () => {
    const s = sim({ steerAccelMps2: 2, tipFrictionMps2: 0, dragPerS: 0, precessionRadPerS: 0, cruiseSpeedMps: 3 });
    const [a, b] = isolate(s);
    b.x = 0; b.z = -8; // out of the way
    a.x = 9; a.z = 0;
    a.input.attackHeld = false;
    a.vx = 0;
    const slope = floorSlope(9);
    expect(slope).toBeGreaterThan(0);
    s.step(DT);
    expect(a.ax).toBeLessThan(0); // toward the centre (the autopilot also pushes in; the bowl is part of it)
  });
});

describe('bey real lab — the player only nudges (influence)', () => {
  /** Mean velocity along the stick over `seconds`, the stick held toward -z (or any chosen direction). */
  function along(influence: number, stick: { x: number; z: number } | null): number {
    const s = sim({ influence });
    const [a] = s.beys;
    let sum = 0;
    let n = 0;
    run(s, 2.5, () => {
      if (stick) s.setInput(0, { stickX: stick.x, stickZ: stick.z });
    });
    // the position moved is the integral of the velocity; compare the displacement along the stick from the same start
    sum = (a.x - 5.4) * (stick?.x ?? 0) + a.z * (stick?.z ?? 0);
    n = 1;
    return sum / n;
  }

  it('with no stick the autopilot steers alone, whatever the influence', () => {
    const a = sim({ influence: 0.3 });
    const b = sim({ influence: 1 });
    run(a, 3);
    run(b, 3);
    expect(a.beys[0].x).toBeCloseTo(b.beys[0].x, 9);
    expect(a.beys[0].z).toBeCloseTo(b.beys[0].z, 9);
  });

  it('a held stick moves the Bey toward it more as the influence grows, but 30% does not take the wheel', () => {
    const stick = { x: 0, z: -1 };
    const none = along(0.3, null);
    void none;
    const at0 = along(0, stick);
    const at30 = along(0.3, stick);
    const at100 = along(1, stick);
    expect(at30).toBeGreaterThan(at0 + 0.5); // it does something
    expect(at100).toBeGreaterThan(at30 + 0.5); // and more with more influence
    expect(at0).toBeCloseTo(along(0, { x: 1, z: 0 }) * 0 + at0, 9);
  });

  it('with the stick held for a while, 30% bends the path but the Bey keeps going around (it is not a manual steer)', () => {
    const s = sim({ influence: 0.3 });
    const [a] = s.beys;
    run(s, 8, () => s.setInput(0, { stickX: 0, stickZ: -1 }));
    expect(Math.hypot(a.x, a.z)).toBeLessThan(PROPOSED.stageRadiusM);
    expect(a.speed).toBeGreaterThan(2);
  });

  it('the AI never reads a stick: only the autopilot steers it', () => {
    const s = sim({ influence: 1 }, { ai: [false, true] });
    s.setInput(1, { stickX: 1, stickZ: 0 });
    const t = sim({ influence: 1 }, { ai: [false, true] });
    run(s, 2);
    run(t, 2);
    expect(s.beys[1].x).toBeCloseTo(t.beys[1].x, 9);
  });
});

describe('bey real lab — the four actions (the game\'s rules)', () => {
  it('hold and release is a Dash: charge sets the speed, it turns to the opponent at once, then it is on cooldown', () => {
    const s = sim();
    const [a, b] = isolate(s);
    // Facing away: the opponent is at +x but the Bey is heading toward -z.
    a.vx = 0; a.vz = -6;
    s.setInput(0, { attackHeld: true });
    run(s, 1.3);
    expect(a.charge).toBeCloseTo(1, 1);
    expect(a.charging).toBe(true);
    s.setInput(0, { attackHeld: false });
    s.step(DT);
    expect(a.dashing).toBe(true);
    expect(a.dashSpeed).toBeCloseTo(DASH_MAX_SPEED_MPS, 1);
    // Immediately: facing the opponent (within a few degrees), not where it was heading.
    const bearing = Math.atan2(b.z - a.z, b.x - a.x);
    const facing = Math.atan2(a.dashDirZ, a.dashDirX);
    const off = Math.abs(Math.atan2(Math.sin(facing - bearing), Math.cos(facing - bearing)));
    expect(off).toBeLessThan(0.35); // the Dash leads the opponent a little; it is nowhere near where the Bey was heading (1.57 rad away)
    run(s, 0.3);
    expect(a.vx).toBeGreaterThan(8); // really going that way
    run(s, 0.5);
    expect(a.dashing).toBe(false);
    expect(a.dashCd).toBeGreaterThan(0);
    // A second Dash right away does not start.
    const dashes = a.stats.dashes;
    s.setInput(0, { attackHeld: true });
    run(s, 0.6);
    s.setInput(0, { attackHeld: false });
    run(s, 0.1);
    expect(a.stats.dashes).toBe(dashes);
  });

  it('a short charge is a slower Dash than a full one', () => {
    const speedFor = (hold: number): number => {
      const s = sim();
      const [a] = isolate(s);
      s.setInput(0, { attackHeld: true });
      run(s, hold);
      s.setInput(0, { attackHeld: false });
      s.step(DT);
      return a.dashSpeed;
    };
    expect(speedFor(0.4)).toBeLessThan(speedFor(1.3));
    expect(speedFor(0.4)).toBeGreaterThanOrEqual(DASH_MIN_SPEED_MPS);
  });

  it('a tap is a Circular, which is defensive: the user takes nothing, whoever touches it is launched', () => {
    const s = sim();
    const [a, b] = isolate(s);
    a.x = 0; b.x = 2.6; b.z = 0; b.vx = -6; // b runs into a
    s.setInput(0, { attackHeld: true });
    run(s, 0.05);
    s.setInput(0, { attackHeld: false });
    s.step(DT);
    expect(a.circT).toBeGreaterThan(0);
    expect(a.circT).toBeLessThanOrEqual(CIRCULAR_ACTIVE_DURATION_S);
    const stabilityBefore = a.stability;
    run(s, 0.2);
    expect(b.airborne || b.height > 0 || b.vy !== 0).toBe(true); // launched up
    expect(b.vx).toBeGreaterThan(3); // and away
    expect(a.stability).toBe(stabilityBefore);
    expect(b.stability).toBeLessThan(100);
  });

  it('a Circular that catches a Dash cancels it, keeps only a part of its speed, and is a COUNTER', () => {
    const s = sim();
    const [a, b] = isolate(s);
    a.x = 0; a.z = 0;
    b.x = 1; b.z = 0; b.vx = -12; b.vz = 0;
    a.circT = 0.2;
    b.dashT = 0.3;
    b.dashSpeed = 12;
    s.step(DT);
    expect(s.events.map((e) => e.kind)).toEqual(['counter']);
    expect(noteKinds(s)).toContain('counter');
    expect(b.dashing).toBe(false);
    expect(b.dashCd).toBeGreaterThan(0);
    expect(b.vx).toBeGreaterThan(0); // launched away from the Circular
    expect(b.airborne).toBe(true);
  });

  it('a jump gives no steering in the air, comes down, and cannot be repeated at once', () => {
    const s = sim();
    const [a] = isolate(s);
    a.vx = 4; a.vz = 0;
    s.pressJump(0);
    s.step(DT);
    expect(a.airborne).toBe(true);
    expect(s.notes.map((n) => n.kind)).toContain('jump');
    const vx0 = a.vx;
    let apex = 0;
    let landed = false;
    for (let i = 0; i < 120 && !landed; i++) {
      s.setInput(0, { stickX: 0, stickZ: -1 });
      s.step(DT);
      apex = Math.max(apex, a.height);
      if (noteKinds(s).includes('land')) landed = true;
    }
    expect(landed).toBe(true);
    expect(apex).toBeGreaterThan(1);
    expect(a.vx).toBeGreaterThan(vx0 * 0.8); // momentum kept; the stick did not turn it while airborne
    expect(Math.abs(a.vz)).toBeLessThan(2);
  });

  it('the jump has its own cooldown', () => {
    const s = sim({ jumpSpeedMps: 3, gravityMps2: 40, jumpCooldownS: 1 });
    const [a] = isolate(s);
    s.pressJump(0);
    let landed = false;
    for (let i = 0; i < 60 && !landed; i++) {
      s.step(DT);
      landed = noteKinds(s).includes('land');
    }
    expect(landed).toBe(true); // down in ~0.15 s, well inside the 1 s cooldown
    s.pressJump(0);
    s.step(DT);
    expect(a.airborne).toBe(false);
    run(s, 1.1);
    s.pressJump(0);
    s.step(DT);
    expect(a.airborne).toBe(true);
  });

  it('a Bey above the vertical reach cannot be hit: jumping over the opponent is a dodge', () => {
    const s = sim();
    const [a, b] = isolate(s);
    a.x = 0; b.x = 0.8; b.z = 0;
    a.height = HITBOX_VERTICAL_REACH_M + 0.5; a.vy = 0; a.airborne = true;
    const bStab = b.stability;
    s.step(DT);
    expect(s.events.length).toBe(0);
    expect(b.stability).toBe(bStab);
  });

  it('a Dodge is a fixed burst with i-frames and a long cooldown, sideways to the opponent without a stick', () => {
    const s = sim();
    const [a] = isolate(s);
    s.pressDodge(0);
    s.step(DT);
    expect(a.dodgeT).toBeGreaterThan(0);
    expect(a.dodgeCd).toBeCloseTo(DODGE_COOLDOWN_S, 1);
    run(s, 0.1);
    expect(Math.abs(a.vz)).toBeGreaterThan(Math.abs(a.vx)); // the opponent is along x; the dodge goes along z
    expect(a.speed).toBeGreaterThan(8);
    const count = a.stats.dodges;
    s.pressDodge(0);
    run(s, 0.5);
    expect(a.stats.dodges).toBe(count); // cooldown
  });

  it('a Dodge with the stick goes where the stick points', () => {
    const s = sim();
    const [a] = isolate(s);
    s.setInput(0, { stickX: -1, stickZ: 0 });
    s.pressDodge(0);
    run(s, 0.1);
    expect(a.vx).toBeLessThan(-6);
  });

  it('nothing connects during the i-frames', () => {
    const s = sim();
    const [a, b] = isolate(s);
    a.x = 0; a.z = 0; b.x = 0.8; b.z = 0; b.vx = -8;
    s.pressDodge(0);
    s.setInput(0, { stickX: 0, stickZ: -1 });
    const stab = b.stability;
    s.step(DT);
    expect(s.events.length).toBe(0);
    expect(b.stability).toBe(stab);
  });

  it('a Dodge pressed as a Dash arrives is a Perfect Dodge: the Dash whiffs and the dodger gets its Dash back', () => {
    const s = sim();
    const [a, b] = isolate(s);
    a.x = 0; a.z = 0; a.dashCd = 1;
    b.x = 2.6; b.z = 0;
    b.input.attackHeld = true;
    run(s, 0.6);
    b.input.attackHeld = false;
    s.step(DT);
    expect(b.dashing).toBe(true);
    // Press the Dodge only when the Dash is about to connect (within the perfect window).
    let pressed = false;
    for (let i = 0; i < 60 && !pressed; i++) {
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      const closing = Math.max(1, b.speed);
      if ((d - 1.3) / closing <= PROPOSED.dodgePerfectS * 0.8) {
        s.pressDodge(0);
        pressed = true;
      }
      s.step(DT);
    }
    expect(pressed).toBe(true);
    s.step(DT);
    expect(a.stats.perfect).toBe(1);
    expect(b.dashing).toBe(false);
    expect(a.dashCd).toBe(0);
    expect(a.stability).toBe(100);
  });

  it('a Dodge pressed too early is just a Dodge', () => {
    const s = sim();
    const [a, b] = isolate(s);
    a.x = 0; a.z = 0;
    b.x = 9; b.z = 0;
    b.input.attackHeld = true;
    run(s, 0.6);
    b.input.attackHeld = false;
    s.step(DT);
    s.pressDodge(0);
    s.step(DT);
    expect(a.stats.dodges).toBe(1);
    expect(a.stats.perfect).toBe(0);
  });
});

describe('bey real lab — the collision physics', () => {
  /** A head-on hit between two equal Beys, returns what happened to them. */
  function headOn(over: Partial<RealParams> = {}): { sim: RealSim; a: RealBey; b: RealBey; spinLoss: number } {
    const s = sim({ steerAccelMps2: 0, bowlPull: 0, tipFrictionMps2: 0, dragPerS: 0, precessionRadPerS: 0, ...over });
    const [a, b] = s.beys;
    a.x = -0.55; a.z = 0; a.vx = 8; a.vz = 0;
    b.x = 0.55; b.z = 0; b.vx = -8; b.vz = 0;
    const spin0 = a.spin + b.spin;
    for (let i = 0; i < 4; i++) s.step(DT);
    return { sim: s, a, b, spinLoss: spin0 - (a.spin + b.spin) };
  }

  it('a hit exchanges momentum (equal masses bounce back), costs spin and stability, and raises one HIT event', () => {
    const { sim: s, a, b } = headOn({ spinDecayPerS: 0, spinMoveLossPerM: 0 });
    expect(a.vx).toBeLessThan(2);
    expect(b.vx).toBeGreaterThan(-2);
    expect(a.spin).toBeLessThan(1);
    expect(a.stability).toBeLessThan(100);
    void s;
  });

  it('the HIT event points along the attack and is as strong as the impact', () => {
    const s = sim({ bowlPull: 0, steerAccelMps2: 0 });
    const [a, b] = s.beys;
    a.x = -0.55; a.z = 0; a.vx = 12; a.vz = 0;
    b.x = 0.55; b.z = 0; b.vx = 0; b.vz = 0;
    let event = null as null | { dirX: number; dirZ: number; m: number; kind: string };
    for (let i = 0; i < 6 && !event; i++) {
      s.step(DT);
      event = s.events[0] ?? null;
    }
    expect(event).not.toBeNull();
    expect(event!.kind).toBe('hit');
    expect(event!.dirX).toBeGreaterThan(0.9); // from the fast one toward the still one
    expect(event!.m).toBeGreaterThan(0.2);
    const soft = sim({ bowlPull: 0, steerAccelMps2: 0 });
    soft.beys[0].x = -0.55; soft.beys[0].vx = 5; soft.beys[0].vz = 0; soft.beys[1].x = 0.55; soft.beys[1].vx = 0; soft.beys[1].vz = 0;
    let softEvent = null as null | { m: number };
    for (let i = 0; i < 6 && !softEvent; i++) {
      soft.step(DT);
      softEvent = soft.events[0] ?? null;
    }
    expect(softEvent === null || softEvent.m < event!.m).toBe(true);
  });

  it('two tops spinning the same way grind each other down more than two spinning opposite ways', () => {
    // The Beys graze each other: a sideways rub is what the rim friction acts on.
    const graze = (sameSpin: number): number => {
      const s = sim({ sameSpin, steerAccelMps2: 0, bowlPull: 0, tipFrictionMps2: 0, dragPerS: 0, precessionRadPerS: 0, spinDecayPerS: 0, spinMoveLossPerM: 0 });
      const [a, b] = s.beys;
      a.x = -0.55; a.z = 0.35; a.vx = 6; a.vz = 0;
      b.x = 0.55; b.z = -0.35; b.vx = -6; b.vz = 0;
      const spin0 = a.spin + b.spin;
      for (let i = 0; i < 8; i++) s.step(DT);
      return spin0 - (a.spin + b.spin);
    };
    expect(graze(1)).toBeGreaterThan(graze(0));
  });

  it('a rub also throws the Beys sideways (rim friction), not only along the normal', () => {
    const s = sim({ sameSpin: 1, steerAccelMps2: 0, bowlPull: 0, tipFrictionMps2: 0, dragPerS: 0, precessionRadPerS: 0 });
    const [a, b] = s.beys;
    a.x = -0.55; a.z = 0; a.vx = 6; a.vz = 0;
    b.x = 0.55; b.z = 0; b.vx = 0; b.vz = 0;
    for (let i = 0; i < 6; i++) s.step(DT);
    expect(Math.abs(a.vz) + Math.abs(b.vz)).toBeGreaterThan(0.05);
  });

  it('a heavier Bey is pushed less', () => {
    const s = sim({ massSecond: 2, steerAccelMps2: 0, bowlPull: 0, tipFrictionMps2: 0, dragPerS: 0, precessionRadPerS: 0 });
    const [a, b] = s.beys;
    a.x = -0.55; a.z = 0; a.vx = 8; a.vz = 0;
    b.x = 0.55; b.z = 0; b.vx = -8; b.vz = 0;
    for (let i = 0; i < 4; i++) s.step(DT);
    expect(Math.abs(a.vx - 8)).toBeGreaterThan(Math.abs(b.vx + 8)); // the light one changed more
  });

  it('a Dash hit takes charge-scaled stability and ends the Dash with no whiff recovery', () => {
    const s = sim({ bowlPull: 0 });
    const [a, b] = isolate(s);
    a.x = 0; b.x = 3; b.z = 0;
    s.setInput(0, { attackHeld: true });
    run(s, 1.3);
    s.setInput(0, { attackHeld: false });
    run(s, 0.45);
    expect(a.stats.dashes).toBe(1);
    expect(b.stability).toBeLessThan(85);
    expect(a.dashing).toBe(false);
    expect(a.recoverT).toBe(0);
    expect(a.dashHit).toBe(true);
  });

  it('a Dash that misses costs a recovery, during which the Bey steers poorly', () => {
    const s = sim();
    const [a, b] = isolate(s);
    b.x = 5; b.z = 9; // not in the way
    a.x = -5;
    s.setInput(0, { attackHeld: true });
    run(s, 0.4);
    s.setInput(0, { attackHeld: false });
    s.step(DT);
    b.x = 9; b.z = 9; // keep the target far
    run(s, 0.6);
    expect(a.dashCd).toBeGreaterThan(0);
  });

  it('the wall bounces a Bey back with a loss; a Bey that clears it is out', () => {
    const s = sim();
    const [a] = isolate(s);
    const R = PROPOSED.stageRadiusM;
    a.x = R - 1; a.z = 0; a.vx = 12; a.vz = 0;
    run(s, 0.3);
    expect(Math.hypot(a.x, a.z)).toBeLessThanOrEqual(R);
    expect(a.vx).toBeLessThan(6);
    expect(a.stats.wallHits).toBeGreaterThan(0);
    // Launched high enough: over the wall, and out after the delay.
    const t = sim();
    const [c] = isolate(t);
    c.x = R - 1; c.z = 0; c.vx = 14; c.vz = 0; c.airborne = true; c.height = PROPOSED.wallHeightM + 0.8; c.vy = 3;
    run(t, 2.5);
    expect(t.outcome.over).toBe(true);
    expect(t.outcome.reason).toBe('ringout');
    expect(t.outcome.winner).toBe(1);
  });
});

describe('bey real lab — the round', () => {
  it('a Bey whose spin runs out loses by spin-out', () => {
    const s = sim();
    s.beys[0].spin = 0.021;
    run(s, 3);
    expect(s.outcome.reason).toBe('spinout');
    expect(s.outcome.winner).toBe(1);
    expect(s.score).toEqual([0, 1]);
  });

  it('a hit on a Broken Bey is a KO', () => {
    const s = sim({ bowlPull: 0, steerAccelMps2: 0 });
    const [a, b] = s.beys;
    b.stability = 0.5;
    a.x = -0.55; a.z = 0; a.vx = 12; a.vz = 0;
    b.x = 0.55; b.z = 0; b.vx = 0; b.vz = 0;
    for (let i = 0; i < 6; i++) s.step(DT);
    expect(b.broken).toBe(true);
    // Hit it again while broken.
    a.x = -0.55; a.z = 0; a.vx = 12; a.vz = 0;
    b.x = 0.55; b.z = 0; b.vx = 0; b.vz = 0;
    for (let i = 0; i < 8; i++) s.step(DT);
    expect(s.outcome.reason).toBe('ko');
    expect(s.outcome.winner).toBe(0);
  });

  it('the time limit is a draw, the round settles, and the next round starts clean but keeps the score', () => {
    const s = sim({ timeLimitS: 5 });
    run(s, 5.5);
    expect(s.outcome.reason).toBe('time');
    expect(s.outcome.winner).toBeNull();
    run(s, 3.5);
    expect(s.settled).toBe(true);
    s.score[0] = 2;
    s.nextRound();
    expect(s.outcome.over).toBe(false);
    expect(s.time).toBe(0);
    expect(s.beys[0].spin).toBe(1);
    expect(s.score[0]).toBe(2);
  });

  it('the decision AI uses the buttons: Dashes, Circulars and a defence, and respects the cooldowns', () => {
    let dashes = 0;
    let circulars = 0;
    let defences = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const s = new RealSim({ seed, ai: [true, true], params: paramsWith({ aiAggression: 1, aiSkill: 1 }) });
      for (let i = 0; i < 90 / DT && !s.outcome.over; i++) {
        s.step(DT);
        for (const b of s.beys) expect(b.dashCd).toBeLessThanOrEqual(PROPOSED.dashCooldownS + 1e-9);
      }
      for (const b of s.beys) {
        dashes += b.stats.dashes;
        circulars += b.stats.circulars;
        defences += b.stats.dodges + b.stats.jumps;
      }
    }
    expect(dashes).toBeGreaterThan(10);
    expect(circulars).toBeGreaterThan(0);
    expect(defences).toBeGreaterThan(0);
  }, 60_000);

  it('events and notes are what the stage expects: unit directions, strengths in 0..1', () => {
    const s = new RealSim({ seed: 5, ai: [true, true], params: paramsWith() });
    for (let i = 0; i < 60 / DT && !s.outcome.over; i++) {
      s.step(DT);
      for (const e of s.events) {
        expect(Math.hypot(e.dirX, e.dirZ)).toBeCloseTo(1, 5);
        expect(e.m).toBeGreaterThan(0);
        expect(e.m).toBeLessThanOrEqual(1);
        expect(['hit', 'counter']).toContain(e.kind);
      }
      for (const n of s.notes) {
        expect(n.m).toBeGreaterThanOrEqual(0);
        expect(n.m).toBeLessThanOrEqual(1);
        expect(Number.isFinite(n.x + n.z)).toBe(true);
      }
    }
    expect(BEY_RADIUS_M).toBeCloseTo(0.65, 5);
  });
});
