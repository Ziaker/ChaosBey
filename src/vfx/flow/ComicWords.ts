// ============================================================
// FLOW FX — COMIC WORDS ("HIT", "COUNTER!")
// The owner chose style A ("Quadrinho") in the Bey Flow FX lab on 2026-10-08 and
// asked for the words to be an OPTION in Settings. A comic burst behind thick
// outlined italic letters, a wobbling pop and a small rise, projected from the
// world point of the hit and drawn on a DOM layer between the game canvas and the HUD.
//
// BLOCK is deliberately not raised: the game has no rule for it yet (it is an open
// design question in docs/design-decisions/flow-fx-effects.md), so there is nothing
// to hang it on. HIT is every landed hit; COUNTER! is a Circular that catches a Dash.
//
// Presentation only. Without a DOM (unit tests) it keeps its counts and draws nothing.
// ============================================================

import * as THREE from 'three';

// ---------------- TUNING (the lab's style A) ----------------
const OVERLAY_Z_INDEX = '950';        // Above the game canvas and the screen overlay (900), below the HUD (1050).
const WORD_LIFT_M = 1.6;              // above the hit point
const TILT_RANGE_DEG = 10;
const SAFETY_MARGIN_MS = 250;
const MAX_LIVE = 6;
// ------------------------------------------------------------

export type ComicWordKind = 'hit' | 'counter';

export const COMIC_WORDS: Readonly<Record<ComicWordKind, string>> = { hit: 'HIT', counter: 'COUNTER!' };

let styleInjected = false;
function injectStyle(): void {
  if (styleInjected || typeof document === 'undefined') return;
  styleInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .cb-flow-word { position: absolute; transform: translate(-50%, -50%) rotate(var(--tilt)); white-space: nowrap; font-weight: 900; line-height: 1; animation: cb-flow-pop var(--life) linear forwards; font: italic 900 calc(46px * var(--scale)) / 1 Impact, 'Arial Black', sans-serif; color: var(--c1); -webkit-text-stroke: calc(7px * var(--scale)) #1a0f0a; paint-order: stroke fill; text-shadow: calc(4px * var(--scale)) calc(4px * var(--scale)) 0 #1a0f0a; }
    .cb-flow-word.kind-hit { --c1: #ffd23f; --c2: #ff7a1a; }
    .cb-flow-word.kind-counter { --c1: #ff7ad2; --c2: #ffd23f; }
    .cb-flow-word::before { content: ''; position: absolute; inset: -42% -22%; z-index: -1; background: var(--c2); opacity: 0.92; clip-path: polygon(100.0% 50.0%, 82.4% 56.4%, 96.2% 69.1%, 77.4% 68.3%, 85.4% 85.4%, 68.3% 77.4%, 69.1% 96.2%, 56.4% 82.4%, 50.0% 100.0%, 43.6% 82.4%, 30.9% 96.2%, 31.7% 77.4%, 14.6% 85.4%, 22.6% 68.3%, 3.8% 69.1%, 17.6% 56.4%, 0.0% 50.0%, 17.6% 43.6%, 3.8% 30.9%, 22.6% 31.7%, 14.6% 14.6%, 31.7% 22.6%, 30.9% 3.8%, 43.6% 17.6%, 50.0% 0.0%, 56.4% 17.6%, 69.1% 3.8%, 68.3% 22.6%, 85.4% 14.6%, 77.4% 31.7%, 96.2% 30.9%, 82.4% 43.6%); }
    @keyframes cb-flow-pop {
      0% { scale: 0.2; translate: 0 0; rotate: -14deg; opacity: 0; }
      12% { scale: 1.38; rotate: 4deg; opacity: 1; }
      26% { scale: 0.96; rotate: -2deg; }
      38% { scale: 1.04; rotate: 0deg; }
      78% { scale: 1; translate: 0 -8px; opacity: 1; }
      100% { scale: 0.9; translate: 0 -34px; opacity: 0; }
    }
    @media (prefers-reduced-motion: reduce) { .cb-flow-word { animation-duration: calc(var(--life) * 0.6); } }
  `;
  document.head.append(style);
}

export class ComicWords {
  private readonly host: HTMLElement | null = null;
  private readonly live = new Set<HTMLElement>();
  private readonly tmp = new THREE.Vector3();
  /** Words raised since the start (observability for the tests and the stats). */
  spawned = 0;

  constructor(
    private readonly camera: THREE.Camera,
    parent: HTMLElement | null = typeof document === 'undefined' ? null : document.body,
  ) {
    if (!parent || typeof document === 'undefined') return;
    injectStyle();
    const host = document.createElement('div');
    host.setAttribute('data-testid', 'flow-fx-words');
    host.style.cssText = `position:fixed;inset:0;pointer-events:none;overflow:hidden;z-index:${OVERLAY_Z_INDEX};`;
    parent.appendChild(host);
    this.host = host;
  }

  get liveCount(): number {
    return this.live.size;
  }

  /** `at` is the world point of the hit; `m` (0..1) makes bigger hits bigger. */
  spawn(kind: ComicWordKind, at: { x: number; y: number; z: number }, scale: number, lifeS: number, m: number): void {
    this.spawned++;
    if (!this.host) return;
    const ndc = this.tmp.set(at.x, at.y + WORD_LIFT_M, at.z).project(this.camera);
    if (ndc.z > 1) return; // behind the camera
    while (this.live.size >= MAX_LIVE) {
      const oldest = this.live.values().next().value as HTMLElement;
      this.live.delete(oldest);
      oldest.remove();
    }
    const el = document.createElement('div');
    el.className = `cb-flow-word kind-${kind}`;
    el.textContent = COMIC_WORDS[kind];
    el.style.left = `${((ndc.x + 1) / 2) * 100}%`;
    el.style.top = `${((1 - ndc.y) / 2) * 100}%`;
    el.style.setProperty('--scale', String(scale * (0.8 + 0.5 * m)));
    el.style.setProperty('--life', `${lifeS}s`);
    el.style.setProperty('--tilt', `${(Math.random() - 0.5) * TILT_RANGE_DEG}deg`);
    this.host.appendChild(el);
    this.live.add(el);
    const remove = (): void => {
      this.live.delete(el);
      el.remove();
    };
    el.addEventListener('animationend', remove, { once: true });
    window.setTimeout(remove, lifeS * 1000 + SAFETY_MARGIN_MS);
  }

  clear(): void {
    for (const el of this.live) el.remove();
    this.live.clear();
  }

  dispose(): void {
    this.clear();
    this.host?.remove();
  }
}
