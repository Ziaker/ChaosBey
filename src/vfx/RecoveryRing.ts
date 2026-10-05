// ============================================================
// AIR RECOVERY RING (owner, 2026-10-04)
// "Adicione um efeito visual de argola se expandindo no ar ao realizar o
// recovery." Presentation only: two thin glowing rings burst outward from
// the Bey where the recovery was used, flattening and fading as they grow.
// ============================================================

import * as THREE from 'three';

/** Seconds a ring lives. PROVISIONAL. */
export const RECOVERY_RING_LIFE_S = 0.5;
/** Radius at birth and at the end of its life (m). PROVISIONAL. */
const START_RADIUS_M = 0.45;
const END_RADIUS_M = 3.2;
/** The second, fainter ring starts this much later. */
const ECHO_DELAY_S = 0.08;

interface Ring {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  ageS: number;
  peakOpacity: number;
}

export class RecoveryRingEffect {
  private readonly rings: Ring[] = [];
  private readonly geometry = new THREE.TorusGeometry(1, 0.045, 8, 64);

  /** Owner, 2026-10-05: × the rings' size (the Bey size × the effects size). 1 = the approved look. */
  effectScale = 1;

  constructor(private readonly parent: THREE.Object3D) {}

  /** A burst at a world position (the Bey's centre). */
  spawn(position: { x: number; y: number; z: number }): void {
    this.add(position, 0, 1, 0x9fe8ff);
    this.add(position, -ECHO_DELAY_S, 0.6, 0xffffff);
  }

  private add(position: { x: number; y: number; z: number }, ageS: number, peakOpacity: number, color: number): void {
    const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    const mesh = new THREE.Mesh(this.geometry, material);
    mesh.position.set(position.x, position.y, position.z);
    mesh.rotation.x = Math.PI / 2; // horizontal, around the Bey
    mesh.visible = false;
    mesh.name = 'airRecoveryRing';
    this.parent.add(mesh);
    this.rings.push({ mesh, material, ageS, peakOpacity });
  }

  update(dtS: number): void {
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const ring = this.rings[i]!;
      ring.ageS += dtS;
      if (ring.ageS >= RECOVERY_RING_LIFE_S) {
        ring.mesh.removeFromParent();
        ring.material.dispose();
        this.rings.splice(i, 1);
        continue;
      }
      if (ring.ageS < 0) continue;
      const t = ring.ageS / RECOVERY_RING_LIFE_S;
      const ease = 1 - (1 - t) * (1 - t) * (1 - t); // fast burst, slow settle
      const radius = (START_RADIUS_M + (END_RADIUS_M - START_RADIUS_M) * ease) * this.effectScale;
      // Local z is world up after the rotation: the ring flattens as it grows.
      ring.mesh.scale.set(radius, radius, radius * Math.max(0.2, 1 - t));
      ring.mesh.visible = true;
      ring.material.opacity = ring.peakOpacity * (1 - t) * Math.min(1, ring.ageS / 0.04);
    }
  }

  /** Live rings (tests). */
  get activeCount(): number {
    return this.rings.length;
  }

  dispose(): void {
    for (const ring of this.rings) {
      ring.mesh.removeFromParent();
      ring.material.dispose();
    }
    this.rings.length = 0;
    this.geometry.dispose();
  }
}
