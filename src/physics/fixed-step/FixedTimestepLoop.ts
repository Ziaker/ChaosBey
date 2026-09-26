// ============================================================
// FIXED TIMESTEP LOOP — SIMULATION TUNING
// Simulation correctness must never depend on render FPS (GDD section 80).
// ============================================================

/** Simulation ticks per second. 60 Hz keeps physics stable at both 60 and 120 FPS render rates. */
export const FIXED_TICKS_PER_SECOND = 60;
export const FIXED_DELTA_SECONDS = 1 / FIXED_TICKS_PER_SECOND;

/** Safety clamp: if a frame takes longer than this, drop the extra time instead of "spiral of death" catch-up ticking. */
const MAX_CATCHUP_SECONDS = 0.25;

export interface FixedTimestepCallbacks {
  /** Runs once per fixed simulation tick, at a constant delta time. */
  onFixedTick: (tickIndex: number, fixedDeltaSeconds: number) => void;
  /** Runs once per rendered frame, after all due fixed ticks have run. `alpha` (0..1) is the interpolation factor between the previous and current simulation state. */
  onRenderFrame: (frameDeltaSeconds: number, alpha: number) => void;
  /**
   * Called once if onFixedTick/onRenderFrame throws. The loop has already
   * stopped by then: resuming after a half-finished tick would simulate on
   * inconsistent state. The owner must report it (console, telemetry,
   * debug overlay — GDD section 117). Without a handler the error is
   * rethrown, but the loop still stops.
   */
  onFatalError?: (error: unknown, tickIndex: number) => void;
}

/**
 * Accumulator-based fixed timestep driver. Simulation acceleration (GDD
 * section 164, self-test fast mode) should call `stepManyTicks` directly
 * rather than feeding this loop an inflated deltaTime, which would change
 * physics behavior.
 */
export class FixedTimestepLoop {
  private accumulatorSeconds = 0;
  private tickIndex = 0;
  private lastFrameTimeMs: number | null = null;
  private rafHandle: number | null = null;
  private running = false;

  constructor(private readonly callbacks: FixedTimestepCallbacks) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrameTimeMs = null;
    this.rafHandle = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
  }

  getTickIndex(): number {
    return this.tickIndex;
  }

  /** Runs an exact number of fixed ticks immediately, ignoring wall-clock time. Used by self-test fast mode / simulation acceleration. */
  stepManyTicks(count: number): void {
    for (let i = 0; i < count; i++) {
      this.callbacks.onFixedTick(this.tickIndex, FIXED_DELTA_SECONDS);
      this.tickIndex++;
    }
  }

  private tick = (nowMs: number): void => {
    if (!this.running) return;

    const frameDeltaSeconds = this.lastFrameTimeMs === null ? 0 : (nowMs - this.lastFrameTimeMs) / 1000;
    this.lastFrameTimeMs = nowMs;

    this.accumulatorSeconds = Math.min(this.accumulatorSeconds + frameDeltaSeconds, MAX_CATCHUP_SECONDS);

    // The next frame is only scheduled after the callbacks return, so an
    // exception used to kill the loop silently (frozen game, nothing but a
    // console line). It is now an explicit, reported stop instead.
    try {
      while (this.accumulatorSeconds >= FIXED_DELTA_SECONDS) {
        this.callbacks.onFixedTick(this.tickIndex, FIXED_DELTA_SECONDS);
        this.tickIndex++;
        this.accumulatorSeconds -= FIXED_DELTA_SECONDS;
      }

      const alpha = this.accumulatorSeconds / FIXED_DELTA_SECONDS;
      this.callbacks.onRenderFrame(frameDeltaSeconds, alpha);
    } catch (error) {
      this.stop();
      if (!this.callbacks.onFatalError) throw error;
      this.callbacks.onFatalError(error, this.tickIndex);
      return;
    }

    this.rafHandle = requestAnimationFrame(this.tick);
  };
}
