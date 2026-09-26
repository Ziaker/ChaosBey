// ============================================================
// VFX LAB — EFFECT RUNTIME
// FxLayer: short-lived effect objects with a per-frame update callback.
// StreakSparks: pooled line-segment sparks with gravity and floor bounce.
// ============================================================

import * as THREE from 'three';

export interface FxItem {
  readonly object: THREE.Object3D;
  /** Seconds. */
  readonly life: number;
  /** Face the camera every frame (sprites/planes). */
  readonly billboard?: boolean;
  /** Cylindrical billboard: keep local +X on this axis and turn the plane toward the camera. */
  readonly axisBillboard?: THREE.Vector3;
  /** k = age / life in [0, 1]. */
  update(k: number, dt: number, item: LiveFxItem): void;
}

export interface LiveFxItem extends FxItem {
  age: number;
}

export class FxLayer {
  private readonly items: LiveFxItem[] = [];

  constructor(private readonly scene: THREE.Scene, private readonly camera: THREE.Camera) {}

  add(item: FxItem): void {
    const live = Object.assign(item, { age: 0 }) as LiveFxItem;
    this.scene.add(item.object);
    this.items.push(live);
    live.update(0, 0, live);
  }

  tick(dt: number): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i]!;
      it.age += dt;
      const k = Math.min(1, it.age / it.life);
      if (it.billboard) it.object.quaternion.copy(this.camera.quaternion);
      if (it.axisBillboard) axisFaceCamera(it.object, it.axisBillboard, this.camera);
      it.update(k, dt, it);
      if (it.age >= it.life) {
        this.scene.remove(it.object);
        disposeObject(it.object);
        this.items.splice(i, 1);
      }
    }
  }

  clear(): void {
    for (const it of this.items) {
      this.scene.remove(it.object);
      disposeObject(it.object);
    }
    this.items.length = 0;
  }
}

const _toCam = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _m = new THREE.Matrix4();
/** Rotate `o` so its local +X lies on `axis` and its plane (local XY) faces the camera. */
function axisFaceCamera(o: THREE.Object3D, axis: THREE.Vector3, camera: THREE.Camera): void {
  const x = axis;
  _toCam.copy(camera.position).sub(o.position);
  _z.copy(_toCam).addScaledVector(x, -_toCam.dot(x));
  if (_z.lengthSq() < 1e-6) return;
  _z.normalize();
  _y.crossVectors(_z, x).normalize();
  _m.makeBasis(x, _y, _z);
  o.quaternion.setFromRotationMatrix(_m);
}

/** Disposes geometries/materials created for an effect (textures are shared and kept). */
export function disposeObject(o: THREE.Object3D): void {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.userData.sharedGeometry !== true) m.geometry?.dispose();
    const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
    mats.forEach((mat) => { if (mat.userData.shared !== true) mat.dispose(); });
  });
}

interface Spark { p: THREE.Vector3; v: THREE.Vector3; life: number; max: number; hot: THREE.Color; cool: THREE.Color; stretch: number }

export interface SparkOptions {
  count: number;
  speed: number;
  /** Base emission direction (normalized); sparks spread around it. */
  dir: THREE.Vector3;
  spread: number;
  life: [number, number];
  hot: number;
  cool: number;
  /** Streak length factor (seconds of velocity drawn as the tail). */
  stretch?: number;
  upBias?: number;
}

export class StreakSparks {
  readonly object: THREE.LineSegments;
  private readonly sparks: Spark[] = [];
  private readonly pos: THREE.BufferAttribute;
  private readonly col: THREE.BufferAttribute;

  constructor(private readonly max: number, private readonly floorHeightAt: (r: number) => number, private readonly gravity = 9.8, private readonly bounce = 0.35) {
    const g = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(max * 6), 3);
    this.col = new THREE.BufferAttribute(new Float32Array(max * 6), 3);
    g.setAttribute('position', this.pos);
    g.setAttribute('color', this.col);
    this.object = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.object.frustumCulled = false;
  }

  emit(at: THREE.Vector3, o: SparkOptions): void {
    const hot = new THREE.Color(o.hot);
    const cool = new THREE.Color(o.cool);
    for (let i = 0; i < o.count; i++) {
      if (this.sparks.length >= this.max) this.sparks.shift();
      const v = o.dir.clone()
        .add(new THREE.Vector3(Math.random() - 0.5, (Math.random() - 0.5) + (o.upBias ?? 0.4), Math.random() - 0.5).multiplyScalar(o.spread))
        .normalize()
        .multiplyScalar(o.speed * (0.35 + Math.random() * 0.9));
      const life = o.life[0] + Math.random() * (o.life[1] - o.life[0]);
      this.sparks.push({ p: at.clone(), v, life, max: life, hot, cool, stretch: o.stretch ?? 0.035 });
    }
  }

  tick(dt: number): void {
    const c = new THREE.Color();
    let n = 0;
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i]!;
      s.life -= dt;
      if (s.life <= 0) { this.sparks.splice(i, 1); continue; }
      s.v.y -= this.gravity * dt;
      s.p.addScaledVector(s.v, dt);
      const floor = this.floorHeightAt(Math.hypot(s.p.x, s.p.z));
      if (s.p.y < floor) {
        s.p.y = floor;
        s.v.y = Math.abs(s.v.y) * this.bounce;
        s.v.x *= 0.6;
        s.v.z *= 0.6;
      }
      const k = s.life / s.max;
      c.copy(s.cool).lerp(s.hot, k).multiplyScalar(0.4 + k);
      this.pos.setXYZ(n * 2, s.p.x, s.p.y, s.p.z);
      this.pos.setXYZ(n * 2 + 1, s.p.x - s.v.x * s.stretch, s.p.y - s.v.y * s.stretch, s.p.z - s.v.z * s.stretch);
      this.col.setXYZ(n * 2, c.r, c.g, c.b);
      this.col.setXYZ(n * 2 + 1, c.r * 0.2, c.g * 0.2, c.b * 0.2);
      n++;
    }
    this.object.geometry.setDrawRange(0, n * 2);
    this.pos.needsUpdate = true;
    this.col.needsUpdate = true;
  }

  clear(): void {
    this.sparks.length = 0;
    this.object.geometry.setDrawRange(0, 0);
  }
}
