// ============================================================
// BEY MOTION LAB — PHYSICS VIEWER
// Renders either the lab's motion model (MotionWorld, live parameters,
// reproducible scenarios) or a REPLAY of what the game itself did
// (exported JSON, see scripts/replays.export.ts), with debug overlays:
// velocity, heading, steering, spin axis, contact normal, trail.
//
// The "combat" camera reproduces the game's CURRENT combat camera as a
// reference only — camera language is decided later in a separate Camera
// Lab, not here.
// ============================================================

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { assembleConcept, type BuiltConcept } from '../../../bey-visual-concepts/src/model/assembleConcept';
import type { ConceptDefinition } from '../../../bey-visual-concepts/src/model/types';
import { BEY_SCALE, GAME_CAMERA_DISTANCE_M, GAME_CAMERA_FOV_DEG, GAME_CAMERA_HEIGHT_M, GAME_CAMERA_MAX_DISTANCE_M, GAME_CAMERA_MIN_DISTANCE_M, GAME_CAMERA_SEPARATION_REFERENCE_M, GAME_CAMERA_SEPARATION_TO_DISTANCE, GAME_CAMERA_SHOULDER_OFFSET_RAD } from '../tuning';
import { ARENA_RADIUS_M, MotionWorld, WALL_HEIGHT_M, grounded, isTumbling, spinAxis, tiltAngle, type BeyBody } from './model';
import type { PhysicsParams } from './params';
import type { Scenario } from './scenarios';

export type PhysicsCamera = 'combat' | 'follow' | 'top' | 'side' | 'free';

export interface Replay {
  title: string;
  seed: string;
  beys: string[];
  outcome: string;
  endTick: number;
  dt: number;
  arena: { floorRadius: number; wallHeight: number; ringOutRadius: number };
  events: Array<{ t: number; kind: string; bey?: number; detail?: string }>;
  /** Per Bey, per sample: [x, y, z, qx, qy, qz, qw, spinAngle, wobbleOffset, vx, vy, vz, grounded]. */
  frames: number[][][];
  states: string[][];
}

export interface DebugFlags {
  velocity: boolean;
  heading: boolean;
  steering: boolean;
  spinAxis: boolean;
  contact: boolean;
  trail: boolean;
}

export interface BeyReadout {
  speed: number;
  heading: number;
  velocityHeading: number;
  slipAngle: number;
  tilt: number;
  tiltRate: number;
  whirl: number;
  spinRate: number;
  wobble: number;
  grip: number;
  slipping: boolean;
  grounded: boolean;
  height: number;
  recoveryTorque: number;
  tumbling: boolean;
  scraping: boolean;
  ringOut: boolean;
  state?: string;
}

interface Visual {
  root: THREE.Group;
  attitude: THREE.Group;
  spin: THREE.Group;
  built: BuiltConcept;
  arrows: Record<'velocity' | 'heading' | 'steering' | 'spinAxis' | 'contact', THREE.ArrowHelper>;
  trail: THREE.Line;
  trailPoints: THREE.Vector3[];
}

const TRAIL_MAX = 240;
const ARROW_COLORS = { velocity: 0x4dff88, heading: 0x4db8ff, steering: 0xffd24d, spinAxis: 0xffffff, contact: 0xff4d4d } as const;

export class PhysicsViewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(GAME_CAMERA_FOV_DEG, 1, 0.05, 200);
  readonly controls: OrbitControls;
  readonly world: MotionWorld;
  scenario: Scenario | null = null;
  replay: Replay | null = null;
  cameraMode: PhysicsCamera = 'combat';
  followIndex = 0;
  timeScale = 1;
  paused = false;
  debug: DebugFlags = { velocity: true, heading: true, steering: false, spinAxis: true, contact: true, trail: true };
  /** Rendering is suspended while the other lab section is shown. */
  active = false;

  private visuals: Visual[] = [];
  private concepts: ConceptDefinition[];
  private replayT = 0;
  private lastMs = performance.now();
  private accumulator = 0;
  private frames = 0;
  private readonly target = new THREE.Vector3();
  private orbitYaw: number | null = null;
  private readonly listeners: Array<() => void> = [];

  constructor(canvas: HTMLCanvasElement, private readonly stage: HTMLElement, params: PhysicsParams, concepts: ConceptDefinition[]) {
    this.world = new MotionWorld(params);
    this.concepts = concepts;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.background = new THREE.Color(0x0b0e14);
    this.buildArena();

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.enabled = false;
    canvas.addEventListener('pointerdown', () => {
      if (this.cameraMode !== 'free') this.setCamera('free');
    });
    this.camera.position.set(0, 12, 16);
    this.camera.lookAt(0, 0, 0);
    new ResizeObserver(() => this.resize()).observe(stage);
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  onChange(l: () => void): void {
    this.listeners.push(l);
  }

  private emit(): void {
    this.listeners.forEach((l) => l());
  }

  get frameCount(): number {
    return this.frames;
  }

  get time(): number {
    return this.replay ? this.replayT : this.world.t;
  }

  get duration(): number {
    if (this.replay) return this.replay.frames[0]!.length * this.replay.dt;
    return this.scenario?.duration ?? 0;
  }

  setParams(params: PhysicsParams): void {
    this.world.params = params;
  }

  setConcepts(concepts: ConceptDefinition[]): void {
    this.concepts = concepts;
    this.rebuildVisuals(this.visuals.length);
  }

  setCamera(mode: PhysicsCamera): void {
    this.cameraMode = mode;
    this.controls.enabled = mode === 'free';
    if (mode === 'free') this.controls.target.copy(this.target);
    this.orbitYaw = null;
    this.emit();
  }

  /** Runs a lab scenario from t = 0 with the current parameters (reproducible). */
  playScenario(s: Scenario): void {
    this.replay = null;
    this.scenario = s;
    this.world.reset(s.beys, s.hits ?? []);
    this.accumulator = 0;
    this.rebuildVisuals(s.beys.length);
    this.orbitYaw = null;
    this.paused = false;
    this.emit();
  }

  restart(): void {
    if (this.replay) this.playReplay(this.replay);
    else if (this.scenario) this.playScenario(this.scenario);
  }

  /** Plays back what the game did (exported), with the same overlays. */
  playReplay(r: Replay): void {
    this.replay = r;
    this.scenario = null;
    this.replayT = 0;
    this.rebuildVisuals(r.frames.length);
    this.orbitYaw = null;
    this.paused = false;
    this.emit();
  }

  /** Jump to time t. A scenario is re-simulated from 0 (it is deterministic, so this lands on exactly the same state). */
  seek(t: number): void {
    const target = Math.max(0, Math.min(this.duration, t));
    if (this.replay) {
      this.replayT = target;
    } else if (this.scenario) {
      const s = this.scenario;
      this.world.reset(s.beys, s.hits ?? []);
      this.accumulator = 0;
      this.visuals.forEach((v) => (v.trailPoints.length = 0));
      this.world.advance(Math.floor(target * 240) / 240, (time, b) => s.input(time, b));
    }
    this.paused = true;
    this.emit();
  }

  /** Notable moments of the current replay: events, ring-out, the longest wedge, the highest point. */
  replayMoments(): Array<{ t: number; label: string }> {
    const r = this.replay;
    if (!r) return [];
    const moments: Array<{ t: number; label: string }> = [];
    for (const e of r.events) {
      if (e.kind === 'knockback') moments.push({ t: e.t, label: `knockback on Bey ${(e.bey ?? 0) + 1} (${e.detail})` });
      else if (e.kind === 'hit') moments.push({ t: e.t, label: `hit by Bey ${(e.bey ?? 0) + 1}${e.detail ? ` — ${e.detail}` : ''}` });
    }
    r.frames.forEach((fr, b) => {
      let run = 0;
      let start = 0;
      let best = { len: 0, start: 0 };
      let maxY = { y: 0, i: 0 };
      let ringOut: number | null = null;
      fr.forEach((f, i) => {
        const rad = Math.hypot(f[0]!, f[2]!);
        const speed = Math.hypot(f[9]!, f[11]!);
        if (rad > r.arena.floorRadius && speed < 0.5) {
          if (run === 0) start = i;
          run++;
          if (run > best.len) best = { len: run, start };
        } else run = 0;
        if (f[1]! > maxY.y) maxY = { y: f[1]!, i };
        if (ringOut === null && rad > r.arena.ringOutRadius) ringOut = i;
      });
      if (best.len * r.dt > 1) moments.push({ t: best.start * r.dt, label: `Bey ${b + 1} wedged past the floor edge for ${(best.len * r.dt).toFixed(1)} s` });
      if (maxY.y > 0.6) moments.push({ t: maxY.i * r.dt, label: `Bey ${b + 1} highest point ${maxY.y.toFixed(1)} m` });
      if (ringOut !== null) moments.push({ t: ringOut * r.dt, label: `Bey ${b + 1} crosses the ring-out radius` });
    });
    return moments.sort((a, b) => a.t - b.t);
  }

  /** Advance one rendered frame (1/60 s of simulated time) while paused. */
  step(): void {
    this.advanceSim(1 / 60);
  }

  private rebuildVisuals(count: number): void {
    for (const v of this.visuals) {
      this.scene.remove(v.root, v.trail);
      Object.values(v.arrows).forEach((a) => this.scene.remove(a));
      v.built.dispose();
    }
    this.visuals = [];
    for (let i = 0; i < count; i++) {
      const concept = this.concepts[i % this.concepts.length]!;
      const built = assembleConcept(concept);
      built.root.traverse((o) => {
        if (o instanceof THREE.Mesh) o.castShadow = true;
      });
      const spin = new THREE.Group();
      spin.add(built.root);
      spin.scale.setScalar(BEY_SCALE);
      const attitude = new THREE.Group();
      attitude.add(spin);
      const root = new THREE.Group();
      root.add(attitude);
      this.scene.add(root);
      const mk = (color: number) => {
        const a = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(), 1, color, 0.25, 0.14);
        (a.line.material as THREE.LineBasicMaterial).depthTest = false;
        (a.cone.material as THREE.MeshBasicMaterial).depthTest = false;
        a.renderOrder = 10;
        this.scene.add(a);
        return a;
      };
      const arrows = {
        velocity: mk(ARROW_COLORS.velocity),
        heading: mk(ARROW_COLORS.heading),
        steering: mk(ARROW_COLORS.steering),
        spinAxis: mk(ARROW_COLORS.spinAxis),
        contact: mk(ARROW_COLORS.contact),
      };
      const trail = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: i === 0 ? 0x33c4ff : 0xffb547, transparent: true, opacity: 0.8 }));
      trail.frustumCulled = false;
      this.scene.add(trail);
      this.visuals.push({ root, attitude, spin, built, arrows, trail, trailPoints: [] });
    }
  }

  private buildArena(): void {
    this.scene.add(new THREE.HemisphereLight(0xcfd8ff, 0x20242c, 0.6));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(6, 16, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 45 });
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(ARENA_RADIUS_M, 96).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x3a404b, roughness: 0.8 }));
    floor.receiveShadow = true;
    this.scene.add(floor);
    const lineMat = new THREE.LineBasicMaterial({ color: 0x566072, transparent: true, opacity: 0.5 });
    for (let r = 2; r < ARENA_RADIUS_M; r += 2) {
      const pts = Array.from({ length: 129 }, (_, i) => new THREE.Vector3(Math.cos((i / 128) * Math.PI * 2) * r, 0.005, Math.sin((i / 128) * Math.PI * 2) * r));
      this.scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat));
    }
    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(ARENA_RADIUS_M, ARENA_RADIUS_M, WALL_HEIGHT_M, 96, 1, true).translate(0, WALL_HEIGHT_M / 2, 0),
      new THREE.MeshStandardMaterial({ color: 0x8fa6c4, roughness: 0.4, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.scene.add(wall);
    const rimPts = Array.from({ length: 129 }, (_, i) => new THREE.Vector3(Math.cos((i / 128) * Math.PI * 2) * ARENA_RADIUS_M, WALL_HEIGHT_M, Math.sin((i / 128) * Math.PI * 2) * ARENA_RADIUS_M));
    this.scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(rimPts), new THREE.LineBasicMaterial({ color: 0x9fb4d0 })));
    const outside = new THREE.Mesh(new THREE.RingGeometry(ARENA_RADIUS_M, 40, 96).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x151920, roughness: 1 }));
    outside.position.y = -1.5;
    this.scene.add(outside);
  }

  // ---- Simulation / playback ----

  private advanceSim(dt: number): void {
    if (this.replay) {
      this.replayT = Math.min(this.duration, this.replayT + dt);
      return;
    }
    if (!this.scenario || this.world.t >= this.scenario.duration) return;
    this.accumulator += dt;
    const chunk = 1 / 240;
    const steps = Math.floor(this.accumulator / chunk);
    if (steps > 0) {
      this.world.advance(steps * chunk, (t, b) => this.scenario!.input(t, b));
      this.accumulator -= steps * chunk;
    }
  }

  readouts(): BeyReadout[] {
    if (this.replay) {
      const idx = Math.min(this.replay.frames[0]!.length - 1, Math.floor(this.replayT / this.replay.dt));
      return this.replay.frames.map((fr, i) => {
        const f = fr[idx]!;
        const q = new THREE.Quaternion(f[3], f[4], f[5], f[6]);
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
        const speed = Math.hypot(f[9]!, f[11]!);
        return {
          speed,
          heading: NaN,
          velocityHeading: Math.atan2(f[9]!, f[11]!),
          slipAngle: NaN,
          tilt: Math.acos(Math.max(-1, Math.min(1, up.y))),
          tiltRate: NaN,
          whirl: NaN,
          spinRate: NaN,
          wobble: Math.abs(f[8]!),
          grip: NaN,
          slipping: false,
          grounded: f[12] === 1,
          height: f[1]!,
          recoveryTorque: NaN,
          tumbling: false,
          scraping: Math.hypot(f[0]!, f[2]!) > ARENA_RADIUS_M - 0.8,
          ringOut: Math.hypot(f[0]!, f[2]!) > this.replay!.arena.ringOutRadius,
          state: this.replay!.states[i]![idx],
        };
      });
    }
    return this.world.bodies.map((b) => {
      const speed = Math.hypot(b.vel.x, b.vel.z);
      const vh = Math.atan2(b.vel.x, b.vel.z);
      let slip = vh - b.heading;
      slip = Math.atan2(Math.sin(slip), Math.cos(slip));
      return {
        speed,
        heading: b.heading,
        velocityHeading: vh,
        slipAngle: speed > 0.5 ? slip : 0,
        tilt: tiltAngle(b),
        tiltRate: Math.hypot(b.tiltRate.x, b.tiltRate.z),
        whirl: b.whirl,
        spinRate: b.spinRate,
        wobble: b.wobbleEnergy,
        grip: b.grip,
        slipping: b.slipping,
        grounded: grounded(b),
        height: b.y,
        recoveryTorque: b.recoveryTorque,
        tumbling: isTumbling(b, this.world.t),
        scraping: b.scraping,
        ringOut: b.ringOut,
      };
    });
  }

  // ---- Frame ----

  private frame(): void {
    const now = performance.now();
    const realDt = Math.min(0.1, (now - this.lastMs) / 1000);
    this.lastMs = now;
    if (!this.active) return;
    if (!this.paused) this.advanceSim(realDt * this.timeScale);
    this.syncVisuals();
    this.updateCamera(realDt);
    if (this.cameraMode === 'free') this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.frames++;
  }

  private setArrow(a: THREE.ArrowHelper, show: boolean, origin: THREE.Vector3, dir: THREE.Vector3, length: number): void {
    a.visible = show && length > 0.05;
    if (!a.visible) return;
    a.position.copy(origin);
    a.setDirection(dir.clone().normalize());
    a.setLength(length, Math.min(0.3, length * 0.35), Math.min(0.16, length * 0.2));
  }

  private syncVisuals(): void {
    const up = new THREE.Vector3(0, 1, 0);
    if (this.replay) {
      const idx = Math.min(this.replay.frames[0]!.length - 1, Math.floor(this.replayT / this.replay.dt));
      this.visuals.forEach((v, i) => {
        const f = this.replay!.frames[i]![idx]!;
        // The game's collider center sits above the floor; the visual model's base is at its origin.
        v.root.position.set(f[0]!, Math.max(0, f[1]! - 0.2), f[2]!);
        const q = new THREE.Quaternion(f[3], f[4], f[5], f[6]);
        const wobble = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), f[8]!);
        v.attitude.quaternion.copy(q).multiply(wobble);
        v.spin.rotation.y = f[7]!;
        const origin = v.root.position.clone().setY(v.root.position.y + 0.4);
        const vel = new THREE.Vector3(f[9], 0, f[11]);
        this.setArrow(v.arrows.velocity, this.debug.velocity, origin, vel, vel.length() * 0.25);
        this.setArrow(v.arrows.spinAxis, this.debug.spinAxis, v.root.position, up.clone().applyQuaternion(q), 1.6);
        v.arrows.heading.visible = false;
        v.arrows.steering.visible = false;
        v.arrows.contact.visible = false;
        this.pushTrail(v, v.root.position);
      });
      return;
    }
    this.visuals.forEach((v, i) => {
      const b = this.world.bodies[i];
      if (!b) return;
      this.syncBody(v, b);
    });
  }

  private syncBody(v: Visual, b: BeyBody): void {
    const p = this.world.params;
    v.root.position.set(b.pos.x, b.y, b.pos.z);
    const a = tiltAngle(b);
    const tiltQ = new THREE.Quaternion();
    if (a > 1e-6) tiltQ.setFromAxisAngle(new THREE.Vector3(b.tilt.z / a, 0, -b.tilt.x / a), a);
    const yawQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.heading);
    const wobbleAngle = Math.sin(b.wobblePhase) * ((p.wobbleAmplitude * Math.PI) / 180) * b.wobbleEnergy;
    const wobbleQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), wobbleAngle);
    v.attitude.quaternion.copy(tiltQ).multiply(yawQ).multiply(wobbleQ);
    v.spin.rotation.y = b.spinAngle;
    v.root.visible = !b.ringOut || b.y > -3;

    const origin = new THREE.Vector3(b.pos.x, b.y + 0.4, b.pos.z);
    const vel = new THREE.Vector3(b.vel.x, 0, b.vel.z);
    this.setArrow(v.arrows.velocity, this.debug.velocity, origin, vel, vel.length() * 0.25);
    this.setArrow(v.arrows.heading, this.debug.heading, origin, new THREE.Vector3(Math.sin(b.heading), 0, Math.cos(b.heading)), 1.4);
    this.setArrow(v.arrows.steering, this.debug.steering, origin, new THREE.Vector3(b.steerDir.x, 0, b.steerDir.z), 1.1);
    const ax = spinAxis(b);
    this.setArrow(v.arrows.spinAxis, this.debug.spinAxis, new THREE.Vector3(b.pos.x, b.y, b.pos.z), new THREE.Vector3(ax.x, ax.y, ax.z), 1.6);
    const recent = this.world.t - b.contactT < 0.5 && b.contactNormal !== null;
    if (recent && b.contactNormal) {
      this.setArrow(v.arrows.contact, this.debug.contact, origin, new THREE.Vector3(b.contactNormal.x, 0, b.contactNormal.z), 1.2);
    } else v.arrows.contact.visible = false;
    this.pushTrail(v, new THREE.Vector3(b.pos.x, b.y + 0.02, b.pos.z));
  }

  private pushTrail(v: Visual, p: THREE.Vector3): void {
    const last = v.trailPoints[v.trailPoints.length - 1];
    if (!last || last.distanceToSquared(p) > 0.0025) {
      v.trailPoints.push(p.clone());
      if (v.trailPoints.length > TRAIL_MAX) v.trailPoints.shift();
      v.trail.geometry.dispose();
      v.trail.geometry = new THREE.BufferGeometry().setFromPoints(v.trailPoints);
    }
    v.trail.visible = this.debug.trail;
  }

  // ---- Camera ----

  private positions(): THREE.Vector3[] {
    return this.visuals.map((v) => v.root.position.clone());
  }

  private updateCamera(dt: number): void {
    const mode = this.cameraMode;
    if (mode === 'free') return;
    const ps = this.positions();
    if (ps.length === 0) return;
    const focus = ps.reduce((acc, p) => acc.add(p), new THREE.Vector3()).multiplyScalar(1 / ps.length).setY(0);
    const k = 1 - Math.exp(-6 * dt);
    let pos: THREE.Vector3;
    let look = focus;
    if (mode === 'combat') {
      // The game's CURRENT combat camera, reference only (see the file header).
      const sep = ps.length >= 2 ? Math.hypot(ps[0]!.x - ps[1]!.x, ps[0]!.z - ps[1]!.z) : 0;
      const axisYaw = ps.length >= 2 && sep > 1e-3 ? Math.atan2(ps[1]!.x - ps[0]!.x, ps[1]!.z - ps[0]!.z) : Math.PI;
      if (this.orbitYaw === null) this.orbitYaw = axisYaw;
      else {
        let d = axisYaw - this.orbitYaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        this.orbitYaw += d * (1 - Math.exp(-3 * dt));
      }
      const dist = Math.min(GAME_CAMERA_MAX_DISTANCE_M, Math.max(GAME_CAMERA_MIN_DISTANCE_M, GAME_CAMERA_DISTANCE_M + Math.max(0, sep - GAME_CAMERA_SEPARATION_REFERENCE_M) * GAME_CAMERA_SEPARATION_TO_DISTANCE));
      const yaw = this.orbitYaw + Math.PI + GAME_CAMERA_SHOULDER_OFFSET_RAD;
      pos = new THREE.Vector3(focus.x + Math.sin(yaw) * dist, GAME_CAMERA_HEIGHT_M, focus.z + Math.cos(yaw) * dist);
    } else if (mode === 'follow') {
      const p = ps[Math.min(this.followIndex, ps.length - 1)]!;
      look = p.clone().setY(0.4);
      pos = new THREE.Vector3(p.x + 2.2, 1.6, p.z + 3.2);
    } else if (mode === 'top') {
      pos = new THREE.Vector3(0.01, 28, 0.01);
      look = new THREE.Vector3();
    } else {
      pos = new THREE.Vector3(focus.x, 1.4, focus.z + 9);
      look = focus.clone().setY(0.8);
    }
    this.camera.position.lerp(pos, k);
    this.target.lerp(look, k);
    this.camera.fov = GAME_CAMERA_FOV_DEG;
    this.camera.lookAt(this.target);
    this.camera.updateProjectionMatrix();
  }

  snapCamera(): void {
    this.orbitYaw = null;
    this.syncVisuals();
    this.updateCamera(10);
  }

  resize(): void {
    const w = Math.max(1, this.stage.clientWidth);
    const h = Math.max(1, this.stage.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}
