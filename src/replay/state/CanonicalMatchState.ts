// ============================================================
// CANONICAL MATCH STATE V1 (M9 — GDD sections 75, 76)
// The explicit, versioned list of everything that can change a future
// tick of the match. The official state hash (stateHash.ts) is computed
// from this, never from a physics-engine snapshot (owner decision).
//
// Included, per Bey: the Rapier body's translation, rotation, linear and
// angular velocity, the persistent user force and torque (Rapier keeps
// addForce/addTorque until reset; SpinController uses addTorque) and the
// sleeping flag; then each gameplay system's getDeterministicState().
// Match-wide: round outcome, Clash controller + orchestration, hitstop.
//
// Deliberately excluded (see CANONICAL_STATE_EXCLUSIONS for per-field
// reasons, checked by a guard test):
// - build-time config (Bey definitions/stats, attack profiles, match
//   config, body mass/damping/friction/restitution): the replay carries it
//   in DeterministicConfigSnapshot;
// - render-only state (visual spin angle, wobble, camera, VFX, UI);
// - RNG streams: the AI streams are consumed by controllers, and a replay
//   records the controllers' outputs, so playback never advances them; the
//   gameplay stream is not drawn by the simulation today (a guard test
//   fails if that changes, and it must then be added here with a schema
//   bump);
// - diagnostics (telemetry, anomaly detector, the reused frozen-tick result).
// ============================================================

import type { Bey } from '../../bey/core/Bey';
import type { HitstopClock } from '../../app/simulation/Hitstop';
import type { MatchStepWorld } from '../../app/simulation/MatchStepper';
import { STATE_SCHEMA_VERSION, type TicksCompleted } from '../contracts';
import type { CanonicalRecord, CanonicalValue } from './CanonicalValue';

export interface CanonicalMatchStateInput {
  /** Ticks completed when the state is read (0 = the initial state, before TickIndex 0). */
  readonly ticksCompleted: TicksCompleted;
  readonly world: MatchStepWorld;
  readonly hitstop: HitstopClock;
}

export function buildCanonicalMatchState(input: CanonicalMatchStateInput): CanonicalRecord {
  const { ticksCompleted, world, hitstop } = input;
  return {
    schema: STATE_SCHEMA_VERSION,
    ticksCompleted,
    round: world.roundState.getDeterministicState(),
    hitstop: hitstop.getDeterministicState(),
    clash: {
      controller: world.clash.controller.getDeterministicState(),
      orchestration: world.clash.getDeterministicState(),
    },
    beys: {
      first: beyState(world.first),
      second: beyState(world.second),
    },
  };
}

function beyState(bey: Bey): CanonicalRecord {
  return {
    body: bodyState(bey),
    movement: bey.movement.getDeterministicState(),
    spin: bey.spin.getDeterministicState(),
    drift: bey.drift.getDeterministicState(),
    dodge: bey.dodge.getDeterministicState(),
    stamina: bey.stamina.getDeterministicState(),
    stability: bey.stability.getDeterministicState(),
    attack: bey.attack.getDeterministicState(),
    momentum: bey.momentum.getDeterministicState(),
    rail: bey.rail.getDeterministicState(),
  };
}

function bodyState(bey: Bey): CanonicalRecord {
  const body = bey.body;
  const v3 = (v: { x: number; y: number; z: number }): CanonicalValue => ({ x: v.x, y: v.y, z: v.z });
  const r = body.rotation();
  return {
    translation: v3(body.translation()),
    rotation: { x: r.x, y: r.y, z: r.z, w: r.w },
    linvel: v3(body.linvel()),
    angvel: v3(body.angvel()),
    userForce: v3(body.userForce()),
    userTorque: v3(body.userTorque()),
    sleeping: body.isSleeping(),
  };
}

/**
 * Fields of each system that are intentionally NOT in the canonical state,
 * with the reason. A guard test checks every own field of every system is
 * either returned by getDeterministicState() or listed here, so a new field
 * can't silently escape the hash.
 */
export const CANONICAL_STATE_EXCLUSIONS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  MovementController: {
    handling: 'build-time config from the Bey definition (replay config snapshot)',
    motion: 'build-time config: the motion direction (MatchConfig.motion, replay config snapshot)',
    airControl: 'build-time config: MatchConfig.airControl (replay config snapshot)',
    turnSpeedRetention: 'build-time config: MatchConfig.turnSpeedRetention (replay config snapshot)',
    thrustCalibration: 'build-time config: derived from MatchConfig.gravityScale (replay config snapshot)',
    funnelPullMps2: 'build-time config: MatchConfig.funnelPull × gravity (replay config snapshot)',
    highSpeedControl: 'build-time config: MatchConfig.highSpeedControl (replay config snapshot)',
    realMotion: 'Bey Real: build-time config (MatchConfig.real, replay config snapshot); its only memory, the wobble phase, is in the state as realWobblePhase',
    realSteerEffortMps2: 'per-tick output of the Bey Real step (read by the Stamina drain the same tick)',
  },
  SpinController: {
    motion: 'build-time config: the motion direction (MatchConfig.motion, replay config snapshot)',
    sinceImpactS: 'render-only (fade-in of the visual Motion Lab attitude spring)',
    tumbleRemainingS: 'render-only (tumble window of the visual Motion Lab attitude)',
    unrest: 'render-only (the Lote 6 wobble/precession/tumble ramp, from Stamina/Stability already in the hash)',
    lean: 'render-only (visual Motion Lab attitude, never fed back into physics)',
    leanRate: 'render-only (visual Motion Lab attitude rate)',
    accel: 'render-only (smoothed acceleration driving the visual lean target)',
    prevVel: 'render-only (previous velocity for the visual lean acceleration)',
    visualSpinAngleRad: 'render-only (mesh rotation; the detector only checks it is finite)',
    wobbleEnergy: 'render-only (drives the visual wobble; read by overlay/inspector/detector only)',
    wobbleTimeAccumulatorS: 'render-only (phase of the visual wobble)',
  },
  DriftController: {
    normalLateralGripPerS: 'build-time config from the Bey definition',
    launchMps: 'build-time config: from MatchConfig.jumpFullHeightM (replay config snapshot)',
    shortHopApexM: 'build-time config: MatchConfig.jumpShortHopHeightM (replay config snapshot)',
    jumpCooldownS: 'build-time config: MatchConfig.jumpCooldownS (replay config snapshot)',
    jumpHoldForFullS: 'build-time config: MatchConfig.jumpHoldForFullS (replay config snapshot)',
    gravityMps2: 'build-time config: MatchConfig.gravityScale (replay config snapshot)',
    hopBeganThisTick: 'per-tick output (reset at the start of every tick)',
    jumpAllowed: 'per-tick input (set at the start of every tick)',
    legacyLaunch: 'build-time config: whether the match supplied jump rules (a bare construction keeps the immediate launch)',
  },
  DodgeController: { cooldownS: 'build-time config: MatchConfig.dodgeCooldownS (replay config snapshot)', staminaCost: 'build-time config: MatchConfig.dodgeStaminaCost (replay config snapshot)', distanceScale: 'build-time config: MatchConfig.dodgeDistanceScale (replay config snapshot)', recoveryUsesDodge: 'build-time config: on for every match Bey (createBey with match rules)', recoveryMinDelayS: 'build-time config: MatchConfig.airRecoveryMinDelayS (replay config snapshot)' },
  StaminaSystem: { staminaStat: 'build-time config (resolved Bey stat)', movementDrainScale: 'build-time config: MatchConfig.movementStaminaDrain (replay config snapshot)', spinDrainScale: 'build-time config: MatchConfig.spinStaminaDrain (replay config snapshot)', realDrain: 'build-time config: MatchConfig.real (replay config snapshot)' },
  StabilitySystem: {},
  AttackController: { profile: 'build-time config (attack profile settings, in the replay config snapshot)', dashCooldownS: 'build-time config: MatchConfig.dashCooldownS (replay config snapshot)', dashCarriesSpeed: 'build-time config: MatchConfig.dashCarriesSpeed (replay config snapshot)', dashSpeedScale: 'build-time config: MatchConfig.topSpeedScale (replay config snapshot)', circularEnabled: 'build-time config: MatchConfig.circularAttack (replay config snapshot)' },
  RailController: {
    rails: 'build-time config: the stage\'s rails, from the floor and MatchConfig.railsEnabled (replay config snapshot)',
    tuning: 'build-time constant: RAIL_TUNING',
    jumpExitLiftMps: 'build-time config: derived from MatchConfig.gravityScale and jumpShortHopHeightM (replay config snapshot)',
    state: 'hashed field by field (railId, progressM, direction, speedMps, entrySpeedMps, timeOnRailS, entryReason, exitReason)',
  },
  MomentumSystem: { rules: 'build-time config: MatchConfig momentum values (replay config snapshot)' },
  ClashController: {},
  ClashOrchestration: {
    matchConfig: 'build-time config (replay config snapshot)',
    aiMashSource: 'stateless (NullAiMashSource live and headless)',
    controller: 'included separately as clash.controller',
  },
  RoundState: { ringOutDelayS: 'build-time config: MatchConfig.ringOutDelayS (replay config snapshot)', timeLimitS: 'build-time config: MatchConfig.roundTimeLimitS (replay config snapshot)', winConditions: 'build-time config: MatchConfig.winBy* (replay config snapshot)' },
  HitstopClock: {},
};
