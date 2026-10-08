// ============================================================
// VFX COST (0.47.4): the Epic preset (effects x1.3, game speed x1.3) dropped the frame rate. The work that piled up is capped
// or made cheaper without changing what an effect looks like or what a slider means (presentation only: nothing here touches
// the simulation, so state hashes stay as they were).
// ============================================================

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { FX_LIVE_BUDGET, FxLayer, StreakSparks, type FxItem } from '../../src/vfx/hybrid/fx/FxLayer';
import { conformSegments, flatFx } from '../../src/vfx/hybrid/fx/primitives';
import { SkidBatch } from '../../src/vfx/hybrid/fx/SkidBatch';

const quad = (life = 1): FxItem => ({ object: new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial()), life, update() {} });

describe('FxLayer live-effect budget', () => {
  it('recycles the oldest effect (disposed and removed) instead of growing past the budget', () => {
    const scene = new THREE.Group();
    const layer = new FxLayer(scene, new THREE.PerspectiveCamera(), 5);
    const items = Array.from({ length: 8 }, () => quad());
    let disposed = 0;
    for (const item of items) (item.object as THREE.Mesh).geometry.addEventListener('dispose', () => disposed++);
    for (const item of items) layer.add(item);
    expect(layer.count()).toBe(5);
    expect(layer.recycled).toBe(3);
    expect(disposed).toBe(3);
    // The three oldest are the ones that went.
    expect(items.slice(0, 3).every((item) => item.object.parent === null)).toBe(true);
    expect(items.slice(3).every((item) => item.object.parent === scene)).toBe(true);
  });

  it('keeps the default budget above what the approved look needs and below an unbounded pile-up', () => {
    expect(FX_LIVE_BUDGET).toBeGreaterThanOrEqual(600);
    expect(FX_LIVE_BUDGET).toBeLessThanOrEqual(1000);
    const layer = new FxLayer(new THREE.Group(), new THREE.PerspectiveCamera());
    for (let i = 0; i < FX_LIVE_BUDGET + 50; i++) layer.add(quad());
    expect(layer.count()).toBe(FX_LIVE_BUDGET);
  });
});

describe('floor-draped decals', () => {
  it('uses a grid sized to the decal: a skid mark is a handful of triangles, a big ring keeps the 24 x 24 grid', () => {
    expect(conformSegments(0.28)).toBeLessThanOrEqual(3);
    expect(conformSegments(2.2)).toBeLessThan(24);
    expect(conformSegments(19.5)).toBe(24);
    expect(conformSegments(0)).toBe(2);
  });

  it('only re-drapes while its scale changes (a held decal no longer rewrites and re-uploads its vertices every frame)', () => {
    const calls = { n: 0 };
    const item = flatFx({
      tex: new THREE.Texture(), color: 0, pos: new THREE.Vector3(1, 0.5, 0), size: [0.28, 0.28], life: 2.5, hold: 0.7,
      conform: { floorHeightAt: (r) => { calls.n++; return 0.01 * r; }, lift: 0.015 },
    });
    const live = Object.assign(item, { age: 0, fxScale: 1, fxScaleApplied: false });
    item.update(0, 0, live);
    const first = calls.n;
    expect(first).toBeGreaterThan(0);
    // After the quick grow (hold > 0: the first sixth of its life) the size is constant: no more floor lookups.
    item.update(0.5, 1 / 60, live);
    const settled = calls.n;
    for (let k = 0.5; k < 1; k += 0.02) item.update(k, 1 / 60, live);
    expect(calls.n).toBe(settled);
  });
});

describe('StreakSparks', () => {
  const options = { count: 10, speed: 5, dir: new THREE.Vector3(0, 1, 0), spread: 1, life: [0.2, 0.2] as [number, number], hot: 0xffffff, cool: 0xff0000 };

  it('never holds more than its capacity: the oldest go first, in one move', () => {
    const sparks = new StreakSparks(25, () => 0);
    for (let i = 0; i < 6; i++) sparks.emit(new THREE.Vector3(), options);
    expect(sparks.count()).toBe(25);
  });

  it('drops the dead ones in one ordered pass and draws only the live ones', () => {
    const sparks = new StreakSparks(100, () => -10);
    sparks.emit(new THREE.Vector3(), { ...options, life: [0.1, 0.1] });
    sparks.emit(new THREE.Vector3(), { ...options, life: [0.5, 0.5] });
    sparks.tick(0.2);
    expect(sparks.count()).toBe(10);
    expect(sparks.object.geometry.drawRange.count).toBe(20);
    sparks.tick(0.5);
    expect(sparks.count()).toBe(0);
    expect(sparks.object.geometry.drawRange.count).toBe(0);
  });
});

describe('SkidBatch (all the skid marks in one mesh)', () => {
  const dot = { x: 4, z: 3, size: 0.28, life: 2.5, opacity: 0.35, hold: 0.6, lift: 0.015 };
  const alphaOf = (batch: SkidBatch, slot: number): number => (batch.object.geometry.getAttribute('color') as THREE.BufferAttribute).getW(slot * 4);

  it('lays each dot on the floor at the same lift, holds it, fades it and frees the slot', () => {
    const batch = new SkidBatch(new THREE.Texture(), (r) => 0.1 * r, 8);
    batch.add(dot);
    const position = batch.object.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let k = 0; k < 4; k++) {
      const x = position.getX(k);
      const z = position.getZ(k);
      expect(Math.abs(x - 4)).toBeCloseTo(0.14, 6);
      expect(Math.abs(z - 3)).toBeCloseTo(0.14, 6);
      expect(position.getY(k)).toBeCloseTo(0.1 * Math.hypot(x, z) + 0.015, 6);
    }
    expect(batch.count()).toBe(1);
    expect(alphaOf(batch, 0)).toBeCloseTo(0.35, 6);
    batch.tick(1); // 40% of the life: still held
    expect(alphaOf(batch, 0)).toBeCloseTo(0.35, 6);
    batch.tick(1); // 80%: half way through the fade
    expect(alphaOf(batch, 0)).toBeCloseTo(0.35 * 0.5, 6);
    batch.tick(1); // past its life
    expect(batch.count()).toBe(0);
    expect(alphaOf(batch, 0)).toBe(0);
  });

  it('is one draw call however many dots are live, and reuses the oldest slot past its capacity', () => {
    const batch = new SkidBatch(new THREE.Texture(), () => 0, 4);
    for (let i = 0; i < 10; i++) batch.add({ ...dot, x: i });
    expect(batch.count()).toBe(4);
    expect(batch.object.isMesh).toBe(true);
    batch.clear();
    expect(batch.count()).toBe(0);
  });
});
