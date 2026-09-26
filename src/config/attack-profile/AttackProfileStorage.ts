// ============================================================
// ATTACK PROFILE STORAGE — PERSISTS SETTINGS-PANEL OVERRIDES (MILESTONE 6)
// The browser-storage half of the owner's "editable in settings" requirement
// (see AttackProfileSettings.ts for the resolution/validation layer this
// feeds). Deliberately narrow: read/write one JSON blob under one key.
// Never throws — a disabled/unavailable localStorage (privacy mode, SSR,
// this project's own `environment: 'node'` test runner) degrades to "no
// stored override", which resolveAttackProfileSettings() already treats as
// "use the approved defaults", never a crash.
// ============================================================

import type { AttackProfileSettingsOverrides } from './AttackProfileSettings';

const STORAGE_KEY = 'chaosbey.settings.attackProfileOverrides.v1';

function getStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Returns the stored overrides, or null if none are stored, storage is unavailable, or the stored value is corrupted/malformed. */
export function loadAttackProfileOverrides(): AttackProfileSettingsOverrides | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as AttackProfileSettingsOverrides) : null;
  } catch {
    return null;
  }
}

export function saveAttackProfileOverrides(overrides: AttackProfileSettingsOverrides): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    // Storage full/unavailable — the setting simply doesn't persist this session.
  }
}

/** Reset-to-default: clears any stored override so the next resolve reproduces the approved defaults exactly. */
export function clearAttackProfileOverrides(): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do if storage refuses the removal.
  }
}
