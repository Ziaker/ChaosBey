import { describe, expect, it } from 'vitest';
import { MAIN_MENU } from '../../src/app/menu/MainMenu';
import { appModeHref, resolveAppMode } from '../../src/app/modes/appMode';

describe('app mode routing', () => {
  it('opens the Main Menu for the plain URL and for unknown modes', () => {
    expect(resolveAppMode('')).toBe('menu');
    expect(resolveAppMode('?mode=')).toBe('menu');
    expect(resolveAppMode('?mode=menu')).toBe('menu');
    expect(resolveAppMode('?mode=nonsense')).toBe('menu');
  });

  it('keeps direct links for every real mode, including M10 pre-match flow', () => {
    expect(resolveAppMode('?mode=character-select')).toBe('character-select');
    expect(resolveAppMode('?mode=pregame')).toBe('pregame');
    expect(resolveAppMode('?mode=play')).toBe('play');
    expect(resolveAppMode('?mode=debug-lab')).toBe('debug-lab');
    expect(resolveAppMode('?mode=self-test')).toBe('self-test');
  });

  it('builds mode URLs on the current Pages path, keeping other query parameters', () => {
    const page = { pathname: '/ChaosBey/', search: '' };
    expect(appModeHref('character-select', page)).toBe('/ChaosBey/?mode=character-select');
    expect(appModeHref('pregame', page)).toBe('/ChaosBey/?mode=pregame');
    expect(appModeHref('play', page)).toBe('/ChaosBey/?mode=play');
    expect(appModeHref('debug-lab', page)).toBe('/ChaosBey/?mode=debug-lab');
    expect(appModeHref('self-test', page)).toBe('/ChaosBey/?mode=self-test');
    expect(appModeHref('menu', { pathname: '/ChaosBey/', search: '?mode=play' })).toBe('/ChaosBey/');
    expect(appModeHref('debug-lab', { pathname: '/ChaosBey/', search: '?x=1&mode=play' })).toBe('/ChaosBey/?x=1&mode=debug-lab');
  });
});

describe('Main Menu structure', () => {
  const developerModes = MAIN_MENU.developer.map((e) => e.mode);

  it('starts PLAY at Character Select instead of bypassing M10 pregame', () => {
    expect(MAIN_MENU.player.map((e) => e.label)).toContain('PLAY');
    expect(MAIN_MENU.player.find((e) => e.label === 'PLAY')?.mode).toBe('character-select');
  });

  it('keeps DEBUG LAB and SELF TEST only inside the Developer / Debug section', () => {
    expect(MAIN_MENU.developerSectionLabel).toBe('Developer / Debug');
    expect(MAIN_MENU.developer.map((e) => e.label)).toEqual(['DEBUG LAB', 'SELF TEST']);
    expect(developerModes).toEqual(['debug-lab', 'self-test']);
    for (const entry of MAIN_MENU.player) expect(developerModes).not.toContain(entry.mode);
  });

  it('routes every entry through the existing ?mode= route', () => {
    const page = { pathname: '/ChaosBey/', search: '' };
    for (const entry of [...MAIN_MENU.player, ...MAIN_MENU.developer]) {
      const href = appModeHref(entry.mode, page);
      expect(resolveAppMode(new URL(href, 'http://localhost').search)).toBe(entry.mode);
    }
  });

  it('has unique entry ids', () => {
    const ids = [...MAIN_MENU.player, ...MAIN_MENU.developer].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
