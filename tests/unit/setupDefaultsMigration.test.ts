// Owner, 2026-10-05: the base dodge cooldown halves (2.5 -> 1.25 s). The Pregame remembers the last setup, so a setup
// saved before still carried 2.5 s and the change would never reach the player. A saved OLD default takes the new one;
// a value the player chose is kept.

import { describe, expect, it } from 'vitest';
import { createDefaultMatchSetup, loadLastSetup, saveLastSetup } from '../../src/app/frontend/matchSetup';

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k), clear: () => data.clear(), key: () => null, get length() { return data.size; } } as Storage;
}

describe('saved Pregame setup vs a changed rule default (owner, 2026-10-05)', () => {
  it('a setup saved before the change with the old 2.5 s dodge cooldown loads with the new 1.25 s', () => {
    const storage = memoryStorage();
    const old = createDefaultMatchSetup();
    storage.setItem('chaosbey.pregame.last.v2', JSON.stringify({ ...old, rules: { ...old.rules, dodgeCooldownS: 2.5 } }));
    expect(loadLastSetup(storage)!.rules.dodgeCooldownS).toBe(1.25);
  });

  it('a cooldown the player chose is kept, before the change or after it', () => {
    const storage = memoryStorage();
    const old = createDefaultMatchSetup();
    storage.setItem('chaosbey.pregame.last.v2', JSON.stringify({ ...old, rules: { ...old.rules, dodgeCooldownS: 3 } }));
    expect(loadLastSetup(storage)!.rules.dodgeCooldownS).toBe(3);
    // Saved now (with the new revision): 2.5 is a deliberate choice and stays.
    saveLastSetup({ ...old, rules: { ...old.rules, dodgeCooldownS: 2.5 } }, storage);
    expect(loadLastSetup(storage)!.rules.dodgeCooldownS).toBe(2.5);
  });
});
