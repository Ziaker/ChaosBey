// ============================================================
// BEY REAL — THE MODE'S CAMERAS
// Two cameras besides the game's original directors (src/camera/director): the mode's own, and one the player orbits.
// Both are PRESENTATION ONLY and downstream of the match: they read the Beys' positions and move the render camera, never the
// other way round — the control reference stays the arena's own (camera-gameplay-separation.md), so the arrows mean the same
// whatever camera is on.
//
//   RealModeCamera   high and steady: both Beys and most of the bowl in frame, following the fight slowly. A top is read from
//                    above, and the fight is fast — a steady frame is what keeps it readable.
//   FreeOrbitCamera  drag to turn it around the arena, wheel to come closer, double-click to put it back.
// ============================================================

import * as THREE from 'three';

export interface ExternalCameraFrame {
  readonly dt: number;
  readonly first: { readonly x: number; readonly y: number; readonly z: number };
  readonly second: { readonly x: number; readonly y: number; readonly z: number };
  /** The stage's radius (m): the framing scales with it. */
  readonly arenaRadiusM: number;
}

/** A camera the runner drives instead of the combat directors. */
export interface ExternalCamera {
  apply(camera: THREE.PerspectiveCamera, frame: ExternalCameraFrame): void;
  dispose(): void;
}

const REAL_FOV_DEG = 55;
/**
 * The camera sits this far back and up, in stage radii. It stays under the lamp truss the arenas hang over the stage (about 1.2 radii up
 * and 0.67 radii out), so the rig is never between the camera and the fight.
 */
const REAL_BACK_RADII = 1.15;
const REAL_UP_RADII = 1.1;
/** How much of the fight's midpoint the frame follows (0 = fixed on the centre). */
const REAL_FOLLOW = 0.35;
/** 1/s: how fast the frame catches up. */
const REAL_FOLLOW_RATE_PER_S = 2.5;

export class RealModeCamera implements ExternalCamera {
  private readonly focus = new THREE.Vector3();
  private ready = false;

  apply(camera: THREE.PerspectiveCamera, frame: ExternalCameraFrame): void {
    const midX = (frame.first.x + frame.second.x) / 2;
    const midZ = (frame.first.z + frame.second.z) / 2;
    const wantX = midX * REAL_FOLLOW;
    const wantZ = midZ * REAL_FOLLOW;
    const k = this.ready ? 1 - Math.exp(-REAL_FOLLOW_RATE_PER_S * Math.max(0, frame.dt)) : 1;
    this.ready = true;
    this.focus.x += (wantX - this.focus.x) * k;
    this.focus.z += (wantZ - this.focus.z) * k;
    const r = frame.arenaRadiusM;
    camera.position.set(this.focus.x, REAL_UP_RADII * r, this.focus.z + REAL_BACK_RADII * r);
    camera.lookAt(this.focus.x, 0, this.focus.z);
    camera.fov = REAL_FOV_DEG;
    camera.updateProjectionMatrix();
  }

  dispose(): void {}
}

const FREE_FOV_DEG = 55;
const FREE_START_YAW_RAD = 0;
const FREE_START_PITCH_RAD = 0.95;
const FREE_START_DISTANCE_RADII = 2.1;
const FREE_MIN_PITCH_RAD = 0.15;
const FREE_MAX_PITCH_RAD = 1.5;
const FREE_MIN_DISTANCE_RADII = 0.35;
const FREE_MAX_DISTANCE_RADII = 4;
const FREE_DRAG_RAD_PER_PX = 0.006;
const FREE_WHEEL_PER_DELTA = 0.0012;

export class FreeOrbitCamera implements ExternalCamera {
  private yaw = FREE_START_YAW_RAD;
  private pitch = FREE_START_PITCH_RAD;
  private distanceRadii = FREE_START_DISTANCE_RADII;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;

  /**
   * Listens on the window (the HUD sits over the canvas and would swallow the events); a press that starts on a button, a field
   * or a link is theirs, not the camera's.
   */
  constructor(private readonly element: Window | HTMLElement = window) {
    element.addEventListener('pointerdown', this.onPointerDown as EventListener);
    element.addEventListener('pointermove', this.onPointerMove as EventListener);
    element.addEventListener('pointerup', this.onPointerUp);
    element.addEventListener('pointercancel', this.onPointerUp);
    element.addEventListener('wheel', this.onWheel as EventListener, { passive: false });
    element.addEventListener('dblclick', this.onReset);
  }

  apply(camera: THREE.PerspectiveCamera, frame: ExternalCameraFrame): void {
    const distance = this.distanceRadii * frame.arenaRadiusM;
    const horizontal = Math.cos(this.pitch) * distance;
    camera.position.set(Math.sin(this.yaw) * horizontal, Math.sin(this.pitch) * distance, Math.cos(this.yaw) * horizontal);
    camera.lookAt(0, 0, 0);
    camera.fov = FREE_FOV_DEG;
    camera.updateProjectionMatrix();
  }

  dispose(): void {
    const { element } = this;
    element.removeEventListener('pointerdown', this.onPointerDown as EventListener);
    element.removeEventListener('pointermove', this.onPointerMove as EventListener);
    element.removeEventListener('pointerup', this.onPointerUp);
    element.removeEventListener('pointercancel', this.onPointerUp);
    element.removeEventListener('wheel', this.onWheel as EventListener);
    element.removeEventListener('dblclick', this.onReset);
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    const target = event.target as Element | null;
    if (target && typeof target.closest === 'function' && target.closest('button, input, select, textarea, a, [role="dialog"]')) return;
    this.dragging = true;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.dragging) return;
    this.yaw -= (event.clientX - this.lastX) * FREE_DRAG_RAD_PER_PX;
    this.pitch = Math.min(FREE_MAX_PITCH_RAD, Math.max(FREE_MIN_PITCH_RAD, this.pitch + (event.clientY - this.lastY) * FREE_DRAG_RAD_PER_PX));
    this.lastX = event.clientX;
    this.lastY = event.clientY;
  };

  private readonly onPointerUp = (): void => {
    this.dragging = false;
  };

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.distanceRadii = Math.min(FREE_MAX_DISTANCE_RADII, Math.max(FREE_MIN_DISTANCE_RADII, this.distanceRadii * (1 + event.deltaY * FREE_WHEEL_PER_DELTA)));
  };

  private readonly onReset = (): void => {
    this.yaw = FREE_START_YAW_RAD;
    this.pitch = FREE_START_PITCH_RAD;
    this.distanceRadii = FREE_START_DISTANCE_RADII;
  };

  /** For the tests: the orbit's state. */
  getState(): { yaw: number; pitch: number; distanceRadii: number } {
    return { yaw: this.yaw, pitch: this.pitch, distanceRadii: this.distanceRadii };
  }
}
