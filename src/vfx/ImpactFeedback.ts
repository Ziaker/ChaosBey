// ============================================================
// IMPACT FEEDBACK (owner, 2026-10-05: game feel — "implemente tudo exceto som e vibração")
// Presentation only, each part behind its own Settings switch:
// - hit flash: the Bey that takes a hit glows white for a moment (an additive shell over the model, so no material
//   of the Bey itself is touched);
// - hit shake: while the hit freezes the match (hitstop), the struck Bey's model shakes in place — the body never
//   moves, only the drawn model, and it is back on the body the frame the freeze ends;
// - counter burst: a Circular that catches a Dash gets its own gold double ring and flash at the contact (the
//   "COUNTER!" word is the HUD's).
// Nothing here is read by the simulation, the camera or the replay.
// ============================================================

import * as THREE from 'three';

export type FeedbackSide = 'first' | 'second';

export interface ImpactFeedbackOptions {
  readonly hitFlash: boolean;
  readonly hitShake: boolean;
  readonly counterFeedback: boolean;
}

/** Seconds the hit flash takes to fade out. PROVISIONAL. */
export const HIT_FLASH_S = 0.14;
/** Peak opacity of the hit flash shell. PROVISIONAL. */
const HIT_FLASH_PEAK = 0.85;
/** Shell radius over the Bey's collider radius. */
const HIT_FLASH_SCALE = 1.25;
/** Peak model shake during the hit freeze, m. PROVISIONAL. */
export const HIT_SHAKE_M = 0.09;
/** Shake frequency, Hz (fast enough to read as a jolt, not a wobble). */
const HIT_SHAKE_HZ = 38;
/** Seconds the counter burst lives. PROVISIONAL. */
export const COUNTER_BURST_S = 0.55;
const COUNTER_START_RADIUS_M = 0.6;
const COUNTER_END_RADIUS_M = 4.2;
const COUNTER_COLOR = 0xffc94a;

interface Ring {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.MeshBasicMaterial;
  ageS: number;
  readonly peak: number;
}

export class ImpactFeedback {
  private options: ImpactFeedbackOptions;
  private readonly flashGeometry = new THREE.SphereGeometry(1, 20, 14);
  private readonly ringGeometry = new THREE.TorusGeometry(1, 0.07, 8, 64);
  private readonly flash: Record<FeedbackSide, { mesh: THREE.Mesh; material: THREE.MeshBasicMaterial; leftS: number }>;
  /** The side the last hit struck: it is the one that shakes while the freeze lasts. */
  private shakeSide: FeedbackSide | null = null;
  private shakeClockS = 0;
  private readonly rings: Ring[] = [];

  constructor(
    private readonly parent: THREE.Object3D,
    options: ImpactFeedbackOptions,
  ) {
    this.options = options;
    const shell = (side: FeedbackSide): { mesh: THREE.Mesh; material: THREE.MeshBasicMaterial; leftS: number } => {
      const material = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
      const mesh = new THREE.Mesh(this.flashGeometry, material);
      mesh.name = `hitFlash-${side}`;
      mesh.visible = false;
      mesh.renderOrder = 5;
      parent.add(mesh);
      return { mesh, material, leftS: 0 };
    };
    this.flash = { first: shell('first'), second: shell('second') };
  }

  setOptions(options: ImpactFeedbackOptions): void {
    this.options = options;
    if (!options.hitFlash) for (const side of ['first', 'second'] as const) this.flash[side].leftS = 0;
    if (!options.counterFeedback) this.clearRings();
  }

  /** A hit landed on `defender` this tick. */
  onHit(defender: FeedbackSide): void {
    if (this.options.hitFlash) this.flash[defender].leftS = HIT_FLASH_S;
    this.shakeSide = defender;
    this.shakeClockS = 0;
  }

  /** A Circular caught a Dash: the counter burst at the contact point. */
  onCounter(position: { x: number; y: number; z: number }): void {
    if (!this.options.counterFeedback) return;
    this.addRing(position, 0, 1);
    this.addRing(position, -0.07, 0.6);
  }

  /**
   * Once per rendered frame, after the Bey models were placed on their bodies. `hitstopActive`: the match is frozen
   * by a hit right now. `models`: each side's drawn model (its group is offset by the shake, never the body), and the
   * Bey's collider radius for the flash shell.
   */
  update(dtS: number, hitstopActive: boolean, models: Record<FeedbackSide, { readonly group: THREE.Object3D; readonly radiusM: number }>): void {
    for (const side of ['first', 'second'] as const) {
      const flash = this.flash[side];
      flash.leftS = Math.max(0, flash.leftS - dtS);
      const on = this.options.hitFlash && flash.leftS > 0;
      flash.mesh.visible = on;
      if (on) {
        const { group, radiusM } = models[side];
        group.getWorldPosition(flash.mesh.position);
        flash.mesh.scale.setScalar(radiusM * HIT_FLASH_SCALE);
        flash.material.opacity = HIT_FLASH_PEAK * (flash.leftS / HIT_FLASH_S);
      }
    }
    if (hitstopActive && this.options.hitShake && this.shakeSide) {
      this.shakeClockS += dtS;
      const phase = this.shakeClockS * HIT_SHAKE_HZ * Math.PI * 2;
      const group = models[this.shakeSide].group;
      group.position.x += Math.sin(phase) * HIT_SHAKE_M;
      group.position.z += Math.cos(phase * 1.37) * HIT_SHAKE_M * 0.8;
    } else if (!hitstopActive) {
      this.shakeSide = null;
    }
    this.updateRings(dtS);
  }

  /** Live counter rings (tests). */
  get counterRingCount(): number {
    return this.rings.length;
  }

  /** Whether `side`'s flash shell is showing (tests). */
  isFlashing(side: FeedbackSide): boolean {
    return this.flash[side].mesh.visible;
  }

  dispose(): void {
    this.clearRings();
    for (const side of ['first', 'second'] as const) {
      this.flash[side].mesh.removeFromParent();
      this.flash[side].material.dispose();
    }
    this.flashGeometry.dispose();
    this.ringGeometry.dispose();
  }

  private addRing(position: { x: number; y: number; z: number }, ageS: number, peak: number): void {
    const material = new THREE.MeshBasicMaterial({ color: COUNTER_COLOR, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    const mesh = new THREE.Mesh(this.ringGeometry, material);
    mesh.position.set(position.x, position.y + 0.3, position.z);
    mesh.rotation.x = Math.PI / 2;
    mesh.visible = false;
    mesh.name = 'counterBurst';
    this.parent.add(mesh);
    this.rings.push({ mesh, material, ageS, peak });
  }

  private updateRings(dtS: number): void {
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const ring = this.rings[i]!;
      ring.ageS += dtS;
      if (ring.ageS >= COUNTER_BURST_S) {
        ring.mesh.removeFromParent();
        ring.material.dispose();
        this.rings.splice(i, 1);
        continue;
      }
      if (ring.ageS < 0) continue;
      const t = ring.ageS / COUNTER_BURST_S;
      const ease = 1 - (1 - t) ** 3;
      const radius = COUNTER_START_RADIUS_M + (COUNTER_END_RADIUS_M - COUNTER_START_RADIUS_M) * ease;
      ring.mesh.scale.set(radius, radius, radius * Math.max(0.25, 1 - t));
      ring.mesh.visible = true;
      ring.material.opacity = ring.peak * (1 - t);
    }
  }

  private clearRings(): void {
    for (const ring of this.rings) {
      ring.mesh.removeFromParent();
      ring.material.dispose();
    }
    this.rings.length = 0;
  }
}
