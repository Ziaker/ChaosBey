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

import { CameraDirector, type CameraMode, type DirectorOptions, type DirectorOutput, type ShoulderRig } from './CameraDirector';
import { PRESETS, PRESET_IDS, type PresetId } from './CameraParams';
import type { FightFrame, Vec3 } from './FightFrame';
import { clamp, smoothstep } from './frameMath';

/**
 * Every game director: no Clash orbit (clash-presentation-approval.md 3.6)
 * and the in-game arena camera (owner, M11 playtest): stays inside the
 * arena. The rig adds each preset's over-the-shoulder framing (SHOULDER_RIGS).
 */
export const RIG_DIRECTOR_OPTIONS = {
  clashOrbit: false,
  arena: { containRadiusM: 10.5 },
} as const;

/**
 * Over-the-shoulder framing per preset (owner playtest, after M11: "third
 * person behind the Bey, behind and just a little above, over the
 * shoulder"). The lab presets framed the fight from 7–17 m out and 4–6 m up;
 * these put the eye 3.6–5 m behind the player's Bey and 1.5–2.4 m above it.
 * A steadiest and highest, C closest and lowest; the presets' own FOV,
 * smoothing, orbit speed cap, shake and contexts are unchanged.
 */
export const SHOULDER_RIGS: Readonly<Record<PresetId, ShoulderRig>> = {
  A: { distanceM: 5, heightM: 2.4, shoulderM: 0.5, framing: 0.5, lookHeightM: 0.5, separationPull: 0.3, maxExtraDistanceM: 3.5, lookAheadS: 0 },
  B: { distanceM: 4.2, heightM: 1.9, shoulderM: 0.8, framing: 0.45, lookHeightM: 0.45, separationPull: 0.28, maxExtraDistanceM: 3, lookAheadS: 0.12 },
  C: { distanceM: 3.6, heightM: 1.5, shoulderM: 1, framing: 0.4, lookHeightM: 0.4, separationPull: 0.25, maxExtraDistanceM: 2.5, lookAheadS: 0.2 },
};

/** The options the rig builds preset `id`'s director with (tests build the same director to compare against). */
export function rigDirectorOptions(id: PresetId, floorHeightAt?: (x: number, z: number) => number): DirectorOptions {
  return { ...RIG_DIRECTOR_OPTIONS, arena: { ...RIG_DIRECTOR_OPTIONS.arena, shoulder: SHOULDER_RIGS[id] }, floorHeightAt };
}

/** The preset the Clash always uses (owner decision 2026-09-28). */
export const CLASH_FORCED_PRESET: PresetId = 'B';
/** Below this share the forced Clash camera is dropped (a sub-millimetre difference), so the player's preset is back exactly instead of asymptotically. */
export const CLASH_BLEND_EPSILON = 1e-3;
/** Crossfade length when the player changes preset mid-match (s). */
export const PRESET_SWITCH_BLEND_S = 0.6;
/** The Clash blend toward B never goes faster than 0 → 1 in this long. */
export const CLASH_BLEND_MIN_S = 0.8;

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
  private clashFollow = 0;

  /** `floorHeightAt`: the arena floor under (x, z) for the directors' floor guard (M11 bowls); omit for the flat arena. */
  constructor(preset: PresetId, aspect = 16 / 9, floorHeightAt?: (x: number, z: number) => number) {
    const options = (id: PresetId) => rigDirectorOptions(id, floorHeightAt);
    this.directors = {
      A: new CameraDirector(PRESETS.A, aspect, options('A')),
      B: new CameraDirector(PRESETS.B, aspect, options('B')),
      C: new CameraDirector(PRESETS.C, aspect, options('C')),
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
    // Follows the director's Clash weight, eased and rate-limited: that
    // weight rises exponentially (fastest on its first tick) and the
    // player's eye can be ~12 m from B's (both kept inside the arena), so
    // followed raw the view swept 0.6 m in one tick. A full blend now takes
    // at least CLASH_BLEND_MIN_S.
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
