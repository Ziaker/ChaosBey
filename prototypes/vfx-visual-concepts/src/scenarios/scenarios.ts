// ============================================================
// VFX LAB — SCENARIOS
// Short scripted choreographies (NOT physics) that fire the same kinds of
// events the game will: hits, Dash charge/release, Circular sweep,
// Perfect Dodge, Stability Break, landing, wall scrape, ring-out.
// `m` = selected intensity (light / medium / heavy) in [0, 1].
// Positions are meters on the approved 3.2 m bowl (R = 12).
// ============================================================

import * as THREE from 'three';
import type { LanguageRuntime, Slot } from '../languages/types';

export interface Pose {
  x: number;
  z: number;
  /** Height above the floor (jumps, launches). */
  lift: number;
  /** Extra tilt in radians (knockback, wobble). */
  tilt: number;
  /** Direction the tilt leans toward (radians around Y). */
  tiltDir: number;
  visible: boolean;
}

export interface WorldApi {
  readonly lang: LanguageRuntime;
  floorHeightAt(r: number): number;
  readonly R: number;
  /** Current center-of-ring position of a Bey (world space). */
  beyPos(slot: Slot): THREE.Vector3;
  beyVel(slot: Slot): THREE.Vector3;
}

export interface Scenario {
  readonly id: string;
  readonly label: string;
  readonly duration: number;
  pose(t: number, m: number, R: number): [Pose, Pose];
  readonly events: ReadonlyArray<{ t: number; fire(w: WorldApi, m: number): void }>;
  continuous?(t: number, dt: number, w: WorldApi, m: number): void;
  /** Camera focus (x, z) — defaults to the arena center. */
  focus?(t: number, m: number, R: number): [number, number];
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const easeOut = (k: number): number => 1 - Math.pow(1 - clamp01(k), 3);
const easeIn = (k: number): number => Math.pow(clamp01(k), 2.2);
const arc = (k: number): number => (k <= 0 || k >= 1 ? 0 : 4 * k * (1 - k));
const P = (x: number, z: number, extra: Partial<Pose> = {}): Pose => ({ x, z, lift: 0, tilt: 0, tiltDir: 0, visible: true, ...extra });
const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
const RING_Y = 0.55; // ring height above the tip at game scale

/** Contact point between the two Beys. */
const contact = (w: WorldApi): THREE.Vector3 => w.beyPos(0).add(w.beyPos(1)).multiplyScalar(0.5);
const moving = (w: WorldApi, slot: Slot, m: number, dt: number): void => {
  const vel = w.beyVel(slot);
  if (vel.length() > 3) w.lang.fastMove({ pos: w.beyPos(slot), vel, m, slot }, dt);
};

export const SCENARIOS: readonly Scenario[] = [
  {
    id: 'hit',
    label: 'Collision hit',
    duration: 2.6,
    pose(t, m) {
      const k = (t - 0.8) / 0.9;
      const a = t < 0.8 ? P(-4.5 + 3.8 * easeIn(t / 0.8), 0) : P(-0.7 - 1.0 * easeOut((t - 0.8) / 0.6), 0, { tilt: 0.15 * m * Math.exp(-4 * clamp01(k)), tiltDir: Math.PI });
      const b = t < 0.8 ? P(0.72, 0) : P(0.72 + (1.5 + 3.5 * m) * easeOut(k), 0, { tilt: 0.5 * m * Math.exp(-3 * clamp01(k)) * Math.abs(Math.sin(18 * clamp01(k))), tiltDir: 0 });
      return [a, b];
    },
    events: [{ t: 0.8, fire: (w, m) => w.lang.hit({ pos: contact(w), normal: V(1, 0.2, 0).normalize(), m, attacker: 0 }) }],
    continuous(t, dt, w, m) {
      if (t > 0.2 && t < 0.8) moving(w, 0, m, dt);
      if (t > 0.8 && t < 1.4) moving(w, 1, m, dt);
    },
  },
  {
    id: 'dash',
    label: 'Dash Attack',
    duration: 3.4,
    pose(t, m) {
      let ax = -5;
      if (t >= 1.3) ax = t < 1.58 ? -5 + 5.35 * ((t - 1.3) / 0.28) : 0.35 - 0.55 * easeOut((t - 1.58) / 0.5);
      const k = (t - 1.58) / 0.9;
      const b = t < 1.58 ? P(1.05, 0) : P(1.05 + (3 + 6 * m) * easeOut(k), 0, { lift: (1.2 + 2 * m) * arc(k), tilt: 0.6 * m * (1 - clamp01(k)), tiltDir: 0 });
      return [P(ax, 0), b];
    },
    events: [
      { t: 1.3, fire: (w, m) => { w.lang.dashRelease({ pos: w.beyPos(0), dir: V(1, 0, 0), m, slot: 0 }); w.lang.windBurst({ pos: w.beyPos(0), dir: V(1, 0, 0), m, slot: 0 }); } },
      { t: 1.58, fire: (w, m) => w.lang.hit({ pos: contact(w), normal: V(1, 0.3, 0).normalize(), m: Math.min(1, m * 1.15), attacker: 0 }) },
      { t: 2.48, fire: (w, m) => w.lang.landing({ pos: w.beyPos(1), m: m * 0.6, slot: 1 }) },
    ],
    continuous(t, dt, w, m) {
      if (t < 1.3) w.lang.dashCharge({ pos: w.beyPos(0), progress: t / 1.3, m, slot: 0 }, dt);
      if (t >= 1.3 && t < 1.58) moving(w, 0, m, dt);
      if (t > 1.58 && t < 2.48) moving(w, 1, m, dt);
    },
  },
  {
    id: 'circular',
    label: 'Circular Attack (counter)',
    duration: 3.2,
    pose(t, m) {
      const bx = t < 0.5 ? 5 : t < 0.95 ? 5 - 4.1 * ((t - 0.5) / 0.45) : 0.9;
      const k = (t - 0.95) / 1.1;
      const b = t < 0.95 ? P(bx, 0) : P(0.9 + (2.5 + 2 * m) * easeOut(k), 0, { lift: (2 + 2.5 * m) * arc(k), tilt: 0.9 * (1 - clamp01(k)), tiltDir: 0 });
      return [P(0, 0), b];
    },
    events: [
      { t: 0.95, fire: (w, m) => w.lang.hit({ pos: contact(w), normal: V(1, 0.8, 0).normalize(), m, attacker: 0 }) },
      { t: 2.05, fire: (w, m) => w.lang.landing({ pos: w.beyPos(1), m: m * 0.7, slot: 1 }) },
    ],
    continuous(t, dt, w, m) {
      if (t > 0.5 && t < 0.95) moving(w, 1, m, dt);
      if (t >= 0.78 && t < 1.15) w.lang.circularSweep({ pos: w.beyPos(0), m, slot: 0 }, (t - 0.78) / 0.37, dt);
      if (t > 0.95 && t < 2.05) moving(w, 1, m, dt);
    },
  },
  {
    id: 'dodge',
    label: 'Perfect Dodge',
    duration: 3.0,
    pose(t) {
      const bx = t < 0.4 ? 6 : t < 1.4 ? 6 - 12 * ((t - 0.4) / 1.0) : -6;
      const az = t < 0.78 ? 0 : 1.9 * easeOut((t - 0.78) / 0.2);
      return [P(0, az, { tilt: t > 0.78 && t < 1.0 ? 0.25 : 0, tiltDir: Math.PI / 2 }), P(bx, 0, { visible: t < 1.4 })];
    },
    events: [{
      t: 0.78,
      fire: (w, m) => {
        w.lang.windBurst({ pos: w.beyPos(0), dir: V(0, 0, 1), m, slot: 0 });
        w.lang.perfectDodge({ pos: w.beyPos(0), dir: V(0, 0, 1), m, slot: 0 });
      },
    }],
    continuous(t, dt, w, m) {
      if (t > 0.4 && t < 1.4) moving(w, 1, m, dt);
      if (t >= 0.78 && t < 1.1) w.lang.dodgeMove({ pos: w.beyPos(0), vel: w.beyVel(0), m, slot: 0 }, dt);
    },
  },
  {
    id: 'burst',
    label: 'Wind burst (advance)',
    duration: 2.8,
    pose(t, m) {
      // Two sharp advances: forward, then a sideways cut.
      const d1 = 3.5 + 1.5 * m;
      const x = t < 0.5 ? -3.5 : t < 0.72 ? -3.5 + d1 * easeOut((t - 0.5) / 0.22) : -3.5 + d1;
      const z = t < 1.5 ? 0 : t < 1.7 ? 3 * easeOut((t - 1.5) / 0.2) : 3;
      const lean = (t > 0.5 && t < 0.8) || (t > 1.5 && t < 1.78) ? 0.22 : 0;
      return [P(x, z, { tilt: lean, tiltDir: t < 1.5 ? 0 : Math.PI / 2 }), P(4.5, -3.5)];
    },
    events: [
      { t: 0.5, fire: (w, m) => w.lang.windBurst({ pos: w.beyPos(0), dir: V(1, 0, 0), m, slot: 0 }) },
      { t: 1.5, fire: (w, m) => w.lang.windBurst({ pos: w.beyPos(0), dir: V(0, 0, 1), m, slot: 0 }) },
    ],
    continuous(t, dt, w, m) {
      if ((t > 0.5 && t < 0.72) || (t > 1.5 && t < 1.7)) moving(w, 0, m, dt);
    },
  },
  {
    id: 'break',
    label: 'Stability Break',
    duration: 3.4,
    pose(t, m) {
      const a = t < 0.7 ? P(-4 + 3.3 * easeIn(t / 0.7), 0) : P(-0.7 - 0.8 * easeOut((t - 0.7) / 0.5), 0);
      const k = clamp01((t - 0.7) / 2.5);
      const wob = t < 0.7 ? 0 : (0.35 + 0.25 * m) * (0.75 + 0.25 * Math.sin(t * 7)) * (1 - 0.3 * k);
      return [a, P(0.72 + (0.8 + 1.2 * m) * easeOut((t - 0.7) / 0.8) + 0.3 * Math.sin(t * 2) * k, 0.3 * Math.cos(t * 2) * k, { tilt: wob, tiltDir: t * 9 })];
    },
    events: [
      { t: 0.7, fire: (w, m) => w.lang.hit({ pos: contact(w), normal: V(1, 0.2, 0).normalize(), m, attacker: 0 }) },
      { t: 0.78, fire: (w, m) => w.lang.stabilityBreak({ pos: w.beyPos(1), m, slot: 1 }) },
    ],
    continuous(t, dt, w, m) {
      if (t > 0.1 && t < 0.7) moving(w, 0, m, dt);
      if (t > 0.8) w.lang.wobble({ pos: w.beyPos(1), m, slot: 1 }, dt);
    },
  },
  {
    id: 'landing',
    label: 'Jump landing',
    duration: 2.6,
    pose(t, m) {
      const k = (t - 0.3) / 0.9;
      const x = t < 0.3 ? -3 : t < 1.2 ? -3 + 3.5 * k : 0.5;
      const lift = (1.2 + 3 * m) * arc(k) + 0.3 * m * arc((t - 1.2) / 0.25);
      return [P(x, 0, { lift, tilt: t > 1.2 ? 0.2 * m * Math.exp(-6 * (t - 1.2)) : 0 }), P(-5, 3.5)];
    },
    events: [{ t: 1.2, fire: (w, m) => w.lang.landing({ pos: w.beyPos(0), m, slot: 0 }) }],
    continuous(t, dt, w, m) {
      if (t > 0.3 && t < 1.2) moving(w, 0, m, dt);
    },
  },
  {
    id: 'scrape',
    label: 'Wall scrape',
    duration: 2.8,
    pose(t, m, R) {
      const th = t < 0.3 ? -0.9 : t < 1.9 ? -0.9 + 1.8 * ((t - 0.3) / 1.6) : 0.9;
      const r = t < 1.9 ? R - 0.75 : R - 0.75 - (2 + 2 * m) * easeOut((t - 1.9) / 0.6);
      return [P(Math.cos(th) * r, Math.sin(th) * r, { tilt: t < 1.9 ? 0.18 : 0.3 * m * Math.exp(-5 * (t - 1.9)), tiltDir: th }), P(3, -2)];
    },
    events: [{
      t: 1.9,
      fire: (w, m) => {
        const p = w.beyPos(0);
        const out = new THREE.Vector3(p.x, 0, p.z).normalize();
        w.lang.hit({ pos: p.clone().addScaledVector(out, 0.7), normal: out.negate(), m, attacker: 0 });
      },
    }],
    continuous(t, dt, w, m) {
      if (t < 0.3 || t >= 1.9) return;
      const p = w.beyPos(0);
      const out = new THREE.Vector3(p.x, 0, p.z).normalize();
      const tangent = new THREE.Vector3(-out.z, 0, out.x);
      w.lang.scrape({ pos: p.clone().addScaledVector(out, 0.7).setY(p.y - 0.1), normal: out.clone().negate(), tangent, m, slot: 0 }, dt);
      moving(w, 0, m, dt);
    },
    focus(t, _m, R) {
      const th = t < 0.3 ? -0.9 : t < 1.9 ? -0.9 + 1.8 * ((t - 0.3) / 1.6) : 0.9;
      return [Math.cos(th) * (R - 3), Math.sin(th) * (R - 3)];
    },
  },
  {
    id: 'ringout',
    label: 'Ring-out',
    duration: 3.2,
    pose(t) {
      const ax = t < 0.6 ? 4.8 + 1.5 * (t / 0.6) : 6.3 - 0.6 * easeOut((t - 0.6) / 0.5);
      const k = (t - 0.6) / 0.9;
      const bx = t < 0.6 ? 7 : 7 + 6.5 * clamp01(k);
      return [P(ax, 0), P(bx, 0, { lift: t < 0.6 ? 0 : 3.4 * Math.sin(Math.PI * clamp01(k) * 0.8), tilt: t < 0.6 ? 0 : 1.2 * clamp01(k), tiltDir: 0, visible: t < 1.5 })];
    },
    events: [
      { t: 0.6, fire: (w, m) => w.lang.hit({ pos: contact(w), normal: V(1, 0.4, 0).normalize(), m: Math.max(m, 0.6), attacker: 0 }) },
      { t: 1.29, fire: (w, m) => w.lang.ringOut({ pos: w.beyPos(1), dir: V(1, 0.35, 0).normalize(), m: Math.max(m, 0.6), slot: 1 }) },
    ],
    continuous(t, dt, w, m) {
      if (t > 0.6 && t < 1.5) moving(w, 1, m, dt);
    },
    focus: () => [8.5, 0],
  },
];

export { RING_Y };
