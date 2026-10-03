// ============================================================
// BEY VISUALS (batch 1): the ported four-piece concepts in the game
// The lab's own checks (prototypes/bey-visual-concepts) keep passing in
// beyVisualConcepts.test.ts. These prove the port: the nine concepts build in
// the game's scale and placement, stand on THIS Bey's collider, answer VFX
// anchors exactly, register as visuals without touching a gameplay definition,
// and the three archetypes get their provisional concept only when
// newBeyVisuals is on.
// ============================================================

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ATTACK_ARCHETYPE, DEFENSE_ARCHETYPE, STAMINA_ARCHETYPE } from '../../src/bey/archetype/BeyArchetypes';
import type { BeyDefinition } from '../../src/bey/archetype/BeyDefinition';
import { CONCEPT_BEY_SCALE, createConceptBeyVisual } from '../../src/bey/visual/conceptBeyVisual';
import { PROVISIONAL_ARCHETYPE_VISUALS, beyVisualDefinitionFor, conceptVisualId, ensureApprovedBeyVisualsRegistered } from '../../src/bey/visual/approvedBeyVisuals';
import { BeyPreviewStage } from '../../src/app/frontend/BeyPreviewStage';
import type { AppRenderer } from '../../src/app/bootstrap/createRenderer';
import { createMatchScene } from '../../src/app/bootstrap/createMatchScene';
import { PhysicsWorld } from '../../src/physics/world/PhysicsWorld';
import { PRESENTATION_FEATURES_DEFAULT } from '../../src/presentation/features';
import { CONCEPTS } from '../../src/bey/visual/concepts/conceptDefinitions';
import {
  BeyVisualAnchors,
  BeyVisualRegistry,
  PRESENTATION_FEATURES_OFF,
  resolveBeyVisualDefinition,
  resolvePresentationFeatures,
  collectSceneStats,
} from '../../src/presentation';

const ARCHETYPES: readonly BeyDefinition[] = [ATTACK_ARCHETYPE, DEFENSE_ARCHETYPE, STAMINA_ARCHETYPE];
const gameplayJson = (d: BeyDefinition): string => JSON.stringify({ id: d.id, physical: d.physical, ratings: d.ratings, handling: d.handling, attack: d.attack, particle: d.particle, audio: d.audio });

describe('the nine approved concepts as game visuals', () => {
  it.each(CONCEPTS.map((c) => c.id))('%s builds at game scale with its tip at the bottom of each archetype collider', (id) => {
    const concept = CONCEPTS.find((c) => c.id === id)!;
    for (const gameplay of ARCHETYPES) {
      const visual = createConceptBeyVisual(concept, gameplay);
      visual.group.updateWorldMatrix(true, true);
      const box = new THREE.Box3().setFromObject(visual.group);
      expect(Number.isFinite(box.min.y + box.max.y + box.min.x + box.max.x)).toBe(true);
      // Tip contact point = bottom of this Bey's own collider (the rule the placeholder mesh follows).
      expect(box.min.y).toBeCloseTo(-gameplay.physical.colliderHalfHeightM, 1);
      expect(box.min.y).toBeGreaterThan(-gameplay.physical.colliderHalfHeightM - 0.05);
      // About 1.3-1.4 m wide, like the labs' Beys (absolute metres, so a wrong scale fails).
      expect(CONCEPT_BEY_SCALE).toBe(0.24);
      const width = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
      expect(width).toBeGreaterThan(0.9);
      expect(width).toBeLessThan(1.8);
      // The four pieces survive the wrapping, under the spin group.
      expect(visual.spinGroup.parent).toBe(visual.group);
      const names: string[] = [];
      visual.group.traverse((o) => { if (['driver', 'disc', 'ring', 'topLayer'].includes(o.name)) names.push(o.name); });
      expect(names.sort()).toEqual(['disc', 'driver', 'ring', 'topLayer']);
    }
  });

  it('gives exact anchors from the named pieces: tip under the body, top layer above the ring, rim at the ring radius', () => {
    for (const concept of CONCEPTS) {
      const gameplay = ATTACK_ARCHETYPE;
      const visual = createConceptBeyVisual(concept, gameplay);
      const anchors = new BeyVisualAnchors(visual);
      const tip = anchors.getLocal('tip')!;
      const top = anchors.getLocal('topLayer')!;
      const rim = anchors.getLocal('ringRim')!;
      expect(tip.y).toBeCloseTo(-gameplay.physical.colliderHalfHeightM, 1);
      expect(top.y).toBeGreaterThan(rim.y);
      expect(rim.y).toBeGreaterThan(tip.y);
      expect(rim.x).toBeGreaterThan(0.25); // a real ring radius in metres
      const ring = visual.group.getObjectByName('ring')!;
      const ringBox = new THREE.Box3().setFromObject(ring);
      expect(rim.y).toBeCloseTo((ringBox.min.y + ringBox.max.y) / 2, 5);
    }
  });

  it('is the same model whichever archetype wears it, only re-seated on its own collider', () => {
    const concept = CONCEPTS[0]!;
    const widths = ARCHETYPES.map((gameplay) => {
      const box = new THREE.Box3().setFromObject(createConceptBeyVisual(concept, gameplay).group);
      return +(box.max.x - box.min.x).toFixed(6);
    });
    expect(new Set(widths).size).toBe(1);
  });
});

describe('registration and the provisional mapping', () => {
  it('registers all nine, idempotently, and assigns each of the nine selectable Beys its own concept (Lote 8)', () => {
    const registry = new BeyVisualRegistry();
    ensureApprovedBeyVisualsRegistered(registry);
    ensureApprovedBeyVisualsRegistered(registry);
    expect(registry.list().map((v) => v.id).sort()).toEqual(CONCEPTS.map(conceptVisualId).sort());
    expect(registry.list().every((v) => v.status === 'concept')).toBe(true);
    for (const definition of ARCHETYPES) expect(registry.assignedVisualId(definition.id)).toBe(PROVISIONAL_ARCHETYPE_VISUALS[definition.id]);
    expect(PROVISIONAL_ARCHETYPE_VISUALS).toMatchObject({ 'attack-prototype': 'concept:attack-a', 'defense-prototype': 'concept:defense-a', 'stamina-prototype': 'concept:stamina-a', 'attack-b': 'concept:attack-b', 'stamina-c': 'concept:stamina-c' });
    // Every concept is worn by exactly one selectable Bey.
    expect(Object.values(PROVISIONAL_ARCHETYPE_VISUALS).sort()).toEqual(CONCEPTS.map(conceptVisualId).sort());
  });

  it('describes each concept with the four approved pieces', () => {
    const registry = new BeyVisualRegistry();
    ensureApprovedBeyVisualsRegistered(registry);
    for (const visual of registry.list()) {
      expect(Object.keys(visual.pieces ?? {}).sort()).toEqual(['disc', 'driver', 'ring', 'topLayer']);
    }
  });

  it('is used only with newBeyVisuals on; flag off keeps the legacy placeholder even when registered', () => {
    const registry = new BeyVisualRegistry();
    ensureApprovedBeyVisualsRegistered(registry);
    const on = resolvePresentationFeatures({ newBeyVisuals: true });
    for (const definition of ARCHETYPES) {
      expect(resolveBeyVisualDefinition(definition, PRESENTATION_FEATURES_OFF, registry).id).toBe(`placeholder:${definition.id}`);
      expect(resolveBeyVisualDefinition(definition, resolvePresentationFeatures({ hybridVfx: true }), registry).status).toBe('placeholder');
      expect(resolveBeyVisualDefinition(definition, on, registry).id).toBe(PROVISIONAL_ARCHETYPE_VISUALS[definition.id]);
    }
  });

  it('never changes a gameplay definition: registering, resolving and building leave it byte-identical', () => {
    const before = ARCHETYPES.map(gameplayJson);
    const registry = new BeyVisualRegistry();
    ensureApprovedBeyVisualsRegistered(registry);
    const on = resolvePresentationFeatures({ newBeyVisuals: true });
    for (const definition of ARCHETYPES) {
      const visual = resolveBeyVisualDefinition(definition, on, registry).create(definition);
      expect(collectSceneStats(visual.group).meshes).toBeGreaterThanOrEqual(10);
    }
    expect(ARCHETYPES.map(gameplayJson)).toEqual(before);
  });
});

describe('one resolution for Character Select and the match', () => {
  it('registers the nine concepts on first use, before any match exists, idempotently, and resolves each archetype to its provisional concept A', () => {
    const registry = new BeyVisualRegistry();
    expect(registry.list()).toHaveLength(0);
    const expected: Record<string, string> = { 'attack-prototype': 'concept:attack-a', 'defense-prototype': 'concept:defense-a', 'stamina-prototype': 'concept:stamina-a' };
    for (let pass = 0; pass < 3; pass++) {
      for (const definition of ARCHETYPES) expect(beyVisualDefinitionFor(definition, PRESENTATION_FEATURES_DEFAULT, registry).id).toBe(expected[definition.id]);
    }
    expect(registry.list()).toHaveLength(9);
    expect(registry.list().map((v) => v.id).sort()).toEqual(CONCEPTS.map(conceptVisualId).sort());
  });

  it('with newBeyVisuals off it is the legacy placeholder and registers nothing', () => {
    const registry = new BeyVisualRegistry();
    for (const definition of ARCHETYPES) expect(beyVisualDefinitionFor(definition, PRESENTATION_FEATURES_OFF, registry).id).toBe(`placeholder:${definition.id}`);
    expect(registry.list()).toHaveLength(0);
  });

  const fakeRenderer = (): AppRenderer => ({ scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 500), render: () => undefined }) as unknown as AppRenderer;

  it('the Character Select preview shows the concept the match will use, without a match ever having been created', () => {
    const stage = new BeyPreviewStage(fakeRenderer(), PRESENTATION_FEATURES_DEFAULT);
    const shown: Record<string, string | null> = {};
    for (const definition of ARCHETYPES) {
      const before = gameplayJson(definition);
      stage.show(definition, 0xffffff);
      shown[definition.id] = stage.shownVisualId;
      expect(gameplayJson(definition)).toBe(before);
    }
    expect(shown).toEqual({ 'attack-prototype': 'concept:attack-a', 'defense-prototype': 'concept:defense-a', 'stamina-prototype': 'concept:stamina-a' });
    stage.dispose();
    expect(stage.shownVisualId).toBeNull();
    // Flag off (an explicit ?pfx without newBeyVisuals): the legacy placeholder, as the match would use.
    const legacy = new BeyPreviewStage(fakeRenderer(), PRESENTATION_FEATURES_OFF);
    legacy.show(ATTACK_ARCHETYPE, 0xffffff);
    expect(legacy.shownVisualId).toBe(`placeholder:${ATTACK_ARCHETYPE.id}`);
    legacy.dispose();
  });

  it('the match scene resolves the same visual definition the preview showed', async () => {
    const stage = new BeyPreviewStage(fakeRenderer(), PRESENTATION_FEATURES_DEFAULT);
    const physics = await PhysicsWorld.create();
    const match = createMatchScene(new THREE.Group(), physics, undefined, undefined, undefined, 'B', PRESENTATION_FEATURES_DEFAULT);
    for (const side of ['first', 'second'] as const) {
      const definition = match[side].definition;
      stage.show(definition, 0xffffff);
      expect(match.visuals[side].definition.id, side).toBe(stage.shownVisualId);
      expect(match.visuals[side].definition.status).toBe('concept');
    }
    stage.dispose();
    physics.rapierWorld.free();
  });
});
