// Ported from prototypes/clash-presentation-concepts/src/fx/ClashFx.ts (Clash Presentation Lab, PR #24 branch claude/clash-presentation-lab, direction C Overdrive approved 2026-09-27;
// docs/design-decisions/clash-presentation-approval.md). Presentation only: VFX observes the Clash, it never decides an outcome (GDD 158).
// ============================================================
// CLASH PRESENTATION LAB — VFX PRIMITIVES
// Self-contained Three.js building blocks for the Clash-specific visuals
// this lab explores (dust and grit scraped off the floor at the contact,
// mash pulses, the resolution burst). Styled in the spirit of the approved
// Híbrida VFX language (prototypes/vfx-visual-concepts) — additive glow,
// cel-flavored rings, sparks that respect the arena's own spark palette —
// but built fresh for a moment (the Clash) that Híbrida itself never
// covered (see visual-prototype-inventory.md: "Clash completo... NÃO
// PROTOTIPADO"). Every shape here is plain, cheap and easy to reskin per
// direction; the three directions differ by which knobs they turn, not by
// three separate rendering engines.
// ============================================================

import * as THREE from 'three';
import { createFxRng } from './rng';

function softDisc(): THREE.CanvasTexture {
  // No DOM (unit tests under Node): an undrawn stand-in of the same type. Not in the lab.
  if (typeof document === 'undefined') return new THREE.CanvasTexture({ width: 1, height: 1 } as unknown as HTMLCanvasElement);
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.85)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

interface LifetimeObject {
  object: THREE.Object3D;
  ageS: number;
  lifeS: number;
  update(ageFrac: number, dt: number): void;
}

/**
 * Owns every transient Clash visual (contact dust, pulses, bursts, sparks) inside
 * one Group, so a direction switch or a scenario restart can clear
 * everything with one call. Nothing here decides Clash outcomes — it only
 * reacts to what ClashStageSim/ClashHarness already computed (GDD 158:
 * VFX observes, it never decides).
 */
export class ClashFx {
  readonly group = new THREE.Group();
  private readonly sprite = softDisc();
  private readonly transient: LifetimeObject[] = [];
  /** Dust scraped off the floor at the contact (normal blending, reads as matter) and hot grit (additive). Fixed pools, no per-frame allocation. */
  private readonly dust = new ParticlePool(900, THREE.NormalBlending, 0.55, -1.2, 2.2);
  private readonly grit = new ParticlePool(500, THREE.AdditiveBlending, 1, -9.8, 0.6);
  private dustCarry = 0;

  constructor() {
    this.group.add(this.dust.points, this.grit.points);
  }
  /** Seeded scatter for sparks; reseeded on clear() so a restarted scenario replays the same bursts. */
  private random = createFxRng();

  /**
   * Continuous contact dust while the Beys grind against each other: spawned on the floor at the
   * contact point and thrown out mostly SIDEWAYS (perpendicular to the push axis, both ways —
   * both Beys are spinning against each other), low and fast, with a share of hot grit sparks.
   * Call every tick with the particles/second rate for this moment.
   */
  emitContactDust(contact: THREE.Vector3, axisXZ: THREE.Vector2, dt: number, opts: { perSecond: number; size: number; speed: number; sparkShare: number; dustColor: THREE.Color; sparkColor: THREE.Color }): void {
    this.dustCarry += opts.perSecond * dt;
    const n = Math.floor(this.dustCarry);
    this.dustCarry -= n;
    for (let i = 0; i < n; i++) this.emitOne(contact, axisXZ, opts, 1);
  }

  /** One-shot dust + grit burst at the contact (resolution, knockdown tie). */
  dustBurst(contact: THREE.Vector3, axisXZ: THREE.Vector2, count: number, opts: { size: number; speed: number; sparkShare: number; dustColor: THREE.Color; sparkColor: THREE.Color }): void {
    for (let i = 0; i < count; i++) this.emitOne(contact, axisXZ, opts, 1.8);
  }

  private emitOne(contact: THREE.Vector3, axisXZ: THREE.Vector2, opts: { size: number; speed: number; sparkShare: number; dustColor: THREE.Color; sparkColor: THREE.Color }, boost: number): void {
    const rnd = this.random;
    const side = rnd() < 0.5 ? -1 : 1;
    const perpX = -axisXZ.y * side;
    const perpZ = axisXZ.x * side;
    const spread = (rnd() - 0.5) * 0.9; // a little along the axis too
    const speed = opts.speed * boost * (0.45 + rnd() * 0.9);
    const vx = (perpX + axisXZ.x * spread) * speed;
    const vz = (perpZ + axisXZ.y * spread) * speed;
    const px = contact.x + (rnd() - 0.5) * 0.25;
    const pz = contact.z + (rnd() - 0.5) * 0.25;
    if (rnd() < opts.sparkShare) {
      this.grit.spawn(px, contact.y + 0.05, pz, vx * 1.4, 0.6 + rnd() * 1.6, vz * 1.4, 0.05 + rnd() * 0.05, 0.25 + rnd() * 0.25, opts.sparkColor);
    } else {
      this.dust.spawn(px, contact.y + 0.03, pz, vx, 0.15 + rnd() * 0.7, vz, opts.size * (0.6 + rnd() * 0.9), 0.5 + rnd() * 0.6, opts.dustColor);
    }
  }

  /** Live particle counts (debug/tests). */
  get particleCounts(): { dust: number; grit: number } {
    return { dust: this.dust.alive, grit: this.grit.alive };
  }

  /** A short-lived ring pulse at a mash event, sized by how much that event mattered to the running total (0..1). */
  mashPulse(at: THREE.Vector3, color: THREE.Color, size: number, lifeS: number): void {
    const geo = new THREE.RingGeometry(0.4, 0.55, 24);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(at);
    mesh.rotation.x = -Math.PI / 2;
    this.group.add(mesh);
    this.transient.push({
      object: mesh,
      ageS: 0,
      lifeS,
      update: (f) => {
        const s = size * (0.6 + f * 1.6);
        mesh.scale.setScalar(s);
        mat.opacity = 0.9 * (1 - f);
      },
    });
    this.spawnSparks(at, color, Math.round(4 + size * 6), 2 + size * 3);
  }

  /** A pool of small additive sparks — used for the mechanical-leaning contact texture and for resolution debris. */
  spawnSparks(at: THREE.Vector3, color: THREE.Color, count: number, speed: number): void {
    const positions = new Float32Array(count * 3);
    const velocities: THREE.Vector3[] = [];
    for (let i = 0; i < count; i++) {
      positions[i * 3] = at.x;
      positions[i * 3 + 1] = at.y;
      positions[i * 3 + 2] = at.z;
      velocities.push(new THREE.Vector3(this.random() - 0.5, this.random() * 0.6 + 0.1, this.random() - 0.5).normalize().multiplyScalar(speed * (0.4 + this.random() * 0.8)));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({ color, size: 0.12, map: this.sprite, transparent: true, alphaTest: 0.01, blending: THREE.AdditiveBlending, depthWrite: false });
    const points = new THREE.Points(geo, mat);
    this.group.add(points);
    const lifeS = 0.35 + this.random() * 0.3;
    this.transient.push({
      object: points,
      ageS: 0,
      lifeS,
      update: (f, dt) => {
        const pos = geo.getAttribute('position') as THREE.BufferAttribute;
        for (let i = 0; i < count; i++) {
          velocities[i]!.y -= 9.8 * dt;
          pos.setXYZ(i, pos.getX(i) + velocities[i]!.x * dt, pos.getY(i) + velocities[i]!.y * dt, pos.getZ(i) + velocities[i]!.z * dt);
        }
        pos.needsUpdate = true;
        mat.opacity = 1 - f;
      },
    });
  }

  /** Expanding shockwave ring for a big beat (resolution, entry snap). */
  shockwave(at: THREE.Vector3, color: THREE.Color, maxRadius: number, lifeS: number): void {
    const geo = new THREE.RingGeometry(0.9, 1, 40);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(at);
    mesh.rotation.x = -Math.PI / 2;
    this.group.add(mesh);
    this.transient.push({
      object: mesh,
      ageS: 0,
      lifeS,
      update: (f) => {
        mesh.scale.setScalar(0.3 + f * maxRadius);
        mat.opacity = 1 - f;
      },
    });
  }

  /** 4-point "impact star" sprite, the anime-leaning read for a hard beat. */
  impactStar(at: THREE.Vector3, color: THREE.Color, size: number, lifeS: number): void {
    const shape = new THREE.Shape();
    const spikes = 4;
    for (let i = 0; i < spikes * 2; i++) {
      const r = i % 2 === 0 ? 1 : 0.35;
      const a = (i / (spikes * 2)) * Math.PI * 2;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
    shape.closePath();
    const geo = new THREE.ShapeGeometry(shape);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(at);
    this.group.add(mesh);
    this.transient.push({
      object: mesh,
      ageS: 0,
      lifeS,
      update: (f) => {
        mesh.scale.setScalar(size * (1.2 - f * 0.3));
        mesh.rotation.z += 0.02;
        mesh.lookAt(mesh.position.clone().add(new THREE.Vector3(0, 0, 1)));
        mat.opacity = 1 - f * f;
      },
    });
  }

  /** Advances every transient effect and removes the ones that finished. */
  tick(dt: number): void {
    this.dust.tick(dt);
    this.grit.tick(dt);
    for (let i = this.transient.length - 1; i >= 0; i--) {
      const t = this.transient[i]!;
      t.ageS += dt;
      if (t.ageS >= t.lifeS) {
        this.group.remove(t.object);
        disposeObject(t.object);
        this.transient.splice(i, 1);
        continue;
      }
      t.update(t.ageS / t.lifeS, dt);
    }
  }

  clear(): void {
    for (const t of this.transient.splice(0)) {
      this.group.remove(t.object);
      disposeObject(t.object);
    }
    this.dust.clear();
    this.grit.clear();
    this.dustCarry = 0;
    this.random = createFxRng();
  }

  dispose(): void {
    this.clear();
    this.dust.dispose();
    this.grit.dispose();
    this.sprite.dispose();
  }
}

function disposeObject(o: THREE.Object3D): void {
  o.traverse((child) => {
    const mesh = child as THREE.Mesh | THREE.Points;
    if ('geometry' in mesh && mesh.geometry) mesh.geometry.dispose();
    const material = (mesh as THREE.Mesh).material;
    if (material) (Array.isArray(material) ? material : [material]).forEach((m) => m.dispose());
  });
}

/**
 * Fixed-capacity particle pool with per-particle size/alpha/color (a tiny
 * point shader), simple ballistic motion with drag, and a round soft
 * sprite. Dead slots are reused; nothing is allocated per frame.
 */
class ParticlePool {
  readonly points: THREE.Points;
  alive = 0;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly col: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly baseSize: Float32Array;
  private readonly geo = new THREE.BufferGeometry();
  private readonly mat: THREE.ShaderMaterial;
  private next = 0;

  constructor(
    private readonly capacity: number,
    blending: THREE.Blending,
    private readonly peakAlpha: number,
    private readonly gravity: number,
    private readonly drag: number,
  ) {
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.age = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.baseSize = new Float32Array(capacity);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending,
      vertexShader: `attribute float aSize; attribute float aAlpha; varying float vAlpha; varying vec3 vColor;
        void main() { vAlpha = aAlpha; vColor = color; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = aSize * 900.0 / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying float vAlpha; varying vec3 vColor;
        void main() { vec2 c = gl_PointCoord - 0.5; float d = dot(c, c) * 4.0; if (d > 1.0) discard; gl_FragColor = vec4(vColor, vAlpha * (1.0 - d)); }`,
      vertexColors: true,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number, color: THREE.Color): void {
    const i = this.next;
    this.next = (this.next + 1) % this.capacity;
    if (this.life[i]! <= 0 || this.age[i]! >= this.life[i]!) this.alive++;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.col.set([color.r, color.g, color.b], i * 3);
    this.baseSize[i] = size;
    this.age[i] = 0;
    this.life[i] = life;
  }

  tick(dt: number): void {
    const k = Math.exp(-this.drag * dt);
    let alive = 0;
    for (let i = 0; i < this.capacity; i++) {
      const life = this.life[i]!;
      if (life <= 0) continue;
      const age = (this.age[i] = this.age[i]! + dt);
      if (age >= life) {
        this.life[i] = 0;
        this.alpha[i] = 0;
        this.size[i] = 0;
        continue;
      }
      alive++;
      const j = i * 3;
      this.vel[j + 1] = this.vel[j + 1]! + this.gravity * dt;
      this.vel[j] = this.vel[j]! * k;
      this.vel[j + 1] = this.vel[j + 1]! * k;
      this.vel[j + 2] = this.vel[j + 2]! * k;
      this.pos[j] = this.pos[j]! + this.vel[j]! * dt;
      this.pos[j + 1] = this.pos[j + 1]! + this.vel[j + 1]! * dt;
      this.pos[j + 2] = this.pos[j + 2]! + this.vel[j + 2]! * dt;
      const f = age / life;
      this.alpha[i] = this.peakAlpha * Math.min(1, f * 8) * (1 - f);
      this.size[i] = this.baseSize[i]! * (1 + f * 1.6); // dust puffs grow as they thin out
    }
    this.alive = alive;
    for (const name of ['position', 'color', 'aSize', 'aAlpha']) (this.geo.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
  }

  clear(): void {
    this.life.fill(0);
    this.alpha.fill(0);
    this.size.fill(0);
    this.alive = 0;
    this.next = 0;
    for (const name of ['aSize', 'aAlpha']) (this.geo.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}
