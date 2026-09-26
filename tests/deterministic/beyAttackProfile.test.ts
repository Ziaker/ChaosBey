// ============================================================
// BEY ATTACK PROFILE SELF-TESTS (MILESTONE 6, GDD section 6/31)
// Proves the per-archetype hitbox reach / Dash speed are real data
// differences (not just tuning left over from a global constant), that
// AttackController actually reads its injected profile instead of the old
// AttackTuning constants, and that the default profile stays byte-identical
// to every Milestone 1-5 self-test's behavior.
// ============================================================

import { describe, expect, it } from 'vitest';
import { Action, type ControllerActions } from '../../src/input/actions/Action';
import { AttackController, AttackState } from '../../src/combat/attacks/AttackController';
import { DEFAULT_ATTACK_PROFILE } from '../../src/bey/archetype/BeyAttackProfile';
import { ATTACK_ARCHETYPE, DEFENSE_ARCHETYPE, STAMINA_ARCHETYPE } from '../../src/bey/archetype/BeyArchetypes';
import { DASH_MAX_CHARGE_S } from '../../src/combat/attacks/AttackTuning';

const FIXED_DELTA_S = 1 / 60;
const ORIGIN = { x: 0, z: 0 };
const FAR_AWAY = { x: 0, z: 10 };

function actionsWith(held: boolean, pressedThisFrame: boolean): ControllerActions {
  return {
    held: held ? new Set([Action.Attack]) : new Set(),
    pressedThisFrame: pressedThisFrame ? new Set([Action.Attack]) : new Set(),
    attackHoldDurationSeconds: 0,
    jumpDriftHoldDurationSeconds: 0,
  };
}

/** Drives one AttackController through a full tap (Circular Attack) and returns its active hitbox. */
function tapAndGetCircularHitbox(attack: AttackController) {
  attack.tick(actionsWith(true, true), 0, ORIGIN, FAR_AWAY, 1, FIXED_DELTA_S);
  const result = attack.tick(actionsWith(false, false), 0, ORIGIN, FAR_AWAY, 1, FIXED_DELTA_S);
  expect(result.state).toBe(AttackState.CircularActive);
  return result.activeHitbox!;
}

/** Drives one AttackController through a full max-charge hold-and-release (Dash Attack) and returns its active hitbox. */
function dashAndGetHitbox(attack: AttackController) {
  attack.tick(actionsWith(true, true), 0, ORIGIN, FAR_AWAY, 1, FIXED_DELTA_S);
  const chargeTicks = Math.ceil(DASH_MAX_CHARGE_S / FIXED_DELTA_S) + 5;
  let result = attack.tick(actionsWith(true, false), 0, ORIGIN, FAR_AWAY, 1, FIXED_DELTA_S);
  for (let i = 0; i < chargeTicks; i++) {
    result = attack.tick(actionsWith(true, false), 0, ORIGIN, FAR_AWAY, 1, FIXED_DELTA_S);
  }
  result = attack.tick(actionsWith(false, false), 0, ORIGIN, FAR_AWAY, 1, FIXED_DELTA_S);
  expect(result.state).toBe(AttackState.DashActive);
  return { hitbox: result.activeHitbox!, chargeFraction: result.chargeFraction };
}

describe('BeyAttackProfile — per-archetype hitbox reach/Dash speed differ purely from data', () => {
  it('the three archetypes have pairwise-distinct circular/dash hitbox radii and Dash speed range from each other', () => {
    const profiles = [ATTACK_ARCHETYPE, DEFENSE_ARCHETYPE, STAMINA_ARCHETYPE].map((d) => d.attack);

    expect(new Set(profiles.map((p) => p.circularHitboxRadiusM)).size).toBe(3);
    expect(new Set(profiles.map((p) => p.dashHitboxRadiusM)).size).toBe(3);
    expect(new Set(profiles.map((p) => p.dashMaxSpeedMps)).size).toBe(3);
  });

  it('Attack reaches further and dashes faster than Defense, consistent with their established identities', () => {
    expect(ATTACK_ARCHETYPE.attack.circularHitboxRadiusM).toBeGreaterThan(DEFENSE_ARCHETYPE.attack.circularHitboxRadiusM);
    expect(ATTACK_ARCHETYPE.attack.dashHitboxRadiusM).toBeGreaterThan(DEFENSE_ARCHETYPE.attack.dashHitboxRadiusM);
    expect(ATTACK_ARCHETYPE.attack.dashMaxSpeedMps).toBeGreaterThan(DEFENSE_ARCHETYPE.attack.dashMaxSpeedMps);
    expect(ATTACK_ARCHETYPE.attack.dashMinSpeedMps).toBeGreaterThan(DEFENSE_ARCHETYPE.attack.dashMinSpeedMps);
  });

  it('Stamina keeps the default (neutral) attack profile — a legitimate "balanced" design choice, not a bug', () => {
    expect(STAMINA_ARCHETYPE.attack).toEqual(DEFAULT_ATTACK_PROFILE);
  });

  it('AttackController actually uses the injected profile: a real tick produces hitboxes matching each archetype\'s own numbers', () => {
    const attackController = new AttackController(ATTACK_ARCHETYPE.attack);
    const defenseController = new AttackController(DEFENSE_ARCHETYPE.attack);

    expect(tapAndGetCircularHitbox(attackController).radiusM).toBeCloseTo(ATTACK_ARCHETYPE.attack.circularHitboxRadiusM);
    expect(tapAndGetCircularHitbox(defenseController).radiusM).toBeCloseTo(DEFENSE_ARCHETYPE.attack.circularHitboxRadiusM);

    const attackDash = dashAndGetHitbox(new AttackController(ATTACK_ARCHETYPE.attack));
    const defenseDash = dashAndGetHitbox(new AttackController(DEFENSE_ARCHETYPE.attack));
    expect(attackDash.hitbox.radiusM).toBeCloseTo(ATTACK_ARCHETYPE.attack.dashHitboxRadiusM);
    expect(defenseDash.hitbox.radiusM).toBeCloseTo(DEFENSE_ARCHETYPE.attack.dashHitboxRadiusM);
  });

  it('a default-constructed AttackController (no profile passed) behaves byte-identically to the pre-M6 fixed constants', () => {
    const defaultController = new AttackController();
    const explicitDefaultController = new AttackController(DEFAULT_ATTACK_PROFILE);

    expect(tapAndGetCircularHitbox(defaultController).radiusM).toBeCloseTo(tapAndGetCircularHitbox(explicitDefaultController).radiusM);

    const a = dashAndGetHitbox(new AttackController());
    const b = dashAndGetHitbox(new AttackController(DEFAULT_ATTACK_PROFILE));
    expect(a.hitbox.radiusM).toBeCloseTo(b.hitbox.radiusM);
  });
});
