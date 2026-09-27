// ============================================================
// BEY MOTION LAB — VIEWER
// Shows the round-2 concepts (same models as the Bey Lab, built by its
// assembleConcept) the way the game renders a Bey: game scale, spinning
// at a visual spin rate, tilted, wobbling, moving across the floor, seen
// from the combat camera. The per-Bey node chain mirrors the game's
// (src/app/bootstrap/createMatchScene.ts): body orientation (tilt) ×
// wobble (a rock about the Bey's local X axis) -> spin group (rotation.y).
//
// Movement here is choreography, not physics.
// ============================================================

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { assembleConcept, type BuiltConcept } from '../../bey-visual-concepts/src/model/assembleConcept';
import type { ConceptDefinition } from '../../bey-visual-concepts/src/model/types';
import {
  BEY_SCALE,
  BLUR_GHOSTS,
  BLUR_SHUTTER,
  DUEL_PHASE_GAP_RAD,
  GAME_CAMERA_DISTANCE_M,
  GAME_CAMERA_FOV_DEG,
  GAME_CAMERA_HEIGHT_M,
  GAME_CAMERA_HIGH_SPEED_EXTRA_DISTANCE_M,
  GAME_CAMERA_HIGH_SPEED_EXTRA_FOV_DEG,
  GAME_CAMERA_HIGH_SPEED_EXTRA_HEIGHT_M,
  GAME_CAMERA_HIGH_SPEED_FULL_MPS,
  GAME_CAMERA_HIGH_SPEED_THRESHOLD_MPS,
  GAME_CAMERA_MAX_DISTANCE_M,
  GAME_CAMERA_MIN_DISTANCE_M,
  GAME_CAMERA_ORBIT_SMOOTHING_PER_S,
  GAME_CAMERA_POSITION_SMOOTHING_PER_S,
  GAME_CAMERA_SEPARATION_REFERENCE_M,
  GAME_CAMERA_SEPARATION_TO_DISTANCE,
  GAME_CAMERA_SHOULDER_OFFSET_RAD,
  GAME_MAX_TILT_RAD,
  GAME_WOBBLE_AMPLITUDE_RAD,
  GAME_WOBBLE_FREQUENCY_HZ,
  GAME_ZERO_STAMINA_WOBBLE_FLOOR,
  GRID_SPACING_M,
  ORBIT_RADIUS_M,
  SPIN_DOWN_MAX_WOBBLE,
  SPIN_DOWN_SECONDS,
  TURN_LEAN_PER_ACCEL,
} from './tuning';

export type LayoutMode = 'solo' | 'duel' | 'grid';
export type MotionMode = 'still' | 'orbit' | 'figure8';
export type CameraMode = 'combat' | 'close' | 'top' | 'free';
export type WobbleStyle = 'game' | 'precession';

export interface MotionParams {
  layout: LayoutMode;
  motion: MotionMode;
  camera: CameraMode;
  /** Visual spin rate, rad/s (sign = direction). */
  spinRate: number;
  /** Static lean, rad. */
  tilt: number;
  /** Wobble energy 0..1 (the game's wobble amplitude scales with it). */
  wobble: number;
  wobbleStyle: WobbleStyle;
  /** Path speed, m/s. */
  speed: number;
  /** Simulation time multiplier (slow motion < 1). */
  timeScale: number;
  paused: boolean;
  blur: boolean;
}

interface Slot {
  readonly concept: ConceptDefinition;
  readonly built: BuiltConcept;
  /** Position + heading on the floor. */
  readonly body: THREE.Group;
  /** Lean (static tilt + turn lean) and wobble. */
  readonly attitude: THREE.Group;
  /** Rotation about the Bey's own up axis. */
  readonly spin: THREE.Group;
  /** Sub-frame copies for the blur option (share geometry, own transparent materials). */
  readonly ghosts: THREE.Group[];
  readonly ghostMaterials: THREE.Material[];
  /** Fixed grid position, or path phase offset. */
  readonly home: THREE.Vector2;
  readonly phase: number;
  spinAngle: number;
}

const FLOOR_RADIUS_M = 12;

export class MotionViewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(GAME_CAMERA_FOV_DEG, 1, 0.05, 200);
  readonly controls: OrbitControls;
  readonly params: MotionParams = {
    layout: 'solo',
    motion: 'orbit',
    camera: 'combat',
    spinRate: 22,
    tilt: 0,
    wobble: 0,
    wobbleStyle: 'game',
    speed: 6,
    timeScale: 1,
    paused: false,
    blur: false,
  };

  /** Rendering is suspended while the other lab section is shown. */
  active = true;

  private slots: Slot[] = [];
  private time = 0;
  private lastMs = performance.now();
  private spinDownT: number | null = null;
  private frames = 0;
  private readonly cameraTarget = new THREE.Vector3();
  /** Combat camera orbit yaw (the fight axis, smoothed) — null until first framed. */
  private orbitYaw: number | null = null;
  private readonly listeners: Array<() => void> = [];

  constructor(canvas: HTMLCanvasElement, private readonly stage: HTMLElement) {
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
    this.scene.fog = new THREE.Fog(0x0b0e14, 30, 70);

    this.buildStage();

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.minDistance = 1;
    this.controls.maxDistance = 60;
    this.controls.enabled = false;
    this.controls.addEventListener('start', () => {
      if (this.params.camera !== 'free') this.setParams({ camera: 'free' });
    });
    canvas.addEventListener('pointerdown', () => {
      if (this.params.camera !== 'free') this.setParams({ camera: 'free' });
    });

    new ResizeObserver(() => this.resize()).observe(stage);
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  onChange(listener: () => void): void {
    this.listeners.push(listener);
  }

  get frameCount(): number {
    return this.frames;
  }

  get beyCount(): number {
    return this.slots.length;
  }

  get isSpinningDown(): boolean {
    return this.spinDownT !== null;
  }

  /** The spin rate actually applied this frame (the spin-down ramps it to 0). */
  get effectiveSpinRate(): number {
    return this.params.spinRate * this.spinDownFactor();
  }

  get effectiveWobble(): number {
    if (this.spinDownT === null) return this.params.wobble;
    const k = 1 - this.spinDownFactor();
    return Math.min(SPIN_DOWN_MAX_WOBBLE, Math.max(this.params.wobble, GAME_ZERO_STAMINA_WOBBLE_FLOOR * k) + k * (SPIN_DOWN_MAX_WOBBLE - GAME_ZERO_STAMINA_WOBBLE_FLOOR));
  }

  setParams(patch: Partial<MotionParams>): void {
    const blurChanged = patch.blur !== undefined && patch.blur !== this.params.blur;
    Object.assign(this.params, patch);
    this.controls.enabled = this.params.camera === 'free';
    if (patch.camera === 'free') this.controls.target.copy(this.cameraTarget);
    if (blurChanged) for (const slot of this.slots) slot.ghosts.forEach((g) => (g.visible = this.params.blur));
    this.listeners.forEach((l) => l());
  }

  /** Replaces the Beys on stage. solo: [a]; duel: [a, b]; grid: all nine. */
  showConcepts(concepts: readonly ConceptDefinition[]): void {
    for (const slot of this.slots) {
      this.scene.remove(slot.body);
      slot.built.dispose();
      slot.ghostMaterials.forEach((m) => m.dispose());
    }
    this.slots = concepts.map((concept, index) => this.createSlot(concept, index, concepts.length));
    this.listeners.forEach((l) => l());
  }

  /** Spin-down demo: the spin ramps to 0 over SPIN_DOWN_SECONDS while wobble grows (a Bey running out of Stamina). */
  startSpinDown(): void {
    this.spinDownT = 0;
    this.listeners.forEach((l) => l());
  }

  resetSpinDown(): void {
    this.spinDownT = null;
    this.listeners.forEach((l) => l());
  }

  private spinDownFactor(): number {
    if (this.spinDownT === null) return 1;
    const t = Math.min(1, this.spinDownT / SPIN_DOWN_SECONDS);
    return 1 - t * t * (3 - 2 * t);
  }

  private createSlot(concept: ConceptDefinition, index: number, count: number): Slot {
    const built = assembleConcept(concept);
    built.root.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    const spin = new THREE.Group();
    spin.add(built.root);
    spin.scale.setScalar(BEY_SCALE);
    const attitude = new THREE.Group();
    attitude.add(spin);
    const body = new THREE.Group();
    body.add(attitude);
    this.scene.add(body);

    // Blur ghosts: extra copies of the model (shared geometry) with
    // transparent material clones, each drawn at a slightly earlier spin
    // angle within the current frame.
    const ghosts: THREE.Group[] = [];
    const ghostMaterials: THREE.Material[] = [];
    for (let g = 0; g < BLUR_GHOSTS; g++) {
      const ghost = built.root.clone(true);
      const opacity = 0.5 * (1 - g / BLUR_GHOSTS);
      ghost.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        const source = Array.isArray(o.material) ? o.material : [o.material];
        const clones = source.map((m: THREE.Material) => {
          const c = m.clone();
          c.transparent = true;
          c.opacity = opacity;
          c.depthWrite = false;
          ghostMaterials.push(c);
          return c;
        });
        o.material = Array.isArray(o.material) ? clones : clones[0]!;
        o.castShadow = false;
        o.receiveShadow = false;
      });
      const holder = new THREE.Group();
      holder.add(ghost);
      holder.scale.setScalar(BEY_SCALE);
      holder.visible = this.params.blur;
      attitude.add(holder);
      ghosts.push(holder);
    }

    let home = new THREE.Vector2(0, 0);
    if (count === 9) {
      const col = index % 3;
      const row = Math.floor(index / 3);
      home = new THREE.Vector2((col - 1) * GRID_SPACING_M, (row - 1) * GRID_SPACING_M);
    } else if (count === 2) {
      home = new THREE.Vector2(0, index === 0 ? 1.6 : -1.6);
    }
    // Duel: the second Bey trails the first on the same path.
    return { concept, built, body, attitude, spin, ghosts, ghostMaterials, home, phase: count === 2 ? -index * DUEL_PHASE_GAP_RAD : 0, spinAngle: index * 0.7 };
  }

  private buildStage(): void {
    const hemi = new THREE.HemisphereLight(0xcfd8ff, 0x20242c, 0.6);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(6, 14, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = 14;
    Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 40 });
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);

    // Neutral floor at the game's arena radius, with 1 m rings for scale.
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(FLOOR_RADIUS_M, 96).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x3a404b, roughness: 0.8, metalness: 0.05 }),
    );
    floor.receiveShadow = true;
    this.scene.add(floor);
    const lineMat = new THREE.LineBasicMaterial({ color: 0x566072, transparent: true, opacity: 0.55 });
    for (let r = 2; r <= FLOOR_RADIUS_M; r += 2) {
      const pts = Array.from({ length: 129 }, (_, i) => {
        const a = (i / 128) * Math.PI * 2;
        return new THREE.Vector3(Math.cos(a) * r, 0.005, Math.sin(a) * r);
      });
      this.scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat));
    }
    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(FLOOR_RADIUS_M, FLOOR_RADIUS_M, 1.2, 96, 1, true).translate(0, 0.6, 0),
      new THREE.MeshStandardMaterial({ color: 0x252a33, roughness: 0.7, side: THREE.BackSide }),
    );
    this.scene.add(wall);
  }

  /** Position (x, z), velocity and acceleration on the current path at time t for a slot. */
  private pathState(slot: Slot, t: number): { pos: THREE.Vector2; vel: THREE.Vector2; acc: THREE.Vector2 } {
    const { motion, speed } = this.params;
    if (motion === 'still' || speed <= 0 || this.params.layout === 'grid') {
      return { pos: slot.home.clone(), vel: new THREE.Vector2(), acc: new THREE.Vector2() };
    }
    const R = ORBIT_RADIUS_M;
    const w = speed / R;
    const a = w * t + slot.phase;
    if (motion === 'orbit') {
      return {
        pos: new THREE.Vector2(Math.cos(a) * R, Math.sin(a) * R),
        vel: new THREE.Vector2(-Math.sin(a) * R * w, Math.cos(a) * R * w),
        acc: new THREE.Vector2(-Math.cos(a) * R * w * w, -Math.sin(a) * R * w * w),
      };
    }
    // Figure-eight (lemniscate-like): x = R sin a, z = R sin a cos a — sharper turns at the ends.
    const x = R * Math.sin(a);
    const z = R * Math.sin(a) * Math.cos(a);
    const dx = R * Math.cos(a) * w;
    const dz = R * Math.cos(2 * a) * w;
    const ddx = -R * Math.sin(a) * w * w;
    const ddz = -2 * R * Math.sin(2 * a) * w * w;
    return { pos: new THREE.Vector2(x, z), vel: new THREE.Vector2(dx, dz), acc: new THREE.Vector2(ddx, ddz) };
  }

  private frame(): void {
    const now = performance.now();
    const realDt = Math.min(0.1, (now - this.lastMs) / 1000);
    this.lastMs = now;
    if (!this.active) return;
    const dt = this.params.paused ? 0 : realDt * this.params.timeScale;
    this.time += dt;
    if (this.spinDownT !== null) this.spinDownT += dt;

    const rate = this.effectiveSpinRate;
    const wobbleEnergy = this.effectiveWobble;
    const wobbleAngle = Math.sin(this.time * GAME_WOBBLE_FREQUENCY_HZ * Math.PI * 2) * GAME_WOBBLE_AMPLITUDE_RAD * wobbleEnergy;

    for (const slot of this.slots) {
      slot.spinAngle += rate * dt;
      const { pos, vel, acc } = this.pathState(slot, this.time);
      slot.body.position.set(pos.x, 0, pos.y);
      const speed = vel.length();
      const heading = speed > 1e-3 ? Math.atan2(vel.x, vel.y) : 0;
      slot.body.rotation.set(0, heading, 0);

      // Lean: static tilt toward the Bey's right plus a lean into the turn
      // (centripetal acceleration), clamped to the game's reference tilt.
      const right = new THREE.Vector2(Math.cos(heading), -Math.sin(heading));
      const turnLean = Math.max(-GAME_MAX_TILT_RAD, Math.min(GAME_MAX_TILT_RAD, acc.dot(right) * TURN_LEAN_PER_ACCEL));
      const lean = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -(this.params.tilt + turnLean));
      let wobble: THREE.Quaternion;
      if (this.params.wobbleStyle === 'game') {
        // Game: a rock about the Bey's local X axis (createMatchScene.ts).
        wobble = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), wobbleAngle);
      } else {
        // Alternative: precession — the lean axis circles at the wobble frequency.
        const phase = this.time * GAME_WOBBLE_FREQUENCY_HZ * Math.PI * 2;
        const axis = new THREE.Vector3(Math.cos(phase), 0, Math.sin(phase));
        wobble = new THREE.Quaternion().setFromAxisAngle(axis, GAME_WOBBLE_AMPLITUDE_RAD * wobbleEnergy);
      }
      slot.attitude.quaternion.copy(lean).multiply(wobble);
      slot.spin.rotation.y = slot.spinAngle;

      // Ghosts trail behind within one frame interval.
      if (this.params.blur) {
        const frameRotation = rate * (realDt > 0 ? realDt : 1 / 60) * this.params.timeScale;
        slot.ghosts.forEach((g, i) => {
          g.rotation.y = slot.spinAngle - (frameRotation * BLUR_SHUTTER * (i + 1)) / BLUR_GHOSTS;
        });
      }
    }

    this.updateCamera(realDt);
    if (this.params.camera === 'free') this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.frames++;
  }

  private focusPoint(): THREE.Vector3 {
    if (this.slots.length === 0) return new THREE.Vector3();
    const c = new THREE.Vector3();
    for (const s of this.slots) c.add(s.body.position);
    return c.multiplyScalar(1 / this.slots.length);
  }

  private updateCamera(dt: number): void {
    const mode = this.params.camera;
    if (mode === 'free') return;
    const focus = this.focusPoint();
    const k = 1 - Math.exp(-GAME_CAMERA_POSITION_SMOOTHING_PER_S * dt);
    let pos: THREE.Vector3;
    let fov = GAME_CAMERA_FOV_DEG;
    if (mode === 'combat') {
      // The game's combat camera (src/camera/CombatCameraController.ts):
      // HORIZONTAL distance 9 m (+0.6 m per meter of separation beyond 3 m,
      // clamped 7..16), 6 m above the focus, behind the player on the
      // player->opponent axis and 0.35 rad to one shoulder, the axis
      // smoothed into an orbit; at Dash speeds it pulls back and widens.
      // Solo and grid have no opponent: the axis points north (away from
      // the camera), so the view matches a player facing the far side.
      let separation = 0;
      let axisYaw = Math.PI;
      if (this.params.layout === 'duel' && this.slots.length === 2) {
        const a = this.slots[0]!.body.position;
        const b = this.slots[1]!.body.position;
        separation = Math.hypot(a.x - b.x, a.z - b.z);
        if (separation > 1e-3) axisYaw = Math.atan2(b.x - a.x, b.z - a.z);
      } else if (this.params.layout === 'grid') {
        separation = 2 * GRID_SPACING_M;
      }
      if (this.orbitYaw === null) this.orbitYaw = axisYaw;
      else {
        const t = 1 - Math.exp(-GAME_CAMERA_ORBIT_SMOOTHING_PER_S * dt);
        let d = axisYaw - this.orbitYaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        this.orbitYaw += d * t;
      }
      const speed = this.params.motion === 'still' || this.params.layout === 'grid' ? 0 : this.params.speed;
      const high = Math.max(0, Math.min(1, (speed - GAME_CAMERA_HIGH_SPEED_THRESHOLD_MPS) / (GAME_CAMERA_HIGH_SPEED_FULL_MPS - GAME_CAMERA_HIGH_SPEED_THRESHOLD_MPS)));
      const distance = Math.min(
        GAME_CAMERA_MAX_DISTANCE_M,
        Math.max(GAME_CAMERA_MIN_DISTANCE_M, GAME_CAMERA_DISTANCE_M + Math.max(0, separation - GAME_CAMERA_SEPARATION_REFERENCE_M) * GAME_CAMERA_SEPARATION_TO_DISTANCE + high * GAME_CAMERA_HIGH_SPEED_EXTRA_DISTANCE_M),
      );
      const yaw = this.orbitYaw + Math.PI + GAME_CAMERA_SHOULDER_OFFSET_RAD;
      pos = new THREE.Vector3(focus.x + Math.sin(yaw) * distance, focus.y + GAME_CAMERA_HEIGHT_M + high * GAME_CAMERA_HIGH_SPEED_EXTRA_HEIGHT_M, focus.z + Math.cos(yaw) * distance);
      fov += high * GAME_CAMERA_HIGH_SPEED_EXTRA_FOV_DEG;
    } else if (mode === 'close') {
      pos = new THREE.Vector3(focus.x + 1.6, 1.3, focus.z + 2.4);
    } else {
      pos = new THREE.Vector3(focus.x, this.params.layout === 'grid' ? 11 : 7, focus.z + 0.01);
    }
    this.camera.fov += (fov - this.camera.fov) * k;
    this.camera.position.lerp(pos, k);
    this.cameraTarget.lerp(focus, k);
    this.camera.lookAt(this.cameraTarget);
    this.camera.updateProjectionMatrix();
  }

  /** Snap the camera to its target (no easing) — used after layout switches. */
  snapCamera(): void {
    this.orbitYaw = null;
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
