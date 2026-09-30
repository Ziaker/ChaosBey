// ============================================================
// AUTO-CONTINUE COUNTDOWN (owner playtest, after M11)
// After a round or a match result, the dialog's primary action (Next
// round / Rematch — exactly what its button does) runs by itself after
// AUTO_CONTINUE_S unless the player continues first or stops it. UI time
// only: the finished round stays frozen, nothing is simulated meanwhile.
//
// It fires at most once, whichever comes first — the timer, the player's
// Continue, or neither after Stop — so a press landing on the same instant
// as the timer can never start two transitions.
// ============================================================

export const AUTO_CONTINUE_S = 4;

export interface CountdownClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const REAL_CLOCK: CountdownClock = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export type CountdownState = 'running' | 'stopped' | 'fired';

export class AutoContinueCountdown {
  private state: CountdownState = 'running';
  private readonly startedAt: number;
  private readonly handle: unknown;

  constructor(
    private readonly seconds: number,
    private readonly action: () => void,
    private readonly clock: CountdownClock = REAL_CLOCK,
  ) {
    this.startedAt = clock.now();
    this.handle = clock.setTimeout(() => this.fire(), seconds * 1000);
  }

  getState(): CountdownState {
    return this.state;
  }

  /** Seconds left (0 once it fired or was stopped). */
  remainingS(): number {
    if (this.state !== 'running') return 0;
    return Math.max(0, this.seconds - (this.clock.now() - this.startedAt) / 1000);
  }

  /**
   * Runs the action now if nothing has yet — the timer, or the player's
   * Continue. Returns whether it ran. After Stop, Continue still runs it
   * (the player asked); the timer no longer does.
   */
  fire(byPlayer = false): boolean {
    if (this.state === 'fired') return false;
    if (this.state === 'stopped' && !byPlayer) return false;
    this.state = 'fired';
    this.clock.clearTimeout(this.handle);
    this.action();
    return true;
  }

  /** Stop the automatic continue; the dialog stays up. */
  stop(): void {
    if (this.state !== 'running') return;
    this.state = 'stopped';
    this.clock.clearTimeout(this.handle);
  }

  /** The dialog closed some other way (Leave match, Main Menu…): never fire. */
  dispose(): void {
    if (this.state === 'running') this.state = 'stopped';
    this.clock.clearTimeout(this.handle);
  }
}
