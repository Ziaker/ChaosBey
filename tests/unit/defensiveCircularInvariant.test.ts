import { describe, expect, it } from 'vitest';
import { beyMatchRulesOf, createDefaultMatchConfig, resolveMatchConfig } from '../../src/config/match/MatchConfig';

/**
 * Owner item 13 (2026-10-02): Circular is the defensive attack in real matches.
 * The legacy/offensive Circular exists only for bare prototype/Camera-Lab Beys created without match rules.
 * It must never become a MatchConfig/replay escape hatch that silently restores the old gameplay.
 */
describe('defensive Circular real-match invariant', () => {
  it('cannot be disabled through a MatchConfig override', () => {
    const config = resolveMatchConfig({ defensiveCircular: false });
    expect(config.defensiveCircular).toBe(true);
  });

  it('cannot be disabled when MatchConfig is converted to per-Bey rules', () => {
    const config = { ...createDefaultMatchConfig(), defensiveCircular: false };
    expect(beyMatchRulesOf(config).defensiveCircular).toBe(true);
  });
});
