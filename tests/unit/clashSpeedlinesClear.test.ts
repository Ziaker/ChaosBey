// ============================================================
// CLASH SPEEDLINES: clear() empties the whole canvas at any devicePixelRatio
// Owner bug (2026-10-02, Opera GX at ~75% zoom): after a Clash the speedlines
// stayed on the right and bottom of the screen. clear() ran clearRect with
// the dpr transform still on, which at dpr < 1 covers only dpr x the canvas.
// ============================================================

import { describe, expect, it } from 'vitest';
import { Speedlines } from '../../src/vfx/clash/Speedlines';

/** A 2D context that records what area each clearRect covers in device pixels, and what each fill does. */
function fakeCanvas() {
  let t = { a: 1, d: 1, e: 0, f: 0 };
  const stack: (typeof t)[] = [];
  const cleared: { x0: number; y0: number; x1: number; y1: number }[] = [];
  let fills = 0;
  const ctx = {
    save: () => void stack.push({ ...t }),
    restore: () => void (t = stack.pop() ?? t),
    setTransform: (a: number, _b: number, _c: number, d: number, e: number, f: number) => void (t = { a, d, e, f }),
    clearRect: (x: number, y: number, w: number, h: number) => void cleared.push({ x0: t.a * x + t.e, y0: t.d * y + t.f, x1: t.a * (x + w) + t.e, y1: t.d * (y + h) + t.f }),
    beginPath: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    closePath: () => undefined,
    fill: () => void fills++,
    set fillStyle(_v: string) {},
    set globalAlpha(_v: number) {},
    set globalCompositeOperation(_v: string) {},
  };
  const canvas = { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
  return { canvas, cleared, fills: () => fills };
}

describe('Speedlines.clear', () => {
  it.each([0.75, 1, 1.5])('clears every device pixel of the canvas at dpr %s, after drawing a Clash', (dpr) => {
    const { canvas, cleared, fills } = fakeCanvas();
    const lines = new Speedlines(canvas);
    lines.resize(1880, 1030, dpr);
    lines.draw(1880, 1030, { cx: 900, cy: 500, clearRadius: 120, intensity: 1, count: 80, tint: null, leftShare: 0.5, seed: 3 });
    expect(fills()).toBeGreaterThan(0);
    cleared.length = 0;
    lines.clear();
    expect(cleared).toHaveLength(1);
    const c = cleared[0]!;
    expect(c.x0).toBeLessThanOrEqual(0);
    expect(c.y0).toBeLessThanOrEqual(0);
    expect(c.x1).toBeGreaterThanOrEqual(canvas.width);
    expect(c.y1).toBeGreaterThanOrEqual(canvas.height);
    expect(lines.lastDrawn).toBe(0);
  });
});
