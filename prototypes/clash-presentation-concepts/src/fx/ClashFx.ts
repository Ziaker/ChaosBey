// ============================================================
// CLASH PRESENTATION LAB — VFX PRIMITIVES
// Self-contained Three.js building blocks for the Clash-specific visuals
// this lab explores (energy between the Beys, mash pulses, the resolution
// burst, a winner/loser/tie banner). Styled in the spirit of the approved
// Híbrida VFX language (prototypes/vfx-visual-concepts) — additive glow,
// cel-flavored rings, sparks that respect the arena's own spark palette —
// but built fresh for a moment (the Clash) that Híbrida itself never
// covered (see visual-prototype-inventory.md: "Clash completo... NÃO
// PROTOTIPADO"). Every shape here is plain, cheap and easy to reskin per
// direction; the three directions differ by which knobs they turn, not by
// three separate rendering engines.
// ============================================================

import * as THREE from 'three';

function softDisc(): THREE.CanvasTexture {
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
 * Owns every transient Clash visual (beam, pulses, bursts, sparks) inside
 * one Group, so a direction switch or a scenario restart can clear
 * everything with one call. Nothing here decides Clash outcomes — it only
 * reacts to what ClashStageSim/ClashHarness already computed (GDD 158:
 * VFX observes, it never decides).
 */
export class ClashFx {
  readonly group = new THREE.Group();
  private readonly sprite = softDisc();
  private readonly transient: LifetimeObject[] = [];
  private beam: THREE.Mesh | null = null;
  private beamMaterial: THREE.MeshBasicMaterial | null = null;

  /** Persistent energy visual between the two Beys, shown for the whole Approach+Active beat. Call every tick; `advantage` is -1 (second fully ahead) .. +1 (first fully ahead), `pulse01` a 0..1 wobble driven by the current mash rate. */
  updateEnergyBeam(a: THREE.Vector3, b: THREE.Vector3, colorFirst: THREE.Color, colorSecond: THREE.Color, opts: { visible: boolean; radius: number; segments: number; advantage: number; pulse01: number; twist: number }): void {
    if (!this.beam) {
      const geo = new THREE.CylinderGeometry(1, 1, 1, 10, Math.max(2, opts.segments), true);
      this.beamMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      this.beam = new THREE.Mesh(geo, this.beamMaterial);
      this.beam.renderOrder = 5;
      this.group.add(this.beam);
    }
    this.beam.visible = opts.visible;
    if (!opts.visible) return;
    const mid = a.clone().lerp(b, 0.5);
    const dist = a.distanceTo(b);
    this.beam.position.copy(mid);
    this.beam.scale.set(opts.radius * (0.85 + opts.pulse01 * 0.5), Math.max(0.01, dist), opts.radius * (0.85 + opts.pulse01 * 0.5));
    this.beam.lookAt(b.x, this.beam.position.y, b.z);
    this.beam.rotateX(Math.PI / 2);
    this.beam.rotation.z += opts.twist;
    const bias = THREE.MathUtils.clamp((opts.advantage + 1) / 2, 0, 1);
    this.beamMaterial!.color.copy(colorSecond).lerp(colorFirst, bias);
    this.beamMaterial!.opacity = 0.35 + opts.pulse01 * 0.5;
  }

  hideEnergyBeam(): void {
    if (this.beam) this.beam.visible = false;
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
      velocities.push(new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.6 + 0.1, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.8)));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({ color, size: 0.12, map: this.sprite, transparent: true, alphaTest: 0.01, blending: THREE.AdditiveBlending, depthWrite: false });
    const points = new THREE.Points(geo, mat);
    this.group.add(points);
    const lifeS = 0.35 + Math.random() * 0.3;
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
    this.hideEnergyBeam();
  }

  dispose(): void {
    this.clear();
    if (this.beam) disposeObject(this.beam);
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
