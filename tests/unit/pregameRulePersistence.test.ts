import { describe, expect, it } from 'vitest';
import { RING_OUT_DELAY_RANGE } from '../../src/arena/ringout/RingOutTuning';
import {
  BODY_COLLISION_DAMAGE_RANGE,
  MOMENTUM_DECAY_RANGE,
  MOMENTUM_FILL_RANGE,
  MOMENTUM_GAIN_RANGE,
  MOMENTUM_LOSS_ON_COLLISION_RANGE,
} from '../../src/bey/momentum/MomentumTuning';
import { MOVEMENT_STAMINA_DRAIN_RANGE } from '../../src/bey/stamina/StaminaTuning';
import { CIRCULAR_LAUNCH_FORCE_RANGE, DASH_COOLDOWN_RANGE } from '../../src/combat/attacks/AttackTuning';
import { SPEED_DAMAGE_GAIN_RANGE } from '../../src/combat/attacks/SpeedDamage';
import {
  ACCELERATION_SCALE_RANGE,
  AIR_CONTROL_RANGE,
  ARENA_BOWL_DEPTH_RANGE,
  JUMP_COOLDOWN_RANGE,
  JUMP_STAMINA_COST_RANGE,
  ROUND_TIME_LIMIT_RANGE,
  TOP_SPEED_SCALE_RANGE,
} from '../../src/config/match/MatchConfig';
import { DODGE_COOLDOWN_RANGE } from '../../src/dodge/DodgeTuning';
import { JUMP_FULL_HEIGHT_RANGE, JUMP_SHORT_HOP_HEIGHT_RANGE } from '../../src/drift/DriftTuning';
import { createDefaultMatchSetup, loadLastSetup } from '../../src/app/frontend/matchSetup';

const outside = {
  ringOutDelayS: -999,
  dashCooldownS: 999,
  momentumGain: 999,
  momentumFillS: -999,
  momentumDecayS: 999,
  bodyCollisionDamage: -999,
  momentumLossOnCollision: 999,
  jumpFullHeightM: 999,
  jumpShortHopHeightM: -999,
  movementStaminaDrain: 999,
  dodgeCooldownS: -999,
  circularLaunchForce: 999,
  arenaBowlDepthM: -999,
  roundTimeLimitS: 99999,
  accelerationScale: -999,
  topSpeedScale: 999,
  airControl: -999,
  jumpStaminaCost: 999,
  jumpCooldownS: 999,
  speedDamageGain: 999,
} as const;

describe('remembered Pregame gameplay rules', () => {
  it('clamps every persisted numeric slider back to the same range the current Pregame exposes', () => {
    const base = createDefaultMatchSetup();
    const raw = JSON.stringify({ ...base, rules: { ...base.rules, ...outside } });
    const loaded = loadLastSetup({ getItem: () => raw });
    expect(loaded).not.toBeNull();
    const r = loaded!.rules;

    expect(r.ringOutDelayS).toBe(RING_OUT_DELAY_RANGE.min);
    expect(r.dashCooldownS).toBe(DASH_COOLDOWN_RANGE.max);
    expect(r.momentumGain).toBe(MOMENTUM_GAIN_RANGE.max);
    expect(r.momentumFillS).toBe(MOMENTUM_FILL_RANGE.min);
    expect(r.momentumDecayS).toBe(MOMENTUM_DECAY_RANGE.max);
    expect(r.bodyCollisionDamage).toBe(BODY_COLLISION_DAMAGE_RANGE.min);
    expect(r.momentumLossOnCollision).toBe(MOMENTUM_LOSS_ON_COLLISION_RANGE.max);
    expect(r.jumpFullHeightM).toBe(JUMP_FULL_HEIGHT_RANGE.max);
    expect(r.jumpShortHopHeightM).toBe(JUMP_SHORT_HOP_HEIGHT_RANGE.min);
    expect(r.movementStaminaDrain).toBe(MOVEMENT_STAMINA_DRAIN_RANGE.max);
    expect(r.dodgeCooldownS).toBe(DODGE_COOLDOWN_RANGE.min);
    expect(r.circularLaunchForce).toBe(CIRCULAR_LAUNCH_FORCE_RANGE.max);
    expect(r.arenaBowlDepthM).toBe(ARENA_BOWL_DEPTH_RANGE.min);
    expect(r.roundTimeLimitS).toBe(ROUND_TIME_LIMIT_RANGE.max);
    expect(r.accelerationScale).toBe(ACCELERATION_SCALE_RANGE.min);
    expect(r.topSpeedScale).toBe(TOP_SPEED_SCALE_RANGE.max);
    expect(r.airControl).toBe(AIR_CONTROL_RANGE.min);
    expect(r.jumpStaminaCost).toBe(JUMP_STAMINA_COST_RANGE.max);
    expect(r.jumpCooldownS).toBe(JUMP_COOLDOWN_RANGE.max);
    expect(r.speedDamageGain).toBe(SPEED_DAMAGE_GAIN_RANGE.max);
  });

  it('persists the Dash speed-carry toggle as a boolean rule', () => {
    const base = createDefaultMatchSetup();
    const raw = JSON.stringify({ ...base, rules: { ...base.rules, dashCarriesSpeed: false } });
    const loaded = loadLastSetup({ getItem: () => raw });
    expect(loaded?.rules.dashCarriesSpeed).toBe(false);
  });
});
