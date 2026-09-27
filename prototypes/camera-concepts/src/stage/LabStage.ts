// ============================================================
// CAMERA LAB — STAGE (renderer, one or three viewports, debug markers)
// Renders the one shared fight scene through one camera per preset. In
// "single" view only the active preset's camera is drawn; in "compare"
// all three are drawn side by side (columns, or rows on a narrow stage) on
// the exact same fight. Each preset has its own group of 3D debug markers
// (focus target, midpoint, look-ahead, velocity arrows, encounter point),
// shown only in that preset's viewport.
//
// Cameras are applied from interpolated director output (see main.ts), so
// slow motion and high-refresh displays stay smooth while the director
// itself only ever runs on the fixed 60 Hz tick.
// ============================================================

import * as THREE from 'three';
import { PRESET_IDS, type PresetId } from '../director/CameraParams';
import type { DirectorOutput } from '../director/CameraDirector';
import type { Vec3 } from '../fight/FightFrame';

// ---------------- STAGE TUNING ----------------
const BACKGROUND = 0x05050a;              // Same as the game (createRenderer.ts).
const GROUND_RADIUS_M = 60;               // Dark ground outside the arena, so a ring-out has something under it.
export const VIEW_ASPECT = 16 / 9;        // Every view is letterboxed to the game's typical 16:9, so framing compares fairly.
const VELOCITY_ARROW_S = 0.18;            // Velocity arrows show this many seconds of travel.
export const PRESET_COLORS: Readonly<Record<PresetId, number>> = { A: 0x6fd3ff, B: 0xffb347, C: 0xff4fa3 };
// ----------------------------------------------

export interface CameraPose {
  eye: Vec3;
  focus: Vec3;
  fov: number;
  shake: Vec3;
}

export interface Viewport {
  readonly id: PresetId;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

interface Markers {
  group: THREE.Group;
  focus: THREE.Mesh;
  midpoint: THREE.Mesh;
  encounter: THREE.Mesh;
  lookAhead: THREE.ArrowHelper;
  velFirst: THREE.ArrowHelper;
  velSecond: THREE.ArrowHelper;
}

export class LabStage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly cameras: Record<PresetId, THREE.PerspectiveCamera>;
  private readonly markers: Record<PresetId, Markers>;
  private sourceGroup: THREE.Object3D | null = null;
  private viewports: Viewport[] = [];
  private readonly dir = new THREE.Vector3();
  showMarkers = true;

  constructor(canvas: HTMLCanvasElement, private readonly host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setScissorTest(true);
    this.scene.background = new THREE.Color(BACKGROUND);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(GROUND_RADIUS_M, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x0b0c12, roughness: 1 }));
    ground.position.y = -3;
    this.scene.add(ground);
    const make = (): THREE.PerspectiveCamera => new THREE.PerspectiveCamera(60, 1, 0.05, 400);
    this.cameras = { A: make(), B: make(), C: make() };
    this.markers = { A: this.makeMarkers(PRESET_COLORS.A), B: this.makeMarkers(PRESET_COLORS.B), C: this.makeMarkers(PRESET_COLORS.C) };
  }

  private makeMarkers(color: number): Markers {
    const group = new THREE.Group();
    const mat = (c: number, opacity = 0.9): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity, depthTest: false });
    const focus = new THREE.Mesh(new THREE.OctahedronGeometry(0.16), mat(color));
    const midpoint = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.45, 32).rotateX(-Math.PI / 2), mat(0x7fe0ff, 0.8));
    const encounter = new THREE.Mesh(new THREE.RingGeometry(0.18, 0.3, 4).rotateX(-Math.PI / 2), mat(0xff9a3c, 0.9));
    const arrow = (c: number): THREE.ArrowHelper => {
      const a = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1, c, 0.3, 0.18);
      a.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.Line) {
          (o.material as THREE.Material).depthTest = false;
          o.renderOrder = 10;
        }
      });
      return a;
    };
    const lookAhead = arrow(0xff4fd8);
    const velFirst = arrow(0x7fe07f);
    const velSecond = arrow(0xff6060);
    for (const o of [focus, midpoint, encounter]) o.renderOrder = 10;
    group.add(focus, midpoint, encounter, lookAhead, velFirst, velSecond);
    group.visible = false;
    this.scene.add(group);
    return { group, focus, midpoint, encounter, lookAhead, velFirst, velSecond };
  }

  setSource(group: THREE.Object3D): void {
    if (this.sourceGroup) this.scene.remove(this.sourceGroup);
    this.sourceGroup = group;
    this.scene.add(group);
  }

  get currentViewports(): readonly Viewport[] {
    return this.viewports;
  }

  /**
   * 16:9 cells, centred: one big cell, or three stacked in rows or side by
   * side — whichever arrangement gives the bigger cells.
   */
  private layout(ids: readonly PresetId[]): Viewport[] {
    const W = this.host.clientWidth;
    const H = this.host.clientHeight;
    const n = ids.length;
    const fit = (w: number, h: number): { w: number; h: number } => (w / h > VIEW_ASPECT ? { w: Math.floor(h * VIEW_ASPECT), h: Math.floor(h) } : { w: Math.floor(w), h: Math.floor(w / VIEW_ASPECT) });
    if (n === 1) {
      const c = fit(W, H);
      return [{ id: ids[0]!, x: Math.floor((W - c.w) / 2), y: Math.floor((H - c.h) / 2), w: c.w, h: c.h }];
    }
    const rows = fit(W, H / n);
    const cols = fit(W / n, H);
    if (rows.w >= cols.w) {
      const y0 = Math.floor((H - rows.h * n) / 2);
      return ids.map((id, i) => ({ id, x: Math.floor((W - rows.w) / 2), y: y0 + i * rows.h, w: rows.w, h: rows.h }));
    }
    const x0 = Math.floor((W - cols.w * n) / 2);
    return ids.map((id, i) => ({ id, x: x0 + i * cols.w, y: Math.floor((H - cols.h) / 2), w: cols.w, h: cols.h }));
  }

  /** Aspect ratio every view has (the director uses it for its in-frame checks). */
  aspectFor(): number {
    return VIEW_ASPECT;
  }

  updateMarkers(id: PresetId, out: DirectorOutput, first: { position: Vec3; velocity: Vec3 }, second: { position: Vec3; velocity: Vec3 }): void {
    const m = this.markers[id];
    const d = out.debug;
    m.focus.position.set(d.focusTarget.x, d.focusTarget.y, d.focusTarget.z);
    m.midpoint.position.set(d.midpoint.x, 0.05, d.midpoint.z);
    m.encounter.visible = d.encounterPoint !== null;
    if (d.encounterPoint) m.encounter.position.set(d.encounterPoint.x, 0.06, d.encounterPoint.z);
    const arrowTo = (a: THREE.ArrowHelper, from: Vec3, v: Vec3, scale: number): void => {
      const len = Math.hypot(v.x, v.z) * scale;
      a.visible = len > 0.15;
      if (!a.visible) return;
      a.position.set(from.x, from.y + 0.6, from.z);
      a.setDirection(this.dir.set(v.x, 0, v.z).normalize());
      a.setLength(len, Math.min(0.35, len * 0.4), Math.min(0.2, len * 0.25));
    };
    arrowTo(m.lookAhead, d.midpoint, d.lookAheadVec, 1);
    arrowTo(m.velFirst, first.position, first.velocity, VELOCITY_ARROW_S);
    arrowTo(m.velSecond, second.position, second.velocity, VELOCITY_ARROW_S);
  }

  render(poses: Readonly<Record<PresetId, CameraPose>>, ids: readonly PresetId[]): void {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    const size = this.renderer.getSize(new THREE.Vector2());
    if (size.x !== w || size.y !== h) this.renderer.setSize(w, h, false);
    this.viewports = this.layout(ids);
    // Clear the letterbox bars.
    this.renderer.setViewport(0, 0, w, h);
    this.renderer.setScissor(0, 0, w, h);
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.clear();
    for (const vp of this.viewports) {
      const cam = this.cameras[vp.id];
      const pose = poses[vp.id];
      cam.position.set(pose.eye.x + pose.shake.x, pose.eye.y + pose.shake.y, pose.eye.z + pose.shake.z);
      cam.lookAt(pose.focus.x + pose.shake.x * 0.3, pose.focus.y + pose.shake.y * 0.3, pose.focus.z + pose.shake.z * 0.3);
      cam.fov = pose.fov;
      cam.aspect = vp.w / Math.max(1, vp.h);
      cam.updateProjectionMatrix();
      for (const id of PRESET_IDS) this.markers[id].group.visible = this.showMarkers && id === vp.id;
      this.renderer.setViewport(vp.x, h - vp.y - vp.h, vp.w, vp.h);
      this.renderer.setScissor(vp.x, h - vp.y - vp.h, vp.w, vp.h);
      this.renderer.render(this.scene, cam);
    }
  }

  dispose(): void {
    this.renderer.dispose();
  }
}
