// ============================================================
// SESSION CAMERA GLUE (M11 lane 2)
// Pure helpers between a running match and the CameraRig: describe one
// fixed tick as a read-only FightFrame (the mapping the Camera Lab's
// RealSimSource used), and the output the session keeps for rendering,
// VFX and debug readouts. Nothing here reads or writes gameplay state
// beyond what it is handed.
// ============================================================

import type { ImpactEvent } from '../ImpactEvents';
import { AttackState } from '../../combat/attacks/AttackController';
import type { CameraMode } from './CameraDirector';
import type { PresetId } from './CameraParams';
import type { CameraIntent, FighterAttack, FighterFrame, FightFrame, Vec3 } from './FightFrame';

/** What the session keeps from the camera each tick (render, speed-line VFX, F3, Debug Lab). */
export interface SessionCameraOutput {
  /** Smoothed eye, before shake. */
  readonly cameraPositionM: Vec3;
  readonly focusPositionM: Vec3;
  readonly shakeOffsetM: Vec3;
  /** Vertical FOV, impact punch included. */
  readonly fovDeg: number;
  /** The impact FOV punch included in fovDeg (dropped with camera effects off). */
  readonly fovPunchDeg: number;
  readonly isHitstopActive: boolean;
  readonly hitstopRemainingS: number;
  /** The player director's HighSpeed context weight, 0..1. */
  readonly highSpeedBlend: number;
  /** The player's velocity on the camera's right/up axes (speed-line VFX). */
  readonly speedLinesScreenDirection: { x: number; y: number };
  readonly mode: CameraMode;
  readonly preset: PresetId;
  /** 0..1 share of the forced Clash camera (B, no orbit) on screen. */
  readonly clashBlend: number;
  /** 0..1 progress of a preset crossfade (1 = settled). */
  readonly presetSwitch: number;
  /** Player director readouts. */
  readonly distanceM: number;
  readonly yawDeg: number;
  readonly side: number;
  readonly modifiers: readonly string[];
}

export interface FightFrameBey {
  readonly position: Vec3;
  readonly velocity: Vec3;
  /** From the last advanced tick's snapshot; null before the first. */
  readonly grounded: boolean | null;
  readonly attackState: AttackState | null;
  readonly isBroken: boolean;
}

export interface FightFrameInput {
  readonly tick: number;
  readonly first: FightFrameBey;
  readonly second: FightFrameBey;
  /** This tick's impact events (empty on a tick frozen by hitstop). */
  readonly impactEvents: readonly ImpactEvent[];
  /** True on the first tick a Clash is active. */
  readonly clashStarted: boolean;
  readonly clashActive: boolean;
  readonly clashProgress: number;
  readonly roundOver: boolean;
  readonly ringOutIsFirst: boolean | null;
}

const TICK_S = 1 / 60;

export function attackOf(state: AttackState | null): FighterAttack {
  switch (state) {
    case AttackState.ChargingDash:
      return 'charging';
    case AttackState.DashActive:
      return 'dash';
    case AttackState.CircularActive:
      return 'circular';
    case AttackState.DashRecovery:
    case AttackState.CircularRecovery:
      return 'recovery';
    default:
      return 'none';
  }
}

function fighter(bey: FightFrameBey): FighterFrame {
  return {
    position: { ...bey.position },
    velocity: { ...bey.velocity },
    speed: Math.hypot(bey.velocity.x, bey.velocity.z),
    airborne: bey.grounded === null ? false : !bey.grounded,
    attack: attackOf(bey.attackState),
    broken: bey.isBroken,
  };
}

/** One tick as the director reads it (Camera Lab RealSimSource mapping). */
export function buildFightFrame(input: FightFrameInput): FightFrame {
  const intents: CameraIntent[] = input.impactEvents.map((e) => ({
    kind: e.kind,
    magnitude: e.magnitude,
    // A Clash tie follows no side (followTargetIsFirst null), as in the lab.
    targetIsFirst: e.followTargetIsFirst !== undefined ? e.followTargetIsFirst : e.isFirst,
    position: { ...e.worldPositionM },
  }));
  if (input.clashStarted) {
    const p1 = input.first.position;
    const p2 = input.second.position;
    intents.push({ kind: 'clashStart', magnitude: 0.6, targetIsFirst: null, position: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2, z: (p1.z + p2.z) / 2 } });
  }
  return {
    tick: input.tick,
    time: input.tick * TICK_S,
    first: fighter(input.first),
    second: fighter(input.second),
    intents,
    clashActive: input.clashActive && !input.roundOver,
    clashProgress: Math.min(1, Math.max(0, input.clashProgress)),
    roundOver: input.roundOver,
    ringOutIsFirst: input.ringOutIsFirst,
  };
}

/** The player's horizontal velocity projected on the camera's right/up axes (speed-line VFX direction). */
export function speedLinesScreenDirection(eye: Vec3, focus: Vec3, velocityXZ: { x: number; z: number }): { x: number; y: number } {
  let fx = focus.x - eye.x;
  let fy = focus.y - eye.y;
  let fz = focus.z - eye.z;
  const fl = Math.hypot(fx, fy, fz) || 1;
  fx /= fl;
  fy /= fl;
  fz /= fl;
  // right = forward × up(0,1,0); up' = right × forward
  const rl = Math.hypot(fz, fx) || 1;
  const rx = -fz / rl;
  const rz = fx / rl;
  const ux = -rz * fy;
  const uy = rz * fx - rx * fz;
  const uz = rx * fy;
  return { x: velocityXZ.x * rx + velocityXZ.z * rz, y: velocityXZ.x * ux + 0 * uy + velocityXZ.z * uz };
}
