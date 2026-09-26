// ============================================================
// BEY VISUAL CONCEPTS — 3D PRODUCT VIEWER
// Dark studio stage showing ONE concept at a time (only the selected
// model exists in the scene). Presentation only: the auto-rotate is a
// turntable, not the game's spin physics.
// ============================================================

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { assembleConcept, type BuiltConcept, type ConceptMeasurements } from '../model/assembleConcept';
import type { ConceptDefinition } from '../model/types';

// ---------------- VIEWER TUNING ----------------
const CAMERA_FOV_DEG = 30;               // Vertical FOV. Low = product-photo look, less distortion.
const DIAGONAL_AZIMUTH_DEG = 36;         // Front-diagonal: rotation around Y from the front (+Z) toward +X.
const DIAGONAL_ELEVATION_DEG = 14;       // Front-diagonal: degrees above the horizon. Low enough to show the tip under the ring.
const SIDE_ELEVATION_DEG = 2;            // Side profile: nearly level with the model.
const BELOW_ELEVATION_DEG = -38;         // Underside view: degrees BELOW the floor plane.
const TOP_POLAR_EPSILON_RAD = 0.0008;    // Top view: tiny offset from exact vertical avoids an undefined camera "up".
const FRAMING_BLEND = 0.45;              // 0 = same camera distance for all concepts (true relative size), 1 = fit each tightly.
const REFERENCE_FRAMING_RADIUS = 3.7;    // Bounding radius used as the fixed reference when FRAMING_BLEND < 1.
const FRAMING_MARGIN = 1.12;             // >1 leaves breathing room around the model.
const VIEW_TRANSITION_SEC = 0.6;         // Camera glide time between preset views.
const AUTO_ROTATE_RAD_PER_SEC = 0.45;    // Turntable speed. Slow on purpose: inspection, not spin simulation.
const PRESET_BREAK_ANGLE_RAD = 0.03;    // Orbiting further than this away from a preset view switches the mode to FREE.
const REFERENCE_RING_DIAMETER = 6;       // Faint floor ring to compare sizes across concepts (same units as models).
const FLOOR_RADIUS = 16;
// ------------------------------------------------

export type ViewMode = 'top' | 'diagonal' | 'side' | 'below' | 'free';

interface CameraTween {
  fromOffset: THREE.Spherical;
  toOffset: THREE.Spherical;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
  t: number;
}

export class ConceptViewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;

  private readonly turntable = new THREE.Group();
  private readonly floor: THREE.Mesh<THREE.CircleGeometry, THREE.MeshStandardMaterial>;
  private readonly guides = new THREE.Group();
  private readonly silhouetteMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });
  private lastFrameMs = performance.now();

  private current: BuiltConcept | null = null;
  private framing = { target: new THREE.Vector3(0, 1.5, 0), distance: 12 };
  private tween: CameraTween | null = null;
  /** Camera direction (target -> camera) of the active preset view; null in FREE. */
  private presetDirection: THREE.Vector3 | null = null;
  private mode: ViewMode = 'diagonal';
  private autoRotate = true;
  private silhouette = false;
  private readonly modeListeners: Array<(mode: ViewMode) => void> = [];

  constructor(canvas: HTMLCanvasElement, private readonly stage: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setClearColor(0x000000, 0);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.4;
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(CAMERA_FOV_DEG, 1, 0.05, 200);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.minDistance = 3;
    this.controls.maxDistance = 45;
    this.controls.minPolarAngle = 0;
    this.controls.maxPolarAngle = Math.PI; // allow orbiting under the floor to inspect tips
    // Any drag cancels a running preset glide. Rotating away from a preset
    // switches to FREE (checked per frame); zoom/pan alone keep the preset.
    this.controls.addEventListener('start', () => {
      this.tween = null;
    });

    this.addLights();
    this.floor = this.addFloor();
    this.addGuides();
    this.scene.add(this.turntable);

    new ResizeObserver(() => this.resize()).observe(stage);
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  onModeChange(listener: (mode: ViewMode) => void): void {
    this.modeListeners.push(listener);
  }

  get viewMode(): ViewMode {
    return this.mode;
  }

  get isAutoRotating(): boolean {
    return this.autoRotate;
  }

  get isSilhouette(): boolean {
    return this.silhouette;
  }

  /** True when no preset camera glide is running (used by screenshot automation). */
  get isSettled(): boolean {
    return this.tween === null;
  }

  get measurements(): ConceptMeasurements | null {
    return this.current?.measurements ?? null;
  }

  showConcept(definition: ConceptDefinition): ConceptMeasurements {
    if (this.current) {
      this.turntable.remove(this.current.root);
      this.current.dispose();
    }
    this.current = assembleConcept(definition);
    this.turntable.rotation.y = 0;
    this.turntable.add(this.current.root);
    this.computeFraming();
    if (this.mode === 'free') {
      // Keep the user's orbit direction, just re-center and re-scale.
      const offset = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target));
      offset.radius = this.framing.distance;
      this.startTween(offset, this.framing.target);
    } else {
      this.setView(this.mode);
    }
    return this.current.measurements;
  }

  setView(mode: ViewMode): void {
    this.setModeInternal(mode);
    if (mode === 'free') {
      this.presetDirection = null;
      return; // free = keep camera where it is, orbit/zoom by hand
    }
    const d = this.framing.distance;
    const offset = new THREE.Spherical(d, 0, 0);
    switch (mode) {
      case 'top':
        offset.phi = TOP_POLAR_EPSILON_RAD;
        offset.theta = 0;
        break;
      case 'diagonal':
        offset.phi = THREE.MathUtils.degToRad(90 - DIAGONAL_ELEVATION_DEG);
        offset.theta = THREE.MathUtils.degToRad(DIAGONAL_AZIMUTH_DEG);
        break;
      case 'side':
        offset.phi = THREE.MathUtils.degToRad(90 - SIDE_ELEVATION_DEG);
        offset.theta = 0;
        break;
      case 'below':
        offset.phi = THREE.MathUtils.degToRad(90 - BELOW_ELEVATION_DEG);
        offset.theta = THREE.MathUtils.degToRad(DIAGONAL_AZIMUTH_DEG);
        break;
    }
    this.presetDirection = new THREE.Vector3().setFromSpherical(offset).normalize();
    this.startTween(offset, this.framing.target);
  }

  setAutoRotate(on: boolean): void {
    this.autoRotate = on;
  }

  setSilhouette(on: boolean): void {
    this.silhouette = on;
    this.scene.overrideMaterial = on ? this.silhouetteMaterial : null;
    this.floor.visible = !on;
    this.guides.visible = !on;
    this.stage.classList.toggle('is-silhouette', on);
  }

  // ---------------- internals ----------------

  private setModeInternal(mode: ViewMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.modeListeners.forEach((l) => l(mode));
  }

  private computeFraming(): void {
    if (!this.current) return;
    const box = new THREE.Box3().setFromObject(this.current.root);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const radius = THREE.MathUtils.lerp(REFERENCE_FRAMING_RADIUS, sphere.radius, FRAMING_BLEND);
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    const fov = Math.min(vFov, hFov);
    this.framing = {
      target: new THREE.Vector3(0, sphere.center.y, 0),
      distance: (radius * FRAMING_MARGIN) / Math.sin(fov / 2),
    };
  }

  private startTween(toOffset: THREE.Spherical, toTarget: THREE.Vector3): void {
    const fromOffset = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target));
    // Take the short way around in azimuth.
    let dTheta = toOffset.theta - fromOffset.theta;
    dTheta = Math.atan2(Math.sin(dTheta), Math.cos(dTheta));
    const target = toOffset.clone();
    target.theta = fromOffset.theta + dTheta;
    this.tween = { fromOffset, toOffset: target, fromTarget: this.controls.target.clone(), toTarget: toTarget.clone(), t: 0 };
  }

  private frame(): void {
    const now = performance.now();
    const dt = Math.min((now - this.lastFrameMs) / 1000, 0.1);
    this.lastFrameMs = now;
    if (this.autoRotate) this.turntable.rotation.y += AUTO_ROTATE_RAD_PER_SEC * dt;

    if (this.tween) {
      const tw = this.tween;
      tw.t = Math.min(1, tw.t + dt / VIEW_TRANSITION_SEC);
      const e = tw.t < 0.5 ? 4 * tw.t ** 3 : 1 - (-2 * tw.t + 2) ** 3 / 2;
      const s = new THREE.Spherical(
        THREE.MathUtils.lerp(tw.fromOffset.radius, tw.toOffset.radius, e),
        THREE.MathUtils.lerp(tw.fromOffset.phi, tw.toOffset.phi, e),
        THREE.MathUtils.lerp(tw.fromOffset.theta, tw.toOffset.theta, e),
      );
      this.controls.target.lerpVectors(tw.fromTarget, tw.toTarget, e);
      this.camera.position.setFromSpherical(s).add(this.controls.target);
      this.camera.lookAt(this.controls.target);
      if (tw.t >= 1) this.tween = null;
    } else {
      this.controls.update();
      if (this.presetDirection && this.mode !== 'free') {
        const dir = this.camera.position.clone().sub(this.controls.target).normalize();
        if (dir.angleTo(this.presetDirection) > PRESET_BREAK_ANGLE_RAD) {
          this.presetDirection = null;
          this.setModeInternal('free');
        }
      }
    }

    // Fade the floor out when looking from underneath so tips stay visible.
    const below = this.camera.position.y < 0;
    this.floor.material.opacity = below ? 0.12 : 1;
    this.guides.visible = !this.silhouette && !below;

    this.renderer.render(this.scene, this.camera);
  }

  private resize(): void {
    const w = Math.max(1, this.stage.clientWidth);
    const h = Math.max(1, this.stage.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.current) {
      this.computeFraming();
      if (this.mode !== 'free' && !this.tween) this.setView(this.mode);
    }
  }

  private addLights(): void {
    this.scene.add(new THREE.HemisphereLight(0xc4d6ff, 0x08090d, 0.4));

    const key = new THREE.DirectionalLight(0xffffff, 1.9);
    key.position.set(6, 8, 8);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -7;
    key.shadow.camera.right = 7;
    key.shadow.camera.top = 7;
    key.shadow.camera.bottom = -7;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 30;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    key.shadow.radius = 4;
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0x9fb6ff, 0.65);
    fill.position.set(-8, 3, 5);
    this.scene.add(fill);

    const rim = new THREE.DirectionalLight(0xdce8ff, 1.8);
    rim.position.set(-3, 5, -9);
    this.scene.add(rim);

    // Weak under-light so the underside/tip isn't pitch black when orbiting below.
    const under = new THREE.DirectionalLight(0x8494b8, 0.45);
    under.position.set(1, -8, 3);
    this.scene.add(under);
  }

  private addFloor(): THREE.Mesh<THREE.CircleGeometry, THREE.MeshStandardMaterial> {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const g = canvas.getContext('2d');
    if (g) {
      const gradient = g.createRadialGradient(128, 128, 0, 128, 128, 128);
      gradient.addColorStop(0, '#ffffff');
      gradient.addColorStop(0.45, '#bbbbbb');
      gradient.addColorStop(1, '#000000');
      g.fillStyle = gradient;
      g.fillRect(0, 0, 256, 256);
    }
    const material = new THREE.MeshStandardMaterial({
      color: 0x0b0e14,
      roughness: 0.9,
      metalness: 0,
      transparent: true,
      alphaMap: new THREE.CanvasTexture(canvas),
      depthWrite: false,
    });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(FLOOR_RADIUS, 96).rotateX(-Math.PI / 2), material);
    floor.receiveShadow = true;
    floor.renderOrder = -1;
    this.scene.add(floor);
    return floor;
  }

  private addGuides(): void {
    const r = REFERENCE_RING_DIAMETER / 2;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(r - 0.012, r + 0.012, 160).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x33415a, transparent: true, opacity: 0.8, depthWrite: false }),
    );
    ring.position.y = 0.003;
    const cross = new THREE.Mesh(
      new THREE.RingGeometry(0.0, 0.05, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x33415a, depthWrite: false }),
    );
    cross.position.y = 0.003;
    this.guides.add(ring, cross);
    this.scene.add(this.guides);
  }
}

export const VIEWER_REFERENCE_RING_DIAMETER = REFERENCE_RING_DIAMETER;
