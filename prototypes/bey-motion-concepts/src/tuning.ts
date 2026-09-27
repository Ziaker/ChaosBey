// ============================================================
// BEY MOTION LAB — TUNING
// Visual exploration only. Like every prototype, this page imports
// nothing from src/: the game values it reproduces are COPIED here, each
// with its source, so the lab shows the models under the conditions the
// game actually renders them in. Changing a value here changes nothing in
// the game.
// ============================================================

/** Prototype model units -> meters. Same factor the Arena Lab uses: the ~6-unit round-2 Beys become ~1.3–1.4 m, the game's Bey size. */
export const BEY_SCALE = 0.24;

// ---- Mirrored from the game (as of main@0b945f2) ----

/** src/bey/spin/SpinTuning.ts BASE_SPIN_RATE_RAD_S — the game's visual spin rate (placeholder, "picked for readability"). */
export const GAME_SPIN_RATE_RAD_S = 22;
/** src/bey/spin/SpinTuning.ts WOBBLE_AMPLITUDE_RAD (6°). */
export const GAME_WOBBLE_AMPLITUDE_RAD = (6 * Math.PI) / 180;
/** src/bey/spin/SpinTuning.ts WOBBLE_FREQUENCY_HZ. */
export const GAME_WOBBLE_FREQUENCY_HZ = 7;
/** src/bey/spin/SpinTuning.ts MAX_GAMEPLAY_TILT_RAD (35°) — reference tilt, impacts may exceed it briefly. */
export const GAME_MAX_TILT_RAD = (35 * Math.PI) / 180;
/** src/bey/stamina/StaminaTuning.ts STAMINA_MAX_WOBBLE_ENERGY_FLOOR — wobble energy a Bey at zero Stamina never drops below. */
export const GAME_ZERO_STAMINA_WOBBLE_FLOOR = 0.25;
/** src/camera/CameraTuning.ts CAMERA_BASE_DISTANCE_M / CAMERA_BASE_HEIGHT_M / CAMERA_FOV_BASE_DEG — the combat camera. */
export const GAME_CAMERA_DISTANCE_M = 9;
export const GAME_CAMERA_HEIGHT_M = 6;
export const GAME_CAMERA_FOV_DEG = 55;
/** src/camera/CombatCameraController.ts: the distance above is HORIZONTAL, the height is added on top; distance grows 0.6 m per meter of separation beyond 3 m, clamped 7..16 m; the camera sits behind the player on the player->opponent axis, 0.35 rad to one shoulder, and its orbit follows that axis smoothed at 3/s. */
export const GAME_CAMERA_SEPARATION_REFERENCE_M = 3;
export const GAME_CAMERA_SEPARATION_TO_DISTANCE = 0.6;
export const GAME_CAMERA_MIN_DISTANCE_M = 7;
export const GAME_CAMERA_MAX_DISTANCE_M = 16;
export const GAME_CAMERA_SHOULDER_OFFSET_RAD = 0.35;
export const GAME_CAMERA_ORBIT_SMOOTHING_PER_S = 3;
export const GAME_CAMERA_POSITION_SMOOTHING_PER_S = 6;
/** High-speed framing (src/camera/CameraTuning.ts): above 14 m/s, blending fully by 18 m/s, +2 m distance, +0.6 m height, +4° FOV. */
export const GAME_CAMERA_HIGH_SPEED_THRESHOLD_MPS = 14;
export const GAME_CAMERA_HIGH_SPEED_FULL_MPS = 18;
export const GAME_CAMERA_HIGH_SPEED_EXTRA_DISTANCE_M = 2;
export const GAME_CAMERA_HIGH_SPEED_EXTRA_HEIGHT_M = 0.6;
export const GAME_CAMERA_HIGH_SPEED_EXTRA_FOV_DEG = 4;
/** Ordinary top speed and Dash top speed (src/camera/CameraTuning.ts comments: "ordinary top speed (11 mps)", "Dash Attack (up to 18 mps)"). */
export const GAME_TOP_SPEED_MPS = 11;
export const GAME_DASH_SPEED_MPS = 18;
/** src/app/simulation fixed step: 60 Hz. The visual spin is sampled once per rendered frame. */
export const GAME_FRAME_HZ = 60;

// ---- Lab ranges and presets ----

export const SPIN_RATE_MAX_RAD_S = 160;
/** Spin presets offered next to the slider (rad/s). The first is the game's current value. */
export const SPIN_PRESETS: ReadonlyArray<{ label: string; rate: number }> = [
  { label: 'Game (22)', rate: GAME_SPIN_RATE_RAD_S },
  { label: '45', rate: 45 },
  { label: '90', rate: 90 },
  { label: '150', rate: 150 },
];

/** Radius of the demo path (m) — the arena floor radius is 12 m. */
export const ORBIT_RADIUS_M = 5;
/** Lean into the turn per unit of centripetal acceleration (rad per m/s²) — visual only, clamped to the game's reference tilt. */
export const TURN_LEAN_PER_ACCEL = 0.018;

/** Spin-down demo: seconds from full spin to a stop, and the extra wobble it grows into (on top of the game's zero-Stamina floor). */
export const SPIN_DOWN_SECONDS = 8;
export const SPIN_DOWN_MAX_WOBBLE = 1;

/** Blur: sub-frame "ghost" copies spread over one frame's rotation (a shutter), when blur is on. */
export const BLUR_GHOSTS = 4;
/** Shutter as a fraction of the frame interval (1 = the whole frame's rotation is smeared). */
export const BLUR_SHUTTER = 0.8;

/** Duel: the second Bey trails the first on the same path by this phase (rad) — about 4 m apart on the circle. */
export const DUEL_PHASE_GAP_RAD = 0.9;

/** Grid view: spacing (m) between the nine Beys, laid out 3×3. */
export const GRID_SPACING_M = 2.6;
