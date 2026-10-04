// ============================================================
// DEFEAT CUTSCENE (owner, 2026-10-04): "era para, caso de KO em colisão, o bey sair voando E depois se destruir E
// depois ocorrer a câmera lenta das 4 peças se espalhando na destruição". For a knock-out or a spin-out (a ring-out
// already reads on its own):
//   1. 90 ticks (1.5 s): the defeated Bey flies off with the knock-out hit's velocity — or, knocked out without being
//      thrown far, pops up and bounces — tumbling, bouncing on the floor and off the wall; after a spin-out (no hit)
//      its spin dies and it keels over onto the floor;
//   2. it is destroyed: its four pieces (driver, disc, ring, top layer) burst apart, 1.5 s in slow motion;
//   3. then the winner is announced (the caller's `onDone`); the pieces keep falling, bouncing and sliding down the
//      funnel until they settle.
// Owner, 2026-10-04: "o bey passa por dentro do estágio quando é derrotado ao invés de ficar quicando caso não seja
// jogado pra longe". Every contact is taken against the real extent of the (tumbling) model — its rotated bounding box
// — never against its centre, so a Bey on its side rests ON the floor. Gravity is the match's own (its gravity scale).
// The cutscene runs on real time (the Game speed slider does not shorten it). The Bey's own effects (spin blur, auras,
// trails) are switched off by the caller. Presentation only: the outcome is decided and the simulation frozen;
// nothing here reaches gameplay or the replay.
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
/** After the slow motion the pieces keep falling, bouncing and sliding at normal speed until they settle. */
const SETTLE_LIMIT_S = 6;
/** Real gravity (m/s²); × the match's gravity scale. */
const BASE_GRAVITY_MPS2 = 9.81;
/** Flight speeds above this are clamped (a knock-out at 40 m/s would leave the screen at once). */
const MAX_FLIGHT_MPS = 22;
/** A knock-out without a real throw still pops up this fast, so it bounces instead of sliding into the floor. */
const MIN_KO_POP_MPS = 6;
/** Vertical bounce kept on each floor hit; below BOUNCE_STOP_MPS it stops bouncing and rests. */
const BEY_BOUNCE = 0.45;
const PIECE_BOUNCE = 0.35;
const BOUNCE_STOP_MPS = 1.2;
/** Horizontal speed kept on a floor hit, and per second while resting/sliding on the floor. */
const FLOOR_HIT_KEEP = 0.75;
const FLOOR_FRICTION_PER_S = 1.6;
/** Bounce off the wall: share of the outward speed reflected. */
const WALL_BOUNCE = 0.6;

interface Shard {
  readonly object: THREE.Object3D;
  readonly velocity: THREE.Vector3;
  readonly spin: THREE.Vector3;
  resting: boolean;
}

export interface DefeatCutsceneOptions {
  readonly visual: BeyVisual;
  /** The defeated Bey's velocity when the round ended (the knock-out hit's knockback). */
  readonly launchVelocity: { x: number; y: number; z: number };
  /** True for a knock-out (it is thrown / pops up and bounces); false for a spin-out (it keels over). */
  readonly knockedOut?: boolean;
  readonly floorHeightAt: (x: number, z: number) => number;
  /** MatchConfig.gravityScale (1 = real gravity). */
  readonly gravityScale?: number;
  readonly onBreak?: () => void;
  readonly onDone: () => void;
  readonly seed?: number;
}

const box = new THREE.Box3();

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
  private readonly tumbleAxis: THREE.Vector3;
  private readonly knockedOut: boolean;
  private readonly gravity: number;
  /** Horizontal half-extent of the model (m), for the wall. */
  private readonly reach: number;
  private tumble = 0;
  private tumbleRate: number;
  private spinAngle = 0;
  private resting = false;

  constructor(private readonly options: DefeatCutsceneOptions) {
    const { visual } = options;
    // Re-parent the spinning parts under a pivot the per-frame pose sync never touches.
    for (const child of [...visual.spinGroup.children]) this.pivot.add(child);
    visual.spinGroup.add(this.pivot);
    visual.spinGroup.updateWorldMatrix(true, false);
    visual.spinGroup.getWorldPosition(this.start);
    this.position.copy(this.start);
    this.gravity = BASE_GRAVITY_MPS2 * (options.gravityScale ?? 1);
    this.pivot.updateWorldMatrix(true, true);
    box.setFromObject(this.pivot);
    this.reach = Number.isFinite(box.min.x) ? Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2 : 0.6;

    const v = new THREE.Vector3(options.launchVelocity.x, options.launchVelocity.y, options.launchVelocity.z);
    if (v.length() > MAX_FLIGHT_MPS) v.setLength(MAX_FLIGHT_MPS);
    // Back-compatible: no flag = a knock-out when it was really thrown.
    this.knockedOut = options.knockedOut ?? v.length() > 2;
    // A knock-out always reads as a launch: at least a clear upward pop, even when it was not thrown far.
    if (this.knockedOut) v.y = Math.max(v.y, v.length() > 2 ? 7 : MIN_KO_POP_MPS);
    else v.set(0, 0, 0);
    this.velocity = v;
    const h = Math.hypot(v.x, v.z);
    this.tumbleAxis = h > 0.1 ? new THREE.Vector3(v.z / h, 0, -v.x / h) : new THREE.Vector3(1, 0, 0.35).normalize();
    this.tumbleRate = this.knockedOut ? 8 + v.length() * 0.5 : 0;
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

  /** `realDtS`: real seconds (not scaled by the Game speed slider). */
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

  private stepFlight(dt: number): void {
    const spinGroup = this.options.visual.spinGroup;
    if (this.knockedOut) {
      if (!this.resting) this.velocity.y -= this.gravity * dt;
      this.position.addScaledVector(this.velocity, dt);
      this.tumble += this.tumbleRate * dt;
    } else {
      // Spin-out: the spin dies and it keels over onto its side.
      const u = Math.min(1, this.elapsedS / (DEFEAT_PRE_BREAK_TICKS * FIXED_DELTA_SECONDS * 0.7));
      this.tumble = 1.25 * u * u + 0.1 * Math.sin(this.elapsedS * 18) * (1 - u);
      this.velocity.y -= this.gravity * dt;
      this.position.addScaledVector(this.velocity, dt);
    }
    this.spinAngle += (this.knockedOut ? 25 : 30 * (1 - Math.min(1, this.elapsedS)) + 2) * dt;
    this.wallBounce(this.position, this.velocity, this.reach);
    this.pose(spinGroup);
    // The floor, against the tumbled model's real lowest point.
    this.pivot.updateWorldMatrix(true, true);
    box.setFromObject(this.pivot);
    if (!Number.isFinite(box.min.y)) return;
    const floor = this.options.floorHeightAt(this.position.x, this.position.z);
    const sink = floor - box.min.y;
    if (sink > 0) {
      this.position.y += sink;
      if (this.velocity.y < 0) {
        const up = -this.velocity.y * BEY_BOUNCE;
        this.velocity.y = up > BOUNCE_STOP_MPS ? up : 0;
        this.velocity.x *= FLOOR_HIT_KEEP;
        this.velocity.z *= FLOOR_HIT_KEEP;
        this.tumbleRate *= 0.7;
        this.resting = this.velocity.y === 0;
      }
      this.pose(spinGroup);
    }
    if (this.resting) {
      const k = Math.exp(-FLOOR_FRICTION_PER_S * dt);
      this.velocity.x *= k;
      this.velocity.z *= k;
      this.tumbleRate *= k;
      // Stay in contact on the slope as it slides (re-checked next frame).
      this.velocity.y = -0.5;
    }
  }

  private pose(spinGroup: THREE.Object3D): void {
    spinGroup.updateWorldMatrix(true, false);
    this.pivot.position.copy(spinGroup.worldToLocal(this.position.clone()));
    this.pivot.quaternion.setFromAxisAngle(this.tumbleAxis, this.tumble).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.spinAngle));
  }

  /** Keeps a body of horizontal half-extent `reach` inside the arena wall, bouncing off it. */
  private wallBounce(position: THREE.Vector3, velocity: THREE.Vector3, reach: number): void {
    const wall = arenaFloorRadius() - reach - 0.1;
    const r = Math.hypot(position.x, position.z);
    if (r <= wall || r < 1e-6) return;
    const nx = position.x / r;
    const nz = position.z / r;
    position.x = nx * wall;
    position.z = nz * wall;
    const out = velocity.x * nx + velocity.z * nz;
    if (out > 0) {
      velocity.x -= (1 + WALL_BOUNCE) * out * nx;
      velocity.z -= (1 + WALL_BOUNCE) * out * nz;
    }
  }

  private stepShards(gameDt: number): void {
    const g = this.gravity;
    for (const s of this.shards) {
      const o = s.object;
      if (!s.resting) s.velocity.y -= g * gameDt;
      o.position.addScaledVector(s.velocity, gameDt);
      o.rotation.x += s.spin.x * gameDt;
      o.rotation.y += s.spin.y * gameDt;
      o.rotation.z += s.spin.z * gameDt;
      o.updateWorldMatrix(true, true);
      box.setFromObject(o);
      const reach = Number.isFinite(box.min.x) ? Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2 : 0.3;
      this.wallBounce(o.position, s.velocity, reach);
      if (!Number.isFinite(box.min.y)) continue;
      // Owner, 2026-10-04 ("as peças estão passando por dentro do stage"): each piece rests on the floor by its own
      // (rotated) lowest point, and bounces.
      const floor = this.options.floorHeightAt(o.position.x, o.position.z);
      const sink = floor - box.min.y;
      if (sink > 0) {
        o.position.y += sink;
        if (s.velocity.y < 0) {
          const up = -s.velocity.y * PIECE_BOUNCE;
          s.velocity.y = up > BOUNCE_STOP_MPS ? up : 0;
          s.velocity.x *= FLOOR_HIT_KEEP;
          s.velocity.z *= FLOOR_HIT_KEEP;
          s.spin.multiplyScalar(0.6);
          s.resting = s.velocity.y === 0;
        }
      }
      if (s.resting) {
        // On the floor: it slides down the funnel's slope (gravity along the slope) against friction, and its tumble
        // dies out; it keeps hugging the floor.
        const e = 0.25;
        const gx = (this.options.floorHeightAt(o.position.x + e, o.position.z) - this.options.floorHeightAt(o.position.x - e, o.position.z)) / (2 * e);
        const gz = (this.options.floorHeightAt(o.position.x, o.position.z + e) - this.options.floorHeightAt(o.position.x, o.position.z - e)) / (2 * e);
        const along = g / (1 + gx * gx + gz * gz);
        s.velocity.x -= gx * along * gameDt;
        s.velocity.z -= gz * along * gameDt;
        const k = Math.exp(-FLOOR_FRICTION_PER_S * gameDt);
        s.velocity.x *= k;
        s.velocity.z *= k;
        s.spin.multiplyScalar(Math.exp(-3 * gameDt));
        s.velocity.y = -0.5;
      }
    }
  }

  private startBreak(): void {
    this.phase = 'break';
    const root = this.options.visual.group.parent ?? this.options.visual.group;
    this.pivot.updateWorldMatrix(true, true);
    // The four pieces of an approved model; any other visual breaks into its top-level parts.
    let pieces: THREE.Object3D[] = PIECE_ORDER.map((name) => this.pivot.getObjectByName(name)).filter((o): o is THREE.Object3D => !!o);
    if (pieces.length === 0) {
      pieces = [];
      this.pivot.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) pieces.push(o);
      });
    }
    // Owner, 2026-10-04 ("é pra continuar voando quando é destruído"): the pieces keep the flight's velocity.
    const carry = this.velocity.clone();
    if (this.resting) carry.y = 0;
    pieces.forEach((piece, i) => {
      root.attach(piece);
      const a = (i / Math.max(1, pieces.length)) * Math.PI * 2 + 0.6;
      const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const speed = 4 + (i % 2) * 1.5;
      this.shards.push({
        object: piece,
        velocity: new THREE.Vector3(out.x * speed, 6 + i * 1.2, out.z * speed).add(carry),
        spin: new THREE.Vector3(5 + i * 2.5, 8 - i * 2, 4 + i * 1.5),
        resting: false,
      });
    });
    this.options.onBreak?.();
  }
}
