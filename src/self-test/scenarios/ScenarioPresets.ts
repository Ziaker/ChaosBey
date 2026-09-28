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

import type { Bey } from '../../bey/core/Bey';
import { BEY_SPAWN_HEIGHT_M } from '../../bey/core/BeyTuning';
import { DASH_MAX_CHARGE_S, TAP_MAX_HOLD_S } from '../../combat/attacks/AttackTuning';
import { JUMP_ASSIST_MAX_DURATION_S } from '../../drift/DriftTuning';
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
const FULL_JUMP_HOLD_TICKS = Math.ceil(JUMP_ASSIST_MAX_DURATION_S * FIXED_TICKS_PER_SECOND) + 3;

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

/** Places a Bey at (x, z), upright, stopped, facing `headingRad` (yaw 0 = +Z). */
export function placeBey(bey: Bey, x: number, z: number, headingRad: number): void {
  bey.body.setTranslation({ x, y: BEY_SPAWN_HEIGHT_M, z }, true);
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
      placeBey(second, 8, 8, 0);
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
    description: 'Second releases a full Dash outward from near the centre at first, who waits at z = 6; first\'s Circular catches the Dash and launches it up, and its own outward momentum carries it over the wall. The round ends by ring-out through the physics, not by rule.',
    supported: true,
    durationTicks: 8 * FIXED_TICKS_PER_SECOND,
    setup: ({ first, second }) => {
      placeBey(first, 0, 6, Math.PI);
      placeBey(second, 0, -1, 0);
    },
    // Tap 8 ticks after the Dash release: the middle of the 4–12 tick range
    // that produces this ring-out, so small timing changes don't flip it.
    first: script(hold(Action.Attack, FULL_DASH_HOLD_TICKS + 8, TAP_TICKS)),
    second: script(hold(Action.Attack, 0, FULL_DASH_HOLD_TICKS)),
    doneWhen: (t) => t.roundOver,
    check: (t) => ok(t.outcome === 'FirstWinsByRingOut', `outcome ${t.outcome}; counter hits ${t.hits.filter((h) => h.caughtOpponentDashing).length}`),
  },
  {
    id: 'wall-hit',
    label: 'Test Wall Hit',
    description: 'First is sent straight at the wall at 12 m/s; the impact is detected and the Bey stays inside the arena.',
    supported: true,
    durationTicks: 2 * FIXED_TICKS_PER_SECOND,
    setup: ({ first, second }) => {
      placeBey(first, 0, 8, 0);
      first.body.setLinvel({ x: 0, y: 0, z: 12 }, true);
      placeBey(second, 0, -8, 0);
    },
    first: idle,
    second: idle,
    check: (t) => ok(t.firstMaxImpactMps > 0 && t.firstMaxRadiusM < 12 && t.firstMinRadialVelocityAfterImpact < 0, `impact Δv ${t.firstMaxImpactMps.toFixed(2)} m/s, max radius ${t.firstMaxRadiusM.toFixed(2)} m, rebound radial speed ${t.firstMinRadialVelocityAfterImpact.toFixed(2)} m/s`),
  },
  {
    id: 'wall-ricochet',
    label: 'Test Wall Ricochet',
    description: 'First hits the wall at a shallow angle at 12 m/s; it rebounds inward and keeps moving along the wall.',
    supported: true,
    durationTicks: 2 * FIXED_TICKS_PER_SECOND,
    setup: ({ first, second }) => {
      // At (-6, 8) (r = 10): 30° off the wall's tangent, mostly along it.
      placeBey(first, -6, 8, 0);
      first.body.setLinvel({ x: 4.75, y: 0, z: 11.06 }, true);
      placeBey(second, 0, -8, 0);
    },
    first: idle,
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
      placeBey(first, 0, -3, 0);
      placeBey(second, 0, 0, Math.PI);
      second.stamina.resource.set(0);
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
      first.stamina.resource.set(0);
    },
    first: script([{ fromTick: 0, held: [Action.MoveForward] }]),
    second: idle,
    check: (t) => ok(t.firstMaxSpeedMps > 1 && t.firstMinAccelFactor < 1, `max speed ${t.firstMaxSpeedMps.toFixed(2)} m/s, accel factor ${t.firstMinAccelFactor.toFixed(3)}`),
  },
  {
    id: 'stability-break',
    label: 'Test Stability Break',
    description: 'Defender at 5% Stability takes a Circular hit and Breaks.',
    supported: true,
    durationTicks: 2 * FIXED_TICKS_PER_SECOND,
    setup: ({ first, second }) => {
      placeBey(first, 0, -0.7, 0);
      placeBey(second, 0, 0.7, Math.PI);
      second.stability.debugSetValue(5);
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
    first: script([...hold(Action.JumpDrift, 0, FULL_JUMP_HOLD_TICKS), ...hold(Action.Attack, 12, TAP_TICKS)]),
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
    first: script([
      { fromTick: 0, held: [Action.MoveForward] },
      { fromTick: 60, held: [Action.MoveForward, Action.JumpDrift] },
      { fromTick: 62, held: [Action.MoveForward, Action.JumpDrift, Action.SteerRight] },
      { fromTick: 150, held: [Action.MoveForward] },
    ]),
    second: idle,
    check: (t) => ok(t.firstDriftStates.has('Drifting') && t.firstDriftStates.has('Recovering') && t.firstMaxSlipDeg > 5, `drift states ${[...t.firstDriftStates].join(', ')}, max slip ${t.firstMaxSlipDeg.toFixed(1)}°`),
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
    first: script([
      { fromTick: 0, held: [Action.MoveForward] },
      { fromTick: 60, held: [Action.MoveForward, Action.JumpDrift] },
      { fromTick: 62, held: [Action.MoveForward, Action.JumpDrift, Action.SteerRight] },
      { fromTick: 150, held: [Action.MoveForward] },
    ]),
    second: idle,
    check: (t) => ok(t.firstMinDriftGripPerS < t.firstNormalGripPerS && t.firstGripRestoredAfterDrift, `grip while drifting ${t.firstMinDriftGripPerS.toFixed(2)} /s, normal ${t.firstNormalGripPerS.toFixed(2)} /s, restored on the ground after the drift: ${t.firstGripRestoredAfterDrift}`),
  },
  {
    id: 'high-speed-collision',
    label: 'Test High-Speed Collision',
    description: 'Both Beys driven into each other at 12 m/s with no attack: a physical collision (impact on both), no hit.',
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
    check: (t) => ok(t.firstMaxImpactMps > 0 && t.secondMaxImpactMps > 0 && t.hits.length === 0, `impact Δv first ${t.firstMaxImpactMps.toFixed(2)}, second ${t.secondMaxImpactMps.toFixed(2)} m/s; hits ${t.hits.length}`),
  },
  {
    id: 'clash-cooldown-collision',
    label: 'Test Clash Cooldown Collision',
    description: 'A Clash, then both Dash head-on again inside the 10 s cooldown: no second Clash starts; the collision resolves as normal hits.',
    supported: true,
    durationTicks: 14 * FIXED_TICKS_PER_SECOND,
    setup: faceOff(3),
    // Second Dash starts well after the ~4 s Clash resolves (tick ~320) and
    // lands inside its 10 s cooldown; the lock-on steers both back together.
    // 8 s since M9: the Clash resolution's hitstop now freezes the headless
    // match too (one simulation), shifting the fight against this absolute-
    // tick script; at the old 7 s the Dashes no longer met.
    first: script([...hold(Action.Attack, 0, FULL_DASH_HOLD_TICKS), ...hold(Action.Attack, 8 * FIXED_TICKS_PER_SECOND, FULL_DASH_HOLD_TICKS)]),
    second: script([...hold(Action.Attack, 0, FULL_DASH_HOLD_TICKS), ...hold(Action.Attack, 8 * FIXED_TICKS_PER_SECOND, FULL_DASH_HOLD_TICKS)]),
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
