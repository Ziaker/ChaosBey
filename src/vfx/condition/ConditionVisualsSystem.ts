// ============================================================
// CONDITION VISUALS SYSTEM (conditionVisuals flag)
// The approved Stamina / Stability / Broken languages as one presentation
// system. It reads BeyPresentationState and the neutral presentation events,
// keeps one display readout and one rig per Bey, and runs the layers the
// player chose (1, 2 or 3 of A, B, C: never zero). The shared physical layer
// (display spin, blur shell, shudder) is always on while the system is.
//
// Hard limits, each covered by a test:
//   - observes only: no body, collider, stat, input or camera is written
//     (the camera object is READ to face billboards and scale particles);
//   - the physics attitude is never replaced: the lab's choreography for lean,
//     precession, knockback and spin-out is intentionally NOT ported — the real
//     SpinController and physics are the only movement authority;
//   - never imports the camera director, Rapier, the AI or gameplay.
// ============================================================

import * as THREE from 'three';
import type { BeyDefinition } from '../../bey/archetype/BeyDefinition';
import type { BeyVisual } from '../../bey/procedural-model/createBeyMesh';
import type { PresentationEvent, PresentationSide } from '../../presentation/events';
import type { PresentationFrame, PresentationSystem } from '../../presentation/hub';
import type { BeyPresentationState, MatchPresentationState } from '../../presentation/state';
import { ConditionDisplay } from './conditionDisplay';
import { ConditionRig } from './conditionRig';
import { InstrumentLayer } from './layers/instrument';
import { MechanicalLayer } from './layers/mechanical';
import { SpiritLayer } from './layers/spirit';
import { Particles } from './Particles';
import { CONDITION_TUNING_APPROVED, type ConditionTuning } from './tuning';
import { LANGUAGE_IDS, type ConditionEvent, type ConditionLayer, type HitStrength, type LanguageId, type LayerFrame, type LayerWorld } from './types';

export const CONDITION_SYSTEM_ID = 'condition-visuals';

/** Pooled particle capacity per blend mode, shared by both Beys (the lab's size). */
const PARTICLE_CAPACITY = 2600;
const MAX_FRAME_DT = 1 / 20;

export interface ConditionBeyTarget {
  readonly visual: BeyVisual;
  readonly gameplay: BeyDefinition;
}

export interface ConditionVisualsOptions {
  /** The session's scene root: everything this system draws is a child of it and goes away with it. */
  readonly scene: THREE.Object3D;
  /** Read-only: faces billboards and scales particles. Never written. */
  readonly camera: THREE.Camera;
  readonly beys: Readonly<Record<PresentationSide, ConditionBeyTarget>>;
  readonly floorHeightAt: (x: number, z: number) => number;
  /** Which of A, B, C to show. At least one; an empty list falls back to A. */
  readonly layers: readonly LanguageId[];
  readonly tuning?: ConditionTuning;
  /** Drawing-buffer height in pixels, for particle size. Defaults to the window. */
  readonly viewportHeightPx?: () => number;
  /** Owner, 2026-10-05: the Pregame's effects size (× on top of the Bey size, which the rig already follows). */
  readonly effectSize?: number;
}

const SIDES: readonly PresentationSide[] = ['first', 'second'];

const defaultViewportHeightPx = (): number => (typeof window === 'undefined' ? 720 : window.innerHeight * (window.devicePixelRatio || 1));

/** Never fewer than one layer (condition-visual-approval.md section 1). Order and duplicates are normalized. */
export function normalizeConditionLayers(layers: readonly LanguageId[]): readonly LanguageId[] {
  const picked = LANGUAGE_IDS.filter((id) => layers.includes(id));
  return picked.length > 0 ? picked : ['A'];
}

export function hitStrengthOf(magnitude: number): HitStrength {
  return magnitude < 0.45 ? 'light' : magnitude < 0.8 ? 'medium' : 'heavy';
}

interface BeyEntry {
  readonly side: PresentationSide;
  readonly target: ConditionBeyTarget;
  readonly display: ConditionDisplay;
  readonly rig: ConditionRig;
  readonly layers: Map<LanguageId, ConditionLayer>;
  readonly frame: LayerFrame;
  wasBroken: boolean;
  wasSpinningOut: boolean;
  wasDown: boolean;
  /** Stability as of the previous tick's state: the "before" of a hit. */
  stabilityBefore: number;
}

export class ConditionVisualsSystem implements PresentationSystem {
  readonly id = CONDITION_SYSTEM_ID;

  private readonly tuning: ConditionTuning;
  private readonly glow = new Particles(PARTICLE_CAPACITY, true);
  private readonly soft = new Particles(PARTICLE_CAPACITY, false);
  private readonly world: LayerWorld;
  private readonly entries: Record<PresentationSide, BeyEntry>;
  private wanted: readonly LanguageId[];
  private elapsedEvents = 0;
  private readonly worldPosition = new THREE.Vector3();
  private readonly worldQuaternion = new THREE.Quaternion();
  private readonly other = new THREE.Vector3();

  constructor(private readonly options: ConditionVisualsOptions) {
    this.tuning = options.tuning ?? CONDITION_TUNING_APPROVED;
    this.wanted = normalizeConditionLayers(options.layers);
    const { scene, camera, floorHeightAt } = options;
    this.world = {
      scene,
      camera,
      glow: this.glow,
      soft: this.soft,
      floorHeightAt,
      floorNormalAt: (x, z, out) => {
        const e = 0.05;
        return out.set(floorHeightAt(x - e, z) - floorHeightAt(x + e, z), 2 * e, floorHeightAt(x, z - e) - floorHeightAt(x, z + e)).normalize();
      },
    };
    scene.add(this.soft.points, this.glow.points);
    // Owner, 2026-10-05: particles follow the Bey size × the effects size (the rig's own pieces follow the model).
    this.glow.effectScale = this.soft.effectScale = (options.beys.first.gameplay.sizeScale ?? 1) * (options.effectSize ?? 1);
    this.entries = { first: this.buildEntry('first'), second: this.buildEntry('second') };
    for (const side of SIDES) this.syncLayers(this.entries[side]);
  }

  private buildEntry(side: PresentationSide): BeyEntry {
    const target = this.options.beys[side];
    const rig = new ConditionRig(target.visual, target.gameplay, this.tuning);
    this.options.scene.add(rig.root);
    const display = new ConditionDisplay(this.tuning, rig.dims, target.gameplay.physical.colliderHalfHeightM);
    return {
      side,
      target,
      display,
      rig,
      layers: new Map(),
      frame: { state: display.state, motion: display.frame, get time() { return display.state.time; } },
      wasBroken: false,
      wasSpinningOut: false,
      wasDown: false,
      stabilityBefore: 1,
    };
  }

  /** The layers now showing. */
  getLayers(): readonly LanguageId[] {
    return this.wanted;
  }

  /** Changes which layers show, live (the Settings screen). At least one stays on. */
  setLayers(layers: readonly LanguageId[]): void {
    this.wanted = normalizeConditionLayers(layers);
    for (const side of SIDES) this.syncLayers(this.entries[side]);
  }

  private syncLayers(entry: BeyEntry): void {
    for (const [id, layer] of entry.layers) {
      if (!this.wanted.includes(id)) {
        layer.dispose();
        entry.layers.delete(id);
      }
    }
    for (const id of this.wanted) {
      if (entry.layers.has(id)) continue;
      const ctx = { world: this.world, rig: entry.rig, tuning: this.tuning };
      entry.layers.set(id, id === 'A' ? new MechanicalLayer(ctx) : id === 'B' ? new SpiritLayer(ctx) : new InstrumentLayer(ctx));
    }
  }

  private dispatch(entry: BeyEntry, event: ConditionEvent): void {
    for (const layer of entry.layers.values()) layer.onEvent(event, entry.frame);
  }

  onEvents(events: readonly PresentationEvent[], state: MatchPresentationState): void {
    this.elapsedEvents += events.length;
    for (const event of events) {
      if (event.kind !== 'hitResolved') continue;
      const entry = this.entries[event.defenderSide];
      const attacker = event.attackerSide ? this.entries[event.attackerSide].target.visual.group.position : null;
      const me = entry.target.visual.group.position;
      // World angle (XZ) from the defender toward the attacker, or toward the contact point.
      this.other.set(attacker ? attacker.x : event.position.x, 0, attacker ? attacker.z : event.position.z);
      const dirAngle = Math.atan2(this.other.z - me.z, this.other.x - me.x);
      entry.display.onHit(event.magnitude, entry.stabilityBefore);
      this.dispatch(entry, { kind: 'hit', strength: hitStrengthOf(event.magnitude), magnitude: event.magnitude, dirAngle, stabilityBefore: entry.stabilityBefore });
    }
    // The "before" of the next tick's hit is this tick's Stability.
    for (const side of SIDES) this.entries[side].stabilityBefore = state[side].stability;
  }

  update(frame: PresentationFrame): void {
    const state = frame.state;
    if (!state) return;
    const dt = Math.min(MAX_FRAME_DT, Math.max(0, frame.dtSeconds));
    for (const side of SIDES) this.updateBey(this.entries[side], state[side], dt);
    const pxPerMeter = (this.options.viewportHeightPx ?? defaultViewportHeightPx)() * 0.5 * (this.options.camera as THREE.PerspectiveCamera).projectionMatrix.elements[5]!;
    if (Number.isFinite(pxPerMeter) && pxPerMeter > 0) {
      this.glow.setScale(pxPerMeter);
      this.soft.setScale(pxPerMeter);
    }
    this.glow.update(dt);
    this.soft.update(dt);
  }

  private readonly defeated = new Set<PresentationSide>();

  /** Owner, 2026-10-04: a destroyed Bey keeps none of its condition effects (spin blur, auras, floor instrument). */
  setDefeated(side: PresentationSide): void {
    this.defeated.add(side);
    const entry = this.entries[side];
    entry.rig.root.visible = false;
    this.dispatch(entry, { kind: 'reset' });
  }

  private updateBey(entry: BeyEntry, bey: BeyPresentationState, dt: number): void {
    if (this.defeated.has(entry.side)) return;
    const group = entry.target.visual.group;
    group.updateWorldMatrix(true, false);
    group.matrixWorld.decompose(this.worldPosition, this.worldQuaternion, this.other.set(1, 1, 1));
    entry.display.update({ stamina: bey.stamina, stability: bey.stability, broken: bey.broken }, { position: this.worldPosition, quaternion: this.worldQuaternion }, dt);
    const s = entry.display.state;

    // Edges of the condition, seen once each: the layers get the same events the lab's sim sent.
    if (bey.broken && !entry.wasBroken) this.dispatch(entry, { kind: 'break' });
    if (!bey.broken && entry.wasBroken) this.dispatch(entry, { kind: 'recover' });
    if (s.spinOut > 0 && !entry.wasSpinningOut) this.dispatch(entry, { kind: 'spinOut' });
    if (s.down && !entry.wasDown) this.dispatch(entry, { kind: 'down' });
    entry.wasBroken = bey.broken;
    entry.wasSpinningOut = s.spinOut > 0;
    entry.wasDown = s.down;

    entry.rig.update(entry.display.frame, this.worldQuaternion, dt);
    entry.rig.resetMods();
    for (const layer of entry.layers.values()) layer.update(entry.frame, dt);
    entry.rig.applyMods(entry.layers.has('A') ? this.tuning.aShudder : 0);
  }

  reset(): void {
    for (const side of SIDES) {
      const entry = this.entries[side];
      this.dispatch(entry, { kind: 'reset' });
      entry.display.reset();
      entry.rig.restoreModel();
      entry.wasBroken = false;
      entry.wasSpinningOut = false;
      entry.wasDown = false;
      entry.stabilityBefore = 1;
    }
    this.glow.clear();
    this.soft.clear();
  }

  getStats(): Readonly<Record<string, number>> {
    let layers = 0;
    for (const side of SIDES) layers += this.entries[side].layers.size;
    return { layers, eventsSeen: this.elapsedEvents };
  }

  dispose(): void {
    for (const side of SIDES) {
      const entry = this.entries[side];
      for (const layer of entry.layers.values()) layer.dispose();
      entry.layers.clear();
      entry.rig.dispose();
    }
    this.glow.points.removeFromParent();
    this.soft.points.removeFromParent();
    this.glow.dispose();
    this.soft.dispose();
  }
}

export function createConditionVisualsSystem(options: ConditionVisualsOptions): ConditionVisualsSystem {
  return new ConditionVisualsSystem(options);
}
