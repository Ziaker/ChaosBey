// ============================================================
// MATCH ANOMALY DETECTOR (GDD section 67)
// Per-tick checks for the suspicious conditions GDD 67 lists, beyond the
// non-finite / excessive-velocity checks AiMatchSimulation already runs
// (physicsSafety.ts). Pure observation: it reads the Beys, the tick result
// and the match state, and never changes them.
//
// Every continuing condition (a Clash that never ends, a Bey inside a
// wall...) is reported ONCE when it crosses its threshold — an episode,
// not a flood of per-tick lines — and may be reported again only after the
// condition clears.
//
// Coverage of GDD 67:
// - NaN/Infinity, impossible (angular) velocity ....... physicsSafety.ts via AiMatchSimulation
// - invalid quaternion/rotation ....................... invalid-rotation
// - Bey leaving world without valid ring-out .......... left-world
// - penetration through arena ......................... below-floor
// - stuck inside wall ................................. stuck-in-wall
// - state machine contradiction ....................... state-contradiction
// - negative resource / resource above max ............ resource-out-of-range
// - permanent invulnerability ......................... permanent-invulnerability
// - permanent hitstop ................................. permanent-hitstop
// - permanent Clash ................................... permanent-clash
// - cooldown never ending ............................. cooldown-never-ending
// - wobble exploding numerically ...................... wobble-explosion
// - spin becoming non-finite .......................... non-finite-spin
// - physics body disappearing ......................... body-missing
// - AI unable to act for abnormal duration ............ ai-inactive (warning)
// - match never terminating ........................... AiBatchRunner `hang`
// - unhandled JS error ................................ AiBatchRunner `crash`
// - replay/state hash divergence ...................... AiBatchRunner `divergence` (verifyReplays, M9)
// ============================================================

import type { Bey } from '../../bey/core/Bey';
import { WOBBLE_ENERGY_MAX } from '../../bey/spin/SpinTuning';
import { STABILITY_BROKEN_RECOVERY_FLOOR } from '../../bey/stability/StabilityTuning';
import { ARENA_FLOOR_RADIUS, ARENA_WALL_HEIGHT, ARENA_WALL_THICKNESS, arenaFloorRadius } from '../../arena/colliders/ArenaTuning';
import { floorRimHeight } from '../../arena/floor/ArenaFloorProfile';
import { arenaFloorOf, type MatchConfig } from '../../config/match/MatchConfig';
import { RINGOUT_RADIUS_M, ringOutRadiusM } from '../../arena/ringout/RingOutTuning';
import type { MatchTickResult } from '../../app/simulation/tickMatch';
import { ClashState, type ClashController } from '../../combat/clash/ClashController';
import { CLASH_COOLDOWN_S, CLASH_TARGET_DURATION_S } from '../../combat/clash/ClashTuning';
import type { RoundState } from '../../combat/round-rules/RoundState';
import { DodgeState } from '../../dodge/DodgeController';
import { DODGE_ACTIVE_DURATION_S, DODGE_COOLDOWN_S } from '../../dodge/DodgeTuning';
import type { ControllerActions } from '../../input/actions/Action';
import { FIXED_TICKS_PER_SECOND } from '../../physics/fixed-step/FixedTimestepLoop';

// ============================================================
// ANOMALY DETECTION — THRESHOLDS (GDD 67: "thresholds must be tunable/documented")
// Seconds are converted to fixed ticks at 60 Hz. Each value sits well
// outside anything the rules can produce, so a hit means a bug, not
// unusual-but-legal play.
// ============================================================

export interface AnomalyThresholds {
  /** |‖q‖ − 1| above this is an invalid rotation (Rapier keeps quaternions unit length). */
  readonly rotationNormTolerance: number;
  /** A Bey centre farther than this from the arena centre, with the round still running, left the world without a ring-out (m). RingOut fires at RINGOUT_RADIUS_M. */
  readonly leftWorldRadiusM: number;
  /** A Bey centre below this height went through the floor (m). Spawn height is 0.6 m, the floor top is y = 0. */
  readonly belowFloorYM: number;
  /** A Bey centre farther than this from the centre, below the wall's top, is inside the wall (m) — the wall's inner face is ARENA_FLOOR_RADIUS − ARENA_WALL_THICKNESS / 2. */
  readonly insideWallRadiusM: number;
  /** Top of the boundary wall (m): above it a Bey is flying over the wall, not stuck in it. The match's own wall (M10 arena slider). */
  readonly wallHeightM: number;
  /** Ticks inside the wall before it counts as stuck. */
  readonly stuckInWallTicks: number;
  /** Tolerance for a resource below 0 or above its max. */
  readonly resourceTolerance: number;
  /** Ticks a dodge may stay in its i-frame state (DODGE_ACTIVE_DURATION_S + slack) before it is permanent invulnerability. */
  readonly maxDodgingTicks: number;
  /** Ticks of continuous hitstop before it counts as permanent. */
  readonly maxHitstopTicks: number;
  /** Ticks a Clash may stay Active (~4 s target + slack). */
  readonly maxClashActiveTicks: number;
  /** Ticks the Clash cooldown may last (10 s + slack). */
  readonly maxClashCooldownTicks: number;
  /** Ticks the dodge cooldown may last (3 s + slack). */
  readonly maxDodgeCooldownTicks: number;
  /** Wobble energy above WOBBLE_ENERGY_MAX × this is a numeric explosion (the system clamps to its max). */
  readonly wobbleOverMaxFactor: number;
  /** Ticks an AI side may press nothing, outside a Clash, with the round running, before it is flagged (warning). */
  readonly aiInactiveTicks: number;
}

const SLACK_TICKS = FIXED_TICKS_PER_SECOND; // one second of slack on every "should have ended by now" limit.

export const DEFAULT_ANOMALY_THRESHOLDS: AnomalyThresholds = {
  rotationNormTolerance: 1e-3,
  leftWorldRadiusM: RINGOUT_RADIUS_M + 1,
  belowFloorYM: -1,
  insideWallRadiusM: ARENA_FLOOR_RADIUS - ARENA_WALL_THICKNESS / 2,
  wallHeightM: ARENA_WALL_HEIGHT,
  stuckInWallTicks: Math.round(0.5 * FIXED_TICKS_PER_SECOND),
  resourceTolerance: 1e-6,
  maxDodgingTicks: Math.round(DODGE_ACTIVE_DURATION_S * FIXED_TICKS_PER_SECOND) + SLACK_TICKS,
  maxHitstopTicks: 2 * FIXED_TICKS_PER_SECOND,
  maxClashActiveTicks: Math.round(CLASH_TARGET_DURATION_S * FIXED_TICKS_PER_SECOND) + 2 * SLACK_TICKS,
  maxClashCooldownTicks: Math.round(CLASH_COOLDOWN_S * FIXED_TICKS_PER_SECOND) + SLACK_TICKS,
  maxDodgeCooldownTicks: Math.round(DODGE_COOLDOWN_S * FIXED_TICKS_PER_SECOND) + SLACK_TICKS,
  wobbleOverMaxFactor: 1.001,
  aiInactiveTicks: 10 * FIXED_TICKS_PER_SECOND,
};

/**
 * The thresholds for one match's own rules: its wall (M10 arena slider) and its dodge cooldown (Pregame slider, up to 6 s —
 * a fixed limit flagged any cooldown past the default). The radii follow the stage size on their own (see tick()).
 */
export function anomalyThresholdsFor(config: MatchConfig): AnomalyThresholds {
  return {
    ...DEFAULT_ANOMALY_THRESHOLDS,
    wallHeightM: floorRimHeight(arenaFloorOf(config)) + config.arenaWallHeightM,
    maxDodgeCooldownTicks: Math.round(config.dodgeCooldownS * FIXED_TICKS_PER_SECOND) + SLACK_TICKS,
  };
}

export type DetectedAnomalyKind =
  | 'invalid-rotation'
  | 'left-world'
  | 'below-floor'
  | 'stuck-in-wall'
  | 'state-contradiction'
  | 'resource-out-of-range'
  | 'permanent-invulnerability'
  | 'permanent-hitstop'
  | 'permanent-clash'
  | 'cooldown-never-ending'
  | 'wobble-explosion'
  | 'non-finite-spin'
  | 'body-missing'
  | 'ai-inactive';

/** `invalid-state` fails the match; `warning` is reported but does not. */
export type AnomalySeverity = 'invalid-state' | 'warning';

export interface DetectedAnomaly {
  readonly kind: DetectedAnomalyKind;
  readonly severity: AnomalySeverity;
  readonly tick: number;
  readonly side: 'first' | 'second' | 'match';
  readonly detail: string;
  /**
   * Set when the finding matches an already-recorded bug, so a batch can
   * tell a known problem from a new one. It still counts as an invalid
   * state: the Self-Test reports the bug, it doesn't hide it.
   */
  readonly knownIssue: KnownIssueId | null;
}

/**
 * Recorded bugs a detection can be matched to, so a batch can tell a known
 * problem from a new one. None open today.
 * - `ext-32` (the arena wall: a Bey wedged in or past the edge wall, then
 *   falling off the rim with no ring-out) was FIXED in M11 lane 3: the wall
 *   segments were rotated `angle + π/2` instead of `π/2 − angle`, so around
 *   ±45°/±135° they stood radially with open gaps between them
 *   (arena/colliders/createArenaColliders.ts). Its detections are no longer
 *   tagged: a Bey in the wall or off the rim is an unknown invalid state
 *   again and fails the batch.
 */
export type KnownIssueId = never;

export const KNOWN_ISSUES: Readonly<Record<KnownIssueId, string>> = {};

export const ANOMALY_SEVERITY: Readonly<Record<DetectedAnomalyKind, AnomalySeverity>> = {
  'invalid-rotation': 'invalid-state',
  'left-world': 'invalid-state',
  'below-floor': 'invalid-state',
  'stuck-in-wall': 'invalid-state',
  'state-contradiction': 'invalid-state',
  'resource-out-of-range': 'invalid-state',
  'permanent-invulnerability': 'invalid-state',
  'permanent-hitstop': 'invalid-state',
  'permanent-clash': 'invalid-state',
  'cooldown-never-ending': 'invalid-state',
  'wobble-explosion': 'invalid-state',
  'non-finite-spin': 'invalid-state',
  'body-missing': 'invalid-state',
  'ai-inactive': 'warning',
};

export interface AnomalyTickInput {
  readonly tick: number;
  readonly first: Bey;
  readonly second: Bey;
  readonly result: MatchTickResult;
  readonly roundState: RoundState;
  readonly clash: ClashController;
  readonly firstActions: ControllerActions;
  readonly secondActions: ControllerActions;
  /** Which sides an AI drives (ai-inactive only applies to those). */
  readonly aiSides: { readonly first: boolean; readonly second: boolean };
  /** Whether hitstop froze this tick (every caller that runs MatchStepper knows it; omit only when stepping tickMatch() directly). */
  readonly hitstopActive?: boolean;
}

type Side = 'first' | 'second';

/** One streak per (condition, side); reported once when it reaches its limit. */
class Streak {
  private count = 0;
  private reported = false;
  /**
   * Returns true exactly on the tick the streak reaches `limit`. `frozen`
   * ticks (a Clash, hitstop or a finished round froze the simulation, so
   * no gameplay timer moved) neither extend nor reset the streak.
   */
  step(active: boolean, limit: number, frozen = false): boolean {
    if (frozen) return false;
    if (!active) {
      this.count = 0;
      this.reported = false;
      return false;
    }
    this.count++;
    if (!this.reported && this.count >= limit) {
      this.reported = true;
      return true;
    }
    return false;
  }
  get ticks(): number {
    return this.count;
  }
}

/** Reported once per episode for an instantaneous condition. */
class Latch {
  private active = false;
  step(active: boolean): boolean {
    const rising = active && !this.active;
    this.active = active;
    return rising;
  }
}

export class MatchAnomalyDetector {
  private readonly streaks = new Map<string, Streak>();
  private readonly latches = new Map<string, Latch>();
  /** Per side: its running ring-out clock started past the floor's edge (left over the wall), see check(). */
  private readonly offArenaEpisode = { first: false, second: false };

  constructor(private readonly thresholds: AnomalyThresholds = DEFAULT_ANOMALY_THRESHOLDS) {}

  check(input: AnomalyTickInput): DetectedAnomaly[] {
    const found: DetectedAnomaly[] = [];
    const emit = (kind: DetectedAnomalyKind, side: Side | 'match', detail: string, knownIssue: KnownIssueId | null = null): void => {
      found.push({ kind, severity: ANOMALY_SEVERITY[kind], tick: input.tick, side, detail, knownIssue });
    };
    const t = this.thresholds;
    // The stage-size slider (MatchConfig.arenaSizeScale) moves every radius: the thresholds are the default stage's, so
    // they grow by how much bigger this match's floor is (0 at the default size, which keeps every limit as it was).
    const floorRadiusM = arenaFloorRadius();
    const ringOutM = ringOutRadiusM();
    const stageGrowthM = floorRadiusM - ARENA_FLOOR_RADIUS;
    const leftWorldRadiusM = t.leftWorldRadiusM + stageGrowthM;
    const insideWallRadiusM = t.insideWallRadiusM + stageGrowthM;
    const roundRunning = !input.roundState.isOver;
    // tickMatch does not advance any per-Bey timer while a Clash is Active,
    // hitstop is frozen or the round is over: those ticks can't make a
    // timer-based condition "permanent".
    const frozen = !roundRunning || input.clash.getState() === ClashState.Active || input.hitstopActive === true;

    for (const side of ['first', 'second'] as const) {
      const bey = side === 'first' ? input.first : input.second;
      const snapshot = input.result[side];
      const key = (name: string): string => `${name}:${side}`;

      const bodyValid = bey.body.isValid() && bey.collider.isValid();
      if (this.latch(key('body'), !bodyValid)) emit('body-missing', side, 'rigid body or collider is no longer valid in the physics world');
      if (!bodyValid) continue;

      const q = bey.body.rotation();
      const norm = Math.hypot(q.x, q.y, q.z, q.w);
      const badRotation = !Number.isFinite(norm) || Math.abs(norm - 1) > t.rotationNormTolerance;
      if (this.latch(key('rotation'), badRotation)) emit('invalid-rotation', side, `rotation quaternion norm ${norm} (expected 1 ± ${t.rotationNormTolerance})`);

      const p = bey.body.translation();
      const radius = Math.hypot(p.x, p.z);
      // Ring-out delay (owner, 2026-10-02): a Bey whose ring-out clock started past the floor's edge left the arena over
      // the wall; until the delay elapses it may legitimately be past the radius, falling off the rim or even under the
      // bowl. Only one the ring-out rule never saw outside left the world, and one whose clock started inside the floor
      // radius went through the floor.
      if (input.roundState.ringOutClock[side] === 0) this.offArenaEpisode[side] = false;
      else if (radius > floorRadiusM) this.offArenaEpisode[side] = true;
      // A Bey on a rail (Rail Grinding, 0.56.0) is carried round the OUTSIDE of the arena by design: it is neither out of the world nor under the floor.
      const onRail = bey.rail.isOnRail();
      const ringOutPending = this.offArenaEpisode[side] || onRail;
      if (this.latch(key('left'), roundRunning && radius > leftWorldRadiusM && !ringOutPending)) {
        emit('left-world', side, `centre ${radius.toFixed(2)} m from the arena centre (limit ${leftWorldRadiusM.toFixed(2)} m) with no ring-out declared`);
      }
      if (this.latch(key('floor'), p.y < t.belowFloorYM && !ringOutPending)) {
        // Past the floor's edge (outside the wall) it fell off the rim (what
        // the fixed ext-32 wall gaps used to cause); inside it, it went
        // through the floor.
        const offTheRim = radius > floorRadiusM;
        emit(
          'below-floor',
          side,
          offTheRim
            ? `centre height ${p.y.toFixed(3)} m at r = ${radius.toFixed(2)} m: fell off the floor edge outside the wall with no ring-out (ring-out radius ${ringOutM} m > floor radius ${floorRadiusM} m)`
            : `centre height ${p.y.toFixed(3)} m is below ${t.belowFloorYM} m — through the floor`,
          null,
        );
      }
      const insideWall = roundRunning && radius > insideWallRadiusM && radius < ringOutM && p.y < t.wallHeightM;
      if (this.streak(key('wall'), insideWall, t.stuckInWallTicks, frozen)) {
        emit('stuck-in-wall', side, `centre inside the wall band (r = ${radius.toFixed(2)} m > ${insideWallRadiusM.toFixed(2)} m, y = ${p.y.toFixed(2)} m) for ${t.stuckInWallTicks} ticks`, null);
      }

      for (const [name, resource] of [
        ['Stamina', bey.stamina.resource],
        ['Stability', bey.stability.resource],
      ] as const) {
        const bad = !Number.isFinite(resource.value) || resource.value < -t.resourceTolerance || resource.value > resource.max + t.resourceTolerance;
        if (this.latch(key(`resource-${name}`), bad)) emit('resource-out-of-range', side, `${name} = ${resource.value} outside [0, ${resource.max}]`);
      }

      const brokenAboveFloor = bey.stability.isBroken && bey.stability.resource.value >= STABILITY_BROKEN_RECOVERY_FLOOR;
      if (this.latch(key('broken'), brokenAboveFloor)) {
        emit('state-contradiction', side, `Broken with Stability ${bey.stability.resource.value.toFixed(2)} ≥ recovery floor ${STABILITY_BROKEN_RECOVERY_FLOOR}`);
      }

      if (this.streak(key('dodging'), bey.dodge.getState() === DodgeState.Dodging, t.maxDodgingTicks, frozen)) {
        emit('permanent-invulnerability', side, `dodge i-frame state held for ${t.maxDodgingTicks} ticks (expected ≤ ${Math.round(DODGE_ACTIVE_DURATION_S * FIXED_TICKS_PER_SECOND)})`);
      }
      if (this.streak(key('dodge-cooldown'), bey.dodge.getState() === DodgeState.Cooldown, t.maxDodgeCooldownTicks, frozen)) {
        emit('cooldown-never-ending', side, `dodge cooldown lasted ${t.maxDodgeCooldownTicks} ticks (limit = the match's dodge cooldown + 1 s)`);
      }

      const spin = snapshot.spin;
      if (this.latch(key('spin'), !Number.isFinite(spin.spinRateRadPerSec) || !Number.isFinite(spin.tiltRad) || !Number.isFinite(spin.visualSpinAngleRad))) {
        emit('non-finite-spin', side, `spin rate ${spin.spinRateRadPerSec}, tilt ${spin.tiltRad}, visual angle ${spin.visualSpinAngleRad}`);
      }
      const wobbleBad = !Number.isFinite(spin.wobbleEnergy) || spin.wobbleEnergy > WOBBLE_ENERGY_MAX * t.wobbleOverMaxFactor;
      if (this.latch(key('wobble'), wobbleBad)) emit('wobble-explosion', side, `wobble energy ${spin.wobbleEnergy} exceeds max ${WOBBLE_ENERGY_MAX}`);

      const actions = side === 'first' ? input.firstActions : input.secondActions;
      const clashActive = input.clash.getState() === ClashState.Active;
      const inactive = input.aiSides[side] && roundRunning && !clashActive && actions.held.size === 0 && actions.pressedThisFrame.size === 0;
      if (this.streak(key('ai-inactive'), inactive, t.aiInactiveTicks, frozen)) {
        emit('ai-inactive', side, `AI pressed nothing for ${t.aiInactiveTicks} ticks (${(t.aiInactiveTicks / FIXED_TICKS_PER_SECOND).toFixed(0)} s) outside a Clash`);
      }
    }

    const clashState = input.clash.getState();
    if (this.latch('clash-after-round', !roundRunning && clashState === ClashState.Active)) emit('state-contradiction', 'match', 'Clash Active while the round is already over');
    if (this.streak('clash-active', clashState === ClashState.Active, t.maxClashActiveTicks)) {
      emit('permanent-clash', 'match', `Clash Active for ${t.maxClashActiveTicks} ticks (target ${CLASH_TARGET_DURATION_S} s)`);
    }
    const clashCooldownBad = clashState === ClashState.Cooldown && input.clash.getCooldownRemainingS() > CLASH_COOLDOWN_S + 1e-6;
    // A Clash that becomes Active again is the end of the cooldown, not a freeze of it: only hitstop and a finished round pause this
    // streak (counting through the next Clash used to add one cooldown's ticks to the following one — a false "never ending" when
    // two Clashes came one cooldown apart).
    const cooldownPaused = !roundRunning || input.hitstopActive === true;
    if (this.streak('clash-cooldown', clashState === ClashState.Cooldown, t.maxClashCooldownTicks, cooldownPaused) || this.latch('clash-cooldown-range', clashCooldownBad)) {
      emit('cooldown-never-ending', 'match', `Clash cooldown lasting past ${CLASH_COOLDOWN_S} s (remaining ${input.clash.getCooldownRemainingS().toFixed(2)} s)`);
    }
    if (input.hitstopActive !== undefined && this.streak('hitstop', input.hitstopActive, t.maxHitstopTicks)) {
      emit('permanent-hitstop', 'match', `hitstop held gameplay frozen for ${t.maxHitstopTicks} ticks`);
    }
    return found;
  }

  private streak(key: string, active: boolean, limit: number, frozen = false): boolean {
    let streak = this.streaks.get(key);
    if (!streak) {
      streak = new Streak();
      this.streaks.set(key, streak);
    }
    return streak.step(active, limit, frozen);
  }

  private latch(key: string, active: boolean): boolean {
    let latch = this.latches.get(key);
    if (!latch) {
      latch = new Latch();
      this.latches.set(key, latch);
    }
    return latch.step(active);
  }
}
