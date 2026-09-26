// ============================================================
// ATTACK PROFILE STORAGE SELF-TESTS (MILESTONE 6, PR #8 review)
// The test runner's environment is 'node' (vitest.config.ts) — no real
// localStorage — so these tests install a small in-memory Storage mock
// on globalThis to exercise the same read/write/clear paths the browser
// panel actually uses. Proves: save/load round-trips an override,
// corrupted/missing data fails safe (never throws, resolves to null),
// and reset-to-default (clear) reproduces the approved defaults exactly.
// ============================================================

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDefaultAttackProfileSettings, resolveAttackProfileSettings } from '../../src/config/attack-profile/AttackProfileSettings';
import { clearAttackProfileOverrides, loadAttackProfileOverrides, saveAttackProfileOverrides } from '../../src/config/attack-profile/AttackProfileStorage';

class InMemoryStorage implements Storage {
  private readonly data = new Map<string, string>();
  get length(): number {
    return this.data.size;
  }
  clear(): void {
    this.data.clear();
  }
  getItem(key: string): string | null {
    return this.data.has(key) ? this.data.get(key)! : null;
  }
  key(index: number): string | null {
    return Array.from(this.data.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

describe('AttackProfileStorage — persists overrides across a save/load round-trip', () => {
  beforeEach(() => {
    (globalThis as { localStorage?: Storage }).localStorage = new InMemoryStorage();
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  });

  it('loadAttackProfileOverrides() returns null before anything is saved', () => {
    expect(loadAttackProfileOverrides()).toBeNull();
  });

  it('saves and loads back the exact same override', () => {
    saveAttackProfileOverrides({ attack: { dashMaxSpeedMps: 12.5 } });
    expect(loadAttackProfileOverrides()).toEqual({ attack: { dashMaxSpeedMps: 12.5 } });
  });

  it('clearAttackProfileOverrides() removes a stored override, and resolving afterward reproduces the approved defaults exactly', () => {
    saveAttackProfileOverrides({ attack: { dashMaxSpeedMps: 12.5 }, defense: { dashHitboxRadiusM: 3 } });
    clearAttackProfileOverrides();
    expect(loadAttackProfileOverrides()).toBeNull();
    expect(resolveAttackProfileSettings(loadAttackProfileOverrides() ?? undefined)).toEqual(createDefaultAttackProfileSettings());
  });

  it('corrupted stored JSON fails safe to null rather than throwing', () => {
    localStorage.setItem('chaosbey.settings.attackProfileOverrides.v1', '{not valid json');
    expect(loadAttackProfileOverrides()).toBeNull();
  });

  it('a non-object stored value (e.g. a stray string/number) fails safe to null', () => {
    localStorage.setItem('chaosbey.settings.attackProfileOverrides.v1', '42');
    expect(loadAttackProfileOverrides()).toBeNull();
  });
});

describe('AttackProfileStorage — never throws when localStorage is unavailable (this project\'s own node test environment)', () => {
  it('load/save/clear are all safe no-ops without a real localStorage', () => {
    expect(() => loadAttackProfileOverrides()).not.toThrow();
    expect(loadAttackProfileOverrides()).toBeNull();
    expect(() => saveAttackProfileOverrides({ attack: { dashMaxSpeedMps: 1 } })).not.toThrow();
    expect(() => clearAttackProfileOverrides()).not.toThrow();
  });
});
