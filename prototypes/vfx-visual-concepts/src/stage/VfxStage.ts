// ============================================================
// VFX LAB — STAGE
// Renderer, shared camera, and the 2D overlays for screen-space effects
// (focus lines, tint, impact-frame negative flash). Renders one world, or
// two side by side (split view: A | B) with the same camera.
// ============================================================

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { World } from './World';

// ---------------- TUNING ----------------
const CAMERA_FOV = 45;
const CAMERA_OFFSET = new THREE.Vector3(5.5, 5.2, 9.5); // from the action focus (center scenes)
const CAMERA_WALL_BACK = 9.5;                           // near the wall: camera stays on the arena side
const MIN_HORIZONTAL_FOV = 44;                          // narrow split viewports widen the vertical FOV
const FOCUS_LINE_ALPHA = 0.7;
const GLOBAL_SLOW_FACTOR = 0.25;                        // "Slow motion" toggle speed
const DIVIDER_PX = 2;
// -----------------------------------------

export class VfxStage {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 400);
  readonly controls: OrbitControls;
  worlds: World[] = [];
  slowMotion = false;
  private readonly overlay: CanvasRenderingContext2D;
  private readonly invert: CanvasRenderingContext2D;
  private readonly env: THREE.Texture;
  private lastFocus: THREE.Vector3 | null = null;
  private lastMs = performance.now();
  private time = 0;

  constructor(canvas: HTMLCanvasElement, overlay: HTMLCanvasElement, invert: HTMLCanvasElement, private readonly stage: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setScissorTest(true);
    this.renderer.autoClear = true;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.overlay = overlay.getContext('2d')!;
    this.invert = invert.getContext('2d')!;

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.minDistance = 3;
    this.controls.maxDistance = 40;
    this.camera.position.copy(CAMERA_OFFSET).add(new THREE.Vector3(0, 0.8, 0));
    this.controls.target.set(0, 0.8, 0);

    new ResizeObserver(() => this.resize()).observe(stage);
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  setWorlds(worlds: World[]): void {
    this.worlds.forEach((w) => w.dispose());
    this.worlds = worlds;
    for (const w of worlds) {
      w.scene.environment = this.env;
      w.scene.environmentIntensity = w.arena.environmentIntensity;
    }
    this.lastFocus = null;
    this.resize();
  }

  /** Put the camera back on its default framing around the current action. */
  resetCamera(): void {
    const f = this.worlds[0]?.focusPoint() ?? new THREE.Vector3(0, 0.8, 0);
    // Narrow columns (3-way compare) get a closer camera so the effects stay readable.
    const k = this.worlds.length >= 3 ? 0.68 : 1;
    this.controls.target.copy(f);
    const r = Math.hypot(f.x, f.z);
    if (r > 2) {
      // Action near the wall: look outward from inside the bowl so the wall never blocks the view.
      const inward = new THREE.Vector3(-f.x / r, 0, -f.z / r);
      const side = new THREE.Vector3(-inward.z, 0, inward.x);
      this.camera.position.copy(f).addScaledVector(inward, CAMERA_WALL_BACK * k).addScaledVector(side, 3.5 * k).add(new THREE.Vector3(0, 5.2 * k, 0));
    } else {
      this.camera.position.copy(f).addScaledVector(CAMERA_OFFSET, k);
    }
    this.lastFocus = f;
  }

  private viewports(): Array<{ x: number; y: number; w: number; h: number }> {
    const W = this.stage.clientWidth;
    const H = this.stage.clientHeight;
    const n = Math.max(1, this.worlds.length);
    // Equal columns separated by thin dividers (1, 2 or 3 worlds side by side).
    const colW = Math.floor((W - DIVIDER_PX * (n - 1)) / n);
    return Array.from({ length: n }, (_, i) => {
      const x = i * (colW + DIVIDER_PX);
      return { x, y: 0, w: i === n - 1 ? W - x : colW, h: H };
    });
  }

  private frame(): void {
    const now = performance.now();
    const realDt = Math.min((now - this.lastMs) / 1000, 0.1);
    this.lastMs = now;
    const dt = realDt * (this.slowMotion ? GLOBAL_SLOW_FACTOR : 1);
    this.time += dt;
    this.worlds.forEach((w) => w.update(dt, this.time));

    // Follow the action focus (moves both camera and target, keeps the user's orbit).
    const focus = this.worlds[0]?.focusPoint();
    if (focus) {
      if (this.lastFocus) {
        const delta = focus.clone().sub(this.lastFocus).multiplyScalar(Math.min(1, realDt * 3));
        this.camera.position.add(delta);
        this.controls.target.add(delta);
        this.lastFocus.add(delta);
      } else {
        this.lastFocus = focus.clone();
      }
    }
    this.controls.update();

    const W = this.stage.clientWidth;
    const H = this.stage.clientHeight;
    const dpr = this.renderer.getPixelRatio();
    this.renderer.setScissor(0, 0, W, H);
    this.renderer.setViewport(0, 0, W, H);
    this.renderer.setClearColor(0x2a2f38);
    this.renderer.clear();
    this.overlay.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.invert.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.overlay.clearRect(0, 0, W, H);
    this.invert.clearRect(0, 0, W, H);

    this.viewports().forEach((vp, i) => {
      const w = this.worlds[i];
      if (!w) return;
      this.camera.aspect = vp.w / vp.h;
      const minV = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(MIN_HORIZONTAL_FOV / 2)) / this.camera.aspect));
      this.camera.fov = Math.max(CAMERA_FOV, minV);
      this.camera.updateProjectionMatrix();
      const glY = H - vp.y - vp.h;
      this.renderer.setViewport(vp.x, glY, vp.w, vp.h);
      this.renderer.setScissor(vp.x, glY, vp.w, vp.h);
      this.renderer.toneMappingExposure = w.arena.exposure;
      const k = w.shake.total > 0 ? w.shake.remaining / w.shake.total : 0;
      const offset = new THREE.Vector3((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2).multiplyScalar(w.shake.amp * k);
      this.camera.position.add(offset);
      this.renderer.render(w.scene, this.camera);
      this.drawOverlay(w, vp);
      this.camera.position.sub(offset);
    });
  }

  private drawOverlay(w: World, vp: { x: number; y: number; w: number; h: number }): void {
    const g = this.overlay;
    g.save();
    g.beginPath();
    g.rect(vp.x, vp.y, vp.w, vp.h);
    g.clip();
    if (w.tint) {
      g.fillStyle = w.tint.css;
      g.fillRect(vp.x, vp.y, vp.w, vp.h);
    }
    for (const f of w.focus) {
      const p = f.pos.clone().project(this.camera);
      const cx = vp.x + ((p.x + 1) / 2) * vp.w;
      const cy = vp.y + ((1 - p.y) / 2) * vp.h;
      const fade = f.remaining / f.total;
      const outer = Math.hypot(vp.w, vp.h);
      // Lines start well away from the focus so the action itself stays visible.
      const inner = Math.min(vp.w, vp.h) * (0.5 - 0.12 * f.strength);
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
    g.restore();
    if (w.impactT > 0) {
      // Drawn on a `mix-blend-mode: difference` canvas: white inverts the frame.
      this.invert.fillStyle = '#ffffff';
      this.invert.fillRect(vp.x, vp.y, vp.w, vp.h);
    }
  }

  private resize(): void {
    const W = Math.max(1, this.stage.clientWidth);
    const H = Math.max(1, this.stage.clientHeight);
    this.renderer.setSize(W, H, false);
    const dpr = this.renderer.getPixelRatio();
    for (const c of [this.overlay.canvas, this.invert.canvas]) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
    }
  }
}
