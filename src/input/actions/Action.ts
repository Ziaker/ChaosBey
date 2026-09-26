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
