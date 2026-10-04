// ============================================================
// DEFEAT CUTSCENE (owner, 2026-10-04): "era para, caso de KO em colisão, o bey sair voando E depois se destruir E
// depois ocorrer a câmera lenta das 4 peças se espalhando na destruição". For a knock-out or a spin-out (a ring-out
// already reads on its own):
//   1. 60 ticks (1 s): the defeated Bey flies off with the knock-out hit's velocity (tumbling, bouncing on the
//      floor); after a spin-out (no hit) its spin dies and it keels over;
//   2. it is destroyed: its four pieces (driver, disc, ring, top layer) burst apart, 1.5 s in slow motion;
//   3. then the winner is announced (the caller's `onDone`).
// The Bey's own effects (spin blur, auras, trails) are switched off by the caller. Presentation only: the outcome is
// decided and the simulation frozen; nothing here reaches gameplay or the replay.
// ============================================================

import * as THREE from 'three';
import type { BeyVisual } from '../../bey/procedural-model/createBeyMesh';
import { PIECE_ORDER } from '../../bey/visual/model/assembleConcept';
import { FIXED_DELTA_SECONDS } from '../../physics/fixed-step/FixedTimestepLoop';

export const DEFEAT_PRE_BREAK_TICKS = 60;
export const DEFEAT_SLOW_MOTION_S = 1.5;
/** Game time per real second during the slow motion. */
const SLOW_MOTION_SCALE = 0.3;
const GRAVITY_MPS2 = 26;
/** Flight speeds above this are clamped (a knock-out at 40 m/s would leave the screen at once). */
const MAX_FLIGHT_MPS = 22;

interface Shard {
  readonly object: THREE.Object3D;
  readonly velocity: THREE.Vector3;
  readonly spin: THREE.Vector3;
}

export interface DefeatCutsceneOptions {
  readonly visual: BeyVisual;
  /** The defeated Bey's velocity when the round ended (the knock-out hit's knockback); zero for a spin-out. */
  readonly launchVelocity: { x: number; y: number; z: number };
  readonly floorHeightAt: (x: number, z: number) => number;
  readonly onBreak?: () => void;
  readonly onDone: () => void;
  readonly seed?: number;
}

export class DefeatCutscene {
  private elapsedS = 0;
  private phase: 'flight' | 'break' | 'done' = 'flight';
  private readonly pivot = new THREE.Group();
  private readonly shards: Shard[] = [];
  private readonly start = new THREE.Vector3();
  private readonly position = new THREE.Vector3();
  private readonly velocity: THREE.Vector3;
  private readonly groundOffset: number;
  private readonly tumbleAxis: THREE.Vector3;
  private readonly flying: boolean;
  private tumble = 0;
  private spinAngle = 0;

  constructor(private readonly options: DefeatCutsceneOptions) {
    const { visual } = options;
    // Re-parent the spinning parts under a pivot the per-frame pose sync never touches.
    for (const child of [...visual.spinGroup.children]) this.pivot.add(child);
    visual.spinGroup.add(this.pivot);
    visual.spinGroup.updateWorldMatrix(true, false);
    visual.spinGroup.getWorldPosition(this.start);
    this.position.copy(this.start);
    const v = new THREE.Vector3(options.launchVelocity.x, options.launchVelocity.y, options.launchVelocity.z);
    if (v.length() > MAX_FLIGHT_MPS) v.setLength(MAX_FLIGHT_MPS);
    this.flying = v.length() > 2;
    // A knock-out always reads as a launch: at least a clear upward pop.
    if (this.flying) v.y = Math.max(v.y, 7);
    this.velocity = v;
    this.groundOffset = this.start.y - options.floorHeightAt(this.start.x, this.start.z);
    const h = Math.hypot(v.x, v.z);
    this.tumbleAxis = h > 0.1 ? new THREE.Vector3(v.z / h, 0, -v.x / h) : new THREE.Vector3(1, 0, 0);
  }

  get isDone(): boolean {
    return this.phase === 'done';
  }

  update(realDtS: number): void {
    if (this.phase === 'done') return;
    const dt = Math.min(0.1, Math.max(0, realDtS));
    this.elapsedS += dt;
    if (this.phase === 'flight') {
      this.stepFlight(dt);
      if (this.elapsedS >= DEFEAT_PRE_BREAK_TICKS * FIXED_DELTA_SECONDS) this.startBreak();
      return;
    }
    // Slow motion: the four pieces fly apart and fall.
    const gameDt = dt * SLOW_MOTION_SCALE;
    for (const s of this.shards) {
      s.velocity.y -= GRAVITY_MPS2 * gameDt;
      s.object.position.addScaledVector(s.velocity, gameDt);
      const floor = this.options.floorHeightAt(s.object.position.x, s.object.position.z) + 0.05;
      if (s.object.position.y < floor) {
        s.object.position.y = floor;
        s.velocity.y = Math.abs(s.velocity.y) * 0.35;
        s.velocity.x *= 0.7;
        s.velocity.z *= 0.7;
      }
      s.object.rotation.x += s.spin.x * gameDt;
      s.object.rotation.y += s.spin.y * gameDt;
      s.object.rotation.z += s.spin.z * gameDt;
    }
    if (this.elapsedS >= DEFEAT_PRE_BREAK_TICKS * FIXED_DELTA_SECONDS + DEFEAT_SLOW_MOTION_S) {
      this.phase = 'done';
      this.options.onDone();
    }
  }

  private stepFlight(dt: number): void {
    const spinGroup = this.options.visual.spinGroup;
    if (this.flying) {
      // Ballistic flight with the hit's velocity, bouncing on the floor, tumbling over.
      this.velocity.y -= GRAVITY_MPS2 * dt;
      this.position.addScaledVector(this.velocity, dt);
      const ground = this.options.floorHeightAt(this.position.x, this.position.z) + this.groundOffset;
      if (this.position.y < ground) {
        this.position.y = ground;
        this.velocity.y = Math.abs(this.velocity.y) * 0.4;
        this.velocity.x *= 0.6;
        this.velocity.z *= 0.6;
      }
      this.tumble += (8 + this.velocity.length() * 0.5) * dt;
    } else {
      // Spin-out: the spin dies and it keels over.
      const u = Math.min(1, this.elapsedS / (DEFEAT_PRE_BREAK_TICKS * FIXED_DELTA_SECONDS));
      this.tumble = 0.6 * u * u + 0.12 * Math.sin(this.elapsedS * 18) * u;
    }
    this.spinAngle += (this.flying ? 25 : 30 * (1 - Math.min(1, this.elapsedS)) + 2) * dt;
    spinGroup.updateWorldMatrix(true, false);
    this.pivot.position.copy(spinGroup.worldToLocal(this.position.clone()));
    this.pivot.quaternion.setFromAxisAngle(this.tumbleAxis, this.tumble).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.spinAngle));
  }

  private startBreak(): void {
    this.phase = 'break';
    const root = this.options.visual.group.parent ?? this.options.visual.group;
    this.pivot.updateWorldMatrix(true, true);
    const centre = new THREE.Vector3();
    this.pivot.getWorldPosition(centre);
    // The four pieces of an approved model; any other visual breaks into its top-level parts.
    let pieces: THREE.Object3D[] = PIECE_ORDER.map((name) => this.pivot.getObjectByName(name)).filter((o): o is THREE.Object3D => !!o);
    if (pieces.length === 0) {
      pieces = [];
      this.pivot.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) pieces.push(o);
      });
    }
    const carry = this.flying ? this.velocity.clone().multiplyScalar(0.25) : new THREE.Vector3();
    pieces.forEach((piece, i) => {
      root.attach(piece);
      const a = (i / Math.max(1, pieces.length)) * Math.PI * 2 + 0.6;
      const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const speed = 4 + (i % 2) * 1.5;
      this.shards.push({
        object: piece,
        velocity: new THREE.Vector3(out.x * speed, 6 + i * 1.2, out.z * speed).add(carry),
        spin: new THREE.Vector3(5 + i * 2.5, 8 - i * 2, 4 + i * 1.5),
      });
    });
    this.options.onBreak?.();
  }
}
