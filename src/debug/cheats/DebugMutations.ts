// ============================================================
// DEBUG LAB MUTATIONS (GDD section 70)
// The explicit "change the simulation" tools: teleport, set linear /
// angular velocity, set Stamina / Stability / Attack Energy, force an
// attack (or jump / dodge) through real inputs, reset cooldowns and
// prepare a Clash. Every call is logged on the session as a debug
// mutation (GDD section 160: mutation tools must be explicit actions), so
// a report always says when a run stopped being a pure seed replay.
// Never used by gameplay, tests of gameplay rules, or the AI.
// ============================================================

import type { MatchSession, Side } from '../../app/session/MatchSession';
import { BEY_SPAWN_HEIGHT_M } from '../../bey/core/BeyTuning';
import { floorHeightAt } from '../../arena/floor/ArenaFloorProfile';
import { DASH_MAX_CHARGE_S } from '../../combat/attacks/AttackTuning';
import { JUMP_RELEASE_WINDOW_S } from '../../drift/DriftTuning';
import { Action } from '../../input/actions/Action';
import { FIXED_TICKS_PER_SECOND } from '../../physics/fixed-step/FixedTimestepLoop';
import type { ScriptedFrame } from '../../automation/scripted-scenarios/ScriptedController';

// ============================================================
// DEBUG MUTATIONS — TUNING
// ============================================================

/** Ticks Attack is held for a forced tap (must stay under TAP_MAX_HOLD_S to read as a tap). */
const FORCED_TAP_HOLD_TICKS = 2;
/** Extra ticks a forced Dash holds past DASH_MAX_CHARGE_S, so it releases fully charged. */
const FORCED_DASH_EXTRA_HOLD_TICKS = 3;
/** Half the distance between the Beys when "Prepare Clash" lines them up, m. */
const PREPARE_CLASH_HALF_SEPARATION_M = 3;

export type ForcedActionId = 'circular' | 'dash' | 'hop' | 'jump' | 'dodge';

export interface ForcedAction {
  readonly id: ForcedActionId;
  readonly label: string;
  readonly frames: readonly ScriptedFrame[];
  readonly durationTicks: number;
}

const DASH_HOLD_TICKS = Math.ceil(DASH_MAX_CHARGE_S * FIXED_TICKS_PER_SECOND) + FORCED_DASH_EXTRA_HOLD_TICKS;
const JUMP_HOLD_TICKS = Math.ceil(JUMP_RELEASE_WINDOW_S * FIXED_TICKS_PER_SECOND) + 3;

export const FORCED_ACTIONS: readonly ForcedAction[] = [
  {
    id: 'circular',
    label: 'Circular Attack (tap Z)',
    frames: [
      { fromTick: 0, held: [Action.Attack] },
      { fromTick: FORCED_TAP_HOLD_TICKS, held: [] },
    ],
    durationTicks: FORCED_TAP_HOLD_TICKS + 2,
  },
  {
    id: 'dash',
    label: 'Dash Attack, full charge (hold + release Z)',
    frames: [
      { fromTick: 0, held: [Action.Attack] },
      { fromTick: DASH_HOLD_TICKS, held: [] },
    ],
    durationTicks: DASH_HOLD_TICKS + 2,
  },
  {
    id: 'hop',
    label: 'Hop (tap X)',
    frames: [
      { fromTick: 0, held: [Action.JumpDrift] },
      { fromTick: FORCED_TAP_HOLD_TICKS, held: [] },
    ],
    durationTicks: FORCED_TAP_HOLD_TICKS + 2,
  },
  {
    id: 'jump',
    label: 'Full jump (hold X)',
    frames: [
      { fromTick: 0, held: [Action.JumpDrift] },
      { fromTick: JUMP_HOLD_TICKS, held: [] },
    ],
    durationTicks: JUMP_HOLD_TICKS + 2,
  },
  {
    id: 'dodge',
    label: 'Dodge forward (tap C)',
    frames: [
      { fromTick: 0, held: [Action.Dodge] },
      { fromTick: FORCED_TAP_HOLD_TICKS, held: [] },
    ],
    durationTicks: FORCED_TAP_HOLD_TICKS + 2,
  },
];

export function forceAction(session: MatchSession, side: Side, id: ForcedActionId): void {
  const action = FORCED_ACTIONS.find((a) => a.id === id);
  if (!action) throw new Error(`forceAction: unknown action ${id}`);
  session.forceInput(side, action.label, action.frames, action.durationTicks);
}

export interface TeleportOptions {
  /** Zero linear and angular velocity (default true): a clean placement. */
  readonly stop?: boolean;
  /** Heading after the teleport, rad (yaw 0 faces +Z). Omitted = unchanged. */
  readonly headingRad?: number;
}

/** Places a Bey at (x, z) at spawn height above the floor there, upright. */
export function teleportBey(session: MatchSession, side: Side, x: number, z: number, options: TeleportOptions = {}): void {
  const bey = session.getBey(side);
  bey.body.setTranslation({ x, y: BEY_SPAWN_HEIGHT_M + floorHeightAt(bey.arenaFloor, x, z), z }, true);
  bey.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
  if (options.stop ?? true) {
    bey.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    bey.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
  if (options.headingRad !== undefined) bey.movement.debugSetHeading(options.headingRad);
  session.recordDebugMutation(`${side}: teleport to (${x.toFixed(2)}, ${z.toFixed(2)})${options.headingRad !== undefined ? `, heading ${options.headingRad.toFixed(2)} rad` : ''}`);
}

export function setLinearVelocity(session: MatchSession, side: Side, v: { x: number; y: number; z: number }): void {
  session.getBey(side).body.setLinvel(v, true);
  session.recordDebugMutation(`${side}: set velocity (${v.x}, ${v.y}, ${v.z}) m/s`);
}

export function setAngularVelocity(session: MatchSession, side: Side, w: { x: number; y: number; z: number }): void {
  session.getBey(side).body.setAngvel(w, true);
  session.recordDebugMutation(`${side}: set angular velocity (${w.x}, ${w.y}, ${w.z}) rad/s`);
}

export type DebugResource = 'stamina' | 'stability' | 'attackEnergy';

/** Sets a resource to `fraction` (0..1) of its max. Stability goes through StabilitySystem so Broken stays consistent. */
export function setResourceFraction(session: MatchSession, side: Side, resource: DebugResource, fraction: number): void {
  const bey = session.getBey(side);
  const clamped = Math.max(0, Math.min(1, fraction));
  switch (resource) {
    case 'stamina':
      bey.stamina.resource.set(clamped * bey.stamina.resource.max);
      break;
    case 'stability':
      bey.stability.debugSetValue(clamped * bey.stability.resource.max);
      break;
    case 'attackEnergy':
      bey.attackEnergy.resource.set(clamped * bey.attackEnergy.resource.max);
      break;
  }
  session.recordDebugMutation(`${side}: set ${resource} to ${(clamped * 100).toFixed(0)}%`);
}

/** Dodge and post-impact steering cooldowns for both sides, plus the shared Clash cooldown. */
export function resetCooldowns(session: MatchSession): void {
  for (const side of ['first', 'second'] as const) {
    const bey = session.getBey(side);
    bey.dodge.debugResetCooldown();
    bey.movement.debugResetCooldown();
  }
  session.clash.controller.debugResetCooldown();
  session.recordDebugMutation('reset cooldowns (dodge, post-impact steering, Clash)');
}

/**
 * "Trigger/prepare Clash" (GDD section 70): lines the Beys up facing each
 * other, stopped, with full Attack Energy and no cooldowns, then forces
 * both to release a fully charged Dash on the same tick. Whether a Clash
 * actually starts is still decided by the real Clash window rules.
 */
export function prepareClash(session: MatchSession): void {
  const half = PREPARE_CLASH_HALF_SEPARATION_M;
  teleportBey(session, 'first', 0, -half, { headingRad: 0 });
  teleportBey(session, 'second', 0, half, { headingRad: Math.PI });
  resetCooldowns(session);
  setResourceFraction(session, 'first', 'attackEnergy', 1);
  setResourceFraction(session, 'second', 'attackEnergy', 1);
  forceAction(session, 'first', 'dash');
  forceAction(session, 'second', 'dash');
}
