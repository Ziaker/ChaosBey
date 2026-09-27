// ============================================================
// CLASH PRESENTATION LAB — SPEEDLINES (screen-space, browser-only)
// Anime "focus lines" drawn on a 2D canvas over the WebGL view: tapered
// wedges streaming in from beyond the screen edge toward the projected
// contact point, stopping short of a clear zone around the two Beys so
// the contact itself always stays readable. Each side of the screen can
// carry its Bey's color, and the side that is ahead reaches further in
// (its lines push toward the other) — the lines reinforce who is pushing
// whom, not just "something is happening".
//
// Deterministic: the jitter comes from a seeded RNG keyed on the sim
// tick, so a replay of the same scenario draws the same lines.
// ============================================================

import { createFxRng } from './rng';

export interface SpeedlineFrame {
  /** Contact point on screen (px). */
  readonly cx: number;
  readonly cy: number;
  /** Radius (px) around the contact that lines never enter. */
  readonly clearRadius: number;
  /** 0..1 overall strength (direction strength × Clash ramp × fade). */
  readonly intensity: number;
  readonly count: number;
  /** Colors for lines on the screen-left / screen-right half, or null for white lines. */
  readonly tint: { readonly left: string; readonly right: string } | null;
  /** 0..1 share of the push owned by the screen-LEFT Bey (0.5 = even). */
  readonly leftShare: number;
  /** Changes a few times per second so the lines flicker like hand-drawn frames. */
  readonly seed: number;
}

export class Speedlines {
  private readonly ctx: CanvasRenderingContext2D;
  /** What was drawn last (for debug/tests). */
  lastDrawn = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  resize(width: number, height: number, pixelRatio: number): void {
    this.canvas.width = Math.max(1, Math.round(width * pixelRatio));
    this.canvas.height = Math.max(1, Math.round(height * pixelRatio));
    this.ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  }

  clear(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.lastDrawn = 0;
  }

  draw(width: number, height: number, f: SpeedlineFrame): void {
    this.clear();
    if (f.intensity <= 0.01) return;
    const ctx = this.ctx;
    const rnd = createFxRng(0x51eed000 ^ f.seed);
    const outer = Math.hypot(width, height); // always starts beyond the screen edge
    const n = Math.round(f.count * (0.5 + 0.5 * f.intensity));
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < n; i++) {
      const a = ((i + rnd() * 0.8) / n) * Math.PI * 2;
      const dirX = Math.cos(a);
      const dirY = Math.sin(a);
      const onLeft = dirX < 0;
      // The side that is ahead reaches closer to the contact (its push dominates the frame).
      const share = onLeft ? f.leftShare : 1 - f.leftShare;
      const reach = 0.35 + 0.65 * share; // 0.35..1
      const inner = f.clearRadius * (1.9 - reach * 0.9) + rnd() * f.clearRadius * 1.6 * (1 - f.intensity * 0.5);
      const halfWidth = (1.2 + rnd() * 5.5) * (0.6 + f.intensity * 0.8);
      const x0 = f.cx + dirX * outer;
      const y0 = f.cy + dirY * outer;
      const x1 = f.cx + dirX * inner;
      const y1 = f.cy + dirY * inner;
      const px = -dirY * halfWidth;
      const py = dirX * halfWidth;
      const alpha = f.intensity * (0.22 + rnd() * 0.5) * (0.55 + share * 0.9);
      ctx.fillStyle = f.tint ? (onLeft ? f.tint.left : f.tint.right) : '#ffffff';
      ctx.globalAlpha = Math.min(1, alpha);
      ctx.beginPath();
      ctx.moveTo(x0 + px, y0 + py);
      ctx.lineTo(x1, y1);
      ctx.lineTo(x0 - px, y0 - py);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    this.lastDrawn = n;
  }
}
