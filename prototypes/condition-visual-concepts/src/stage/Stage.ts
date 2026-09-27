// ============================================================
// STAMINA & STABILITY LAB — STAGE (renderer, viewports, camera)
// Renders one world full-frame, or three worlds side by side (compare
// A | B | C) through scissored viewports with the same camera. Camera modes:
//
//   game     the game's combat framing (src/camera/CameraTuning.ts values:
//            9 m back, 6 m up, 55° FOV) behind the Bey under test
//   gameFar  the same framing behind the OPPONENT — the Bey under test is
//            now the far one, as the AI's Bey is in a real match
//   close    slow orbit about 4 m away
//   ladder   fixed wide shot of the five-Bey ladder
//   free     OrbitControls (dragging the view switches to this)
// ============================================================

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { World } from './World';

// ---------------- CAMERA TUNING ----------------
// Mirrors src/camera/CameraTuning.ts (not imported: prototypes stay isolated from the game).
const GAME_DISTANCE_M = 9;
const GAME_HEIGHT_M = 6;
const GAME_FOV_DEG = 55;
const GAME_SHOULDER_RAD = 0.35;
const GAME_LOOK_BIAS = 0.35;          // Look point: this far from the camera's own Bey toward the other.
const CLOSE_DISTANCE_M = 4;
const CLOSE_HEIGHT_M = 1.5;
const CLOSE_ORBIT_RAD_S = 0.22;
const CLOSE_FOV_DEG = 40;
const LADDER_HALF_WIDTH_M = 7;        // Half the width the ladder shot must always fit (5 Beys + labels).
const LADDER_MIN_DISTANCE_M = 11;
const LADDER_ELEVATION = 0.4;         // Eye height as a fraction of the eye distance.
const LADDER_TARGET = new THREE.Vector3(0, 0.55, 0);
const LADDER_FOV_DEG = 40;
const SMOOTHING_PER_S = 5;
const COMPARE_ROWS_BELOW_PX = 520;   // Stage narrower than this stacks the compare views as rows.
// ------------------------------------------------

export type CameraMode = 'game' | 'gameFar' | 'close' | 'ladder' | 'free';

export interface Viewport {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera = new THREE.PerspectiveCamera(GAME_FOV_DEG, 1, 0.05, 200);
  readonly controls: OrbitControls;
  readonly environment: THREE.Texture;
  private worlds: World[] = [];
  private mode: CameraMode = 'game';
  private readonly eye = new THREE.Vector3(0, 8, 14);
  private readonly look = new THREE.Vector3();
  private readonly desiredEye = new THREE.Vector3();
  private readonly desiredLook = new THREE.Vector3();
  private closeAngle = 0;
  private snap = true;
  private viewports: Viewport[] = [];
  private readonly modeListeners: Array<(m: CameraMode) => void> = [];

  constructor(canvas: HTMLCanvasElement, private readonly host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setScissorTest(true);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.enabled = false;
    this.controls.maxDistance = 40;
    this.controls.minDistance = 1.5;
    // Any drag or wheel on the view switches to free orbit from the current framing.
    canvas.addEventListener('pointerdown', () => this.setMode('free'));
    canvas.addEventListener('wheel', () => this.setMode('free'), { passive: true });
  }

  onModeChange(fn: (m: CameraMode) => void): void {
    this.modeListeners.push(fn);
  }

  get cameraMode(): CameraMode {
    return this.mode;
  }

  setWorlds(worlds: World[]): void {
    this.worlds = worlds;
    this.snap = true;
  }

  setMode(mode: CameraMode): void {
    if (mode === this.mode) return;
    const wasFree = this.mode === 'free';
    this.mode = mode;
    if (mode === 'free') {
      this.controls.target.copy(this.look);
      this.controls.enabled = true;
      this.controls.update();
    } else {
      this.controls.enabled = false;
      if (wasFree) this.eye.copy(this.camera.position);
      this.snap = mode === 'ladder';
    }
    this.modeListeners.forEach((fn) => fn(mode));
  }

  /**
   * Layout in CSS pixels: full frame, or three columns. Columns keep the full
   * height, so with a fixed vertical FOV each Bey stays the same on-screen size
   * as in the single view; rows only on very narrow (phone) stages.
   */
  layout(): Viewport[] {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    if (this.worlds.length <= 1) return [{ x: 0, y: 0, w, h }];
    const n = this.worlds.length;
    if (w >= COMPARE_ROWS_BELOW_PX) {
      const cw = Math.floor(w / n);
      return this.worlds.map((_, i) => ({ x: i * cw, y: 0, w: i === n - 1 ? w - cw * (n - 1) : cw, h }));
    }
    const rh = Math.floor(h / n);
    return this.worlds.map((_, i) => ({ x: 0, y: i * rh, w, h: i === n - 1 ? h - rh * (n - 1) : rh }));
  }

  get currentViewports(): readonly Viewport[] {
    return this.viewports;
  }

  private resize(): void {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    const size = this.renderer.getSize(new THREE.Vector2());
    if (size.x !== w || size.y !== h) this.renderer.setSize(w, h, false);
  }

  private updateCamera(dt: number): void {
    const world = this.worlds[0];
    const main = world?.entries[0];
    if (this.mode === 'free') {
      if (main) this.controls.target.lerp(main.rig.root.position, Math.min(1, dt * 1.5));
      this.controls.update();
      this.look.copy(this.controls.target);
      return;
    }
    let fov = GAME_FOV_DEG;
    if (this.mode === 'ladder' || !main) {
      // Pull back until the whole ladder fits the current aspect ratio.
      const aspect = this.host.clientWidth / Math.max(1, this.host.clientHeight);
      const halfH = Math.tan((LADDER_FOV_DEG * Math.PI) / 360);
      const d = Math.max(LADDER_MIN_DISTANCE_M, LADDER_HALF_WIDTH_M / (halfH * aspect) + 2);
      this.desiredEye.set(0, d * LADDER_ELEVATION, d);
      this.desiredLook.copy(LADDER_TARGET);
      fov = LADDER_FOV_DEG;
    } else if (this.mode === 'close') {
      this.closeAngle += CLOSE_ORBIT_RAD_S * dt;
      const p = main.rig.root.position;
      this.desiredEye.set(p.x + Math.cos(this.closeAngle) * CLOSE_DISTANCE_M, p.y + CLOSE_HEIGHT_M, p.z + Math.sin(this.closeAngle) * CLOSE_DISTANCE_M);
      this.desiredLook.set(p.x, p.y + main.rig.dims.height * 0.45, p.z);
      fov = CLOSE_FOV_DEG;
    } else {
      // Game framing: behind "my" Bey, over the shoulder, looking toward the other one.
      const target = main.rig.root.position;
      const other = world?.opponentPosition ?? new THREE.Vector3(0, target.y, 0);
      const me = this.mode === 'game' ? target : other;
      const them = this.mode === 'game' ? other : target;
      const dx = them.x - me.x;
      const dz = them.z - me.z;
      const a = Math.atan2(dz, dx) + Math.PI + GAME_SHOULDER_RAD;
      this.desiredEye.set(me.x + Math.cos(a) * GAME_DISTANCE_M, me.y + GAME_HEIGHT_M, me.z + Math.sin(a) * GAME_DISTANCE_M);
      this.desiredLook.set(me.x + dx * GAME_LOOK_BIAS, (me.y + them.y) / 2 + 0.4, me.z + dz * GAME_LOOK_BIAS);
    }
    const k = this.snap ? 1 : 1 - Math.exp(-SMOOTHING_PER_S * dt);
    this.snap = false;
    this.eye.lerp(this.desiredEye, k);
    this.look.lerp(this.desiredLook, k);
    this.camera.position.copy(this.eye);
    this.camera.lookAt(this.look);
    if (this.camera.fov !== fov) {
      this.camera.fov += (fov - this.camera.fov) * Math.min(1, k * 2);
      if (Math.abs(this.camera.fov - fov) < 0.05) this.camera.fov = fov;
    }
  }

  render(dt: number): void {
    this.resize();
    this.updateCamera(dt);
    this.viewports = this.layout();
    const H = this.host.clientHeight;
    this.worlds.forEach((world, i) => {
      const v = this.viewports[i]!;
      this.camera.aspect = v.w / Math.max(1, v.h);
      this.camera.updateProjectionMatrix();
      const pxPerMeter = (v.h * this.renderer.getPixelRatio()) / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
      world.setPointScale(pxPerMeter);
      // WebGL viewport origin is bottom-left.
      this.renderer.setViewport(v.x, H - v.y - v.h, v.w, v.h);
      this.renderer.setScissor(v.x, H - v.y - v.h, v.w, v.h);
      this.renderer.render(world.scene, this.camera);
    });
  }

  /** Screen position (CSS px, relative to the stage) of a world point in viewport `i`, or null when behind the camera. */
  project(point: THREE.Vector3, i: number, out: { x: number; y: number }): boolean {
    const v = this.viewports[i];
    if (!v) return false;
    this.camera.aspect = v.w / Math.max(1, v.h);
    this.camera.updateProjectionMatrix();
    const p = point.clone().project(this.camera);
    if (p.z > 1) return false;
    out.x = v.x + ((p.x + 1) / 2) * v.w;
    out.y = v.y + ((1 - p.y) / 2) * v.h;
    return true;
  }

  dispose(): void {
    this.controls.dispose();
    this.environment.dispose();
    this.renderer.dispose();
  }
}
