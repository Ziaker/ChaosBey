// ============================================================
// SPEED TRAIL VFX
// A per-Bey fading trail active above a speed threshold (Milestone 4).
// A persistent ring-buffer THREE.Line kept in the scene the whole match —
// opacity (not existence) is what turns it on/off, so there's no
// create/destroy churn while a Bey repeatedly crosses the threshold.
// ============================================================

import * as THREE from 'three';
import type { WorldPositionM } from '../camera/ImpactEvents';
import { TRAIL_FULL_OPACITY_SPEED_MPS, TRAIL_MAX_OPACITY, TRAIL_MAX_POINTS, TRAIL_SPEED_THRESHOLD_MPS } from './VfxTuning';

export class SpeedTrail {
  private readonly line: THREE.Line;
  private readonly positions: Float32Array;
  private pointCount = 0;

  constructor(colorHex: number) {
    this.positions = new Float32Array(TRAIL_MAX_POINTS * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setDrawRange(0, 0);
    const material = new THREE.LineBasicMaterial({ color: colorHex, transparent: true, opacity: 0 });
    this.line = new THREE.Line(geometry, material);
    this.line.frustumCulled = false;
  }

  get object3D(): THREE.Object3D {
    return this.line;
  }

  update(currentPositionM: WorldPositionM, speedMps: number): void {
    for (let i = TRAIL_MAX_POINTS - 1; i > 0; i--) {
      this.positions[i * 3] = this.positions[(i - 1) * 3] ?? 0;
      this.positions[i * 3 + 1] = this.positions[(i - 1) * 3 + 1] ?? 0;
      this.positions[i * 3 + 2] = this.positions[(i - 1) * 3 + 2] ?? 0;
    }
    this.positions[0] = currentPositionM.x;
    this.positions[1] = currentPositionM.y;
    this.positions[2] = currentPositionM.z;
    this.pointCount = Math.min(TRAIL_MAX_POINTS, this.pointCount + 1);

    const position = this.line.geometry.getAttribute('position') as THREE.BufferAttribute;
    position.needsUpdate = true;
    this.line.geometry.setDrawRange(0, this.pointCount);

    const speedFraction = Math.max(0, Math.min(1, (speedMps - TRAIL_SPEED_THRESHOLD_MPS) / (TRAIL_FULL_OPACITY_SPEED_MPS - TRAIL_SPEED_THRESHOLD_MPS)));
    (this.line.material as THREE.LineBasicMaterial).opacity = speedFraction * TRAIL_MAX_OPACITY;
  }

  dispose(): void {
    this.line.geometry.dispose();
    (this.line.material as THREE.Material).dispose();
  }
}
