// ============================================================
// BEY FLOW FX LAB — STAGE
// Renderer, camera and scene. The scene is the GAME's: the approved arena art
// the game builds for each preset (Foundry Pit, Rift Crater, Tournament Stadium),
// on the game's own floor profile (the 7 m funnel), with the game's tone mapping
// and fog, so an effect is judged where it will live and not over an invented
// floor. Two Beys move on the choreographed sim; every continuous effect and
// the glue that turns sim events into callouts is here too.
//
// Three views: "game" (a low, close camera like the game's Arena Fighter that
// keeps both Beys in frame), "overview" (high and fixed, like the references)
// and "free" (orbit).
// ============================================================

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { ArenaVisualsSystem } from '../../../../src/arena/visual/ArenaVisualsSystem';
import type { ArenaPresetId } from '../../../../src/arena/presets/ArenaPresets';
import { CONCEPTS } from '../../../bey-visual-concepts/src/concepts/conceptDefinitions';
import { FxLayer } from '../../../../src/vfx/hybrid/fx/FxLayer';
import { AnimeWind } from '../fx/AnimeWind';
import type { DustStyle } from '../fx/AnimeDust';
import { CALLOUT_CYCLE, FlowSim, floorHeight, type CalloutKind, type FlowEvent } from '../sim/FlowSim';
import { TUNING } from '../tuning';
import { FlowRig, type FxFlags } from './FlowRig';

// ---------------- TUNING ----------------
const FIXED_DT = 1 / 60;
const MAX_FRAME_DT = 0.05;
const CAMERA_FOV = 60;
const CAMERA_NEAR = 0.1;
const CAMERA_FAR = 800;
const OVERVIEW_POS = new THREE.Vector3(0, 20, 15);
const OVERVIEW_TARGET = new THREE.Vector3(0, 0.4, 0);
// The game's Arena Fighter (camera-approval.md): 5.8 m minimum distance, 13 m maximum, 2.4 m high, rising 0.3 m per extra metre.
const GAME_MIN_DISTANCE_M = 6.5;
const GAME_MAX_DISTANCE_M = 13;
const GAME_SEPARATION_RESPONSE = 0.7;
const GAME_HEIGHT_M = 2.6;
const GAME_HEIGHT_PER_M = 0.3;
const GAME_AZIMUTH_RAD = 0.35;     // the camera sits behind the arena's +z side, a little to the side
const GAME_FOCUS_Y_M = 0.5;
const GAME_FOLLOW_PER_S = 4;
const BEY_IDS = ['attack-a', 'stamina-b'] as const;
const DEFAULT_ARENA: ArenaPresetId = 'foundry';
// -----------------------------------------

export type ViewMode = 'game' | 'overview' | 'free';

export class FlowStage {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, CAMERA_NEAR, CAMERA_FAR);
  readonly controls: OrbitControls;
  readonly scene = new THREE.Scene();
  readonly flags: FxFlags = { blur: true, lean: true, dust: true, wind: true, crown: true, shadow: true };
  sim = new FlowSim();
  timeScale = 1;
  paused = false;
  private view: ViewMode = 'game';
  private arena: ArenaVisualsSystem | null = null;
  private arenaId: ArenaPresetId = DEFAULT_ARENA;
  private readonly arenaRoot = new THREE.Group();
  private arenaTime = 0;
  private readonly camFocus = new THREE.Vector3();
  private camDistance = GAME_MIN_DISTANCE_M;
  private camReady = false;
  private readonly rigs: [FlowRig, FlowRig];
  private readonly layer: FxLayer;
  private readonly wind: AnimeWind;
  private readonly prevDashing = [false, false];
  private readonly tip = new THREE.Vector3();
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
    this.scene.add(this.arenaRoot);
    this.layer = new FxLayer(this.scene, this.camera);
    this.wind = new AnimeWind(this.layer, this.camera, this.scene);
    this.setArena(DEFAULT_ARENA);

    const [idA, idB] = BEY_IDS;
    const defA = CONCEPTS.find((c) => c.id === idA)!;
    const defB = CONCEPTS.find((c) => c.id === idB)!;
    this.rigs = [
      new FlowRig(defA, this.scene),
      new FlowRig(defB, this.scene),
    ];

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 60;
    this.setView('game');

    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  setEventHandler(cb: (e: FlowEvent) => void): void {
    this.onEvent = cb;
  }

  /** Swaps the arena for one of the game's three approved ones (the same art, floor profile, fog and tone mapping the game uses). */
  setArena(id: ArenaPresetId): void {
    this.arena?.dispose();
    this.arenaId = id;
    this.arena = new ArenaVisualsSystem({ scene: this.scene, root: this.arenaRoot, presetId: id, floorHeightAtR: floorHeight, renderer: this.renderer });
    const built = this.arena.built;
    this.scene.environmentIntensity = built.environmentIntensity;
    const fog = built.fog?.color ?? new THREE.Color(0x05070a);
    this.scene.background = fog.clone();
  }

  get arenaPreset(): ArenaPresetId {
    return this.arenaId;
  }

  setView(view: ViewMode): void {
    this.view = view;
    this.controls.enabled = view === 'free';
    this.camReady = false;
    if (view === 'overview') {
      this.camera.position.copy(OVERVIEW_POS);
      this.controls.target.copy(OVERVIEW_TARGET);
      this.camera.lookAt(OVERVIEW_TARGET);
    }
  }

  /** The game's Arena Fighter in miniature: close and low, both Beys in frame, the angle fixed, distance and height following their separation. */
  private updateGameCamera(dt: number): void {
    const [a, b] = this.sim.beys;
    const mx = (a.x + b.x) / 2;
    const mz = (a.z + b.z) / 2;
    const sep = Math.hypot(a.x - b.x, a.z - b.z);
    const wantDist = Math.min(GAME_MAX_DISTANCE_M, GAME_MIN_DISTANCE_M + GAME_SEPARATION_RESPONSE * Math.max(0, sep - 3));
    const k = this.camReady ? 1 - Math.exp(-GAME_FOLLOW_PER_S * dt) : 1;
    this.camReady = true;
    this.camFocus.x += (mx - this.camFocus.x) * k;
    this.camFocus.z += (mz - this.camFocus.z) * k;
    this.camFocus.y = floorHeight(Math.hypot(this.camFocus.x, this.camFocus.z)) + GAME_FOCUS_Y_M;
    this.camDistance += (wantDist - this.camDistance) * k;
    const height = GAME_HEIGHT_M + GAME_HEIGHT_PER_M * (this.camDistance - GAME_MIN_DISTANCE_M);
    this.camera.position.set(
      this.camFocus.x + Math.sin(GAME_AZIMUTH_RAD) * this.camDistance,
      this.camFocus.y + height,
      this.camFocus.z + Math.cos(GAME_AZIMUTH_RAD) * this.camDistance,
    );
    this.camera.lookAt(this.camFocus);
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
    this.layer.clear();
    this.wind.clear();
    this.prevDashing[0] = false;
    this.prevDashing[1] = false;
  }

  /** Raises the Dash shock rings now, aimed at the other Bey, through the same path a real Dash release uses (the lab's "G" button). */
  previewDash(): void {
    const [a, b] = this.sim.beys;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const d = Math.hypot(dx, dz) || 1;
    a.dashDirX = dx / d;
    a.dashDirZ = dz / d;
    this.wind.dashStart(0, a, TUNING, this.flags);
  }

  fire(kind: CalloutKind): void {
    this.handleEvent(this.sim.forceCallout(kind));
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

  get stats(): { live: number; dust: number; simTime: number } {
    return { live: this.layer.count(), dust: this.wind.emittedDust, simTime: this.sim.time };
  }

  get dustStyle(): DustStyle {
    return this.wind.dustStyle;
  }

  setDustStyle(style: DustStyle): void {
    this.wind.dustStyle = style;
  }

  private handleEvent(e: FlowEvent): void {
    this.wind.impact(e.x, e.z, e.m, e.dirX, e.dirZ, TUNING, this.flags);
    this.onEvent(e);
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
    const dt = this.paused ? 0 : real * this.timeScale;

    this.accumulator += dt;
    while (this.accumulator >= FIXED_DT) {
      this.accumulator -= FIXED_DT;
      this.sim.step(FIXED_DT);
      this.sim.beys.forEach((b, i) => {
        // A Dash just started: shock rings and a puff of clouds behind the Bey.
        if (b.dashing && !this.prevDashing[i]) this.wind.dashStart(i as 0 | 1, b, TUNING, this.flags);
        this.prevDashing[i] = b.dashing;
      });
      for (const e of this.sim.events) this.handleEvent(e);
    }
    if (this.view === 'free') this.controls.update();
    else if (this.view === 'game') this.updateGameCamera(real);
    if (this.arena) {
      this.arenaTime += real;
      this.arena.built.update({ time: this.arenaTime, dt: real, clash: 0 });
    }

    this.rigs.forEach((rig, i) => {
      const b = this.sim.beys[i]!;
      rig.update(b, dt, TUNING, this.flags);
      this.wind.trail(i as 0 | 1, b, rig.tip(this.tip), dt, TUNING, this.flags);
    });
    this.layer.tick(dt);
    this.wind.update(dt, TUNING);
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    this.rigs.forEach((r) => r.dispose());
    this.layer.clear();
    this.wind.dispose();
    this.arena?.dispose();
    this.renderer.dispose();
  }
}
