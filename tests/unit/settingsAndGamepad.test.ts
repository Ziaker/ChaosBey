// M10 lane D: player settings, quality profiles and the gamepad action layer.

import { describe, expect, it } from 'vitest';
import { DEFAULT_PLAYER_SETTINGS, QUALITY_PROFILES, sanitizePlayerSettings } from '../../src/config/settings/PlayerSettings';
import { QualityPreset } from '../../src/config/runtime/QualityPreset';
import { Action, type CombatController, type ControllerActions } from '../../src/input/actions/Action';
import { CombinedController, GamepadController } from '../../src/input/devices/GamepadController';
import { PAD, gamepadHeldActions, gamepadMenuKeys, readFirstGamepad, type GamepadSnapshot } from '../../src/input/devices/gamepadMapping';

const FIXED = { fixedDeltaSeconds: 1 / 60 };

function snapshot(pressed: number[] = [], axes: number[] = [0, 0, 0, 0]): GamepadSnapshot {
  const buttons = new Array<number>(17).fill(0);
  for (const index of pressed) buttons[index] = 1;
  return { buttons, axes };
}

/** A fake navigator.getGamepads() result the test can change between samples. */
function fakePad(state: { pressed: number[]; axes?: number[] }): () => (Gamepad | null)[] {
  return () => [
    {
      id: 'Test Pad (STANDARD GAMEPAD)',
      connected: true,
      buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: state.pressed.includes(i), touched: false, value: state.pressed.includes(i) ? 1 : 0 })),
      axes: state.axes ?? [0, 0, 0, 0],
    } as unknown as Gamepad,
  ];
}

describe('player settings', () => {
  it('default to Medium quality with every comfort option on and the developer overlay off', () => {
    expect(DEFAULT_PLAYER_SETTINGS).toEqual({ quality: QualityPreset.Medium, cameraPreset: 'B', controlScheme: 'directional', cameraEffects: true, pauseOnFocusLoss: true, controlHints: true, debugOverlayOnStart: false });
  });

  it('fall back field by field on missing, old or corrupted values', () => {
    expect(sanitizePlayerSettings(null)).toEqual(DEFAULT_PLAYER_SETTINGS);
    expect(sanitizePlayerSettings('garbage')).toEqual(DEFAULT_PLAYER_SETTINGS);
    expect(sanitizePlayerSettings({ quality: 'Ultra', cameraEffects: 'no', pauseOnFocusLoss: false })).toEqual({ ...DEFAULT_PLAYER_SETTINGS, pauseOnFocusLoss: false });
    expect(sanitizePlayerSettings({ ...DEFAULT_PLAYER_SETTINGS, quality: 'Low' }).quality).toBe(QualityPreset.Low);
  });

  it('scale only render cost with quality, cheaper from High to Low', () => {
    expect(QUALITY_PROFILES.Low.maxPixelRatio).toBeLessThan(QUALITY_PROFILES.Medium.maxPixelRatio);
    expect(QUALITY_PROFILES.Medium.maxPixelRatio).toBeLessThan(QUALITY_PROFILES.High.maxPixelRatio);
    expect(QUALITY_PROFILES.Low.trails).toBe(false);
    expect(QUALITY_PROFILES.High.trails).toBe(true);
  });
});

describe('gamepad mapping', () => {
  it('mirrors the keyboard scheme on the standard layout', () => {
    expect(gamepadHeldActions(snapshot())).toEqual(new Set());
    expect(gamepadHeldActions(snapshot([PAD.A]))).toEqual(new Set([Action.Attack]));
    expect(gamepadHeldActions(snapshot([PAD.X]))).toEqual(new Set([Action.JumpDrift]));
    expect(gamepadHeldActions(snapshot([PAD.LB]))).toEqual(new Set([Action.JumpDrift]));
    expect(gamepadHeldActions(snapshot([PAD.B]))).toEqual(new Set([Action.Dodge]));
    expect(gamepadHeldActions(snapshot([PAD.RB]))).toEqual(new Set([Action.Dodge]));
    expect(gamepadHeldActions(snapshot([PAD.Start]))).toEqual(new Set([Action.Pause]));
    expect(gamepadHeldActions(snapshot([PAD.Up, PAD.Left]))).toEqual(new Set([Action.MoveForward, Action.SteerLeft]));
    expect(gamepadHeldActions(snapshot([], [0.9, 0.9, 0, 0]))).toEqual(new Set([Action.SteerRight, Action.MoveBackward]));
    // Inside the dead zone: nothing.
    expect(gamepadHeldActions(snapshot([], [0.2, -0.3, 0, 0]))).toEqual(new Set());
    // Triggers accelerate / brake.
    const triggers = { buttons: Object.assign(new Array<number>(17).fill(0), { [PAD.RT]: 0.6 }), axes: [0, 0] };
    expect(gamepadHeldActions(triggers)).toEqual(new Set([Action.MoveForward]));
  });

  it('turns the pad into menu keys', () => {
    expect(gamepadMenuKeys(snapshot([PAD.A]))).toEqual(new Set(['Enter']));
    expect(gamepadMenuKeys(snapshot([PAD.B]))).toEqual(new Set(['Escape']));
    expect(gamepadMenuKeys(snapshot([PAD.Down]))).toEqual(new Set(['ArrowDown']));
    expect(gamepadMenuKeys(snapshot([], [-1, 0, 0, 0]))).toEqual(new Set(['ArrowLeft']));
  });

  it('reads the first connected pad and skips empty slots', () => {
    expect(readFirstGamepad(null)).toBeNull();
    expect(readFirstGamepad([null, null])).toBeNull();
    const pad = readFirstGamepad([null, ...fakePad({ pressed: [PAD.A] })()]);
    expect(pad?.id).toContain('Test Pad');
    expect(pad?.snapshot.buttons[PAD.A]).toBe(1);
  });
});

describe('GamepadController', () => {
  it('gives press edges and hold durations like the keyboard', () => {
    const state = { pressed: [] as number[] };
    const pad = new GamepadController(fakePad(state));
    expect(pad.sampleActions(FIXED).held.size).toBe(0);
    state.pressed = [PAD.A];
    const first = pad.sampleActions(FIXED);
    expect(first.pressedThisFrame.has(Action.Attack)).toBe(true);
    const second = pad.sampleActions(FIXED);
    expect(second.pressedThisFrame.has(Action.Attack)).toBe(false);
    expect(second.held.has(Action.Attack)).toBe(true);
    expect(second.attackHoldDurationSeconds).toBeGreaterThan(first.attackHoldDurationSeconds);
    state.pressed = [];
    expect(pad.sampleActions(FIXED).held.has(Action.Attack)).toBe(false);
  });

  it('ignores a button already down when it starts or resumes, until it is released', () => {
    const state = { pressed: [PAD.A] };
    const pad = new GamepadController(fakePad(state));
    // A still held from confirming a menu: no Attack.
    expect(pad.sampleActions(FIXED).held.has(Action.Attack)).toBe(false);
    expect(pad.sampleActions(FIXED).held.has(Action.Attack)).toBe(false);
    state.pressed = [];
    pad.sampleActions(FIXED);
    state.pressed = [PAD.A];
    expect(pad.sampleActions(FIXED).pressedThisFrame.has(Action.Attack)).toBe(true);
    // Resuming from pause with A held: ignored again.
    pad.reset();
    expect(pad.sampleActions(FIXED).held.has(Action.Attack)).toBe(false);
  });

  it('buffers a press made during a hitstop freeze, like the keyboard', () => {
    const state = { pressed: [] as number[] };
    const pad = new GamepadController(fakePad(state));
    pad.sampleActions(FIXED);
    state.pressed = [PAD.B];
    expect(pad.sampleActions({ ...FIXED, simulationFrozen: true }).pressedThisFrame.has(Action.Dodge)).toBe(false);
    expect(pad.sampleActions(FIXED).pressedThisFrame.has(Action.Dodge)).toBe(true);
  });
});

describe('CombinedController', () => {
  it('merges devices: any device holding or pressing counts, the longest hold wins', () => {
    const fixed = (actions: Partial<ControllerActions>): CombatController => ({
      sampleActions: () => ({ held: new Set(), pressedThisFrame: new Set(), attackHoldDurationSeconds: 0, jumpDriftHoldDurationSeconds: 0, ...actions }),
    });
    const combined = new CombinedController([
      fixed({ held: new Set([Action.SteerLeft]), attackHoldDurationSeconds: 0.2 }),
      fixed({ held: new Set([Action.Attack]), pressedThisFrame: new Set([Action.Attack]), attackHoldDurationSeconds: 0.5 }),
    ]);
    const sample = combined.sampleActions(FIXED);
    expect(sample.held).toEqual(new Set([Action.SteerLeft, Action.Attack]));
    expect(sample.pressedThisFrame).toEqual(new Set([Action.Attack]));
    expect(sample.attackHoldDurationSeconds).toBe(0.5);
  });
});
