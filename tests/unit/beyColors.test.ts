// Owner, 2026-10-07: no two of the nine Beys share a color, the colors drive the Clash bar, and the four pieces are
// planned to get their own colors (docs/design-decisions/bey-colors-plan.md).
import { describe, expect, it } from 'vitest';
import { BEY_ROSTER } from '../../src/app/frontend/beyRoster';
import { CONCEPT_BEYS } from '../../src/bey/archetype/BeyConceptRoster';
import { BEY_COLORED_PIECES, SIDE_COLOR_MIN_DISTANCE, beyColorsFor, cssHex, sideAccentsCss } from '../../src/bey/visual/beyColors';
import { CONCEPTS } from '../../src/bey/visual/concepts/conceptDefinitions';

const rgb = (c: number): [number, number, number] => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
const distance = (a: number, b: number): number => Math.hypot(...rgb(a).map((v, i) => v - rgb(b)[i]!) as [number, number, number]);

/** The closest pair among all nine, for a message that names it. */
function closestPair(pick: (id: string) => number): { a: string; b: string; d: number } {
  let best = { a: '', b: '', d: Infinity };
  for (let i = 0; i < CONCEPTS.length; i++) {
    for (let j = i + 1; j < CONCEPTS.length; j++) {
      const d = distance(pick(CONCEPTS[i]!.id), pick(CONCEPTS[j]!.id));
      if (d < best.d) best = { a: CONCEPTS[i]!.id, b: CONCEPTS[j]!.id, d };
    }
  }
  return best;
}
const palette = (id: string) => CONCEPTS.find((c) => c.id === id)!.palette;

describe('every Bey has its own color', () => {
  it('no two of the nine share a main color or a UI color (A, B and C of a family included)', () => {
    expect(CONCEPTS).toHaveLength(9);
    const main = closestPair((id) => palette(id).primary);
    expect(main.d, `main colors of ${main.a} and ${main.b} are too close`).toBeGreaterThanOrEqual(80);
    const ui = closestPair((id) => palette(id).glow);
    expect(ui.d, `UI colors of ${ui.a} and ${ui.b} are too close`).toBeGreaterThanOrEqual(70);
  });

  it('the roster, Character Select and the HUD wear the Bey\'s own color, not its family\'s', () => {
    const accents = BEY_ROSTER.map((e) => e.accentCss);
    expect(new Set(accents).size, accents.join(' ')).toBe(9);
    for (const entry of BEY_ROSTER) {
      const colors = beyColorsFor(entry.definition.id)!;
      expect(entry.accentCss).toBe(cssHex(colors.glow));
    }
  });

  it('a Bey without a concept (the generic default, test definitions) has no colors and keeps its fallback', () => {
    expect(beyColorsFor('generic-test-bey')).toBeNull();
    expect(sideAccentsCss('#112233', 'generic-test-bey', '#aabbcc', 'generic-other')).toEqual({ first: '#112233', second: '#aabbcc' });
  });
});

describe('the Clash bar wears the Beys\' colors', () => {
  it('each half is its Bey\'s own color', () => {
    const attackA = CONCEPT_BEYS.find((c) => c.conceptId === 'attack-a')!.definition.id;
    const defenseB = CONCEPT_BEYS.find((c) => c.conceptId === 'defense-b')!.definition.id;
    const sides = sideAccentsCss('#000000', attackA, '#000000', defenseB);
    expect(sides.first).toBe(cssHex(palette('attack-a').glow));
    expect(sides.second).toBe(cssHex(palette('defense-b').glow));
  });

  it('every pair of different Beys gives two halves that can be told apart', () => {
    for (const a of CONCEPT_BEYS) {
      for (const b of CONCEPT_BEYS) {
        if (a === b) continue;
        const sides = sideAccentsCss('#000000', a.definition.id, '#000000', b.definition.id);
        expect(sides.first, `${a.conceptId} vs ${b.conceptId}`).not.toBe(sides.second);
        expect(distance(Number.parseInt(sides.first.slice(1), 16), Number.parseInt(sides.second.slice(1), 16))).toBeGreaterThanOrEqual(SIDE_COLOR_MIN_DISTANCE);
      }
    }
  });

  it('the same Bey on both sides (a mirror match): the second half takes the Bey\'s second color', () => {
    for (const c of CONCEPT_BEYS) {
      const sides = sideAccentsCss('#000000', c.definition.id, '#000000', c.definition.id);
      expect(sides.first).toBe(cssHex(palette(c.conceptId).glow));
      expect(sides.second).toBe(cssHex(palette(c.conceptId).accent));
      expect(sides.second).not.toBe(sides.first);
    }
  });
});

describe('the four pieces are planned to be colored one by one', () => {
  it('the plan names the four pieces, and no concept overrides a piece color yet', () => {
    expect([...BEY_COLORED_PIECES]).toEqual(['topLayer', 'ring', 'disc', 'driver']);
    for (const c of CONCEPTS) expect(c.pieceColors, c.id).toBeUndefined();
  });
});
