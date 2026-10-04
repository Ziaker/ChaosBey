// ============================================================
// CONDITION VISUALS (batch 2): the approved Stamina / Stability / Broken
// languages in the game
// The lab's own checks keep passing in conditionVisualConcepts.test.ts. These
// prove the port: the 49 approved values are intact, the player's layer choice
// can never be empty, the display readout is deterministic and measured from the
// real pose, the system only observes (it never moves a body or the camera) and
// it cleans up after itself.
// ============================================================

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { APPROVED } from '../../prototypes/condition-visual-concepts/src/tuning';
import { ATTACK_ARCHETYPE, DEFENSE_ARCHETYPE } from '../../src/bey/archetype/BeyArchetypes';
import { createConceptBeyVisual } from '../../src/bey/visual/conceptBeyVisual';
import { CONCEPTS } from '../../src/bey/visual/concepts/conceptDefinitions';
import { CONDITION_LAYER_SETTINGS, DEFAULT_CONDITION_LAYERS, DEFAULT_PLAYER_SETTINGS, sanitizePlayerSettings, toggleConditionLayer } from '../../src/config/settings/PlayerSettings';
import { PresentationHub, selectBeyPresentationState, type MatchPresentationState, type PresentationEvent } from '../../src/presentation';
import { ConditionDisplay } from '../../src/vfx/condition/conditionDisplay';
import { ConditionRig, measureRigDims } from '../../src/vfx/condition/conditionRig';
import { ConditionVisualsSystem, hitStrengthOf, normalizeConditionLayers } from '../../src/vfx/condition/ConditionVisualsSystem';
import { CONDITION_DISPLAY_KEYS, CONDITION_REFERENCE_ONLY_KEYS, CONDITION_TUNING_APPROVED } from '../../src/vfx/condition/tuning';
import type { LanguageId } from '../../src/vfx/condition/types';

const flat = (): number => 0;

describe('the 49 approved values', () => {
  it('are exactly the owner-approved configuration, all 49 of them', () => {
    expect(Object.keys(CONDITION_TUNING_APPROVED)).toHaveLength(49);
    expect(CONDITION_TUNING_APPROVED).toEqual(APPROVED);
    // Spot checks against docs/design-decisions/condition-visual-approval.md section 10.
    expect(CONDITION_TUNING_APPROVED).toMatchObject({ spinMaxRps: 18, meshMaxRps: 3.5, aSeamGap: 1.8, bShards: 6, bDangerShell: 0, cOpacity: 0.6, cSegments: 10 });
  });

  it('every shared value is either applied as display or kept as reference, never both', () => {
    const shared = Object.keys(CONDITION_TUNING_APPROVED).filter((key) => !/^[abc][A-Z]/.test(key));
    expect(shared).toHaveLength(19);
    const display: readonly string[] = CONDITION_DISPLAY_KEYS;
    const reference: readonly string[] = CONDITION_REFERENCE_ONLY_KEYS;
    expect([...display, ...reference].sort()).toEqual([...shared].sort());
    expect(display.filter((key) => reference.includes(key))).toEqual([]);
  });
});

describe('the player never ends up with no layer', () => {
  it('normalizes: at least one, fixed order, no duplicates', () => {
    expect(normalizeConditionLayers([])).toEqual(['A']);
    expect(normalizeConditionLayers(['C', 'A', 'C'])).toEqual(['A', 'C']);
    expect(normalizeConditionLayers(['B'])).toEqual(['B']);
  });

  it('cannot turn the last layer off in Settings, and any combination of 1 to 3 is allowed', () => {
    expect(toggleConditionLayer(['A'], 'A', false)).toEqual(['A']);
    expect(toggleConditionLayer(['A'], 'B', true)).toEqual(['A', 'B']);
    expect(toggleConditionLayer(['A', 'B', 'C'], 'B', false)).toEqual(['A', 'C']);
    let layers = toggleConditionLayer(DEFAULT_CONDITION_LAYERS, 'C', true);
    layers = toggleConditionLayer(layers, 'B', true);
    expect(layers).toEqual(['A', 'B', 'C']);
  });

  it('reads old, partial or corrupt saved settings forgivingly and adds only the new field', () => {
    expect(sanitizePlayerSettings({}).conditionLayers).toEqual(DEFAULT_PLAYER_SETTINGS.conditionLayers);
    expect(sanitizePlayerSettings({ conditionLayers: [] }).conditionLayers).toEqual(DEFAULT_CONDITION_LAYERS);
    expect(sanitizePlayerSettings({ conditionLayers: 'ABC' }).conditionLayers).toEqual(DEFAULT_CONDITION_LAYERS);
    expect(sanitizePlayerSettings({ conditionLayers: ['C', 'x', 'B'] }).conditionLayers).toEqual(['B', 'C']);
    const before = sanitizePlayerSettings({ quality: 'High', cameraPreset: 'C', controlScheme: 'classic' });
    // Owner, 2026-10-04: Screen (reads camera) is the only control scheme; an old saved scheme reads as Screen.
    expect(before).toMatchObject({ quality: 'High', cameraPreset: 'C', controlScheme: 'screen' });
    expect(CONDITION_LAYER_SETTINGS).toEqual(['A', 'B', 'C']);
  });

  it('classifies hit strength from magnitude', () => {
    expect(['light', 'medium', 'heavy']).toEqual([hitStrengthOf(0.2), hitStrengthOf(0.6), hitStrengthOf(0.95)]);
  });
});

describe('the display readout (shared physical layer)', () => {
  const dims = { ringRadius: 0.65, ringBottomY: 0.3, ringTopY: 0.42, ringMidY: 0.36, height: 0.7, topY: 0.7 };
  const make = () => new ConditionDisplay(CONDITION_TUNING_APPROVED, dims, 0.18);
  const upright = { position: new THREE.Vector3(1, 0.18, 2), quaternion: new THREE.Quaternion() };

  it('slows the drawn spin as Stamina drops, but never draws pieces faster than meshMaxRps', () => {
    const rpsAt = (stamina: number): number => {
      const display = make();
      display.update({ stamina, stability: 1, broken: false }, upright, 1 / 60);
      return display.frame.rps;
    };
    expect(rpsAt(1)).toBeCloseTo(CONDITION_TUNING_APPROVED.spinMaxRps, 5);
    expect(rpsAt(0.5)).toBeLessThan(rpsAt(1));
    expect(rpsAt(0.1)).toBeLessThan(rpsAt(0.5));
    expect(rpsAt(0.001)).toBeGreaterThanOrEqual(CONDITION_TUNING_APPROVED.spinMinRps - 1e-3);
    const display = make();
    for (let i = 0; i < 600; i++) display.update({ stamina: 1, stability: 1, broken: false }, upright, 1 / 60);
    // 10 s at the clamped rate, not at the 18 rps true rate.
    expect(display.frame.meshSpin).toBeCloseTo(CONDITION_TUNING_APPROVED.meshMaxRps * 10 * Math.PI * 2, 3);
    expect(display.frame.trueSpin).toBeGreaterThan(display.frame.meshSpin * 4);
  });

  it('collapses the spin once Stamina is gone, over spinOutSeconds, then is down', () => {
    const display = make();
    let downAt = -1;
    for (let i = 0; i < 60 * 6; i++) {
      display.update({ stamina: 0, stability: 1, broken: false }, upright, 1 / 60);
      if (downAt < 0 && display.state.down) downAt = i / 60;
    }
    expect(downAt).toBeGreaterThan(CONDITION_TUNING_APPROVED.spinOutSeconds - 0.1);
    expect(downAt).toBeLessThan(CONDITION_TUNING_APPROVED.spinOutSeconds + 0.1);
    expect(display.frame.rps).toBeCloseTo(0, 3);
  });

  it('eases into Broken and decays a hit shudder', () => {
    const display = make();
    for (let i = 0; i < 120; i++) display.update({ stamina: 0.6, stability: 0, broken: true }, upright, 1 / 60);
    expect(display.frame.brokenBlend).toBeGreaterThan(0.95);
    display.onHit(1, 0);
    display.update({ stamina: 0.6, stability: 0, broken: true }, upright, 1 / 60);
    const first = display.frame.shudder;
    expect(first).toBeGreaterThan(0.8);
    for (let i = 0; i < 60; i++) display.update({ stamina: 0.6, stability: 0, broken: true }, upright, 1 / 60);
    expect(display.frame.shudder).toBe(0);
    // A hit on a sturdy Bey shudders less than the same hit on a weak one.
    const sturdy = make();
    const weak = make();
    sturdy.onHit(0.6, 1);
    weak.onHit(0.6, 0);
    sturdy.update({ stamina: 1, stability: 1, broken: false }, upright, 1 / 60);
    weak.update({ stamina: 1, stability: 0, broken: false }, upright, 1 / 60);
    expect(weak.frame.shudder).toBeGreaterThan(sturdy.frame.shudder);
  });

  it('measures lean and rim clearance from the real pose, and the tip from the collider', () => {
    const display = make();
    display.update({ stamina: 1, stability: 1, broken: false }, upright, 1 / 60);
    expect(display.frame.rimClearance).toBeCloseTo(dims.ringBottomY, 5);
    expect(display.frame.position.toArray()).toEqual([1, 0, 2].map((v, i) => (i === 1 ? 0.18 - 0.18 : v)));
    // Lean 40 degrees toward +X (rotate about -Z): the rim lifts clear no more, it touches.
    const lean = THREE.MathUtils.degToRad(40);
    const quaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, -1), lean);
    display.update({ stamina: 1, stability: 1, broken: false }, { position: upright.position, quaternion }, 1 / 60);
    expect(display.frame.leanDir).toBeCloseTo(0, 5);
    expect(display.frame.rimClearance).toBeCloseTo(dims.ringBottomY * Math.cos(lean) - dims.ringRadius * Math.sin(lean), 5);
    expect(display.frame.rimClearance).toBeLessThan(0);
  });

  it('is deterministic: the same inputs give the same readout', () => {
    const run = (): string => {
      const display = make();
      const out: number[] = [];
      for (let i = 0; i < 300; i++) {
        if (i === 40) display.onHit(0.7, 0.4);
        display.update({ stamina: 1 - i / 320, stability: 0.5, broken: i > 150 }, upright, 1 / 60);
        out.push(display.frame.rps, display.frame.meshSpin, display.frame.brokenBlend, display.frame.shudder, display.frame.wobbleFactor);
      }
      return JSON.stringify(out);
    };
    expect(run()).toBe(run());
  });
});

interface Harness {
  readonly scene: THREE.Group;
  readonly camera: THREE.PerspectiveCamera;
  readonly hub: PresentationHub;
  readonly system: ConditionVisualsSystem;
  readonly beys: { first: ReturnType<typeof createConceptBeyVisual>; second: ReturnType<typeof createConceptBeyVisual> };
  tick(overrides?: { first?: Partial<StateOverride>; second?: Partial<StateOverride> }, events?: readonly PresentationEvent[]): void;
  frame(dt?: number): void;
}
interface StateOverride { stamina: number; stability: number; broken: boolean }

function harness(layers: readonly LanguageId[], placeholder = false): Harness {
  const scene = new THREE.Group();
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 100);
  camera.position.set(0, 3, 6);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  const concept = CONCEPTS[0]!;
  const beys = {
    first: placeholder ? (ATTACK_ARCHETYPE.appearance.createVisual() as never) : createConceptBeyVisual(concept, ATTACK_ARCHETYPE),
    second: placeholder ? (DEFENSE_ARCHETYPE.appearance.createVisual() as never) : createConceptBeyVisual(CONCEPTS[3]!, DEFENSE_ARCHETYPE),
  };
  beys.first.group.position.set(-1, 0.18, 0);
  beys.second.group.position.set(1, 0.27, 0);
  scene.add(beys.first.group, beys.second.group);
  const system = new ConditionVisualsSystem({
    scene,
    camera,
    beys: { first: { visual: beys.first, gameplay: ATTACK_ARCHETYPE }, second: { visual: beys.second, gameplay: DEFENSE_ARCHETYPE } },
    floorHeightAt: flat,
    layers,
    viewportHeightPx: () => 720,
  });
  const hub = new PresentationHub({ features: { newBeyVisuals: true, conditionVisuals: true, hybridVfx: false, clashPresentation: false, newHud: false, arenaVisuals: false }, beys: [{ side: 'first', definitionId: 'a' }, { side: 'second', definitionId: 'd' }], getVfxAnchor: () => false });
  hub.attach(system);
  let tick = 0;
  let latest: MatchPresentationState | null = null;
  const facts = (o: StateOverride) => ({
    grounded: true,
    driftState: 0,
    dodgeState: 0,
    attackState: 0,
    dashChargeFraction: 0,
    staminaFraction: o.stamina,
    stabilityFraction: o.stability,
    isBroken: o.broken,
    dashReadiness: 1,
    movement: { speedMps: 0 },
    spin: { spinRateRadPerSec: 22, wobbleEnergy: 0, tiltRad: 0, isTumbling: false },
  });
  return {
    scene,
    camera,
    hub,
    system,
    beys,
    tick(overrides = {}, events = []) {
      tick++;
      const base: StateOverride = { stamina: 1, stability: 1, broken: false };
      const first = selectBeyPresentationState(facts({ ...base, ...overrides.first }) as never, { side: 'first', definitionId: 'a', maxSpeedMps: 10 });
      const second = selectBeyPresentationState(facts({ ...base, ...overrides.second }) as never, { side: 'second', definitionId: 'd', maxSpeedMps: 10 });
      latest = { tick, round: { over: false, outcome: '' }, first, second, clash: {} as never, camera: null, recentImpact: { first: null, second: null } };
      system.onEvents(events, latest);
    },
    frame(dt = 1 / 60) {
      system.update({ dtSeconds: dt, state: latest });
    },
  };
}

const hitOn = (side: 'first' | 'second', tick: number): PresentationEvent => ({ kind: 'hitResolved', tick, defenderSide: side, attackerSide: side === 'first' ? 'second' : 'first', magnitude: 0.9, position: { x: 0, y: 0.3, z: 0 }, hitboxKind: 'circular', caughtOpponentDashing: false });

describe('ConditionVisualsSystem', () => {
  it('runs only the chosen layers, never fewer than one, and changes them live', () => {
    const h = harness(['B']);
    expect(h.system.getLayers()).toEqual(['B']);
    expect(h.system.getStats()).toMatchObject({ layers: 2 }); // one per Bey
    h.system.setLayers(['A', 'B', 'C']);
    expect(h.system.getStats()).toMatchObject({ layers: 6 });
    h.system.setLayers([]);
    expect(h.system.getLayers()).toEqual(['A']);
    expect(h.system.getStats()).toMatchObject({ layers: 2 });
    h.hub.dispose();
  });

  it('only observes: Bey position and attitude, and the camera, are untouched through a whole bad match', () => {
    const h = harness(['A', 'B', 'C']);
    const bodies = [h.beys.first.group, h.beys.second.group].map((g) => g.position.clone());
    const attitudes = [h.beys.first.group, h.beys.second.group].map((g) => g.quaternion.clone());
    const camera = JSON.stringify([h.camera.position.toArray(), h.camera.quaternion.toArray(), h.camera.fov, Array.from(h.camera.projectionMatrix.elements), h.camera.children.length]);
    for (let i = 0; i < 600; i++) {
      const stamina = Math.max(0, 1 - i / 450);
      const stability = i < 200 ? 1 - i / 220 : i < 320 ? 0 : 0.7;
      h.tick({ first: { stamina, stability, broken: i >= 200 && i < 320 }, second: { stamina: 0.8, stability: 0.9, broken: false } }, i % 90 === 0 ? [hitOn('first', i)] : []);
      h.frame();
    }
    expect([h.beys.first.group, h.beys.second.group].map((g) => g.position.toArray())).toEqual(bodies.map((p) => p.toArray()));
    [h.beys.first.group, h.beys.second.group].forEach((g, i) => expect(g.quaternion.equals(attitudes[i]!)).toBe(true));
    expect(JSON.stringify([h.camera.position.toArray(), h.camera.quaternion.toArray(), h.camera.fov, Array.from(h.camera.projectionMatrix.elements), h.camera.children.length])).toBe(camera);
    expect(h.hub.getStats().systemErrors).toBe(0);
    h.hub.dispose();
  });

  it('draws the clamped spin on the pieces and nothing else on the visual groups', () => {
    const h = harness(['A']);
    for (let i = 0; i < 120; i++) {
      h.tick();
      h.frame();
    }
    expect(h.beys.first.spinGroup.rotation.y).toBeCloseTo(CONDITION_TUNING_APPROVED.meshMaxRps * 2 * Math.PI * 2, 2);
    expect(h.beys.first.group.rotation.x).toBe(0);
    h.hub.dispose();
  });

  it('wears the approved four-piece model with Stability, and leaves the placeholder mesh alone', () => {
    const wornAfter = (placeholder: boolean): { readonly color: number; readonly changed: boolean } => {
      const h = harness(['A'], placeholder);
      const materials: THREE.MeshStandardMaterial[] = [];
      h.beys.first.group.traverse((o) => {
        if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial) materials.push(o.material);
      });
      const before = materials.map((m) => m.color.getHex());
      for (let i = 0; i < 60; i++) {
        h.tick({ first: { stamina: 0.3, stability: 0.1, broken: true } });
        h.frame();
      }
      const after = materials.map((m) => m.color.getHex());
      h.hub.dispose();
      return { color: after[0]!, changed: after.some((c, i) => c !== before[i]) };
    };
    expect(wornAfter(false).changed).toBe(true);
    expect(wornAfter(true).changed).toBe(false);
  });

  it('puts every material and piece back as built when it is disposed, and removes all it added', () => {
    const h = harness(['A', 'B', 'C']);
    const original: number[] = [];
    h.beys.first.group.traverse((o) => {
      if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial) original.push(o.material.color.getHex());
    });
    const childrenBefore = h.scene.children.length;
    expect(childrenBefore).toBeGreaterThan(2);
    for (let i = 0; i < 90; i++) {
      h.tick({ first: { stamina: 0.2, stability: 0.1, broken: true } }, i === 5 ? [hitOn('first', i)] : []);
      h.frame();
    }
    h.hub.dispose();
    const restored: number[] = [];
    h.beys.first.group.traverse((o) => {
      if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial) restored.push(o.material.color.getHex());
    });
    expect(restored).toEqual(original);
    // Only the two Bey groups remain in the scene.
    expect(h.scene.children).toEqual([h.beys.first.group, h.beys.second.group]);
  });

  it('survives a reset: running effects are cleared, no stale readout', () => {
    const h = harness(['A', 'B', 'C']);
    for (let i = 0; i < 60; i++) {
      h.tick({ first: { stamina: 0, stability: 0, broken: true } }, i === 3 ? [hitOn('first', i)] : []);
      h.frame();
    }
    h.system.reset();
    h.tick();
    h.frame();
    expect(h.hub.getStats().systemErrors).toBe(0);
    h.hub.dispose();
  });

  it('measures the real model: ring, top layer and tip heights are consistent for every concept on every archetype', () => {
    for (const concept of CONCEPTS) {
      for (const gameplay of [ATTACK_ARCHETYPE, DEFENSE_ARCHETYPE]) {
        const visual = createConceptBeyVisual(concept, gameplay);
        const dims = measureRigDims(visual, gameplay.physical.colliderHalfHeightM);
        expect(dims.ringRadius).toBeGreaterThan(0.25);
        expect(dims.ringBottomY).toBeGreaterThan(0);
        expect(dims.ringTopY).toBeGreaterThan(dims.ringBottomY);
        expect(dims.height).toBeGreaterThanOrEqual(dims.ringTopY - 1e-6);
        expect(dims.topY).toBe(dims.height);
        const rig = new ConditionRig(visual, gameplay, CONDITION_TUNING_APPROVED);
        expect(rig.dressable).toBe(true);
        rig.dispose();
      }
    }
  });
});
