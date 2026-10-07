// Polish (owner, 2026-10-07, idea 10): what a match plays differently from the defaults, and the way back to them.
import { describe, expect, it } from 'vitest';
import { activeRuleLines, changedRuleLines, createDefaultMatchSetup, defaultMatchRules, withDefaultRules, type MatchSetup } from '../../src/app/frontend/matchSetup';
import { arenaPreset } from '../../src/arena/presets/ArenaPresets';

const withRules = (setup: MatchSetup, rules: Partial<MatchSetup['rules']>): MatchSetup => ({ ...setup, rules: { ...setup.rules, ...rules } });

describe('active rules', () => {
  it('the default match has none', () => {
    expect(activeRuleLines(createDefaultMatchSetup())).toEqual([]);
  });

  it('lists custom walls, a Clash impact, a movement direction and every changed rule', () => {
    const base = createDefaultMatchSetup();
    const preset = arenaPreset(base.arena.presetId).geometry;
    const custom: MatchSetup = {
      ...withRules(base, { knockbackScale: 2.5, topSpeedScale: 1.1 }),
      clashImpactMultiplier: 1.5,
      motion: 'C',
      arena: { ...base.arena, geometry: { ...base.arena.geometry, wallHeightM: preset.wallHeightM + 1, wallRestitution: 0.3 } },
    };
    const lines = activeRuleLines(custom);
    expect(lines.some((l) => l.startsWith('Walls '))).toBe(true);
    expect(lines).toContain('Clash impact ×1.50');
    expect(lines).toContain('Movement direction C');
    for (const changed of changedRuleLines(custom)) expect(lines).toContain(changed);
    expect(changedRuleLines(custom).length).toBeGreaterThanOrEqual(2);
  });

  it('"Default rules" brings every rule, the walls, the Clash impact and the visual options back — and keeps the Bey, the AI, the rounds and the seed', () => {
    const base = createDefaultMatchSetup();
    const custom: MatchSetup = {
      ...withRules(base, { knockbackScale: 3, topSpeedScale: 1.1 }),
      clashImpactMultiplier: 2,
      roundsToWin: 3,
      seedText: 'my-seed',
      arena: { ...base.arena, geometry: { ...base.arena.geometry, wallHeightM: 3, wallRestitution: 0.2 } },
    };
    expect(activeRuleLines(custom).length).toBeGreaterThan(0);
    const reset = withDefaultRules(custom);
    expect(activeRuleLines(reset)).toEqual([]);
    expect(reset.rules).toEqual(defaultMatchRules());
    expect(reset.playerBeyId).toBe(custom.playerBeyId);
    expect(reset.opponentBeyId).toBe(custom.opponentBeyId);
    expect(reset.roundsToWin).toBe(3);
    expect(reset.seedText).toBe('my-seed');
    expect(reset.arena.presetId).toBe(custom.arena.presetId);
  });
});
