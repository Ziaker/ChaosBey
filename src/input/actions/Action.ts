// ============================================================
// INPUT ACTIONS
// Gameplay code must consume actions, never raw key codes (GDD section 14).
// This keeps keyboard, gamepad, AI and scripted-test controllers
// interchangeable behind one interface.
// ============================================================

export enum Action {
  SteerLeft = 'SteerLeft',
  SteerRight = 'SteerRight',
  MoveForward = 'MoveForward',
  MoveBackward = 'MoveBackward',
  Attack = 'Attack',
  JumpDrift = 'JumpDrift',
  Dodge = 'Dodge',
  Pause = 'Pause',
  DebugToggle = 'DebugToggle',
  SettingsToggle = 'SettingsToggle',
}

/**
 * App/UI actions (not gameplay): never delayed by hitstop buffering, and
 * still honored while the keyboard focus is in a settings text field. Any
 * new UI-only action belongs here, or it silently behaves like a gameplay
 * input.
 */
export const UI_ACTIONS: ReadonlySet<Action> = new Set([Action.Pause, Action.DebugToggle, Action.SettingsToggle]);

/**
 * Per-frame action state sampled from a controller. `held` actions (movement,
 * charge attacks) need duration; `pressed` actions (dodge, pause) need a
 * clean single-frame edge regardless of how long the underlying key/button
 * was actually down.
 */
export interface ControllerActions {
  readonly held: ReadonlySet<Action>;
  /** Actions that transitioned from not-held to held this sample. */
  readonly pressedThisFrame: ReadonlySet<Action>;
  /** Seconds Action.Attack has been continuously held (0 when not held); drives Dash Attack charge. */
  readonly attackHoldDurationSeconds: number;
  /** Seconds Action.JumpDrift has been continuously held (0 when not held); drives tap-hop vs. hold-jump. */
  readonly jumpDriftHoldDurationSeconds: number;
  /**
   * M11 directional control: where the player wants to go, as a world X/Z
   * vector of length 0..1 (0 = no direction). When present, movement,
   * drift and dodge read it instead of SteerLeft/SteerRight/MoveForward/
   * MoveBackward. MoveForward/MoveBackward are then never held;
   * SteerLeft/SteerRight stay held as the screen's lateral input (left/right
   * or a diagonal), which only the drift rule reads (owner, 2026-10-02). The input layer resolves it
   * from screen directions; the simulation never sees the camera. Absent
   * (undefined) = the classic tank semantics: AI, scripted tests, the
   * Classic control setting and every V1 replay.
   */
  readonly moveIntent?: MoveIntent;
}

/** A world-space X/Z direction, length 0..1. */
export interface MoveIntent {
  readonly x: number;
  readonly z: number;
}

export interface ControllerContext {
  readonly fixedDeltaSeconds: number;
  /**
   * True while Milestone 4's hitstop has gameplay simulation itself
   * frozen this tick. A controller must not lose a gameplay press made
   * during this window (buffer it for the next unfrozen sample instead)
   * and must not let hold-duration/charge clocks advance — but UI actions
   * (Pause, DebugToggle) stay responsive regardless, since hitstop freezes
   * gameplay, not input readability. Optional/undefined means "not
   * frozen" for controllers that don't need to care (AI, scripted tests).
   */
  readonly simulationFrozen?: boolean;
}

/**
 * Shared driving interface for players, AI, and automated test agents
 * (GDD section 113). Debug/self-test tooling can swap implementations
 * without gameplay code knowing the difference.
 */
export interface CombatController {
  sampleActions(context: ControllerContext): ControllerActions;
}
