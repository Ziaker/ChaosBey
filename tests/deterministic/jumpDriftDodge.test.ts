// ============================================================
// MILESTONE 3 — JUMP / DRIFT / DODGE SELF-TEST SUITE
// Full-integration scenarios driven through the real tickMatch()
// orchestration via CombatHarness (GDD section 114/150: exercise the real
// controllers, not a simplified stand-in).
// ============================================================

import { describe, expect, it } from 'vitest';
import { AttackState } from '../../src/combat/attacks/AttackController';
import { CIRCULAR_ACTIVE_DURATION_S } from '../../src/combat/attacks/AttackTuning';
import { DriftState } from '../../src/drift/DriftController';
import { DodgeState } from '../../src/dodge/DodgeController';
import {
  DODGE_ACTIVE_DURATION_S,
  DODGE_BURST_SPEED_MPS,
  DODGE_COOLDOWN_S,
  DODGE_PERFECT_WINDOW_S,
  DODGE_STAMINA_COST,
} from '../../src/dodge/DodgeTuning';
import { JUMP_ASSIST_MAX_DURATION_S } from '../../src/drift/DriftTuning';
import { LATERAL_GRIP_PER_S } from '../../src/bey/movement/MovementTuning';
import { BEY_SPAWN_HEIGHT_M } from '../../src/bey/core/BeyTuning';
import { ScriptedController, type ScriptedFrame } from '../../src/automation/scripted-scenarios/ScriptedController';
import { Action, type ControllerActions } from '../../src/input/actions/Action';
import { FIXED_DELTA_SECONDS } from '../../src/physics/fixed-step/FixedTimestepLoop';
import { CombatHarness } from './combatHarness';

const NO_ACTIONS: ControllerActions = {
  held: new Set(),
  pressedThisFrame: new Set(),
  attackHoldDurationSeconds: 0,
  jumpDriftHoldDurationSeconds: 0,
};

const CLOSE_FIRST_SPAWN = { x: 0, y: BEY_SPAWN_HEIGHT_M, z: -0.75 };
const CLOSE_SECOND_SPAWN = { x: 0, y: BEY_SPAWN_HEIGHT_M, z: 0.75 };

function settle(harness: CombatHarness, ticks = 40): void {
  for (let i = 0; i < ticks; i++) {
    harness.tick(NO_ACTIONS, NO_ACTIONS);
  }
}

function tapJumpController(): ScriptedController {
  return new ScriptedController([
    { fromTick: 0, held: [Action.JumpDrift] },
    { fromTick: 2, held: [] },
  ]);
}

function heldJumpController(holdTicks: number): ScriptedController {
  return new ScriptedController([
    { fromTick: 0, held: [Action.JumpDrift] },
    { fromTick: holdTicks, held: [] },
  ]);
}

function pressFrames(ticks: number[]): ScriptedFrame[] {
  const frames: ScriptedFrame[] = [];
  for (const t of ticks) {
    frames.push({ fromTick: t, held: [Action.Dodge] });
    frames.push({ fromTick: t + 1, held: [] });
  }
  return frames;
}

/**
 * Dodge presses that also hold a lateral steer, so the burst goes sideways
 * (perpendicular to heading) instead of defaulting to forward — with these
 * two Beys facing their spawn-default heading (0), "forward" happens to
 * point directly away from the opponent, which would carry the dodger out
 * of the attack's reach almost immediately regardless of i-frames. Holding
 * a steer direction keeps the scenario about i-frame timing, not a
 * coincidence of default heading vs. spawn layout.
 */
function sidewaysDodgePressFrames(ticks: number[]): ScriptedFrame[] {
  const frames: ScriptedFrame[] = [];
  for (const t of ticks) {
    frames.push({ fromTick: t, held: [Action.Dodge, Action.SteerRight] });
    frames.push({ fromTick: t + 1, held: [] });
  }
  return frames;
}

/** Circular Attack tap starting (and thus becoming CircularActive) at a chosen tick. */
function delayedTapController(pressAtTick: number): ScriptedController {
  return new ScriptedController([
    { fromTick: pressAtTick, held: [Action.Attack] },
    { fromTick: pressAtTick + 2, held: [] },
  ]);
}

describe('variable jump height', () => {
  it('holding JumpDrift through the ascent reaches a higher apex than a bare tap', async () => {
    const tapHarness = await CombatHarness.create(CLOSE_FIRST_SPAWN, CLOSE_SECOND_SPAWN);
    settle(tapHarness);
    const tapController = tapJumpController();
    let tapApex = 0;
    for (let i = 0; i < 60; i++) {
      tapHarness.tick(tapController.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }), NO_ACTIONS);
      tapApex = Math.max(tapApex, tapHarness.first.body.translation().y);
    }

    const heldHarness = await CombatHarness.create(CLOSE_FIRST_SPAWN, CLOSE_SECOND_SPAWN);
    settle(heldHarness);
    const holdTicks = Math.ceil(JUMP_ASSIST_MAX_DURATION_S / FIXED_DELTA_SECONDS) + 5;
    const heldController = heldJumpController(holdTicks);
    let heldApex = 0;
    for (let i = 0; i < 60; i++) {
      heldHarness.tick(heldController.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }), NO_ACTIONS);
      heldApex = Math.max(heldApex, heldHarness.first.body.translation().y);
    }

    expect(heldApex).toBeGreaterThan(tapApex);
  });
});

describe('landing data (Milestone 4 prep)', () => {
  it('a bare tap hop reports a weak landing with no grip penalty', async () => {
    const harness = await CombatHarness.create(CLOSE_FIRST_SPAWN, CLOSE_SECOND_SPAWN);
    settle(harness);
    const controller = tapJumpController();

    let sawAirborne = false;
    let landed = false;
    let descentSpeedMps = -1;
    let intensity = -1;
    let jumpAssistElapsedS = -1;
    let gripAtLanding = -1;
    for (let i = 0; i < 60; i++) {
      const result = harness.tick(controller.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }), NO_ACTIONS);
      if (!result.first.grounded) sawAirborne = true;
      if (result.first.justLanded && !landed) {
        landed = true;
        descentSpeedMps = result.first.landingDescentSpeedMps;
        intensity = result.first.landingIntensity;
        jumpAssistElapsedS = result.first.landingJumpAssistElapsedS;
        gripAtLanding = result.first.movement.lateralGripPerS;
      }
    }

    expect(sawAirborne).toBe(true);
    expect(landed).toBe(true);
    expect(descentSpeedMps).toBeGreaterThan(0);
    expect(intensity).toBeGreaterThan(0);
    // A bare tap barely holds JumpDrift (released after 2 ticks) — nowhere
    // near the assist cap.
    expect(jumpAssistElapsedS).toBeLessThan(JUMP_ASSIST_MAX_DURATION_S * 0.2);
    // No handling penalty: grip is exactly normal the moment landing is reported.
    expect(gripAtLanding).toBeCloseTo(LATERAL_GRIP_PER_S, 2);
  });

  it('a big held jump reports a stronger landing than a bare tap, still with no grip penalty', async () => {
    const tapHarness = await CombatHarness.create(CLOSE_FIRST_SPAWN, CLOSE_SECOND_SPAWN);
    settle(tapHarness);
    const tapController = tapJumpController();
    let tapIntensity = -1;
    for (let i = 0; i < 60; i++) {
      const result = tapHarness.tick(tapController.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }), NO_ACTIONS);
      if (result.first.justLanded) tapIntensity = result.first.landingIntensity;
    }
    expect(tapIntensity).toBeGreaterThanOrEqual(0);

    const heldHarness = await CombatHarness.create(CLOSE_FIRST_SPAWN, CLOSE_SECOND_SPAWN);
    settle(heldHarness);
    const holdTicks = Math.ceil(JUMP_ASSIST_MAX_DURATION_S / FIXED_DELTA_SECONDS) + 5;
    const heldController = heldJumpController(holdTicks);
    let heldIntensity = -1;
    let heldJumpAssistElapsedS = -1;
    let gripAtLanding = -1;
    for (let i = 0; i < 200; i++) {
      const result = heldHarness.tick(heldController.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }), NO_ACTIONS);
      if (result.first.justLanded) {
        heldIntensity = result.first.landingIntensity;
        heldJumpAssistElapsedS = result.first.landingJumpAssistElapsedS;
        gripAtLanding = result.first.movement.lateralGripPerS;
        break;
      }
    }

    expect(heldIntensity).toBeGreaterThan(tapIntensity);
    expect(heldJumpAssistElapsedS).toBeGreaterThan(JUMP_ASSIST_MAX_DURATION_S * 0.5);
    expect(gripAtLanding).toBeCloseTo(LATERAL_GRIP_PER_S, 2);
  });

  it('landing is detected generically, even when this airborne period was not a jump (e.g. a knockback fall)', async () => {
    const harness = await CombatHarness.create(CLOSE_FIRST_SPAWN, CLOSE_SECOND_SPAWN);
    settle(harness);

    // Launch upward directly, with no JumpDrift press at all — DriftState
    // never leaves Idle — to simulate a knockback/catch-launch fall.
    const vel = harness.first.body.linvel();
    harness.first.body.setLinvel({ x: vel.x, y: 6, z: vel.z }, true);

    let visitedNonIdleDriftState = false;
    let landedGenerically = false;
    // vel.y=6 against gravity takes ~2*6/9.81 =~ 1.2s (~73 ticks at 60Hz)
    // to come back down — give it enough room.
    for (let i = 0; i < 100; i++) {
      const result = harness.tick(NO_ACTIONS, NO_ACTIONS);
      if (result.first.driftState !== DriftState.Idle) visitedNonIdleDriftState = true;
      if (result.first.justLanded) {
        landedGenerically = true;
        expect(result.first.landingDescentSpeedMps).toBeGreaterThan(0);
        expect(result.first.landingJumpAssistElapsedS).toBe(0);
        break;
      }
    }

    expect(visitedNonIdleDriftState).toBe(false);
    expect(landedGenerically).toBe(true);
  });
});

describe('dodge i-frames', () => {
  it('nullifies a Circular Attack that would otherwise connect, without triggering the normal knockback/stability path', async () => {
    const harness = await CombatHarness.create(CLOSE_FIRST_SPAWN, CLOSE_SECOND_SPAWN);
    settle(harness);

    // second dodges starting tick2 (i-frames roughly ticks 2-32, per the
    // GDD-approved 0.5s window); first's Circular Attack becomes active at
    // tick4 — well inside that window.
    const attacker = delayedTapController(2);
    const dodger = new ScriptedController(sidewaysDodgePressFrames([2]));

    let sawConnectedHit = false;
    let sawDodgedEvent = false;
    for (let i = 0; i < 60; i++) {
      const result = harness.tick(
        attacker.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }),
        dodger.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }),
      );
      if (result.hitEvents.some((hit) => hit.attackerIsFirst)) sawConnectedHit = true;
      if (result.combatEvents.some((e) => e.kind === 'dodged' && !e.targetIsFirst)) sawDodgedEvent = true;
    }

    expect(sawConnectedHit).toBe(false);
    expect(sawDodgedEvent).toBe(true);
    expect(harness.second.stability.resource.fraction).toBe(1);
  });

  it('a hit inside the early sub-window counts as a Perfect Dodge; the same dodge later in its window does not', async () => {
    // Perfect: dodge at tick2 (perfect window ~2..11), attack active at tick4.
    const perfectHarness = await CombatHarness.create(CLOSE_FIRST_SPAWN, CLOSE_SECOND_SPAWN);
    settle(perfectHarness);
    const perfectAttacker = delayedTapController(2);
    const perfectDodger = new ScriptedController(sidewaysDodgePressFrames([2]));
    let sawPerfect = false;
    for (let i = 0; i < 60; i++) {
      const result = perfectHarness.tick(
        perfectAttacker.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }),
        perfectDodger.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }),
      );
      if (result.combatEvents.some((e) => e.kind === 'perfectDodge' && !e.targetIsFirst)) sawPerfect = true;
    }
    expect(sawPerfect).toBe(true);

    // Not perfect: dodge at tick0, hit checked past the perfect window
    // (~9 ticks) but still inside the full i-frame window (~30 ticks).
    // The dodge's own burst would otherwise carry the target sideways far
    // enough to leave Circular Attack's tight reach margin before the hit
    // is even checked, which would falsely read as "no dodge needed" —
    // pin position/velocity while the dodge timer runs past the perfect
    // window, purely to isolate i-frame *timing* from that positional side
    // effect, then let the attacker's hit through normally.
    const lateHarness = await CombatHarness.create(CLOSE_FIRST_SPAWN, CLOSE_SECOND_SPAWN);
    settle(lateHarness);
    // The resting height after settling, not the (higher) spawn height —
    // teleporting back to the spawn height every tick below would hold the
    // Bey permanently just above the floor, never actually touching it.
    const restingY = lateHarness.second.body.translation().y;
    const lateDodger = new ScriptedController(pressFrames([0]));
    const pinTicks = 15; // > DODGE_PERFECT_WINDOW_S (~9 ticks), < DODGE_ACTIVE_DURATION_S (~30 ticks)
    for (let i = 0; i < pinTicks; i++) {
      lateHarness.tick(NO_ACTIONS, lateDodger.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }));
      lateHarness.second.body.setTranslation({ x: CLOSE_SECOND_SPAWN.x, y: restingY, z: CLOSE_SECOND_SPAWN.z }, true);
      lateHarness.second.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    }

    const lateAttacker = new ScriptedController([
      { fromTick: 0, held: [Action.Attack] },
      { fromTick: 2, held: [] },
    ]);
    let sawDodgedLate = false;
    let sawPerfectLate = false;
    for (let i = 0; i < 30; i++) {
      const result = lateHarness.tick(
        lateAttacker.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }),
        lateDodger.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }),
      );
      if (result.combatEvents.some((e) => e.kind === 'dodged' && !e.targetIsFirst)) sawDodgedLate = true;
      if (result.combatEvents.some((e) => e.kind === 'perfectDodge' && !e.targetIsFirst)) sawPerfectLate = true;
    }
    expect(sawDodgedLate).toBe(true);
    expect(sawPerfectLate).toBe(false);
  });

  it('cannot be re-triggered during its own cooldown, but can again once the cooldown elapses', async () => {
    const harness = await CombatHarness.create(CLOSE_FIRST_SPAWN, CLOSE_SECOND_SPAWN);
    settle(harness);

    const cooldownEndTick = Math.ceil(DODGE_ACTIVE_DURATION_S / FIXED_DELTA_SECONDS) + Math.ceil(DODGE_COOLDOWN_S / FIXED_DELTA_SECONDS);
    const retryDuringCooldownTick = 20;
    expect(retryDuringCooldownTick).toBeLessThan(cooldownEndTick);
    const retryAfterCooldownTick = cooldownEndTick + 5;

    const dodger = new ScriptedController(pressFrames([0, retryDuringCooldownTick, retryAfterCooldownTick]));

    let dodgingEntriesCount = 0;
    let previousState: DodgeState | null = null;
    for (let i = 0; i < retryAfterCooldownTick + 5; i++) {
      const result = harness.tick(NO_ACTIONS, dodger.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }));
      if (result.second.dodgeState === DodgeState.Dodging && previousState !== DodgeState.Dodging) {
        dodgingEntriesCount++;
      }
      previousState = result.second.dodgeState;
    }

    // Exactly two real dodges: the initial one and the retry after cooldown
    // — the mid-cooldown press must not have started a third.
    expect(dodgingEntriesCount).toBe(2);
  });
});

describe('dodge timers keep advancing while airborne', () => {
  it('active and cooldown timers advance on simulated time even while airborne, without granting airborne i-frames', async () => {
    // Drives the real DodgeController directly (bypassing tickMatch) with
    // hand-picked `grounded` values instead of letting physics decide them
    // — the specific bug this guards is state-machine/lifecycle timing,
    // not physics, so this isolates it precisely: the controller must
    // never pause its own active/cooldown timers just because the Bey
    // happens to be airborne.
    const harness = await CombatHarness.create(CLOSE_FIRST_SPAWN, CLOSE_SECOND_SPAWN);
    settle(harness);
    const dodge = harness.second.dodge;
    const body = harness.second.body;

    const dodgePress: ControllerActions = {
      held: new Set([Action.Dodge]),
      pressedThisFrame: new Set([Action.Dodge]),
      attackHoldDurationSeconds: 0,
      jumpDriftHoldDurationSeconds: 0,
    };
    const noPress: ControllerActions = {
      held: new Set(),
      pressedThisFrame: new Set(),
      attackHoldDurationSeconds: 0,
      jumpDriftHoldDurationSeconds: 0,
    };

    const first = dodge.tick(body, dodgePress, 0, true, 999, FIXED_DELTA_SECONDS);
    expect(first.state).toBe(DodgeState.Dodging);
    expect(first.hasIFrames).toBe(true);

    const activeTicks = Math.ceil(DODGE_ACTIVE_DURATION_S / FIXED_DELTA_SECONDS);
    const cooldownTicks = Math.ceil(DODGE_COOLDOWN_S / FIXED_DELTA_SECONDS);

    let sawAirborneIFrames = false;
    let result = first;
    for (let i = 1; i < activeTicks + cooldownTicks + 5; i++) {
      result = dodge.tick(body, noPress, 0, false, 999, FIXED_DELTA_SECONDS);
      if (result.hasIFrames) sawAirborneIFrames = true;
    }

    expect(sawAirborneIFrames).toBe(false);
    // The cooldown fully elapsed purely from simulated ticks despite being
    // airborne the entire time — a frozen timer would still show Dodging
    // or Cooldown here.
    expect(result.state).toBe(DodgeState.Idle);
  });
});

describe('dodge stamina cost', () => {
  it('a valid dodge consumes exactly the configured Stamina cost', async () => {
    const harness = await CombatHarness.create(CLOSE_FIRST_SPAWN, CLOSE_SECOND_SPAWN);
    settle(harness);
    const staminaBefore = harness.second.stamina.resource.value;

    const dodger = new ScriptedController(pressFrames([0]));
    harness.tick(NO_ACTIONS, dodger.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }));

    // StaminaSystem.tick() also applies its own small baseline drain every
    // tick regardless of the dodge, so the observed drop is the dodge cost
    // plus at most one tick of that passive drain — bound it loosely rather
    // than asserting an exact match against DODGE_STAMINA_COST alone.
    const drained = staminaBefore - harness.second.stamina.resource.value;
    expect(drained).toBeGreaterThanOrEqual(DODGE_STAMINA_COST);
    expect(drained).toBeLessThan(DODGE_STAMINA_COST + 1);
  });

  it('insufficient Stamina prevents the dodge from starting at all', async () => {
    const harness = await CombatHarness.create(CLOSE_FIRST_SPAWN, CLOSE_SECOND_SPAWN);
    settle(harness);
    harness.second.stamina.resource.set(DODGE_STAMINA_COST - 1);
    const staminaBefore = harness.second.stamina.resource.value;

    const dodger = new ScriptedController(pressFrames([0]));
    const result = harness.tick(NO_ACTIONS, dodger.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }));

    expect(result.second.dodgeState).toBe(DodgeState.Idle);
    // Only the passive per-tick drain applies here — nowhere close to the
    // full dodge cost, since the dodge never actually started.
    expect(staminaBefore - harness.second.stamina.resource.value).toBeLessThan(DODGE_STAMINA_COST * 0.5);
  });
});

describe('air recovery', () => {
  // A drop this large can only be the fixed AIR_RECOVERY_WOBBLE_REDUCTION
  // (0.6) applying — ordinary passive decay over one or two ticks
  // (WOBBLE_DECAY_FRACTION_PER_S) is nowhere close.
  const AIR_RECOVERY_SIZED_DROP = 0.1;

  it('a normal jump does NOT enable air recovery (GDD section 21: only being launched/knocked airborne does)', async () => {
    const harness = await CombatHarness.create(CLOSE_FIRST_SPAWN, CLOSE_SECOND_SPAWN);
    settle(harness);
    harness.first.spin.registerImpact(harness.first.body, 8, { x: 0, z: 1 });

    // Hop to get airborne (no registerLaunch() involved anywhere here),
    // then try to dodge mid-air.
    const controller = new ScriptedController([
      { fromTick: 0, held: [Action.JumpDrift] },
      { fromTick: 2, held: [] },
      { fromTick: 3, held: [Action.Dodge] },
      { fromTick: 4, held: [] },
    ]);

    let wobbleBeforePress = 0;
    let wobbleAfterPress = 0;
    let sawAirborne = false;
    for (let i = 0; i < 20; i++) {
      const result = harness.tick(controller.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }), NO_ACTIONS);
      if (!result.first.grounded) sawAirborne = true;
      if (i === 2) wobbleBeforePress = result.first.spin.wobbleEnergy;
      if (i === 3) wobbleAfterPress = result.first.spin.wobbleEnergy;
    }

    expect(sawAirborne).toBe(true);
    expect(wobbleBeforePress - wobbleAfterPress).toBeLessThan(AIR_RECOVERY_SIZED_DROP);
  });

  it('a wall/floor impact that leaves the Bey grounded does not arm air recovery for a later normal jump', async () => {
    // Same spawn-at-center-and-drive-forward setup as the proven M1 wall
    // collision self-test (wallImpactAndSpin.test.ts) — a genuine
    // impactDeltaSpeedMps bounce through tickMatch's real wall-impact path,
    // not a hand-constructed one. Heading 0 => +Z is "forward".
    const harness = await CombatHarness.create({ x: 0, y: BEY_SPAWN_HEIGHT_M, z: 0 }, { x: 0, y: BEY_SPAWN_HEIGHT_M, z: -6 });
    settle(harness);

    const driver = new ScriptedController([{ fromTick: 0, held: [Action.MoveForward] }]);
    let sawWallImpact = false;
    let stayedGroundedThroughImpact = true;
    for (let i = 0; i < 400; i++) {
      const result = harness.tick(driver.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }), NO_ACTIONS);
      if (result.first.movement.impactDeltaSpeedMps > 0) {
        sawWallImpact = true;
        if (!result.first.grounded) stayedGroundedThroughImpact = false;
        break;
      }
    }
    expect(sawWallImpact).toBe(true);
    expect(stayedGroundedThroughImpact).toBe(true);

    // A normal jump right after the bounce must not have inherited air
    // recovery from it.
    harness.first.spin.registerImpact(harness.first.body, 8, { x: 0, z: 1 });
    const jumpController = new ScriptedController([
      { fromTick: 0, held: [Action.JumpDrift] },
      { fromTick: 2, held: [] },
      { fromTick: 3, held: [Action.Dodge] },
      { fromTick: 4, held: [] },
    ]);
    let wobbleBeforePress = 0;
    let wobbleAfterPress = 0;
    for (let i = 0; i < 20; i++) {
      const result = harness.tick(jumpController.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }), NO_ACTIONS);
      if (i === 2) wobbleBeforePress = result.first.spin.wobbleEnergy;
      if (i === 3) wobbleAfterPress = result.first.spin.wobbleEnergy;
    }

    expect(wobbleBeforePress - wobbleAfterPress).toBeLessThan(AIR_RECOVERY_SIZED_DROP);
  });

  it('being launched airborne (knockback/catch-launch) while grounded enables air recovery once it leaves the ground', async () => {
    const harness = await CombatHarness.create(CLOSE_FIRST_SPAWN, CLOSE_SECOND_SPAWN);
    settle(harness);
    harness.first.spin.registerImpact(harness.first.body, 8, { x: 0, z: 1 });

    // Reproduces exactly what tickMatch does on a real knockback: it calls
    // dodge.registerLaunch(false) (still grounded at the moment of the
    // launch) the same tick applyKnockback()/the catch-launch setLinvel()
    // fires, then the Bey actually leaves the ground a tick or two later
    // once physics resolves it.
    harness.first.dodge.registerLaunch(false);
    const vel = harness.first.body.linvel();
    harness.first.body.setLinvel({ x: vel.x, y: 6, z: vel.z }, true);

    const controller = new ScriptedController([
      { fromTick: 2, held: [Action.Dodge] },
      { fromTick: 3, held: [] },
    ]);

    let wobbleBeforePress = 0;
    let wobbleAfterPress = 0;
    let sawAirborne = false;
    for (let i = 0; i < 20; i++) {
      const result = harness.tick(controller.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }), NO_ACTIONS);
      if (!result.first.grounded) sawAirborne = true;
      if (i === 1) wobbleBeforePress = result.first.spin.wobbleEnergy;
      if (i === 2) wobbleAfterPress = result.first.spin.wobbleEnergy;
    }

    expect(sawAirborne).toBe(true);
    expect(wobbleBeforePress - wobbleAfterPress).toBeGreaterThanOrEqual(AIR_RECOVERY_SIZED_DROP);
  });

  it('receiving a launch while already airborne from a normal jump enables air recovery immediately', async () => {
    const harness = await CombatHarness.create(CLOSE_FIRST_SPAWN, CLOSE_SECOND_SPAWN);
    settle(harness);
    harness.first.spin.registerImpact(harness.first.body, 8, { x: 0, z: 1 });

    // Jump, then wait however many ticks it actually takes to read as
    // airborne (physics timing, not assumed) before a knockback lands on
    // the Bey mid-air (registerLaunch(true) — already airborne right now)
    // instead of nothing happening. It must arm air recovery for the
    // *current* airborne period immediately — there won't be another
    // grounded->airborne transition this period to catch it on.
    const jumpController = tapJumpController();
    let result = harness.tick(jumpController.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }), NO_ACTIONS);
    for (let i = 1; result.first.grounded && i < 30; i++) {
      result = harness.tick(jumpController.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }), NO_ACTIONS);
    }
    expect(result.first.grounded).toBe(false); // confirmed airborne from the jump.

    harness.first.dodge.registerLaunch(true);
    const wobbleBeforePress = result.first.spin.wobbleEnergy;

    const dodgePress: ControllerActions = {
      held: new Set([Action.Dodge]),
      pressedThisFrame: new Set([Action.Dodge]),
      attackHoldDurationSeconds: 0,
      jumpDriftHoldDurationSeconds: 0,
    };
    result = harness.tick(dodgePress, NO_ACTIONS);
    const wobbleAfterPress = result.first.spin.wobbleEnergy;

    expect(wobbleBeforePress - wobbleAfterPress).toBeGreaterThanOrEqual(AIR_RECOVERY_SIZED_DROP);
  });

  it('is usable only once per airborne period', async () => {
    const harness = await CombatHarness.create(CLOSE_FIRST_SPAWN, CLOSE_SECOND_SPAWN);
    settle(harness);
    harness.first.spin.registerImpact(harness.first.body, 8, { x: 0, z: 1 });

    harness.first.dodge.registerLaunch(false);
    const vel = harness.first.body.linvel();
    harness.first.body.setLinvel({ x: vel.x, y: 6, z: vel.z }, true);

    const controller = new ScriptedController([
      { fromTick: 2, held: [Action.Dodge] },
      { fromTick: 3, held: [] },
      { fromTick: 4, held: [Action.Dodge] },
      { fromTick: 5, held: [] },
    ]);

    let wobbleAfterFirstRecovery = -1;
    let wobbleAfterSecondAttempt = -1;
    for (let i = 0; i < 20; i++) {
      const result = harness.tick(controller.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }), NO_ACTIONS);
      if (i === 2) wobbleAfterFirstRecovery = result.first.spin.wobbleEnergy;
      if (i === 4) wobbleAfterSecondAttempt = result.first.spin.wobbleEnergy;
    }

    // The second mid-air press this same airborne period must not have
    // applied another reduction — wobble only decays passively between the
    // two samples, it doesn't drop by another full recovery step.
    expect(wobbleAfterFirstRecovery - wobbleAfterSecondAttempt).toBeLessThan(AIR_RECOVERY_SIZED_DROP);
  });
});

describe('attack whiff-recovery timing after a dodge', () => {
  it('a dodged Circular Attack runs its full natural active duration instead of being cut short by a hit-confirm', async () => {
    const harness = await CombatHarness.create(CLOSE_FIRST_SPAWN, CLOSE_SECOND_SPAWN);
    settle(harness);

    // Same overlap as the i-frames test above: the hit would otherwise
    // connect on the very first tick of CircularActive, which (undodged)
    // would call registerHitConfirmed() and truncate the active window to
    // a single tick. If the dodge is working, none of that happens — the
    // attack simply runs its whole course, exactly like a clean whiff.
    const attacker = delayedTapController(2);
    const dodger = new ScriptedController(sidewaysDodgePressFrames([2]));

    let circularActiveTickCount = 0;
    for (let i = 0; i < 30; i++) {
      const result = harness.tick(
        attacker.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }),
        dodger.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }),
      );
      if (result.first.attackState === AttackState.CircularActive) circularActiveTickCount++;
    }

    // Within one tick of the exact natural duration (floating-point dt
    // accumulation can push the threshold-crossing tick by ±1) — the real
    // thing being proven is "ran its full course", not an exact tick count:
    // a hit-confirm truncation would show up as a count of 1, nowhere close.
    const expectedTicks = Math.round(CIRCULAR_ACTIVE_DURATION_S / FIXED_DELTA_SECONDS);
    expect(circularActiveTickCount).toBeGreaterThanOrEqual(expectedTicks - 1);
    expect(circularActiveTickCount).toBeLessThanOrEqual(expectedTicks + 1);
  });
});

describe('dodge preserves existing momentum', () => {
  it('adds the burst on top of existing velocity instead of replacing it (GDD section 15/88)', async () => {
    const harness = await CombatHarness.create(CLOSE_FIRST_SPAWN, CLOSE_SECOND_SPAWN);
    settle(harness);

    // Build up real forward speed first (no steering — heading stays 0).
    const mover = new ScriptedController([{ fromTick: 0, held: [Action.MoveForward] }]);
    let forwardVelBeforeDodge = 0;
    for (let i = 0; i < 40; i++) {
      const result = harness.tick(mover.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }), NO_ACTIONS);
      forwardVelBeforeDodge = result.first.movement.actualVelocityVector.z; // heading 0 => forward is +Z.
    }
    expect(forwardVelBeforeDodge).toBeGreaterThan(1); // sanity: it's actually moving at a real speed.

    // Dodge sideways (steer right) on the very next tick, without
    // continuing to hold forward.
    const dodger = new ScriptedController([
      { fromTick: 0, held: [Action.Dodge, Action.SteerRight] },
      { fromTick: 1, held: [] },
    ]);
    harness.tick(dodger.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }), NO_ACTIONS);
    const velAfterDodge = harness.first.body.linvel();

    // Forward (Z) momentum from before the dodge is still present — not
    // zeroed out by the burst.
    expect(velAfterDodge.z).toBeGreaterThan(forwardVelBeforeDodge * 0.5);
    // And a real lateral (X) burst was added on top of it.
    expect(Math.abs(velAfterDodge.x)).toBeGreaterThan(DODGE_BURST_SPEED_MPS * 0.5);
  });
});

describe('low air control (GDD section 12/20)', () => {
  it('steering while airborne only nudges trajectory — velocity does not snap to the new heading', async () => {
    const harness = await CombatHarness.create(CLOSE_FIRST_SPAWN, CLOSE_SECOND_SPAWN);
    settle(harness);

    // Slip angle is only meaningful with real horizontal speed (Movement-
    // Controller forces it to 0 below a small speed threshold) — build
    // forward speed first, then a big held jump on top of it (no steering
    // yet, so height assist keeps applying and it stays airborne for a
    // good while), then release everything but steer hard while airborne.
    const airborneSteer = new ScriptedController([
      { fromTick: 0, held: [Action.MoveForward] },
      { fromTick: 40, held: [Action.MoveForward, Action.JumpDrift] },
      { fromTick: 60, held: [Action.SteerRight] },
    ]);

    let sawAirborne = false;
    let maxSlipAngleWhileAirborne = 0;
    for (let i = 0; i < 110; i++) {
      const result = harness.tick(airborneSteer.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }), NO_ACTIONS);
      if (!result.first.grounded && i >= 60) {
        sawAirborne = true;
        maxSlipAngleWhileAirborne = Math.max(maxSlipAngleWhileAirborne, Math.abs(result.first.movement.slipAngleRad));
      }
    }

    expect(sawAirborne).toBe(true);
    // Heading turns at STEERING_MAX_TURN_RATE_RAD_S regardless of ground
    // state, but low air control (AIRBORNE_LATERAL_GRIP_PER_S, far below
    // the grounded LATERAL_GRIP_PER_S) means velocity barely follows it —
    // producing a large, sustained slip angle instead of the tight
    // realignment grounded steering achieves. A "free aerial steering" bug
    // would keep this near zero.
    expect(maxSlipAngleWhileAirborne).toBeGreaterThan(0.3);
  });
});
