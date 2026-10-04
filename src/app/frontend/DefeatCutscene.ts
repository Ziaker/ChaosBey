// ============================================================
// DEFEAT CUTSCENE (owner, 2026-10-04: "preciso que haja uma animação e cutscene de 1,5 segundos em câmera lenta do
// bey quebrando antes de definir o vencedor (a câmera lenta ocorre 60 ticks depois que o bey se quebra), é muito
// difícil saber quando ganhou ou perdeu"). For a knock-out or a spin-out (a ring-out already reads on its own):
//   1. 60 ticks (1 s): the defeated Bey's spin dies and it wobbles over;
//   2. 1.5 s in slow motion: it breaks — its parts fly apart and fall, slowed down;
//   3. then the winner is announced (the caller's `onDone`).
// Presentation only: the round's outcome is already decided and the simulation is frozen; nothing here reaches
// gameplay or the replay.
// ============================================================

import * as THREE from 'three';
import type { BeyVisual } from '../../bey/procedural-model/createBeyMesh';
import { FIXED_DELTA_SECONDS } from '../../physics/fixed-step/FixedTimestepLoop';

export const DEFEAT_PRE_BREAK_TICKS = 60;
export const DEFEAT_SLOW_MOTION_S = 1.5;
/** Game time per real second during the slow motion. */
const SLOW_MOTION_SCALE = 0.3;
const GRAVITY_MPS2 = 18;

interface Shard {
  readonly object: THREE.Object3D;
  readonly velocity: THREE.Vector3;
  readonly spin: THREE.Vector3;
}

export class DefeatCutscene {
  private elapsedS = 0;
  private phase: 'wobble' | 'break' | 'done' = 'wobble';
  private readonly pivot = new THREE.Group();
  private readonly shards: Shard[] = [];
  private spinRateRadS = 30;
  private readonly tiltAxis: THREE.Vector3;

  constructor(
    private readonly visual: BeyVisual,
    private readonly hooks: { onBreak?: () => void; onDone: () => void },
    seed = 1,
  ) {
    // Re-parent the spinning parts under a pivot the per-frame pose sync never touches.
    for (const child of [...visual.spinGroup.children]) this.pivot.add(child);
    visual.spinGroup.add(this.pivot);
    const a = (seed * 2.399963) % (Math.PI * 2);
    this.tiltAxis = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
  }

  get isDone(): boolean {
    return this.phase === 'done';
  }

  update(realDtS: number): void {
    if (this.phase === 'done') return;
    const dt = Math.min(0.1, Math.max(0, realDtS));
    this.elapsedS += dt;
    if (this.phase === 'wobble') {
      // The spin dies and the Bey keels over, wobbling.
      const u = Math.min(1, this.elapsedS / (DEFEAT_PRE_BREAK_TICKS * FIXED_DELTA_SECONDS));
      this.spinRateRadS = 30 * (1 - u) + 2;
      this.pivot.rotation.y += this.spinRateRadS * dt;
      const tilt = 0.55 * u * u + 0.12 * Math.sin(this.elapsedS * 18) * u;
      this.pivot.rotation.x = this.tiltAxis.x * tilt;
      this.pivot.rotation.z = this.tiltAxis.z * tilt;
      if (u >= 1) this.startBreak();
      return;
    }
    // Slow motion: the parts fly apart and fall.
    const gameDt = dt * SLOW_MOTION_SCALE;
    for (const s of this.shards) {
      s.velocity.y -= GRAVITY_MPS2 * gameDt;
      s.object.position.addScaledVector(s.velocity, gameDt);
      s.object.rotation.x += s.spin.x * gameDt;
      s.object.rotation.y += s.spin.y * gameDt;
      s.object.rotation.z += s.spin.z * gameDt;
    }
    if (this.elapsedS >= DEFEAT_PRE_BREAK_TICKS * FIXED_DELTA_SECONDS + DEFEAT_SLOW_MOTION_S) {
      this.phase = 'done';
      this.hooks.onDone();
    }
  }

  private startBreak(): void {
    this.phase = 'break';
    const root = this.visual.group.parent ?? this.visual.group;
    const centre = new THREE.Vector3();
    this.visual.group.getWorldPosition(centre);
    // Every part becomes a shard in world space (attach keeps where it is on screen).
    const parts: THREE.Object3D[] = [];
    this.pivot.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) parts.push(o);
    });
    let i = 0;
    for (const part of parts) {
      root.attach(part);
      const p = new THREE.Vector3();
      part.getWorldPosition(p);
      const out = p.clone().sub(centre).setY(0);
      if (out.lengthSq() < 1e-4) out.set(Math.cos(i * 2.4), 0, Math.sin(i * 2.4));
      out.normalize();
      const speed = 6 + ((i * 37) % 7);
      this.shards.push({
        object: part,
        velocity: new THREE.Vector3(out.x * speed, 7 + ((i * 13) % 5), out.z * speed),
        spin: new THREE.Vector3(6 + (i % 4) * 3, 9 - (i % 3) * 4, 5 + (i % 5) * 2),
      });
      i++;
    }
    this.hooks.onBreak?.();
  }
}
