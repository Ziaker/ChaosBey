// Owner, 2026-10-02 (Lote 8, item 16): nine selectable Beys. Each loads its own concept visual on Character Select and
// in the match (one resolution), plays its own gameplay (A the family archetype, B and C shifted off it), and its id travels in
// the match setup, the replay config and back. (B and C: since 0.45.0 each plays the way its concept looks.)

import { describe, expect, it } from 'vitest';
import { CONCEPT_BEYS, CONCEPT_GAMEPLAY_OVERRIDES, familyArchetypeOf } from '../../src/bey/archetype/BeyConceptRoster';
import { beyVisualDefinitionFor } from '../../src/bey/visual/approvedBeyVisuals';
import { BeyVisualRegistry } from '../../src/presentation/beyVisual';
import { PRESENTATION_FEATURES_DEFAULT } from '../../src/presentation/features';
import { BEY_ROSTER } from '../../src/app/frontend/beyRoster';
import { createDefaultMatchSetup, defaultOpponentFor } from '../../src/app/frontend/matchSetup';
import { personalityForBeyDefinitionId } from '../../src/ai/personalities/AiArchetypePersonalities';
import { REPLAY_BEY_CATALOG } from '../../src/replay/playback/replayPlayback';
import { recordBey } from '../../src/replay/format/configSnapshot';

describe('nine selectable Beys (owner, 2026-10-02)', () => {
  it('each wears its own concept, through the one resolution the preview and the match share', () => {
    const registry = new BeyVisualRegistry();
    const seen = new Set<string>();
    for (const c of CONCEPT_BEYS) {
      const visual = beyVisualDefinitionFor(c.definition, { ...PRESENTATION_FEATURES_DEFAULT, newBeyVisuals: true }, registry);
      expect(visual.id).toBe(`concept:${c.conceptId}`);
      seen.add(visual.id);
    }
    expect(seen.size).toBe(9);
  });

  it('A is its family archetype itself; B and C are deliberate variants of it, with the family AI (owner, 2026-10-07)', () => {
    expect(Object.keys(CONCEPT_GAMEPLAY_OVERRIDES).sort()).toEqual(['attack-b', 'attack-c', 'defense-b', 'defense-c', 'stamina-b', 'stamina-c']);
    for (const c of CONCEPT_BEYS) {
      const family = familyArchetypeOf(c.definition.id)!;
      if (c.letter === 'A') {
        expect(c.definition).toBe(family);
      } else {
        const { id: _a, name: _b, particle: _p, ...mine } = c.definition;
        const { id: _c, name: _d, particle: _q, ...theirs } = family;
        expect(mine, `${c.conceptId} must play differently from its family`).not.toEqual(theirs);
        expect(c.definition.id).toBe(c.conceptId);
        expect(c.definition.audio).toEqual(family.audio);
      }
      expect(personalityForBeyDefinitionId(c.definition.id)).toBe(personalityForBeyDefinitionId(family.id));
    }
  });

  it('no variant is simply better: the family keeps its Ratings total, every Rating is 1-10, and no stat strays far', () => {
    const total = (r: { attack: number; defense: number; stamina: number }) => r.attack + r.defense + r.stamina;
    for (const c of CONCEPT_BEYS) {
      const family = familyArchetypeOf(c.definition.id)!;
      const d = c.definition;
      expect(Math.abs(total(d.ratings) - total(family.ratings)), `${c.conceptId} Ratings total`).toBeLessThanOrEqual(1);
      for (const rating of Object.values(d.ratings)) expect(rating >= 1 && rating <= 10, `${c.conceptId} Rating ${rating}`).toBe(true);
      const within = (mine: number, theirs: number) => mine / theirs >= 0.85 && mine / theirs <= 1.3;
      expect(within(d.physical.massKg, family.physical.massKg), `${c.conceptId} mass`).toBe(true);
      expect(within(d.handling.maxSpeedMps, family.handling.maxSpeedMps), `${c.conceptId} top speed`).toBe(true);
      expect(within(d.handling.accelerationMps2, family.handling.accelerationMps2), `${c.conceptId} acceleration`).toBe(true);
      expect(within(d.handling.turnRateRadS, family.handling.turnRateRadS), `${c.conceptId} turn rate`).toBe(true);
      expect(within(d.handling.lateralGripPerS, family.handling.lateralGripPerS), `${c.conceptId} grip`).toBe(true);
      expect(within(d.attack.circularHitboxRadiusM, family.attack.circularHitboxRadiusM), `${c.conceptId} reach`).toBe(true);
    }
  });

  it('the three of a family differ from each other (the roster shows three different Beys per family)', () => {
    for (const family of ['attack', 'defense', 'stamina'] as const) {
      const three = CONCEPT_BEYS.filter((c) => c.family === family).map((c) => c.definition);
      const keys = three.map((d) => JSON.stringify({ r: d.ratings, h: d.handling, a: d.attack, m: d.physical.massKg }));
      expect(new Set(keys).size, family).toBe(3);
    }
  });

  it('each variant\'s sparks and landing dust wear its own colors, and each has a play note on the roster', () => {
    for (const entry of BEY_ROSTER) {
      const c = CONCEPT_BEYS.find((b) => b.definition === entry.definition)!;
      if (c.letter === 'A') continue;
      expect(entry.description, c.conceptId).not.toContain('for now');
      expect(entry.description.length, c.conceptId).toBeGreaterThan(40);
      expect(c.definition.particle.sparkTintHex, c.conceptId).not.toBe(familyArchetypeOf(c.definition.id)!.particle.sparkTintHex);
    }
    const notes = BEY_ROSTER.filter((e) => !e.definition.id.endsWith('prototype')).map((e) => e.description);
    expect(new Set(notes).size).toBe(notes.length);
  });

  it('every one is in the replay catalog with its own id, and the setup can pick it as player or opponent', () => {
    for (const entry of BEY_ROSTER) {
      expect(REPLAY_BEY_CATALOG).toContain(entry.definition);
      expect(recordBey(entry.definition).definitionId).toBe(entry.definition.id);
      const setup = createDefaultMatchSetup(entry.definition.id);
      expect(setup.playerBeyId).toBe(entry.definition.id);
      // Never a mirror by default — not even of gameplay.
      expect(familyArchetypeOf(defaultOpponentFor(entry.definition.id))!.id).not.toBe(familyArchetypeOf(entry.definition.id)!.id);
    }
  });
});
