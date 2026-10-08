// ============================================================
// BEY FLOW FX LAB — POINT POOL
// A pooled set of soft round particles (one draw call): the tip dust and
// the scrape sparks. Each particle has a position, velocity, size, life and
// colour; size is in world metres and shrinks/fades over its life.
// ============================================================

import * as THREE from 'three';

// ---------------- TUNING ----------------
const GRAVITY_MPS2 = 3.5;
const DRAG_PER_S = 2.2;
// -----------------------------------------

const VERT = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  uniform float uScale;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vAlpha = aAlpha;
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / max(0.1, -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = smoothstep(1.0, 0.2, d) * vAlpha;
    if (a < 0.003) discard;
    gl_FragColor = vec4(vColor, a);
  }
`;

export class PointPool {
  readonly points: THREE.Points;
  private readonly capacity: number;
  private readonly pos: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private readonly color: Float32Array;
  private readonly vel: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly base: Float32Array; // base size, base alpha
  private readonly material: THREE.ShaderMaterial;
  private readonly geometry = new THREE.BufferGeometry();
  private cursor = 0;

  constructor(capacity: number, additive: boolean) {
    this.capacity = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.color = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.age = new Float32Array(capacity).fill(Infinity);
    this.life = new Float32Array(capacity).fill(1);
    this.base = new Float32Array(capacity * 2);
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    this.geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    this.geometry.setAttribute('aColor', new THREE.BufferAttribute(this.color, 3));
    this.material = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 500 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
  }

  /** Call when the viewport or FOV changes: converts world metres to pixels. */
  setViewport(heightPx: number, fovDeg: number): void {
    this.material.uniforms.uScale!.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  get liveCount(): number {
    let n = 0;
    for (let i = 0; i < this.capacity; i++) if (this.age[i]! < this.life[i]!) n++;
    return n;
  }

  emit(p: THREE.Vector3, v: THREE.Vector3, sizeM: number, lifeS: number, color: THREE.Color, alpha: number): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    this.pos[i * 3] = p.x;
    this.pos[i * 3 + 1] = p.y;
    this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x;
    this.vel[i * 3 + 1] = v.y;
    this.vel[i * 3 + 2] = v.z;
    this.color[i * 3] = color.r;
    this.color[i * 3 + 1] = color.g;
    this.color[i * 3 + 2] = color.b;
    this.base[i * 2] = sizeM;
    this.base[i * 2 + 1] = alpha;
    this.age[i] = 0;
    this.life[i] = lifeS;
  }

  update(dt: number): void {
    const drag = Math.max(0, 1 - DRAG_PER_S * dt);
    for (let i = 0; i < this.capacity; i++) {
      const age = this.age[i]! + dt;
      this.age[i] = age;
      const life = this.life[i]!;
      if (age >= life) {
        this.alpha[i] = 0;
        this.size[i] = 0;
        continue;
      }
      const k = age / life;
      this.vel[i * 3] = this.vel[i * 3]! * drag;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1]! * drag - GRAVITY_MPS2 * dt;
      this.vel[i * 3 + 2] = this.vel[i * 3 + 2]! * drag;
      this.pos[i * 3] = this.pos[i * 3]! + this.vel[i * 3]! * dt;
      this.pos[i * 3 + 1] = this.pos[i * 3 + 1]! + this.vel[i * 3 + 1]! * dt;
      this.pos[i * 3 + 2] = this.pos[i * 3 + 2]! + this.vel[i * 3 + 2]! * dt;
      this.size[i] = this.base[i * 2]! * (0.6 + 0.9 * k);
      this.alpha[i] = this.base[i * 2 + 1]! * (1 - k) * (1 - k);
    }
    (this.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
