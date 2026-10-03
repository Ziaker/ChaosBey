// Owner, 2026-10-02 (Lote 4, item 6): one X press — short or held — is
// exactly one player-started flight: one takeoff, one landing, a single
// apex, and no visible bounce (> 3 cm) after landing from the Bey's own jump.
// Swept over press durations 1-40 ticks, flat and bowl floors, standing and
// at 11 m/s, through the real tickMatch().

import { describe, expect, it } from 'vitest';
import type { ArenaFloorId } from '../../src/arena/floor/ArenaFloorProfile';
import { floorHeightAt } from '../../src/arena/floor/ArenaFloorProfile';
import { BEY_SPAWN_HEIGHT_M } from '../../src/bey/core/BeyTuning';
import { Action, type ControllerActions } from '../../src/input/actions/Action';
import { isGrounded } from '../../src/physics/collision/GroundCheck';
import { CombatHarness } from './combatHarness';

/** The jump's own landing is judged over this many ticks after touchdown (a bounce shows within it; later airtime on a bowl is the terrain at speed, which a no-jump run shows too). */
const AFTER_LANDING_TICKS = 24;

const NONE: ControllerActions = { held: new Set(), pressedThisFrame: new Set(), attackHoldDurationSeconds: 0, jumpDriftHoldDurationSeconds: 0 };

export interface FlightTrace {
  takeoffs: number;
  landings: number;
  /** Local maxima of the height above the floor while airborne (one per flight if the arc is clean). */
  apexes: number;
  /** Highest height above the floor reached after the first landing (a bounce), m. */
  bounceAfterLandingM: number;
  apexM: number;
}

export async function traceJump(floor: ArenaFloorId, speedMps: number, pressTicks: number, overrides = {}): Promise<FlightTrace> {
  // Start far from the centre on a bowl so the 11 m/s run stays on a gentle part of the floor; second Bey parked far away.
  const harness = await CombatHarness.create({ x: -6, y: BEY_SPAWN_HEIGHT_M, z: -6 }, { x: 25, y: BEY_SPAWN_HEIGHT_M, z: 25 }, { arenaFloor: floor, ...overrides });
  const forward = (pressed: boolean, held: boolean): ControllerActions => ({
    ...NONE,
    held: new Set([...(speedMps > 0 ? [Action.MoveForward] : []), ...(held ? [Action.JumpDrift] : [])]),
    pressedThisFrame: new Set(pressed ? [Action.JumpDrift] : []),
  });
  // Settle, then (when moving) get up to speed.
  for (let i = 0; i < 30; i++) harness.tick(NONE, NONE);
  for (let i = 0; i < 80 && speedMps > 0; i++) {
    const v = harness.first.body.linvel();
    const s = Math.hypot(v.x, v.z);
    if (s > speedMps) {
      harness.first.body.setLinvel({ x: (v.x / s) * speedMps, y: v.y, z: (v.z / s) * speedMps }, true);
      break;
    }
    harness.tick(forward(false, false), NONE);
  }
  const heightAboveFloor = (): number => {
    const p = harness.first.body.translation();
    return p.y - floorHeightAt(floor, p.x, p.z);
  };
  const restHeight = heightAboveFloor();
  let wasGrounded = isGrounded(harness.physics, harness.first.collider);
  const trace: FlightTrace = { takeoffs: 0, landings: 0, apexes: 0, bounceAfterLandingM: 0, apexM: 0 };
  let prevH = restHeight;
  let rising = false;
  let landedAt = -1;
  let bounceBase: number | null = null;
  for (let t = 0; t < 150 && (landedAt < 0 || t <= landedAt + AFTER_LANDING_TICKS); t++) {
    const a = pressTicks < 0 ? forward(false, false) : t === 0 ? forward(true, true) : forward(false, t < pressTicks);
    harness.tick(a, NONE);
    const g = isGrounded(harness.physics, harness.first.collider);
    if (wasGrounded && !g) trace.takeoffs++;
    if (!wasGrounded && g) {
      trace.landings++;
      if (landedAt < 0) landedAt = t;
    }
    wasGrounded = g;
    const h = heightAboveFloor() - restHeight;
    if (h > prevH + 1e-4) rising = true;
    else if (rising && h < prevH - 1e-4) {
      rising = false;
      if (prevH > 0.02) trace.apexes++;
    }
    if (trace.landings === 0) trace.apexM = Math.max(trace.apexM, h);
    else if (!g) {
      // A bounce is a second airborne phase after the landing: its rise above where it left the floor. (Height above
      // the floor itself shifts by a few cm on a bowl slope just from where the Bey lands, so it is not compared.)
      if (bounceBase === null) bounceBase = h;
      trace.bounceAfterLandingM = Math.max(trace.bounceAfterLandingM, h - bounceBase);
    } else bounceBase = null;
    prevH = h;
  }
  harness.dispose();
  return trace;
}

describe('one X press = one flight (owner, 2026-10-02)', () => {
  for (const floor of ['flat', 'bowl-a'] as const) {
    for (const speed of [0, 11]) {
      it(`${floor}, ${speed} m/s: press 1-40 ticks → 1 takeoff, 1 landing, 1 apex, no bounce > 3 cm`, async () => {
        const failures: string[] = [];
        for (let press = 1; press <= 40; press++) {
          const t = await traceJump(floor, speed, press);
          if (t.takeoffs !== 1 || t.landings !== 1 || t.apexes !== 1 || t.bounceAfterLandingM > 0.03) {
            failures.push(`press ${press}: takeoffs ${t.takeoffs}, landings ${t.landings}, apexes ${t.apexes}, bounce ${(t.bounceAfterLandingM * 100).toFixed(1)} cm, apex ${(t.apexM * 100).toFixed(1)} cm`);
          }
        }
        expect(failures).toEqual([]);
      }, 120_000);
    }
  }
});
