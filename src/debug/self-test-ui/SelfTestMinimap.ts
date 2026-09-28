// ============================================================
// SELF TEST MINIMAP — REDUCED RENDERING (GDD section 66)
// A top-down 2D view of the match a batch is simulating: arena floor,
// wall, ring-out boundary and both Beys with a short trail. Deliberately
// minimal engineering drawing (no WebGL, no final visuals) so batches can
// be watched without paying for the full renderer.
// ============================================================

import { ARENA_FLOOR_RADIUS, ARENA_WALL_THICKNESS } from '../../arena/colliders/ArenaTuning';
import { RINGOUT_RADIUS_M } from '../../arena/ringout/RingOutTuning';

// ============================================================
// SELF TEST MINIMAP — TUNING
// ============================================================

/** Trail length per Bey, in drawn samples. */
const TRAIL_SAMPLES = 90;
/** Metres shown from the centre to the canvas edge. */
const VIEW_RADIUS_M = RINGOUT_RADIUS_M + 1.5;

export interface MinimapFrame {
  readonly first: { readonly x: number; readonly z: number };
  readonly second: { readonly x: number; readonly z: number };
  readonly caption: string;
}

export class SelfTestMinimap {
  readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D | null;
  private readonly trails: { first: { x: number; z: number }[]; second: { x: number; z: number }[] } = { first: [], second: [] };
  private lastCaption = '';

  constructor(sizePx = 320) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = sizePx;
    this.canvas.height = sizePx;
    this.canvas.className = 'self-test__minimap';
    this.canvas.setAttribute('data-testid', 'self-test-minimap');
    this.context = this.canvas.getContext('2d');
    this.draw(null);
  }

  clear(): void {
    this.trails.first = [];
    this.trails.second = [];
    this.draw(null);
  }

  draw(frame: MinimapFrame | null): void {
    const ctx = this.context;
    if (!ctx) return;
    if (frame && frame.caption !== this.lastCaption) {
      this.trails.first = [];
      this.trails.second = [];
      this.lastCaption = frame.caption;
    }
    if (frame) {
      pushTrail(this.trails.first, frame.first);
      pushTrail(this.trails.second, frame.second);
    }
    const size = this.canvas.width;
    const scale = size / 2 / VIEW_RADIUS_M;
    const cx = size / 2;
    const cy = size / 2;
    const toPx = (p: { x: number; z: number }): [number, number] => [cx + p.x * scale, cy + p.z * scale];

    ctx.fillStyle = '#05060c';
    ctx.fillRect(0, 0, size, size);
    circle(ctx, cx, cy, ARENA_FLOOR_RADIUS * scale, '#1a2238', true);
    ctx.lineWidth = Math.max(1, ARENA_WALL_THICKNESS * scale);
    circle(ctx, cx, cy, ARENA_FLOOR_RADIUS * scale, '#5b6b8c', false);
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    circle(ctx, cx, cy, RINGOUT_RADIUS_M * scale, '#c0504d', false);
    ctx.setLineDash([]);

    for (const [trail, color] of [
      [this.trails.first, '#ff6b6b'],
      [this.trails.second, '#5aa9ff'],
    ] as const) {
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      trail.forEach((p, i) => {
        const [x, y] = toPx(p);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.globalAlpha = 1;
      const last = trail[trail.length - 1];
      if (last) {
        const [x, y] = toPx(last);
        circle(ctx, x, y, 5, color, true);
      }
    }

    ctx.fillStyle = '#d8e0f0';
    ctx.font = '11px ui-monospace, monospace';
    ctx.fillText(frame ? frame.caption : 'idle — no match running', 6, 14);
  }
}

function pushTrail(trail: { x: number; z: number }[], p: { x: number; z: number }): void {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) return;
  trail.push({ x: p.x, z: p.z });
  if (trail.length > TRAIL_SAMPLES) trail.shift();
}

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, fill: boolean): void {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0, r), 0, Math.PI * 2);
  if (fill) {
    ctx.fillStyle = color;
    ctx.fill();
  } else {
    ctx.strokeStyle = color;
    ctx.stroke();
  }
}
