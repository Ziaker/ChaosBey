// ============================================================
// RENDERER BOOTSTRAP
// Owns the Three.js WebGLRenderer/scene/camera lifecycle only. Gameplay
// systems must not reach into this module to mutate scene contents
// directly — they add/remove their own objects to the scene they're handed.
// ============================================================

import * as THREE from 'three';

// Placeholder camera framing for Milestone 0 (proves the render path only).
// Final combat camera behavior belongs to the camera/director system.
const PLACEHOLDER_CAMERA_FOV_DEG = 60;
const PLACEHOLDER_CAMERA_NEAR = 0.1;
const PLACEHOLDER_CAMERA_FAR = 500;

export interface AppRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  render: () => void;
  dispose: () => void;
}

export function createRenderer(canvas: HTMLCanvasElement): AppRenderer {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05050a);

  const camera = new THREE.PerspectiveCamera(
    PLACEHOLDER_CAMERA_FOV_DEG,
    window.innerWidth / window.innerHeight,
    PLACEHOLDER_CAMERA_NEAR,
    PLACEHOLDER_CAMERA_FAR,
  );
  camera.position.set(0, 6, 10);
  camera.lookAt(0, 0, 0);

  const handleResize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  handleResize();
  window.addEventListener('resize', handleResize);

  return {
    renderer,
    scene,
    camera,
    render: () => renderer.render(scene, camera),
    dispose: () => {
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
    },
  };
}
