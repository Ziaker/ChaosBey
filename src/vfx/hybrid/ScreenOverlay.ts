// ============================================================
// SCREEN OVERLAY — focus lines, tint and the impact frame
// The three screen-space effects of the approved hybrid language, drawn on two
// transparent 2D canvases laid over the game canvas: one normal (tint, focus
// lines) and one with `mix-blend-mode: difference` (white inverts the frame:
// the anime "negative flash"). They sit below the HUD and the Debug Lab and
// never take input.
//
// Camera rule (owner froze the camera): this layer is NOT a child of the camera
// and adds nothing to it. It only READS the camera to project a world point to
// the screen (`Vector3.project` reads the camera's matrices and writes none).
// Without a DOM (unit tests) it keeps the same state and counts, and draws nothing.
// ============================================================

import * as THREE from 'three';

// ---------------- TUNING (the lab's values) ----------------
const FOCUS_LINE_ALPHA = 0.55;      // Peak opacity of one focus line.
const OVERLAY_Z_INDEX = '900';      // Above the game canvas, below the HUD (1050) and the Debug Lab (1000).
// -----------------------------------------------------------

interface FocusLines {
  readonly pos: THREE.Vector3;
  readonly strength: number;
  remaining: number;
  readonly total: number;
  readonly color: string;
}

export interface ScreenOverlayStats {
  readonly focusLines: number;
  readonly tinting: number;
  readonly impactFrame: number;
}

export class ScreenOverlay {
  private readonly focus: FocusLines[] = [];
  private tintState: { css: string; remaining: number } | null = null;
  private impactRemaining = 0;
  private impactStrength = 0;
  private readonly normal: CanvasRenderingContext2D | null = null;
  private readonly invert: CanvasRenderingContext2D | null = null;
  private readonly host: HTMLElement | null = null;
  private drewLastFrame = false;
  private readonly tmp = new THREE.Vector3();

  constructor(private readonly camera: THREE.Camera, parent: HTMLElement | null = typeof document === 'undefined' ? null : document.body) {
    if (!parent || typeof document === 'undefined') return;
    const host = document.createElement('div');
    host.setAttribute('data-testid', 'hybrid-vfx-overlay');
    host.style.cssText = `position:fixed;inset:0;pointer-events:none;z-index:${OVERLAY_Z_INDEX};`;
    const make = (blend: string): CanvasRenderingContext2D | null => {
      const canvas = document.createElement('canvas');
      canvas.style.cssText = `position:absolute;inset:0;width:100%;height:100%;${blend}`;
      host.appendChild(canvas);
      return canvas.getContext('2d');
    };
    this.normal = make('');
    this.invert = make('mix-blend-mode:difference;');
    parent.appendChild(host);
    this.host = host;
  }

  /** Radiating lines around a world point; the action itself stays clear (lines start well away from it). */
  focusLines(at: THREE.Vector3, strength: number, seconds: number, color = 'rgba(255,255,255,0.9)'): void {
    this.focus.push({ pos: at.clone(), strength, remaining: seconds, total: seconds, color });
  }

  /** Full-viewport colour tint. */
  tint(css: string, seconds: number): void {
    this.tintState = { css, remaining: seconds };
  }

  /**
   * The negative flash. Lote 11 adds presentation-only strength: 0 disables it, 1 is the approved look. Values above 1
   * are represented by the caller as a longer frame while this alpha remains physically bounded at 1.
   */
  impactFrame(seconds: number, strength = 1): void {
    const safeStrength = Math.max(0, Math.min(1.5, strength));
    if (seconds <= 0 || safeStrength <= 0) return;
    if (seconds >= this.impactRemaining) this.impactStrength = safeStrength;
    else this.impactStrength = Math.max(this.impactStrength, safeStrength);
    this.impactRemaining = Math.max(this.impactRemaining, seconds);
  }

  clear(): void {
    this.focus.length = 0;
    this.tintState = null;
    this.impactRemaining = 0;
    this.impactStrength = 0;
    this.draw();
  }

  update(dt: number): void {
    this.impactRemaining = Math.max(0, this.impactRemaining - dt);
    if (this.impactRemaining === 0) this.impactStrength = 0;
    for (let i = this.focus.length - 1; i >= 0; i--) {
      this.focus[i]!.remaining -= dt;
      if (this.focus[i]!.remaining <= 0) this.focus.splice(i, 1);
    }
    if (this.tintState) {
      this.tintState.remaining -= dt;
      if (this.tintState.remaining <= 0) this.tintState = null;
    }
    this.draw();
  }

  getStats(): ScreenOverlayStats {
    return { focusLines: this.focus.length, tinting: this.tintState ? 1 : 0, impactFrame: this.impactRemaining > 0 ? 1 : 0 };
  }

  private draw(): void {
    const g = this.normal;
    const inv = this.invert;
    if (!g || !inv) return;
    const active = this.focus.length > 0 || !!this.tintState || this.impactRemaining > 0;
    if (!active && !this.drewLastFrame) return;
    this.drewLastFrame = active;
    const W = g.canvas.clientWidth || window.innerWidth;
    const H = g.canvas.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (const ctx of [g, inv]) {
      if (ctx.canvas.width !== Math.round(W * dpr) || ctx.canvas.height !== Math.round(H * dpr)) {
        ctx.canvas.width = Math.round(W * dpr);
        ctx.canvas.height = Math.round(H * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
    }
    if (this.tintState) {
      g.fillStyle = this.tintState.css;
      g.fillRect(0, 0, W, H);
    }
    for (const f of this.focus) {
      this.tmp.copy(f.pos).project(this.camera);
      if (this.tmp.z > 1) continue; // behind the camera
      const cx = ((this.tmp.x + 1) / 2) * W;
      const cy = ((1 - this.tmp.y) / 2) * H;
      const fade = f.remaining / f.total;
      const outer = Math.hypot(W, H);
      // Lines start well away from the focus so the action itself stays visible.
      const inner = Math.min(W, H) * (0.5 - 0.12 * f.strength);
      const count = Math.round(16 + 34 * f.strength);
      g.fillStyle = f.color;
      g.globalAlpha = FOCUS_LINE_ALPHA * Math.min(1, fade * 1.4);
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const width = (0.002 + Math.random() * 0.007) * (0.6 + f.strength);
        const r0 = inner * (0.85 + Math.random() * 0.5);
        g.beginPath();
        g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
        g.lineTo(cx + Math.cos(a - width) * outer, cy + Math.sin(a - width) * outer);
        g.lineTo(cx + Math.cos(a + width) * outer, cy + Math.sin(a + width) * outer);
        g.closePath();
        g.fill();
      }
      g.globalAlpha = 1;
    }
    if (this.impactRemaining > 0) {
      inv.globalAlpha = Math.min(1, this.impactStrength);
      inv.fillStyle = '#ffffff';
      inv.fillRect(0, 0, W, H);
      inv.globalAlpha = 1;
    }
  }

  dispose(): void {
    this.focus.length = 0;
    this.tintState = null;
    this.impactRemaining = 0;
    this.impactStrength = 0;
    this.host?.remove();
  }
}
