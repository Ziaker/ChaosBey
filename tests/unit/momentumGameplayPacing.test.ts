// Owner item 11 follow-up (Lote 10): the AI must visibly preserve/build speed instead of
// treating Momentum as a bonus it only notices after it already exists. These are pure
// intent tests: hard tactical openings still win, while routine mid-range exchanges get
// a finite straight run-up once the Bey is already moving. No hidden force or fake spacing state.

import { describe, expect, it } from 'vitest';
import { AttackState } from '../../src/combat/attacks/AttackController';
import { ClashState } from '../../src/combat/clash/ClashController';
import { DodgeState } from '../../src/dodge/DodgeController';
import { DriftState } from '../../src/drift/DriftController';
import { perceiveCombatant, type CombatantRawState } from '../../src/ai/perception/AiPerception';
import { buildWorldState } from '../../src/ai/decision/WorldState';
import { evaluateRisk } from '../../src/ai/decision/RiskEvaluation';
import { AiIntent } from '../../src/ai/decision/Intent';
import { momentumBuildPriority, NEUTRAL_DECISION_CONTEXT, selectIntent } from '../../src/ai/decision/IntentSelection';
import {
  ATTACK_AI_PERSONALITY,
  DEFENSE_AI_PERSONALITY,
  STAMINA_AI_PERSONALITY,
} from '../../src/ai/personalities/AiArchetypePersonalities';
import type { AiPersonality } from '../../src/ai/personalities/AiPersonality';

function rawState(overrides: Partial<CombatantRawState> = {}): CombatantRawState {
  return {
    positionXZ: { x: 0, z: 0 },
    velocityXZ: { x: 0, z: 0 },
    headingRad: 0,
    grounded: true,
    attackState: AttackState.Neutral,
    dashChargeFraction: 0,
    dodgeState: DodgeState.Idle,
    driftState: DriftState.Idle,
    staminaFraction: 1,
    stabilityFraction: 1,
    isBroken: false,
    dashReadiness: 1,
    momentum: 0,
    airRecoveryAvailable: false,
    canAffordDodge: true,
    ...overrides,
  };
}

function scenario(
  ownOverrides: Partial<CombatantRawState>,
  opponentOverrides: Partial<CombatantRawState>,
  secondsSinceOwnAttack = 0,
  personality: AiPersonality = ATTACK_AI_PERSONALITY,
) {
  const own = perceiveCombatant(rawState(ownOverrides));
  const opponent = perceiveCombatant(rawState(opponentOverrides));
  const world = buildWorldState(0, own, opponent, { state: ClashState.Idle, cooldownRemainingS: 0 });
  const risk = evaluateRisk(world, personality);
  const context = { ...NEUTRAL_DECISION_CONTEXT, secondsSinceOwnAttack };
  return { world, risk, context, decision: selectIntent(world, personality, risk, context) };
}

describe('item 11 — speed-centered AI pacing', () => {
  it('keeps accelerating straight instead of immediately throwing another routine Dash while moving with low momentum', () => {
    const s = scenario(
      { velocityXZ: { x: 0, z: 6 }, momentum: 0 },
      { positionXZ: { x: 0, z: 5 } },
    );
    expect(momentumBuildPriority(s.world, ATTACK_AI_PERSONALITY, s.risk, s.context)).toBeGreaterThan(0.8);
    expect(s.decision.intent).toBe(AiIntent.Approach);
    expect(s.decision.reason).toContain('momentum build');
  });

  it('uses the long approach as the run-up when the opponent is outside Dash range', () => {
    const s = scenario(
      { velocityXZ: { x: 0, z: 6 }, momentum: 0 },
      { positionXZ: { x: 0, z: 12 } },
    );
    expect(s.decision.intent).toBe(AiIntent.Approach);
  });

  it('cashes the speed in again once the target momentum has been built', () => {
    const s = scenario(
      { velocityXZ: { x: 0, z: 8 }, momentum: 0.8 },
      { positionXZ: { x: 0, z: 5 } },
    );
    expect(momentumBuildPriority(s.world, ATTACK_AI_PERSONALITY, s.risk, s.context)).toBe(0);
    expect(s.decision.intent).toBe(AiIntent.AttackDash);
  });

  it('never sacrifices a real punish window just to finish building momentum', () => {
    const s = scenario(
      { velocityXZ: { x: 0, z: 6 }, momentum: 0 },
      { positionXZ: { x: 0, z: 5 }, attackState: AttackState.DashRecovery },
    );
    expect(momentumBuildPriority(s.world, ATTACK_AI_PERSONALITY, s.risk, s.context)).toBe(0);
    expect(s.decision.intent).toBe(AiIntent.AttackDash);
  });

  it('never suppresses a live Clash opportunity just to fill momentum', () => {
    const s = scenario(
      { velocityXZ: { x: 0, z: 6 }, momentum: 0 },
      { positionXZ: { x: 0, z: 5 }, attackState: AttackState.DashActive },
    );
    expect(s.world.opponent.hasImminentHitbox).toBe(true);
    expect(momentumBuildPriority(s.world, ATTACK_AI_PERSONALITY, s.risk, s.context)).toBe(0);
  });

  it('does not ignore actual close combat just to satisfy the momentum meter', () => {
    const s = scenario(
      { velocityXZ: { x: 0, z: 6 }, momentum: 0 },
      { positionXZ: { x: 0, z: 1.5 } },
    );
    expect(momentumBuildPriority(s.world, ATTACK_AI_PERSONALITY, s.risk, s.context)).toBe(0);
    expect(s.decision.intent).toBe(AiIntent.AttackCircular);
  });

  it('keeps the archetype ordering: Attack builds hardest, Defense in the middle, Stamina gentlest', () => {
    const own = { velocityXZ: { x: 0, z: 6 }, momentum: 0 };
    const opponent = { positionXZ: { x: 0, z: 5 } };
    const attack = scenario(own, opponent, 0, ATTACK_AI_PERSONALITY);
    const defense = scenario(own, opponent, 0, DEFENSE_AI_PERSONALITY);
    const stamina = scenario(own, opponent, 0, STAMINA_AI_PERSONALITY);
    const a = momentumBuildPriority(attack.world, ATTACK_AI_PERSONALITY, attack.risk, attack.context);
    const d = momentumBuildPriority(defense.world, DEFENSE_AI_PERSONALITY, defense.risk, defense.context);
    const s = momentumBuildPriority(stamina.world, STAMINA_AI_PERSONALITY, stamina.risk, stamina.context);
    expect(a).toBeGreaterThan(d);
    expect(d).toBeGreaterThan(s);
    expect(s).toBeGreaterThan(0);
  });

  it('fades the run-up away under the existing anti-passivity clock so it cannot become a no-attack stalemate', () => {
    const early = scenario(
      { velocityXZ: { x: 0, z: 6 }, momentum: 0 },
      { positionXZ: { x: 0, z: 5 } },
      0,
    );
    const late = scenario(
      { velocityXZ: { x: 0, z: 6 }, momentum: 0 },
      { positionXZ: { x: 0, z: 5 } },
      20,
    );
    expect(momentumBuildPriority(early.world, ATTACK_AI_PERSONALITY, early.risk, early.context)).toBeGreaterThan(0.8);
    expect(momentumBuildPriority(late.world, ATTACK_AI_PERSONALITY, late.risk, late.context)).toBe(0);
    expect(late.decision.intent).toBe(AiIntent.AttackDash);
  });
});
