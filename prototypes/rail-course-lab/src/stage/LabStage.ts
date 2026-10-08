// ============================================================
// RAIL COURSE LAB — STAGE
// The scene is the GAME's, as in the Bey Flow lab: the approved arena art of the stage, on the game's own funnel floor, with
// its fog and tone mapping, so a course is judged where it will be and not over an invented floor. On top of it: the rails
// (a tube each), the gates (a ring at each end the size of the capture reach), a rider that follows the ride preview, and
// four views.
// ============================================================

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { ArenaVisualsSystem } from '../../../../src/arena/visual/ArenaVisualsSystem';
import type { ArenaPresetId } from '../../../../src/arena/presets/ArenaPresets';
import { floorHeightAtRadius, type ArenaFloor } from '../../../../src/arena/floor/ArenaFloorProfile';
import type { RailDefinition } from '../../../../src/arena/rails/RailBlueprint';
import { RAIL_TUNING } from '../../../../src/arena/rails/RailTraversal';
import { createRailGateMarkers, createRailVisuals } from '../../../../src/presentation/railVisual';
import { RideSim } from '../sim/RideSim';

// ---------------- TUNING ----------------
const FIXED_DT = 1 / 60;
const MAX_FRAME_DT = 0.05;
const CAMERA_FOV = 50;
const CAMERA_NEAR = 0.1;
const CAMERA_FAR = 1200;
/** The tube is drawn thicker than the game's so a 100 m route reads from the overview. */
const TUBE_RADIUS_M = 0.22;
const RIDER_RADIUS_M = 0.65;
const RIDER_COLOR_HEX = 0xff8a3d;
const OVERVIEW_POS = new THREE.Vector3(0, 125, 92);
const TOP_POS = new THREE.Vector3(0, 190, 0.01);
const CHASE_BEHIND_M = 13;
const CHASE_ABOVE_M = 6;
const CHASE_FOLLOW_PER_S = 6;
// -----------------------------------------

export type ViewMode = 'overview' | 'top' | 'ride' | 'free';
export const VIEW_MODES: readonly ViewMode[] = ['overview', 'top', 'ride', 'free'];

export class LabStage {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, CAMERA_NEAR, CAMERA_FAR);
  readonly controls: OrbitControls;
  readonly scene = new THREE.Scene();
  paused = false;
  pingPong = true;
  private view: ViewMode = 'overview';
  private arena: ArenaVisualsSystem | null = null;
  private arenaTime = 0;
  private readonly arenaRoot = new THREE.Group();
  private railRoot = new THREE.Group();
  private gates: THREE.Group | null = null;
  private showGates = true;
  private readonly rider: THREE.Mesh;
  private readonly landingMark: THREE.Mesh;
  private rails: readonly RailDefinition[] = [];
  private rides: RideSim[] = [];
  private activeRide = 0;
  private accumulator = 0;
  private lastMs = performance.now();
  private readonly chaseFocus = new THREE.Vector3();
  private chaseReady = false;
  private floor: ArenaFloor;
  private floorRadiusM: number;

  constructor(canvas: HTMLCanvasElement, private readonly host: HTMLElement, floor: ArenaFloor, floorRadiusM: number, presetId: ArenaPresetId) {
    this.floor = floor;
    this.floorRadiusM = floorRadiusM;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.add(this.arenaRoot, this.railRoot);

    this.rider = new THREE.Mesh(
      new THREE.CylinderGeometry(RIDER_RADIUS_M, RIDER_RADIUS_M, 0.4, 24),
      new THREE.MeshBasicMaterial({ color: RIDER_COLOR_HEX, fog: false }),
    );
    this.landingMark = new THREE.Mesh(
      new THREE.RingGeometry(0.8, 1.1, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: RIDER_COLOR_HEX, transparent: true, opacity: 0.8, fog: false }),
    );
    this.landingMark.visible = false;
    this.scene.add(this.rider, this.landingMark, this.referenceRings());
    this.setArena(presetId);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 400;
    this.setView('overview');

    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  /** Faint rings at 1×, 1.5× and 2× the floor radius and spokes every 30°, on the rim's level: the void outside the arena needs something to measure a course against. */
  private referenceRings(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'reference';
    const rimY = floorHeightAtRadius(this.floor, this.floorRadiusM);
    const material = new THREE.LineBasicMaterial({ color: 0x3a5068, transparent: true, opacity: 0.55, fog: false });
    for (const u of [1.5, 2]) {
      const points: THREE.Vector3[] = [];
      for (let i = 0; i <= 96; i++) {
        const a = (i / 96) * Math.PI * 2;
        points.push(new THREE.Vector3(Math.cos(a) * this.floorRadiusM * u, rimY, Math.sin(a) * this.floorRadiusM * u));
      }
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material));
    }
    for (let deg = 0; deg < 360; deg += 30) {
      const a = (deg * Math.PI) / 180;
      const from = new THREE.Vector3(Math.cos(a) * this.floorRadiusM * 1.02, rimY, Math.sin(a) * this.floorRadiusM * 1.02);
      const to = new THREE.Vector3(Math.cos(a) * this.floorRadiusM * 2, rimY, Math.sin(a) * this.floorRadiusM * 2);
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([from, to]), material));
    }
    return group;
  }

  /** Swaps the arena for one of the game's three approved ones. */
  setArena(id: ArenaPresetId): void {
    this.arena?.dispose();
    const heightAtR = (r: number): number => floorHeightAtRadius(this.floor, r);
    this.arena = new ArenaVisualsSystem({ scene: this.scene, root: this.arenaRoot, presetId: id, floorHeightAtR: heightAtR, renderer: this.renderer });
    const built = this.arena.built;
    this.scene.environmentIntensity = built.environmentIntensity;
    this.scene.background = (built.fog?.color ?? new THREE.Color(0x05070a)).clone();
  }

  /** Shows these rails (replacing the previous ones) and starts a ride on the first. */
  setRails(rails: readonly RailDefinition[]): void {
    this.rails = rails;
    this.scene.remove(this.railRoot);
    this.railRoot.traverse((o) => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose();
    });
    this.railRoot = new THREE.Group();
    this.railRoot.add(createRailVisuals(rails, TUBE_RADIUS_M));
    this.gates = createRailGateMarkers(rails, RAIL_TUNING.captureRadiusM, (x, z) => floorHeightAtRadius(this.floor, Math.hypot(x, z)));
    this.gates.visible = this.showGates;
    this.railRoot.add(this.gates);
    this.scene.add(this.railRoot);
    this.rides = rails.map((rail) => new RideSim(rail, this.floor, this.floorRadiusM, () => this.pingPong));
    this.activeRide = Math.min(this.activeRide, Math.max(0, rails.length - 1));
    this.chaseReady = false;
  }

  get ride(): RideSim | null {
    return this.rides[this.activeRide] ?? null;
  }

  setActiveRail(index: number): void {
    this.activeRide = Math.max(0, Math.min(this.rides.length - 1, index));
    this.chaseReady = false;
  }

  restart(): void {
    this.ride?.start(1);
    this.chaseReady = false;
  }

  jump(): void {
    this.ride?.jump();
  }

  setGatesVisible(visible: boolean): void {
    this.showGates = visible;
    if (this.gates) this.gates.visible = visible;
  }

  get gatesVisible(): boolean {
    return this.showGates;
  }

  get viewMode(): ViewMode {
    return this.view;
  }

  setView(view: ViewMode): void {
    this.view = view;
    this.controls.enabled = view === 'free';
    this.chaseReady = false;
    if (view === 'overview') {
      this.camera.position.copy(OVERVIEW_POS);
      this.controls.target.set(0, 0, 8);
      this.camera.lookAt(this.controls.target);
    } else if (view === 'top') {
      this.camera.position.copy(TOP_POS);
      this.controls.target.set(0, 0, 0);
      this.camera.lookAt(this.controls.target);
    } else if (view === 'free') {
      this.controls.update();
    }
  }

  private updateChaseCamera(dt: number): void {
    const ride = this.ride;
    if (!ride) return;
    const p = ride.position;
    const sample = ride.phase === 'flying' ? null : this.rails[this.activeRide]?.path.sampleAt(ride.progressM);
    const tx = sample ? sample.tangent.x * ride.direction : ride.velocity.x;
    const ty = sample ? sample.tangent.y * ride.direction : ride.velocity.y;
    const tz = sample ? sample.tangent.z * ride.direction : ride.velocity.z;
    const flat = Math.hypot(tx, tz) || 1;
    const k = this.chaseReady ? 1 - Math.exp(-CHASE_FOLLOW_PER_S * dt) : 1;
    this.chaseReady = true;
    this.chaseFocus.x += (p.x - this.chaseFocus.x) * k;
    this.chaseFocus.y += (p.y - this.chaseFocus.y) * k;
    this.chaseFocus.z += (p.z - this.chaseFocus.z) * k;
    this.camera.position.set(
      this.chaseFocus.x - (tx / flat) * CHASE_BEHIND_M,
      this.chaseFocus.y + CHASE_ABOVE_M - ty * 2,
      this.chaseFocus.z - (tz / flat) * CHASE_BEHIND_M,
    );
    this.camera.lookAt(this.chaseFocus.x + (tx / flat) * 6, this.chaseFocus.y, this.chaseFocus.z + (tz / flat) * 6);
  }

  private resize(): void {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private frame(): void {
    const nowMs = performance.now();
    const real = Math.min(MAX_FRAME_DT, (nowMs - this.lastMs) / 1000);
    this.lastMs = nowMs;
    if (!this.paused) {
      this.accumulator += real;
      while (this.accumulator >= FIXED_DT) {
        this.accumulator -= FIXED_DT;
        this.ride?.step(FIXED_DT);
      }
    }
    const ride = this.ride;
    if (ride) {
      this.rider.position.set(ride.position.x, ride.position.y, ride.position.z);
      this.rider.visible = true;
      if (ride.landing) {
        this.landingMark.visible = true;
        this.landingMark.position.set(ride.landing.x, ride.landing.y + 0.1, ride.landing.z);
      } else {
        this.landingMark.visible = false;
      }
    }
    if (this.view === 'free') this.controls.update();
    else if (this.view === 'ride') this.updateChaseCamera(real);
    if (this.arena) {
      this.arenaTime += real;
      this.arena.built.update({ time: this.arenaTime, dt: real, clash: 0 });
    }
    this.renderer.render(this.scene, this.camera);
  }
}
