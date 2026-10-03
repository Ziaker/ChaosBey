// ============================================================
// AI EVASION, DODGE GATING AND AIR RECOVERY — UNIT TESTS (M7 PART 2b)
// Ported from the PR #13 audit onto the M7 Part 2a architecture:
// sideways evasion, Dodge aimed with the player's 8 key combinations,
// presses only when a dodge can start (grounded, affordable, a fresh
// press), no hop mid-dodge or near the edge, momentum-projected edge
// risk, and the AirRecover intent/press (GDD section 21).
// ============================================================

import { describe, expect, it } from 'vitest';
import { ActionSelector, dodgeDirectionKeys, evasionDirection } from '../../src/ai/decision/ActionSelection';
import { AiIntent } from '../../src/ai/decision/Intent';
import { selectIntent } from '../../src/ai/decision/IntentSelection';
import { evaluateRisk } from '../../src/ai/decision/RiskEvaluation';
import { buildWorldState, type WorldState } from '../../src/ai/decision/WorldState';
import { perceiveCombatant, type CombatantRawState } from '../../src/ai/perception/AiPerception';
import { ATTACK_AI_PERSONALITY, DEFENSE_AI_PERSONALITY } from '../../src/ai/personalities/AiArchetypePersonalities';
import { RINGOUT_RADIUS_M } from '../../src/arena/ringout/RingOutTuning';
import { AttackState } from '../../src/combat/attacks/AttackController';
import { ClashState } from '../../src/combat/clash/ClashController';
import { DodgeState } from '../../src/dodge/DodgeController';
import { DriftState } from '../../src/drift/DriftController';
import { Action } from '../../src/input/actions/Action';
import { dot, fromYaw, perpendicular } from '../../src/physics/Vec2';

const DT = 1 / 60;

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

function world(own: Partial<CombatantRawState>, opponent: Partial<CombatantRawState>): WorldState {
  return buildWorldState(0, perceiveCombatant(rawState(own)), perceiveCombatant(rawState(opponent)), { state: ClashState.Idle, cooldownRemainingS: 0 });
}

const threat = { positionXZ: { x: 0, z: 2 }, attackState: AttackState.DashActive };

describe('momentum-projected edge risk', () => {
  it('reads danger from where own velocity is carrying the Bey, not only where it is', () => {
    const still = perceiveCombatant(rawState({ positionXZ: { x: 0, z: RINGOUT_RADIUS_M - 4.9 } }));
    const slidingOut = perceiveCombatant(rawState({ positionXZ: { x: 0, z: RINGOUT_RADIUS_M - 4.9 }, velocityXZ: { x: 0, z: 12 } }));
    expect(still.projectedEdgeRiskFraction).toBe(0);
    expect(slidingOut.edgeRiskFraction).toBe(0);
    expect(slidingOut.projectedEdgeRiskFraction).toBeGreaterThan(0.9);
    const w = world({ positionXZ: { x: 0, z: RINGOUT_RADIUS_M - 4.9 }, velocityXZ: { x: 0, z: 12 } }, { positionXZ: { x: 0, z: -4 } });
    expect(selectIntent(w, ATTACK_AI_PERSONALITY, evaluateRisk(w, ATTACK_AI_PERSONALITY)).intent).toBe(AiIntent.RecoverFromEdge);
  });
});

describe('evasion geometry', () => {
  it('in open space, evades sideways off the attack line, toward the center side', () => {
    const w = world({ positionXZ: { x: 5, z: 0 } }, { positionXZ: { x: 5, z: 4 } });
    const direction = evasionDirection(w);
    expect(Math.abs(dot(direction, w.directionToOpponent))).toBeLessThan(1e-9);
    expect(dot(direction, w.own.directionTowardCenter)).toBeGreaterThan(0.99);
  });

  it('maps a direction onto the same 8 key combinations a player can press', () => {
    const forward = fromYaw(0);
    const right = perpendicular(forward);
    expect(dodgeDirectionKeys(0, forward)).toEqual([Action.MoveForward]);
    expect(dodgeDirectionKeys(0, { x: -forward.x, z: -forward.z })).toEqual([Action.MoveBackward]);
    expect(dodgeDirectionKeys(0, right)).toEqual([Action.SteerRight]);
    expect(dodgeDirectionKeys(0, { x: -right.x, z: -right.z })).toEqual([Action.SteerLeft]);
    const diagonal = { x: (forward.x + right.x) / Math.SQRT2, z: (forward.z + right.z) / Math.SQRT2 };
    expect(dodgeDirectionKeys(0, diagonal)).toEqual([Action.MoveForward, Action.SteerRight]);
  });

  it('aims the Dodge sideways instead of forward into a head-on Dash', () => {
    const w = world({ headingRad: 0 }, threat);
    const actions = new ActionSelector().selectActions(AiIntent.DodgeThreat, w, DEFENSE_AI_PERSONALITY, true, DT);
    expect(actions.pressedThisFrame.has(Action.Dodge)).toBe(true);
    expect(actions.held.has(Action.MoveForward)).toBe(false);
    expect(actions.held.has(Action.SteerLeft) || actions.held.has(Action.SteerRight)).toBe(true);
  });

  it('hops (when chosen) off the attack line, not into the attacker', () => {
    const w = world({}, threat);
    expect(dot(evasionDirection(w), w.directionToOpponent)).toBeLessThanOrEqual(1e-9);
  });
});

describe('dodge press gating', () => {
  it('does not waste the press while airborne, and presses once grounded', () => {
    const selector = new ActionSelector();
    expect(selector.selectActions(AiIntent.DodgeThreat, world({ grounded: false }, threat), DEFENSE_AI_PERSONALITY, true, DT).held.has(Action.Dodge)).toBe(false);
    expect(selector.selectActions(AiIntent.DodgeThreat, world({}, threat), DEFENSE_AI_PERSONALITY, true, DT).pressedThisFrame.has(Action.Dodge)).toBe(true);
  });

  it('never holds Dodge across ticks — a retry is always a fresh press', () => {
    const selector = new ActionSelector();
    const w = world({}, threat);
    const presses = [0, 1, 2].map(() => selector.selectActions(AiIntent.DodgeThreat, w, DEFENSE_AI_PERSONALITY, true, DT));
    expect(presses[0]!.pressedThisFrame.has(Action.Dodge)).toBe(true);
    expect(presses[1]!.held.has(Action.Dodge)).toBe(false);
    expect(presses[2]!.pressedThisFrame.has(Action.Dodge)).toBe(true);
  });

  it('does not press a Dodge it cannot pay for, and does not choose one', () => {
    const w = world({ canAffordDodge: false }, threat);
    expect(new ActionSelector().selectActions(AiIntent.DodgeThreat, w, DEFENSE_AI_PERSONALITY, true, DT).held.has(Action.Dodge)).toBe(false);
    const decision = selectIntent(w, DEFENSE_AI_PERSONALITY, evaluateRisk(w, DEFENSE_AI_PERSONALITY));
    expect(decision.intent).not.toBe(AiIntent.DodgeThreat);
    expect(decision.reason).toContain('not enough Stamina');
  });

  it('stays grounded mid-dodge instead of hopping away from its own i-frames', () => {
    const w = world({ dodgeState: DodgeState.Dodging }, threat);
    expect(selectIntent(w, DEFENSE_AI_PERSONALITY, evaluateRisk(w, DEFENSE_AI_PERSONALITY)).intent).toBe(AiIntent.DodgeThreat);
  });

  it('does not answer a threat with a hop near the edge (below the recovery override too)', () => {
    const nearEdge = world(
      { positionXZ: { x: 0, z: RINGOUT_RADIUS_M - 2.2 }, dodgeState: DodgeState.Cooldown },
      { positionXZ: { x: 0, z: RINGOUT_RADIUS_M - 4 }, attackState: AttackState.DashActive },
    );
    const risk = evaluateRisk(nearEdge, ATTACK_AI_PERSONALITY);
    expect(risk.edgeRisk).toBeGreaterThanOrEqual(0.3);
    expect(risk.edgeRisk).toBeLessThan(0.55);
    expect(selectIntent(nearEdge, ATTACK_AI_PERSONALITY, risk).intent).toBe(AiIntent.Retreat);
    const center = world({ dodgeState: DodgeState.Cooldown }, threat);
    expect(selectIntent(center, ATTACK_AI_PERSONALITY, evaluateRisk(center, ATTACK_AI_PERSONALITY)).intent).toBe(AiIntent.UseJumpDrift);
  });
});

describe('air recovery (GDD section 21)', () => {
  it('overrides everything while airborne with a recovery window — including edge danger and a live threat', () => {
    const w = world({ positionXZ: { x: 0, z: RINGOUT_RADIUS_M - 0.5 }, grounded: false, airRecoveryAvailable: true }, threat);
    expect(selectIntent(w, DEFENSE_AI_PERSONALITY, evaluateRisk(w, DEFENSE_AI_PERSONALITY)).intent).toBe(AiIntent.AirRecover);
  });

  it('is not chosen for a normal jump (airborne without a window) or on the ground', () => {
    const jumping = world({ grounded: false, airRecoveryAvailable: false }, { positionXZ: { x: 4, z: 0 } });
    expect(selectIntent(jumping, DEFENSE_AI_PERSONALITY, evaluateRisk(jumping, DEFENSE_AI_PERSONALITY)).intent).not.toBe(AiIntent.AirRecover);
    const landed = world({ grounded: true, airRecoveryAvailable: true }, { positionXZ: { x: 4, z: 0 } });
    expect(selectIntent(landed, DEFENSE_AI_PERSONALITY, evaluateRisk(landed, DEFENSE_AI_PERSONALITY)).intent).not.toBe(AiIntent.AirRecover);
  });

  it('presses Dodge once while the window is open — even with the ground Dodge on cooldown — and stops once it closes', () => {
    const selector = new ActionSelector();
    const open = world({ grounded: false, airRecoveryAvailable: true, dodgeState: DodgeState.Cooldown }, { positionXZ: { x: 4, z: 0 } });
    expect(selector.selectActions(AiIntent.AirRecover, open, DEFENSE_AI_PERSONALITY, false, DT).pressedThisFrame.has(Action.Dodge)).toBe(true);
    const used = world({ grounded: false, airRecoveryAvailable: false, dodgeState: DodgeState.Cooldown }, { positionXZ: { x: 4, z: 0 } });
    for (let i = 0; i < 3; i++) {
      expect(selector.selectActions(AiIntent.AirRecover, used, DEFENSE_AI_PERSONALITY, false, DT).held.has(Action.Dodge)).toBe(false);
    }
  });

  describe('launched mid-Dash-charge (releasing Attack would fire the Dash from the air)', () => {
    const far = { positionXZ: { x: 6, z: 0 } };
    const charging = (grounded: boolean, airRecoveryAvailable: boolean) =>
      world({ grounded, airRecoveryAvailable, attackState: AttackState.ChargingDash, dashChargeFraction: 0.3, dashReadiness: 0.8 }, far);

    it('AirRecover keeps holding the existing charge while pressing Dodge — no new Attack press', () => {
      const selector = new ActionSelector();
      // Charging on the ground under AttackDash: Attack held (pressed once).
      selector.selectActions(AiIntent.AttackDash, world({ attackState: AttackState.ChargingDash, dashChargeFraction: 0.3, dashReadiness: 0.8 }, far), ATTACK_AI_PERSONALITY, false, DT);
      const actions = selector.selectActions(AiIntent.AirRecover, charging(false, true), ATTACK_AI_PERSONALITY, false, DT);
      expect(actions.held.has(Action.Attack)).toBe(true);
      expect(actions.pressedThisFrame.has(Action.Attack)).toBe(false);
      expect(actions.pressedThisFrame.has(Action.Dodge)).toBe(true);
    });

    it('keeps holding it through a later decision in the same flight, and lets the decision on the ground release it', () => {
      const selector = new ActionSelector();
      selector.selectActions(AiIntent.AirRecover, charging(false, true), ATTACK_AI_PERSONALITY, false, DT);
      // Still airborne, window used, a new decision that doesn't want the charge.
      expect(selector.selectActions(AiIntent.Approach, charging(false, false), ATTACK_AI_PERSONALITY, false, DT).held.has(Action.Attack)).toBe(true);
      // Back on the ground: the decision decides (Approach releases = a normal grounded Dash).
      expect(selector.selectActions(AiIntent.Approach, charging(true, false), ATTACK_AI_PERSONALITY, false, DT).held.has(Action.Attack)).toBe(false);
    });

    it('never starts a charge: AirRecover without one does not touch Attack', () => {
      const selector = new ActionSelector();
      for (const attackState of [AttackState.Neutral, AttackState.DashRecovery, AttackState.CircularRecovery]) {
        const actions = selector.selectActions(AiIntent.AirRecover, world({ grounded: false, airRecoveryAvailable: true, attackState }, far), ATTACK_AI_PERSONALITY, false, DT);
        expect(actions.held.has(Action.Attack), attackState).toBe(false);
      }
    });

    it('launched while charging, before AirRecover is decided: the previous intent can no longer release the charge in the air', () => {
      const selector = new ActionSelector();
      // Charging on the ground (Attack already held).
      selector.selectActions(AiIntent.AttackDash, world({ attackState: AttackState.ChargingDash, dashChargeFraction: 0.3, dashReadiness: 0.8 }, far), ATTACK_AI_PERSONALITY, false, DT);
      // Full charge: AttackDash on its own would release here.
      const launchedFull = world({ grounded: false, airRecoveryAvailable: true, attackState: AttackState.ChargingDash, dashChargeFraction: 1, dashReadiness: 0.5 }, far);
      const actions = selector.selectActions(AiIntent.AttackDash, launchedFull, ATTACK_AI_PERSONALITY, false, DT);
      expect(actions.held.has(Action.Attack)).toBe(true);
      expect(actions.pressedThisFrame.has(Action.Attack)).toBe(false);
      // Still in that flight after the window is used: still held.
      const afterRecovery = world({ grounded: false, airRecoveryAvailable: false, attackState: AttackState.ChargingDash, dashChargeFraction: 1, dashReadiness: 0.5 }, far);
      expect(selector.selectActions(AiIntent.AttackDash, afterRecovery, ATTACK_AI_PERSONALITY, false, DT).held.has(Action.Attack)).toBe(true);
    });

    it('the same full charge in a voluntary jump (no launch window) is released by the intent as usual', () => {
      const selector = new ActionSelector();
      selector.selectActions(AiIntent.AttackDash, world({ attackState: AttackState.ChargingDash, dashChargeFraction: 0.3, dashReadiness: 0.8 }, far), ATTACK_AI_PERSONALITY, false, DT);
      const jumpingFull = world({ grounded: false, airRecoveryAvailable: false, attackState: AttackState.ChargingDash, dashChargeFraction: 1, dashReadiness: 0.5 }, far);
      expect(selector.selectActions(AiIntent.AttackDash, jumpingFull, ATTACK_AI_PERSONALITY, false, DT).held.has(Action.Attack)).toBe(false);
    });

    it('a normal jump while charging (no AirRecover) is unchanged: the intent alone decides', () => {
      const selector = new ActionSelector();
      expect(selector.selectActions(AiIntent.Approach, charging(false, false), ATTACK_AI_PERSONALITY, false, DT).held.has(Action.Attack)).toBe(false);
    });
  });
});
