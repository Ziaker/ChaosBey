// ============================================================
// ARENA VISUALS (batch 5): the approved arena art in the game
// These prove the port: each approved arena builds on every real floor profile
// and sits on the surface the Beys stand on, nothing dresses the space the camera
// works in, the system restores everything it changed (fog, tone mapping) and
// removes what it added, the temporary arena visuals go to a hidden holder, and
// the physics side (colliders, floor equation, ring-out) is untouched.
// ============================================================

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ARENA_ART } from '../../src/arena/visual/ArenaArt';
import { mergeStaticMeshes } from '../../src/arena/visual/common';
import { ArenaVisualsSystem, type ToneMappedRenderer } from '../../src/arena/visual/ArenaVisualsSystem';
import { ARENA_FLOORS, ARENA_FLOOR_IDS, floorRimHeight } from '../../src/arena/floor/ArenaFloorProfile';
import { ARENA_PRESETS, type ArenaPresetId } from '../../src/arena/presets/ArenaPresets';
import { ARENA_FLOOR_RADIUS } from '../../src/arena/colliders/ArenaTuning';
import { createMatchScene } from '../../src/app/bootstrap/createMatchScene';
import { PhysicsWorld } from '../../src/physics/world/PhysicsWorld';
import { resolvePresentationFeatures, type PresentationEvent } from '../../src/presentation';

const PRESET_IDS: readonly ArenaPresetId[] = ['foundry', 'rift', 'tournament'];
/**
 * The camera's eye stays inside this radius. Read, not imported: the camera is frozen. Today CameraRig holds it at 10.5 m;
 * the camera follow-up for the 36 m stage derives it from the arena (floor radius - 1.5 m, PR #88), so the stricter of the
 * two is checked here: nothing may stand between a camera at the very edge of its range and the action.
 */
const CAMERA_CONTAIN_RADIUS_M = ARENA_FLOOR_RADIUS - 1.5;
/** Well above the camera's eye height (its framings are low and close): rigging hung higher than this is never between the camera and the action. */
const CAMERA_CEILING_M = 12;

describe('the approved arenas, on every real floor', () => {
  it.each(PRESET_IDS)('%s builds on flat and every approved bowl and follows the real floor profile', (id) => {
    for (const floor of ARENA_FLOOR_IDS) {
      const profile = ARENA_FLOORS[floor];
      const built = ARENA_ART[id].build(undefined, profile.heightAtRadius);
      // The art stands on the surface the Beys stand on: same height at every radius, same rim.
      for (const r of [0, 1.3, 3, 6, 9.5, 12, 20, 30, ARENA_FLOOR_RADIUS]) expect(built.floorHeightAt(r)).toBeCloseTo(profile.heightAtRadius(r), 9);
      expect(built.depth).toBeCloseTo(floorRimHeight(floor), 9);
      expect(built.root.children.length).toBeGreaterThan(5);
      // The art's wall stands where the physical wall's inner face is (the real 36 m floor, not the lab's 12 m one).
      expect(built.wallRadius).toBe(ARENA_FLOOR_RADIUS);
      // Everything is finite and animates through a Clash and a wall flash without throwing.
      for (let i = 0; i <= 10; i++) built.update({ time: i * 0.1, dt: 0.1, clash: i / 10 });
      built.flash(new THREE.Vector3(ARENA_FLOOR_RADIUS - 1, 1, 0));
      built.root.traverse((o) => {
        expect(Number.isFinite(o.position.x + o.position.y + o.position.z)).toBe(true);
      });
      built.dispose();
    }
  });

  it.each(PRESET_IDS)('%s leaves the camera\'s working space clear: nothing but the floor stands inside the containment radius', (id) => {
    for (const floor of ['flat', 'bowl-a', 'bowl-b', 'bowl-c'] as const) {
      const built = ARENA_ART[id].build(undefined, ARENA_FLOORS[floor].heightAtRadius);
      built.root.updateMatrixWorld(true);
      const rim = floorRimHeight(floor);
      const intruders: string[] = [];
      built.root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        // (Instanced seats carry their own per-instance matrices: the crowd stands 3 m and more beyond the wall.)
        if (!mesh.isMesh || (mesh as THREE.InstancedMesh).isInstancedMesh) return;
        const position = mesh.geometry.getAttribute('position');
        if (!position) return;
        const v = new THREE.Vector3();
        let minR = Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        for (let i = 0; i < position.count; i++) {
          v.fromBufferAttribute(position as THREE.BufferAttribute, i).applyMatrix4(mesh.matrixWorld);
          minR = Math.min(minR, Math.hypot(v.x, v.z));
          minY = Math.min(minY, v.y);
          maxY = Math.max(maxY, v.y);
        }
        const isSky = minR > 3 * 100 || mesh.geometry.type === 'SphereGeometry';
        const isFloorLevel = maxY <= rim + 0.02; // the floor itself and markings painted on it // the floor itself and markings painted on it
        // Overhead rigging (the Foundry truss and lamps, the stadium light ring) hangs above anything the camera frames.
        const isOverhead = minY > CAMERA_CEILING_M;
        if (!isSky && !isFloorLevel && !isOverhead && minR < CAMERA_CONTAIN_RADIUS_M) intruders.push(`${mesh.geometry.type} minR=${minR.toFixed(2)} maxY=${maxY.toFixed(2)}`);
      });
      // Inner wall faces (and rings) start beyond the camera's reach; the only things allowed closer are flat floor-level surfaces.
      expect(intruders, `${id}/${floor}`).toEqual([]);
      built.dispose();
    }
  });

  it.each(PRESET_IDS)('%s lights the whole real floor, not just the lab\'s 12 m of it', (id) => {
    const built = ARENA_ART[id].build(undefined, ARENA_FLOORS['bowl-a'].heightAtRadius);
    built.root.updateMatrixWorld(true);
    const spots: THREE.SpotLight[] = [];
    let directional = false;
    built.root.traverse((o) => {
      if ((o as THREE.SpotLight).isSpotLight) spots.push(o as THREE.SpotLight);
      if ((o as THREE.DirectionalLight).isDirectionalLight) directional = true;
    });
    const unlit: string[] = [];
    for (const r of [0, 0.5 * ARENA_FLOOR_RADIUS, 0.95 * ARENA_FLOOR_RADIUS]) {
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const p = new THREE.Vector3(Math.cos(a) * r, built.floorHeightAt(r), Math.sin(a) * r);
        const inCone = spots.some((s) => {
          const toPoint = p.clone().sub(s.position);
          const axis = s.target.position.clone().sub(s.position);
          return toPoint.length() <= s.distance && toPoint.angleTo(axis) <= s.angle;
        });
        if (!inCone && !directional) unlit.push(`r=${r.toFixed(1)} a=${a.toFixed(2)}`);
      }
    }
    expect(unlit, id).toEqual([]);
    built.dispose();
  });
});

interface FakeScene {
  fog: THREE.Scene['fog'];
}

function systemFor(id: ArenaPresetId, renderer?: ToneMappedRenderer, getClashIntensity?: () => number) {
  const scene = new THREE.Scene();
  const root = new THREE.Group();
  scene.add(root);
  const before = new THREE.Fog(0x123456, 5, 50);
  scene.fog = before;
  const system = new ArenaVisualsSystem({ scene, root, presetId: id, floorHeightAtR: () => 0, renderer, getClashIntensity });
  return { scene, root, before, system };
}

describe('ArenaVisualsSystem', () => {
  it('adds the arena to the session root, sets the arena\'s fog and tone mapping, and puts them back on dispose', () => {
    const renderer: ToneMappedRenderer = { toneMapping: THREE.NoToneMapping, toneMappingExposure: 1 };
    for (const id of PRESET_IDS) {
      const { scene, root, before, system } = systemFor(id, renderer);
      expect(root.children).toHaveLength(1);
      expect(root.children[0]!.name).toBe(`arena-art-${id}`);
      expect(renderer.toneMapping).toBe(THREE.ACESFilmicToneMapping);
      expect(renderer.toneMappingExposure).toBe(system.built.exposure);
      expect(scene.fog).toBe(system.built.fog);
      system.dispose();
      expect(root.children).toHaveLength(0);
      expect(scene.fog).toBe(before);
      expect(renderer.toneMapping).toBe(THREE.NoToneMapping);
      expect(renderer.toneMappingExposure).toBe(1);
    }
  });

  it('leaves the renderer alone when none is given', () => {
    const { system } = systemFor('foundry');
    system.dispose();
  });

  it('follows the Clash: active state or the Clash presentation pushes the lighting up, and it relaxes after', () => {
    let external = 0;
    const { system } = systemFor('tournament', undefined, () => external);
    const frame = (active: boolean, dt = 1 / 60) => system.update({ dtSeconds: dt, state: { clash: { active } } as never });
    for (let i = 0; i < 30; i++) frame(false);
    expect(system.getStats().clash).toBeLessThan(0.01);
    for (let i = 0; i < 90; i++) frame(true);
    expect(system.getStats().clash).toBeGreaterThan(0.9);
    for (let i = 0; i < 200; i++) frame(false);
    expect(system.getStats().clash).toBeLessThan(0.05);
    external = 1;
    for (let i = 0; i < 90; i++) frame(false);
    expect(system.getStats().clash).toBeGreaterThan(0.9);
    system.reset();
    expect(system.getStats().clash).toBe(0);
    system.dispose();
  });

  it('flashes the wall lights only for a collision at the wall, not a bump in the middle', () => {
    const flashes: THREE.Vector3[] = [];
    const { system } = systemFor('foundry');
    const original = system.built.flash.bind(system.built);
    (system.built as { flash: (p: THREE.Vector3) => void }).flash = (p) => {
      flashes.push(p.clone());
      original(p);
    };
    const event = (x: number): PresentationEvent => ({ kind: 'collisionResolved', tick: 1, side: 'first', magnitude: 0.8, position: { x, y: 0.4, z: 0 } });
    system.onEvents([event(1)], {} as never);
    expect(flashes).toHaveLength(0);
    // Well inside the bigger stage (a fraction of its radius would have counted this as "at the wall").
    system.onEvents([event(25)], {} as never);
    expect(flashes).toHaveLength(0);
    system.onEvents([event(ARENA_FLOOR_RADIUS - 0.7)], {} as never);
    expect(flashes).toHaveLength(1);
    expect(Math.hypot(flashes[0]!.x, flashes[0]!.z)).toBeCloseTo(ARENA_FLOOR_RADIUS - 0.36, 6);
    system.dispose();
  });
});

describe('the physics side is untouched', () => {
  it('maps every preset theme to its art, and the default (flag off) never builds any', () => {
    expect(ARENA_PRESETS.map((p) => p.id)).toEqual(PRESET_IDS);
    expect(Object.keys(ARENA_ART).sort()).toEqual([...PRESET_IDS].sort());
  });

  it('puts the temporary arena visuals in a hidden holder with the flag on, and builds the same colliders either way', async () => {
    const build = async (arenaVisuals: boolean) => {
      const scene = new THREE.Group();
      const physics = await PhysicsWorld.create();
      const match = createMatchScene(scene, physics, undefined, undefined, undefined, 'B', resolvePresentationFeatures({ arenaVisuals }));
      return { scene, physics, match };
    };
    const off = await build(false);
    const on = await build(true);
    const holder = on.scene.children.find((c) => c.name === 'discarded-temporary-arena-visuals');
    expect(holder).toBeDefined();
    expect(holder!.visible).toBe(false);
    expect(holder!.children.length).toBeGreaterThan(2); // floor, wall, rim ring (its two lights are on the holder too)
    expect(off.scene.children.some((c) => c.name === 'discarded-temporary-arena-visuals')).toBe(false);
    // The colliders are the same bodies in the same places.
    const bodies = (w: PhysicsWorld): string[] => {
      const out: string[] = [];
      w.rapierWorld.bodies.forEach((b) => out.push(JSON.stringify([b.bodyType(), b.translation(), b.rotation()])));
      return out.sort();
    };
    expect(bodies(on.physics)).toEqual(bodies(off.physics));
    const colliders = (w: PhysicsWorld): number => {
      let n = 0;
      w.rapierWorld.colliders.forEach(() => n++);
      return n;
    };
    expect(colliders(on.physics)).toBe(colliders(off.physics));
    off.physics.rapierWorld.free();
    on.physics.rapierWorld.free();
  });
});

describe('FakeScene', () => {
  it('is only a type helper', () => {
    const scene: FakeScene = { fog: null };
    expect(scene.fog).toBeNull();
  });
});

describe('static arena parts are baked into few meshes (same picture, fewer draw calls)', () => {
  const triangles = (root: THREE.Object3D): number => {
    let n = 0;
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || (mesh as THREE.InstancedMesh).isInstancedMesh) return;
      const g = mesh.geometry;
      n += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
    });
    return n;
  };
  const worldBox = (root: THREE.Object3D): THREE.Box3 => {
    root.updateMatrixWorld(true);
    return new THREE.Box3().setFromObject(root);
  };

  it('merging keeps every triangle and the same world bounds, leaves animated parts alone, and frees what it replaced', () => {
    const root = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial();
    const boltMat = new THREE.MeshStandardMaterial();
    for (let i = 0; i < 20; i++) {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 0.5), mat);
      panel.position.set(Math.cos(i) * 30, 1, Math.sin(i) * 30);
      panel.rotation.y = i;
      const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.08, 6), boltMat);
      bolt.position.set(0.2, 0.5, 0.27);
      panel.add(bolt);
      root.add(panel);
    }
    const drifting = new THREE.Group();
    drifting.userData.animated = true;
    drifting.add(new THREE.Mesh(new THREE.OctahedronGeometry(1), mat), new THREE.Mesh(new THREE.OctahedronGeometry(1), mat));
    root.add(drifting);
    const before = { tris: triangles(root), box: worldBox(root).clone() };
    mergeStaticMeshes(root);
    mergeStaticMeshes(root);
    let meshes = 0;
    root.traverse((o) => void ((o as THREE.Mesh).isMesh && meshes++));
    expect(triangles(root)).toBe(before.tris);
    const after = worldBox(root);
    expect(after.min.distanceTo(before.box.min)).toBeLessThan(1e-4);
    expect(after.max.distanceTo(before.box.max)).toBeLessThan(1e-4);
    // 20 panels with a bolt each -> 1 bolt mesh, then 1 panel mesh; the 2 drifting shards stay as they are.
    expect(drifting.children).toHaveLength(2);
    expect(meshes).toBe(1 + 1 + 2);
  });

  it.each(PRESET_IDS)('%s builds with a small number of meshes', (id) => {
    const built = ARENA_ART[id].build(undefined, ARENA_FLOORS['bowl-a'].heightAtRadius);
    let meshes = 0;
    built.root.traverse((o) => void ((o as THREE.Mesh).isMesh && meshes++));
    expect(meshes, id).toBeLessThan(60);
    built.dispose();
  });
});
