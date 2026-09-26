// ============================================================
// MATCH CONFIG SELF-TESTS
// ============================================================

import { describe, expect, it } from 'vitest';
import { createDefaultMatchConfig, resolveMatchConfig } from '../../src/config/match/MatchConfig';
import { CLASH_IMPACT_MULTIPLIER_DEFAULT } from '../../src/combat/clash/ClashTuning';

describe('createDefaultMatchConfig', () => {
  it('starts clashImpactMultiplier at ClashTuning\'s default', () => {
    expect(createDefaultMatchConfig().clashImpactMultiplier).toBe(CLASH_IMPACT_MULTIPLIER_DEFAULT);
  });
});

describe('resolveMatchConfig', () => {
  it('with no overrides, resolves to exactly the defaults', () => {
    expect(resolveMatchConfig()).toEqual(createDefaultMatchConfig());
  });

  it('a pre-match override replaces the default for that field only', () => {
    const resolved = resolveMatchConfig({ clashImpactMultiplier: 2.5 });
    expect(resolved.clashImpactMultiplier).toBe(2.5);
  });

  it('is the single resolved value — two different overrides never share state', () => {
    const a = resolveMatchConfig({ clashImpactMultiplier: 1 });
    const b = resolveMatchConfig({ clashImpactMultiplier: 5 });
    expect(a.clashImpactMultiplier).toBe(1);
    expect(b.clashImpactMultiplier).toBe(5);
  });
});
