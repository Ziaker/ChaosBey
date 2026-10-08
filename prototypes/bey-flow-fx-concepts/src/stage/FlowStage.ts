// ============================================================
// BEY FLOW FX LAB — STAGE
// Renderer, camera and scene: a light-yellow stadium bowl (the owner's
// reference), two Beys on the choreographed sim, every continuous effect,
// and the glue that turns sim events into callouts. Two views: a fixed
// high "overview" camera (like the references) and a free orbit camera.
// ============================================================

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CONCEPTS } from '../../../bey-visual-concepts/src/concepts/conceptDefinitions';
import { PointPool } from '../fx/PointPool';
import { ARENA_RADIUS_M, CALLOUT_CYCLE, FlowSim, floorHeight, type CalloutKind, type FlowEvent } from '../sim/FlowSim';
import { TUNING } from '../tuning';
import { FlowRig, type FxFlags } from './FlowRig';

// ---------------- TUNING ----------------
const FIXED_DT = 1 / 60;
const MAX_FRAME_DT = 0.05;
const CAMERA_FOV = 40;
const OVERVIEW_POS = new THREE.Vector3(0, 15.5, 11.5); // ~53° pitch, the whole bowl in frame
const OVERVIEW_TARGET = new THREE.Vector3(0, 0.4, 0);
const BACKGROUND = 0x16301f;
const FLOOR_RADIAL_SEGMENTS = 64;
const FLOOR_ANGULAR_SEGMENTS = 128;
const WALL_HEIGHT_M = 1.5;
const WALL_OUTSET_M = 0.7;
const DUST_CAPACITY = 600;
const SPARK_CAPACITY = 400;
const BEY_IDS = ['attack-a', 'stamina-b'] as const;
// -----------------------------------------

export type ViewMode = 'overview' | 'free';

function floorTexture(): THREE.CanvasTexture {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d')!;
  const c = size / 2;
  const grad = g.createRadialGradient(c, c, 0, c, c, c);
  grad.addColorStop(0, '#ecdfae');
  grad.addColorStop(0.7, '#d8c78c');
  grad.addColorStop(1, '#bba66a');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  // Concentric dish lines.
  g.strokeStyle = 'rgba(120,98,50,0.35)';
  g.lineWidth = 3;
  for (const k of [0.3, 0.55, 0.78]) {
    g.beginPath();
    g.arc(c, c, c * k, 0, Math.PI * 2);
    g.stroke();
  }
  // Centre emblem: a plain red diamond on a pale disc (a stand-in, not a brand).
  g.fillStyle = 'rgba(250,244,220,0.85)';
  g.beginPath();
  g.arc(c, c, c * 0.2, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#b0322b';
  g.beginPath();
  g.moveTo(c, c - c * 0.15);
  g.lineTo(c + c * 0.15, c);
  g.lineTo(c, c + c * 0.15);
  g.lineTo(c - c * 0.15, c);
  g.closePath();
  g.fill();
  // Hazard strip at the rim.
  const inner = c * 0.93;
  const outer = c * 0.995;
  const segments = 72;
  for (let i = 0; i < segments; i++) {
    g.fillStyle = i % 2 === 0 ? '#e8b923' : '#27221a';
    g.beginPath();
    g.arc(c, c, outer, (i / segments) * Math.PI * 2, ((i + 1) / segments) * Math.PI * 2);
    g.arc(c, c, inner, ((i + 1) / segments) * Math.PI * 2, (i / segments) * Math.PI * 2, true);
    g.closePath();
    g.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function buildFloor(): THREE.Mesh {
  const geo = new THREE.RingGeometry(0.001, ARENA_RADIUS_M, FLOOR_ANGULAR_SEGMENTS, FLOOR_RADIAL_SEGMENTS);
  geo.rotateX(-Math.PI / 2); // keeps the planar UVs; XY -> XZ
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, floorHeight(Math.hypot(pos.getX(i), pos.getZ(i))));
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.82, metalness: 0, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = false;
  return mesh;
}

function buildWall(): THREE.Mesh {
  const rim = floorHeight(ARENA_RADIUS_M);
  const geo = new THREE.CylinderGeometry(ARENA_RADIUS_M + WALL_OUTSET_M, ARENA_RADIUS_M + WALL_OUTSET_M, WALL_HEIGHT_M, 96, 1, true);
  const mat = new THREE.MeshStandardMaterial({ color: 0xcdbb83, roughness: 0.9, side: THREE.BackSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = rim + WALL_HEIGHT_M / 2;
  return mesh;
}

export class FlowStage {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 300);
  readonly controls: OrbitControls;
  readonly scene = new THREE.Scene();
  readonly flags: FxFlags = { ribbon: true, helix: true, blur: true, ghost: true, dust: true, lean: true };
  sim = new FlowSim();
  timeScale = 1;
  paused = false;
  private view: ViewMode = 'overview';
  private readonly rigs: [FlowRig, FlowRig];
  private readonly dust = new PointPool(DUST_CAPACITY, false);
  private readonly sparks = new PointPool(SPARK_CAPACITY, true);
  private accumulator = 0;
  private lastMs = performance.now();
  private onEvent: (e: FlowEvent) => void = () => {};

  constructor(canvas: HTMLCanvasElement, private readonly host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.environmentIntensity = 0.55;
    this.scene.background = new THREE.Color(BACKGROUND);

    this.scene.add(new THREE.HemisphereLight(0xfff4d6, 0x6d5f3a, 0.9));
    const sun = new THREE.DirectionalLight(0xffffff, 1.3);
    sun.position.set(-6, 14, 8);
    this.scene.add(sun);
    this.scene.add(buildFloor(), buildWall());
    this.scene.add(this.dust.points, this.sparks.points);

    const [idA, idB] = BEY_IDS;
    const defA = CONCEPTS.find((c) => c.id === idA)!;
    const defB = CONCEPTS.find((c) => c.id === idB)!;
    this.rigs = [
      new FlowRig(defA, this.scene, this.dust, this.sparks, 0, 11),
      new FlowRig(defB, this.scene, this.dust, this.sparks, Math.PI / 2, 29),
    ];

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 60;
    this.setView('overview');

    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  setEventHandler(cb: (e: FlowEvent) => void): void {
    this.onEvent = cb;
  }

  setView(view: ViewMode): void {
    this.view = view;
    this.controls.enabled = view === 'free';
    if (view === 'overview') {
      this.camera.position.copy(OVERVIEW_POS);
      this.controls.target.copy(OVERVIEW_TARGET);
      this.camera.lookAt(OVERVIEW_TARGET);
    }
  }

  get viewMode(): ViewMode {
    return this.view;
  }

  reset(): void {
    const spin = this.sim.spinTarget;
    const dashes = this.sim.dashesEnabled;
    this.sim = new FlowSim();
    this.sim.spinTarget = spin;
    this.sim.dashesEnabled = dashes;
    this.rigs.forEach((r) => r.resetTrails());
  }

  fire(kind: CalloutKind): void {
    this.onEvent(this.sim.forceCallout(kind));
  }

  /** The next kind the sim will use on a real collision (for the lab's hint line). */
  static readonly cycle = CALLOUT_CYCLE;

  /** Screen position (px inside the host) of a point on the floor, a little above the Bey. */
  project(x: number, z: number): { x: number; y: number } {
    const v = new THREE.Vector3(x, floorHeight(Math.hypot(x, z)) + 1.6, z).project(this.camera);
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h };
  }

  get stats(): { ribbonSamples: number; dust: number; sparks: number; simTime: number } {
    return {
      ribbonSamples: this.rigs[0].ribbonSampleCount + this.rigs[1].ribbonSampleCount,
      dust: this.dust.liveCount,
      sparks: this.sparks.liveCount,
      simTime: this.sim.time,
    };
  }

  private resize(): void {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const px = this.renderer.domElement.height;
    this.dust.setViewport(px, CAMERA_FOV);
    this.sparks.setViewport(px, CAMERA_FOV);
  }

  private frame(): void {
    const nowMs = performance.now();
    const real = Math.min(MAX_FRAME_DT, (nowMs - this.lastMs) / 1000);
    this.lastMs = nowMs;
    const dt = this.paused ? 0 : real * this.timeScale;

    this.accumulator += dt;
    while (this.accumulator >= FIXED_DT) {
      this.accumulator -= FIXED_DT;
      this.sim.step(FIXED_DT);
      this.rigs.forEach((rig, i) => rig.record(this.sim.beys[i]!, this.sim.time, FIXED_DT, TUNING, this.flags));
      for (const e of this.sim.events) this.onEvent(e);
    }
    if (this.view === 'free') this.controls.update();

    this.rigs.forEach((rig, i) => rig.update(this.sim.beys[i]!, this.sim.time, dt, this.camera, TUNING, this.flags));
    this.dust.update(dt);
    this.sparks.update(dt);
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    this.rigs.forEach((r) => r.dispose());
    this.dust.dispose();
    this.sparks.dispose();
    this.renderer.dispose();
  }
}
