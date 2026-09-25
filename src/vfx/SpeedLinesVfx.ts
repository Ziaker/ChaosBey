// ============================================================
// SPEED LINES VFX
// Camera-attached streaks that fade in near top speed and orient along the
// player's *actual* direction of travel, projected against what the
// camera is currently looking at (GDD requirement: must track real
// movement, never a fixed radial overlay blind to direction). Attached
// directly to the THREE.Camera (camera-local space) rather than a
// separate screen-space overlay pass — a simpler placeholder that still
// reads as "speed lines" without a second render target.
//
// The directional math is pulled out into pure, DOM/THREE-independent
// functions below so it's unit-testable without a renderer.
// ============================================================

import * as THREE from 'three';
import {
  SPEED_LINES_ARC_RAD,
  SPEED_LINES_COLOR_HEX,
  SPEED_LINES_COUNT,
  SPEED_LINES_FULL_OPACITY_SPEED_MPS,
  SPEED_LINES_MAX_OPACITY,
  SPEED_LINES_THRESHOLD_MPS,
  SPEED_LINE_DIRECTION_MIN_LENGTH_MPS,
} from './VfxTuning';

const LINE_DEPTH_CAMERA_SPACE = -2;
const LINE_INNER_RADIUS_CAMERA_SPACE = 1.1;
const LINE_OUTER_RADIUS_CAMERA_SPACE = 1.7;

/**
 * Pure: the base streak angle from a camera-relative travel direction
 * (x = screen-right component, z = screen-up component — reusing the
 * {x,z} shape other 2D helpers in this codebase use, even though this
 * particular pair is a screen plane, not world XZ). Streaks stream
 * backward from the direction of travel (classic "motion lines" read),
 * so the returned angle points opposite `directionXZ`. Returns
 * `previousAngleRad` unchanged when the direction is negligible, so the
 * streaks don't snap to an arbitrary angle right around zero velocity.
 */
export function computeSpeedLineBaseAngleRad(directionXZ: { x: number; z: number }, previousAngleRad: number): number {
  const length = Math.hypot(directionXZ.x, directionXZ.z);
  if (length < SPEED_LINE_DIRECTION_MIN_LENGTH_MPS) return previousAngleRad;
  return Math.atan2(directionXZ.x, directionXZ.z) + Math.PI;
}

/** Pure: one line's individual angle, spread across a narrow arc centered on `baseAngleRad` — a directional cluster, not a full 360° radial burst, so the pattern visibly points along the travel direction. */
export function computeSpeedLineAngleRad(baseAngleRad: number, lineIndex: number, lineCount: number, arcRad: number): number {
  if (lineCount <= 1) return baseAngleRad;
  const t = lineIndex / (lineCount - 1);
  return baseAngleRad - arcRad / 2 + t * arcRad;
}

/** Pure: 0..1 opacity fraction from current speed — 0 at/below threshold, 1 at/above the full-opacity reference. */
export function computeSpeedLinesOpacityFraction(speedMps: number): number {
  return Math.max(0, Math.min(1, (speedMps - SPEED_LINES_THRESHOLD_MPS) / (SPEED_LINES_FULL_OPACITY_SPEED_MPS - SPEED_LINES_THRESHOLD_MPS)));
}

export class SpeedLines {
  private readonly group: THREE.Group;
  private readonly lines: THREE.Line[] = [];
  private readonly materials: THREE.LineBasicMaterial[] = [];
  private baseAngleRad = 0;

  constructor() {
    this.group = new THREE.Group();
    for (let i = 0; i < SPEED_LINES_COUNT; i++) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const material = new THREE.LineBasicMaterial({ color: SPEED_LINES_COLOR_HEX, transparent: true, opacity: 0 });
      const line = new THREE.Line(geometry, material);
      line.frustumCulled = false;
      this.materials.push(material);
      this.lines.push(line);
      this.group.add(line);
    }
  }

  get object3D(): THREE.Object3D {
    return this.group;
  }

  /** `directionXZ` is the player's movement direction projected onto the camera's own right/up axes (see CombatCameraController.speedLinesScreenDirection) — camera-relative, not world space. */
  update(speedMps: number, directionXZ: { x: number; z: number }): void {
    this.baseAngleRad = computeSpeedLineBaseAngleRad(directionXZ, this.baseAngleRad);
    const opacity = computeSpeedLinesOpacityFraction(speedMps) * SPEED_LINES_MAX_OPACITY;

    for (let i = 0; i < this.lines.length; i++) {
      const angle = computeSpeedLineAngleRad(this.baseAngleRad, i, this.lines.length, SPEED_LINES_ARC_RAD);
      const dirX = Math.sin(angle);
      const dirY = Math.cos(angle);
      const line = this.lines[i]!;
      const position = line.geometry.getAttribute('position') as THREE.BufferAttribute;
      position.setXYZ(0, dirX * LINE_INNER_RADIUS_CAMERA_SPACE, dirY * LINE_INNER_RADIUS_CAMERA_SPACE, LINE_DEPTH_CAMERA_SPACE);
      position.setXYZ(1, dirX * LINE_OUTER_RADIUS_CAMERA_SPACE, dirY * LINE_OUTER_RADIUS_CAMERA_SPACE, LINE_DEPTH_CAMERA_SPACE);
      position.needsUpdate = true;
      this.materials[i]!.opacity = opacity;
    }
  }

  dispose(): void {
    for (const line of this.lines) {
      line.geometry.dispose();
    }
    for (const material of this.materials) material.dispose();
  }
}
