// ============================================================
// SKID MARKS, BATCHED (cost pass, 0.47.4)
// A fast Bey leaves a soft dark dot on the floor every 0.035 s that holds for 60% of its 2.5 s life and then fades. Each dot was
// its own FxLayer object (a plane with 24 x 24 segments, a material, a draw call), re-draped on the floor every frame: ~70 live
// per Bey, 130+ draw calls and 150k triangles in a measured match, more the faster the Beys run. This keeps the same dots, the
// same lift, size, opacity and timing, in ONE mesh with a fixed ring of slots (one draw call, no per-dot allocation).
// Presentation only: nothing here reads or writes the simulation.
// ============================================================

import * as THREE from 'three';

const VERTICES_PER_SLOT = 4;

export interface SkidMarkOptions {
  /** Centre on the floor (only x, z are used). */
  readonly x: number;
  readonly z: number;
  /** Side of the square dot, world metres (already scaled). */
  readonly size: number;
  /** Seconds. */
  readonly life: number;
  /** Peak opacity. */
  readonly opacity: number;
  /** Fraction of the life held at full opacity before the fade. */
  readonly hold: number;
  /** Metres above the floor. */
  readonly lift: number;
}

interface Slot {
  age: number;
  life: number;
  opacity: number;
  hold: number;
  alive: boolean;
}

export class SkidBatch {
  readonly object: THREE.Mesh;
  private readonly slots: Slot[];
  private readonly position: THREE.BufferAttribute;
  private readonly color: THREE.BufferAttribute;
  private next = 0;
  private live = 0;

  constructor(texture: THREE.Texture, private readonly floorHeightAt: (r: number) => number, readonly capacity = 220) {
    this.slots = Array.from({ length: capacity }, () => ({ age: 0, life: 1, opacity: 0, hold: 0, alive: false }));
    const geometry = new THREE.BufferGeometry();
    this.position = new THREE.BufferAttribute(new Float32Array(capacity * VERTICES_PER_SLOT * 3), 3);
    this.color = new THREE.BufferAttribute(new Float32Array(capacity * VERTICES_PER_SLOT * 4), 4); // black, alpha per dot
    const uv = new Float32Array(capacity * VERTICES_PER_SLOT * 2);
    const index = new Uint32Array(capacity * 6);
    for (let i = 0; i < capacity; i++) {
      uv.set([0, 0, 1, 0, 1, 1, 0, 1], i * 8);
      const v = i * VERTICES_PER_SLOT;
      index.set([v, v + 1, v + 2, v, v + 2, v + 3], i * 6);
    }
    this.position.setUsage(THREE.DynamicDrawUsage);
    this.color.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', this.position);
    geometry.setAttribute('color', this.color);
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    // The dots are anywhere on the floor: a bounding sphere over the whole stage would be recomputed for nothing.
    this.object = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        map: texture, color: 0x000000, vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
        polygonOffset: true, polygonOffsetFactor: -2,
      }),
    );
    this.object.frustumCulled = false;
    this.object.renderOrder = -1; // floor decals go under every other transparent effect, as each dot's own depth sort used to place it
    this.object.name = 'skid-marks';
  }

  /** Lays one dot on the floor; past the capacity the oldest dot is reused. */
  add(o: SkidMarkOptions): void {
    const i = this.next;
    this.next = (this.next + 1) % this.capacity;
    const slot = this.slots[i]!;
    if (!slot.alive) this.live++;
    Object.assign(slot, { age: 0, life: o.life, opacity: o.opacity, hold: o.hold, alive: true });
    const h = o.size / 2;
    // Corners in the order of the uv array above (-x -z, +x -z, +x +z, -x +z), each on the floor at its own radius.
    const corners: ReadonlyArray<readonly [number, number]> = [[-h, -h], [h, -h], [h, h], [-h, h]];
    corners.forEach(([dx, dz], k) => {
      const x = o.x + dx;
      const z = o.z + dz;
      this.position.setXYZ(i * VERTICES_PER_SLOT + k, x, this.floorHeightAt(Math.hypot(x, z)) + o.lift, z);
    });
    this.setAlpha(i, o.opacity);
    this.position.needsUpdate = true;
  }

  tick(dt: number): void {
    if (this.live === 0) return;
    for (let i = 0; i < this.capacity; i++) {
      const slot = this.slots[i]!;
      if (!slot.alive) continue;
      slot.age += dt;
      const k = Math.min(1, slot.age / slot.life);
      if (slot.age >= slot.life) {
        slot.alive = false;
        this.live--;
        this.setAlpha(i, 0);
      } else {
        this.setAlpha(i, slot.opacity * (k < slot.hold ? 1 : 1 - (k - slot.hold) / (1 - slot.hold)));
      }
    }
    this.color.needsUpdate = true;
  }

  count(): number {
    return this.live;
  }

  clear(): void {
    for (let i = 0; i < this.capacity; i++) {
      this.slots[i]!.alive = false;
      this.setAlpha(i, 0);
    }
    this.live = 0;
    this.color.needsUpdate = true;
  }

  dispose(): void {
    this.object.removeFromParent();
    this.object.geometry.dispose();
    (this.object.material as THREE.Material).dispose();
  }

  private setAlpha(slot: number, alpha: number): void {
    for (let k = 0; k < VERTICES_PER_SLOT; k++) this.color.setXYZW(slot * VERTICES_PER_SLOT + k, 0, 0, 0, alpha);
  }
}
