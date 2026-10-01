// M11 directional control, input layer: screen directions (arrows, stick)
// → a camera-relative world direction that goes into
// ControllerActions.moveIntent. "Fix 7" (2026-10-01, see screenDirection.ts's
// header): the player default reads the camera's CURRENT yaw fresh on every
// tick (no latching, no gesture memory) so a held key always looks like the
// same thing on screen — away, toward, left, right of the camera — no
// matter where the camera currently is. Classic (no camera at all) stays
// selectable.

import { describe, expect, it } from 'vitest';
import { Action, type CombatController, type ControllerActions } from '../../src/input/actions/Action';
import { DirectionalController } from '../../src/input/directional/DirectionalController';
import { cameraYawFromRight, screenToWorld, screenVectorFromDigital, screenVectorFromStick, screenLength } from '../../src/input/directional/screenDirection';
import { sanitizePlayerSettings, DEFAULT_PLAYER_SETTINGS } from '../../src/config/settings/PlayerSettings';

const CONTEXT = { fixedDeltaSeconds: 1 / 60 };

function held(...actions: Action[]): CombatController {
  return {
    sampleActions: (): ControllerActions => ({
      held: new Set(actions),
      pressedThisFrame: new Set(actions),
      attackHoldDurationSeconds: 0,
      jumpDriftHoldDurationSeconds: 0,
    }),
  };
}

describe('screen vectors', () => {
  it('arrows: one key is length 1, a diagonal is normalized (no speed gain), opposites cancel', () => {
    expect(screenVectorFromDigital(true, false, false, false)).toEqual({ x: 0, y: 1 });
    expect(screenVectorFromDigital(false, true, false, false)).toEqual({ x: 0, y: -1 });
    expect(screenVectorFromDigital(false, false, true, false)).toEqual({ x: -1, y: 0 });
    const diagonal = screenVectorFromDigital(true, false, false, true);
    expect(screenLength(diagonal)).toBeCloseTo(1, 12);
    expect(diagonal.x).toBeCloseTo(Math.SQRT1_2, 12);
    expect(screenVectorFromDigital(true, true, true, true)).toEqual({ x: 0, y: 0 });
  });

  it('stick: radial deadzone, continuous magnitude up to 1, axis Y flipped (pad Y is down)', () => {
    expect(screenLength(screenVectorFromStick(0.15, 0.1))).toBe(0);
    const half = screenVectorFromStick(0, -0.6);
    expect(half.x).toBeCloseTo(0, 12);
    expect(half.y).toBeCloseTo(0.5, 12);
    expect(screenLength(screenVectorFromStick(1, 1))).toBeCloseTo(1, 12); // a corner never exceeds 1
    expect(screenVectorFromStick(1, 0).x).toBeCloseTo(1, 12);
  });
});

describe('screen → world (camera-relative, recomputed fresh every call — "Fix 7")', () => {
  it('preserves the screen vector\'s length for every camera yaw (a pure rotation, no scaling)', () => {
    for (const screen of [{ x: 0, y: 1 }, { x: 1, y: 0 }, { x: Math.SQRT1_2, y: Math.SQRT1_2 }]) {
      for (const yaw of [0, 0.7, Math.PI, -2.1, 10]) {
        const world = screenToWorld(screen, yaw);
        expect(Math.hypot(world.x, world.z)).toBeCloseTo(screenLength(screen), 3);
      }
    }
  });

  it('rotating the camera by a delta rotates the resolved world direction by the exact same delta', () => {
    const screen = { x: 0, y: 1 }; // Up
    const base = screenToWorld(screen, 0.3);
    const baseAngle = Math.atan2(base.x, base.z);
    for (const delta of [0.1, 1, -0.5, Math.PI / 2]) {
      const rotated = screenToWorld(screen, 0.3 + delta);
      const rotatedAngle = Math.atan2(rotated.x, rotated.z);
      let diff = rotatedAngle - baseAngle - delta;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff)); // wrap to [-pi, pi]
      expect(diff).toBeCloseTo(0, 3);
    }
  });

  it('Up and Right stay perpendicular, for every camera yaw', () => {
    for (const yaw of [0, 1.1, -2.4, Math.PI, 5]) {
      const up = screenToWorld({ x: 0, y: 1 }, yaw);
      const right = screenToWorld({ x: 1, y: 0 }, yaw);
      const dot = up.x * right.x + up.z * right.z;
      expect(dot).toBeCloseTo(0, 3);
    }
  });

  it('the SAME screen vector and the SAME camera yaw always produce the SAME world vector — a pure function, no hidden state', () => {
    expect(screenToWorld.length).toBe(2);
    const a = screenToWorld({ x: 0.6, y: 0.8 }, 1.7);
    const b = screenToWorld({ x: 0.6, y: 0.8 }, 1.7);
    expect(a).toEqual(b);
  });

  it('keeps length ≤ 1 after quantization, for every direction and several camera yaws', () => {
    for (const yaw of [0, 1, 2, 3]) {
      for (let i = 0; i < 360; i++) {
        const screen = screenVectorFromDigital(i % 4 === 0, i % 4 === 1, i % 3 === 0, i % 3 === 1);
        const world = screenToWorld(screen, yaw);
        expect(Math.hypot(world.x, world.z)).toBeLessThanOrEqual(1);
      }
    }
    const stick = screenToWorld(screenVectorFromStick(0.7071, -0.7071), 0.5);
    expect(Math.hypot(stick.x, stick.z)).toBeLessThanOrEqual(1);
  });

  it('cameraYawFromRight recovers the yaw used to build a right vector of that yaw', () => {
    for (const yaw of [0, 0.5, 1.5, Math.PI, -1.2]) {
      const right = { x: Math.cos(yaw), z: -Math.sin(yaw) };
      expect(cameraYawFromRight(right.x, right.z)).toBeCloseTo(Math.atan2(Math.sin(yaw), Math.cos(yaw)), 6);
    }
  });
});

describe('DirectionalController: resolves camera-relative, re-reading the camera fresh every tick', () => {
  it('Test A: holding a direction while the camera yaw sweeps continuously rotates the world vector by exactly the camera\'s own delta — no latch, no stale value', () => {
    let yaw = 0;
    const controller = new DirectionalController(held(Action.MoveForward), { cameraYaw: () => yaw });
    const first = controller.sampleActions(CONTEXT).moveIntent!;
    let previousAngle = Math.atan2(first.x, first.z);
    for (let delta = 0.1; delta < 3; delta += 0.1) {
      yaw = delta;
      const world = controller.sampleActions(CONTEXT).moveIntent!;
      const angle = Math.atan2(world.x, world.z);
      let step = angle - previousAngle;
      step = Math.atan2(Math.sin(step), Math.cos(step));
      expect(step).toBeCloseTo(0.1, 2); // the world direction rotates exactly with the camera, tick by tick
      previousAngle = angle;
    }
  });

  it('Test D: with no direction held, orbiting the camera produces no thrust/steering — moveIntent stays the zero vector', () => {
    let yaw = 0;
    const controller = new DirectionalController(held(), { cameraYaw: () => yaw });
    for (let i = 0; i < 40; i++) {
      yaw += 0.2;
      expect(controller.sampleActions(CONTEXT).moveIntent).toEqual({ x: 0, z: 0 });
    }
  });

  it('Test E: switching Up → Left → Down → Right every tick reflects the corresponding camera-relative direction immediately, with no stuck intent, for a fixed camera yaw', () => {
    const cycle: Action[] = [Action.MoveForward, Action.SteerLeft, Action.MoveBackward, Action.SteerRight];
    const controller = new DirectionalController(
      {
        sampleActions: (): ControllerActions => ({
          held: new Set([currentAction]),
          pressedThisFrame: new Set(),
          attackHoldDurationSeconds: 0,
          jumpDriftHoldDurationSeconds: 0,
        }),
      },
      { cameraYaw: () => 1.7 }, // fixed camera: the four directions must still be the four cardinal camera-relative directions
    );
    let currentAction: Action = cycle[0]!;
    const seen = new Map<Action, { x: number; z: number }>();
    for (let rep = 0; rep < 3; rep++) {
      for (const action of cycle) {
        currentAction = action;
        const world = controller.sampleActions(CONTEXT).moveIntent!;
        const previous = seen.get(action);
        if (previous) expect(world).toEqual(previous); // same key, same fixed camera ⇒ same result every time
        seen.set(action, world);
      }
    }
    // Up/Down are opposite, Left/Right are opposite, and Up⊥Right, for this fixed camera yaw.
    const up = seen.get(Action.MoveForward)!;
    const down = seen.get(Action.MoveBackward)!;
    const left = seen.get(Action.SteerLeft)!;
    const right = seen.get(Action.SteerRight)!;
    expect(up.x + down.x).toBeCloseTo(0, 6);
    expect(up.z + down.z).toBeCloseTo(0, 6);
    expect(left.x + right.x).toBeCloseTo(0, 6);
    expect(left.z + right.z).toBeCloseTo(0, 6);
    expect(up.x * right.x + up.z * right.z).toBeCloseTo(0, 6);
  });

  it('turns arrows into moveIntent and removes the four movement actions', () => {
    const controller = new DirectionalController(held(Action.MoveForward, Action.SteerRight, Action.Attack), { cameraYaw: () => 0 });
    const actions = controller.sampleActions(CONTEXT);
    expect([...actions.held]).toEqual([Action.Attack]);
    expect([...actions.pressedThisFrame]).toEqual([Action.Attack]);
    expect(Math.hypot(actions.moveIntent!.x, actions.moveIntent!.z)).toBeLessThanOrEqual(1);
    expect(actions.moveIntent).toEqual(screenToWorld(screenVectorFromDigital(true, false, false, true), 0));
    expect(controller.getDebug().screen.x).toBeCloseTo(Math.SQRT1_2, 12);
  });

  it('with no direction held it still emits a zero intent (directional frame, not classic)', () => {
    const actions = new DirectionalController(held(), { cameraYaw: () => 0 }).sampleActions(CONTEXT);
    expect(actions.moveIntent).toEqual({ x: 0, z: 0 });
  });

  it('the stick wins over digital directions when pushed', () => {
    const controller = new DirectionalController(held(Action.MoveForward), { cameraYaw: () => 0, stick: () => [1, 0] });
    expect(controller.getDebug().screen).toEqual({ x: 0, y: 0 });
    const actions = controller.sampleActions(CONTEXT);
    expect(actions.moveIntent).toEqual(screenToWorld({ x: 1, y: 0 }, 0));
  });

  it("getDebug() reports the camera yaw alongside the world vector — changing a FIXED yaw between samples changes `world` by design now (camera-relative)", () => {
    let yaw = 0;
    const controller = new DirectionalController(held(Action.MoveForward), { cameraYaw: () => yaw });
    controller.sampleActions(CONTEXT);
    expect(controller.getDebug().cameraYawRad).toBe(0);
    const atYawZero = controller.getDebug().world;
    yaw = 2.5;
    controller.sampleActions(CONTEXT);
    expect(controller.getDebug().cameraYawRad).toBe(2.5);
    expect(controller.getDebug().world).not.toEqual(atYawZero); // this is the point of "Fix 7": it tracks the camera on purpose
  });

  it('Classic (disabled) passes the device actions through untouched', () => {
    const controller = new DirectionalController(held(Action.MoveForward, Action.SteerLeft), { cameraYaw: () => 0 });
    controller.setEnabled(false);
    const actions = controller.sampleActions(CONTEXT);
    expect(actions.moveIntent).toBeUndefined();
    expect(actions.held).toEqual(new Set([Action.MoveForward, Action.SteerLeft]));
  });
});

describe('control scheme setting', () => {
  it('defaults to directional (camera-relative), keeps classic, falls back to directional on garbage', () => {
    expect(DEFAULT_PLAYER_SETTINGS.controlScheme).toBe('directional');
    expect(sanitizePlayerSettings({ controlScheme: 'classic' }).controlScheme).toBe('classic');
    expect(sanitizePlayerSettings({ controlScheme: 'tank' }).controlScheme).toBe('directional');
    expect(sanitizePlayerSettings({ quality: 'Low' }).controlScheme).toBe('directional'); // an M10 save has no scheme
  });
});
