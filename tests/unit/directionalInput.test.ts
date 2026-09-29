// M11 directional control, input layer: screen directions (arrows, stick)
// → the world direction that goes into ControllerActions.moveIntent, with
// the camera yaw latched per gesture.

import { describe, expect, it } from 'vitest';
import { Action, type CombatController, type ControllerActions } from '../../src/input/actions/Action';
import { DirectionalController, cameraYawOf } from '../../src/input/directional/DirectionalController';
import {
  CameraYawLatch,
  cameraYawFromRight,
  screenToWorld,
  screenVectorFromDigital,
  screenVectorFromStick,
  screenLength,
} from '../../src/input/directional/screenDirection';
import { sanitizePlayerSettings, DEFAULT_PLAYER_SETTINGS } from '../../src/config/settings/PlayerSettings';
import * as THREE from 'three';

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

describe('screen → world', () => {
  it('camera yaw comes from the camera right axis, looking straight down or sideways alike', () => {
    for (const [position, target] of [
      [new THREE.Vector3(0, 10, -8), new THREE.Vector3(0, 0, 0)], // behind, looking +Z
      [new THREE.Vector3(0, 30, 20), new THREE.Vector3(0, 0, 0)], // overview, looking -Z
      [new THREE.Vector3(-9, 6, 0), new THREE.Vector3(0, 0, 0)], // from the side, looking +X
      [new THREE.Vector3(0, 30, 0.001), new THREE.Vector3(0, 0, 0)], // almost straight down
    ] as const) {
      const camera = new THREE.PerspectiveCamera();
      camera.position.copy(position);
      camera.lookAt(target);
      camera.updateMatrixWorld();
      const forward = new THREE.Vector3();
      camera.getWorldDirection(forward);
      const yaw = cameraYawOf(camera);
      const up = screenToWorld({ x: 0, y: 1 }, yaw);
      const flat = new THREE.Vector2(forward.x, forward.z).normalize();
      expect(up.x).toBeCloseTo(flat.x, 3);
      expect(up.z).toBeCloseTo(flat.y, 3);
      // Screen right is the camera's right on the ground: project a point to the right and check it lands right of centre.
      const right = screenToWorld({ x: 1, y: 0 }, yaw);
      const ndc = new THREE.Vector3(right.x, 0, right.z).project(camera);
      const centre = new THREE.Vector3(0, 0, 0).project(camera);
      expect(ndc.x).toBeGreaterThan(centre.x);
    }
    expect(cameraYawFromRight(1, 0)).toBeCloseTo(Math.PI, 12); // default camera looks -Z
  });

  it('keeps length ≤ 1 after quantization, for every direction', () => {
    for (let i = 0; i < 360; i++) {
      const screen = screenVectorFromDigital(i % 4 === 0, i % 4 === 1, i % 3 === 0, i % 3 === 1);
      const world = screenToWorld(screen, (i * Math.PI) / 97);
      expect(Math.hypot(world.x, world.z)).toBeLessThanOrEqual(1);
    }
    const stick = screenToWorld(screenVectorFromStick(0.7071, -0.7071), 0.3);
    expect(Math.hypot(stick.x, stick.z)).toBeLessThanOrEqual(1);
  });
});

describe('camera yaw latch', () => {
  it('holding one direction keeps its world direction while the camera turns (no feedback orbit)', () => {
    const latch = new CameraYawLatch();
    const first = latch.resolve({ x: 0, y: 1 }, 0);
    for (let yaw = 0; yaw < 3; yaw += 0.1) expect(latch.resolve({ x: 0, y: 1 }, yaw)).toEqual(first);
  });

  it('a released or clearly new direction re-reads the camera', () => {
    const latch = new CameraYawLatch();
    latch.resolve({ x: 0, y: 1 }, 0);
    expect(latch.resolve({ x: 0, y: 0 }, 1)).toEqual({ x: 0, z: 0 });
    const again = latch.resolve({ x: 0, y: 1 }, Math.PI / 2);
    expect(again.x).toBeCloseTo(1, 3);
    // Up → right (90°) is a new gesture: read with the current camera.
    const right = latch.resolve({ x: 1, y: 0 }, 0);
    expect(right).toEqual(screenToWorld({ x: 1, y: 0 }, 0));
  });
});

describe('DirectionalController', () => {
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

  it('Classic (disabled) passes the device actions through untouched', () => {
    const controller = new DirectionalController(held(Action.MoveForward, Action.SteerLeft), { cameraYaw: () => 0 });
    controller.setEnabled(false);
    const actions = controller.sampleActions(CONTEXT);
    expect(actions.moveIntent).toBeUndefined();
    expect(actions.held).toEqual(new Set([Action.MoveForward, Action.SteerLeft]));
  });
});

describe('control scheme setting', () => {
  it('defaults to directional, keeps classic, falls back on garbage', () => {
    expect(DEFAULT_PLAYER_SETTINGS.controlScheme).toBe('directional');
    expect(sanitizePlayerSettings({ controlScheme: 'classic' }).controlScheme).toBe('classic');
    expect(sanitizePlayerSettings({ controlScheme: 'tank' }).controlScheme).toBe('directional');
    expect(sanitizePlayerSettings({ quality: 'Low' }).controlScheme).toBe('directional'); // an M10 save has no scheme
  });
});
