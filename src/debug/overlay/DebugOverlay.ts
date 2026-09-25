// ============================================================
// DEBUG OVERLAY — SKELETON
// First-class debug tooling per GDD section 1.2. This M0 skeleton exposes
// only foundation-level state (FPS, tick, seed, game state). Combat/AI/
// physics inspectors (GDD section 69) are added milestone by milestone.
// Rendering-only: must never mutate simulation state by being visible
// (GDD section 160).
// ============================================================

export interface DebugOverlayState {
  fps: number;
  frameTimeMs: number;
  physicsStepTimeMs: number;
  tickIndex: number;
  seedText: string;
  gameState: string;
}

export class DebugOverlay {
  private readonly root: HTMLElement;
  private visible: boolean;

  constructor(mountPoint: HTMLElement, initiallyVisible: boolean) {
    this.root = document.createElement('pre');
    this.root.style.cssText = [
      'margin:0',
      'padding:8px 12px',
      'font:12px/1.5 ui-monospace, "SF Mono", Consolas, monospace',
      'color:#8fffb0',
      'background:rgba(0,0,0,0.55)',
      'white-space:pre',
    ].join(';');
    mountPoint.appendChild(this.root);
    this.visible = initiallyVisible;
    this.applyVisibility();
  }

  toggle(): void {
    this.visible = !this.visible;
    this.applyVisibility();
  }

  update(state: DebugOverlayState): void {
    if (!this.visible) return;
    this.root.textContent =
      `ChaosBey — DEBUG (F3 to toggle)\n` +
      `state        ${state.gameState}\n` +
      `tick         ${state.tickIndex}\n` +
      `seed         ${state.seedText}\n` +
      `fps          ${state.fps.toFixed(0)}\n` +
      `frame ms     ${state.frameTimeMs.toFixed(2)}\n` +
      `physics ms   ${state.physicsStepTimeMs.toFixed(2)}`;
  }

  private applyVisibility(): void {
    this.root.style.display = this.visible ? 'block' : 'none';
  }
}
