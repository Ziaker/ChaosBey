// ============================================================
// VFX — GAMEPLAY/FEEL TUNING
// Milestone 4 (GDD section 50+): sparks, speed lines, trails, landing VFX.
// Shapes/colors here are Milestone 4 engineering placeholders (GDD section
// 167) — simple procedural geometry, same precedent as Milestone 1's
// placeholder Bey mesh — not the approved final art. The *scaling*
// (everything grows with ImpactEvent.magnitude, nothing spawns below a
// minimum floor) implements the owner-approved "Hybrid scalable" profile
// C direction (2026-09-25).
// ============================================================

import { INTENDED_MAX_SPEED_MPS } from '../bey/movement/MovementTuning';

// --- Impact sparks ---
export const SPARK_MIN_MAGNITUDE_TO_SPAWN = 0.05;
export const SPARK_BASE_PARTICLE_COUNT = 4;
export const SPARK_MAX_EXTRA_PARTICLE_COUNT = 20;
export const SPARK_BASE_SPEED_MPS = 2;
export const SPARK_MAX_EXTRA_SPEED_MPS = 6;
export const SPARK_BASE_LIFETIME_S = 0.3;
export const SPARK_MAX_EXTRA_LIFETIME_S = 0.3;
export const SPARK_COLOR_HEX = 0xfff2b0;
export const SPARK_SIZE_M = 0.12;
export const SPARK_GRAVITY_MPS2 = 6; // a lighter fudge than real gravity — sparks should read as quick, not as heavy falling debris.

// --- Landing burst (a dust/impact ring at the touchdown point) ---
export const LANDING_MIN_MAGNITUDE_TO_SPAWN = 0.05;
export const LANDING_RING_BASE_RADIUS_M = 0.35;
export const LANDING_RING_MAX_EXTRA_RADIUS_M = 1.1;
export const LANDING_RING_LIFETIME_S = 0.4;
export const LANDING_RING_COLOR_HEX = 0xe8e8e8;

// --- Speed trail (per-Bey, active above a speed threshold) ---
export const TRAIL_SPEED_THRESHOLD_MPS = INTENDED_MAX_SPEED_MPS * 0.5;
export const TRAIL_FULL_OPACITY_SPEED_MPS = INTENDED_MAX_SPEED_MPS * 0.9;
export const TRAIL_MAX_POINTS = 16;
export const TRAIL_MAX_OPACITY = 0.6;
export const TRAIL_COLOR_FIRST_HEX = 0x4fd1ff; // matches createMatchScene's first-Bey accent.
export const TRAIL_COLOR_SECOND_HEX = 0xff6b6b; // matches createMatchScene's second-Bey accent.

// --- Speed lines (camera-attached, active near top speed) ---
// GDD requirement: streaks must track the Bey's actual movement direction
// projected against the camera, not sit as a fixed radial overlay — see
// CombatCameraController's speedLinesScreenDirection output and
// SpeedLinesVfx's pure direction helpers.
export const SPEED_LINES_THRESHOLD_MPS = INTENDED_MAX_SPEED_MPS * 0.7;
export const SPEED_LINES_FULL_OPACITY_SPEED_MPS = INTENDED_MAX_SPEED_MPS * 1.1;
export const SPEED_LINES_COUNT = 10;
export const SPEED_LINES_MAX_OPACITY = 0.45;
export const SPEED_LINES_COLOR_HEX = 0xffffff;
// Below this screen-projected direction length (m/s), keep the previous
// streak orientation rather than snapping to an arbitrary angle — avoids
// flicker right around zero velocity.
export const SPEED_LINE_DIRECTION_MIN_LENGTH_MPS = 0.05;
// Streaks cluster in a directional arc centered on the travel direction
// (streaming backward from it) rather than spreading across the full
// 360° — a placeholder but genuinely directional layout.
export const SPEED_LINES_ARC_RAD = Math.PI / 2; // 90°.
