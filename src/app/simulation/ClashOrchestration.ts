// ============================================================
// CLASH ORCHESTRATION
// Wires Milestone 5's pure ClashController (src/combat/clash/, which is
// deliberately self-contained with no imports outside its own folder) into
// tickMatch()'s real hit-detection/knockback pipeline. This file is where
// that pure state machine meets real HitEvent/Knockback/Rapier data — it
// is NOT part of the pure package and is free to depend on the rest of the
// combat system.
//
// Compatible-attack detection (GDD: two attacks connecting within 150ms
// can Clash): a connecting hit is resolved immediately, at zero added
// latency, UNLESS the defender's own attack is currently "engaged"
// (Buffering/ChargingDash/CircularActive/DashActive — i.e. genuinely
// capable of landing its own hit soon) at that exact moment. Only then is
// the hit briefly held (`pendingHit`) awaiting a possible compatible
// connect from that other side, for at most CLASH_WINDOW_S — the ONLY
// case this can ever add latency to. isWithinClashWindow() (fed the real
// elapsed-seconds delta between the two hits' connect times) stays the
// single source of truth for "compatible"; a solo hit (opponent not
// engaged at all) is completely untouched, exactly as before Milestone 5
// existed.
//
// A same-tick double connect is just the delta=0 case of the same
// mechanism — no special-casing needed. Idle -> starts a Clash and
// withholds both hits from normal resolution entirely; Cooldown -> both
// hits still resolve normally, just through the "slower suffers more"
// cooldown alternative multiplier instead of a fresh Clash (GDD
// requirement).
//
// While the ClashController is Active, tickMatch() freezes the entire
// normal simulation for the ~4s presentation (no physics step, no
// movement/attack/resource ticking) — mirroring Milestone 4's hitstop
// freeze pattern, just for the whole contest instead of a few frames. The
// real physical resolution (knockback for FirstWins/SecondWins, symmetric
// repulsion for Tie) is applied the instant the controller transitions
// Active -> Cooldown; physics then decides everything afterward normally,
// so a ring-out from a Clash is never declared by Clash itself, only by
// the ordinary isRingOut() check on a later tick.
// ============================================================

import type { Bey } from '../../bey/core/Bey';
import { Action, type ControllerActions } from '../../input/actions/Action';
import { AttackState } from '../../combat/attacks/AttackController';
import { applyKnockback, computeKnockback, computeStabilityDamage } from '../../combat/knockback/Knockback';
import { KNOCKBACK_IMPULSE_PER_FORCE_UNIT, KNOCKBACK_UPWARD_LAUNCH_FRACTION } from '../../combat/knockback/KnockbackTuning';
import type { HitEvent } from '../../combat/hit-detection/HitDetection';
import { isGrounded } from '../../physics/collision/GroundCheck';
import type { PhysicsWorld } from '../../physics/world/PhysicsWorld';
import { normalize, scale, subtract, type Vec2 } from '../../physics/Vec2';
import { ClashController, ClashOutcome, ClashState, type ClashCombatantInputTick, type ClashResult } from '../../combat/clash/ClashController';
import { isWithinClashWindow } from '../../combat/clash/ClashWindow';
import { FixedIntervalAiMashSource } from '../../combat/clash/ClashMash';
import { CLASH_AI_MASH_INTERVAL_TICKS, CLASH_TIE_REPULSION_BASE_FORCE } from '../../combat/clash/ClashTuning';
import { computeCooldownAlternativeMultiplier } from '../../combat/clash/ClashCooldownResolution';
import type { MatchConfig } from '../../config/match/MatchConfig';

/** Only Z/X/C (Attack/JumpDrift/Dodge) count as Clash mash input — see ClashMash.ts's simultaneous-presses-count-as-one rule, which this Set naturally preserves. */
const CLASH_MASH_ACTIONS: ReadonlySet<Action> = new Set([Action.Attack, Action.JumpDrift, Action.Dodge]);

export function buildMashActionSet(actions: ControllerActions): ReadonlySet<string> {
  const pressed = new Set<string>();
  for (const action of actions.pressedThisFrame) {
    if (CLASH_MASH_ACTIONS.has(action)) pressed.add(action);
  }
  return pressed;
}

/** Attack states with a live or imminent hitbox — a defender in one of these could still land their own compatible hit soon, so a connecting hit against them is worth briefly holding for a possible Clash pair. Deliberately excludes Recovery states: by then that attack's hitbox is already gone, so it cannot itself become the "other side" of a fresh compatible pair. */
const ENGAGED_ATTACK_STATES: ReadonlySet<AttackState> = new Set([
  AttackState.Buffering,
  AttackState.ChargingDash,
  AttackState.CircularActive,
  AttackState.DashActive,
]);

/** Everything a connecting hit's normal knockback/Stability resolution needs, captured at the moment it connected this tick. */
export interface HitSnapshotInput {
  hit: HitEvent;
  attackerPositionXZ: Vec2;
  defenderPositionXZ: Vec2;
  attackerVelocityXZ: Vec2;
  attackerSpeedMps: number;
  attackerStaminaFraction: number;
  defenderSpeedMps: number;
  defenderStabilityFraction: number;
  defenderStaminaPenaltyFraction: number;
  /** The defender's own AttackState at the moment this hit connected — whether they, too, currently have a live/imminent hitbox that could make this pair "compatible" within the window. */
  defenderAttackState: AttackState;
}

export interface ResolvedHitToApply extends HitSnapshotInput {
  /** 1 for a normal, non-Clash-related resolution; the cooldown-alternative multiplier when this hit is resolving via that path instead of a fresh Clash. */
  forceMultiplier: number;
}

interface ClashPair {
  firstAttackerHit: HitSnapshotInput;
  secondAttackerHit: HitSnapshotInput;
}

export interface ActiveClashResolution {
  result: ClashResult;
  pair: ClashPair;
}

/** Outcome of physically applying an Active -> Cooldown resolution — raw data only, so tickMatch.ts can build its own CombatEvent entries from it without this file needing to import tickMatch's types (would be circular). */
export interface ClashResolutionOutcome {
  outcome: ClashOutcome;
  /** Present only for FirstWins/SecondWins (the loser). Absent for Tie — Tie deals no Stability damage/KO, only a symmetric physical repulsion. */
  loserIsFirst?: boolean;
  knockbackForce?: number;
  stabilityDamageAmount?: number;
  causedBreak?: boolean;
  isQualifyingKoHit?: boolean;
}

function order(a: HitSnapshotInput, b: HitSnapshotInput): ClashPair {
  return a.hit.attackerIsFirst ? { firstAttackerHit: a, secondAttackerHit: b } : { firstAttackerHit: b, secondAttackerHit: a };
}

export class ClashOrchestration {
  readonly controller = new ClashController();
  private readonly aiMashSource = new FixedIntervalAiMashSource(CLASH_AI_MASH_INTERVAL_TICKS);
  private activeClashLocalTickIndex = 0;
  private activeClashPair: ClashPair | null = null;
  private matchElapsedS = 0;
  private pendingHit: { hit: HitSnapshotInput; atS: number } | null = null;

  constructor(private readonly matchConfig: MatchConfig) {}

  /**
   * Call once per normal (non-Active) tickMatch() tick with this tick's
   * post-i-frame connecting hits (0, 1, or 2 of them) — tickMatch() skips
   * this (and the whole normal hit-resolution path) entirely while
   * Active; see tickActive() below for that branch. Also advances the
   * match clock the compatible-window check is measured against.
   */
  processTickHits(fixedDeltaSeconds: number, hits: HitSnapshotInput[]): { toResolveNormally: ResolvedHitToApply[] } {
    this.matchElapsedS += fixedDeltaSeconds;
    const results: ResolvedHitToApply[] = [];

    // Catches (Circular-catches-Dash) never participate in Clash — always immediate, unchanged.
    const catches = hits.filter((h) => h.hit.caughtOpponentDashing);
    results.push(...catches.map((h) => ({ ...h, forceMultiplier: 1 })));
    const newHits = hits.filter((h) => !h.hit.caughtOpponentDashing);

    // A stale pending hit (no compatible partner arrived within the window) resolves belated, exactly as if Clash didn't exist. Same isWithinClashWindow() used for the actual match below — its negation is exactly "the window has closed".
    if (this.pendingHit && !isWithinClashWindow(this.matchElapsedS - this.pendingHit.atS)) {
      results.push({ ...this.pendingHit.hit, forceMultiplier: 1 });
      this.pendingHit = null;
    }

    const firstHit = newHits.find((h) => h.hit.attackerIsFirst) ?? null;
    const secondHit = newHits.find((h) => !h.hit.attackerIsFirst) ?? null;

    if (firstHit && secondHit) {
      // Same-tick double connect — delta 0, always compatible. Any unrelated pending hit is a different exchange by now; flush it normally first.
      if (this.pendingHit) {
        results.push({ ...this.pendingHit.hit, forceMultiplier: 1 });
        this.pendingHit = null;
      }
      results.push(...this.resolvePair(order(firstHit, secondHit)));
      return { toResolveNormally: results };
    }

    const newHit = firstHit ?? secondHit;
    if (!newHit) return { toResolveNormally: results };

    if (this.pendingHit && this.pendingHit.hit.hit.attackerIsFirst !== newHit.hit.attackerIsFirst && isWithinClashWindow(this.matchElapsedS - this.pendingHit.atS)) {
      // Cross-tick compatible pair found.
      const pair = order(this.pendingHit.hit, newHit);
      this.pendingHit = null;
      results.push(...this.resolvePair(pair));
      return { toResolveNormally: results };
    }

    // No match — this new hit is fresh. Any pending hit left over (same side, or a window mismatch) belongs to a different exchange; flush it normally.
    if (this.pendingHit) {
      results.push({ ...this.pendingHit.hit, forceMultiplier: 1 });
      this.pendingHit = null;
    }

    if (ENGAGED_ATTACK_STATES.has(newHit.defenderAttackState)) {
      // The defender could still land their own compatible hit shortly — hold this one instead of resolving immediately.
      this.pendingHit = { hit: newHit, atS: this.matchElapsedS };
    } else {
      results.push({ ...newHit, forceMultiplier: 1 });
    }

    return { toResolveNormally: results };
  }

  /** Routes a matched compatible pair into a fresh Clash (Idle) or the cooldown alternative (Cooldown) — never both hits resolving normally at once. */
  private resolvePair(pair: ClashPair): ResolvedHitToApply[] {
    if (this.controller.isOnCooldown()) {
      return [
        { ...pair.firstAttackerHit, forceMultiplier: computeCooldownAlternativeMultiplier(pair.firstAttackerHit.defenderSpeedMps, pair.firstAttackerHit.attackerSpeedMps) },
        { ...pair.secondAttackerHit, forceMultiplier: computeCooldownAlternativeMultiplier(pair.secondAttackerHit.defenderSpeedMps, pair.secondAttackerHit.attackerSpeedMps) },
      ];
    }

    if (this.controller.getState() === ClashState.Idle) {
      this.activeClashPair = pair;
      this.activeClashLocalTickIndex = 0;
      this.controller.tryStart({
        firstStaminaFraction: pair.firstAttackerHit.attackerStaminaFraction,
        secondStaminaFraction: pair.secondAttackerHit.attackerStaminaFraction,
        firstSpeedMps: pair.firstAttackerHit.attackerSpeedMps,
        secondSpeedMps: pair.secondAttackerHit.attackerSpeedMps,
      });
      return []; // Both hits consumed into the Clash — no normal knockback for either.
    }

    // Active — unreachable in practice (tickMatch() never calls processTickHits while Active), kept as a safe fallback rather than silently dropping the hits.
    return [
      { ...pair.firstAttackerHit, forceMultiplier: 1 },
      { ...pair.secondAttackerHit, forceMultiplier: 1 },
    ];
  }

  /** Advances the Clash by one tick while it is Idle (a no-op) or Cooldown (decrements the countdown, returning to Idle at 0) — call this once per normal (non-Active) tickMatch() tick so Cooldown actually elapses; ClashController.tick() ignores its input parameters entirely outside of Active, so an empty input is exactly equivalent to a real one here. */
  tickIdleOrCooldown(fixedDeltaSeconds: number): void {
    const noInput: ClashCombatantInputTick = { pressedActionIds: new Set(), aiMashEventThisTick: false };
    this.controller.tick(fixedDeltaSeconds, noInput, noInput);
  }

  /** Advances an Active Clash by one tick: samples real Z/X/C mash input for both sides (the AI contributing through the exact same per-combatant abstraction, per ClashMash.ts), and reports the resolution the instant it happens (Active -> Cooldown transition), if any. */
  tickActive(fixedDeltaSeconds: number, firstActions: ControllerActions, secondActions: ControllerActions): { resolution: ActiveClashResolution | null } {
    const firstInput: ClashCombatantInputTick = { pressedActionIds: buildMashActionSet(firstActions), aiMashEventThisTick: false };
    const secondAiMash = this.aiMashSource.sampleTick(this.activeClashLocalTickIndex, this.controller.getElapsedS());
    const secondInput: ClashCombatantInputTick = { pressedActionIds: buildMashActionSet(secondActions), aiMashEventThisTick: secondAiMash };
    this.activeClashLocalTickIndex += 1;

    const stateBefore = this.controller.getState();
    this.controller.tick(fixedDeltaSeconds, firstInput, secondInput);

    if (stateBefore === ClashState.Active && this.controller.getState() === ClashState.Cooldown) {
      const result = this.controller.getLastResult();
      const pair = this.activeClashPair;
      this.activeClashPair = null;
      if (result && pair) return { resolution: { result, pair } };
    }
    return { resolution: null };
  }

  /** Applies the real physical consequence of a Clash resolution (called exactly once, the tick tickActive() reports it) and returns the raw facts tickMatch.ts needs to build its own CombatEvent entries. */
  applyResolution(resolution: ActiveClashResolution, physics: PhysicsWorld, first: Bey, second: Bey): ClashResolutionOutcome {
    const { result, pair } = resolution;

    if (result.outcome === ClashOutcome.Tie) {
      this.applyTieRepulsion(physics, first, second);
      return { outcome: ClashOutcome.Tie };
    }

    const winnerIsFirst = result.outcome === ClashOutcome.FirstWins;
    const winningHit = winnerIsFirst ? pair.firstAttackerHit : pair.secondAttackerHit;
    const winner = winnerIsFirst ? first : second;
    const loser = winnerIsFirst ? second : first;
    const loserIsFirst = !winnerIsFirst;

    const knockback = computeKnockback({
      baseForce: winningHit.hit.hitbox.knockbackForce * this.matchConfig.clashImpactMultiplier,
      attackerSpeedMps: winningHit.attackerSpeedMps,
      defenderSpeedMps: winningHit.defenderSpeedMps,
      defenderStabilityFraction: winningHit.defenderStabilityFraction,
      defenderStaminaPenaltyFraction: winningHit.defenderStaminaPenaltyFraction,
      attackStat: winner.stats.attack,
      defenseStat: loser.stats.defense,
      attackerVelocityXZ: winningHit.attackerVelocityXZ,
      impactDirectionXZ: normalize(subtract(winningHit.defenderPositionXZ, winningHit.attackerPositionXZ)),
    });
    applyKnockback(loser.body, winningHit.attackerPositionXZ, winningHit.defenderPositionXZ, knockback);
    loser.dodge.registerLaunch(!isGrounded(physics, loser.collider));

    const stabilityDamageAmount =
      computeStabilityDamage(winningHit.hit.hitbox.stabilityDamage, winner.stats.attack, loser.stats.defense) * this.matchConfig.clashImpactMultiplier;
    const { causedBreak, isQualifyingKoHit } = loser.stability.applyDamage(stabilityDamageAmount);

    return {
      outcome: result.outcome,
      loserIsFirst,
      knockbackForce: knockback.force,
      stabilityDamageAmount,
      causedBreak,
      isQualifyingKoHit,
    };
  }

  /** Tie (owner decision): both Beys receive symmetric physical repulsion, no winner, no Stability damage — normal physics decides the rest from there. */
  private applyTieRepulsion(physics: PhysicsWorld, first: Bey, second: Bey): void {
    const firstPositionXZ: Vec2 = { x: first.body.translation().x, z: first.body.translation().z };
    const secondPositionXZ: Vec2 = { x: second.body.translation().x, z: second.body.translation().z };
    const direction = normalize(subtract(secondPositionXZ, firstPositionXZ));
    const impulseMagnitude = CLASH_TIE_REPULSION_BASE_FORCE * this.matchConfig.clashImpactMultiplier * KNOCKBACK_IMPULSE_PER_FORCE_UNIT;
    const horizontal = scale(direction, impulseMagnitude);
    const upward = impulseMagnitude * KNOCKBACK_UPWARD_LAUNCH_FRACTION;

    second.body.applyImpulse({ x: horizontal.x, y: upward, z: horizontal.z }, true);
    first.body.applyImpulse({ x: -horizontal.x, y: upward, z: -horizontal.z }, true);
    first.dodge.registerLaunch(!isGrounded(physics, first.collider));
    second.dodge.registerLaunch(!isGrounded(physics, second.collider));
  }
}
