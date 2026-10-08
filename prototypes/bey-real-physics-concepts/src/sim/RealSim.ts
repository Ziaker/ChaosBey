// ============================================================
// BEY REAL LAB — THE SIMULATION
// A small deterministic top-view physics model of the alternative "Bey Real" mode, for judging the FEEL of
// four ideas together before anything touches the game's Rapier world:
//
//   1. REALISTIC PHYSICS. Velocity is state. What moves a Bey is the bowl (gravity along the funnel's slope),
//      a low tip friction, the curve the spin gives its path (precession), the wobble of a tired spin, and
//      collisions. A hit exchanges momentum along the contact normal AND, through rim friction, sideways
//      momentum and spin: two tops spinning the same way grind each other down, two spinning opposite ways
//      mesh. Spin (Stamina) only goes down; it is spent by speed, steering, hitting and being hit.
//   2. AUTOMATIC MOVEMENT. An autopilot steers the Bey (orbit, a little pursuit, keep off the wall). The player's
//      stick only takes `influence` of the steering (the references: ~30%); with no stick the autopilot steers alone.
//      Steering is limited by grip, which a tired or broken Bey loses.
//   3. FOUR MANUAL ACTIONS. Hold + release = Dash Attack (turns to the opponent at once, then locks on at 5 rad/s);
//      tap = Circular (defensive, launches whoever touches it); jump (no steering in the air: you pick the moment);
//      dodge (fixed burst, i-frames, perfect-dodge window). The numbers are the game's own (AttackTuning, DodgeTuning).
//   4. THE ROUND. Ring-out (over the wall), spin-out (Stamina at 0), KO (a hit on a Broken Bey), or a time limit.
//
// This is a lab model, NOT the game: nothing in src/ reads it, the numbers are proposals, and it is pure (no
// Three.js) so the tests and the headless calibration can run it. Both Beys are driven the same way: the player's
// Bey by the lab's keyboard, the opponent (or both, in demo mode) by the same autopilot plus a small decision AI.
// ============================================================

import { TAP_MAX_HOLD_S, DASH_MIN_CHARGE_S, HITBOX_VERTICAL_REACH_M } from '../../../../src/combat/attacks/AttackTuning';
import { BEY_DIAMETER_M, floorSlope, type CalloutKind, type FlowBey, type FlowEvent, type StageNote, type StageSim } from '../../../bey-flow-fx-concepts/src/sim/FlowSim';
import { PARAMS, type RealParams } from '../tuning';

// ---------------- MODEL CONSTANTS (not sliders) ----------------
export const BEY_RADIUS_M = BEY_DIAMETER_M / 2;
const SUBSTEPS = 2;
const RIM_SPEED_MPS = 10;             // the speed of the rim at full spin (for the contact friction)
const SPIN_OUT_AT = 0.02;
const GRIP_FULL_SPIN = 0.25;          // below this spin the Bey starts to lose grip
const STEER_RESPONSE_PER_S = 3;
const CHARGE_BRAKE_PER_S = 5;
const CHARGE_STEER_SCALE = 0.25;
const DASH_ACCEL_MPS2 = 90;
const DASH_LEAD_MAX_S = 0.3;
const DASH_END_KEEP = 0.55;
const SLOW_RECOVERY_STEER = 0.3;
const BROKEN_GRIP = 0.3;
const STABILITY_MAX = 100;
const STABILITY_AFTER_BREAK = 40;
const STABILITY_REGEN_DELAY_S = 1.5;
const HIT_EVENT_COOLDOWN_S = 0.25;
const HIT_FULL_JN = 16;               // impulse that counts as magnitude 1
const MIN_HIT_JN = 2.5;
const WALL_NOTE_MIN_SPEED_MPS = 4;
const OUTSIDE_MARGIN_M = 0.2;
const OVER_SETTLE_S = 3;
const AI_THINK_S = 0.1;
const ARENA_PHASE = [0, 2.1] as const;
// ----------------------------------------------------------------

export interface RealInput {
  /** The stick in world axes (x, z), each -1..1; the page maps the arrows through the camera. */
  stickX: number;
  stickZ: number;
  /** The Attack button is down: tap = Circular, hold and release = Dash. */
  attackHeld: boolean;
}

export type OutcomeReason = 'ringout' | 'spinout' | 'ko' | 'time';

export interface Outcome {
  over: boolean;
  /** 0 or 1, or null for a draw. */
  winner: 0 | 1 | null;
  reason: OutcomeReason | null;
  /** Sim time at which it was decided. */
  at: number;
}

export interface RealNote extends StageNote {
  kind:
    | 'jump'
    | 'land'
    | 'dash'
    | 'circular'
    | 'dodge'
    | 'perfectDodge'
    | 'wall'
    | 'broken'
    | 'counter'
    | 'ringout'
    | 'spinout'
    | 'ko'
    | 'time';
  t: number;
}

export interface RealBey extends FlowBey {
  height: number;
  vy: number;
  airborne: boolean;
  mass: number;
  /** 0..100. At 0 the Bey is Broken: any hit then is a KO. */
  stability: number;
  broken: boolean;
  brokenT: number;
  stabilityIdleT: number;
  /** 0..1 while charging a Dash. */
  charge: number;
  holdT: number;
  pressing: boolean;
  attackPrev: boolean;
  dashT: number;
  dashAge: number;
  dashSpeed: number;
  dashCd: number;
  dashHit: boolean;
  dashCharge: number;
  recoverT: number;
  circT: number;
  circCd: number;
  circRecoverT: number;
  dodgeT: number;
  dodgeAge: number;
  dodgeBurstT: number;
  dodgeDirX: number;
  dodgeDirZ: number;
  dodgeCd: number;
  jumpCd: number;
  wobblePhase: number;
  outsideT: number;
  /** It cleared the wall in the air: the wall no longer holds it until it is back inside. */
  overWall: boolean;
  lastHitAge: number;
  pendingJump: boolean;
  pendingDodge: boolean;
  input: RealInput;
  ai: boolean;
  /** Per-Bey counters for the headless calibration. */
  stats: { hits: number; dashes: number; circulars: number; dodges: number; perfect: number; jumps: number; wallHits: number; maxSpeed: number; distance: number };
}

interface AiBrain {
  thinkT: number;
  holdTarget: number;
  holding: boolean;
  tapT: number;
  reactT: number;
  reacting: boolean;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** mulberry32: deterministic. */
function makeRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeBey(index: 0 | 1, p: RealParams): RealBey {
  const angle = index === 0 ? 0 : Math.PI;
  const r = p.stageRadiusM * 0.45;
  const dir: 1 | -1 = index === 0 ? 1 : p.sameSpin >= 0.5 ? 1 : -1;
  const x = Math.cos(angle) * r;
  const z = Math.sin(angle) * r;
  // Born moving along its orbit.
  const vx = -Math.sin(angle) * p.cruiseSpeedMps * dir;
  const vz = Math.cos(angle) * p.cruiseSpeedMps * dir;
  return {
    x,
    z,
    vx,
    vz,
    ax: 0,
    az: 0,
    speed: p.cruiseSpeedMps,
    spin: 1,
    charging: false,
    dashing: false,
    dashDirX: -Math.cos(angle),
    dashDirZ: -Math.sin(angle),
    headX: vx / p.cruiseSpeedMps,
    headZ: vz / p.cruiseSpeedMps,
    dir,
    height: 0,
    vy: 0,
    airborne: false,
    mass: index === 0 ? 1 : p.massSecond,
    stability: STABILITY_MAX,
    broken: false,
    brokenT: 0,
    stabilityIdleT: 0,
    charge: 0,
    holdT: 0,
    pressing: false,
    attackPrev: false,
    dashT: 0,
    dashAge: 0,
    dashSpeed: 0,
    dashCd: 0,
    dashHit: false,
    dashCharge: 0,
    recoverT: 0,
    circT: 0,
    circCd: 0,
    circRecoverT: 0,
    dodgeT: 0,
    dodgeAge: 0,
    dodgeBurstT: 0,
    dodgeDirX: 0,
    dodgeDirZ: 0,
    dodgeCd: 0,
    jumpCd: 0,
    wobblePhase: index * 1.7,
    outsideT: 0,
    overWall: false,
    lastHitAge: 99,
    pendingJump: false,
    pendingDodge: false,
    input: { stickX: 0, stickZ: 0, attackHeld: false },
    ai: false,
    stats: { hits: 0, dashes: 0, circulars: 0, dodges: 0, perfect: 0, jumps: 0, wallHits: 0, maxSpeed: 0, distance: 0 },
  };
}

export interface RealSimOptions {
  seed?: number;
  /** Which Beys the decision AI drives. Default: the second only (the player drives the first). */
  ai?: readonly [boolean, boolean];
  /** Read live every step. Default: the lab's PARAMS. */
  params?: RealParams;
}

export class RealSim implements StageSim {
  readonly beys: [RealBey, RealBey];
  events: FlowEvent[] = [];
  notes: RealNote[] = [];
  time = 0;
  outcome: Outcome = { over: false, winner: null, reason: null, at: 0 };
  readonly score: [number, number] = [0, 0];
  private readonly rng: () => number;
  private readonly brains: [AiBrain, AiBrain];
  private readonly params: RealParams;
  private hitCooldown = 0;

  constructor(options: RealSimOptions = {}) {
    this.params = options.params ?? PARAMS;
    this.rng = makeRng(options.seed ?? 1);
    this.beys = [makeBey(0, this.params), makeBey(1, this.params)];
    const ai = options.ai ?? [false, true];
    this.beys[0].ai = ai[0];
    this.beys[1].ai = ai[1];
    this.brains = [this.newBrain(), this.newBrain()];
  }

  private newBrain(): AiBrain {
    return { thinkT: this.rng() * AI_THINK_S, holdTarget: 0, holding: false, tapT: 0, reactT: 0, reacting: false };
  }

  /** The Bey `i` is driven by the decision AI (true) or by `setInput` (false). */
  setAi(i: 0 | 1, on: boolean): void {
    this.beys[i].ai = on;
  }

  /** The player's stick and Attack button for Bey `i` (held state: call it whenever it changes). */
  setInput(i: 0 | 1, input: Partial<RealInput>): void {
    Object.assign(this.beys[i].input, input);
  }

  /** The Jump button went down for Bey `i`: latched until the next step uses it. */
  pressJump(i: 0 | 1): void {
    this.beys[i].pendingJump = true;
  }

  /** The Dodge button went down for Bey `i`: latched until the next step uses it. */
  pressDodge(i: 0 | 1): void {
    this.beys[i].pendingDodge = true;
  }

  /** Starts the next round (keeps the score and the seed's stream). */
  nextRound(): void {
    const ai: [boolean, boolean] = [this.beys[0].ai, this.beys[1].ai];
    const fresh: [RealBey, RealBey] = [makeBey(0, this.params), makeBey(1, this.params)];
    fresh[0].ai = ai[0];
    fresh[1].ai = ai[1];
    this.beys[0] = fresh[0];
    this.beys[1] = fresh[1];
    this.outcome = { over: false, winner: null, reason: null, at: 0 };
    this.time = 0;
    this.events = [];
    this.notes = [];
    this.hitCooldown = 0;
    this.brains[0] = this.newBrain();
    this.brains[1] = this.newBrain();
  }

  /** Fires a callout on demand, at the midpoint of the pair (the lab's buttons). */
  forceCallout(kind: CalloutKind): FlowEvent {
    const [a, b] = this.beys;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const d = Math.hypot(dx, dz) || 1;
    const e: FlowEvent = { kind, x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, m: 0.7, dirX: dx / d, dirZ: dz / d };
    this.events.push(e);
    return e;
  }

  get settled(): boolean {
    return this.outcome.over && this.time - this.outcome.at >= OVER_SETTLE_S;
  }

  step(dt: number): void {
    this.events = [];
    this.notes = [];
    const h = dt / SUBSTEPS;
    for (let s = 0; s < SUBSTEPS; s++) this.substep(h, s === 0 ? dt : 0);
    for (const b of this.beys) {
      b.speed = Math.hypot(b.vx, b.vz);
      b.stats.maxSpeed = Math.max(b.stats.maxSpeed, b.speed);
      b.stats.distance += b.speed * dt;
      b.charging = b.pressing && b.charge > 0;
      b.dashing = b.dashT > 0;
      if (b.dashing) {
        b.headX = b.dashDirX;
        b.headZ = b.dashDirZ;
      } else if (b.speed > 0.3) {
        b.headX = b.vx / b.speed;
        b.headZ = b.vz / b.speed;
      }
    }
  }

  // ---------------- one sub-step ----------------

  private substep(h: number, thinkDt: number): void {
    const p = this.params;
    this.time += h;
    this.hitCooldown = Math.max(0, this.hitCooldown - h);
    const [a, b] = this.beys;
    if (thinkDt > 0) {
      if (a.ai) this.think(0, thinkDt);
      if (b.ai) this.think(1, thinkDt);
    }
    for (let i = 0; i < 2; i++) {
      const me = this.beys[i]!;
      const other = this.beys[1 - i]!;
      this.timers(me, h);
      this.attackMachine(i as 0 | 1, me, other, h);
      this.jumpAndDodge(i as 0 | 1, me, other);
      this.move(i as 0 | 1, me, other, h);
    }
    this.bodyContact();
    for (const bey of this.beys) this.wall(bey, bey === a ? 0 : 1);
    for (let i = 0; i < 2; i++) this.upkeep(i as 0 | 1, this.beys[i]!, h);
    this.judge();
    void p;
  }

  private timers(b: RealBey, h: number): void {
    b.dashCd = Math.max(0, b.dashCd - h);
    b.circCd = Math.max(0, b.circCd - h);
    b.circT = Math.max(0, b.circT - h);
    b.circRecoverT = Math.max(0, b.circRecoverT - h);
    b.recoverT = Math.max(0, b.recoverT - h);
    b.dodgeCd = Math.max(0, b.dodgeCd - h);
    b.dodgeT = Math.max(0, b.dodgeT - h);
    b.dodgeBurstT = Math.max(0, b.dodgeBurstT - h);
    b.jumpCd = Math.max(0, b.jumpCd - h);
    b.lastHitAge += h;
    if (b.dodgeT > 0) b.dodgeAge += h;
    if (b.dashT > 0) b.dashAge += h;
  }

  // ---------------- attack: tap = Circular, hold + release = Dash ----------------

  private attackMachine(i: 0 | 1, b: RealBey, o: RealBey, h: number): void {
    const p = this.params;
    const held = b.input.attackHeld;
    const free = !b.broken && !b.airborne && b.dashT <= 0 && b.circT <= 0 && b.dodgeBurstT <= 0;
    if (held && !b.attackPrev) {
      b.pressing = true;
      b.holdT = 0;
      b.charge = 0;
    }
    if (b.pressing && held) {
      b.holdT += h;
      if (b.holdT > TAP_MAX_HOLD_S && b.dashCd <= 0 && free && b.recoverT <= 0) {
        b.charge = clamp((b.holdT - DASH_MIN_CHARGE_S) / Math.max(0.05, p.dashChargeMaxS - DASH_MIN_CHARGE_S), 0, 1);
        if (b.charge <= 0) b.charge = 0.001;
      }
    }
    if (b.pressing && !held) {
      if (b.charge > 0 && b.dashCd <= 0 && free) this.fireDash(i, b, o);
      else if (b.holdT <= TAP_MAX_HOLD_S && b.circCd <= 0 && !b.broken && !b.airborne && b.circT <= 0 && b.dashT <= 0) this.fireCircular(i, b);
      b.pressing = false;
      b.charge = 0;
    }
    b.attackPrev = held;
    if (b.dashT > 0) {
      b.dashT -= h;
      if (b.dashT <= 0) this.endDash(b);
    }
  }

  private fireDash(i: 0 | 1, b: RealBey, o: RealBey): void {
    const p = this.params;
    b.dashCharge = b.charge;
    b.dashSpeed = lerp(p.dashMinSpeedMps, Math.max(p.dashMinSpeedMps, p.dashMaxSpeedMps), b.charge);
    b.dashT = p.dashDurationS;
    b.dashAge = 0;
    b.dashHit = false;
    // The turn at the release: it faces the opponent at once (the slew in `move` is only a safety for a huge angle).
    const dir = this.dashTarget(b, o);
    b.dashDirX = dir.x;
    b.dashDirZ = dir.z;
    b.spin = Math.max(0, b.spin - p.dashSpinCost * (0.4 + 0.6 * b.charge));
    b.stats.dashes++;
    this.note('dash', i, b.x, b.z, b.charge);
  }

  /** The Dash is over (time up, a hit, a wall, a Circular, a Dodge): the cooldown starts, a miss costs a recovery. */
  private endDash(b: RealBey): void {
    const p = this.params;
    b.dashT = 0;
    b.dashCd = p.dashCooldownS;
    if (!b.dashHit) b.recoverT = p.dashWhiffRecoveryS;
    // The Dash does not stop dead: it keeps some of its speed, then the bowl and the friction take over.
    b.vx *= DASH_END_KEEP;
    b.vz *= DASH_END_KEEP;
  }

  private fireCircular(i: 0 | 1, b: RealBey): void {
    const p = this.params;
    b.circT = p.circularDurationS;
    b.circCd = p.circularDurationS + p.circularRecoveryS;
    b.circRecoverT = b.circCd;
    b.spin = Math.max(0, b.spin - 0.006);
    b.stats.circulars++;
    this.note('circular', i, b.x, b.z, 0.5);
  }

  /** Where a Dash fired by `b` heads: the opponent, led a little by its velocity. */
  private dashTarget(b: RealBey, o: RealBey): { x: number; z: number } {
    const dx = o.x - b.x;
    const dz = o.z - b.z;
    const d = Math.hypot(dx, dz) || 1;
    const speed = Math.max(1, b.dashSpeed || this.params.dashMinSpeedMps);
    const lead = Math.min(DASH_LEAD_MAX_S, (d / speed) * 0.5);
    const tx = o.x + o.vx * lead - b.x;
    const tz = o.z + o.vz * lead - b.z;
    const l = Math.hypot(tx, tz) || 1;
    return { x: tx / l, z: tz / l };
  }

  // ---------------- jump and dodge ----------------

  private jumpAndDodge(i: 0 | 1, b: RealBey, o: RealBey): void {
    const p = this.params;
    if (b.pendingJump) {
      if (!b.airborne && b.jumpCd <= 0 && !b.broken && b.dashT <= 0) {
        b.vy = p.jumpSpeedMps;
        b.height = 1e-4;
        b.airborne = true;
        b.jumpCd = p.jumpCooldownS;
        b.stats.jumps++;
        this.note('jump', i, b.x, b.z, 0.5);
      }
      b.pendingJump = false;
    }
    if (b.pendingDodge) {
      if (b.dodgeCd <= 0 && !b.broken && b.dodgeT <= 0) {
        let dx = b.input.stickX;
        let dz = b.input.stickZ;
        const m = Math.hypot(dx, dz);
        if (m > 0.25) {
          dx /= m;
          dz /= m;
        } else {
          // No stick: sideways to the line between the Beys, to whichever side leaves more room before the wall.
          const ax = o.x - b.x;
          const az = o.z - b.z;
          const l = Math.hypot(ax, az) || 1;
          const px = -az / l;
          const pz = ax / l;
          const roomA = Math.hypot(b.x + px * 3, b.z + pz * 3);
          const roomB = Math.hypot(b.x - px * 3, b.z - pz * 3);
          const s = roomA <= roomB ? 1 : -1;
          dx = px * s;
          dz = pz * s;
        }
        b.dodgeDirX = dx;
        b.dodgeDirZ = dz;
        b.dodgeT = p.dodgeInvulnS;
        b.dodgeAge = 0;
        b.dodgeBurstT = p.dodgeBurstS;
        b.dodgeCd = p.dodgeCooldownS;
        b.spin = Math.max(0, b.spin - p.dodgeSpinCost);
        b.stats.dodges++;
        // A Dodge cancels a charge in progress.
        b.pressing = false;
        b.charge = 0;
        this.note('dodge', i, b.x, b.z, 0.5);
        this.perfectCheck(i, b, o);
      }
      b.pendingDodge = false;
    }
  }

  // ---------------- movement ----------------

  /** The autopilot: a unit-or-shorter world vector for where this Bey wants to go. */
  autopilot(b: RealBey, o: RealBey): { x: number; z: number } {
    const p = this.params;
    const r = Math.hypot(b.x, b.z) || 1e-6;
    const rx = b.x / r;
    const rz = b.z / r;
    // Orbit the way the spin turns it.
    const tx = -rz * b.dir;
    const tz = rx * b.dir;
    const phase = ARENA_PHASE[b === this.beys[0] ? 0 : 1];
    const rTarget = p.stageRadiusM * p.orbitRadiusFrac * (1 + 0.2 * Math.sin(0.45 * this.time + phase));
    const radial = clamp((rTarget - r) / 3, -1, 1) * 0.9;
    const edge = 0.82 * p.stageRadiusM;
    const contain = r > edge ? -clamp((r - edge) / (p.stageRadiusM - edge), 0, 1) * 2 : 0;
    // Pursuit grows as the opponent gets tired.
    const ox = o.x - b.x;
    const oz = o.z - b.z;
    const od = Math.hypot(ox, oz) || 1;
    // ...but never leans on the opponent: close up, the pursuit fades so two Beys do not stick together.
    const near = clamp((od - 1.8) / 2.7, 0, 1);
    const pw = p.pursuit * near * (0.4 + 0.6 * clamp(1 - o.spin, 0, 1) + 0.3 * clamp(4 / od, 0, 1));
    let ix = tx + rx * (radial + contain) + (ox / od) * pw;
    let iz = tz + rz * (radial + contain) + (oz / od) * pw;
    const m = Math.hypot(ix, iz);
    if (m > 1) {
      ix /= m;
      iz /= m;
    }
    return { x: ix, z: iz };
  }

  private move(i: 0 | 1, b: RealBey, o: RealBey, h: number): void {
    const p = this.params;
    const r = Math.hypot(b.x, b.z) || 1e-6;
    const rx = b.x / r;
    const rz = b.z / r;
    const pvx = b.vx;
    const pvz = b.vz;
    const grounded = !b.airborne;
    let ax = 0;
    let az = 0;

    if (b.airborne) {
      // In the air: momentum only; the player picks the moment, not the direction.
      b.vy -= p.gravityMps2 * h;
      b.height += b.vy * h;
      if (p.airControl > 0 && b.dashT <= 0) {
        const intent = this.autopilot(b, o);
        ax += (intent.x * p.cruiseSpeedMps - b.vx) * STEER_RESPONSE_PER_S * p.airControl;
        az += (intent.z * p.cruiseSpeedMps - b.vz) * STEER_RESPONSE_PER_S * p.airControl;
      }
      if (b.height <= 0) this.land(i, b);
    } else {
      // The bowl: gravity along the funnel's slope.
      const pull = p.bowlPull * floorSlope(r);
      ax -= rx * pull;
      az -= rz * pull;
    }

    if (grounded) {
      const wobble = this.wobbleAccel(b, h);
      const speed = Math.hypot(b.vx, b.vz);
      if (b.dashT > 0) {
        this.dashSteer(b, o, h);
        const dvx = b.dashDirX * b.dashSpeed - b.vx;
        const dvz = b.dashDirZ * b.dashSpeed - b.vz;
        const dl = Math.hypot(dvx, dvz) || 1;
        const a = Math.min(DASH_ACCEL_MPS2, dl / h);
        ax += (dvx / dl) * a;
        az += (dvz / dl) * a;
      } else if (b.dodgeBurstT > 0) {
        const dvx = b.dodgeDirX * p.dodgeSpeedMps - b.vx;
        const dvz = b.dodgeDirZ * p.dodgeSpeedMps - b.vz;
        const dl = Math.hypot(dvx, dvz) || 1;
        const a = Math.min(DASH_ACCEL_MPS2, dl / h);
        ax += (dvx / dl) * a;
        az += (dvz / dl) * a;
      } else {
        // Steering: the autopilot's intent, with the player's stick taking `influence` of it, limited by grip.
        const auto = this.autopilot(b, o);
        const sm = Math.min(1, Math.hypot(b.input.stickX, b.input.stickZ));
        const w = b.ai ? 0 : clamp(p.influence, 0, 1) * sm;
        const sx = sm > 1e-6 ? b.input.stickX / Math.hypot(b.input.stickX, b.input.stickZ) : 0;
        const sz = sm > 1e-6 ? b.input.stickZ / Math.hypot(b.input.stickX, b.input.stickZ) : 0;
        const ix = auto.x * (1 - w) + sx * w;
        const iz = auto.z * (1 - w) + sz * w;
        const charging = b.pressing && b.charge > 0;
        let cruise = p.cruiseSpeedMps * (0.5 + 0.5 * Math.sqrt(clamp(b.spin, 0, 1)));
        if (charging) cruise *= 0.25;
        const grip = this.grip(b) * (charging ? CHARGE_STEER_SCALE : 1) * (b.recoverT > 0 ? SLOW_RECOVERY_STEER : 1);
        const dvx = ix * cruise - b.vx;
        const dvz = iz * cruise - b.vz;
        let sax = dvx * STEER_RESPONSE_PER_S;
        let saz = dvz * STEER_RESPONSE_PER_S;
        const cap = p.steerAccelMps2 * grip;
        const sl = Math.hypot(sax, saz);
        if (sl > cap) {
          sax *= cap / sl;
          saz *= cap / sl;
        }
        ax += sax;
        az += saz;
        b.spin = Math.max(0, b.spin - p.spinSteerLoss * Math.hypot(sax, saz) * h);
        if (charging) {
          // Winding up: brake hard.
          ax -= b.vx * CHARGE_BRAKE_PER_S;
          az -= b.vz * CHARGE_BRAKE_PER_S;
        }
      }
      // Tip friction and drag.
      if (speed > 1e-6) {
        const fric = Math.min(speed / h, p.tipFrictionMps2 * (1 + 2 * (1 - clamp(b.spin / p.wobbleSpin, 0, 1))));
        ax -= (b.vx / speed) * fric;
        az -= (b.vz / speed) * fric;
      }
      ax -= b.vx * p.dragPerS;
      az -= b.vz * p.dragPerS;
      ax += wobble.x;
      az += wobble.z;
    }

    b.vx += ax * h;
    b.vz += az * h;
    if (grounded) {
      // Precession: the spin bends the path (the way the top turns).
      const omega = p.precessionRadPerS * clamp(b.spin, 0, 1) * b.dir * h;
      const c = Math.cos(omega);
      const s = Math.sin(omega);
      const nvx = b.vx * c - b.vz * s;
      const nvz = b.vx * s + b.vz * c;
      b.vx = nvx;
      b.vz = nvz;
    }
    b.x += b.vx * h;
    b.z += b.vz * h;
    b.ax = (b.vx - pvx) / h;
    b.az = (b.vz - pvz) / h;
  }

  /** The wobble of a tired or broken spin: a sideways push that grows as the spin drops. */
  private wobbleAccel(b: RealBey, h: number): { x: number; z: number } {
    const p = this.params;
    const tired = clamp((p.wobbleSpin - b.spin) / Math.max(1e-3, p.wobbleSpin), 0, 1);
    const unstable = b.broken ? 1 : clamp(1 - b.stability / 40, 0, 1) * 0.5;
    const amp = p.wobbleAccelMps2 * Math.max(tired * tired, unstable);
    b.wobblePhase += (8 + 14 * Math.max(tired, unstable)) * h;
    const speed = Math.hypot(b.vx, b.vz);
    if (amp <= 1e-6 || speed < 1e-3) return { x: 0, z: 0 };
    const px = -b.vz / speed;
    const pz = b.vx / speed;
    const s = Math.sin(b.wobblePhase);
    return { x: px * amp * s, z: pz * amp * s };
  }

  private grip(b: RealBey): number {
    return clamp(b.spin / GRIP_FULL_SPIN, 0, 1) * (b.broken ? BROKEN_GRIP : 1);
  }

  /** The Dash turns toward the opponent: fast in the first moments after the release, at the lock-on rate afterwards. */
  private dashSteer(b: RealBey, o: RealBey, h: number): void {
    const p = this.params;
    const want = this.dashTarget(b, o);
    const cur = Math.atan2(b.dashDirZ, b.dashDirX);
    const tgt = Math.atan2(want.z, want.x);
    let diff = tgt - cur;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    const rate = b.dashAge < p.dashSnapWindowS ? p.dashSnapRadPerS : p.dashLockRadPerS;
    const turn = clamp(diff, -rate * h, rate * h);
    b.dashDirX = Math.cos(cur + turn);
    b.dashDirZ = Math.sin(cur + turn);
  }

  private land(i: 0 | 1, b: RealBey): void {
    const p = this.params;
    const m = clamp(-b.vy / Math.max(1, p.jumpSpeedMps), 0, 1.5);
    b.airborne = false;
    b.height = 0;
    b.vy = 0;
    b.stability = Math.max(0, b.stability - 4 * m);
    b.spin = Math.max(0, b.spin - 0.003 * m);
    this.note('land', i, b.x, b.z, Math.min(1, m));
    // A hard landing can break a Bey that was already on its last stability.
    if (b.stability <= 0 && !b.broken) this.breakBey(i, b);
  }

  // ---------------- contact ----------------

  private bodyContact(): void {
    const p = this.params;
    const [a, b] = this.beys;
    if (a.dodgeT > 0 || b.dodgeT > 0) return; // i-frames: nothing connects
    if (Math.abs(a.height - b.height) >= HITBOX_VERTICAL_REACH_M) return;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-6) return;
    const nx = dx / d;
    const nz = dz / d;
    // A Circular touches before the bodies do.
    if (a.circT > 0 && b.circT <= 0 && d < p.circularRadiusM + BEY_RADIUS_M) return this.circularTouch(0, a, b, nx, nz);
    if (b.circT > 0 && a.circT <= 0 && d < p.circularRadiusM + BEY_RADIUS_M) return this.circularTouch(1, b, a, -nx, -nz);
    if (a.circT > 0 || b.circT > 0) return;
    if (d >= BEY_DIAMETER_M) return;

    const dashBoostA = a.dashT > 0 ? p.dashMassBoost : 1;
    const dashBoostB = b.dashT > 0 ? p.dashMassBoost : 1;
    const mA = a.mass * dashBoostA;
    const mB = b.mass * dashBoostB;
    const invA = 1 / mA;
    const invB = 1 / mB;
    // Push the overlap apart, the lighter one moving more.
    const overlap = BEY_DIAMETER_M - d;
    a.x -= nx * overlap * (invA / (invA + invB));
    a.z -= nz * overlap * (invA / (invA + invB));
    b.x += nx * overlap * (invB / (invA + invB));
    b.z += nz * overlap * (invB / (invA + invB));
    const closing = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
    if (closing <= 0) return;
    const spinMean = 0.5 * (a.spin + b.spin);
    const e = lerp(p.restitutionLow, p.restitutionHigh, clamp(spinMean, 0, 1));
    const jn = ((1 + e) * closing) / (invA + invB);
    a.vx -= nx * jn * invA;
    a.vz -= nz * jn * invA;
    b.vx += nx * jn * invB;
    b.vz += nz * jn * invB;

    // Rim friction: the two rims slide against each other. The spins decide how much, and the friction
    // drags both Beys sideways and moves spin between them (opposite spins mesh, equal spins grind).
    const tx = -nz;
    const tz = nx;
    const rimA = a.dir * a.spin * RIM_SPEED_MPS;
    const rimB = b.dir * b.spin * RIM_SPEED_MPS;
    const vtRel = a.vx * tx + a.vz * tz + rimA - (b.vx * tx + b.vz * tz - rimB);
    const jtMax = p.rimFriction * jn;
    const jt = clamp(-vtRel / (invA + invB), -jtMax, jtMax);
    a.vx += tx * jt * invA;
    a.vz += tz * jt * invA;
    b.vx -= tx * jt * invB;
    b.vz -= tz * jt * invB;
    a.spin = clamp(a.spin + a.dir * p.spinExchange * jt, 0, 1);
    b.spin = clamp(b.spin + b.dir * p.spinExchange * jt, 0, 1);

    // Damage: impacts and rubbing cost spin; hard hits cost stability (a Dash costs its own, charge-scaled amount).
    const rub = Math.abs(jt);
    for (const [bey, other, boost] of [[a, b, dashBoostA], [b, a, dashBoostB]] as const) {
      void other;
      bey.spin = Math.max(0, bey.spin - p.hitSpinLoss * jn * (boost > 1 ? 0.6 : 1) - p.rubSpinLoss * rub);
    }
    const aDash = a.dashT > 0;
    const bDash = b.dashT > 0;
    let stabA = p.hitStability * jn;
    let stabB = p.hitStability * jn;
    if (aDash) {
      stabB += lerp(p.dashStabilityMin, p.dashStabilityMax, a.dashCharge) * clamp(closing / 14, 0.4, 1.3);
      a.dashHit = true;
      this.endDash(a);
    }
    if (bDash) {
      stabA += lerp(p.dashStabilityMin, p.dashStabilityMax, b.dashCharge) * clamp(closing / 14, 0.4, 1.3);
      b.dashHit = true;
      this.endDash(b);
    }
    this.damage(0, a, stabA, jn);
    this.damage(1, b, stabB, jn);
    if (jn >= MIN_HIT_JN && this.hitCooldown <= 0) {
      a.stats.hits++;
      b.stats.hits++;
      this.hitCooldown = HIT_EVENT_COOLDOWN_S;
      // The attacker is the Dasher; between two plain bodies, the one driving harder along the line between them.
      const aggressor = aDash !== bDash ? (aDash ? 1 : -1) : a.vx * nx + a.vz * nz >= -(b.vx * nx + b.vz * nz) ? 1 : -1;
      this.events.push({ kind: 'hit', x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, m: clamp(jn / HIT_FULL_JN, 0.1, 1), dirX: nx * aggressor, dirZ: nz * aggressor });
    }
  }

  private circularTouch(i: 0 | 1, circ: RealBey, victim: RealBey, nx: number, nz: number): void {
    const p = this.params;
    if (victim.circT > 0) return;
    const j = (1 - i) as 0 | 1;
    const caught = victim.dashT > 0;
    const keep = caught ? p.circularKeepFraction : 0;
    victim.vx = victim.vx * keep + nx * p.circularLaunchMps;
    victim.vz = victim.vz * keep + nz * p.circularLaunchMps;
    if (!victim.airborne) {
      victim.airborne = true;
      victim.height = 1e-4;
      victim.vy = p.circularLaunchUpMps;
    } else {
      victim.vy = Math.max(victim.vy, p.circularLaunchUpMps * 0.6);
    }
    if (caught) {
      victim.dashT = 0;
      victim.dashCd = p.dashCooldownS;
      victim.recoverT = p.dashWhiffRecoveryS;
    }
    this.damage(j, victim, p.circularStability, p.circularStability * 0.4);
    circ.circT = 0; // one touch per Circular
    circ.stats.hits++;
    victim.stats.hits++;
    this.hitCooldown = HIT_EVENT_COOLDOWN_S;
    const x = (circ.x + victim.x) / 2;
    const z = (circ.z + victim.z) / 2;
    this.events.push({ kind: caught ? 'counter' : 'hit', x, z, m: caught ? 1 : 0.8, dirX: nx, dirZ: nz });
    if (caught) this.note('counter', i, x, z, 1);
  }

  /**
   * A Dodge pressed just before an attack would connect (the attack arrives within the perfect window) is a Perfect Dodge:
   * the attacker whiffs, and the dodger gets its Dash back and a short Dodge cooldown as the reward.
   */
  private perfectCheck(i: 0 | 1, dodger: RealBey, other: RealBey): void {
    const p = this.params;
    const dx = dodger.x - other.x;
    const dz = dodger.z - other.z;
    const d = Math.hypot(dx, dz) || 1e-6;
    let tc = Infinity;
    if (other.dashT > 0) {
      // Time until the Dash reaches it: the closing speed along the line between them.
      const closing = Math.max(1, (other.vx * dx + other.vz * dz) / d - (dodger.vx * dx + dodger.vz * dz) / d);
      tc = Math.max(0, (d - BEY_DIAMETER_M) / closing);
    } else if (other.circT > 0 && d < p.circularRadiusM + BEY_RADIUS_M + 0.3) {
      tc = 0;
    }
    if (tc > p.dodgePerfectS) return;
    dodger.stats.perfect++;
    dodger.dashCd = 0;
    dodger.dodgeCd = Math.min(dodger.dodgeCd, p.dodgeCooldownS * 0.4);
    if (other.dashT > 0) {
      other.dashHit = false;
      this.endDash(other);
    }
    other.circT = 0;
    this.note('perfectDodge', i, dodger.x, dodger.z, 1);
  }

  private damage(i: 0 | 1, b: RealBey, stability: number, jn: number): void {
    b.lastHitAge = 0;
    b.stabilityIdleT = 0;
    if (b.broken) {
      if (jn >= MIN_HIT_JN) this.finish(1 - i as 0 | 1, 'ko');
      return;
    }
    b.stability = Math.max(0, b.stability - stability);
    if (b.stability <= 0) this.breakBey(i, b);
  }

  private breakBey(i: 0 | 1, b: RealBey): void {
    b.broken = true;
    b.brokenT = this.params.brokenS;
    b.pressing = false;
    b.charge = 0;
    if (b.dashT > 0) {
      b.dashT = 0;
      this.endDash(b);
    }
    this.note('broken', i, b.x, b.z, 1);
  }

  // ---------------- wall ----------------

  private wall(b: RealBey, i: 0 | 1): void {
    const p = this.params;
    const limit = p.stageRadiusM - BEY_RADIUS_M;
    const r = Math.hypot(b.x, b.z);
    if (r <= limit) {
      b.overWall = false;
      return;
    }
    if (b.overWall) return; // already beyond the wall
    if (b.height >= p.wallHeightM) {
      b.overWall = true; // high enough: over the wall
      return;
    }
    const nx = b.x / r;
    const nz = b.z / r;
    b.x = nx * limit;
    b.z = nz * limit;
    const vn = b.vx * nx + b.vz * nz;
    if (vn <= 0) return;
    b.vx -= (1 + p.wallRestitution) * vn * nx;
    b.vz -= (1 + p.wallRestitution) * vn * nz;
    // The wall scrapes the tangential speed a little.
    const tx = -nz;
    const tz = nx;
    const vt = b.vx * tx + b.vz * tz;
    b.vx -= vt * 0.1 * tx;
    b.vz -= vt * 0.1 * tz;
    b.spin = Math.max(0, b.spin - p.wallSpinLoss * vn);
    b.stability = Math.max(0, b.stability - 0.6 * vn);
    if (b.dashT > 0) {
      b.dashT = 0;
      this.endDash(b);
    }
    if (vn >= WALL_NOTE_MIN_SPEED_MPS) {
      b.stats.wallHits++;
      this.note('wall', i, b.x, b.z, clamp(vn / 14, 0.1, 1));
    }
    if (b.stability <= 0 && !b.broken) this.breakBey(i, b);
  }

  // ---------------- upkeep and the round ----------------

  private upkeep(i: 0 | 1, b: RealBey, h: number): void {
    const p = this.params;
    const speed = Math.hypot(b.vx, b.vz);
    b.spin = Math.max(0, b.spin - (p.spinDecayPerS + p.spinMoveLossPerM * speed) * h);
    if (b.broken) {
      b.brokenT -= h;
      if (b.brokenT <= 0) {
        b.broken = false;
        b.stability = STABILITY_AFTER_BREAK;
      }
    } else {
      b.stabilityIdleT += h;
      if (b.stabilityIdleT > STABILITY_REGEN_DELAY_S) b.stability = Math.min(STABILITY_MAX, b.stability + p.stabilityRegenPerS * h);
    }
    const r = Math.hypot(b.x, b.z);
    b.outsideT = r > p.stageRadiusM + OUTSIDE_MARGIN_M ? b.outsideT + h : 0;
    void i;
  }

  private judge(): void {
    if (this.outcome.over) return;
    const p = this.params;
    const [a, b] = this.beys;
    const outA = a.outsideT >= p.ringOutDelayS;
    const outB = b.outsideT >= p.ringOutDelayS;
    if (outA || outB) return this.finish(outA && outB ? null : outA ? 1 : 0, 'ringout');
    const spA = a.spin <= SPIN_OUT_AT;
    const spB = b.spin <= SPIN_OUT_AT;
    if (spA || spB) return this.finish(spA && spB ? null : spA ? 1 : 0, 'spinout');
    if (p.timeLimitS > 0 && this.time >= p.timeLimitS) this.finish(null, 'time');
  }

  private finish(winner: 0 | 1 | null, reason: OutcomeReason): void {
    if (this.outcome.over) return;
    this.outcome = { over: true, winner, reason, at: this.time };
    if (winner !== null) this.score[winner]++;
    const loser = winner === null ? null : ((1 - winner) as 0 | 1);
    const at = loser === null ? this.beys[0] : this.beys[loser];
    this.note(reason === 'time' ? 'time' : reason, loser, at.x, at.z, 1);
  }

  private note(kind: RealNote['kind'], side: 0 | 1 | null, x: number, z: number, m: number): void {
    this.notes.push({ kind, side, x, z, m, t: this.time });
  }

  // ---------------- the decision AI (only the buttons; the steering is the autopilot's) ----------------

  private think(i: 0 | 1, dt: number): void {
    const p = this.params;
    const b = this.beys[i]!;
    const o = this.beys[1 - i]!;
    const brain = this.brains[i]!;
    if (this.outcome.over) {
      b.input.attackHeld = false;
      return;
    }
    // Release a tap.
    if (brain.tapT > 0) {
      brain.tapT -= dt;
      b.input.attackHeld = brain.tapT > 0;
      return;
    }
    const d = Math.hypot(o.x - b.x, o.z - b.z);
    brain.thinkT -= dt;
    // Holding a charge: release at the target, or when the opponent is already close.
    if (brain.holding) {
      if (b.holdT >= brain.holdTarget || d < 2.6 || b.broken || b.airborne) {
        brain.holding = false;
        b.input.attackHeld = false;
      }
      return;
    }
    if (brain.thinkT > 0) return;
    brain.thinkT = AI_THINK_S;
    const skill = p.aiSkill;
    const aggr = p.aiAggression;
    // Defence: react to a Dash coming in, after a human-like delay.
    const threat = o.dashT > 0 && d < 9;
    if (threat && !brain.reacting) {
      brain.reacting = true;
      brain.reactT = (0.45 * (1 - skill) + 0.12) * (0.7 + 0.6 * this.rng());
    }
    if (!threat) brain.reacting = false;
    if (brain.reacting) {
      brain.reactT -= AI_THINK_S;
      if (brain.reactT <= 0) {
        brain.reacting = false;
        const pick = this.rng();
        if (b.dodgeCd <= 0 && !b.broken && pick < 0.35 + 0.5 * skill) b.pendingDodge = true;
        else if (b.jumpCd <= 0 && !b.airborne && !b.broken && pick < 0.8) b.pendingJump = true;
        else if (b.circCd <= 0 && d < p.circularRadiusM + 1.2) brain.tapT = 0.08;
        if (brain.tapT > 0) b.input.attackHeld = true;
      }
      return;
    }
    if (b.broken || b.airborne || b.dodgeT > 0) return;
    // Close combat: a Circular when the opponent is right there.
    if (d < p.circularRadiusM + 0.9 && b.circCd <= 0 && this.rng() < 0.35 * aggr) {
      brain.tapT = 0.08;
      b.input.attackHeld = true;
      return;
    }
    // Offence: wind up a Dash from a distance.
    if (b.dashCd <= 0 && b.recoverT <= 0 && d > 3.5 && d < p.stageRadiusM * 1.4 && this.rng() < 0.1 * aggr) {
      brain.holding = true;
      brain.holdTarget = lerp(0.35, p.dashChargeMaxS, this.rng());
      b.input.attackHeld = true;
    }
  }
}
