// ============================================================
// AI EDGE-SAFE EVASION — INTEGRATION TESTS (MILESTONE 7 PART 2b)
// Real physics + real tickMatch(). The AI sits near the ring-out edge and
// a scripted attacker Dashes at it from the center side, so "away from
// the attacker" is straight out of the ring. Pins:
//  - Dodge available: the burst goes sideways/inward, never outward, and
//    the AI does not ring out.
//  - Dodge unavailable (Stamina below its cost), jump available: it jumps
//    (JumpDrift) instead of pressing Dodge, with no outward throttle.
//  - Once the threat is over, edge recovery resumes, and evade <-> recover
//    switches stay bounded (no oscillation).
// Deterministic personality: errorRate 0 (no deliberate downgrades),
// dodgeSkill 1, counterAffinity 0 (evade, never counter).
// ============================================================

import { describe, expect, it } from 'vitest';
import { AIController } from '../../src/ai/controllers/AIController';
import { dodgeBurstDirection, type DodgeInputs } from '../../src/ai/decision/ActionSelection';
import { AiIntent } from '../../src/ai/decision/Intent';
import { DEFAULT_AI_DIFFICULTY_PROFILE } from '../../src/ai/difficulty/AiDifficultyProfile';
import { DEFENSE_AI_PERSONALITY } from '../../src/ai/personalities/AiArchetypePersonalities';
import { ScriptedController } from '../../src/automation/scripted-scenarios/ScriptedController';
import { AttackState } from '../../src/combat/attacks/AttackController';
import { NullAiMashSource } from '../../src/combat/clash/ClashMash';
import { RoundOutcome } from '../../src/combat/round-rules/RoundState';
import { DodgeState } from '../../src/dodge/DodgeController';
import { DODGE_STAMINA_COST } from '../../src/dodge/DodgeTuning';
import { Action, type ControllerActions } from '../../src/input/actions/Action';
import { isGrounded } from '../../src/physics/collision/GroundCheck';
import { FIXED_DELTA_SECONDS } from '../../src/physics/fixed-step/FixedTimestepLoop';
import { dot, fromYaw, length, normalize, type Vec2 } from '../../src/physics/Vec2';
import { SeededRng } from '../../src/rng/SeededRng';
import { CombatHarness } from './combatHarness';

const AI_Z = 10.9;
const RUN_TICKS = 240;
/** "Not outward": the burst's outward (away-from-center) share of its speed change. */
const MAX_OUTWARD_SHARE_OF_BURST = 0.2;
const EVASION_INTENTS: ReadonlySet<AiIntent> = new Set([AiIntent.DodgeThreat, AiIntent.JumpEvade]);

interface TickRecord {
  tick: number;
  actions: ControllerActions;
  headingRad: number;
  positionBefore: Vec2;
  velocityBefore: Vec2;
  velocityAfter: Vec2;
  attackerState: AttackState;
  idealIntent: AiIntent;
  dodgeStateAfter: DodgeState;
  grounded: boolean;
}

async function runEdgeScenario(attackerZ: number, chargeTicks: number, aiStamina?: number) {
  const harness = await CombatHarness.create({ x: 0, y: 0.5, z: attackerZ }, { x: 0, y: 0.5, z: AI_Z }, {}, new NullAiMashSource());
  if (aiStamina !== undefined) harness.second.stamina.resource.set(aiStamina);
  const ai = new AIController(
    harness.physics,
    harness.second,
    harness.first,
    harness.clash.controller,
    { ...DEFENSE_AI_PERSONALITY, errorRate: 0, dodgeSkill: 1, counterAffinity: 0 },
    DEFAULT_AI_DIFFICULTY_PROFILE,
    SeededRng.fromSeedText('edge-safe-evasion'),
  );
  // One Dash straight at the AI (the Dash locks on to the nearest opponent).
  const attacker = new ScriptedController([
    { fromTick: 20, held: [Action.Attack] },
    { fromTick: 20 + chargeTicks, held: [] },
  ]);

  const records: TickRecord[] = [];
  for (let tick = 0; tick < RUN_TICKS && !harness.roundState.isOver; tick++) {
    const actions = ai.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS });
    const position = harness.second.body.translation();
    const velocity = harness.second.body.linvel();
    const headingRad = harness.second.movement.getHeadingRad();
    const grounded = isGrounded(harness.physics, harness.second.collider);
    harness.tick(attacker.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }), actions);
    const velocityAfter = harness.second.body.linvel();
    records.push({
      tick,
      actions,
      headingRad,
      positionBefore: { x: position.x, z: position.z },
      velocityBefore: { x: velocity.x, z: velocity.z },
      velocityAfter: { x: velocityAfter.x, z: velocityAfter.z },
      attackerState: harness.first.attack.getState(),
      idealIntent: ai.getDebugState().idealIntent,
      dodgeStateAfter: harness.second.dodge.getState(),
      grounded,
    });
  }
  return { harness, records };
}

function outwardUnit(position: Vec2): Vec2 {
  return normalize(position);
}

function heldInputs(actions: ControllerActions): DodgeInputs {
  const forward = (actions.held.has(Action.MoveForward) ? 1 : 0) - (actions.held.has(Action.MoveBackward) ? 1 : 0);
  const lateral = (actions.held.has(Action.SteerRight) ? 1 : 0) - (actions.held.has(Action.SteerLeft) ? 1 : 0);
  return { forward: forward as DodgeInputs['forward'], lateral: lateral as DodgeInputs['lateral'] };
}

/** Switches between an evasion intent and RecoverFromEdge (either direction) — the oscillation this layer must not produce. */
function evadeRecoverSwitches(records: readonly TickRecord[]): number {
  let switches = 0;
  let last: 'evade' | 'recover' | null = null;
  for (const record of records) {
    const kind = EVASION_INTENTS.has(record.idealIntent) ? 'evade' : record.idealIntent === AiIntent.RecoverFromEdge ? 'recover' : null;
    if (kind === null) continue;
    if (last !== null && kind !== last) switches++;
    last = kind;
  }
  return switches;
}

function aiRangOut(harness: CombatHarness): boolean {
  return harness.roundState.result === RoundOutcome.FirstWinsByRingOut;
}

describe('AI edge-safe evasion (M7 Part 2b)', () => {
  // [attacker start z, Dash charge ticks]: a short charge from closer in, a longer one from farther out.
  for (const [attackerZ, chargeTicks] of [
    [7, 15],
    [6, 30],
  ] as const) {
    it(`dodges a center-side Dash sideways/inward, never outward, then resumes edge recovery (attacker z=${attackerZ}, charge ${chargeTicks} ticks)`, async () => {
      const { harness, records } = await runEdgeScenario(attackerZ, chargeTicks);

      const pressIndex = records.findIndex((r) => r.actions.pressedThisFrame.has(Action.Dodge));
      expect(pressIndex, 'the AI pressed Dodge').toBeGreaterThanOrEqual(0);
      const press = records[pressIndex]!;
      expect(press.attackerState, 'Dodge was pressed against the live Dash').toBe(AttackState.DashActive);
      expect(press.dodgeStateAfter, 'the press actually started a dodge').toBe(DodgeState.Dodging);

      const outward = outwardUnit(press.positionBefore);
      // Input direction: what the held keys make DodgeController.applyBurst do.
      const inputDirection = dodgeBurstDirection(press.headingRad, heldInputs(press.actions));
      expect(length(inputDirection), 'a directional dodge (not a neutral one)').toBeGreaterThan(0.5);
      expect(dot(inputDirection, outward), 'held dodge direction is not outward').toBeLessThanOrEqual(MAX_OUTWARD_SHARE_OF_BURST);
      // Effective direction: the real velocity change on the press tick.
      const burst = { x: press.velocityAfter.x - press.velocityBefore.x, z: press.velocityAfter.z - press.velocityBefore.z };
      expect(length(burst), 'the dodge burst really fired').toBeGreaterThan(4);
      expect(dot(burst, outward), 'the effective burst is not outward').toBeLessThanOrEqual(MAX_OUTWARD_SHARE_OF_BURST * length(burst));

      // Only one Dodge press for one Dash.
      expect(records.filter((r) => r.actions.pressedThisFrame.has(Action.Dodge)).length).toBe(1);
      expect(aiRangOut(harness), 'the AI did not ring out').toBe(false);

      // Threat over -> edge recovery resumes, and the evade/recover switch count stays bounded.
      const dashOver = records.findIndex((r, i) => i > pressIndex && r.attackerState !== AttackState.DashActive);
      expect(dashOver).toBeGreaterThan(pressIndex);
      expect(records.slice(dashOver).some((r) => r.idealIntent === AiIntent.RecoverFromEdge), 'edge recovery resumed after the threat').toBe(true);
      expect(evadeRecoverSwitches(records), 'recover -> evade -> recover, with no ping-pong').toBeLessThanOrEqual(2);
    });
  }

  it('with Stamina below the Dodge cost it jumps instead: no Dodge press, JumpDrift while grounded, no outward throttle, no ring-out', async () => {
    const { harness, records } = await runEdgeScenario(7, 15, DODGE_STAMINA_COST - 8);

    expect(records.some((r) => r.actions.pressedThisFrame.has(Action.Dodge)), 'never pressed a Dodge it cannot afford').toBe(false);
    const jumpIndex = records.findIndex((r) => r.actions.pressedThisFrame.has(Action.JumpDrift));
    expect(jumpIndex, 'the AI jumped').toBeGreaterThanOrEqual(0);
    const jump = records[jumpIndex]!;
    expect(jump.idealIntent).toBe(AiIntent.JumpEvade);
    expect(jump.attackerState, 'jumped against the live Dash').toBe(AttackState.DashActive);
    expect(jump.grounded, 'a jump from the ground, not an air action').toBe(true);

    for (const record of records.filter((r) => r.idealIntent === AiIntent.JumpEvade)) {
      expect(record.actions.held.has(Action.SteerLeft) || record.actions.held.has(Action.SteerRight), `tick ${record.tick}: no steering (would drift)`).toBe(false);
      const forwardOutward = dot(fromYaw(record.headingRad), outwardUnit(record.positionBefore));
      if (record.actions.held.has(Action.MoveForward)) expect(forwardOutward, `tick ${record.tick}: MoveForward not outward`).toBeLessThanOrEqual(MAX_OUTWARD_SHARE_OF_BURST);
      if (record.actions.held.has(Action.MoveBackward)) expect(-forwardOutward, `tick ${record.tick}: MoveBackward not outward`).toBeLessThanOrEqual(MAX_OUTWARD_SHARE_OF_BURST);
    }

    expect(aiRangOut(harness), 'the AI did not ring out').toBe(false);
    expect(records.slice(jumpIndex).some((r) => r.idealIntent === AiIntent.RecoverFromEdge), 'edge recovery resumed after the jump').toBe(true);
    expect(evadeRecoverSwitches(records)).toBeLessThanOrEqual(2);
  });
});
