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
import { arenaFloorRadius } from '../../arena/colliders/ArenaTuning';

// Owner, 2026-10-04: 60 → 90 ticks (+0.5 s) — see the Bey bounce or fly, and THEN explode.
export const DEFEAT_PRE_BREAK_TICKS = 90;
export const DEFEAT_SLOW_MOTION_S = 1.5;
/** Game time per real second during the slow motion (0.3 left the pieces hanging in the air: 0.45 s of fall in 1.5 s). */
const SLOW_MOTION_SCALE = 0.45;
/** After the slow motion the pieces keep falling and bouncing at normal speed until they settle (owner, 2026-10-04: "a
 * animação das peças se espalhando ainda fica travada no ar"). */
const SETTLE_LIMIT_S = 4;
const GRAVITY_MPS2 = 26;
/** Flight speeds above this are clamped (a knock-out at 40 m/s would leave the screen at once). */
const MAX_FLIGHT_MPS = 22;

interface Shard {
  readonly object: THREE.Object3D;
  readonly velocity: THREE.Vector3;
  readonly spin: THREE.Vector3;
  /** How far the piece's lowest point sits below its origin (m), so it rests ON the floor, not through it. */
  readonly below: number;
  /** Its horizontal reach from its origin (m), so it stays inside the wall. */
  readonly reach: number;
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
  /** Real seconds the pieces have kept falling after the slow motion. */
  private settleS = 0;
  private readonly focus = new THREE.Vector3();
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

  /**
   * Where the camera should look (world space): the flying Bey, then the middle of its scattering pieces. Owner,
   * 2026-10-04: "o bey sai da câmera quando é derrotado e explode […] é pra câmera seguir o bey sendo destruído".
   */
  focusPoint(): THREE.Vector3 {
    if (this.shards.length === 0) return this.focus.copy(this.position);
    this.focus.set(0, 0, 0);
    const p = new THREE.Vector3();
    for (const s of this.shards) this.focus.add(s.object.getWorldPosition(p));
    return this.focus.multiplyScalar(1 / this.shards.length);
  }

  update(realDtS: number): void {
    const dt = Math.min(0.1, Math.max(0, realDtS));
    if (this.phase === 'done') {
      // The winner is announced; the pieces keep falling at normal speed until they settle (never frozen mid-air).
      if (this.settleS < SETTLE_LIMIT_S) {
        this.settleS += dt;
        this.stepShards(dt);
      }
      return;
    }
    this.elapsedS += dt;
    if (this.phase === 'flight') {
      this.stepFlight(dt);
      if (this.elapsedS >= DEFEAT_PRE_BREAK_TICKS * FIXED_DELTA_SECONDS) this.startBreak();
      return;
    }
    // Slow motion: the four pieces fly apart and fall.
    this.stepShards(dt * SLOW_MOTION_SCALE);
    if (this.elapsedS >= DEFEAT_PRE_BREAK_TICKS * FIXED_DELTA_SECONDS + DEFEAT_SLOW_MOTION_S) {
      this.phase = 'done';
      this.options.onDone();
    }
  }

  private stepShards(gameDt: number): void {
    for (const s of this.shards) {
      s.velocity.y -= GRAVITY_MPS2 * gameDt;
      s.object.position.addScaledVector(s.velocity, gameDt);
      // Owner, 2026-10-04 ("as peças estão passando por dentro do stage"): each piece rests on the floor by its own
      // lowest point (not its origin, the Bey's centre) and bounces off the wall.
      const floor = this.options.floorHeightAt(s.object.position.x, s.object.position.z) + s.below + 0.02;
      if (s.object.position.y < floor) {
        s.object.position.y = floor;
        s.velocity.y = Math.abs(s.velocity.y) * 0.35;
        if (s.velocity.y < 0.8) s.velocity.y = 0; // settled: no endless micro-bounces
        s.velocity.x *= 0.7;
        s.velocity.z *= 0.7;
      }
      const wall = arenaFloorRadius() - s.reach - 0.1;
      const r = Math.hypot(s.object.position.x, s.object.position.z);
      if (r > wall && r > 1e-6) {
        const nx = s.object.position.x / r;
        const nz = s.object.position.z / r;
        s.object.position.x = nx * wall;
        s.object.position.z = nz * wall;
        const out = s.velocity.x * nx + s.velocity.z * nz;
        if (out > 0) {
          s.velocity.x -= 1.6 * out * nx;
          s.velocity.z -= 1.6 * out * nz;
        }
      }
      s.object.rotation.x += s.spin.x * gameDt;
      s.object.rotation.y += s.spin.y * gameDt;
      s.object.rotation.z += s.spin.z * gameDt;
      // Resting on the floor: the spin dies out too.
      if (s.object.position.y <= floor + 0.01 && Math.abs(s.velocity.y) < 1) s.spin.multiplyScalar(Math.exp(-3 * gameDt));
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
    // Owner, 2026-10-04 ("é pra continuar voando quando é destruído"): the pieces keep the flight's whole velocity.
    const carry = this.flying ? this.velocity.clone() : new THREE.Vector3();
    pieces.forEach((piece, i) => {
      root.attach(piece);
      piece.updateWorldMatrix(true, true);
      const box = new THREE.Box3().setFromObject(piece);
      const below = Number.isFinite(box.min.y) ? Math.max(0, piece.position.y - box.min.y) : 0.2;
      const reach = Number.isFinite(box.min.x) ? Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2 : 0.4;
      const a = (i / Math.max(1, pieces.length)) * Math.PI * 2 + 0.6;
      const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const speed = 4 + (i % 2) * 1.5;
      this.shards.push({
        object: piece,
        velocity: new THREE.Vector3(out.x * speed, 6 + i * 1.2, out.z * speed).add(carry),
        spin: new THREE.Vector3(5 + i * 2.5, 8 - i * 2, 4 + i * 1.5),
        below,
        reach,
      });
    });
    this.options.onBreak?.();
  }
}
