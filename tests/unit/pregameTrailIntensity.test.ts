import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { VfxManager } from '../../src/vfx/VfxManager';

function trailLines(scene: THREE.Object3D): THREE.Line[] {
  return scene.children.filter((child): child is THREE.Line => child instanceof THREE.Line);
}

function trailOpacities(scene: THREE.Object3D): number[] {
  return trailLines(scene).map((line) => (line.material as THREE.LineBasicMaterial).opacity);
}

describe('Pregame motion-trail intensity + Quality gate', () => {
  it('scales the persistent SpeedTrail at render time without changing its lifecycle', () => {
    const scene = new THREE.Group();
    const camera = new THREE.PerspectiveCamera();
    const vfx = new VfxManager(scene, camera);
    const first = { x: 0, y: 0.2, z: 0 };
    const second = { x: 1, y: 0.2, z: 0 };

    vfx.setTrailIntensity(0);
    vfx.onRenderFrame(1 / 60, first, 100, second, 100, { x: 1, y: 0 });
    expect(trailLines(scene)).toHaveLength(2);
    expect(trailOpacities(scene)).toEqual([0, 0]);

    vfx.setTrailIntensity(1);
    vfx.onRenderFrame(1 / 60, first, 100, second, 100, { x: 1, y: 0 });
    const approved = trailOpacities(scene);
    expect(approved[0]).toBeGreaterThan(0);
    expect(approved[1]).toBeGreaterThan(0);

    vfx.setTrailIntensity(1.5);
    vfx.onRenderFrame(1 / 60, first, 100, second, 100, { x: 1, y: 0 });
    const boosted = trailOpacities(scene);
    expect(boosted[0]).toBeGreaterThan(approved[0]!);
    expect(boosted[1]).toBeGreaterThan(approved[1]!);
    expect(boosted[0]).toBeLessThanOrEqual(1);
    expect(boosted[1]).toBeLessThanOrEqual(1);

    vfx.dispose();
  });

  it('keeps Quality/layer visibility as a hard gate regardless of Pregame intensity', () => {
    const scene = new THREE.Group();
    const camera = new THREE.PerspectiveCamera();
    const vfx = new VfxManager(scene, camera);

    vfx.setTrailIntensity(1.5);
    vfx.setLayerVisible('trails', false);
    vfx.onRenderFrame(1 / 60, { x: 0, y: 0.2, z: 0 }, 100, { x: 1, y: 0.2, z: 0 }, 100, { x: 1, y: 0 });
    expect(trailLines(scene).map((line) => line.visible)).toEqual([false, false]);

    vfx.setLayerVisible('trails', true);
    expect(trailLines(scene).map((line) => line.visible)).toEqual([true, true]);

    vfx.dispose();
  });
});
