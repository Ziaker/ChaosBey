// ============================================================
// ATTACK PROFILE SETTINGS — PLAYER-EDITABLE BEY ATTACK PROFILES (MILESTONE 6)
// Owner requirement (PR #8 review): the per-archetype BeyAttackProfile
// values (hitbox reach / Dash speed) must be editable from the game's
// settings rather than locked in implementation code. Single resolved
// source of truth for this (GDD section 101/166), the same pattern
// MatchConfig.ts already established for Clash's impact multiplier:
// defaults are read from BeyArchetypes.ts (never redeclared here, so
// there is exactly one place the approved 1.15x/1.10x/0.90x/0.85x
// numbers are written), and a resolved override always takes effect
// through this one path.
//
// Like MatchConfig, this only resolves the config a Bey is CREATED with —
// it is applied at match/Bey creation time (see applyAttackProfileSettings
// below), not hot-swapped into a running AttackController mid-match.
// ============================================================

import type { BeyAttackProfile } from '../../bey/archetype/BeyAttackProfile';
import { ATTACK_ARCHETYPE, ATTACK_ATTACK_PROFILE, DEFENSE_ARCHETYPE, DEFENSE_ATTACK_PROFILE, STAMINA_ARCHETYPE } from '../../bey/archetype/BeyArchetypes';
import type { BeyDefinition } from '../../bey/archetype/BeyDefinition';

export type AttackProfileArchetypeKey = 'attack' | 'defense' | 'stamina';

export interface BeyAttackProfileSettings {
  readonly attack: BeyAttackProfile;
  readonly defense: BeyAttackProfile;
  readonly stamina: BeyAttackProfile;
}

export type AttackProfileSettingsOverrides = {
  readonly [K in AttackProfileArchetypeKey]?: Partial<BeyAttackProfile>;
};

/** Defaults are the exact profiles already baked into BeyArchetypes.ts — never redeclared here. */
export function createDefaultAttackProfileSettings(): BeyAttackProfileSettings {
  return {
    attack: ATTACK_ATTACK_PROFILE,
    defense: DEFENSE_ATTACK_PROFILE,
    stamina: STAMINA_ARCHETYPE.attack,
  };
}

/** A stored override value must be a finite, strictly positive number to be trusted; anything else (missing, NaN, Infinity, zero, negative — e.g. corrupted localStorage) falls back to that archetype's own default for the field, never an arbitrary or degenerate hitbox/speed. */
function sanitizeField(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function resolveOneProfile(defaults: BeyAttackProfile, override: Partial<BeyAttackProfile> | undefined): BeyAttackProfile {
  return {
    circularHitboxRadiusM: sanitizeField(override?.circularHitboxRadiusM, defaults.circularHitboxRadiusM),
    dashHitboxRadiusM: sanitizeField(override?.dashHitboxRadiusM, defaults.dashHitboxRadiusM),
    dashMinSpeedMps: sanitizeField(override?.dashMinSpeedMps, defaults.dashMinSpeedMps),
    dashMaxSpeedMps: sanitizeField(override?.dashMaxSpeedMps, defaults.dashMaxSpeedMps),
  };
}

/** Merges a stored/UI override on top of the defaults, producing the single resolved BeyAttackProfileSettings the rest of the app consumes. */
export function resolveAttackProfileSettings(overrides: AttackProfileSettingsOverrides = {}): BeyAttackProfileSettings {
  const defaults = createDefaultAttackProfileSettings();
  return {
    attack: resolveOneProfile(defaults.attack, overrides.attack),
    defense: resolveOneProfile(defaults.defense, overrides.defense),
    stamina: resolveOneProfile(defaults.stamina, overrides.stamina),
  };
}

/**
 * Returns `definition` with its `attack` field replaced by the matching
 * resolved settings entry (matched by archetype id) — every other field
 * (physical/ratings/handling/appearance) is untouched. A definition that
 * isn't one of the three known archetypes (e.g. DEFAULT_BEY_DEFINITION,
 * still used by every Milestone 1-5 self-test) is returned unchanged:
 * these settings only ever apply to the real Attack/Defense/Stamina
 * archetypes.
 */
export function applyAttackProfileSettings(definition: BeyDefinition, settings: BeyAttackProfileSettings): BeyDefinition {
  switch (definition.id) {
    case ATTACK_ARCHETYPE.id:
      return { ...definition, attack: settings.attack };
    case DEFENSE_ARCHETYPE.id:
      return { ...definition, attack: settings.defense };
    case STAMINA_ARCHETYPE.id:
      return { ...definition, attack: settings.stamina };
    default:
      return definition;
  }
}
