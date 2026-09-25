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

    while (this.accumulatorSeconds >= FIXED_DELTA_SECONDS) {
      this.callbacks.onFixedTick(this.tickIndex, FIXED_DELTA_SECONDS);
      this.tickIndex++;
      this.accumulatorSeconds -= FIXED_DELTA_SECONDS;
    }

    const alpha = this.accumulatorSeconds / FIXED_DELTA_SECONDS;
    this.callbacks.onRenderFrame(frameDeltaSeconds, alpha);

    this.rafHandle = requestAnimationFrame(this.tick);
  };
}
