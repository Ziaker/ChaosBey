// ============================================================
// BEY MOTION LAB — REPRODUCIBLE TEST SCENARIOS
// Scripted inputs + scripted attack hits, no randomness: the same
// scenario with the same parameters always plays out identically, so
// presets and slider changes can be compared shot for shot.
// Headings: 0 = toward +z, π/2 = toward +x. The arena is 12 m in radius.
// ============================================================

import type { BeyInit, BeyBody, DriveInput, ScriptedHit } from './model';

export interface Scenario {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly duration: number;
  readonly beys: readonly BeyInit[];
  readonly hits?: readonly ScriptedHit[];
  /** Inputs per Bey at time t. */
  input(t: number, bodies: readonly BeyBody[]): DriveInput[];
}

const idle: DriveInput = { throttle: 0, steer: 0 };
const PI = Math.PI;

/** Steer Bey `b` toward a world heading (simple proportional steering, as a player would). */
function steerToward(b: BeyBody, heading: number, gain = 2.5): number {
  let d = heading - b.heading;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return Math.max(-1, Math.min(1, d * gain));
}

export const SCENARIOS: readonly Scenario[] = [
  {
    id: 'straight',
    label: 'Straight acceleration',
    description: 'From rest, full throttle across the arena for 1.4 s, then coast.',
    duration: 4,
    beys: [{ x: 0, z: 8, heading: PI }],
    input: (t) => [{ throttle: t < 1.4 ? 1 : 0, steer: 0 }],
  },
  {
    id: 'curve',
    label: 'High-speed curve',
    description: 'Enters at top speed and holds a hard right turn: lean into the turn, grip vs. slide.',
    duration: 5,
    beys: [{ x: -6, z: 0, heading: 0, speed: 11 }],
    input: () => [{ throttle: 1, steer: 0.85 }],
  },
  {
    id: 'diagonal',
    label: 'Diagonal / heading vs velocity',
    description: 'Runs north at speed, then snaps the heading 50° right while thrusting: travel lags behind the facing.',
    duration: 3.5,
    beys: [{ x: -3, z: 7, heading: PI, speed: 9 }],
    input: (t, [b]) => [{ throttle: 1, steer: t < 0.6 ? 0 : steerToward(b!, PI - 0.87, 6) }],
  },
  {
    id: 'drift',
    label: 'Drift / slip',
    description: 'At top speed, full-lock turn off the throttle for 0.7 s: the tip breaks loose and slides, then grip returns while it coasts.',
    duration: 3,
    beys: [{ x: 5, z: 7, heading: PI, speed: 11 }],
    input: (t) => [{ throttle: t < 0.2 ? 1 : t > 0.9 ? 0.25 : 0, steer: t > 0.2 && t < 0.9 ? 1 : 0 }],
  },
  {
    id: 'wall',
    label: 'Wall impact (head-on)',
    description: 'Straight into the wall at 9 m/s: bounce, tilt kick, wobble, recovery.',
    duration: 3.5,
    beys: [{ x: 0, z: 4, heading: 0, speed: 9 }],
    input: (t) => [{ throttle: t < 0.6 ? 1 : 0, steer: 0 }],
  },
  {
    id: 'ricochet',
    label: 'Ricochet (40°)',
    description: 'Hits the wall at 40° and 10 m/s: angle out, spin/whirl transfer from the glancing component.',
    duration: 3.5,
    beys: [{ x: -4, z: 2, heading: 0.7, speed: 10 }],
    input: () => [idle],
  },
  {
    id: 'scrape',
    label: 'Wall scrape',
    description: 'Glances the wall at a shallow angle while steering into it: sliding contact along the rim.',
    duration: 3,
    beys: [{ x: -6.5, z: 9.4, heading: 1.62, speed: 9 }],
    input: () => [{ throttle: 0.6, steer: -0.35 }],
  },
  {
    id: 'knock-weak',
    label: 'Weak knockback',
    description: 'A Bey at 6 m/s rams a still one: a light push, small tilt and wobble.',
    duration: 3,
    beys: [
      { x: 0, z: 4, heading: PI, speed: 6 },
      { x: 0, z: 0, heading: 0 },
    ],
    hits: [{ t: 0.47, from: 0, to: 1, knockback: 3 }],
    input: (t) => [{ throttle: t < 0.4 ? 1 : 0, steer: 0 }, idle],
  },
  {
    id: 'knock-strong',
    label: 'Strong knockback',
    description: 'A Dash-speed hit (16 m/s) with a big knockback: launch, tilt, whirl, landing, recovery.',
    duration: 4,
    beys: [
      { x: 0, z: 6, heading: PI, speed: 16 },
      { x: 0, z: 0, heading: 0 },
    ],
    hits: [{ t: 0.3, from: 0, to: 1, knockback: 12 }],
    input: () => [idle, idle],
  },
  {
    id: 'tumble',
    label: 'Tumble (glancing strong hit)',
    description: 'An off-center Dash-speed hit: most of the impact becomes whirl and a big lean — the "rodopio".',
    duration: 4,
    beys: [
      { x: 0.9, z: 6, heading: PI, speed: 17 },
      { x: 0, z: 0, heading: 0 },
    ],
    hits: [{ t: 0.3, from: 0, to: 1, knockback: 11 }],
    input: () => [idle, idle],
  },
  {
    id: 'bounce',
    label: 'Floor bounce',
    description: 'Launched up at 5 m/s while sliding: airborne arc, landing bounces, landing tilt kick.',
    duration: 3.5,
    beys: [{ x: 0, z: 4, heading: PI, speed: 5, vy: 5, y: 0.01 }],
    input: () => [idle],
  },
  {
    id: 'wobble',
    label: 'Wobble & recovery',
    description: 'A single moderate hit on a Bey at rest: watch the wobble, the precession-like circling and the return upright.',
    duration: 4,
    beys: [
      { x: 0, z: 1.6, heading: PI },
      { x: 0, z: 0, heading: 0 },
    ],
    hits: [{ t: 0.2, from: 0, to: 1, knockback: 5, extraLift: -0.5 }],
    input: () => [idle, idle],
  },
  {
    id: 'm7-ext0-analog',
    label: 'M7 ext-0 analog: counter → ring-out',
    description: 'Analog of the M7 ext-0 case: a Dash met by a Circular counter near the edge; the dasher is launched back toward the wall. Does it leave the arena (the game did, ~1.7 s)?',
    duration: 3,
    beys: [
      { x: 0, z: 5, heading: PI, speed: 15 },
      { x: 0, z: 2.5, heading: 0 },
    ],
    // The game's launch in ext-0 was ~28 m/s outward with 7.4 m/s up (knockback force 37.6).
    hits: [{ t: 0.14, from: 1, to: 0, knockback: 28 }],
    input: () => [idle, idle],
  },
  {
    id: 'm7-ext32-analog',
    label: 'M7 ext-32 analog: pinned at the wall',
    description: 'Analog of the M7 ext-32 case: a Bey driven into the wall by an opponent that keeps pushing. In the game one got wedged in the wall collider for many seconds; here the wall is a clean circle, so this shows the intended contact behavior to compare against the replay.',
    duration: 6,
    beys: [
      { x: 0, z: 9.5, heading: 0 },
      { x: 0, z: 7.5, heading: 0, speed: 6 },
    ],
    input: (t, bodies) => [{ throttle: 0.4, steer: steerToward(bodies[0]!, PI) }, { throttle: t < 4 ? 1 : 0, steer: 0 }],
  },
];
