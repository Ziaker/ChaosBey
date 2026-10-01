// M11 directional control, input layer: arrow/stick directions → a world
// direction in a GAMEPLAY-OWNED control reference that goes into
// ControllerActions.moveIntent. The camera is downstream presentation and
// has no way into this layer (owner requirement, 2026-10-01: "a câmera
// nunca move o Bey" — see docs/design-decisions/camera-gameplay-
// separation.md and tests/unit/inputCameraBoundary.test.ts). Classic
// (Bey-relative) passes the device actions through untouched.

import { describe, expect, it } from 'vitest';
import { Action, type CombatController, type ControllerActions } from '../../src/input/actions/Action';
import { DirectionalController } from '../../src/input/directional/DirectionalController';
import { createPlayerControl } from '../../src/input/directional/createPlayerControl';
import { WORLD_CONTROL_REFERENCE, type ControlReference } from '../../src/input/directional/ControlReference';
import { screenToWorld, screenVectorFromDigital, screenVectorFromStick, screenLength } from '../../src/input/directional/screenDirection';
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

describe('screen → world (control reference, a pure function of its two arguments)', () => {
  it('the world reference is the fixed arena frame: up = world +Z, right = world +X (the owner\'s earlier "Fix 5" mapping)', () => {
    expect(screenToWorld({ x: 0, y: 1 }, WORLD_CONTROL_REFERENCE.yawRad())).toEqual({ x: 0, z: 1 });
    expect(screenToWorld({ x: 1, y: 0 }, WORLD_CONTROL_REFERENCE.yawRad())).toEqual({ x: 1, z: 0 });
    expect(screenToWorld({ x: 0, y: -1 }, 0)).toEqual({ x: 0, z: -1 });
    expect(screenToWorld({ x: -1, y: 0 }, 0)).toEqual({ x: -1, z: 0 });
  });

  it("preserves the direction vector's length for every reference yaw (a pure rotation, no scaling)", () => {
    for (const screen of [{ x: 0, y: 1 }, { x: 1, y: 0 }, { x: Math.SQRT1_2, y: Math.SQRT1_2 }]) {
      for (const yaw of [0, 0.7, Math.PI, -2.1, 10]) {
        const world = screenToWorld(screen, yaw);
        expect(Math.hypot(world.x, world.z)).toBeCloseTo(screenLength(screen), 3);
      }
    }
  });

  it('Up and Right stay perpendicular, for every reference yaw', () => {
    for (const yaw of [0, 1.1, -2.4, Math.PI, 5]) {
      const up = screenToWorld({ x: 0, y: 1 }, yaw);
      const right = screenToWorld({ x: 1, y: 0 }, yaw);
      expect(up.x * right.x + up.z * right.z).toBeCloseTo(0, 3);
    }
  });

  it('the SAME direction and the SAME reference yaw always produce the SAME world vector — no hidden state', () => {
    expect(screenToWorld.length).toBe(2);
    expect(screenToWorld({ x: 0.6, y: 0.8 }, 1.7)).toEqual(screenToWorld({ x: 0.6, y: 0.8 }, 1.7));
  });

  it('keeps length ≤ 1 after quantization, for every direction and several reference yaws', () => {
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
});

describe('DirectionalController: gameplay-owned reference, no camera in the chain', () => {
  it('defaults to the world reference and is a pure function of the held keys: the same keys give the same intent on every tick', () => {
    const controller = new DirectionalController(held(Action.MoveForward));
    const first = controller.sampleActions(CONTEXT).moveIntent!;
    expect(first).toEqual({ x: 0, z: 1 });
    for (let i = 0; i < 200; i++) expect(controller.sampleActions(CONTEXT).moveIntent).toEqual(first);
  });

  it('has no way to receive a camera: the only external source besides the device is a ControlReference and a stick', () => {
    // The constructor takes (device, { reference?, stick? }). A source object with a camera-shaped callback is rejected at the type level (see tsc) and simply ignored at runtime.
    const smuggled = { cameraYaw: () => 2.5 } as unknown as ConstructorParameters<typeof DirectionalController>[1];
    const controller = new DirectionalController(held(Action.MoveForward), smuggled);
    expect(controller.sampleActions(CONTEXT).moveIntent).toEqual({ x: 0, z: 1 });
  });

  it('with no direction held the intent is the zero vector', () => {
    const controller = new DirectionalController(held());
    for (let i = 0; i < 40; i++) expect(controller.sampleActions(CONTEXT).moveIntent).toEqual({ x: 0, z: 0 });
  });

  it('a custom (gameplay-owned) ControlReference rotates the resolved direction; the plug point works', () => {
    let yaw = 0;
    const reference: ControlReference = { kind: 'world', yawRad: () => yaw };
    const controller = new DirectionalController(held(Action.MoveForward), { reference });
    expect(controller.sampleActions(CONTEXT).moveIntent).toEqual({ x: 0, z: 1 });
    yaw = Math.PI / 2;
    const rotated = controller.sampleActions(CONTEXT).moveIntent!;
    expect(rotated.x).toBeCloseTo(1, 3);
    expect(rotated.z).toBeCloseTo(0, 3);
    expect(controller.getDebug().referenceYawRad).toBe(Math.PI / 2);
  });

  it('switching Up → Left → Down → Right every tick reflects the corresponding direction immediately, with no stuck intent', () => {
    const cycle: Action[] = [Action.MoveForward, Action.SteerLeft, Action.MoveBackward, Action.SteerRight];
    let currentAction: Action = cycle[0]!;
    const controller = new DirectionalController({
      sampleActions: (): ControllerActions => ({ held: new Set([currentAction]), pressedThisFrame: new Set(), attackHoldDurationSeconds: 0, jumpDriftHoldDurationSeconds: 0 }),
    });
    const seen = new Map<Action, { x: number; z: number }>();
    for (let rep = 0; rep < 3; rep++) {
      for (const action of cycle) {
        currentAction = action;
        const world = controller.sampleActions(CONTEXT).moveIntent!;
        const previous = seen.get(action);
        if (previous) expect(world).toEqual(previous);
        seen.set(action, world);
      }
    }
    expect(seen.get(Action.MoveForward)).toEqual({ x: 0, z: 1 });
    expect(seen.get(Action.MoveBackward)).toEqual({ x: 0, z: -1 });
    expect(seen.get(Action.SteerLeft)).toEqual({ x: -1, z: 0 });
    expect(seen.get(Action.SteerRight)).toEqual({ x: 1, z: 0 });
  });

  it('turns arrows into moveIntent and removes the four movement actions', () => {
    const controller = new DirectionalController(held(Action.MoveForward, Action.SteerRight, Action.Attack));
    const actions = controller.sampleActions(CONTEXT);
    expect([...actions.held]).toEqual([Action.Attack]);
    expect([...actions.pressedThisFrame]).toEqual([Action.Attack]);
    expect(Math.hypot(actions.moveIntent!.x, actions.moveIntent!.z)).toBeLessThanOrEqual(1);
    expect(actions.moveIntent).toEqual(screenToWorld(screenVectorFromDigital(true, false, false, true), 0));
    expect(controller.getDebug().screen.x).toBeCloseTo(Math.SQRT1_2, 12);
  });

  it('the stick wins over digital directions when pushed', () => {
    const controller = new DirectionalController(held(Action.MoveForward), { stick: () => [1, 0] });
    const actions = controller.sampleActions(CONTEXT);
    expect(actions.moveIntent).toEqual(screenToWorld({ x: 1, y: 0 }, 0));
  });

  it('Classic (disabled) passes the device actions through untouched', () => {
    const controller = createPlayerControl(held(Action.MoveForward, Action.SteerLeft), { directional: false });
    const actions = controller.sampleActions(CONTEXT);
    expect(actions.moveIntent).toBeUndefined();
    expect(actions.held).toEqual(new Set([Action.MoveForward, Action.SteerLeft]));
  });

  it('createPlayerControl(directional: true) is a directional controller', () => {
    const controller = createPlayerControl(held(Action.MoveForward), { directional: true });
    expect(controller.isEnabled()).toBe(true);
    expect(controller.sampleActions(CONTEXT).moveIntent).toEqual({ x: 0, z: 1 });
  });
});

describe('control scheme setting', () => {
  it('defaults to directional, keeps classic, falls back to directional on garbage', () => {
    expect(DEFAULT_PLAYER_SETTINGS.controlScheme).toBe('directional');
    expect(sanitizePlayerSettings({ controlScheme: 'classic' }).controlScheme).toBe('classic');
    expect(sanitizePlayerSettings({ controlScheme: 'tank' }).controlScheme).toBe('directional');
    expect(sanitizePlayerSettings({ quality: 'Low' }).controlScheme).toBe('directional'); // an M10 save has no scheme
  });
});
