import { describe, expect, it } from 'vitest';
import { BEY_SPAWN_HEIGHT_M } from '../../src/bey/core/BeyTuning';
import { ATTACK_ARCHETYPE, DEFENSE_ARCHETYPE } from '../../src/bey/archetype/BeyArchetypes';
import { beyMatchRulesOf, createDefaultMatchConfig, type MatchConfig } from '../../src/config/match/MatchConfig';
import { Action, type ControllerActions } from '../../src/input/actions/Action';
import { AttackState } from '../../src/combat/attacks/AttackController';
import { DodgeState } from '../../src/dodge/DodgeController';
import { createDefaultMatchSetup, loadLastSetup, saveLastSetup } from '../../src/app/frontend/matchSetup';
import { currentRuntimeFingerprint } from '../../src/replay/format/runtimeFingerprint';
import { playReplayHeadless } from '../../src/replay/playback/replayPlayback';
import { simulateAiMatch } from '../../src/self-test/AiMatchSimulation';
import { CombatHarness } from './combatHarness';

const NONE: ControllerActions = { held: new Set(), pressedThisFrame: new Set(), attackHoldDurationSeconds: 0, jumpDriftHoldDurationSeconds: 0 };
const FORWARD: ControllerActions = { ...NONE, held: new Set([Action.MoveForward]) };
const attackInput = (pressed: boolean, holdS: number): ControllerActions => ({
  ...NONE,
  held: new Set([Action.Attack]),
  pressedThisFrame: pressed ? new Set([Action.Attack]) : new Set(),
  attackHoldDurationSeconds: holdS,
});
const DODGE_PRESS: ControllerActions = {
  ...NONE,
  held: new Set([Action.Dodge]),
  pressedThisFrame: new Set([Action.Dodge]),
};

async function settledHarness(strictSpeedCap: boolean): Promise<CombatHarness> {
  const h = await CombatHarness.create(
    { x: 0, y: BEY_SPAWN_HEIGHT_M, z: 0 },
    { x: 20, y: BEY_SPAWN_HEIGHT_M, z: 20 },
    { arenaFloor: 'flat', momentumGain: 0, movementStaminaDrain: 0, strictSpeedCap },
  );

  // This suite tests speed-limit policy, not the initial spawn landing. Put the Bey directly at its physical resting
  // height with zero velocity so Rapier can establish a stable flat-floor contact without first creating the Motion-Lab
  // fall/bounce cycle. That cycle is intentionally airborne on alternating ticks and therefore must bypass Strict.
  const p = h.first.body.translation();
  h.first.body.setTranslation({ x: p.x, y: h.first.definition.physical.colliderHalfHeightM, z: p.z }, true);
  h.first.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  h.first.movement.debugResetCooldown();

  let ordinaryGrounded = 0;
  for (let i = 0; i < 30 && ordinaryGrounded < 5; i++) {
    const r = h.tick(NONE, NONE);
    ordinaryGrounded = r.first.grounded && !r.first.movement.isPostImpactCooldown ? ordinaryGrounded + 1 : 0;
  }
  if (ordinaryGrounded < 5) {
    h.dispose();
    throw new Error('speed-cap fixture never established stable ordinary grounded locomotion');
  }
  return h;
}

async function speedAfterOrdinaryOverspeedTick(strictSpeedCap: boolean): Promise<{ speed: number; cap: number }> {
  const h = await settledHarness(strictSpeedCap);
  expect(h.first.rules.strictSpeedCap).toBe(strictSpeedCap);
  const before = h.first.movement.getSnapshot(h.first.body, true);
  expect(before.isPostImpactCooldown).toBe(false);

  const cap = h.first.movement.getMaxSpeedMps();
  h.first.body.setLinvel({ x: 0, y: 0, z: cap * 1.5 }, true);
  const result = h.tick(FORWARD, NONE);
  expect(result.first.grounded).toBe(true);
  const v = h.first.body.linvel();
  const speed = Math.hypot(v.x, v.z);
  h.dispose();
  return { speed, cap };
}

describe('Master §12 speed-limit behavior playtest', () => {
  it('defaults to the existing permissive behavior and old configs/replays without the field stay permissive', () => {
    expect(createDefaultMatchConfig().strictSpeedCap).toBe(false);
    const old = { ...createDefaultMatchConfig() } as Partial<MatchConfig>;
    delete old.strictSpeedCap;
    expect(beyMatchRulesOf(old as MatchConfig).strictSpeedCap).toBe(false);
  });

  it('round-trips the Strict speed cap choice through the remembered Pregame setup', () => {
    let stored = '';
    const storage = {
      setItem: (_key: string, value: string) => { stored = value; },
      getItem: (_key: string) => stored,
    };
    const base = createDefaultMatchSetup();
    const chosen = { ...base, rules: { ...base.rules, strictSpeedCap: true } };
    saveLastSetup(chosen, storage);
    expect(loadLastSetup(storage)?.rules.strictSpeedCap).toBe(true);
  });

  it('Permissive keeps a physical overspeed for at least one ordinary movement tick; Strict clamps grounded locomotion to the current cap', async () => {
    const permissive = await speedAfterOrdinaryOverspeedTick(false);
    const strict = await speedAfterOrdinaryOverspeedTick(true);
    expect(permissive.speed).toBeGreaterThan(permissive.cap * 1.05);
    expect(strict.speed).toBeLessThanOrEqual(strict.cap + 0.02);
  });

  it('Strict does not clip a live post-impact impulse', async () => {
    const h = await settledHarness(true);
    const cap = h.first.movement.getMaxSpeedMps();
    h.first.movement.registerKnockback();
    h.first.body.setLinvel({ x: 0, y: 0, z: cap * 1.5 }, true);
    h.tick(FORWARD, NONE);
    const v = h.first.body.linvel();
    expect(Math.hypot(v.x, v.z)).toBeGreaterThan(cap * 1.05);
    h.dispose();
  });

  it('Strict never clips an active Dash override even when Dash speed is above the ordinary cap', async () => {
    const h = await settledHarness(true);
    const cap = h.first.movement.getMaxSpeedMps();
    h.tick(attackInput(true, 0), NONE);
    for (let i = 0; i < 90; i++) h.tick(attackInput(false, (i + 1) / 60), NONE);
    const release = h.tick(NONE, NONE);
    expect(release.first.attackState).toBe(AttackState.DashActive);
    // Charging -> DashActive happens on release; the Dash override itself is produced on the following active tick.
    const driven = h.tick(NONE, NONE);
    expect(driven.first.attackState).toBe(AttackState.DashActive);
    expect(driven.first.grounded).toBe(true);
    const v = h.first.body.linvel();
    expect(Math.hypot(v.x, v.z)).toBeGreaterThan(cap * 1.05);
    h.dispose();
  });

  it('Strict never clips the grounded Dodge override', async () => {
    const h = await settledHarness(true);
    const cap = h.first.movement.getMaxSpeedMps();
    const dodge = h.tick(DODGE_PRESS, NONE);
    expect(dodge.first.grounded).toBe(true);
    expect(dodge.first.dodgeState).toBe(DodgeState.Dodging);
    const v = h.first.body.linvel();
    expect(Math.hypot(v.x, v.z)).toBeGreaterThan(cap * 1.05);
    h.dispose();
  });

  it('Strict never truncates airborne overspeed: launch/jump flight stays physical even after leaving the floor', async () => {
    const h = await settledHarness(true);
    const cap = h.first.movement.getMaxSpeedMps();
    const p = h.first.body.translation();
    h.first.body.setTranslation({ x: p.x, y: p.y + 2, z: p.z }, true);
    h.first.body.setLinvel({ x: 0, y: 0, z: cap * 1.5 }, true);
    const result = h.tick(FORWARD, NONE);
    expect(result.first.grounded).toBe(false);
    const v = h.first.body.linvel();
    expect(Math.hypot(v.x, v.z)).toBeGreaterThan(cap * 1.05);
    h.dispose();
  });

  it('records Strict in the deterministic config snapshot and headless playback verifies the same hashes', async () => {
    const fingerprint = await currentRuntimeFingerprint();
    const record = await simulateAiMatch({
      seed: 'strict-speed-cap-replay',
      firstDefinition: ATTACK_ARCHETYPE,
      secondDefinition: DEFENSE_ARCHETYPE,
      maxTicks: 900,
      matchConfigOverrides: { strictSpeedCap: true },
      record: { fingerprint, checkpointEvery: 30 },
    });
    const replay = record.replay!;
    expect(replay.config.matchConfig.strictSpeedCap).toBe(true);
    expect((await playReplayHeadless(replay, fingerprint)).status).toBe('verified');
  }, 60_000);
});
