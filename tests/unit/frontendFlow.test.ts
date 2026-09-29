// M10 player screens: the pure models behind Character Select and Results.

import { describe, expect, it } from 'vitest';
import { BEY_ROSTER, findRosterEntry, formatTrait, rosterTraits } from '../../src/app/frontend/beyRoster';
import { navigationIntent, wrapIndex } from '../../src/app/frontend/listNavigation';
import { outcomeText } from '../../src/app/frontend/matchOutcome';
import { createDefaultMatchSetup, defaultOpponentFor, matchBeysFor } from '../../src/app/frontend/matchSetup';
import { DEFAULT_MATCH_BEYS } from '../../src/app/bootstrap/createMatchScene';
import { ALL_BEY_ARCHETYPES, ATTACK_ARCHETYPE, DEFENSE_ARCHETYPE, STAMINA_ARCHETYPE } from '../../src/bey/archetype/BeyArchetypes';
import { DEFAULT_BEY_DEFINITION } from '../../src/bey/archetype/BeyDefinition';
import { RoundOutcome } from '../../src/combat/round-rules/RoundState';
import { appModeHref, isQuickPlay, resolveAppMode } from '../../src/app/modes/appMode';

describe('Bey roster', () => {
  it('lists every playable archetype once, in the archetype order, with its own copy', () => {
    expect(BEY_ROSTER.map((e) => e.definition)).toEqual(ALL_BEY_ARCHETYPES);
    expect(BEY_ROSTER.map((e) => e.label)).toEqual(['ATTACK', 'DEFENSE', 'STAMINA']);
    for (const entry of BEY_ROSTER) {
      expect(entry.description.length).toBeGreaterThan(40);
      expect(entry.accentCss).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(findRosterEntry('nope')).toBeNull();
  });

  it('derives traits from the definition data, relative to the default Bey', () => {
    const neutral = rosterTraits(DEFAULT_BEY_DEFINITION);
    for (const value of Object.values(neutral)) expect(value).toBeCloseTo(1, 12);
    const attack = rosterTraits(ATTACK_ARCHETYPE);
    expect(attack.weight).toBeCloseTo(0.85, 12);
    expect(attack.topSpeed).toBeCloseTo(1.15, 12);
    expect(attack.reach).toBeCloseTo(1.15, 12);
    const defense = rosterTraits(DEFENSE_ARCHETYPE);
    expect(defense.weight).toBeCloseTo(1.25, 12);
    expect(defense.grip).toBeCloseTo(1.25, 12);
    expect(rosterTraits(STAMINA_ARCHETYPE).topSpeed).toBeCloseTo(1, 12);
  });

  it('formats a trait as a signed percentage', () => {
    expect(formatTrait(1.15)).toBe('+15%');
    expect(formatTrait(0.85)).toBe('−15%');
    expect(formatTrait(1)).toBe('±0%');
    expect(formatTrait(1.004)).toBe('±0%');
  });
});

describe('match setup', () => {
  it('defaults to the first roster Bey against the next one, never a mirror', () => {
    const setup = createDefaultMatchSetup();
    expect(setup).toEqual({
      playerBeyId: 'attack-prototype',
      opponentBeyId: 'defense-prototype',
      ai: { tier: 'rival', style: 'archetype' },
      roundsToWin: 2,
      clashImpactMultiplier: 1,
      seedText: null,
    });
    // The default setup is the Debug Lab / quick-play pairing.
    expect(matchBeysFor(setup)).toEqual(DEFAULT_MATCH_BEYS);
    for (const entry of BEY_ROSTER) expect(defaultOpponentFor(entry.definition.id)).not.toBe(entry.definition.id);
    expect(defaultOpponentFor('stamina-prototype')).toBe('attack-prototype');
  });

  it('builds the match from the chosen definitions, player first', () => {
    const base = createDefaultMatchSetup();
    const beys = matchBeysFor({ ...base, playerBeyId: 'stamina-prototype', opponentBeyId: 'defense-prototype' });
    expect(beys.first).toBe(STAMINA_ARCHETYPE);
    expect(beys.second).toBe(DEFENSE_ARCHETYPE);
    expect(() => matchBeysFor({ ...base, playerBeyId: 'x' })).toThrow(/unknown Bey/);
  });
});

describe('menu navigation', () => {
  it('maps the shared keys to intents', () => {
    expect(navigationIntent('ArrowUp')).toBe('previous');
    expect(navigationIntent('ArrowDown')).toBe('next');
    expect(navigationIntent('ArrowLeft')).toBe('decrease');
    expect(navigationIntent('ArrowRight')).toBe('increase');
    expect(navigationIntent('Enter')).toBe('confirm');
    expect(navigationIntent('KeyZ')).toBe('confirm');
    expect(navigationIntent('Escape')).toBe('back');
    expect(navigationIntent('KeyQ')).toBeNull();
  });

  it('wraps focus around both ends', () => {
    expect(wrapIndex(0, -1, 3)).toBe(2);
    expect(wrapIndex(2, 1, 3)).toBe(0);
    expect(wrapIndex(1, 5, 3)).toBe(0);
    expect(wrapIndex(0, 1, 0)).toBe(0);
  });
});

describe('results text', () => {
  it("reads every outcome from the player's (first side's) point of view", () => {
    expect(outcomeText(RoundOutcome.Ongoing)).toBeNull();
    expect(outcomeText(RoundOutcome.FirstWinsByRingOut)).toMatchObject({ result: 'win', headline: 'VICTORY' });
    expect(outcomeText(RoundOutcome.FirstWinsByKo)).toMatchObject({ result: 'win' });
    expect(outcomeText(RoundOutcome.SecondWinsByKo)).toMatchObject({ result: 'loss', headline: 'DEFEAT' });
    expect(outcomeText(RoundOutcome.SecondWinsByRingOut)?.finish).toMatch(/you left the arena/);
    expect(outcomeText(RoundOutcome.Draw)).toMatchObject({ result: 'draw', headline: 'DRAW' });
  });
});

describe('play routes', () => {
  it('?mode=play is the player flow; &quick starts the default match directly', () => {
    expect(resolveAppMode('?mode=play')).toBe('play');
    expect(isQuickPlay('?mode=play')).toBe(false);
    expect(isQuickPlay('?mode=play&quick')).toBe(true);
    expect(appModeHref('menu', { pathname: '/ChaosBey/', search: '?mode=play' })).toBe('/ChaosBey/');
  });
});
