// ============================================================
// TOP-LEVEL GAME STATE
// Canonical top-level flow states (GDD section 9). Not every state has a
// real screen/implementation yet — most gameplay/UI milestones come later.
// Declaring the full enum now keeps later milestones from having to widen
// a narrower type, and lets Debug Lab reference states that don't exist
// yet without a type error.
// ============================================================

export enum GameState {
  Boot = 'Boot',
  MainMenu = 'MainMenu',
  CharacterSelect = 'CharacterSelect',
  PregameSetup = 'PregameSetup',
  MatchLoading = 'MatchLoading',
  MatchIntro = 'MatchIntro',
  Launch = 'Launch',
  Countdown = 'Countdown',
  Combat = 'Combat',
  Clash = 'Clash',
  RoundEnd = 'RoundEnd',
  MatchEnd = 'MatchEnd',
  Pause = 'Pause',
  DebugLab = 'DebugLab',
  SelfTest = 'SelfTest',
  /** Milestone 0 only: temporary placeholder scene proving render + physics wiring. Removed once MainMenu exists. */
  Sandbox = 'Sandbox',
}

export type GameStateTransitionHandler = (from: GameState, to: GameState) => void;

/**
 * Explicit state owner — no other module may hold its own copy of "what
 * screen/mode are we in" (GDD section 9: avoid contradictory boolean state
 * soup). Transition legality is intentionally permissive at this stage
 * since only Boot -> Sandbox is wired; later milestones should tighten
 * `isTransitionAllowed` as real screens are implemented.
 */
export class GameStateMachine {
  private current: GameState = GameState.Boot;
  private readonly listeners = new Set<GameStateTransitionHandler>();

  getCurrentState(): GameState {
    return this.current;
  }

  transitionTo(next: GameState): void {
    const previous = this.current;
    if (previous === next) return;
    this.current = next;
    for (const listener of this.listeners) {
      listener(previous, next);
    }
  }

  onTransition(handler: GameStateTransitionHandler): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }
}
