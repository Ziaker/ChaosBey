// ============================================================
// CAMERA RIG (M11 lane 2 + Inertial Duel Camera integration)
//
// The approved CameraDirector still generates contextual presentation
// (distance, height, focus, FOV, shake, HighSpeed/CloseCombat/Knockback,
// Clash/Ring-Out/Finisher). The in-game rig wraps it in
// InertialDuelDirector, which owns normal-combat azimuth continuity:
// player→opponent geometry may inform composition, but no longer dictates
// camera yaw every tick.
//
// Presentation only: nothing here feeds the simulation, replay or state
// hash. Camera is downstream presentation; it may observe gameplay, never
// mutate or causally influence gameplay.
// ============================================================

import { type CameraMode, type DirectorOptions, type DirectorOutput } from './CameraDirector';
import {
  CAMERA_CONTAIN_RADIUS_M,
  CAMERA_EDGE_MARGIN_M,
  CAMERA_RINGOUT_WATCH_RADIUS_M,
  cameraContainRadiusM,
  cameraRingOutWatchRadiusM,
} from './CameraArenaScale';
import { InertialDuelDirector } from './InertialDuelDirector';
import { cloneParams, PRESETS, PRESET_IDS, type CameraParams, type PresetId } from './CameraParams';
import type { FightFrame, Vec3 } from './FightFrame';
import { clamp, smoothstep } from './frameMath';

export { CAMERA_CONTAIN_RADIUS_M, CAMERA_EDGE_MARGIN_M, CAMERA_RINGOUT_WATCH_RADIUS_M } from './CameraArenaScale';

/**
 * Shared options passed to the approved base director inside each inertial
 * wrapper. Ring-out scale is handled by InertialDuelDirector before the base
 * director sees the frame, so the Camera Lab implementation stays untouched.
 */
export const RIG_DIRECTOR_OPTIONS = {
  clashOrbit: false,
  arena: { containRadiusM: CAMERA_CONTAIN_RADIUS_M },
} as const;

/**
 * Height/distance overrides for the in-game camera. The three approved
 * personalities remain; the new inertial layer changes only normal-combat
 * yaw authority and uses these values as the base shot geometry.
 */
export interface ArenaCameraRig {
  readonly minDistance: number;
  readonly maxDistance: number;
  readonly cameraHeight: number;
}
export const ARENA_CAMERA_RIGS: Readonly<Record<PresetId, ArenaCameraRig>> = {
  A: { minDistance: 5.8, maxDistance: 13, cameraHeight: 2.4 },
  B: { minDistance: 5, maxDistance: 14, cameraHeight: 1.9 },
  C: { minDistance: 4.3, maxDistance: 15, cameraHeight: 1.5 },
};

/** The approved preset params with the in-game arena distance/height overrides applied. */
export function arenaParamsFor(id: PresetId): CameraParams {
  const params = cloneParams(PRESETS[id]);
  const rig = ARENA_CAMERA_RIGS[id];
  params.minDistance = rig.minDistance;
  params.maxDistance = rig.maxDistance;
  params.cameraHeight = rig.cameraHeight;
  return params;
}

/** Options used by the base director inside the game wrapper. */
export function rigDirectorOptions(_id: PresetId, floorHeightAt?: (x: number, z: number) => number): DirectorOptions {
  return { ...RIG_DIRECTOR_OPTIONS, arena: { containRadiusM: cameraContainRadiusM() }, floorHeightAt };
}

/** The preset the Clash always uses (owner decision 2026-09-28). */
export const CLASH_FORCED_PRESET: PresetId = 'B';
/** Below this share the forced Clash camera is dropped so the player's preset is back exactly. */
export const CLASH_BLEND_EPSILON = 1e-3;
/** Crossfade length when the player changes preset mid-match (s). */
export const PRESET_SWITCH_BLEND_S = 0.6;
/** The Clash blend toward B never goes faster than 0 → 1 in this long. */
export const CLASH_BLEND_MIN_S = 0.8;

export const CAMERA_PRESET_NAMES: Readonly<Record<PresetId, string>> = {
  A: 'Arena Fighter',
  B: 'Cinematic Hybrid',
  C: 'Hyper Dynamic',
};

export const CAMERA_PRESET_NOTES: Readonly<Record<PresetId, string>> = {
  A: 'Readability first: stable duel framing, gentle zoom, late composition correction.',
  B: 'Balanced: inertial duel framing with responsive look-ahead, speed zoom and knockback presentation.',
  C: 'Maximum spectacle: stronger FOV, shake and faster composition recovery without axis-chasing spins.',
};

export interface CameraRigOutput {
  readonly eye: Vec3;
  readonly focus: Vec3;
  /** Vertical FOV (degrees), impact punch included. */
  readonly fov: number;
  readonly fovPunch: number;
  readonly shake: Vec3;
  readonly mode: CameraMode;
  readonly preset: PresetId;
  readonly clashBlend: number;
  readonly presetSwitch: number;
  readonly player: DirectorOutput;
}

/**
 * The camera surface MatchSession may call. It observes gameplay and returns
 * presentation only. Tests can replace it with frozen/hostile/null cameras
 * to prove gameplay independence.
 */
export type CameraObserver = Pick<CameraRig, 'tick' | 'setPreset' | 'getPreset' | 'setAspect'>;

export class CameraRig {
  private readonly directors: Record<PresetId, InertialDuelDirector>;
  private preset: PresetId;
  private fromPreset: PresetId;
  private switchElapsedS = PRESET_SWITCH_BLEND_S;
  private clashFollow = 0;

  constructor(preset: PresetId, aspect = 16 / 9, floorHeightAt?: (x: number, z: number) => number) {
    const options = (id: PresetId) => rigDirectorOptions(id, floorHeightAt);
    this.directors = {
      A: new InertialDuelDirector('A', arenaParamsFor('A'), aspect, options('A'), cameraRingOutWatchRadiusM()),
      B: new InertialDuelDirector('B', arenaParamsFor('B'), aspect, options('B'), cameraRingOutWatchRadiusM()),
      C: new InertialDuelDirector('C', arenaParamsFor('C'), aspect, options('C'), cameraRingOutWatchRadiusM()),
    };
    this.preset = preset;
    this.fromPreset = preset;
  }

  getPreset(): PresetId {
    return this.preset;
  }

  setPreset(preset: PresetId): void {
    if (preset === this.preset) return;
    this.fromPreset = this.preset;
    this.preset = preset;
    this.switchElapsedS = 0;
  }

  setAspect(aspect: number): void {
    for (const id of PRESET_IDS) this.directors[id].setAspect(aspect);
  }

  tick(frame: FightFrame, dt: number): CameraRigOutput {
    const outputs = {} as Record<PresetId, DirectorOutput>;
    for (const id of PRESET_IDS) outputs[id] = snapshot(this.directors[id].tick(frame, dt));

    this.switchElapsedS = Math.min(PRESET_SWITCH_BLEND_S, this.switchElapsedS + dt);
    const presetSwitch = smoothstep(0, PRESET_SWITCH_BLEND_S, this.switchElapsedS);
    const player = outputs[this.preset];
    const playerView = presetSwitch >= 1 ? view(player) : mix(view(outputs[this.fromPreset]), view(player), presetSwitch);

    const forced = outputs[CLASH_FORCED_PRESET];
    const rawClash = clamp(forced.weights.Clash, 0, 1);
    const target = rawClash < CLASH_BLEND_EPSILON ? 0 : smoothstep(0, 1, rawClash);
    const maxStep = dt / CLASH_BLEND_MIN_S;
    this.clashFollow += Math.max(-maxStep, Math.min(maxStep, target - this.clashFollow));
    const clashBlend = this.clashFollow < CLASH_BLEND_EPSILON ? 0 : this.clashFollow;
    const shown = clashBlend <= 0 ? playerView : mix(playerView, view(forced), clashBlend);

    return {
      ...shown,
      mode: clashBlend >= 0.5 ? forced.mode : player.mode,
      preset: this.preset,
      clashBlend,
      presetSwitch,
      player,
    };
  }
}

interface View {
  readonly eye: Vec3;
  readonly focus: Vec3;
  readonly fov: number;
  readonly fovPunch: number;
  readonly shake: Vec3;
}

function view(o: DirectorOutput): View {
  return { eye: o.eye, focus: o.focus, fov: o.fov, fovPunch: o.fovPunch, shake: o.shake };
}

/** The director returns mutable vectors internally; keep a copy per tick. */
function snapshot(o: DirectorOutput): DirectorOutput {
  return {
    ...o,
    eye: { ...o.eye },
    focus: { ...o.focus },
    shake: { ...o.shake },
    weights: { ...o.weights },
    debug: { ...o.debug, modifiers: [...o.debug.modifiers] },
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpV(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) };
}

function mix(a: View, b: View, t: number): View {
  return {
    eye: lerpV(a.eye, b.eye, t),
    focus: lerpV(a.focus, b.focus, t),
    fov: lerp(a.fov, b.fov, t),
    fovPunch: lerp(a.fovPunch, b.fovPunch, t),
    shake: lerpV(a.shake, b.shake, t),
  };
}
