// M11 directional control, input layer: screen directions (arrows, stick)
// → a FIXED world direction (arena-relative, never the camera's) that goes
// into ControllerActions.moveIntent. Closed decision (playtest, 2026-09):
// the camera must never participate in this calculation — see
// screenDirection.ts's header.

import { describe, expect, it } from 'vitest';
import { Action, type CombatController, type ControllerActions } from '../../src/input/actions/Action';
import { DirectionalController, cameraYawOf } from '../../src/input/directional/DirectionalController';
import { cameraYawFromRight, screenToWorld, screenVectorFromDigital, screenVectorFromStick, screenLength } from '../../src/input/directional/screenDirection';
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

describe('screen → world (arena/world-relative, no camera)', () => {
  it('Up/Down/Left/Right map to fixed world +Z/-Z/-X/+X, matching the fromYaw convention', () => {
    expect(screenToWorld({ x: 0, y: 1 })).toEqual({ x: 0, z: 1 }); // Up = world +Z
    expect(screenToWorld({ x: 0, y: -1 })).toEqual({ x: 0, z: -1 }); // Down = world -Z
    expect(screenToWorld({ x: -1, y: 0 })).toEqual({ x: -1, z: 0 }); // Left = world -X
    expect(screenToWorld({ x: 1, y: 0 })).toEqual({ x: 1, z: 0 }); // Right = world +X
  });

  it('the SAME screen vector produces the SAME world vector no matter what — screenToWorld takes no camera parameter at all', () => {
    // The strongest possible version of "the camera cannot influence
    // movement": the function computing the world direction has no way to
    // read a camera even if it wanted to.
    expect(screenToWorld.length).toBe(1);
    const a = screenToWorld({ x: 0.6, y: 0.8 });
    const b = screenToWorld({ x: 0.6, y: 0.8 });
    expect(a).toEqual(b);
  });

  it('keeps length ≤ 1 after quantization, for every direction', () => {
    for (let i = 0; i < 360; i++) {
      const screen = screenVectorFromDigital(i % 4 === 0, i % 4 === 1, i % 3 === 0, i % 3 === 1);
      const world = screenToWorld(screen);
      expect(Math.hypot(world.x, world.z)).toBeLessThanOrEqual(1);
    }
    const stick = screenToWorld(screenVectorFromStick(0.7071, -0.7071));
    expect(Math.hypot(stick.x, stick.z)).toBeLessThanOrEqual(1);
  });

  it('cameraYawFromRight/cameraYawOf still exist for the diagnostic readout, but are never passed into screenToWorld', () => {
    for (const [position, target] of [
      [new THREE.Vector3(0, 10, -8), new THREE.Vector3(0, 0, 0)],
      [new THREE.Vector3(-9, 6, 0), new THREE.Vector3(0, 0, 0)],
    ] as const) {
      const camera = new THREE.PerspectiveCamera();
      camera.position.copy(position);
      camera.lookAt(target);
      camera.updateMatrixWorld();
      // Just confirms the helper still computes a sane yaw for display — it
      // has no bearing on screenToWorld, which takes no such argument.
      expect(Number.isFinite(cameraYawOf(camera))).toBe(true);
    }
    expect(cameraYawFromRight(1, 0)).toBeCloseTo(Math.PI, 12);
  });
});

describe('DirectionalController: the camera cannot change what a held key means', () => {
  it('Test A/B/C: the resolved world direction is identical while the camera yaw sweeps 3 rad mid-hold, for several starting yaws', () => {
    let yaw = 0;
    const controller = new DirectionalController(held(Action.MoveForward), { cameraYaw: () => yaw });
    for (const startYaw of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
      yaw = startYaw;
      const first = controller.sampleActions(CONTEXT).moveIntent;
      for (let delta = 0; delta < 3; delta += 0.1) {
        yaw = startYaw + delta;
        expect(controller.sampleActions(CONTEXT).moveIntent).toEqual(first);
      }
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

  it('Test E: switching Up → Left → Down → Right every tick reflects the corresponding fixed world direction immediately, with no stuck intent', () => {
    const cycle: [Action, { x: number; z: number }][] = [
      [Action.MoveForward, { x: 0, z: 1 }],
      [Action.SteerLeft, { x: -1, z: 0 }],
      [Action.MoveBackward, { x: 0, z: -1 }],
      [Action.SteerRight, { x: 1, z: 0 }],
    ];
    const controller = new DirectionalController(
      {
        sampleActions: (): ControllerActions => ({
          held: new Set([currentAction]),
          pressedThisFrame: new Set(),
          attackHoldDurationSeconds: 0,
          jumpDriftHoldDurationSeconds: 0,
        }),
      },
      { cameraYaw: () => 1.7 }, // fixed but arbitrary — must have zero effect
    );
    let currentAction: Action = cycle[0]![0];
    for (let rep = 0; rep < 3; rep++) {
      for (const [action, expected] of cycle) {
        currentAction = action;
        expect(controller.sampleActions(CONTEXT).moveIntent).toEqual(expected);
      }
    }
  });

  it('turns arrows into moveIntent and removes the four movement actions', () => {
    const controller = new DirectionalController(held(Action.MoveForward, Action.SteerRight, Action.Attack), { cameraYaw: () => 0 });
    const actions = controller.sampleActions(CONTEXT);
    expect([...actions.held]).toEqual([Action.Attack]);
    expect([...actions.pressedThisFrame]).toEqual([Action.Attack]);
    expect(Math.hypot(actions.moveIntent!.x, actions.moveIntent!.z)).toBeLessThanOrEqual(1);
    expect(actions.moveIntent).toEqual(screenToWorld(screenVectorFromDigital(true, false, false, true)));
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
    expect(actions.moveIntent).toEqual(screenToWorld({ x: 1, y: 0 }));
  });

  it("getDebug() reports the camera yaw alongside the world vector, purely for display — changing it never changes `world`", () => {
    let yaw = 0;
    const controller = new DirectionalController(held(Action.MoveForward), { cameraYaw: () => yaw });
    controller.sampleActions(CONTEXT);
    expect(controller.getDebug().cameraYawRad).toBe(0);
    expect(controller.getDebug().world).toEqual({ x: 0, z: 1 });
    yaw = 2.5;
    controller.sampleActions(CONTEXT);
    expect(controller.getDebug().cameraYawRad).toBe(2.5);
    expect(controller.getDebug().world).toEqual({ x: 0, z: 1 });
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
