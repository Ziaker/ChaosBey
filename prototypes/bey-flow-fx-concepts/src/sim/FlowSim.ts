// ============================================================
// BEY FLOW FX LAB — CHOREOGRAPHED MOTION
// A tiny deterministic top-view sim that only exists to give the effects
// believable motion to ride on: two Beys that circle in a parabolic bowl
// (gravity pulls them in, a weak "drive" keeps them orbiting), charge and
// Dash at each other on a schedule, and bounce off each other and the wall.
//
// This is choreography, NOT gameplay: nothing in src/ reads it, the numbers
// are not the game's, and it never decides an outcome. It is pure (no
// Three.js), so the tests can run it headless.
// ============================================================

import {
  DEFAULT_ARENA_FLOOR,
  MATCH_BOWL_DEPTH_DEFAULT_M,
  floorHeightAtRadius,
  floorSlopeAtRadius,
  type ArenaFloorSpec,
} from '../../../../src/arena/floor/ArenaFloorProfile';

// ---------------- TUNING ----------------
/** The play area (m): the game's camera never looks past ~10.5 m from the centre, so the lab keeps the fight inside it. */
export const ARENA_RADIUS_M = 10;
export const BEY_DIAMETER_M = 1.3;
const GRAVITY_SCALE = 22;            // slope pull (m/s² per unit slope) — stylised, not real gravity
const ORBIT_SPEED_MPS = 8;
const CENTRIPETAL_ASSIST = 0.85;     // share of v²/r the tip "steers" for, so orbits curve instead of drifting to the wall
const ORBIT_DRIVE_PER_S = 2.2;
const RADIUS_DRIVE_PER_S = 1.2;
const DRAG_PER_S = 0.25;
const DASH_PERIOD_S = 7;
const DASH_FIRST_S = [3, 6.5] as const;   // first Dash start per Bey (they alternate)
const CHARGE_S = 0.6;
const DASH_S = 0.55;
const DASH_SPEED_MPS = 17;
const DASH_STEER_PER_S = 12;
const CHARGE_SPEED_MPS = 3;
const WALL_MARGIN_M = 0.8;
const WALL_RESTITUTION = 0.6;
const HIT_RESTITUTION = 0.85;
const HIT_COOLDOWN_S = 0.4;
const HIT_FULL_SPEED_MPS = 16;       // closing speed that counts as magnitude 1
// -----------------------------------------

export type CalloutKind = 'hit' | 'block' | 'counter';
export const CALLOUT_CYCLE: readonly CalloutKind[] = ['hit', 'block', 'counter'];

export interface FlowBey {
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Last tick's acceleration (m/s²), for the lean. */
  ax: number;
  az: number;
  speed: number;
  /** 0..1: how much spin is left (drives the blur). */
  spin: number;
  charging: boolean;
  dashing: boolean;
  /** Unit vector toward the Dash target (the other Bey), set when a Dash starts and kept while it lasts. */
  dashDirX: number;
  dashDirZ: number;
  /**
   * Unit vector the Bey is heading: the Dash direction while it dashes (its velocity still lags that by a few ticks),
   * otherwise its velocity direction (kept while it is almost stopped). Every effect that trails behind the Bey uses this.
   */
  headX: number;
  headZ: number;
  /** Orbit direction: +1 or -1. */
  dir: 1 | -1;
}

export interface FlowEvent {
  kind: CalloutKind;
  x: number;
  z: number;
  /** 0..1 closing speed. */
  m: number;
  /** Unit vector of the attack: from the attacking Bey toward the one it hit. */
  dirX: number;
  dirZ: number;
}

/** The floor the game plays on by default: the funnel at its default depth (src/arena/floor), not a lab invention. */
export const GAME_FLOOR: ArenaFloorSpec = { id: DEFAULT_ARENA_FLOOR, depthM: MATCH_BOWL_DEPTH_DEFAULT_M };

/** Floor height at distance r from the centre (the game's own profile). */
export function floorHeight(r: number): number {
  return floorHeightAtRadius(GAME_FLOOR, r);
}

/** dh/dr (the game's own profile). */
export function floorSlope(r: number): number {
  return floorSlopeAtRadius(GAME_FLOOR, r);
}

function makeBey(angle: number, dir: 1 | -1): FlowBey {
  const r = 5;
  const x = Math.cos(angle) * r;
  const z = Math.sin(angle) * r;
  // Tangent velocity: perpendicular to the radius, sign = orbit direction.
  const vx = -Math.sin(angle) * ORBIT_SPEED_MPS * dir;
  const vz = Math.cos(angle) * ORBIT_SPEED_MPS * dir;
  return { x, z, vx, vz, ax: 0, az: 0, speed: ORBIT_SPEED_MPS, spin: 1, charging: false, dashing: false, dashDirX: -Math.cos(angle), dashDirZ: -Math.sin(angle), headX: vx / ORBIT_SPEED_MPS, headZ: vz / ORBIT_SPEED_MPS, dir };
}

export class FlowSim {
  readonly beys: [FlowBey, FlowBey] = [makeBey(0, 1), makeBey(Math.PI, -1)];
  /** Events produced by the last step (cleared each step). */
  events: FlowEvent[] = [];
  time = 0;
  /** Spin of Bey 0 (Bey 1 runs at 85% of it). Set by the page. */
  spinTarget = 1;
  /** Dashes can be turned off to look at the plain orbit. */
  dashesEnabled = true;

  private nextDashAt: [number, number] = [DASH_FIRST_S[0], DASH_FIRST_S[1]];
  private readonly phaseEnd: [number, number] = [0, 0];
  private hitCooldown = 0;
  private calloutIndex = 0;

  step(dt: number): void {
    this.events = [];
    this.time += dt;
    this.hitCooldown = Math.max(0, this.hitCooldown - dt);

    for (let i = 0; i < 2; i++) this.stepBey(i as 0 | 1, dt);
    this.collide();
    for (const b of this.beys) this.wall(b);
    this.beys[0].spin = this.spinTarget;
    this.beys[1].spin = this.spinTarget * 0.85;
    for (const b of this.beys) {
      b.speed = Math.hypot(b.vx, b.vz);
      if (b.dashing) {
        b.headX = b.dashDirX;
        b.headZ = b.dashDirZ;
      } else if (b.speed > 0.3) {
        b.headX = b.vx / b.speed;
        b.headZ = b.vz / b.speed;
      }
    }
  }

  /** Fires a callout on demand (the page's buttons), at the midpoint of the pair. */
  forceCallout(kind: CalloutKind): FlowEvent {
    const [a, b] = this.beys;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const d = Math.hypot(dx, dz) || 1;
    const e: FlowEvent = { kind, x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, m: 0.7, dirX: dx / d, dirZ: dz / d };
    this.events.push(e);
    return e;
  }

  private stepBey(i: 0 | 1, dt: number): void {
    const [first, second] = this.beys;
    const b = i === 0 ? first : second;
    const other = i === 0 ? second : first;
    const r = Math.hypot(b.x, b.z) || 1e-6;
    const rx = b.x / r;
    const rz = b.z / r;
    const tx = -rz * b.dir;
    const tz = rx * b.dir;

    // Dash schedule: charge, then dash, then back to orbiting.
    if (this.dashesEnabled && !b.charging && !b.dashing && this.time >= this.nextDashAt[i]) {
      b.charging = true;
      this.phaseEnd[i] = this.time + CHARGE_S;
    }
    if (b.charging && this.time >= this.phaseEnd[i]) {
      b.charging = false;
      b.dashing = true;
      this.phaseEnd[i] = this.time + DASH_S;
    }
    if (b.dashing && this.time >= this.phaseEnd[i]) {
      b.dashing = false;
      this.nextDashAt[i] = this.time + DASH_PERIOD_S - CHARGE_S - DASH_S;
    }

    let ax = 0;
    let az = 0;
    // Bowl: gravity pulls toward the centre in proportion to the slope.
    const pull = GRAVITY_SCALE * floorSlope(r);
    ax -= rx * pull;
    az -= rz * pull;

    if (b.dashing) {
      const dx = other.x - b.x;
      const dz = other.z - b.z;
      const d = Math.hypot(dx, dz) || 1e-6;
      b.dashDirX = dx / d;
      b.dashDirZ = dz / d;
      ax += (((dx / d) * DASH_SPEED_MPS - b.vx) * DASH_STEER_PER_S);
      az += (((dz / d) * DASH_SPEED_MPS - b.vz) * DASH_STEER_PER_S);
    } else {
      const wanted = b.charging ? CHARGE_SPEED_MPS : ORBIT_SPEED_MPS;
      const vTan = b.vx * tx + b.vz * tz;
      ax += tx * (wanted - vTan) * ORBIT_DRIVE_PER_S;
      az += tz * (wanted - vTan) * ORBIT_DRIVE_PER_S;
      const centripetal = (CENTRIPETAL_ASSIST * vTan * vTan) / Math.max(r, 1.5);
      ax -= rx * centripetal;
      az -= rz * centripetal;
      // Breathing orbit radius so the path is never a perfect circle.
      const rTarget = ARENA_RADIUS_M * (0.5 + 0.18 * Math.sin(0.4 * this.time + i * 2.1));
      ax += rx * (rTarget - r) * RADIUS_DRIVE_PER_S;
      az += rz * (rTarget - r) * RADIUS_DRIVE_PER_S;
    }
    ax -= b.vx * DRAG_PER_S;
    az -= b.vz * DRAG_PER_S;

    b.ax = ax;
    b.az = az;
    b.vx += ax * dt;
    b.vz += az * dt;
    b.x += b.vx * dt;
    b.z += b.vz * dt;
  }

  private collide(): void {
    const [a, b] = this.beys;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const d = Math.hypot(dx, dz);
    if (d >= BEY_DIAMETER_M || d < 1e-6) return;
    const nx = dx / d;
    const nz = dz / d;
    const closing = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz; // > 0 when approaching
    // The attacker is the one driving into the other faster along the line between them (read before the bounce changes it).
    const attackerSign = a.vx * nx + a.vz * nz >= -(b.vx * nx + b.vz * nz) ? 1 : -1;
    // Push apart whatever the speed.
    const overlap = (BEY_DIAMETER_M - d) / 2;
    a.x -= nx * overlap;
    a.z -= nz * overlap;
    b.x += nx * overlap;
    b.z += nz * overlap;
    if (closing <= 0) return;
    const j = ((1 + HIT_RESTITUTION) * closing) / 2;
    a.vx -= nx * j;
    a.vz -= nz * j;
    b.vx += nx * j;
    b.vz += nz * j;
    a.dashing = false;
    b.dashing = false;
    if (this.hitCooldown > 0) return;
    this.hitCooldown = HIT_COOLDOWN_S;
    const kind = CALLOUT_CYCLE[this.calloutIndex % CALLOUT_CYCLE.length]!;
    this.calloutIndex++;
    const sign = attackerSign;
    this.events.push({ kind, x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, m: Math.min(1, closing / HIT_FULL_SPEED_MPS), dirX: nx * sign, dirZ: nz * sign });
  }

  private wall(b: FlowBey): void {
    const limit = ARENA_RADIUS_M - WALL_MARGIN_M;
    const r = Math.hypot(b.x, b.z);
    if (r <= limit) return;
    const nx = b.x / r;
    const nz = b.z / r;
    b.x = nx * limit;
    b.z = nz * limit;
    const vn = b.vx * nx + b.vz * nz;
    if (vn > 0) {
      b.vx -= (1 + WALL_RESTITUTION) * vn * nx;
      b.vz -= (1 + WALL_RESTITUTION) * vn * nz;
    }
  }
}
