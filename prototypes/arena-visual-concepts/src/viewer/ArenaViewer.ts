// ============================================================
// ARENA VISUAL CONCEPTS — VIEWER
// Shows one arena concept at a time with two round-2 Bey concepts moving
// inside it. The Bey motion is a scripted presentation loop (circling the
// bowl, leaning with the slope), NOT the game's physics.
// ============================================================

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { assembleConcept, type BuiltConcept } from '../../../bey-visual-concepts/src/model/assembleConcept';
import type { ConceptDefinition } from '../../../bey-visual-concepts/src/model/types';
import type { ArenaConcept, BuiltArena } from '../arenas/types';

// ---------------- VIEWER TUNING ----------------
const BEY_SCALE = 0.24;                 // Prototype Bey units -> meters (≈ game Bey size, ~1.3 m wide).
const BEY_SPIN_RAD_PER_SEC = 16;        // Visual spin of the Beys in the demo loop.
const SLOPE_LEAN = 0.8;                 // How much the Beys lean with the bowl slope (0..1).
const AUTO_IMPACT_EVERY_SEC = 4.5;      // Demo wall impact interval while motion is on.
const CLASH_EASE_SEC = 0.6;             // Time to blend in/out of Clash lighting.
const SPARK_POOL = 500;
const OVERVIEW = { radius: 36, elevationDeg: 36, azimuthDeg: 28, fov: 38 };
const TOP = { height: 40, fov: 38 };
const GAMEPLAY = { back: 6.5, up: 3.0, fov: 62 };  // Opponent-focused chase framing (GDD section 48).
// ------------------------------------------------

/** Soft round sprite so sparks read as glowing points, not squares. */
function sparkSprite(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const g = canvas.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.8)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

export type CameraMode = 'overview' | 'gameplay' | 'top' | 'free';

interface Spark { pos: THREE.Vector3; vel: THREE.Vector3; life: number; maxLife: number; hot: THREE.Color; cool: THREE.Color }

interface BeySlot { built: BuiltConcept; holder: THREE.Group; spin: THREE.Group; pos: THREE.Vector3; prev: THREE.Vector3 }

export class ArenaViewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(OVERVIEW.fov, 1, 0.1, 400);
  readonly controls: OrbitControls;

  private arena: BuiltArena | null = null;
  private beys: [BeySlot | null, BeySlot | null] = [null, null];
  private mode: CameraMode = 'overview';
  private motion = true;
  private clashTarget = 0;
  private clash = 0;
  private time = 0;
  private motionTime = 0;
  private nextImpact = 2;
  private lastMs = performance.now();
  private readonly modeListeners: Array<(m: CameraMode) => void> = [];

  private readonly sparks: Spark[] = [];
  private readonly sparkGeo = new THREE.BufferGeometry();
  private readonly sparkPoints: THREE.Points;

  constructor(canvas: HTMLCanvasElement, private readonly stage: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.minDistance = 3;
    this.controls.maxDistance = 70;
    this.controls.addEventListener('start', () => this.setMode('free'));

    this.sparkGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(SPARK_POOL * 3), 3));
    this.sparkGeo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(SPARK_POOL * 3), 3));
    this.sparkPoints = new THREE.Points(this.sparkGeo, new THREE.PointsMaterial({
      size: 0.11, vertexColors: true, map: sparkSprite(), alphaTest: 0.01, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }));
    this.sparkPoints.frustumCulled = false;
    this.scene.add(this.sparkPoints);

    new ResizeObserver(() => this.resize()).observe(stage);
    this.resize();
    this.applyPreset(true);
    this.renderer.setAnimationLoop(() => this.frame());
  }

  onModeChange(l: (m: CameraMode) => void): void { this.modeListeners.push(l); }
  get cameraMode(): CameraMode { return this.mode; }
  get isMotion(): boolean { return this.motion; }
  get isClash(): boolean { return this.clashTarget > 0; }

  showArena(concept: ArenaConcept, depth = concept.defaultDepth): void {
    if (this.arena) {
      this.scene.remove(this.arena.root);
      this.arena.dispose();
    }
    this.arena = concept.build(depth);
    this.scene.add(this.arena.root);
    this.scene.fog = this.arena.fog;
    this.scene.environmentIntensity = this.arena.environmentIntensity;
    this.renderer.toneMappingExposure = this.arena.exposure;
    this.sparks.length = 0;
    this.placeBeys(0);
  }

  setBey(index: 0 | 1, def: ConceptDefinition): void {
    const old = this.beys[index];
    if (old) {
      this.scene.remove(old.holder);
      old.built.dispose();
    }
    const built = assembleConcept(def);
    built.root.traverse((o) => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } });
    const spin = new THREE.Group();
    spin.add(built.root);
    spin.scale.setScalar(BEY_SCALE);
    const holder = new THREE.Group();
    holder.add(spin);
    this.scene.add(holder);
    this.beys[index] = { built, holder, spin, pos: new THREE.Vector3(), prev: new THREE.Vector3() };
    this.placeBeys(0);
  }

  setMode(mode: CameraMode): void {
    if (this.mode !== mode) {
      this.mode = mode;
      this.modeListeners.forEach((l) => l(mode));
    }
    if (mode !== 'free') this.applyPreset(false);
  }

  setMotion(on: boolean): void { this.motion = on; }
  setClash(on: boolean): void { this.clashTarget = on ? 1 : 0; }

  /** Spark burst + light flash where the first Bey would hit the wall. */
  triggerImpact(): void {
    if (!this.arena) return;
    const a = this.beys[0]?.pos ?? new THREE.Vector3(1, 0, 0);
    const dir = new THREE.Vector3(a.x, 0, a.z);
    if (dir.lengthSq() < 1e-4) dir.set(1, 0, 0);
    dir.normalize();
    const R = this.arena.wallRadius;
    const p = dir.clone().multiplyScalar(R - 0.1);
    p.y = this.arena.floorHeightAt(R) + 0.35;
    this.burst(p, dir.clone().negate(), 70, 7);
    this.arena.flash(p);
  }

  // ---------------- internals ----------------

  private applyPreset(snap: boolean): void {
    const target = new THREE.Vector3(0, 0.6, 0);
    let pos: THREE.Vector3;
    let fov: number;
    if (this.mode === 'top') {
      pos = new THREE.Vector3(0, TOP.height, 0.01);
      fov = TOP.fov;
    } else {
      const el = THREE.MathUtils.degToRad(OVERVIEW.elevationDeg);
      const az = THREE.MathUtils.degToRad(OVERVIEW.azimuthDeg);
      pos = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(OVERVIEW.radius);
      fov = this.mode === 'gameplay' ? GAMEPLAY.fov : OVERVIEW.fov;
    }
    this.presetPos = pos;
    this.presetTarget = target;
    this.presetFov = fov;
    if (snap) {
      this.camera.position.copy(pos);
      this.controls.target.copy(target);
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }
  private presetPos = new THREE.Vector3();
  private presetTarget = new THREE.Vector3();
  private presetFov = OVERVIEW.fov;

  private placeBeys(dt: number): void {
    if (!this.arena) return;
    const t = this.motionTime;
    const R = this.arena.wallRadius;
    const paths = [
      { r: 6.5 + 2.6 * Math.sin(t * 0.35), a: t * 0.55 },
      { r: 5.2 + 3.6 * Math.sin(t * 0.27 + 1.3), a: -t * 0.42 + Math.PI },
    ];
    this.beys.forEach((slot, i) => {
      if (!slot) return;
      const p = paths[i]!;
      let x = Math.cos(p.a) * Math.min(p.r, R - 1.2);
      let z = Math.sin(p.a) * Math.min(p.r, R - 1.2);
      // Clash: both Beys converge to the center, pressed together.
      const cx = i === 0 ? -0.65 : 0.65;
      x = THREE.MathUtils.lerp(x, cx, this.clash);
      z = THREE.MathUtils.lerp(z, 0, this.clash);
      const r = Math.hypot(x, z);
      const y = this.arena!.floorHeightAt(r);
      slot.prev.copy(slot.pos);
      slot.pos.set(x, y, z);
      slot.holder.position.copy(slot.pos);
      const eps = 0.05;
      const slope = (this.arena!.floorHeightAt(r + eps) - this.arena!.floorHeightAt(Math.max(0, r - eps))) / (2 * eps);
      const n = r > 1e-3 ? new THREE.Vector3((-slope * x) / r, 1, (-slope * z) / r).normalize() : new THREE.Vector3(0, 1, 0);
      const up = new THREE.Vector3(0, 1, 0).lerp(n, SLOPE_LEAN).normalize();
      slot.holder.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
      slot.spin.rotation.y += BEY_SPIN_RAD_PER_SEC * dt;
    });
  }

  private burst(at: THREE.Vector3, normal: THREE.Vector3, count: number, speed: number): void {
    if (!this.arena) return;
    const hot = new THREE.Color(this.arena.sparkColors[0]);
    const cool = new THREE.Color(this.arena.sparkColors[1]);
    for (let i = 0; i < count; i++) {
      if (this.sparks.length >= SPARK_POOL) this.sparks.shift();
      const v = normal.clone().multiplyScalar(0.6 + Math.random())
        .add(new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9 + 0.2, Math.random() - 0.5).multiplyScalar(1.3))
        .normalize().multiplyScalar(speed * (0.35 + Math.random() * 0.8));
      const life = 0.25 + Math.random() * 0.55;
      this.sparks.push({ pos: at.clone(), vel: v, life, maxLife: life, hot, cool });
    }
  }

  private updateSparks(dt: number): void {
    const pos = this.sparkGeo.getAttribute('position') as THREE.BufferAttribute;
    const col = this.sparkGeo.getAttribute('color') as THREE.BufferAttribute;
    const c = new THREE.Color();
    let n = 0;
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i]!;
      s.life -= dt;
      if (s.life <= 0) { this.sparks.splice(i, 1); continue; }
      s.vel.y -= 9.8 * dt;
      s.pos.addScaledVector(s.vel, dt);
      const k = s.life / s.maxLife;
      c.copy(s.cool).lerp(s.hot, k).multiplyScalar(k * 1.5);
      pos.setXYZ(n, s.pos.x, s.pos.y, s.pos.z);
      col.setXYZ(n, c.r, c.g, c.b);
      n++;
    }
    this.sparkGeo.setDrawRange(0, n);
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }

  private frame(): void {
    const now = performance.now();
    const dt = Math.min((now - this.lastMs) / 1000, 0.1);
    this.lastMs = now;
    this.time += dt;
    if (this.motion || this.clashTarget > 0) this.motionTime += dt;
    this.clash += Math.sign(this.clashTarget - this.clash) * Math.min(Math.abs(this.clashTarget - this.clash), dt / CLASH_EASE_SEC);

    this.placeBeys(this.motion || this.clash > 0 ? dt : dt * 0.3);
    if (this.arena) {
      this.arena.update({ time: this.time, dt, clash: this.clash });
      if (this.motion && this.clashTarget === 0) {
        this.nextImpact -= dt;
        if (this.nextImpact <= 0) {
          this.nextImpact = AUTO_IMPACT_EVERY_SEC;
          this.triggerImpact();
        }
      }
      // Continuous contact sparks between the Beys during Clash.
      if (this.clash > 0.8 && this.beys[0] && this.beys[1] && Math.random() < 0.8) {
        const mid = this.beys[0].pos.clone().add(this.beys[1].pos).multiplyScalar(0.5).setY(this.beys[0].pos.y + 0.35);
        this.burst(mid, new THREE.Vector3(0, 0.4, Math.random() < 0.5 ? 1 : -1), 6, 5);
      }
    }
    this.updateSparks(dt);
    this.updateCamera(dt);
    this.renderer.render(this.scene, this.camera);
  }

  private updateCamera(dt: number): void {
    const k = 1 - Math.exp(-dt * 4);
    if (this.mode === 'gameplay' && this.beys[0] && this.beys[1]) {
      const a = this.beys[0].pos;
      const b = this.beys[1].pos;
      const dir = b.clone().sub(a).setY(0);
      if (dir.lengthSq() < 1e-3) dir.set(0, 0, -1);
      dir.normalize();
      const pos = a.clone().addScaledVector(dir, -GAMEPLAY.back).add(new THREE.Vector3(0, GAMEPLAY.up, 0));
      const look = a.clone().lerp(b, 0.6).add(new THREE.Vector3(0, 0.4, 0));
      this.camera.position.lerp(pos, k);
      this.controls.target.lerp(look, k);
      this.camera.lookAt(this.controls.target);
      this.camera.fov += (GAMEPLAY.fov - this.camera.fov) * k;
      this.camera.updateProjectionMatrix();
      return;
    }
    if (this.mode === 'overview' || this.mode === 'top') {
      this.camera.position.lerp(this.presetPos, k);
      this.controls.target.lerp(this.presetTarget, k);
      this.camera.fov += (this.presetFov - this.camera.fov) * k;
      this.camera.updateProjectionMatrix();
      this.camera.lookAt(this.controls.target);
      return;
    }
    this.controls.update();
  }

  private resize(): void {
    const w = Math.max(1, this.stage.clientWidth);
    const h = Math.max(1, this.stage.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}
