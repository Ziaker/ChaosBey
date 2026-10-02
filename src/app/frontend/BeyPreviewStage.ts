// ============================================================
// BEY PREVIEW STAGE — THE ROTATING 3D BEY ON CHARACTER SELECT (M10)
// Draws the focused Bey spinning on a small lit pedestal, on the game's
// canvas, behind the select screen's panels. The model comes from the same
// resolution the match scene uses (beyVisualDefinitionFor, with the page's
// presentation flags), so the Bey on the pedestal is the Bey that fights:
// the approved concept in the normal game, the legacy placeholder with
// `newBeyVisuals` off. Render-only: no physics world, no simulation, no
// gameplay definition touched. Owns its render loop while shown.
// ============================================================

import * as THREE from 'three';
import type { AppRenderer } from '../bootstrap/createRenderer';
import type { BeyDefinition } from '../../bey/archetype/BeyDefinition';
import type { BeyVisual } from '../../bey/procedural-model/createBeyMesh';
import { beyVisualDefinitionFor } from '../../bey/visual/approvedBeyVisuals';
import { presentationFeaturesFromLocation, type PresentationFeatures } from '../../presentation/features';

/** Visual spin of the preview (rad/s): readable, not a blur. */
const PREVIEW_SPIN_RAD_S = 9;
/** Slow orbit of the whole stage (rad/s), so the silhouette reads from every side. */
const PREVIEW_TURNTABLE_RAD_S = 0.35;
const PREVIEW_WOBBLE_RAD = 0.035;

export class BeyPreviewStage {
  private readonly root = new THREE.Group();
  private readonly turntable = new THREE.Group();
  private readonly rimLight = new THREE.PointLight(0xffffff, 12, 6);
  private visual: BeyVisual | null = null;
  private visualId: string | null = null;
  private rafHandle: number | null = null;
  private lastFrameMs: number | null = null;
  private elapsedS = 0;
  private readonly savedCamera: { position: THREE.Vector3; quaternion: THREE.Quaternion; fov: number };

  constructor(
    private readonly appRenderer: AppRenderer,
    /** The flags the match will be created with (the page's, as MatchSession reads them). */
    private readonly features: PresentationFeatures = presentationFeaturesFromLocation(),
  ) {
    const { camera } = appRenderer;
    this.savedCamera = { position: camera.position.clone(), quaternion: camera.quaternion.clone(), fov: camera.fov };

    this.root.name = 'bey-preview-stage';
    this.root.add(new THREE.HemisphereLight(0x9fb4ff, 0x0a0a12, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(2, 4, 3);
    this.root.add(key);
    this.rimLight.position.set(-1.6, 1.2, -1.4);
    this.root.add(this.rimLight);

    const pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(1.25, 1.4, 0.12, 64),
      new THREE.MeshStandardMaterial({ color: 0x1a1f2c, metalness: 0.7, roughness: 0.35 }),
    );
    pedestal.position.y = -0.06;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.3, 0.015, 8, 96),
      new THREE.MeshBasicMaterial({ color: 0x6ee7ff, transparent: true, opacity: 0.6 }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.005;
    this.turntable.add(pedestal, ring);
    this.root.add(this.turntable);
    appRenderer.scene.add(this.root);
  }

  /** Shows `definition`'s Bey, replacing the one on the pedestal. */
  show(definition: BeyDefinition, accentHex: number): void {
    if (this.visual) {
      this.turntable.remove(this.visual.group);
      disposeObject(this.visual.group);
    }
    const visualDefinition = beyVisualDefinitionFor(definition, this.features);
    this.visual = visualDefinition.create(definition);
    this.visualId = visualDefinition.id;
    // The mesh is anchored at the body's centre (tip at the collider's bottom), so lift it onto the pedestal.
    this.visual.group.position.y = definition.physical.colliderHalfHeightM;
    this.turntable.add(this.visual.group);
    this.rimLight.color.setHex(accentHex);
  }

  /** Id of the visual on the pedestal (e.g. `concept:attack-a`), or null before the first show. */
  get shownVisualId(): string | null {
    return this.visualId;
  }

  start(): void {
    if (this.rafHandle !== null) return;
    this.lastFrameMs = null;
    this.rafHandle = requestAnimationFrame(this.frame);
  }

  stop(): void {
    if (this.rafHandle !== null) cancelAnimationFrame(this.rafHandle);
    this.rafHandle = null;
  }

  /** Stops, removes everything it added and restores the camera. */
  dispose(): void {
    this.stop();
    this.appRenderer.scene.remove(this.root);
    disposeObject(this.root);
    this.visual = null;
    this.visualId = null;
    const { camera } = this.appRenderer;
    camera.position.copy(this.savedCamera.position);
    camera.quaternion.copy(this.savedCamera.quaternion);
    camera.fov = this.savedCamera.fov;
    camera.updateProjectionMatrix();
  }

  private readonly frame = (nowMs: number): void => {
    const dt = this.lastFrameMs === null ? 0 : Math.min((nowMs - this.lastFrameMs) / 1000, 0.1);
    this.lastFrameMs = nowMs;
    this.elapsedS += dt;

    this.turntable.rotation.y += PREVIEW_TURNTABLE_RAD_S * dt;
    if (this.visual) {
      this.visual.spinGroup.rotation.y += PREVIEW_SPIN_RAD_S * dt;
      this.visual.group.rotation.x = Math.sin(this.elapsedS * 2.1) * PREVIEW_WOBBLE_RAD;
      this.visual.group.rotation.z = Math.cos(this.elapsedS * 2.1) * PREVIEW_WOBBLE_RAD;
    }

    this.frameCamera();
    this.appRenderer.render();
    this.rafHandle = requestAnimationFrame(this.frame);
  };

  /**
   * Three-quarter view of the pedestal. On a wide screen the Bey sits right
   * of centre, clear of the side panel; on a tall one it sits in the top
   * part, above the panel.
   */
  private frameCamera(): void {
    const { camera } = this.appRenderer;
    const wide = camera.aspect >= 1.2;
    const lookX = wide ? -1.35 : 0;
    const lookY = wide ? 0.05 : -1.1;
    camera.fov = wide ? 38 : 50;
    camera.position.set(lookX, 2.1, 5.2);
    camera.lookAt(lookX, lookY, 0);
    camera.updateProjectionMatrix();
  }
}

function disposeObject(object: THREE.Object3D): void {
  object.traverse((node) => {
    const mesh = node as THREE.Mesh;
    mesh.geometry?.dispose();
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(material)) material.forEach((m) => m.dispose());
    else material?.dispose();
  });
}
