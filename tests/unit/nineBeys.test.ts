// Owner, 2026-10-02 (Lote 8, item 16): nine selectable Beys. Each loads its own concept visual on Character Select and
// in the match (one resolution), plays its family's gameplay (provisional — no stats invented), and its id travels in
// the match setup, the replay config and back.

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

  it('B and C play exactly their family (provisional): same stats, physics, handling and attack; the family AI', () => {
    expect(CONCEPT_GAMEPLAY_OVERRIDES).toEqual({});
    for (const c of CONCEPT_BEYS) {
      const family = familyArchetypeOf(c.definition.id)!;
      const { id: _a, name: _b, ...mine } = c.definition;
      const { id: _c, name: _d, ...theirs } = family;
      expect(mine).toEqual(theirs);
      expect(personalityForBeyDefinitionId(c.definition.id)).toBe(personalityForBeyDefinitionId(family.id));
    }
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
