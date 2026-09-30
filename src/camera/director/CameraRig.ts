// ============================================================
// CAMERA RIG (M11 lane 2)
// The game's camera: the approved director (CameraDirector) running the
// three approved presets, with the two owner rules on top:
//
// - The player picks A, B or C in Settings (camera-approval.md 8). A
//   change mid-match crossfades over PRESET_SWITCH_BLEND_S instead of
//   cutting (approval 10.2 recommendation: allow it, smoothly).
// - The Clash always forces camera B without orbit, whatever the player
//   picked (clash-presentation-approval.md 3.6 and 5). The blend toward B
//   follows B's own Clash context weight, which ramps in and out at B's
//   approved transitionSpeed, so entering and leaving the Clash never
//   cuts, and once the Clash weight has decayed the player's preset is
//   back exactly as it was.
//
// All three directors run every tick on the same FightFrame (as in the
// lab, where all three watch the same fight), so each is always warm: a
// crossfade or the Clash blend only ever mixes two live, continuous
// cameras. Every director uses `clashOrbit: false`, so no camera the
// player can see ever orbits during a Clash; for a player on B, the
// player's camera and the forced camera are the same director.
//
// Presentation only: nothing here feeds the simulation, the replay or the
// state hash (camera-approval.md 8).
// ============================================================

import { CameraDirector, type CameraMode, type DirectorOutput } from './CameraDirector';
import { PRESETS, PRESET_IDS, type PresetId } from './CameraParams';
import type { FightFrame, Vec3 } from './FightFrame';
import { clamp, smoothstep } from './frameMath';

/**
 * Every game director: no Clash orbit (clash-presentation-approval.md 3.6)
 * and the in-game arena camera (owner, M11 playtest): stays inside the
 * arena, ignores fight-axis turns under 60°.
 */
export const RIG_DIRECTOR_OPTIONS = {
  clashOrbit: false,
  arena: { containRadiusM: 10.5, yawDeadzoneRad: (60 * Math.PI) / 180 },
} as const;

/** The preset the Clash always uses (owner decision 2026-09-28). */
export const CLASH_FORCED_PRESET: PresetId = 'B';
/** Below this share the forced Clash camera is dropped (a sub-millimetre difference), so the player's preset is back exactly instead of asymptotically. */
export const CLASH_BLEND_EPSILON = 1e-3;
/** Crossfade length when the player changes preset mid-match (s). */
export const PRESET_SWITCH_BLEND_S = 0.6;

/** Player-facing names (camera-approval.md 10.3: the lab's English names). */
export const CAMERA_PRESET_NAMES: Readonly<Record<PresetId, string>> = {
  A: 'Arena Fighter',
  B: 'Cinematic Hybrid',
  C: 'Hyper Dynamic',
};

export const CAMERA_PRESET_NOTES: Readonly<Record<PresetId, string>> = {
  A: 'Readability first: steady, high framing, gentle zoom, never switches shoulder.',
  B: 'Balanced: follows the action with look-ahead and clear speed zoom, still easy to read.',
  C: 'Maximum spectacle: strong orbit, big zoom swings, impacts re-compose the shot.',
};

export interface CameraRigOutput {
  readonly eye: Vec3;
  readonly focus: Vec3;
  /** Vertical FOV (degrees), impact punch included. */
  readonly fov: number;
  /** The impact FOV punch included in `fov`. */
  readonly fovPunch: number;
  readonly shake: Vec3;
  /** The mode on screen: the forced camera's while the Clash blend dominates, else the player's. */
  readonly mode: CameraMode;
  /** The player's chosen preset. */
  readonly preset: PresetId;
  /** 0..1: how much of the forced Clash camera (B, no orbit) is on screen. */
  readonly clashBlend: number;
  /** 0..1 progress of a preset crossfade (1 = settled). */
  readonly presetSwitch: number;
  /** The player's director output (for the debug readouts). */
  readonly player: DirectorOutput;
}

export class CameraRig {
  private readonly directors: Record<PresetId, CameraDirector>;
  private preset: PresetId;
  private fromPreset: PresetId;
  private switchElapsedS = PRESET_SWITCH_BLEND_S;

  /** `floorHeightAt`: the arena floor under (x, z) for the directors' floor guard (M11 bowls); omit for the flat arena. */
  constructor(preset: PresetId, aspect = 16 / 9, floorHeightAt?: (x: number, z: number) => number) {
    const options = { ...RIG_DIRECTOR_OPTIONS, floorHeightAt };
    this.directors = {
      A: new CameraDirector(PRESETS.A, aspect, options),
      B: new CameraDirector(PRESETS.B, aspect, options),
      C: new CameraDirector(PRESETS.C, aspect, options),
    };
    this.preset = preset;
    this.fromPreset = preset;
  }

  getPreset(): PresetId {
    return this.preset;
  }

  /** Change the player's preset; mid-match it crossfades from whatever is on screen. */
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
    const clashBlend = rawClash < CLASH_BLEND_EPSILON ? 0 : rawClash;
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

/** The director returns its own mutable vectors; keep a copy per tick. */
function snapshot(o: DirectorOutput): DirectorOutput {
  return { ...o, eye: { ...o.eye }, focus: { ...o.focus }, shake: { ...o.shake }, weights: { ...o.weights } };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpV(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) };
}

function mix(a: View, b: View, t: number): View {
  return { eye: lerpV(a.eye, b.eye, t), focus: lerpV(a.focus, b.focus, t), fov: lerp(a.fov, b.fov, t), fovPunch: lerp(a.fovPunch, b.fovPunch, t), shake: lerpV(a.shake, b.shake, t) };
}
