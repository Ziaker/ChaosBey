// ============================================================
// JUMP / AIR-CONTROL HOTFIX — MANDATORY SELF-TESTS
// Formalizes the owner's required test matrix for this hotfix: the
// monotonic-vy and single-apex invariants (sections 4/5/30/31), the
// short-hop +15% target (sections 6/32), the hold-duration sweep and
// full-jump saturation (sections 29/34), and the +20% air-control
// improvement (sections 14/15/35). Driven through the real
// DriftController/TestBeyHarness, not a simplified stand-in (GDD section
// 114).
// ============================================================

import { describe, expect, it } from 'vitest';
import { Action, type ControllerActions } from '../../src/input/actions/Action';
import { BEY_SPAWN_HEIGHT_M } from '../../src/bey/core/BeyTuning';
import { JUMP_RELEASE_WINDOW_S } from '../../src/drift/DriftTuning';
import { FIXED_DELTA_SECONDS } from '../../src/physics/fixed-step/FixedTimestepLoop';
import { TestBeyHarness } from './physicsHarness';

function classic(held: Action[], pressed: Action[] = []): ControllerActions {
  return { held: new Set(held), pressedThisFrame: new Set(pressed), attackHoldDurationSeconds: 0, jumpDriftHoldDurationSeconds: 0 };
}

function intent(x: number, z: number, held: Action[] = [], pressed: Action[] = []): ControllerActions {
  return { held: new Set(held), pressedThisFrame: new Set(pressed), attackHoldDurationSeconds: 0, jumpDriftHoldDurationSeconds: 0, moveIntent: { x, z } };
}

function heldSequence(heldAt: (tick: number) => Action[]): (tick: number) => ControllerActions {
  let previous = new Set<Action>();
  return (tick: number) => {
    const held = new Set(heldAt(tick));
    const pressedThisFrame = new Set([...held].filter((a) => !previous.has(a)));
    previous = held;
    return { held, pressedThisFrame, attackHoldDurationSeconds: 0, jumpDriftHoldDurationSeconds: 0 };
  };
}

/** A bounce-sized vy jump (floor contact resolving) — never a legitimate part of the rise/fall this suite measures. */
const BOUNCE_VY_JUMP_MPS = 0.5;

interface JumpArc {
  apexM: number;
  /** Ticks until the first bounce-sized vy jump (the primary, uninterrupted rise+fall this hop produced). */
  primaryAirborneTicks: number;
  /** vy(t+1) > vy(t) + tolerance, counted only up to the first bounce — a real "second impulsion". */
  positiveVyIncreaseAfterLaunch: number;
  /** Crossings of vy from > 0 to <= 0, counted only up to the first bounce — a jump's own apex. */
  apexCrossings: number;
}

/** Drives a single hop/jump of `holdTicks` and returns its full vy trace plus the derived invariant measurements. */
async function measureJumpArc(holdTicks: number, totalTicks: number): Promise<JumpArc> {
  const h = await TestBeyHarness.create({ x: 0, y: BEY_SPAWN_HEIGHT_M, z: 0 });
  h.tickMany(classic([]), 60);
  const baseY = h.beyBody.translation().y;
  const actionsFor = heldSequence((t) => (t < holdTicks ? [Action.JumpDrift] : []));
  const vyTrace: number[] = [];
  let apex = baseY;
  for (let t = 0; t < totalTicks; t++) {
    h.tick(actionsFor(t));
    const y = h.beyBody.translation().y;
    if (y > apex) apex = y;
    vyTrace.push(h.beyBody.linvel().y);
  }

  let primaryEnd = vyTrace.length;
  for (let i = 1; i < vyTrace.length; i++) {
    if (vyTrace[i]! > vyTrace[i - 1]! + BOUNCE_VY_JUMP_MPS) {
      primaryEnd = i;
      break;
    }
  }

  let positiveVyIncreaseAfterLaunch = 0;
  let apexCrossings = 0;
  const TOLERANCE_MPS = 1e-3;
  for (let i = 1; i < primaryEnd; i++) {
    if (vyTrace[i]! > vyTrace[i - 1]! + TOLERANCE_MPS) positiveVyIncreaseAfterLaunch++;
    if (vyTrace[i - 1]! > 0 && vyTrace[i]! <= 0) apexCrossings++;
  }

  return { apexM: apex - baseY, primaryAirborneTicks: primaryEnd, positiveVyIncreaseAfterLaunch, apexCrossings };
}

const TICKS_PER_SECOND = Math.round(1 / FIXED_DELTA_SECONDS);
const msToTicks = (ms: number): number => Math.round((ms / 1000) * TICKS_PER_SECOND);

describe('jump/air-control hotfix — hold-duration sweep (section 29)', () => {
  const holdsTicks = [1, 2, 3, 4, 5, msToTicks(80), msToTicks(100), msToTicks(120), msToTicks(160), msToTicks(200), msToTicks(250), msToTicks(300), msToTicks(400), msToTicks(800)];

  it('records apex/airtime/reacceleration/apex-crossings for every mandated hold duration', async () => {
    const rows: { holdTicks: number; apexM: number; primaryAirborneTicks: number; positiveVyIncreaseAfterLaunch: number; apexCrossings: number }[] = [];
    for (const holdTicks of holdsTicks) {
      const arc = await measureJumpArc(holdTicks, 200);
      rows.push({ holdTicks, ...arc });
    }
    // eslint-disable-next-line no-console
    console.log('hold-duration sweep (section 29):', JSON.stringify(rows, null, 1));
    for (const row of rows) {
      expect(row.apexM, `hold ${row.holdTicks}t`).toBeGreaterThan(0);
    }
  });

  it('invariant (section 30): no positive vy reacceleration after launch, for every mandated hold duration — this must FAIL on the old continuous-assist model and PASS on the new one', async () => {
    for (const holdTicks of holdsTicks) {
      const arc = await measureJumpArc(holdTicks, 200);
      expect(arc.positiveVyIncreaseAfterLaunch, `hold ${holdTicks}t`).toBe(0);
    }
  });

  it('invariant (section 31): exactly one apex crossing, for every mandated hold duration', async () => {
    for (const holdTicks of holdsTicks) {
      const arc = await measureJumpArc(holdTicks, 200);
      expect(arc.apexCrossings, `hold ${holdTicks}t`).toBe(1);
    }
  });

  it('section 34: full-jump saturation — holding 300/400/800 ms all produce the same height (holding longer changes nothing once committed)', async () => {
    const a = await measureJumpArc(msToTicks(300), 200);
    const b = await measureJumpArc(msToTicks(400), 200);
    const c = await measureJumpArc(msToTicks(800), 220);
    expect(b.apexM).toBeCloseTo(a.apexM, 2);
    expect(c.apexM).toBeCloseTo(a.apexM, 2);
  });
});

describe('jump/air-control hotfix — short hop +15% (sections 6/32)', () => {
  // Baseline measured before this hotfix (movement/weight/dodge playtest
  // pass's own hold-duration sweep, physicsWeightFeelPass.test.ts): a bare
  // tap's apex was ~0.177 m. Target: 0.177 * 1.15 ~= 0.2036 m.
  const OLD_BASELINE_TAP_APEX_M = 0.177;
  const TARGET_APEX_M = OLD_BASELINE_TAP_APEX_M * 1.15;

  it('a true single-tick tap lands within engineering tolerance of the +15% target, not +30%', async () => {
    const tap = await measureJumpArc(1, 90);
    expect(tap.apexM).toBeGreaterThan(TARGET_APEX_M * 0.9);
    expect(tap.apexM).toBeLessThan(TARGET_APEX_M * 1.1);
    const ratio = tap.apexM / OLD_BASELINE_TAP_APEX_M;
    expect(ratio).toBeGreaterThan(1.05);
    expect(ratio).toBeLessThan(1.3); // explicitly: not 1.30x, per section 32.
  });

  it('quick-tap consistency (section 33, follow-up): ticks 1-2 (up to ~33 ms) stay within the exact-cut window and read as the same hop; ticks 3-5 are reported, not hidden, and must grow far more gently than the pre-follow-up model', async () => {
    const results = await Promise.all([1, 2, 3, 4, 5].map((t) => measureJumpArc(t, 90)));
    const apexes = results.map((r) => r.apexM);
    const airtimes = results.map((r) => r.primaryAirborneTicks);
    // eslint-disable-next-line no-console
    console.log('hold 1-5 ticks, after the height-targeted release cut:', JSON.stringify({ apexes, airtimes }));
    // computeJumpReleaseCapMps's own exact-window math (see DriftController.ts)
    // says ticks 1-2 land inside the window where the release cut hits
    // JUMP_SHORT_HOP_TARGET_APEX_M exactly, regardless of which of the two
    // ticks releases — require that explicitly, not just "doesn't regress".
    expect(apexes[1]! / apexes[0]!).toBeGreaterThan(0.85);
    expect(apexes[1]! / apexes[0]!).toBeLessThan(1.15);
    // Ticks 3-5 are past that window by construction (the window's width is
    // a function of JUMP_LAUNCH_VELOCITY_MPS and the target height alone —
    // see computeJumpReleaseCapMps's comment for why it can't be widened
    // further without lowering the full jump below its approved 1.0-1.5 m
    // floor) and do grow — but the height-targeted cut's smooth ramp
    // (instead of the pre-follow-up model's linear-in-velocity-from-tick-1
    // cut) must keep that growth far gentler: tick 3 within 1.6x of tick 1
    // (was ~2x), tick 5 within 2.5x (was ~2.7x and still linear past it).
    expect(apexes[2]! / apexes[0]!).toBeLessThan(1.6);
    expect(apexes[4]! / apexes[0]!).toBeLessThan(2.5);
  });
});

describe('jump/air-control hotfix — air control (sections 14/15/35)', () => {
  const CORRECTION_WINDOW_TICKS = 16; // ~267 ms, within the spec's 250-300 ms ask.

  interface AirControlResult {
    angleDeg: number;
    lateralM: number;
  }

  async function measure(initialSpeedMps: number, applyCorrection: boolean): Promise<AirControlResult> {
    // Spawned far from the wall (−Z): the correction window alone can cover
    // several meters at the higher test speeds, and this measurement must
    // never let a wall/floor collision contaminate "trajectory correction only".
    const harness = await TestBeyHarness.create({ x: 0, y: BEY_SPAWN_HEIGHT_M, z: -10 });
    harness.tickMany(intent(0, 1), 60); // settle, heading aligned with +Z
    harness.beyBody.setLinvel({ x: 0, y: harness.beyBody.linvel().y, z: initialSpeedMps }, true);

    // A committed full jump: hold JumpDrift well past the release window, keep going straight.
    for (let t = 0; t < 20; t++) {
      harness.tick(intent(0, 1, [Action.JumpDrift], t === 0 ? [Action.JumpDrift] : []));
    }
    // A few ticks of pure airborne straight flight before the correction window (liftoff settle).
    for (let t = 0; t < 4; t++) harness.tick(intent(0, 1));

    const velAtWindowStart = harness.beyBody.linvel();
    const xAtWindowStart = harness.beyBody.translation().x;
    for (let t = 0; t < CORRECTION_WINDOW_TICKS; t++) {
      const dir = applyCorrection ? { x: 1, z: 0 } : { x: 0, z: 1 };
      harness.tick(intent(dir.x, dir.z));
    }
    const velAfter = harness.beyBody.linvel();
    const xAfter = harness.beyBody.translation().x;

    const angleBetween = (ax: number, az: number, bx: number, bz: number): number => {
      const ma = Math.hypot(ax, az);
      const mb = Math.hypot(bx, bz);
      if (ma < 1e-6 || mb < 1e-6) return 0;
      const cos = (ax * bx + az * bz) / (ma * mb);
      return Math.acos(Math.max(-1, Math.min(1, cos))) * (180 / Math.PI);
    };
    return {
      angleDeg: angleBetween(velAtWindowStart.x, velAtWindowStart.z, velAfter.x, velAfter.z),
      lateralM: xAfter - xAtWindowStart,
    };
  }

  // Pre-hotfix baseline (AIRBORNE_ACCELERATION_FACTOR = 0.15), measured
  // before tuning this hotfix's constant — see MovementTuning.ts's own
  // comment on AIRBORNE_ACCELERATION_FACTOR for the full before/after table.
  const BASELINE_ANGLE_DEG: Record<number, number> = { 0: 15.218, 5: 4.327, 10: 3.18, 15: 2.747 };
  const BASELINE_LATERAL_M: Record<number, number> = { 0: 0.0253, 5: 0.0469, 10: 0.0683, 15: 0.0821 };

  it('angular correction improves by at least +20% at 5/10/15 m/s (the primary metric — angle is unstable near 0 m/s, where a Bey has almost no momentum to measure a direction against)', async () => {
    const rows: { speed: number; angleDeg: number; ratio: number }[] = [];
    for (const speed of [5, 10, 15]) {
      const r = await measure(speed, true);
      rows.push({ speed, angleDeg: r.angleDeg, ratio: r.angleDeg / BASELINE_ANGLE_DEG[speed]! });
    }
    // eslint-disable-next-line no-console
    console.log('air control angular correction, after/before (section 35):', JSON.stringify(rows, null, 1));
    for (const row of rows) {
      expect(row.ratio, `${row.speed} m/s`).toBeGreaterThanOrEqual(1.2);
    }
  });

  it('lateral displacement improves substantially at 0 m/s (the stable metric there, per section 15\'s "use both, state which is primary")', async () => {
    const r = await measure(0, true);
    const ratio = r.lateralM / BASELINE_LATERAL_M[0]!;
    // eslint-disable-next-line no-console
    console.log('air control lateral displacement at 0 m/s, after/before:', JSON.stringify({ lateralM: r.lateralM, ratio }));
    expect(ratio).toBeGreaterThanOrEqual(1.2);
  });

  it('section 16/36 safety cap: full perpendicular input through an entire full jump still reads as low air control — momentum dominates, nowhere near a 90-degree instant redirect', async () => {
    const harness = await TestBeyHarness.create({ x: 0, y: BEY_SPAWN_HEIGHT_M, z: -10 });
    harness.tickMany(intent(0, 1), 60);
    harness.beyBody.setLinvel({ x: 0, y: harness.beyBody.linvel().y, z: 10 }, true);
    for (let t = 0; t < 20; t++) harness.tick(intent(0, 1, [Action.JumpDrift], t === 0 ? [Action.JumpDrift] : []));
    const velStart = harness.beyBody.linvel();
    let grounded = false;
    for (let t = 0; t < 70 && !(grounded && t > 10); t++) {
      grounded = harness.tick(intent(1, 0)).grounded;
    }
    const velEnd = harness.beyBody.linvel();
    const cos = (velStart.x * velEnd.x + velStart.z * velEnd.z) / (Math.hypot(velStart.x, velStart.z) * Math.hypot(velEnd.x, velEnd.z));
    const angle = Math.acos(Math.max(-1, Math.min(1, cos))) * (180 / Math.PI);
    expect(angle).toBeLessThan(45);
    // Still clearly dominated by the original heading's momentum.
    expect(Math.abs(velEnd.z)).toBeGreaterThan(Math.abs(velEnd.x));
  });

  it('section 17: directional air input never increases jump height, airtime, or creates lift — vertical arc is identical with or without correction input', async () => {
    const harness = await TestBeyHarness.create({ x: 0, y: BEY_SPAWN_HEIGHT_M, z: -10 });
    harness.tickMany(intent(0, 1), 60);
    for (let t = 0; t < 20; t++) harness.tick(intent(0, 1, [Action.JumpDrift], t === 0 ? [Action.JumpDrift] : []));
    let apexWith = harness.beyBody.translation().y;
    for (let t = 0; t < 60; t++) {
      harness.tick(intent(1, 0));
      apexWith = Math.max(apexWith, harness.beyBody.translation().y);
    }

    const harness2 = await TestBeyHarness.create({ x: 0, y: BEY_SPAWN_HEIGHT_M, z: -10 });
    harness2.tickMany(intent(0, 1), 60);
    for (let t = 0; t < 20; t++) harness2.tick(intent(0, 1, [Action.JumpDrift], t === 0 ? [Action.JumpDrift] : []));
    let apexWithout = harness2.beyBody.translation().y;
    for (let t = 0; t < 60; t++) {
      harness2.tick(intent(0, 1));
      apexWithout = Math.max(apexWithout, harness2.beyBody.translation().y);
    }

    expect(apexWith).toBeCloseTo(apexWithout, 3);
  });
});
