// ============================================================
// CLASH PRESENTATION LAB — CLASH FORCE HUD (browser-only)
// A tug-of-war bar that floats between the two Beys on screen:
//   [ JOGADOR ======|=== OPONENTE ]
// Each half is its side's color and sits on the same screen side as that
// side's Bey; the seam slides toward the side that is losing. No text, no
// numbers — the proportion IS the reading.
//
// Placement: the two Beys' 3D positions are projected to screen space and
// the bar is centered just above their projected midpoint (clamped inside
// the frame), so it works with whatever the approved camera is doing —
// the camera never turns to accommodate it. The left/right orientation is
// decided when the Clash starts and held for the whole Clash so the bar
// never flips mid-disputa.
// ============================================================

import * as THREE from 'three';
import type { HudStyle } from './types';

/** Height above the contact (m) the bar is anchored to before projection. */
const ANCHOR_ABOVE_CONTACT_M = 1.35;
/** Keep the bar this many px inside the stage edges. */
const EDGE_MARGIN_PX = 16;

export interface HudFrame {
  readonly first: THREE.Vector3;
  readonly second: THREE.Vector3;
  /** 0..1 share owned by the first (player) side. */
  readonly shareFirst: number;
  readonly opacity: number;
  readonly colorFirst: number;
  readonly colorSecond: number;
  readonly style: HudStyle;
}

export class ClashHud {
  private readonly root: HTMLElement;
  private readonly left: HTMLElement;
  private readonly right: HTMLElement;
  private readonly seam: HTMLElement;
  private firstOnLeft: boolean | null = null;
  /** Last layout, for debug/tests. */
  readonly state = { visible: false, x: 0, y: 0, leftShare: 0.5, firstOnLeft: true, midX: 0, midY: 0 };

  constructor(private readonly host: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'clash-hud';
    this.root.id = 'clash-hud';
    this.root.setAttribute('aria-hidden', 'true');
    this.root.innerHTML = '<div class="clash-hud__track"><div class="clash-hud__side clash-hud__left"></div><div class="clash-hud__side clash-hud__right"></div><div class="clash-hud__seam"></div></div>';
    this.left = this.root.querySelector('.clash-hud__left')!;
    this.right = this.root.querySelector('.clash-hud__right')!;
    this.seam = this.root.querySelector('.clash-hud__seam')!;
    host.append(this.root);
  }

  /** Forget the held orientation (a new Clash / scenario). */
  reset(): void {
    this.firstOnLeft = null;
    this.hide();
  }

  hide(): void {
    this.root.style.opacity = '0';
    this.state.visible = false;
  }

  update(camera: THREE.Camera, f: HudFrame): void {
    if (f.opacity <= 0.01) {
      this.hide();
      if (f.opacity <= 0) this.firstOnLeft = null;
      return;
    }
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    const toScreen = (p: THREE.Vector3): THREE.Vector2 => {
      const v = p.clone().project(camera);
      return new THREE.Vector2((v.x * 0.5 + 0.5) * w, (-v.y * 0.5 + 0.5) * h);
    };
    const sa = toScreen(f.first);
    const sb = toScreen(f.second);
    if (this.firstOnLeft === null) this.firstOnLeft = sa.x <= sb.x;
    const mid = f.first.clone().lerp(f.second, 0.5);
    const anchor = toScreen(mid.setY(Math.max(f.first.y, f.second.y) + ANCHOR_ABOVE_CONTACT_M));
    const midScreen = sa.clone().lerp(sb, 0.5);

    this.root.dataset.style = f.style;
    const barW = this.root.offsetWidth || 260;
    const barH = this.root.offsetHeight || 18;
    const x = THREE.MathUtils.clamp(anchor.x, EDGE_MARGIN_PX + barW / 2, Math.max(EDGE_MARGIN_PX + barW / 2, w - EDGE_MARGIN_PX - barW / 2));
    const y = THREE.MathUtils.clamp(anchor.y, EDGE_MARGIN_PX + barH / 2, Math.max(EDGE_MARGIN_PX + barH / 2, h - EDGE_MARGIN_PX - barH / 2));
    const leftShare = this.firstOnLeft ? f.shareFirst : 1 - f.shareFirst;
    const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;
    const leftColor = hex(this.firstOnLeft ? f.colorFirst : f.colorSecond);
    const rightColor = hex(this.firstOnLeft ? f.colorSecond : f.colorFirst);
    this.left.style.background = this.left.style.color = leftColor; // color drives the glow styles
    this.right.style.background = this.right.style.color = rightColor;
    this.left.style.width = `${(leftShare * 100).toFixed(2)}%`;
    this.right.style.width = `${((1 - leftShare) * 100).toFixed(2)}%`;
    this.seam.style.left = `${(leftShare * 100).toFixed(2)}%`;
    this.root.style.transform = `translate(${(x - barW / 2).toFixed(1)}px, ${(y - barH / 2).toFixed(1)}px)`;
    this.root.style.opacity = f.opacity.toFixed(3);
    Object.assign(this.state, { visible: true, x, y, leftShare, firstOnLeft: this.firstOnLeft, midX: midScreen.x, midY: midScreen.y });
  }
}
