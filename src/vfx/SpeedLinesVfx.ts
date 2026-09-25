// ============================================================
// SPEED LINES VFX
// Camera-attached radial streaks that fade in near top speed (Milestone
// 4's "high-speed camera" feedback). Attached directly to the THREE.Camera
// (camera-local space) rather than a separate screen-space overlay pass —
// a simpler placeholder that still reads as "speed lines" without a
// second render target. Driven by the player-controlled (first) Bey's
// speed.
// ============================================================

import * as THREE from 'three';
import { SPEED_LINES_COLOR_HEX, SPEED_LINES_COUNT, SPEED_LINES_FULL_OPACITY_SPEED_MPS, SPEED_LINES_MAX_OPACITY, SPEED_LINES_THRESHOLD_MPS } from './VfxTuning';

const LINE_DEPTH_CAMERA_SPACE = -2;
const LINE_INNER_RADIUS_CAMERA_SPACE = 1.1;
const LINE_OUTER_RADIUS_CAMERA_SPACE = 1.7;

export class SpeedLines {
  private readonly group: THREE.Group;
  private readonly materials: THREE.LineBasicMaterial[] = [];

  constructor() {
    this.group = new THREE.Group();
    for (let i = 0; i < SPEED_LINES_COUNT; i++) {
      const angle = (i / SPEED_LINES_COUNT) * Math.PI * 2;
      const dirX = Math.cos(angle);
      const dirY = Math.sin(angle);
      const points = [
        new THREE.Vector3(dirX * LINE_INNER_RADIUS_CAMERA_SPACE, dirY * LINE_INNER_RADIUS_CAMERA_SPACE, LINE_DEPTH_CAMERA_SPACE),
        new THREE.Vector3(dirX * LINE_OUTER_RADIUS_CAMERA_SPACE, dirY * LINE_OUTER_RADIUS_CAMERA_SPACE, LINE_DEPTH_CAMERA_SPACE),
      ];
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineBasicMaterial({ color: SPEED_LINES_COLOR_HEX, transparent: true, opacity: 0 });
      const line = new THREE.Line(geometry, material);
      line.frustumCulled = false;
      this.materials.push(material);
      this.group.add(line);
    }
  }

  get object3D(): THREE.Object3D {
    return this.group;
  }

  update(speedMps: number): void {
    const speedFraction = Math.max(0, Math.min(1, (speedMps - SPEED_LINES_THRESHOLD_MPS) / (SPEED_LINES_FULL_OPACITY_SPEED_MPS - SPEED_LINES_THRESHOLD_MPS)));
    const opacity = speedFraction * SPEED_LINES_MAX_OPACITY;
    for (const material of this.materials) material.opacity = opacity;
  }

  dispose(): void {
    for (const line of this.group.children) {
      if (line instanceof THREE.Line) {
        line.geometry.dispose();
      }
    }
    for (const material of this.materials) material.dispose();
  }
}
