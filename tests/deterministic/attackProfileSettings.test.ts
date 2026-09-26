// ============================================================
// ATTACK PROFILE SETTINGS SELF-TESTS (MILESTONE 6, PR #8 review)
// Proves the owner's "editable in settings, not locked in code" requirement
// end to end: resolveAttackProfileSettings()'s defaults are the exact
// BeyArchetypes.ts profiles (no duplicate competing tuning source), a
// stored override actually reaches the real AttackController through Bey
// creation, malformed/corrupted overrides fall back safely, and
// reset-to-default reproduces the approved defaults exactly.
// ============================================================

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createArenaColliders } from '../../src/arena/colliders/createArenaColliders';
import { createBey } from '../../src/bey/core/Bey';
import { BEY_SPAWN_HEIGHT_M } from '../../src/bey/core/BeyTuning';
import { ATTACK_ARCHETYPE, ATTACK_ATTACK_PROFILE, DEFENSE_ARCHETYPE, DEFENSE_ATTACK_PROFILE, STAMINA_ARCHETYPE } from '../../src/bey/archetype/BeyArchetypes';
import { DEFAULT_BEY_DEFINITION } from '../../src/bey/archetype/BeyDefinition';
import { AttackController, AttackState } from '../../src/combat/attacks/AttackController';
import { Action } from '../../src/input/actions/Action';
import {
  applyAttackProfileSettings,
  createDefaultAttackProfileSettings,
  resolveAttackProfileSettings,
} from '../../src/config/attack-profile/AttackProfileSettings';
import { PhysicsWorld } from '../../src/physics/world/PhysicsWorld';

describe('AttackProfileSettings — defaults are the single source of truth (no duplicate tuning source)', () => {
  it('createDefaultAttackProfileSettings() returns exactly the profiles already baked into BeyArchetypes.ts', () => {
    const defaults = createDefaultAttackProfileSettings();
    expect(defaults.attack).toEqual(ATTACK_ATTACK_PROFILE);
    expect(defaults.defense).toEqual(DEFENSE_ATTACK_PROFILE);
    expect(defaults.stamina).toEqual(STAMINA_ARCHETYPE.attack);
  });

  it('resolveAttackProfileSettings() with no overrides returns exactly the defaults', () => {
    expect(resolveAttackProfileSettings()).toEqual(createDefaultAttackProfileSettings());
    expect(resolveAttackProfileSettings({})).toEqual(createDefaultAttackProfileSettings());
  });
});

describe('AttackProfileSettings — a stored override merges onto defaults field-by-field', () => {
  it('overriding one field of one archetype leaves every other field/archetype at its default', () => {
    const resolved = resolveAttackProfileSettings({ attack: { dashMaxSpeedMps: 42 } });
    const defaults = createDefaultAttackProfileSettings();

    expect(resolved.attack.dashMaxSpeedMps).toBe(42);
    expect(resolved.attack.circularHitboxRadiusM).toBe(defaults.attack.circularHitboxRadiusM);
    expect(resolved.attack.dashHitboxRadiusM).toBe(defaults.attack.dashHitboxRadiusM);
    expect(resolved.attack.dashMinSpeedMps).toBe(defaults.attack.dashMinSpeedMps);
    expect(resolved.defense).toEqual(defaults.defense);
    expect(resolved.stamina).toEqual(defaults.stamina);
  });

  it('every field of every archetype can be overridden independently', () => {
    const resolved = resolveAttackProfileSettings({
      attack: { circularHitboxRadiusM: 1 },
      defense: { dashHitboxRadiusM: 2 },
      stamina: { dashMinSpeedMps: 3, dashMaxSpeedMps: 4 },
    });

    expect(resolved.attack.circularHitboxRadiusM).toBe(1);
    expect(resolved.defense.dashHitboxRadiusM).toBe(2);
    expect(resolved.stamina.dashMinSpeedMps).toBe(3);
    expect(resolved.stamina.dashMaxSpeedMps).toBe(4);
  });
});

describe('AttackProfileSettings — malformed overrides fail safe to the archetype\'s own default', () => {
  const defaults = createDefaultAttackProfileSettings();
  const badValues = [0, -1, NaN, Infinity, -Infinity, 'not-a-number' as unknown as number, null as unknown as number, undefined];

  for (const bad of badValues) {
    it(`circularHitboxRadiusM=${String(bad)} falls back to the Attack archetype's own default instead of becoming a degenerate hitbox`, () => {
      const resolved = resolveAttackProfileSettings({ attack: { circularHitboxRadiusM: bad } });
      expect(resolved.attack.circularHitboxRadiusM).toBe(defaults.attack.circularHitboxRadiusM);
    });
  }
});

describe('AttackProfileSettings — an inverted dashMinSpeedMps/dashMaxSpeedMps pair falls back to the defaults', () => {
  const defaults = createDefaultAttackProfileSettings();

  it('min > max (each individually a valid positive number) falls back to both defaults, not a broken inversion', () => {
    const resolved = resolveAttackProfileSettings({ attack: { dashMinSpeedMps: 50, dashMaxSpeedMps: 10 } });
    expect(resolved.attack.dashMinSpeedMps).toBe(defaults.attack.dashMinSpeedMps);
    expect(resolved.attack.dashMaxSpeedMps).toBe(defaults.attack.dashMaxSpeedMps);
  });

  it('min == max is a valid (if degenerate) range and is kept as given', () => {
    const resolved = resolveAttackProfileSettings({ defense: { dashMinSpeedMps: 7, dashMaxSpeedMps: 7 } });
    expect(resolved.defense.dashMinSpeedMps).toBe(7);
    expect(resolved.defense.dashMaxSpeedMps).toBe(7);
  });

  it('overriding only dashMaxSpeedMps below the default dashMinSpeedMps still falls back to defaults for both', () => {
    const resolved = resolveAttackProfileSettings({ stamina: { dashMaxSpeedMps: defaults.stamina.dashMinSpeedMps / 2 } });
    expect(resolved.stamina.dashMinSpeedMps).toBe(defaults.stamina.dashMinSpeedMps);
    expect(resolved.stamina.dashMaxSpeedMps).toBe(defaults.stamina.dashMaxSpeedMps);
  });

  it('a valid, non-inverted override is unaffected by the range check', () => {
    const resolved = resolveAttackProfileSettings({ attack: { dashMinSpeedMps: 5, dashMaxSpeedMps: 15 } });
    expect(resolved.attack.dashMinSpeedMps).toBe(5);
    expect(resolved.attack.dashMaxSpeedMps).toBe(15);
  });
});

describe('AttackProfileSettings — applyAttackProfileSettings() targets only the matching archetype', () => {
  it('replaces only the .attack field of the matching archetype definition, leaving every other field untouched', () => {
    const settings = resolveAttackProfileSettings({ attack: { dashMaxSpeedMps: 99 } });
    const applied = applyAttackProfileSettings(ATTACK_ARCHETYPE, settings);

    expect(applied.attack).toEqual(settings.attack);
    expect(applied.attack.dashMaxSpeedMps).toBe(99);
    expect(applied.physical).toBe(ATTACK_ARCHETYPE.physical);
    expect(applied.ratings).toBe(ATTACK_ARCHETYPE.ratings);
    expect(applied.handling).toBe(ATTACK_ARCHETYPE.handling);
    expect(applied.appearance).toBe(ATTACK_ARCHETYPE.appearance);
    expect(applied.id).toBe(ATTACK_ARCHETYPE.id);
  });

  it('leaves DEFAULT_BEY_DEFINITION (not one of the three archetypes) completely unchanged', () => {
    const settings = resolveAttackProfileSettings({ attack: { dashMaxSpeedMps: 99 }, defense: { dashMaxSpeedMps: 1 }, stamina: { dashMaxSpeedMps: 1 } });
    expect(applyAttackProfileSettings(DEFAULT_BEY_DEFINITION, settings)).toBe(DEFAULT_BEY_DEFINITION);
  });

  it('Defense and Stamina archetypes each pick up their own settings entry, not Attack\'s', () => {
    const settings = resolveAttackProfileSettings({
      attack: { dashMaxSpeedMps: 111 },
      defense: { dashMaxSpeedMps: 222 },
      stamina: { dashMaxSpeedMps: 333 },
    });
    expect(applyAttackProfileSettings(DEFENSE_ARCHETYPE, settings).attack.dashMaxSpeedMps).toBe(222);
    expect(applyAttackProfileSettings(STAMINA_ARCHETYPE, settings).attack.dashMaxSpeedMps).toBe(333);
  });
});

describe('AttackProfileSettings — a changed setting reaches the real AttackController end to end', () => {
  it('an overridden circularHitboxRadiusM produces a real hitbox with that exact radius after a full Bey creation', async () => {
    const physics = await PhysicsWorld.create();
    const scene = new THREE.Scene();
    createArenaColliders(scene, physics);

    const settings = resolveAttackProfileSettings({ attack: { circularHitboxRadiusM: 7.5 } });
    const definition = applyAttackProfileSettings(ATTACK_ARCHETYPE, settings);
    const bey = createBey(physics, { x: 0, y: BEY_SPAWN_HEIGHT_M, z: 0 }, definition);

    expect(bey.attack).toBeInstanceOf(AttackController);
    const opponentFarAway = { x: 0, z: 10 };
    bey.attack.tick(
      { held: new Set(), pressedThisFrame: new Set([Action.Attack]), attackHoldDurationSeconds: 0, jumpDriftHoldDurationSeconds: 0 },
      0,
      { x: 0, z: 0 },
      opponentFarAway,
      1,
      1 / 60,
    );
    const result = bey.attack.tick(
      { held: new Set(), pressedThisFrame: new Set(), attackHoldDurationSeconds: 0, jumpDriftHoldDurationSeconds: 0 },
      0,
      { x: 0, z: 0 },
      opponentFarAway,
      1,
      1 / 60,
    );

    expect(result.state).toBe(AttackState.CircularActive);
    expect(result.activeHitbox?.radiusM).toBeCloseTo(7.5);
  });

  it('resolving with no override reproduces byte-identical default behavior (defaults unaffected by the settings layer existing)', () => {
    const definition = applyAttackProfileSettings(ATTACK_ARCHETYPE, resolveAttackProfileSettings());
    expect(definition.attack).toEqual(ATTACK_ARCHETYPE.attack);
  });
});
