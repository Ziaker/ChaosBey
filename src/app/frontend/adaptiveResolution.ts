// ============================================================
// ADAPTIVE RESOLUTION — keep the frame rate up on slower PCs (performance pass, 0.57.0)
// The cheapest way to give a weak GPU its frame time back is to draw fewer pixels: this watches how long frames really take
// and lowers the render scale (a fraction of the canvas' pixel ratio) while they are slow, then lets it climb back when the
// machine has room again. Render cost only — the simulation never sees it (GDD 89), and nothing here reads gameplay state.
//
//   slow  : the smoothed frame time stays above SLOW_FRAME_MS for SLOW_HOLD_S  → one step down (never below MIN_SCALE)
//   fast  : it stays below FAST_FRAME_MS for FAST_HOLD_S while below full scale → one step up
//   noise : an ISOLATED frame longer than IGNORE_FRAME_MS (a tab switch, a pause, a hitch) is not counted, and the first WARMUP_S
//           are skipped (shader compiles and texture uploads make the first frames slow on every machine). Frames that are
//           that long one after another are a machine at a few frames a second — the one that needs this most — and count
//           (as IGNORE_FRAME_MS each).
// A 60 Hz display sits at 16.7 ms, between the two thresholds, so a machine that holds 60 fps never moves the scale.
// ============================================================

export const ADAPTIVE_MIN_SCALE = 0.5;
export const ADAPTIVE_MAX_SCALE = 1;
export const ADAPTIVE_STEP_DOWN = 0.1;
export const ADAPTIVE_STEP_UP = 0.05;
/** Smoothed frame time above this (ms) is "slow": under ~46 fps. */
export const SLOW_FRAME_MS = 22;
/** Smoothed frame time below this (ms) is "fast": over ~68 fps. A 60 Hz display (16.7 ms) is neither. */
export const FAST_FRAME_MS = 14.5;
export const SLOW_HOLD_S = 1;
export const FAST_HOLD_S = 6;
export const WARMUP_S = 2;
export const IGNORE_FRAME_MS = 150;
/** Weight of the newest frame in the smoothed frame time. */
export const SMOOTHING = 0.12;

export class AdaptiveResolution {
  private scaleValue: number;
  private smoothedMs: number | null = null;
  private slowS = 0;
  private fastS = 0;
  private elapsedS = 0;
  private previousWasHuge = false;

  constructor(initialScale = ADAPTIVE_MAX_SCALE) {
    this.scaleValue = Math.max(ADAPTIVE_MIN_SCALE, Math.min(ADAPTIVE_MAX_SCALE, initialScale));
  }

  get scale(): number {
    return this.scaleValue;
  }

  /** The smoothed frame time (ms), or null before the first counted frame. */
  get smoothedFrameMs(): number | null {
    return this.smoothedMs;
  }

  /** Back to full scale (a new match, a new quality): forgets what it measured. */
  reset(): void {
    this.scaleValue = ADAPTIVE_MAX_SCALE;
    this.smoothedMs = null;
    this.slowS = 0;
    this.fastS = 0;
    this.elapsedS = 0;
    this.previousWasHuge = false;
  }

  /**
   * Feeds one rendered frame's real duration (ms). Returns the new scale when it changed, else null.
   * `range` narrows where the scale may go (the quality preset decides: Low starts lower, High never falls as far).
   */
  update(frameMs: number, range: { readonly min: number; readonly max: number } = { min: ADAPTIVE_MIN_SCALE, max: ADAPTIVE_MAX_SCALE }): number | null {
    if (!Number.isFinite(frameMs) || frameMs <= 0) return null;
    if (frameMs > IGNORE_FRAME_MS) {
      const consecutive = this.previousWasHuge;
      this.previousWasHuge = true;
      if (!consecutive) return null; // one long frame: a hitch, a tab switch or a resume
      frameMs = IGNORE_FRAME_MS;
    } else {
      this.previousWasHuge = false;
    }
    const dtS = frameMs / 1000;
    this.elapsedS += dtS;
    if (this.elapsedS < WARMUP_S) return null;
    this.smoothedMs = this.smoothedMs === null ? frameMs : this.smoothedMs + (frameMs - this.smoothedMs) * SMOOTHING;
    const minScale = Math.max(ADAPTIVE_MIN_SCALE, Math.min(ADAPTIVE_MAX_SCALE, range.min));
    const maxScale = Math.max(minScale, Math.min(ADAPTIVE_MAX_SCALE, range.max));
    // A range moved after the fact (a quality change, a new match) pulls the scale inside it at once.
    if (this.scaleValue > maxScale + 1e-9 || this.scaleValue < minScale - 1e-9) {
      this.scaleValue = Math.min(maxScale, Math.max(minScale, this.scaleValue));
      this.smoothedMs = null;
      return this.scaleValue;
    }
    if (this.smoothedMs > SLOW_FRAME_MS) {
      this.slowS += dtS;
      this.fastS = 0;
      if (this.slowS >= SLOW_HOLD_S && this.scaleValue > minScale + 1e-9) {
        this.slowS = 0;
        this.scaleValue = Math.max(minScale, round2(this.scaleValue - ADAPTIVE_STEP_DOWN));
        // Give the new resolution time to show its effect before judging again.
        this.smoothedMs = null;
        return this.scaleValue;
      }
    } else if (this.smoothedMs < FAST_FRAME_MS) {
      this.fastS += dtS;
      this.slowS = 0;
      if (this.fastS >= FAST_HOLD_S && this.scaleValue < maxScale - 1e-9) {
        this.fastS = 0;
        this.scaleValue = Math.min(maxScale, round2(this.scaleValue + ADAPTIVE_STEP_UP));
        this.smoothedMs = null;
        return this.scaleValue;
      }
    } else {
      this.slowS = 0;
      this.fastS = 0;
    }
    return null;
  }
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
