// ============================================================
// FRAME LIMITER — do not draw faster than the game moves (performance pass, 0.57.0)
// The simulation runs at a fixed 60 Hz and the Beys' poses change once per tick, so on a 120/144 Hz display most drawn frames
// are copies of the one before: pure GPU and CPU cost. The limiter lets the render loop skip the draw when the last one is too
// recent, WITHOUT touching the simulation (the fixed-step loop keeps ticking; a skipped frame's time is added to the next
// drawn one). Render cost only.
//
// The tolerance keeps odd refresh rates honest: a 75 Hz display (13.3 ms) is not halved to 37 fps by a 60 fps limit.
// ============================================================

import type { FrameLimitSetting } from '../../config/settings/FrameLimit';

/** How much earlier than the budget a frame may be drawn (ms): the browser's timestamps jitter around the refresh interval. */
export const FRAME_LIMIT_TOLERANCE_MS = 4;

export class FrameLimiter {
  private lastDrawMs: number | null = null;

  constructor(private limit: FrameLimitSetting) {}

  setLimit(limit: FrameLimitSetting): void {
    this.limit = limit;
  }

  /** True when this frame should be drawn (and records it as drawn). */
  shouldDraw(nowMs: number): boolean {
    if (this.limit === 'off' || this.lastDrawMs === null) {
      this.lastDrawMs = nowMs;
      return true;
    }
    const budgetMs = 1000 / Number(this.limit);
    if (nowMs - this.lastDrawMs >= budgetMs - Math.min(FRAME_LIMIT_TOLERANCE_MS, budgetMs * 0.25)) {
      this.lastDrawMs = nowMs;
      return true;
    }
    return false;
  }

  /** Forget the last draw (after a pause or a new match). */
  reset(): void {
    this.lastDrawMs = null;
  }
}
