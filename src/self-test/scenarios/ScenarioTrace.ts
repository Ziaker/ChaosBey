// ============================================================
// SCENARIO TRACE
// What a scenario run observed, tick by tick, folded into the few facts
// the GDD 68 presets check (events, states seen, extremes). Pure
// observation of a SelfTestMatchWorld-shaped match; it never changes it.
// ============================================================

import type { Bey } from '../../bey/core/Bey';
import type { MatchTickResult } from '../../app/simulation/tickMatch';
import { ClashState, type ClashController } from '../../combat/clash/ClashController';
import type { RoundState } from '../../combat/round-rules/RoundState';

/** Ticks after the first wall impact over which the rebound is measured. */
const IMPACT_WINDOW_TICKS = 6;
/** Grip comes back exponentially after a drift or a slip (Motion Lab gripRecovery), so "restored" means within 1% of normal. */
const GRIP_RESTORED_FRACTION = 0.99;

export interface ScenarioHit {
  readonly tick: number;
  readonly attackerIsFirst: boolean;
  readonly kind: 'circular' | 'dash';
  readonly caughtOpponentDashing: boolean;
}

export interface ScenarioTrace {
  ticks: number;
  roundOver: boolean;
  outcome: string;
  hits: ScenarioHit[];
  clashStarts: number;
  clashStartedTick: number | null;
  clashResolvedTick: number | null;
  clashOutcome: string | null;
  hitsDuringClashCooldown: number;
  stabilityBreaks: ('first' | 'second')[];
  dodges: ('first' | 'second')[];
  perfectDodges: ('first' | 'second')[];
  maxKnockbackOnSecond: number;
  firstAttackStates: Set<string>;
  finalFirstAttackState: string;
  firstAirborneAttackState: string | null;
  firstDriftStates: Set<string>;
  firstMaxSlipDeg: number;
  /** Ticks the first Bey spent Drifting. */
  firstDriftTicks: number;
  firstMinGripPerS: number;
  firstNormalGripPerS: number;
  firstFinalGripPerS: number;
  /** Lowest lateral grip while Drifting (grounded). */
  firstMinDriftGripPerS: number;
  /** Normal grip seen again, grounded and not drifting, after a drift recovery. */
  firstGripRestoredAfterDrift: boolean;
  /** Ticks since the first wall impact (−1 before it); the impact decomposition takes extremes over a short window. */
  firstTicksSinceImpact: number;
  firstMaxSpeedMps: number;
  firstMinAccelFactor: number;
  firstMaxRadiusM: number;
  firstMaxImpactMps: number;
  secondMaxImpactMps: number;
  /** Most negative outward (radial) velocity after the first wall impact — negative = rebounding inward. */
  firstMinRadialVelocityAfterImpact: number;
  /** Speed along the wall right after the first impact. */
  firstTangentialSpeedAfterImpact: number;
  firstMaxLandingIntensity: number;
  secondAirRecoveryArmed: boolean;
  secondAirRecoveryUsed: boolean;
}

export function createScenarioTrace(first: Bey): ScenarioTrace {
  return {
    ticks: 0,
    roundOver: false,
    outcome: 'Ongoing',
    hits: [],
    clashStarts: 0,
    clashStartedTick: null,
    clashResolvedTick: null,
    clashOutcome: null,
    hitsDuringClashCooldown: 0,
    stabilityBreaks: [],
    dodges: [],
    perfectDodges: [],
    maxKnockbackOnSecond: 0,
    firstAttackStates: new Set(),
    finalFirstAttackState: first.attack.getState(),
    firstAirborneAttackState: null,
    firstDriftStates: new Set(),
    firstMaxSlipDeg: 0,
    firstDriftTicks: 0,
    firstMinGripPerS: Number.POSITIVE_INFINITY,
    firstNormalGripPerS: first.movement.getLateralGripPerS(),
    firstFinalGripPerS: first.definition.handling.lateralGripPerS,
    firstMinDriftGripPerS: Number.POSITIVE_INFINITY,
    firstGripRestoredAfterDrift: false,
    firstTicksSinceImpact: -1,
    firstMaxSpeedMps: 0,
    firstMinAccelFactor: 1,
    firstMaxRadiusM: 0,
    firstMaxImpactMps: 0,
    secondMaxImpactMps: 0,
    firstMinRadialVelocityAfterImpact: 0,
    firstTangentialSpeedAfterImpact: 0,
    firstMaxLandingIntensity: 0,
    secondAirRecoveryArmed: false,
    secondAirRecoveryUsed: false,
  };
}

export interface ScenarioTickFacts {
  readonly tick: number;
  readonly first: Bey;
  readonly second: Bey;
  readonly result: MatchTickResult;
  readonly roundState: RoundState;
  readonly clash: ClashController;
  readonly clashStateBefore: ClashState;
  /** False on a hitstop-frozen tick: the result is the previous tick's, so its events were already recorded. */
  readonly advanced: boolean;
}

/** Folds one tick into the trace. */
export function recordScenarioTick(trace: ScenarioTrace, facts: ScenarioTickFacts): void {
  const { tick, first, second, result, clash } = facts;
  trace.ticks = tick + 1;
  trace.roundOver = facts.roundState.isOver;
  trace.outcome = facts.roundState.result;

  const clashState = clash.getState();
  if (clashState === ClashState.Active && facts.clashStateBefore !== ClashState.Active) {
    trace.clashStarts++;
    trace.clashStartedTick ??= tick;
  }
  if (facts.advanced) {
    if (result.clashResolvedThisTick) {
      trace.clashResolvedTick ??= tick;
      trace.clashOutcome ??= result.clashResolvedThisTick.outcome;
    }
    for (const hit of result.hitEvents) {
      trace.hits.push({ tick, attackerIsFirst: hit.attackerIsFirst, kind: hit.hitbox.kind, caughtOpponentDashing: hit.caughtOpponentDashing });
      if (clashState === ClashState.Cooldown) trace.hitsDuringClashCooldown++;
    }
    for (const event of result.combatEvents) {
      const side = event.targetIsFirst ? 'first' : 'second';
      if (event.kind === 'stabilityBreak') trace.stabilityBreaks.push(side);
      if (event.kind === 'dodged') trace.dodges.push(side);
      if (event.kind === 'perfectDodge') trace.perfectDodges.push(side);
      if (event.kind === 'knockback' && !event.targetIsFirst) trace.maxKnockbackOnSecond = Math.max(trace.maxKnockbackOnSecond, event.force);
    }
  }

  const a = result.first;
  trace.firstAttackStates.add(a.attackState);
  trace.finalFirstAttackState = a.attackState;
  if (!a.grounded && (a.attackState === 'CircularActive' || a.attackState === 'DashActive')) trace.firstAirborneAttackState ??= a.attackState;
  trace.firstDriftStates.add(a.driftState);
  if (a.driftState === 'Drifting') trace.firstDriftTicks++;
  trace.firstMaxSlipDeg = Math.max(trace.firstMaxSlipDeg, Math.abs(a.movement.slipAngleRad) * (180 / Math.PI));
  trace.firstMinGripPerS = Math.min(trace.firstMinGripPerS, a.movement.lateralGripPerS);
  trace.firstFinalGripPerS = a.movement.lateralGripPerS;
  if (a.driftState === 'Drifting' && a.grounded) trace.firstMinDriftGripPerS = Math.min(trace.firstMinDriftGripPerS, a.movement.lateralGripPerS);
  if (trace.firstDriftStates.has('Recovering') && a.driftState === 'Idle' && a.grounded && a.movement.lateralGripPerS >= trace.firstNormalGripPerS * GRIP_RESTORED_FRACTION) {
    trace.firstGripRestoredAfterDrift = true;
  }
  trace.firstMaxSpeedMps = Math.max(trace.firstMaxSpeedMps, a.movement.speedMps);
  trace.firstMinAccelFactor = Math.min(trace.firstMinAccelFactor, first.stamina.getPhysicalCondition().accelFactor);
  if (a.justLanded) trace.firstMaxLandingIntensity = Math.max(trace.firstMaxLandingIntensity, a.landingIntensity);

  const p = first.body.translation();
  const radius = Math.hypot(p.x, p.z);
  trace.firstMaxRadiusM = Math.max(trace.firstMaxRadiusM, radius);
  if (a.movement.impactDeltaSpeedMps > 0 && trace.firstTicksSinceImpact < 0) trace.firstTicksSinceImpact = 0;
  // Over the first few ticks after the first impact, decompose velocity
  // along the arena radius: most inward (negative) radial speed, fastest
  // speed along the wall.
  if (trace.firstTicksSinceImpact >= 0 && trace.firstTicksSinceImpact <= IMPACT_WINDOW_TICKS) {
    const v = first.body.linvel();
    const rx = radius > 1e-6 ? p.x / radius : 0;
    const rz = radius > 1e-6 ? p.z / radius : 0;
    trace.firstMinRadialVelocityAfterImpact = Math.min(trace.firstMinRadialVelocityAfterImpact, v.x * rx + v.z * rz);
    trace.firstTangentialSpeedAfterImpact = Math.max(trace.firstTangentialSpeedAfterImpact, Math.abs(-v.x * rz + v.z * rx));
    trace.firstTicksSinceImpact++;
  }
  trace.firstMaxImpactMps = Math.max(trace.firstMaxImpactMps, a.movement.impactDeltaSpeedMps);
  trace.secondMaxImpactMps = Math.max(trace.secondMaxImpactMps, result.second.movement.impactDeltaSpeedMps);

  if (second.dodge.isAirRecoveryAvailable()) trace.secondAirRecoveryArmed = true;
  if (trace.secondAirRecoveryArmed && !second.dodge.isAirRecoveryAvailable() && !result.second.grounded) trace.secondAirRecoveryUsed = true;
}
