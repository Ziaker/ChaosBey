// ============================================================
// BEY MOTION LAB — PROTOTYPE MOTION MODEL
// A small, deterministic, hand-written model of how a spinning Bey could
// MOVE, so motion languages can be compared with live parameters. It is
// not the game's physics (the game runs Rapier with its own controllers)
// and nothing here is integrated into the game: it exists so the owner
// can pick or mix behaviors before any integration.
//
// Per Bey:
// - planar motion: thrust along the HEADING, velocity free to differ from
//   it; sideways velocity is killed by lateral grip, which breaks loose
//   (slip) above a threshold and after impacts, then recovers;
// - vertical: gravity, floor bounce, launches from knockback lift;
// - attitude: a 2D TILT vector (which way the top leans, and how far),
//   driven toward a lean target (into acceleration, with speed), pulled
//   upright by a damped spring that fades back in after impacts, with a
//   gyroscopic "precession" coupling that turns pushes into circling;
// - wobble: the game's bounded visual rock, energy from impacts;
// - whirl: rotation of the whole body about vertical (the "rodopio"),
//   from glancing impacts and hard knockbacks, damped;
// - contacts: circular wall (bounce, friction/scrape), floor, Bey-Bey
//   (restitution + tangential transfer), scripted attack knockbacks.
// Fixed substeps (1/240 s) and no randomness: every scenario replays
// exactly.
// ============================================================

import type { PhysicsParams } from './params';

export const SUBSTEP_S = 1 / 240;
export const GRAVITY = 9.81;
/** Arena (copied from the game: src/arena/colliders/ArenaTuning.ts). */
export const ARENA_RADIUS_M = 12;
export const WALL_HEIGHT_M = 2;
/** Bey collider radius (game Attack archetype: 0.65 m). */
export const BEY_RADIUS_M = 0.65;
/** Hard tilt clamp during a tumble (numerical safety). */
const TUMBLE_TILT_CLAMP_RAD = (80 * Math.PI) / 180;
/** The lab's base visual spin rate (the game's current value). */
export const BASE_SPIN_RATE_RAD_S = 22;
const SPIN_RETURN_PER_S = 0.6;
const DEG = Math.PI / 180;

export interface Vec2 {
  x: number;
  z: number;
}

export interface DriveInput {
  /** -1..1 thrust along the heading. */
  throttle: number;
  /** -1..1 turn (positive = turn right). */
  steer: number;
}

export interface BeyBody {
  readonly index: number;
  pos: Vec2;
  vel: Vec2;
  y: number;
  vy: number;
  heading: number;
  /** Tilt vector: direction the top leans toward (world XZ), magnitude = lean angle (rad). */
  tilt: Vec2;
  tiltRate: Vec2;
  /** Whole-body rotation rate about vertical (rad/s) from impacts. */
  whirl: number;
  spinRate: number;
  spinAngle: number;
  wobbleEnergy: number;
  wobblePhase: number;
  /** 0..1 lateral grip multiplier (1 = full grip). */
  grip: number;
  slipping: boolean;
  lastImpactT: number;
  tumbleUntilT: number;
  ringOut: boolean;
  // Debug
  accel: Vec2;
  steerDir: Vec2;
  contactNormal: Vec2 | null;
  contactT: number;
  scraping: boolean;
  recoveryTorque: number;
  tiltTarget: Vec2;
  lastImpactSpeed: number;
}

export interface ScriptedHit {
  /** Seconds into the scenario. */
  t: number;
  from: number;
  to: number;
  /** Knockback speed delta before knockbackScale (m/s). */
  knockback: number;
  /** Optional extra lift fraction on top of knockbackLift. */
  extraLift?: number;
}

export interface BeyInit {
  x: number;
  z: number;
  heading: number;
  speed?: number;
  /** Velocity direction if different from the heading (rad). */
  velHeading?: number;
  y?: number;
  vy?: number;
  spinRate?: number;
}

export function createBody(index: number, init: BeyInit): BeyBody {
  const vh = init.velHeading ?? init.heading;
  const s = init.speed ?? 0;
  return {
    index,
    pos: { x: init.x, z: init.z },
    vel: { x: Math.sin(vh) * s, z: Math.cos(vh) * s },
    y: init.y ?? 0,
    vy: init.vy ?? 0,
    heading: init.heading,
    tilt: { x: 0, z: 0 },
    tiltRate: { x: 0, z: 0 },
    whirl: 0,
    spinRate: init.spinRate ?? BASE_SPIN_RATE_RAD_S,
    spinAngle: index * 0.9,
    wobbleEnergy: 0,
    wobblePhase: 0,
    grip: 1,
    slipping: false,
    lastImpactT: -99,
    tumbleUntilT: -99,
    ringOut: false,
    accel: { x: 0, z: 0 },
    steerDir: { x: Math.sin(init.heading), z: Math.cos(init.heading) },
    contactNormal: null,
    contactT: -99,
    scraping: false,
    recoveryTorque: 0,
    tiltTarget: { x: 0, z: 0 },
    lastImpactSpeed: 0,
  };
}

const len = (v: Vec2) => Math.hypot(v.x, v.z);
const clampLen = (v: Vec2, max: number): Vec2 => {
  const l = len(v);
  return l > max && l > 0 ? { x: (v.x / l) * max, z: (v.z / l) * max } : v;
};
const fwdOf = (h: number): Vec2 => ({ x: Math.sin(h), z: Math.cos(h) });
/** Unit vector to the Bey's right for heading h. */
const rightOf = (h: number): Vec2 => ({ x: Math.cos(h), z: -Math.sin(h) });

export function isTumbling(b: BeyBody, t: number): boolean {
  return t < b.tumbleUntilT;
}

export function grounded(b: BeyBody): boolean {
  return b.y <= 1e-4 && Math.abs(b.vy) < 1e-3;
}

/** Everything an impact does to a body, besides the velocity change the contact itself applied. */
function applyImpact(b: BeyBody, p: PhysicsParams, t: number, pushDir: Vec2, speed: number, tangential: number, normal: Vec2 | null): void {
  if (speed <= 0.05) return;
  const kick = p.impactAngularImpulse * speed;
  b.tiltRate.x += pushDir.x * kick;
  b.tiltRate.z += pushDir.z * kick;
  b.wobbleEnergy = Math.min(1, b.wobbleEnergy + p.wobbleFromImpact * speed);
  b.grip = Math.min(b.grip, p.slipGrip);
  b.lastImpactT = t;
  b.lastImpactSpeed = speed;
  b.whirl += p.linearToAngular * tangential;
  b.spinRate += p.linearToAngular * tangential * 2;
  if (speed > p.tumbleThreshold) {
    const excess = speed - p.tumbleThreshold;
    b.whirl += p.tumbleStrength * excess * (tangential >= 0 ? 1 : -1);
    b.tiltRate.x += pushDir.x * p.tumbleStrength * excess * 0.5;
    b.tiltRate.z += pushDir.z * p.tumbleStrength * excess * 0.5;
    b.tumbleUntilT = Math.max(b.tumbleUntilT, t + 0.4 + 0.08 * excess);
  }
  if (normal) {
    b.contactNormal = normal;
    b.contactT = t;
  }
}

export class MotionWorld {
  bodies: BeyBody[] = [];
  t = 0;
  private hits: ScriptedHit[] = [];
  private hitIndex = 0;
  private readonly prevVel: Vec2[] = [];

  constructor(public params: PhysicsParams) {}

  reset(inits: readonly BeyInit[], hits: readonly ScriptedHit[]): void {
    this.bodies = inits.map((init, i) => createBody(i, init));
    this.prevVel.length = 0;
    this.bodies.forEach((b) => this.prevVel.push({ ...b.vel }));
    this.hits = [...hits].sort((a, b) => a.t - b.t);
    this.hitIndex = 0;
    this.t = 0;
  }

  /** Advance by dt seconds (split into fixed substeps) with the given per-Bey inputs. */
  advance(dt: number, inputs: (t: number, bodies: readonly BeyBody[]) => DriveInput[]): void {
    const steps = Math.round(dt / SUBSTEP_S);
    for (let s = 0; s < steps; s++) this.substep(inputs(this.t, this.bodies));
  }

  private substep(inputs: DriveInput[]): void {
    const p = this.params;
    const dt = SUBSTEP_S;
    this.t += dt;
    const t = this.t;

    // Scripted attack hits (a knockback the scenario applies, e.g. a Dash or a Circular counter landing).
    while (this.hitIndex < this.hits.length && this.hits[this.hitIndex]!.t <= t) {
      const h = this.hits[this.hitIndex++]!;
      const from = this.bodies[h.from];
      const to = this.bodies[h.to];
      if (!from || !to || to.ringOut) continue;
      let dir = { x: to.pos.x - from.pos.x, z: to.pos.z - from.pos.z };
      const l = len(dir) || 1;
      dir = { x: dir.x / l, z: dir.z / l };
      const k = h.knockback * p.knockbackScale;
      to.vel.x += dir.x * k;
      to.vel.z += dir.z * k;
      to.vy += k * (p.knockbackLift + (h.extraLift ?? 0));
      if (to.vy > 0 && to.y <= 0) to.y = 1e-3;
      const tangential = -dir.z * from.vel.x + dir.x * from.vel.z;
      applyImpact(to, p, t, dir, k, tangential * 0.25, { x: -dir.x, z: -dir.z });
    }

    this.bodies.forEach((b, i) => {
      if (b.ringOut) return;
      const input = inputs[i] ?? { throttle: 0, steer: 0 };
      const onGround = b.y <= 1e-4;

      // --- Heading: steering + whirl ---
      b.whirl *= Math.exp(-p.angularDamping * dt);
      b.whirl = Math.max(-p.maxAngularSpeed, Math.min(p.maxAngularSpeed, b.whirl));
      b.heading += (input.steer * p.turnRate + b.whirl) * dt;
      const fwd = fwdOf(b.heading);
      const right = rightOf(b.heading);
      b.steerDir = fwdOf(b.heading + input.steer * 0.6);

      // --- Planar drive, grip and slip ---
      let vLong = b.vel.x * fwd.x + b.vel.z * fwd.z;
      let vLat = b.vel.x * right.x + b.vel.z * right.z;
      const thrust = input.throttle * p.accel * (onGround ? 1 : 0.15);
      if (thrust > 0 && vLong < p.maxSpeed) vLong = Math.min(p.maxSpeed, vLong + thrust * dt);
      else if (thrust < 0) vLong += thrust * dt;
      if (onGround) {
        b.grip += (1 - b.grip) * (1 - Math.exp(-p.gripRecovery * dt));
        // Breaks loose above the threshold; re-grips only once well below it (hysteresis).
        b.slipping = b.slipping ? Math.abs(vLat) > p.slipThreshold * 0.6 : Math.abs(vLat) > p.slipThreshold;
        if (b.slipping) b.grip = Math.min(b.grip, Math.max(p.slipGrip, b.grip - 4 * dt));
        vLat *= Math.exp(-p.lateralGrip * b.grip * dt);
        if (input.throttle === 0) vLong *= Math.exp(-p.longitudinalGrip * dt);
        if (Math.abs(vLong) > p.maxSpeed) vLong -= Math.sign(vLong) * (Math.abs(vLong) - p.maxSpeed) * (1 - Math.exp(-1.5 * dt));
      } else {
        vLat *= Math.exp(-p.airGrip * dt);
        b.slipping = false;
      }
      b.vel = clampLen({ x: fwd.x * vLong + right.x * vLat, z: fwd.z * vLong + right.z * vLat }, p.maxLinearSpeed);

      // --- Vertical ---
      if (!onGround || b.vy > 0) {
        b.vy -= GRAVITY * dt;
        b.y += b.vy * dt;
        if (b.y <= 0) {
          const impact = -b.vy;
          b.y = 0;
          b.vy = impact * p.floorBounce;
          if (b.vy < 0.6) b.vy = 0;
          const v = len(b.vel);
          const dir = v > 0.1 ? { x: b.vel.x / v, z: b.vel.z / v } : fwd;
          applyImpact(b, p, t, dir, impact * 0.6, 0, { x: 0, z: 0 });
        }
      }

      // --- Position + wall ---
      b.pos.x += b.vel.x * dt;
      b.pos.z += b.vel.z * dt;
      const r = len(b.pos);
      b.scraping = false;
      if (r + BEY_RADIUS_M > ARENA_RADIUS_M) {
        const out = { x: b.pos.x / r, z: b.pos.z / r };
        if (b.y > WALL_HEIGHT_M) {
          // Above the wall: it flies over — a ring-out once fully outside.
          if (r > ARENA_RADIUS_M + BEY_RADIUS_M) b.ringOut = true;
        } else {
          const vOut = b.vel.x * out.x + b.vel.z * out.z;
          b.pos.x = out.x * (ARENA_RADIUS_M - BEY_RADIUS_M);
          b.pos.z = out.z * (ARENA_RADIUS_M - BEY_RADIUS_M);
          const tan = { x: -out.z, z: out.x };
          let vTan = b.vel.x * tan.x + b.vel.z * tan.z;
          if (vOut > 0) {
            const newOut = -vOut * p.wallBounce;
            if (vOut > 0.5) applyImpact(b, p, t, out, vOut, vTan * 0.3, { x: -out.x, z: -out.z });
            vTan *= Math.exp(-p.wallFriction * 0.05);
            b.vel = { x: out.x * newOut + tan.x * vTan, z: out.z * newOut + tan.z * vTan };
          }
          // Sliding along the wall: scrape friction.
          if (Math.abs(vTan) > 0.5) {
            b.scraping = true;
            const nv = vTan * Math.exp(-p.wallFriction * dt);
            b.vel.x += tan.x * (nv - vTan);
            b.vel.z += tan.z * (nv - vTan);
            b.contactNormal = { x: -out.x, z: -out.z };
            b.contactT = t;
            b.wobbleEnergy = Math.min(1, b.wobbleEnergy + p.wobbleFromImpact * Math.abs(vTan) * 0.02 * dt * 60);
          }
        }
      }

      // --- Measured acceleration (for lean) ---
      const pv = this.prevVel[i]!;
      const ax = (b.vel.x - pv.x) / dt;
      const az = (b.vel.z - pv.z) / dt;
      b.accel.x += (ax - b.accel.x) * (1 - Math.exp(-12 * dt));
      b.accel.z += (az - b.accel.z) * (1 - Math.exp(-12 * dt));
      this.prevVel[i] = { ...b.vel };

      // --- Tilt dynamics ---
      const maxTilt = p.maxTilt * DEG;
      const tumbling = isTumbling(b, t);
      const leanTarget = clampLen(
        {
          x: p.leanStrength * b.accel.x + p.speedTilt * b.vel.x,
          z: p.leanStrength * b.accel.z + p.speedTilt * b.vel.z,
        },
        maxTilt,
      );
      b.tiltTarget = onGround ? leanTarget : { x: 0, z: 0 };
      const since = t - b.lastImpactT;
      const recovery = p.postImpactRecovery <= 0 ? 1 : Math.min(1, 0.15 + 0.85 * (since / p.postImpactRecovery));
      const k = p.uprightStrength * recovery * (tumbling ? 0.35 : 1);
      const ex = b.tilt.x - b.tiltTarget.x;
      const ez = b.tilt.z - b.tiltTarget.z;
      let fx = -k * ex - p.recoveryDamping * b.tiltRate.x;
      let fz = -k * ez - p.recoveryDamping * b.tiltRate.z;
      // Beyond the normal clamp (and not tumbling): a stiffer stop.
      const tl = len(b.tilt);
      if (!tumbling && tl > maxTilt) {
        fx -= 3 * p.uprightStrength * (b.tilt.x / tl) * (tl - maxTilt);
        fz -= 3 * p.uprightStrength * (b.tilt.z / tl) * (tl - maxTilt);
      }
      // Gyroscopic coupling: a tilt rate is turned sideways, scaled by spin.
      const gyro = p.precession * (b.spinRate / BASE_SPIN_RATE_RAD_S);
      fx += -gyro * b.tiltRate.z;
      fz += gyro * b.tiltRate.x;
      b.recoveryTorque = Math.hypot(k * ex, k * ez);
      b.tiltRate = clampLen({ x: b.tiltRate.x + fx * dt, z: b.tiltRate.z + fz * dt }, p.maxAngularSpeed);
      b.tilt = clampLen({ x: b.tilt.x + b.tiltRate.x * dt, z: b.tilt.z + b.tiltRate.z * dt }, TUMBLE_TILT_CLAMP_RAD);

      // --- Spin and wobble ---
      b.spinRate += (BASE_SPIN_RATE_RAD_S - b.spinRate) * (1 - Math.exp(-SPIN_RETURN_PER_S * dt));
      b.spinRate = Math.max(-80, Math.min(80, b.spinRate));
      b.spinAngle += b.spinRate * dt;
      b.wobbleEnergy *= Math.exp(-p.wobbleDecay * dt);
      b.wobblePhase += p.wobbleFrequency * Math.PI * 2 * dt;
    });

    // --- Bey-Bey contact ---
    for (let i = 0; i < this.bodies.length; i++) {
      for (let j = i + 1; j < this.bodies.length; j++) {
        const a = this.bodies[i]!;
        const c = this.bodies[j]!;
        if (a.ringOut || c.ringOut || Math.abs(a.y - c.y) > 0.5) continue;
        const dx = c.pos.x - a.pos.x;
        const dz = c.pos.z - a.pos.z;
        const d = Math.hypot(dx, dz);
        if (d >= 2 * BEY_RADIUS_M || d < 1e-6) continue;
        const n = { x: dx / d, z: dz / d };
        const overlap = 2 * BEY_RADIUS_M - d;
        a.pos.x -= (n.x * overlap) / 2;
        a.pos.z -= (n.z * overlap) / 2;
        c.pos.x += (n.x * overlap) / 2;
        c.pos.z += (n.z * overlap) / 2;
        const rel = { x: c.vel.x - a.vel.x, z: c.vel.z - a.vel.z };
        const vn = rel.x * n.x + rel.z * n.z;
        if (vn >= 0) continue;
        const jImp = (-(1 + p.restitutionBey) * vn) / 2;
        a.vel.x -= n.x * jImp;
        a.vel.z -= n.z * jImp;
        c.vel.x += n.x * jImp;
        c.vel.z += n.z * jImp;
        const tangential = -n.z * rel.x + n.x * rel.z;
        const speed = -vn;
        applyImpact(a, p, t, { x: -n.x, z: -n.z }, speed, tangential * 0.5, n);
        applyImpact(c, p, t, n, speed, -tangential * 0.5, { x: -n.x, z: -n.z });
      }
    }
  }
}

/** Render attitude: up axis after tilt, for the debug "spin axis" arrow. */
export function spinAxis(b: BeyBody): { x: number; y: number; z: number } {
  const a = len(b.tilt);
  if (a < 1e-6) return { x: 0, y: 1, z: 0 };
  const dx = b.tilt.x / a;
  const dz = b.tilt.z / a;
  return { x: dx * Math.sin(a), y: Math.cos(a), z: dz * Math.sin(a) };
}

export const tiltAngle = (b: BeyBody) => len(b.tilt);
