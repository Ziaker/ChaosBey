import { describe, expect, it } from 'vitest';
import { MAIN_MENU } from '../../src/app/menu/MainMenu';
import { appModeHref, resolveAppMode } from '../../src/app/modes/appMode';

// Main Menu (GDD 1.2, 56) with the owner's Developer / Debug section
// (option C). The DOM behavior is covered by tests/smoke/mainMenu.spec.ts;
// this pins the structure and the routing it relies on.

describe('app mode routing', () => {
  it('opens the Main Menu for the plain URL and for unknown modes', () => {
    expect(resolveAppMode('')).toBe('menu');
    expect(resolveAppMode('?mode=')).toBe('menu');
    expect(resolveAppMode('?mode=menu')).toBe('menu');
    expect(resolveAppMode('?mode=nonsense')).toBe('menu');
  });

  it('keeps the direct links for every mode', () => {
    expect(resolveAppMode('?mode=play')).toBe('play');
    expect(resolveAppMode('?mode=debug-lab')).toBe('debug-lab');
    expect(resolveAppMode('?mode=combat-hud-lab')).toBe('combat-hud-lab');
    expect(resolveAppMode('?mode=self-test')).toBe('self-test');
  });

  it('builds mode URLs on the current path, keeping other query parameters', () => {
    const page = { pathname: '/ChaosBey/', search: '' };
    expect(appModeHref('play', page)).toBe('/ChaosBey/?mode=play');
    expect(appModeHref('debug-lab', page)).toBe('/ChaosBey/?mode=debug-lab');
    expect(appModeHref('combat-hud-lab', page)).toBe('/ChaosBey/?mode=combat-hud-lab');
    expect(appModeHref('self-test', page)).toBe('/ChaosBey/?mode=self-test');
    expect(appModeHref('menu', { pathname: '/ChaosBey/', search: '?mode=play' })).toBe('/ChaosBey/');
    expect(appModeHref('debug-lab', { pathname: '/ChaosBey/', search: '?x=1&mode=play' })).toBe('/ChaosBey/?x=1&mode=debug-lab');
  });
});

describe('Main Menu structure', () => {
  const developerModes = MAIN_MENU.developer.map((e) => e.mode);

  it('shows the normal player flow at the top level', () => {
    expect(MAIN_MENU.player.map((e) => e.label)).toContain('PLAY');
    expect(MAIN_MENU.player.find((e) => e.label === 'PLAY')?.mode).toBe('play');
  });

  it('keeps all Labs and Self Test only inside the Developer / Debug section', () => {
    expect(MAIN_MENU.developerSectionLabel).toBe('Developer / Debug');
    expect(MAIN_MENU.developer.map((e) => e.label)).toEqual(['DEBUG LAB', 'COMBAT HUD LAB', 'SELF TEST']);
    expect(developerModes).toEqual(['debug-lab', 'combat-hud-lab', 'self-test']);
    for (const entry of MAIN_MENU.player) expect(developerModes).not.toContain(entry.mode);
  });

  it('routes every entry through the existing ?mode= route (no second bootstrap)', () => {
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
