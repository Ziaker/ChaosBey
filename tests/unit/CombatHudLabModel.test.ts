import { describe, expect, it } from 'vitest';
import {
  COMBAT_HUD_DIRECTIONS,
  COMBAT_HUD_SCENARIOS,
  combatHudDirection,
  edgeDanger,
  nextDirection,
  resourceBand,
  visibleDirections,
} from '../../src/debug/combat-hud-lab/CombatHudLabModel';

describe('Combat HUD Lab contract', () => {
  it('keeps three genuinely separate directions', () => {
    expect(COMBAT_HUD_DIRECTIONS.map((direction) => direction.id)).toEqual(['A', 'B', 'C']);
    expect(new Set(COMBAT_HUD_DIRECTIONS.map((direction) => direction.philosophy)).size).toBe(3);
    expect(combatHudDirection('A').shortName).toBe('Broadcast');
    expect(combatHudDirection('B').shortName).toBe('Overdrive');
    expect(combatHudDirection('C').shortName).toBe('Tactical Core');
  });

  it('contains all 15 required evaluation contexts in order', () => {
    expect(COMBAT_HUD_SCENARIOS).toHaveLength(15);
    expect(COMBAT_HUD_SCENARIOS.map((scenario) => scenario.id)).toEqual([
      'balanced',
      'close-combat',
      'high-speed',
      'edge-danger',
      'ring-out',
      'strong-knockback',
      'drift-recovery',
      'jump-landing',
      'perfect-dodge',
      'clash',
      'low-stamina',
      'stability-break',
      'round-end',
      'match-end',
      'arena-sweep',
    ]);
  });

  it('switches single/sequence versus compare visibility deterministically', () => {
    expect(visibleDirections('single', 'B')).toEqual(['B']);
    expect(visibleDirections('sequence', 'C')).toEqual(['C']);
    expect(visibleDirections('compare', 'A')).toEqual(['A', 'B', 'C']);
    expect(nextDirection('A')).toBe('B');
    expect(nextDirection('B')).toBe('C');
    expect(nextDirection('C')).toBe('A');
  });

  it('turns ring position into a continuous presentation-only danger signal', () => {
    expect(edgeDanger(0, 12.9)).toBe(0);
    expect(edgeDanger(12.9 * 0.7, 12.9)).toBe(0);
    expect(edgeDanger(12.9, 12.9)).toBe(1);
    expect(edgeDanger(99, 12.9)).toBe(1);
    expect(edgeDanger(10.965, 12.9)).toBeCloseTo(0.5, 4);
  });

  it('uses the approved condition warning thresholds for HUD banding', () => {
    expect(resourceBand(1)).toBe('ok');
    expect(resourceBand(0.35)).toBe('warn');
    expect(resourceBand(0.23)).toBe('critical');
    expect(resourceBand(Number.NaN)).toBe('critical');
  });
});
