// ============================================================
// JUMP INPUT BUFFER — MANDATORY REGRESSION TESTS
// DriftController's Idle/Recovering states used to gate beginHop() on a
// same-tick `jumpDriftPressed && grounded`: a legitimate press landing on a
// tick where grounded briefly read false (a bounce, a knockback settling,
// the ground check a tick or two late right before a real landing) was
// silently and permanently dropped — confirmed happening in real AI matches
// via direct input-event/landing instrumentation (not inferred from height
// data). The fix buffers that press for a short, tunable window
// (JUMP_INPUT_BUFFER_WINDOW_S, DriftTuning.ts) instead of dropping it. This
// is NOT coyote time (that would let a hop start with no press at all); see
// DriftTuning.ts's own comment for the distinction.
//
// Driven directly through DriftController.tick() with a minimal body stub
// (linvel/setLinvel only — the same lightweight mock this suite's other
// DriftController tests use; DriftController must never call
// body.translation()). No retries anywhere in this file or needed: every
// test below is a pure, synchronous state-machine trace.
// ============================================================

import { describe, expect, it } from 'vitest';
import { Action } from '../../src/input/actions/Action';
import type { ControllerActions } from '../../src/input/actions/Action';
import { DriftController, DriftState, type DriftTickResult } from '../../src/drift/DriftController';
import { HOP_MIN_AIRBORNE_DURATION_S, JUMP_INPUT_BUFFER_WINDOW_S, JUMP_LAUNCH_VELOCITY_MPS, JUMP_RELEASE_WINDOW_S } from '../../src/drift/DriftTuning';
import { FIXED_DELTA_SECONDS } from '../../src/physics/fixed-step/FixedTimestepLoop';
import { GRAVITY_MPS2 } from '../../src/physics/world/PhysicsWorld';

/** Minimal stand-in for the two RAPIER.RigidBody methods DriftController touches. */
function stubBody() {
  let vel = { x: 0, y: 0, z: 0 };
  return {
    linvel: () => vel,
    setLinvel: (v: { x: number; y: number; z: number }) => {
      vel = v;
    },
  } as unknown as Parameters<DriftController['tick']>[0];
}

function actions(held: Action[], pressed: Action[] = []): ControllerActions {
  return { held: new Set(held), pressedThisFrame: new Set(pressed), attackHoldDurationSeconds: 0, jumpDriftHoldDurationSeconds: 0 };
}

const DT = FIXED_DELTA_SECONDS;
const BUFFER_TICKS = Math.floor(JUMP_INPUT_BUFFER_WINDOW_S / DT);

/** Ticks the state machine spends transitioning INTO Hopping (one entry per hop that actually began). */
function hopBeginCount(results: readonly DriftTickResult[]): number {
  let count = 0;
  let previous: DriftState = DriftState.Idle;
  for (const r of results) {
    if (previous !== DriftState.Hopping && r.driftState === DriftState.Hopping) count++;
    previous = r.driftState;
  }
  return count;
}

describe('jump input buffer — A: a press during a brief airborne window immediately before landing (Idle)', () => {
  it('is preserved: the Bey lands and the hop begins exactly once', () => {
    const drift = new DriftController();
    const body = stubBody();
    const results: DriftTickResult[] = [];

    // Press while airborne (a bounce/contact-noise window, not mid-hop):
    // the old code dropped this permanently right here.
    results.push(drift.tick(body, actions([], [Action.JumpDrift]), false, DT));
    expect(results[0]!.driftState).toBe(DriftState.Idle); // not consumed yet — buffered, not begun.
    expect(body.linvel().y).toBe(0); // no launch impulse applied prematurely.

    // A couple more ticks of the same airborne noise.
    results.push(drift.tick(body, actions([]), false, DT));
    results.push(drift.tick(body, actions([]), false, DT));
    expect(results.every((r) => r.driftState === DriftState.Idle)).toBe(true);

    // Lands: the buffered press is consumed now, same as a same-tick press would be.
    const landed = drift.tick(body, actions([]), true, DT);
    results.push(landed);
    expect(landed.driftState).toBe(DriftState.Hopping);
    expect(body.linvel().y).toBe(JUMP_LAUNCH_VELOCITY_MPS); // the hop's one launch impulse, applied exactly once.
    expect(hopBeginCount(results)).toBe(1);
  });
});

describe('jump input buffer — B: the same scenario from Recovering', () => {
  /** Hop, land into Drifting, release X into Recovering — the exact setup the existing drift-grip-recovery tests in drift.test.ts use. */
  function enterRecovering(drift: DriftController, body: ReturnType<typeof stubBody>): void {
    const driftHeld = [Action.JumpDrift, Action.SteerRight];
    drift.tick(body, actions(driftHeld, [Action.JumpDrift]), true, DT); // hop
    for (let i = 0; i < 20; i++) drift.tick(body, actions(driftHeld), false, DT); // airborne
    expect(drift.tick(body, actions(driftHeld), true, DT).driftState).toBe(DriftState.Drifting); // land into drift
    expect(drift.tick(body, actions([]), true, DT).driftState).toBe(DriftState.Recovering); // release -> recovering
  }

  it('a press during a brief airborne window while Recovering is preserved: the hop begins exactly once', () => {
    const drift = new DriftController();
    const body = stubBody();
    enterRecovering(drift, body);
    const vyBeforeChain = body.linvel().y;

    const results: DriftTickResult[] = [];
    results.push(drift.tick(body, actions([], [Action.JumpDrift]), false, DT)); // press while airborne (a bounce mid-recovery)
    expect(results[0]!.driftState).toBe(DriftState.Recovering);
    results.push(drift.tick(body, actions([]), false, DT)); // still airborne
    expect(results[1]!.driftState).toBe(DriftState.Recovering);

    const landed = drift.tick(body, actions([]), true, DT); // lands
    results.push(landed);
    expect(landed.driftState).toBe(DriftState.Hopping);
    expect(body.linvel().y).toBe(vyBeforeChain + JUMP_LAUNCH_VELOCITY_MPS); // exactly one more launch impulse, on top of whatever vy already was.
    expect(hopBeginCount(results)).toBe(1);
  });
});

describe('jump input buffer — C: expiry', () => {
  it('a press not followed by a landing within the buffer window produces no later ghost hop', () => {
    const drift = new DriftController();
    const body = stubBody();

    drift.tick(body, actions([], [Action.JumpDrift]), false, DT); // buffer starts

    // Stay airborne well past the window — several ticks of margin either side of it.
    const ticksToExpire = BUFFER_TICKS + 5;
    const results: DriftTickResult[] = [];
    for (let i = 0; i < ticksToExpire; i++) {
      results.push(drift.tick(body, actions([]), false, DT));
    }
    expect(results.every((r) => r.driftState === DriftState.Idle)).toBe(true);

    // Lands only now, long after the buffer expired: must NOT begin a hop.
    const afterExpiry = drift.tick(body, actions([]), true, DT);
    expect(afterExpiry.driftState).toBe(DriftState.Idle);
    expect(body.linvel().y).toBe(0); // no launch impulse — the press is gone, not a ghost hop.
  });
});

describe('jump input buffer — D: blur/focus loss cancels the pending buffer', () => {
  it('cancelBufferedJump() (called on window blur, KeyboardController.handleWindowBlur, GDD 131) clears a pending press before it can fire', () => {
    const drift = new DriftController();
    const body = stubBody();

    drift.tick(body, actions([], [Action.JumpDrift]), false, DT); // buffer starts
    drift.cancelBufferedJump(); // simulate the disruption

    const landed = drift.tick(body, actions([]), true, DT); // lands shortly after, well within what would have been the window
    expect(landed.driftState).toBe(DriftState.Idle);
    expect(body.linvel().y).toBe(0);
  });

  it('is a no-op when nothing is buffered (never throws, never disturbs an in-progress hop)', () => {
    const drift = new DriftController();
    const body = stubBody();
    expect(() => drift.cancelBufferedJump()).not.toThrow();

    // A normal same-tick hop is unaffected by a cancel call before or after it begins.
    drift.cancelBufferedJump();
    const hop = drift.tick(body, actions([], [Action.JumpDrift]), true, DT);
    expect(hop.driftState).toBe(DriftState.Hopping);
    drift.cancelBufferedJump();
    expect(drift.getState()).toBe(DriftState.Hopping);
  });
});

describe('jump input buffer — E: one press, at most one hop', () => {
  it('a press buffered while airborne, still held through landing and well beyond, begins exactly one hop', () => {
    const drift = new DriftController();
    const body = stubBody();
    const results: DriftTickResult[] = [];

    results.push(drift.tick(body, actions([], [Action.JumpDrift]), false, DT)); // buffered press while airborne
    results.push(drift.tick(body, actions([Action.JumpDrift]), false, DT)); // still held, still airborne (the bounce)
    results.push(drift.tick(body, actions([Action.JumpDrift]), true, DT)); // lands: consumes the buffer

    // Keep holding X well past HOP_MIN_AIRBORNE_DURATION_S and past this hop's own landing, with grounded continuously true (as a stubbed body would never move on its own) and no turn (no drift arming).
    const holdTicks = Math.ceil(HOP_MIN_AIRBORNE_DURATION_S / DT) + 10;
    for (let i = 0; i < holdTicks; i++) results.push(drift.tick(body, actions([Action.JumpDrift]), true, DT));

    expect(hopBeginCount(results)).toBe(1);
  });

  it('two genuinely separate airborne presses (release in between) each begin their own hop — buffering never merges or loses either', () => {
    const drift = new DriftController();
    const body = stubBody();
    const results: DriftTickResult[] = [];

    // First press while airborne, released before landing, lands, hops.
    results.push(drift.tick(body, actions([], [Action.JumpDrift]), false, DT));
    results.push(drift.tick(body, actions([]), false, DT)); // released
    results.push(drift.tick(body, actions([]), true, DT)); // lands -> Hopping
    expect(results[2]!.driftState).toBe(DriftState.Hopping);

    // Land this hop back in Idle (force grounded true with X not held — no turn, so Idle not Drifting).
    const landTicks = Math.ceil(HOP_MIN_AIRBORNE_DURATION_S / DT) + 2;
    for (let i = 0; i < landTicks; i++) results.push(drift.tick(body, actions([]), true, DT));
    expect(drift.getState()).toBe(DriftState.Idle);

    // Second, independent press while airborne again, buffered, lands, hops again.
    results.push(drift.tick(body, actions([], [Action.JumpDrift]), false, DT));
    results.push(drift.tick(body, actions([]), true, DT));

    expect(hopBeginCount(results)).toBe(2);
  });
});

describe('jump input buffer — F: the hold-duration curve is unchanged for a buffered hop', () => {
  /**
   * Runs a hop that begins via the buffer (press while airborne, then
   * landing), holds JumpDrift for `holdTicksAfterLanding` ticks after the
   * hop begins, and returns the resulting TOTAL apex height — not the raw
   * cut velocity, which is not itself monotonic in hold time (a later cut
   * starts from more height-already-gained but a smaller remaining rise;
   * see computeJumpReleaseCapMps's own comment). Apex height is computed
   * from the exact same energy-conservation identity DriftController's own
   * math relies on (heightAlreadyGainedM + vy^2/(2g), constant from the cut
   * onward under gravity alone) — the stub body has no gravity/position of
   * its own to measure a real apex from.
   */
  function bufferedHopTotalApexM(holdTicksAfterLanding: number): number {
    const drift = new DriftController();
    const body = stubBody();
    drift.tick(body, actions([], [Action.JumpDrift]), false, DT); // buffered press while airborne
    drift.tick(body, actions([]), false, DT); // bounce noise, still airborne
    const landed = drift.tick(body, actions(holdTicksAfterLanding > 0 ? [Action.JumpDrift] : []), true, DT); // lands -> begins hop
    expect(landed.driftState).toBe(DriftState.Hopping);

    let elapsedTicks = 0;
    for (let i = 1; i < holdTicksAfterLanding; i++) {
      drift.tick(body, actions([Action.JumpDrift]), false, DT);
      elapsedTicks++;
    }
    // One release tick so the cut applies (or a few more held ticks to run past the window for the "full" case).
    if (holdTicksAfterLanding * DT < JUMP_RELEASE_WINDOW_S) {
      drift.tick(body, actions([]), false, DT);
    } else {
      for (let i = 0; i < 3; i++) drift.tick(body, actions([Action.JumpDrift]), false, DT);
    }
    const t = elapsedTicks * DT;
    const heightAlreadyGainedM = JUMP_LAUNCH_VELOCITY_MPS * t - 0.5 * GRAVITY_MPS2 * t * t;
    const vy = body.linvel().y;
    return heightAlreadyGainedM + (vy * vy) / (2 * GRAVITY_MPS2);
  }

  it('short < medium < full apex, exactly the existing invariant, is preserved when the hop began from a buffered press', () => {
    const shortApexM = bufferedHopTotalApexM(1);
    const mediumApexM = bufferedHopTotalApexM(Math.round(JUMP_RELEASE_WINDOW_S / DT / 2));
    expect(shortApexM).toBeLessThan(mediumApexM);

    // "Full" (held past the release window) never gets a cut at all — vy
    // stays exactly the launch velocity (computeJumpReleaseCapMps's own
    // comment: every cut it ever applies is <= the natural decay curve, and
    // past the window there is nothing left to cut). Its real apex would
    // then be naturalFullApexM under real gravity integration, which the
    // stub body here has none of to measure directly — so this checks the
    // one fact that actually distinguishes "full" from a cut hop: no
    // reduction was applied.
    const drift = new DriftController();
    const body = stubBody();
    drift.tick(body, actions([], [Action.JumpDrift]), false, DT); // buffered press while airborne
    drift.tick(body, actions([]), false, DT); // bounce noise, still airborne
    drift.tick(body, actions([Action.JumpDrift]), true, DT); // lands -> begins hop
    for (let i = 0; i < Math.ceil(JUMP_RELEASE_WINDOW_S / DT) + 5; i++) drift.tick(body, actions([Action.JumpDrift]), false, DT);
    expect(body.linvel().y).toBe(JUMP_LAUNCH_VELOCITY_MPS); // uncut — strictly the tallest of the three.

    const naturalFullApexM = (JUMP_LAUNCH_VELOCITY_MPS * JUMP_LAUNCH_VELOCITY_MPS) / (2 * GRAVITY_MPS2);
    expect(mediumApexM).toBeLessThan(naturalFullApexM);
  });

  it('a buffered hop\'s short-tap cut matches a normal (same-tick) hop\'s short-tap cut — the buffer changes nothing about the curve itself', () => {
    const bufferedShortVy = (() => {
      const drift = new DriftController();
      const body = stubBody();
      drift.tick(body, actions([], [Action.JumpDrift]), false, DT); // buffered press while airborne
      drift.tick(body, actions([]), false, DT); // bounce noise, still airborne
      drift.tick(body, actions([Action.JumpDrift]), true, DT); // lands -> begins hop
      drift.tick(body, actions([]), false, DT); // released on the very next tick
      return body.linvel().y;
    })();

    const drift = new DriftController();
    const body = stubBody();
    drift.tick(body, actions([], [Action.JumpDrift]), true, DT); // same-tick press, grounded — the normal (unbuffered) path.
    drift.tick(body, actions([]), false, DT); // released on the very next tick, same timing as the buffered path above.
    const normalShortVy = body.linvel().y;
    expect(bufferedShortVy).toBeCloseTo(normalShortVy, 5);
  });
});

describe('jump input buffer — G: drift still arms and starts via the existing, unchanged rule', () => {
  it('a buffered press that begins a hop still arms the drift on a turn, and still lands into Drifting exactly as an unbuffered hop would', () => {
    const drift = new DriftController();
    const body = stubBody();
    const driftHeld = [Action.JumpDrift, Action.SteerRight];

    drift.tick(body, actions([], [Action.JumpDrift]), false, DT); // buffered press while airborne, no turn yet
    const landed = drift.tick(body, actions(driftHeld, []), true, DT); // lands -> Hopping, turn now held
    expect(landed.driftState).toBe(DriftState.Hopping);

    for (let i = 0; i < 20; i++) drift.tick(body, actions(driftHeld), false, DT); // airborne, held + turned
    const landedIntoDrift = drift.tick(body, actions(driftHeld), true, DT);
    expect(landedIntoDrift.driftState).toBe(DriftState.Drifting);
  });
});
