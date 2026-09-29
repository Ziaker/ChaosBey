import { describe, expect, it } from 'vitest';
import { CHARACTER_SELECT_OPTIONS, pregameHref, selectedBeyId } from '../../src/app/menu/CharacterSelect';

describe('M10 character select model', () => {
  it('exposes exactly the three real archetypes and their real ratings', () => {
    expect(CHARACTER_SELECT_OPTIONS.map((option) => option.role)).toEqual(['Attack', 'Defense', 'Stamina']);
    expect(CHARACTER_SELECT_OPTIONS.map((option) => option.definition.id)).toEqual(['attack-prototype', 'defense-prototype', 'stamina-prototype']);
    for (const option of CHARACTER_SELECT_OPTIONS) {
      expect(option.definition.ratings.attack).toBeGreaterThanOrEqual(1);
      expect(option.definition.ratings.attack).toBeLessThanOrEqual(10);
      expect(option.definition.ratings.defense).toBeGreaterThanOrEqual(1);
      expect(option.definition.ratings.stamina).toBeGreaterThanOrEqual(1);
    }
  });

  it('falls back to Attack for an absent/invalid selection and accepts a real id', () => {
    expect(selectedBeyId('')).toBe('attack-prototype');
    expect(selectedBeyId('?playerBey=nonsense')).toBe('attack-prototype');
    expect(selectedBeyId('?playerBey=defense-prototype')).toBe('defense-prototype');
  });

  it('carries selection into pregame without escaping the GitHub Pages base path', () => {
    expect(pregameHref('stamina-prototype', { pathname: '/ChaosBey/', search: '?mode=character-select' })).toBe('/ChaosBey/?mode=pregame&playerBey=stamina-prototype');
  });
});
