// ============================================================
// RAIL COURSE LAB — RIDE PREVIEW
// A tiny pure kinematic model of one Bey riding a course, so the owner can SEE where a ride goes and where it ends. It is the
// rule set the prototype proposes, NOT the game's RailController: grab at a gate, accelerate along the route with the rail
// speed law (RAIL_TUNING), leave at the far gate along the route's tangent, and a Jump press that leaves early
//   - INSIDE the wall: launches the Bey along the route, back into the arena;
//   - OUTSIDE the wall: turns the Bey round and carries it back along the SAME route to the gate it came in by
//     ("o caminho de ida e de volta são os mesmos").
// After leaving, the Bey flies ballistically (the game's gravity) until it meets the floor, then the lab restarts the ride.
// Nothing in src/ reads this.
// ============================================================

import { floorHeightAt, type ArenaFloor } from '../../../../src/arena/floor/ArenaFloorProfile';
import type { RailDefinition } from '../../../../src/arena/rails/RailBlueprint';
import { RAIL_TUNING } from '../../../../src/arena/rails/RailTraversal';
import { GRAVITY_Y } from '../../../../src/physics/world/PhysicsWorld';
import { GRAVITY_SCALE_DEFAULT } from '../../../../src/config/match/MatchConfig';

// ---------------- TUNING (lab) ----------------
/** Lift added when a Jump press leaves inside the wall (m/s): the short hop's launch (≈ √(2·g·0.12 m… as the game). */
export const EARLY_EXIT_LIFT_MPS = 3;
/** Seconds the Bey rests on the floor after a landing before the ride restarts. */
export const LANDED_REST_S = 1;
/** A flight longer than this is cut (the lab never waits on a Bey that flew off the stage). */
export const MAX_FLIGHT_S = 4;
// -----------------------------------------------

export type RidePhase = 'riding' | 'returning' | 'flying' | 'resting';
export type RideEnd = 'end' | 'jump-inside' | 'jump-outside-back';

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

export class RideSim {
  phase: RidePhase = 'riding';
  progressM = 0;
  /** +1 = from the first gate to the last, -1 = the other way. */
  direction: 1 | -1 = 1;
  speedMps = RAIL_TUNING.startSpeedMps;
  timeS = 0;
  position: Point3 = { x: 0, y: 0, z: 0 };
  velocity: Point3 = { x: 0, y: 0, z: 0 };
  lastEnd: RideEnd | null = null;
  /** Where the last flight touched the floor (for the lab's readout). */
  landing: Point3 | null = null;
  private restS = 0;
  private flightS = 0;

  constructor(
    private rail: RailDefinition,
    private readonly floor: ArenaFloor,
    private readonly floorRadiusM: number,
    private readonly pingPong: () => boolean,
  ) {
    this.start(1);
  }

  setRail(rail: RailDefinition): void {
    this.rail = rail;
    this.start(1);
  }

  /** Starts a fresh ride at a gate (the first when `direction` is +1, the last when -1). */
  start(direction: 1 | -1): void {
    this.phase = 'riding';
    this.direction = direction;
    this.progressM = direction === 1 ? 0 : this.rail.path.lengthM;
    this.speedMps = RAIL_TUNING.startSpeedMps;
    this.timeS = 0;
    this.lastEnd = null;
    this.restS = 0;
    this.flightS = 0;
    this.pose();
  }

  private pose(): void {
    const s = this.rail.path.sampleAt(this.progressM);
    this.position = { x: s.position.x, y: s.position.y, z: s.position.z };
  }

  /** Is the Bey inside the wall right now? */
  get insideWall(): boolean {
    return Math.hypot(this.position.x, this.position.z) < this.floorRadiusM;
  }

  /** A Jump press. Does nothing off the rail or while already coming back. */
  jump(): void {
    if (this.phase !== 'riding') return;
    if (this.insideWall) {
      const tangent = this.rail.path.sampleAt(this.progressM).tangent;
      this.leave(tangent, 'jump-inside', EARLY_EXIT_LIFT_MPS);
    } else {
      this.direction = this.direction === 1 ? -1 : 1;
      this.phase = 'returning';
      this.lastEnd = 'jump-outside-back';
    }
  }

  private leave(tangent: Point3, end: RideEnd, lift: number): void {
    const k = this.speedMps * RAIL_TUNING.exitSpeedCarry * this.direction;
    this.velocity = { x: tangent.x * k, y: tangent.y * k + lift, z: tangent.z * k };
    this.phase = 'flying';
    this.lastEnd = end;
    this.flightS = 0;
    this.landing = null;
  }

  step(dt: number): void {
    this.timeS += dt;
    if (this.phase === 'riding' || this.phase === 'returning') {
      this.speedMps = Math.min(
        RAIL_TUNING.maxSpeedMps,
        this.speedMps < RAIL_TUNING.targetSpeedMps ? Math.min(RAIL_TUNING.targetSpeedMps, this.speedMps + RAIL_TUNING.accelerationMps2 * dt) : this.speedMps,
      );
      this.progressM += this.direction * this.speedMps * dt;
      const length = this.rail.path.lengthM;
      if (this.progressM >= length || this.progressM <= 0) {
        this.progressM = Math.min(length, Math.max(0, this.progressM));
        const tangent = this.rail.path.sampleAt(this.progressM).tangent;
        const end: RideEnd = this.phase === 'returning' ? 'jump-outside-back' : 'end';
        this.pose();
        this.leave(tangent, end, 0);
        this.lastEnd = end;
        return;
      }
      this.pose();
      return;
    }
    if (this.phase === 'flying') {
      const g = GRAVITY_Y * GRAVITY_SCALE_DEFAULT;
      this.velocity.y += g * dt;
      this.position = { x: this.position.x + this.velocity.x * dt, y: this.position.y + this.velocity.y * dt, z: this.position.z + this.velocity.z * dt };
      this.flightS += dt;
      const floorY = floorHeightAt(this.floor, this.position.x, this.position.z);
      const r = Math.hypot(this.position.x, this.position.z);
      if ((this.position.y <= floorY && r <= this.floorRadiusM) || this.flightS >= MAX_FLIGHT_S || this.position.y < floorY - 6) {
        this.landing = { x: this.position.x, y: Math.max(this.position.y, floorY), z: this.position.z };
        this.phase = 'resting';
        this.restS = 0;
      }
      return;
    }
    this.restS += dt;
    if (this.restS >= LANDED_REST_S) {
      // The ride restarts at a gate; with ping-pong it alternates ends, to show that either gate is an entrance.
      const next: 1 | -1 = this.pingPong() ? (this.direction === 1 ? -1 : 1) : 1;
      this.start(next);
    }
  }
}
