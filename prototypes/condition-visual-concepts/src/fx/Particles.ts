// ============================================================
// STAMINA & STABILITY LAB — POOLED PARTICLES
// One THREE.Points buffer per blend mode per world, updated on the CPU.
// Sparks/glow use additive blending; smoke, dust and chips use normal
// blending. Fixed capacity: when full, the oldest slot is reused, so a
// burst can never allocate (GDD 119).
// ============================================================

import * as THREE from 'three';

export interface ParticleSpawn {
  x: number;
  y: number;
  z: number;
  vx?: number;
  vy?: number;
  vz?: number;
  /** Seconds. */
  life: number;
  /** World-space size at spawn (m). */
  size: number;
  /** World-space size at death (m). Defaults to `size`. */
  sizeEnd?: number;
  color: THREE.ColorRepresentation;
  /** Peak alpha (0–1). */
  alpha?: number;
  /** Downward acceleration (m/s²). */
  gravity?: number;
  /** Velocity kept per second (0–1); 1 = no drag. */
  drag?: number;
  /** Floor height function: particles bounce once off it when given. */
  floor?: (x: number, z: number) => number;
}

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
    gl_PointSize = aSize * uScale / max(0.05, -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  uniform float uHard;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    float a = mix(pow(1.0 - d, 1.8), smoothstep(1.0, 0.35, d), uHard);
    gl_FragColor = vec4(vColor * (1.0 + uHard * (1.0 - d) * 0.8), a * vAlpha);
  }
`;

export class Particles {
  readonly points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly col: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly size0: Float32Array;
  private readonly size1: Float32Array;
  private readonly alpha0: Float32Array;
  private readonly gravity: Float32Array;
  private readonly drag: Float32Array;
  private readonly floors: Array<((x: number, z: number) => number) | undefined>;
  private next = 0;
  private readonly c = new THREE.Color();

  constructor(private readonly capacity: number, additive: boolean) {
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.size0 = new Float32Array(capacity);
    this.size1 = new Float32Array(capacity);
    this.alpha0 = new Float32Array(capacity);
    this.gravity = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.floors = new Array(capacity);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uScale: { value: 600 }, uHard: { value: additive ? 1 : 0 } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 5 : 4;
  }

  /** Pixels per meter at distance 1 — set from the viewport each frame. */
  setScale(pxPerMeterAtUnitDistance: number): void {
    this.points.material.uniforms.uScale!.value = pxPerMeterAtUnitDistance;
  }

  spawn(p: ParticleSpawn): void {
    const i = this.next;
    this.next = (this.next + 1) % this.capacity;
    const i3 = i * 3;
    this.pos[i3] = p.x;
    this.pos[i3 + 1] = p.y;
    this.pos[i3 + 2] = p.z;
    this.vel[i3] = p.vx ?? 0;
    this.vel[i3 + 1] = p.vy ?? 0;
    this.vel[i3 + 2] = p.vz ?? 0;
    this.c.set(p.color);
    this.col[i3] = this.c.r;
    this.col[i3 + 1] = this.c.g;
    this.col[i3 + 2] = this.c.b;
    this.life[i] = p.life;
    this.maxLife[i] = p.life;
    this.size0[i] = p.size;
    this.size1[i] = p.sizeEnd ?? p.size;
    this.alpha0[i] = p.alpha ?? 1;
    this.gravity[i] = p.gravity ?? 0;
    this.drag[i] = p.drag ?? 1;
    this.floors[i] = p.floor;
  }

  update(dt: number): void {
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i]! <= 0) {
        this.alpha[i] = 0;
        this.size[i] = 0;
        continue;
      }
      this.life[i] = this.life[i]! - dt;
      const i3 = i * 3;
      const k = Math.pow(this.drag[i]!, dt);
      this.vel[i3] = this.vel[i3]! * k;
      this.vel[i3 + 1] = this.vel[i3 + 1]! * k - this.gravity[i]! * dt;
      this.vel[i3 + 2] = this.vel[i3 + 2]! * k;
      this.pos[i3] = this.pos[i3]! + this.vel[i3]! * dt;
      this.pos[i3 + 1] = this.pos[i3 + 1]! + this.vel[i3 + 1]! * dt;
      this.pos[i3 + 2] = this.pos[i3 + 2]! + this.vel[i3 + 2]! * dt;
      const floor = this.floors[i];
      if (floor) {
        const fy = floor(this.pos[i3]!, this.pos[i3 + 2]!) + 0.01;
        if (this.pos[i3 + 1]! < fy && this.vel[i3 + 1]! < 0) {
          this.pos[i3 + 1] = fy;
          this.vel[i3 + 1] = -this.vel[i3 + 1]! * 0.35;
          this.vel[i3] = this.vel[i3]! * 0.6;
          this.vel[i3 + 2] = this.vel[i3 + 2]! * 0.6;
        }
      }
      const t = 1 - Math.max(0, this.life[i]!) / this.maxLife[i]!;
      this.size[i] = this.size0[i]! + (this.size1[i]! - this.size0[i]!) * t;
      this.alpha[i] = this.alpha0[i]! * (1 - t) * Math.min(1, t * 12 + 0.2);
    }
    const g = this.points.geometry;
    g.attributes.position!.needsUpdate = true;
    g.attributes.aColor!.needsUpdate = true;
    g.attributes.aSize!.needsUpdate = true;
    g.attributes.aAlpha!.needsUpdate = true;
  }

  clear(): void {
    this.life.fill(0);
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}
