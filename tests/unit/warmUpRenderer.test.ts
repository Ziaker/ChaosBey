// 0.62.0: the round's shaders and textures are prepared behind the loading screen. The warm-up must prepare everything the scene
// holds (hidden pooled effects included), wait for the driver, give up after its timeout, and never throw.

import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { warmUpRenderer } from '../../src/app/bootstrap/warmUpRenderer';

function fakeRenderer(compile: () => Promise<unknown>): { renderer: THREE.WebGLRenderer; initTexture: ReturnType<typeof vi.fn>; compileAsync: ReturnType<typeof vi.fn> } {
  const initTexture = vi.fn();
  const compileAsync = vi.fn(compile);
  const renderer = { initTexture, compileAsync, info: { programs: [] as unknown[] } } as unknown as THREE.WebGLRenderer;
  return { renderer, initTexture, compileAsync };
}

function sceneWithTexture(): { scene: THREE.Scene; texture: THREE.Texture } {
  const scene = new THREE.Scene();
  const texture = new THREE.Texture(document_like());
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ map: texture, emissiveMap: texture }));
  const hidden = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  hidden.visible = false;
  scene.add(mesh, hidden);
  return { scene, texture };
}

/** A texture needs an `image` to count as loaded; a plain object stands in for a canvas. */
function document_like(): HTMLCanvasElement {
  return { width: 4, height: 4 } as unknown as HTMLCanvasElement;
}

describe('warmUpRenderer', () => {
  it('uploads each texture once and compiles the whole scene, waiting for the driver', async () => {
    const { scene, texture } = sceneWithTexture();
    const { renderer, initTexture, compileAsync } = fakeRenderer(async () => scene);
    const camera = new THREE.PerspectiveCamera();
    const report = await warmUpRenderer(renderer, scene, camera);
    expect(initTexture).toHaveBeenCalledTimes(1); // the same texture in two slots is uploaded once
    expect(initTexture).toHaveBeenCalledWith(texture);
    expect(compileAsync).toHaveBeenCalledWith(scene, camera);
    expect(report.texturesUploaded).toBe(1);
    expect(report.timedOut).toBe(false);
  });

  it('stops waiting after its timeout and carries on (the compile finishes in the background)', async () => {
    const { scene } = sceneWithTexture();
    const { renderer } = fakeRenderer(() => new Promise(() => undefined));
    const report = await warmUpRenderer(renderer, scene, new THREE.PerspectiveCamera(), 20);
    expect(report.timedOut).toBe(true);
  });

  it('never throws: a driver that refuses just leaves the old compile-on-first-use behaviour', async () => {
    const { scene } = sceneWithTexture();
    const { renderer } = fakeRenderer(async () => {
      throw new Error('driver says no');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(warmUpRenderer(renderer, scene, new THREE.PerspectiveCamera())).resolves.toMatchObject({ timedOut: false });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
