// ============================================================
// SCENARIO PRESETS (GDD section 68)
// Reproducible, named setups for the situations GDD 68 lists. Each preset
// places the Beys, sets resources where the scenario needs it, drives both
// sides with scripted real inputs (ScriptedController — never a written
// attack state), and states what must be observed. The same preset runs
// headless in the Self-Test (ScenarioRunner) and can be loaded into the
// Debug Lab.
//
// A preset checks that the scenario HAPPENED as set up (a Clash started,
// a Dash hit, a ring-out occurred...). It is a reproduction tool, not a
// balance target: expectations are about events and states, not about
// tuned numbers.
// ============================================================

import type { MatchConfig } from '../../config/match/MatchConfig';
import type { Bey } from '../../bey/core/Bey';
import { BEY_SPAWN_HEIGHT_M } from '../../bey/core/BeyTuning';
import { ARENA_FLOOR_RADIUS } from '../../arena/colliders/ArenaTuning';
import { floorHeightAt } from '../../arena/floor/ArenaFloorProfile';
import { DASH_MAX_CHARGE_S, TAP_MAX_HOLD_S } from '../../combat/attacks/AttackTuning';
import { JUMP_RELEASE_WINDOW_S } from '../../drift/DriftTuning';
import { Action } from '../../input/actions/Action';
import { FIXED_TICKS_PER_SECOND } from '../../physics/fixed-step/FixedTimestepLoop';
import type { ScriptedFrame } from '../../automation/scripted-scenarios/ScriptedController';
import { runReplayReproduction } from './replayReproduction';
import type { ScenarioTrace } from './ScenarioTrace';

// ============================================================
// SCENARIO PRESETS — TUNING
// ============================================================

/** Ticks a scripted tap holds its button (under TAP_MAX_HOLD_S so it reads as a tap). */
const TAP_TICKS = 2;
/** Ticks a scripted full-charge Dash holds Attack. */
const FULL_DASH_HOLD_TICKS = Math.ceil(DASH_MAX_CHARGE_S * FIXED_TICKS_PER_SECOND) + 3;
/** Ticks a scripted short Dash holds Attack (just past the tap window). */
const SHORT_DASH_HOLD_TICKS = Math.ceil(TAP_MAX_HOLD_S * FIXED_TICKS_PER_SECOND) + 6;
/** Ticks a scripted full jump holds JumpDrift. */
const FULL_JUMP_HOLD_TICKS = Math.ceil(JUMP_RELEASE_WINDOW_S * FIXED_TICKS_PER_SECOND) + 3;

export interface ScenarioActors {
  readonly first: Bey;
  readonly second: Bey;
}

export type ScenarioSideScript = { readonly kind: 'script'; readonly frames: readonly ScriptedFrame[] } | { readonly kind: 'idle' };

export interface ScenarioCheck {
  readonly passed: boolean;
  readonly detail: string;
}

export interface ScenarioPreset {
  readonly id: string;
  /** GDD 68 name. */
  readonly label: string;
  readonly description: string;
  /** False = listed by GDD 68 but depends on a later milestone; the runner reports it as unsupported. */
  readonly supported: boolean;
  readonly unsupportedReason?: string;
  readonly durationTicks: number;
  /** Match rules for this scenario (e.g. a lower wall); omitted = the defaults. */
  readonly matchConfig?: Partial<MatchConfig>;
  /** Places Beys / sets resources before the first tick. */
  readonly setup?: (actors: ScenarioActors) => void;
  readonly first: ScenarioSideScript;
  readonly second: ScenarioSideScript;
  /** Stop early once this is true (the scenario already happened). */
  readonly doneWhen?: (trace: ScenarioTrace) => boolean;
  readonly check: (trace: ScenarioTrace) => ScenarioCheck;
  /**
   * A preset that isn't a scripted fight (M9 replay-reproduction): the
   * runner calls this instead of stepping the scripts, and it decides
   * pass/fail itself.
   */
  readonly run?: () => Promise<{ readonly passed: boolean; readonly detail: string; readonly ticks: number }>;
}

// ---- building blocks ----

/**
 * Arena scale pass (floor radius 12 m -> 36 m): the scenarios about the wall /
 * the ring-out were laid out for a wall 12 m from the centre. Their starting
 * spots are moved this much outward (toward +Z, or radially for the ricochet)
 * so each starts the same distance from the wall as before; the speeds,
 * angles and checks are unchanged (the radius checks use ARENA_FLOOR_RADIUS).
 */
const WALL_SHIFT_M = ARENA_FLOOR_RADIUS - 12;

/** Places a Bey at (x, z), upright, stopped, facing `headingRad` (yaw 0 = +Z). */
export function placeBey(bey: Bey, x: number, z: number, headingRad: number): void {
  // Spawn height above the floor under (x, z): on a bowl the floor isn't at y = 0 (M11).
  bey.body.setTranslation({ x, y: BEY_SPAWN_HEIGHT_M + floorHeightAt(bey.arenaFloor, x, z), z }, true);
  bey.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
  bey.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  bey.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  bey.movement.debugSetHeading(headingRad);
}

/** Heading that faces from (x, z) toward (tx, tz). */
export function headingToward(x: number, z: number, tx: number, tz: number): number {
  return Math.atan2(tx - x, tz - z);
}

const idle: ScenarioSideScript = { kind: 'idle' };

function script(frames: readonly ScriptedFrame[]): ScenarioSideScript {
  return { kind: 'script', frames };
}

function hold(action: Action, fromTick: number, ticks: number, extra: Action[] = []): ScriptedFrame[] {
  return [
    { fromTick, held: [action, ...extra] },
    { fromTick: fromTick + ticks, held: [...extra] },
  ];
}

function ok(passed: boolean, detail: string): ScenarioCheck {
  return { passed, detail };
}

/** Face-to-face at ±d on the Z axis, first at −Z facing +Z. */
function faceOff(d: number): (a: ScenarioActors) => void {
  return ({ first, second }) => {
    placeBey(first, 0, -d, 0);
    placeBey(second, 0, d, Math.PI);
  };
}

/** clash-cooldown-collision: when both Dash again, inside the Clash cooldown. */
const COOLDOWN_DASH_TIMES_S = [6.5, 9.5, 12.5];
/** ...and second holds its charge this many ticks longer, releasing later. */
const COOLDOWN_SECOND_EXTRA_HOLD_TICKS = 24;
/**
 * Arena scale pass: on the old 12 m arena the wall brought the two thrown-apart,
 * turned Beys back toward each other; 36 m away it no longer does, and every
 * release-time / hold sweep missed (0 hits). So first turns right for this
 * many ticks starting at COOLDOWN_STEER_AT_S (just after the Clash throws
 * them apart, before the 6.5 s Dash), which re-aims its Dash at second.
 * Swept: 30 and 40 ticks both give 2-3 hits for second's extra hold of 8, 24
 * and 40 ticks.
 */
const COOLDOWN_FIRST_STEER_TICKS = 40;
const COOLDOWN_STEER_AT_S = 6;

/**
 * The drift input (owner, 2026-10-04: "dar um toque + segurar = drift"): drive, tap X for a short hop at tick 60,
 * then press X again and hold it while steering until tick 150. Holding X from the first press is the Full Jump now,
 * not the drift. `after` is what is held once X is let go.
 */
function driftTapThenHold(after: Action[]): ScriptedFrame[] {
  return [
    { fromTick: 0, held: [Action.MoveForward] },
    { fromTick: 60, held: [Action.MoveForward, Action.JumpDrift] },
    { fromTick: 60 + TAP_TICKS, held: [Action.MoveForward] },
    { fromTick: 66, held: [Action.MoveForward, Action.JumpDrift, Action.SteerRight] },
    { fromTick: 150, held: after },
  ];
}

// ---- the presets ----

export const SCENARIO_PRESETS: readonly ScenarioPreset[] = [
  {
    id: 'clash',
    label: 'Test Clash',
    description: 'Both Beys release a full Dash head-on on the same tick; the real 150 ms window starts a Clash.',
    supported: true,
    durationTicks: 8 * FIXED_TICKS_PER_SECOND,
    setup: faceOff(3),
    first: script(hold(Action.Attack, 0, FULL_DASH_HOLD_TICKS)),
    second: script(hold(Action.Attack, 0, FULL_DASH_HOLD_TICKS)),
    doneWhen: (t) => t.clashResolvedTick !== null,
    check: (t) => ok(t.clashStartedTick !== null && t.clashResolvedTick !== null, `Clash started at tick ${t.clashStartedTick}, resolved at tick ${t.clashResolvedTick} (${t.clashOutcome ?? 'none'})`),
  },
  {
    id: 'dash-attack',
    label: 'Test Dash Attack',
    description: 'First releases a full Dash at an idle opponent 5 m ahead; the Dash hitbox connects.',
    supported: true,
    durationTicks: 4 * FIXED_TICKS_PER_SECOND,
    setup: faceOff(2.5),
    first: script(hold(Action.Attack, 0, FULL_DASH_HOLD_TICKS)),
    second: idle,
    doneWhen: (t) => t.hits.some((h) => h.attackerIsFirst && h.kind === 'dash'),
    check: (t) => {
      const hit = t.hits.find((h) => h.attackerIsFirst && h.kind === 'dash');
      return ok(hit !== undefined, hit ? `Dash hit at tick ${hit.tick}` : 'no Dash hit landed');
    },
  },
  {
    id: 'dash-whiff',
    label: 'Test Dash Attack (miss + whiff recovery)',
    description: 'First Dashes with the opponent far off to the side; the Dash misses and the attack returns to Neutral through its whiff recovery.',
    supported: true,
    durationTicks: 5 * FIXED_TICKS_PER_SECOND,
    setup: ({ first, second }) => {
      placeBey(first, -6, -6, 0);
      // Far to the side: the funnel's pull (0.49.0) slides an idle Bey toward the centre, so it starts well outside the Dash's path.
      placeBey(second, 22, -8, 0);
    },
    first: script(hold(Action.Attack, 0, SHORT_DASH_HOLD_TICKS)),
    second: idle,
    check: (t) => {
      const sawDash = t.firstAttackStates.has('DashActive');
      const sawRecovery = t.firstAttackStates.has('DashRecovery');
      return ok(sawDash && sawRecovery && t.hits.length === 0 && t.finalFirstAttackState === 'Neutral', `states seen: ${[...t.firstAttackStates].join(', ')}; hits ${t.hits.length}; final ${t.finalFirstAttackState}`);
    },
  },
  {
    id: 'circular-counter',
    label: 'Test Circular Counter',
    description: 'Second Dashes at first; first taps Circular as the Dash arrives. The Circular catches the Dash and launches the dasher upward.',
    supported: true,
    durationTicks: 4 * FIXED_TICKS_PER_SECOND,
    setup: faceOff(2.5),
    first: script(hold(Action.Attack, SHORT_DASH_HOLD_TICKS + 4, TAP_TICKS)),
    second: script(hold(Action.Attack, 0, SHORT_DASH_HOLD_TICKS)),
    doneWhen: (t) => t.hits.some((h) => h.caughtOpponentDashing),
    check: (t) => {
      const counter = t.hits.find((h) => h.caughtOpponentDashing);
      return ok(counter !== undefined && counter.attackerIsFirst, counter ? `counter at tick ${counter.tick}` : 'the Circular did not catch the Dash');
    },
  },
  {
    id: 'ring-out',
    label: 'Test Ring-Out',
    description:
      'Second releases a full Dash outward at a low-Stability, exhausted first (5 m from the centre on the old 12 m arena, now 29 m: the same 7 m from the wall), who jumps just before it arrives; the Dash catches the airborne Bey and its own knockback lift adds to the jump\'s residual vy, sending it over the wall. The round ends by ring-out through the physics, not by rule.',
    // Jump/air-control hotfix follow-up (owner review, PR #73 then this
    // follow-up): the old setup had first jump a FULL, uncut jump (its own
    // apex alone used to clear the 2 m wall at ~2.33 m, pre-hotfix) and
    // relied only on that height. The hotfix's own approved full-jump
    // target (1.0-1.5 m) can never clear 2 m by itself, with or without a
    // plain Dash's modest knockback lift added — verified: neither the
    // jump alone, nor a maximally-exploited knockback alone (zero Stamina,
    // near-zero Stability, full Attack/Defense mismatch — the biggest
    // knockback this engine's combat formulas can produce without touching
    // any of them — gives vy ≈ 5.9-6.5 m/s, still short given how fast the
    // resulting ~32 m/s horizontal launch crosses the wall's radius) clears
    // it on its own. What does: a Dash hit landing on a Bey already
    // mid-jump — the knockback impulse is an ADDITIVE velocity change
    // (RAPIER.RigidBody.applyImpulse), not a replacement, so it stacks on
    // top of whatever vy the jump already has. Catching it 10-15 ticks
    // into the jump (this preset's own jump timing below), not right at
    // liftoff, gave the most reliable clearance in a sweep — enough
    // existing height plus the stacked knockback vy (now ~9-11 m/s
    // combined) outruns the wall-crossing math this time. No combat,
    // arena, or knockback value was changed to make this work — only this
    // scenario's own setup (first's Stamina/Stability) and jump timing.
    supported: true,
    durationTicks: 8 * FIXED_TICKS_PER_SECOND,
    setup: ({ first, second }) => {
      placeBey(first, 0, 5 + WALL_SHIFT_M, Math.PI);
      placeBey(second, 0, -1 + WALL_SHIFT_M, 0);
      // Maximally vulnerable to knockback (GDD section 27/30's own
      // formula, not a new rule): zero Stamina (max staminaVulnerability),
      // low-but-not-zero Stability (close to the knockback formula's own
      // ceiling without a Dash's stability damage reaching exactly zero —
      // which freezes the round via an instant break/KO before the
      // physics can carry the launch out).
      first.stamina.resource.set(0.1 * first.stamina.resource.max); // nearly empty: Stamina 0 is a spin-out now (owner, 2026-10-02)
      first.stability.debugSetValue(30);
    },
    // Jump 10 ticks after the Dash release (the hit lands 18 ticks after
    // it, same as before this follow-up): swept 85-90 (10-15 ticks after
    // release) and all rang out; closer to the hit (16-18 ticks after
    // release) the jump's own vy hadn't built up enough height yet despite
    // its own higher residual velocity at the moment of the hit — total
    // clearance depends on height-already-gained plus the knockback's
    // added vy together, not the added vy alone.
    // Speed pass re-sweep (owner, 2026-10-04: the faster Dash arrives sooner): on the flat floor the jump has to start
    // 1–5 ticks BEFORE the release now (+10 after it, as swept above, lands after the hit and nothing rings out);
    // 3 before is the middle of that range.
    first: script(hold(Action.JumpDrift, FULL_DASH_HOLD_TICKS - 3, 20)),
    second: script(hold(Action.Attack, 0, FULL_DASH_HOLD_TICKS)),
    doneWhen: (t) => t.roundOver,
    check: (t) => ok(t.outcome === 'SecondWinsByRingOut', `outcome ${t.outcome}; Dash hits ${t.hits.filter((h) => !h.attackerIsFirst).length}`),
  },
  {
    id: 'wall-hit',
    label: 'Test Wall Hit',
    description: 'First is sent straight at the wall at 12 m/s; the impact is detected and the Bey stays inside the arena.',
    supported: true,
    durationTicks: 2 * FIXED_TICKS_PER_SECOND,
    setup: ({ first, second }) => {
      placeBey(first, 0, 8 + WALL_SHIFT_M, 0);
      first.body.setLinvel({ x: 0, y: 0, z: 12 }, true);
      placeBey(second, 0, -8 + WALL_SHIFT_M, 0);
    },
    // Driven for the first half second: with no input the idle damping
    // (owner playtest, after M11) settles a Bey on a bowl's slope before it
    // reaches the wall.
    first: script(hold(Action.MoveForward, 0, 30)),
    second: idle,
    check: (t) => ok(t.firstMaxImpactMps > 0 && t.firstMaxRadiusM < ARENA_FLOOR_RADIUS && t.firstMinRadialVelocityAfterImpact < 0, `impact Δv ${t.firstMaxImpactMps.toFixed(2)} m/s, max radius ${t.firstMaxRadiusM.toFixed(2)} m, rebound radial speed ${t.firstMinRadialVelocityAfterImpact.toFixed(2)} m/s`),
  },
  {
    id: 'wall-ricochet',
    label: 'Test Wall Ricochet',
    description: 'First hits the wall at a shallow angle at 12 m/s; it rebounds inward and keeps moving along the wall.',
    supported: true,
    durationTicks: 2 * FIXED_TICKS_PER_SECOND,
    setup: ({ first, second }) => {
      // At (-6, 8) (r = 10) on the old arena, moved radially out to r = 34 (same
      // 2 m from the wall): 30° off the wall's tangent, mostly along it.
      const k = (ARENA_FLOOR_RADIUS - 2) / 10;
      placeBey(first, -6 * k, 8 * k, 0);
      first.body.setLinvel({ x: 4.75, y: 0, z: 11.06 }, true);
      placeBey(second, 0, -8 + WALL_SHIFT_M, 0);
    },
    // Driven for the first half second, as in wall-hit (idle damping).
    first: script(hold(Action.MoveForward, 0, 30)),
    second: idle,
    check: (t) => ok(t.firstMaxImpactMps > 0 && t.firstMinRadialVelocityAfterImpact < 0 && t.firstTangentialSpeedAfterImpact > 3, `impact Δv ${t.firstMaxImpactMps.toFixed(2)} m/s, rebound radial ${t.firstMinRadialVelocityAfterImpact.toFixed(2)} m/s, tangential ${t.firstTangentialSpeedAfterImpact.toFixed(2)} m/s`),
  },
  {
    id: 'high-knockback',
    label: 'Test High Knockback',
    description: 'Stationary, low-Stability, exhausted defender takes a full Dash: a large knockback force and launch speed.',
    supported: true,
    durationTicks: 4 * FIXED_TICKS_PER_SECOND,
    setup: ({ first, second }) => {
      // 5 m back (was 3): the funnel's pull (0.49.0) slides the dasher ~1 m toward the defender while the Dash charges,
      // and a touch before the Dash fired ended the scenario on a weak contact knockback.
      placeBey(first, 0, -5, 0);
      placeBey(second, 0, 0, Math.PI);
      second.stamina.resource.set(0.05 * second.stamina.resource.max); // nearly empty: Stamina 0 is a spin-out now (owner, 2026-10-02)
      second.stability.debugSetValue(10);
    },
    first: script(hold(Action.Attack, 0, FULL_DASH_HOLD_TICKS)),
    second: idle,
    doneWhen: (t) => t.maxKnockbackOnSecond > 0,
    check: (t) => ok(t.maxKnockbackOnSecond > 20, `knockback force on second ${t.maxKnockbackOnSecond.toFixed(1)}`),
  },
  {
    id: 'low-stamina',
    label: 'Test Zero/Low Stamina',
    description: 'First starts with 0 Stamina and drives forward: it still steers and moves (no input sabotage, GDD 30) with degraded acceleration.',
    supported: true,
    durationTicks: 3 * FIXED_TICKS_PER_SECOND,
    setup: ({ first, second }) => {
      placeBey(first, 0, -6, 0);
      placeBey(second, 6, 6, 0);
      first.stamina.resource.set(0.05 * first.stamina.resource.max); // nearly empty: Stamina 0 is a spin-out now (owner, 2026-10-02)
    },
    first: script([{ fromTick: 0, held: [Action.MoveForward] }]),
    second: idle,
    check: (t) => ok(t.firstMaxSpeedMps > 1 && t.firstMinAccelFactor < 1, `max speed ${t.firstMaxSpeedMps.toFixed(2)} m/s, accel factor ${t.firstMinAccelFactor.toFixed(3)}`),
  },
  {
    id: 'stability-break',
    label: 'Test Stability Break',
    description: 'Defender at 3% Stability takes a Circular hit and Breaks.',
    supported: true,
    durationTicks: 2 * FIXED_TICKS_PER_SECOND,
    setup: ({ first, second }) => {
      placeBey(first, 0, -0.7, 0);
      placeBey(second, 0, 0.7, Math.PI);
      // 3, not 5: a Circular from a standstill deals half its damage (4) since speed → damage (owner, 2026-10-04, item 11).
      second.stability.debugSetValue(3);
    },
    first: script(hold(Action.Attack, 0, TAP_TICKS)),
    second: idle,
    doneWhen: (t) => t.stabilityBreaks.includes('second'),
    check: (t) => ok(t.stabilityBreaks.includes('second'), `breaks: ${t.stabilityBreaks.join(', ') || 'none'}`),
  },
  {
    id: 'perfect-dodge',
    label: 'Test Perfect Dodge',
    description: 'First Dashes at second; second dodges just before contact, inside the Perfect Dodge window.',
    supported: true,
    durationTicks: 4 * FIXED_TICKS_PER_SECOND,
    setup: faceOff(2.5),
    first: script(hold(Action.Attack, 0, SHORT_DASH_HOLD_TICKS)),
    // Dodge 3 ticks after the release: the middle of the 0–6 tick range that
    // lands inside the Perfect Dodge window (swept after the speed pass,
    // owner 2026-10-04: the faster Dash arrives ~13 ticks sooner than the
    // 11–20 range measured at M11, which now dodges nothing).
    second: script(hold(Action.Dodge, SHORT_DASH_HOLD_TICKS + 3, TAP_TICKS)),
    doneWhen: (t) => t.perfectDodges.includes('second'),
    check: (t) => ok(t.perfectDodges.includes('second'), `perfect dodges: ${t.perfectDodges.join(', ') || 'none'}; dodged: ${t.dodges.join(', ') || 'none'}`),
  },
  {
    id: 'air-recovery',
    label: 'Test Air Recovery',
    description: 'Second is launched by a Circular that catches its Dash, then presses Dodge in the air: Air Recovery triggers (only valid while launched).',
    supported: true,
    durationTicks: 4 * FIXED_TICKS_PER_SECOND,
    setup: faceOff(2.5),
    first: script(hold(Action.Attack, SHORT_DASH_HOLD_TICKS + 4, TAP_TICKS)),
    // Dodge pressed ~0.4 s after the catch (tick ~35), while still airborne.
    second: script([...hold(Action.Attack, 0, SHORT_DASH_HOLD_TICKS), ...hold(Action.Dodge, 60, TAP_TICKS)]),
    check: (t) => ok(t.secondAirRecoveryArmed && t.secondAirRecoveryUsed, `armed ${t.secondAirRecoveryArmed}, used ${t.secondAirRecoveryUsed}`),
  },
  {
    id: 'jump-attack',
    label: 'Test Jump Attack',
    description: 'First jumps and taps Attack while airborne: the Circular Attack goes active in the air.',
    supported: true,
    durationTicks: 3 * FIXED_TICKS_PER_SECOND,
    setup: faceOff(4),
    // From tick 30, once the Bey placed at spawn height has settled (M11:
    // a drop now lands with the Motion Lab floor bounce, which on bowl B's
    // slope was still going at tick 0).
    first: script([...hold(Action.JumpDrift, 30, FULL_JUMP_HOLD_TICKS), ...hold(Action.Attack, 42, TAP_TICKS)]),
    second: idle,
    check: (t) => ok(t.firstAirborneAttackState !== null, `attack state while airborne: ${t.firstAirborneAttackState ?? 'none'}`),
  },
  {
    id: 'strong-landing',
    label: 'Test Strong Landing',
    description: 'First drops from 6 m: it lands hard, at full landing intensity (the shockwave / strong-landing feedback threshold).',
    supported: true,
    durationTicks: 3 * FIXED_TICKS_PER_SECOND,
    setup: ({ first, second }) => {
      placeBey(first, 0, -4, 0);
      first.body.setTranslation({ x: 0, y: 6, z: -4 }, true);
      placeBey(second, 0, 4, Math.PI);
    },
    first: idle,
    second: idle,
    check: (t) => ok(t.firstMaxLandingIntensity >= 0.8, `landing intensity ${t.firstMaxLandingIntensity.toFixed(3)}`),
  },
  {
    id: 'drift',
    label: 'Test Drift',
    description: 'First drives forward, taps X to hop, then holds X while steering: it enters Drifting with visible slip, then recovers grip.',
    supported: true,
    durationTicks: 5 * FIXED_TICKS_PER_SECOND,
    setup: ({ first, second }) => {
      placeBey(first, 0, -8, 0);
      placeBey(second, 8, 8, 0);
    },
    first: script(driftTapThenHold([Action.MoveForward])),
    second: idle,
    // Drifting for most of the hold (X held ticks 60–150, minus the hop) and a real slide
    // (owner playtest, after M11: it used to leave Drifting after a few ticks). Measured:
    // 47 ticks on the flat floor, 66–71 on the bowls; max slip 135–171°.
    check: (t) => ok(t.firstDriftStates.has('Drifting') && t.firstDriftStates.has('Recovering') && t.firstDriftTicks >= 35 && t.firstMaxSlipDeg > 20, `drift states ${[...t.firstDriftStates].join(', ')}, drifting ${t.firstDriftTicks} ticks, max slip ${t.firstMaxSlipDeg.toFixed(1)}°`),
  },
  {
    id: 'low-grip',
    label: 'Test Low Grip',
    description: 'During the drift, lateral grip drops below the Bey\'s normal grip and is restored after.',
    supported: true,
    durationTicks: 5 * FIXED_TICKS_PER_SECOND,
    setup: ({ first, second }) => {
      placeBey(first, 0, -8, 0);
      placeBey(second, 8, 8, 0);
    },
    // Coasting after the drift: since the drift lasts as long as X is held (owner playtest,
    // after M11), driving on at full speed hit the wall before grip was back to 99%.
    first: script(driftTapThenHold([])),
    second: idle,
    check: (t) => ok(t.firstMinDriftGripPerS < t.firstNormalGripPerS && t.firstGripRestoredAfterDrift, `grip while drifting ${t.firstMinDriftGripPerS.toFixed(2)} /s, normal ${t.firstNormalGripPerS.toFixed(2)} /s, restored on the ground after the drift: ${t.firstGripRestoredAfterDrift}`),
  },
  {
    id: 'high-speed-collision',
    label: 'Test High-Speed Collision',
    description: 'Both Beys driven into each other at 12 m/s with no attack: a physical body collision that throws both apart, no hit.',
    supported: true,
    durationTicks: 2 * FIXED_TICKS_PER_SECOND,
    setup: ({ first, second }) => {
      placeBey(first, 0, -4, 0);
      placeBey(second, 0, 4, Math.PI);
      first.body.setLinvel({ x: 0, y: 0, z: 12 }, true);
      second.body.setLinvel({ x: 0, y: 0, z: -12 }, true);
    },
    first: idle,
    second: idle,
    // Owner, 2026-10-04 ("qualquer toque"): a Bey-to-Bey touch is the match's own body collision now (both thrown
    // apart as a knockback), no longer a wall-style velocity impact — so the check reads that collision (its event
    // names the slower Bey, or both on a tie).
    check: (t) => ok(t.bodyCollisionTargets.size > 0 && t.hits.length === 0, `body collision on: ${[...t.bodyCollisionTargets].join(', ') || 'none'}; hits ${t.hits.length}`),
  },
  {
    id: 'clash-cooldown-collision',
    label: 'Test Clash Cooldown Collision',
    description: 'A Clash, then both keep Dashing at each other inside the 10 s cooldown: no second Clash starts; the collisions resolve as normal hits.',
    supported: true,
    durationTicks: 14 * FIXED_TICKS_PER_SECOND,
    setup: faceOff(3),
    // After the ~4 s Clash (a Tie here) both Beys are thrown apart and
    // turned, and since the Motion Lab integration (M11) a Dash goes where
    // its Bey faces: two released on the same tick fly past each other.
    // Both Dash at 6.5, 9.5 and 12.5 s (all inside the cooldown), second
    // releasing 24 ticks after first — the middle of the 8–40 tick range
    // that lands hits (measured: 1–3 hits during the cooldown; 0 for any
    // same-tick release, or a 7/9/11/13 s schedule). First's steering pulse
    // (COOLDOWN_FIRST_STEER_TICKS) is the arena scale pass's addition.
    first: script([...hold(Action.Attack, 0, FULL_DASH_HOLD_TICKS), ...hold(Action.SteerRight, Math.round(COOLDOWN_STEER_AT_S * FIXED_TICKS_PER_SECOND), COOLDOWN_FIRST_STEER_TICKS), ...COOLDOWN_DASH_TIMES_S.flatMap((s) => hold(Action.Attack, Math.round(s * FIXED_TICKS_PER_SECOND), FULL_DASH_HOLD_TICKS))]),
    second: script([...hold(Action.Attack, 0, FULL_DASH_HOLD_TICKS), ...COOLDOWN_DASH_TIMES_S.flatMap((s) => hold(Action.Attack, Math.round(s * FIXED_TICKS_PER_SECOND), FULL_DASH_HOLD_TICKS + COOLDOWN_SECOND_EXTRA_HOLD_TICKS))]),
    check: (t) => ok(t.clashStarts === 1 && t.hitsDuringClashCooldown > 0, `Clash starts ${t.clashStarts}; hits during cooldown ${t.hitsDuringClashCooldown}`),
  },
  {
    id: 'replay-reproduction',
    label: 'Test Replay Reproduction',
    description: 'Record an AI-vs-AI match, export and re-import it as ChaosBeyReplayV1, replay it and compare every state hash; edited inputs and an altered checkpoint must be caught.',
    supported: true,
    durationTicks: 0,
    first: idle,
    second: idle,
    check: () => ok(false, 'decided by run()'),
    run: runReplayReproduction,
  },
];

export function findScenarioPreset(id: string): ScenarioPreset | undefined {
  return SCENARIO_PRESETS.find((p) => p.id === id);
}
