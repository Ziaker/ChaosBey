// ============================================================
// CLASH PRESENTATION LAB — STAGE VIEW (renderer, browser-only)
// Owns the WebGL renderer, the approved arena-visual-concepts art (one of
// the three arenas, picked by the scenario) and the Clash FX group. Reuses
// the exact same arena.update({time, dt, clash}) / arena.flash() hooks
// the Arena Lab's own viewer uses, so the already-approved per-arena Clash
// light reaction (docs/design-decisions/visual-prototypes-approval.md) is
// the thing driving the lighting here too — this file never invents a new
// light reaction of its own. Everything DOM/canvas-dependent (arena
// textures) lives here, never in sim/ClashStageSim.ts, so the sim stays
// unit-testable in plain Node (see tests/unit/clashPresentationLab.test.ts).
// ============================================================

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { FOUNDRY_PIT } from '../../../arena-visual-concepts/src/arenas/foundryPit';
import { RIFT_CRATER } from '../../../arena-visual-concepts/src/arenas/riftCrater';
import { TOURNAMENT_STADIUM } from '../../../arena-visual-concepts/src/arenas/tournamentStadium';
import type { ArenaConcept, BuiltArena } from '../../../arena-visual-concepts/src/arenas/types';
import { ClashFx } from '../fx/ClashFx';
import type { ArenaId } from '../harness/scenarios';
import type { Vec3 } from '../../../camera-concepts/src/fight/FightFrame';

const ARENA_CONCEPTS: Readonly<Record<ArenaId, ArenaConcept>> = { foundry: FOUNDRY_PIT, rift: RIFT_CRATER, stadium: TOURNAMENT_STADIUM };
/** Flat depth so the visual bowl matches the lab's flat physics floor exactly — see ClashStageSim.ts's own note on the same limitation (the approved 3.2m bowl isn't integrated into the game's physics yet). */
const FLAT_ARENA_DEPTH_M = 0;

export class ClashStageView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 300);
  readonly fx = new ClashFx();
  private builtArena: BuiltArena | null = null;
  private currentArenaId: ArenaId | null = null;
  private beysGroup: THREE.Group | null = null;

  constructor(canvas: HTMLCanvasElement, private readonly stage: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.add(this.fx.group);
    new ResizeObserver(() => this.resize()).observe(stage);
    this.resize();
  }

  get arena(): BuiltArena | null {
    return this.builtArena;
  }

  get aspect(): number {
    return this.camera.aspect;
  }

  setArena(id: ArenaId): void {
    if (id === this.currentArenaId) return;
    if (this.builtArena) {
      this.scene.remove(this.builtArena.root);
      this.builtArena.dispose();
    }
    this.builtArena = ARENA_CONCEPTS[id].build(FLAT_ARENA_DEPTH_M);
    this.currentArenaId = id;
    this.scene.add(this.builtArena.root);
    this.scene.fog = this.builtArena.fog;
    this.scene.environmentIntensity = this.builtArena.environmentIntensity;
    this.renderer.toneMappingExposure = this.builtArena.exposure;
  }

  setBeyVisuals(group: THREE.Group): void {
    if (this.beysGroup) this.scene.remove(this.beysGroup);
    this.beysGroup = group;
    this.scene.add(group);
  }

  updateArena(timeS: number, dt: number, clash01: number): void {
    this.builtArena?.update({ time: timeS, dt, clash: clash01 });
  }

  flashAt(point: Vec3): void {
    if (this.builtArena) this.builtArena.flash(new THREE.Vector3(point.x, point.y, point.z));
  }

  get sparkColors(): readonly [number, number] {
    return this.builtArena?.sparkColors ?? [0xffe08a, 0xfff2cc];
  }

  applyCamera(eye: Vec3, focus: Vec3, fovDeg: number, shake: Vec3): void {
    this.camera.position.set(eye.x + shake.x, eye.y + shake.y, eye.z + shake.z);
    this.camera.lookAt(focus.x + shake.x * 0.4, focus.y + shake.y * 0.4, focus.z + shake.z * 0.4);
    this.camera.fov = fovDeg;
    this.camera.updateProjectionMatrix();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  private resize(): void {
    const w = Math.max(1, this.stage.clientWidth);
    const h = Math.max(1, this.stage.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    if (this.builtArena) this.builtArena.dispose();
    if (this.beysGroup) this.scene.remove(this.beysGroup);
    this.fx.dispose();
    this.renderer.dispose();
  }
}
