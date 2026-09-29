// ============================================================
// SFX LAB — ARENA VIEW (context only, top-down)
// A small top-down view of the live match so the ear has something to
// follow: the 12 m floor, the wall, both Beys in their archetype colors
// and a short flash where each sound came from (colored by category).
// Deliberately plain: this Lab decides sound, not visuals.
// ============================================================

import { ARENA_FLOOR_RADIUS } from '../../../../src/arena/colliders/ArenaTuning';
import type { CategoryId } from '../catalog';
import type { Vec3 } from '../live/deriveSfx';

export const CATEGORY_COLORS: Readonly<Record<CategoryId, string>> = {
  continuous: '#6c7a8e',
  impact: '#c9d2de',
  attack: '#ffb347',
  defense: '#6fd3ff',
  resource: '#ffe066',
  clash: '#ff4fa3',
  round: '#ff3b4e',
  ui: '#9fb1c8',
};

interface Flash {
  readonly x: number;
  readonly z: number;
  readonly color: string;
  readonly bornMs: number;
  readonly big: boolean;
}

export class ArenaView {
  private readonly ctx: CanvasRenderingContext2D;
  private flashes: Flash[] = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly colors: { first: string; second: string },
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
  }

  setColors(colors: { first: string; second: string }): void {
    Object.assign(this.colors, colors);
  }

  flash(position: Vec3, category: CategoryId, big: boolean, nowMs: number): void {
    this.flashes.push({ x: position.x, z: position.z, color: CATEGORY_COLORS[category], bornMs: nowMs, big });
    if (this.flashes.length > 60) this.flashes.shift();
  }

  draw(positions: { first: Vec3; second: Vec3 } | null, info: { clashActive: boolean; broken: { first: boolean; second: boolean }; label: string }, nowMs: number): void {
    const { canvas, ctx } = this;
    const dpr = window.devicePixelRatio || 1;
    const size = Math.round(canvas.clientWidth * dpr);
    if (canvas.width !== size || canvas.height !== size) {
      canvas.width = size;
      canvas.height = size;
    }
    const c = size / 2;
    const scale = (size * 0.46) / (ARENA_FLOOR_RADIUS + 0.6);
    const px = (x: number) => c + x * scale;
    const pz = (z: number) => c + z * scale;
    ctx.clearRect(0, 0, size, size);
    // Floor + wall.
    ctx.fillStyle = '#0c1017';
    ctx.beginPath();
    ctx.arc(c, c, ARENA_FLOOR_RADIUS * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = info.clashActive ? '#ff4fa3' : '#2a3544';
    ctx.lineWidth = 3 * dpr;
    ctx.stroke();
    ctx.strokeStyle = '#161d28';
    ctx.lineWidth = 1 * dpr;
    for (const r of [4, 8]) {
      ctx.beginPath();
      ctx.arc(c, c, r * scale, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Flashes.
    this.flashes = this.flashes.filter((f) => nowMs - f.bornMs < 600);
    for (const f of this.flashes) {
      const age = (nowMs - f.bornMs) / 600;
      ctx.strokeStyle = f.color;
      ctx.globalAlpha = 1 - age;
      ctx.lineWidth = (f.big ? 3 : 2) * dpr;
      ctx.beginPath();
      ctx.arc(px(f.x), pz(f.z), (0.4 + age * (f.big ? 3.2 : 1.4)) * scale, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // Beys.
    if (positions) {
      for (const side of ['first', 'second'] as const) {
        const p = positions[side];
        ctx.fillStyle = this.colors[side];
        ctx.beginPath();
        ctx.arc(px(p.x), pz(p.z), 0.62 * scale, 0, Math.PI * 2);
        ctx.fill();
        if (info.broken[side]) {
          ctx.strokeStyle = '#ffe066';
          ctx.lineWidth = 2 * dpr;
          ctx.setLineDash([3 * dpr, 3 * dpr]);
          ctx.beginPath();
          ctx.arc(px(p.x), pz(p.z), 0.95 * scale, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        ctx.fillStyle = '#05050a';
        ctx.font = `700 ${Math.round(10 * dpr)}px ui-monospace, Consolas, monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(side === 'first' ? 'P1' : 'P2', px(p.x), pz(p.z));
      }
    }
    ctx.fillStyle = '#8894a6';
    ctx.font = `${Math.round(11 * dpr)}px ui-monospace, Consolas, monospace`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(info.label, 8 * dpr, 8 * dpr);
  }
}
