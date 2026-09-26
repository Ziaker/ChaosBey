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
// can Clash): implemented as both sides' attacks connecting in the SAME
// fixed tick (delta = 0, always inside the window — see
// isWithinClashWindow). This is the only case reachable in current
// gameplay: the simulation is fixed-tick and the current opponent
// stand-in (IdleController, Milestone 7's real AI not built yet) never
// attacks with timing that could stagger a hit across ticks. It is also
// the exact scenario HitDetection.ts's own module comment already calls
// out as "possible right now... expected until Clash exists to specially
// resolve simultaneous attacks." isWithinClashWindow() stays the single
// source of truth for "compatible" (called with the real delta, 0 here),
// so widening this later to genuinely cross-tick pairs — once real attack
// timing varies enough for that to matter — only means feeding it a
// nonzero delta, not a formula change.
//
// A tick where only one side connects is completely untouched: it
// resolves with its own normal knockback/Stability damage exactly as
// before Milestone 5 existed, at zero added latency. Only a same-tick
// double connect is intercepted: Idle -> starts a Clash and withholds
// both hits from normal resolution entirely; Cooldown -> both hits still
// resolve normally, just through the "slower suffers more" cooldown
// alternative multiplier instead of a fresh Clash (GDD requirement).
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
import { applyKnockback, computeKnockback, computeStabilityDamage } from '../../combat/knockback/Knockback';
import { KNOCKBACK_IMPULSE_PER_FORCE_UNIT, KNOCKBACK_UPWARD_LAUNCH_FRACTION } from '../../combat/knockback/KnockbackTuning';
import type { HitEvent } from '../../combat/hit-detection/HitDetection';
import { isGrounded } from '../../physics/collision/GroundCheck';
import type { PhysicsWorld } from '../../physics/world/PhysicsWorld';
import { normalize, scale, subtract, type Vec2 } from '../../physics/Vec2';
import { ClashController, ClashOutcome, ClashState, type ClashCombatantInputTick, type ClashResult } from '../../combat/clash/ClashController';
import { isWithinClashWindow } from '../../combat/clash/ClashWindow';
import { FixedIntervalAiMashSource } from '../../combat/clash/ClashMash';
import { CLASH_AI_MASH_INTERVAL_TICKS, CLASH_IMPACT_MULTIPLIER, CLASH_TIE_REPULSION_BASE_FORCE } from '../../combat/clash/ClashTuning';
import { computeCooldownAlternativeMultiplier } from '../../combat/clash/ClashCooldownResolution';

/** Only Z/X/C (Attack/JumpDrift/Dodge) count as Clash mash input — see ClashMash.ts's simultaneous-presses-count-as-one rule, which this Set naturally preserves. */
const CLASH_MASH_ACTIONS: ReadonlySet<Action> = new Set([Action.Attack, Action.JumpDrift, Action.Dodge]);

export function buildMashActionSet(actions: ControllerActions): ReadonlySet<string> {
  const pressed = new Set<string>();
  for (const action of actions.pressedThisFrame) {
    if (CLASH_MASH_ACTIONS.has(action)) pressed.add(action);
  }
  return pressed;
}

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

export class ClashOrchestration {
  readonly controller = new ClashController();
  private readonly aiMashSource = new FixedIntervalAiMashSource(CLASH_AI_MASH_INTERVAL_TICKS);
  private activeClashLocalTickIndex = 0;
  private activeClashPair: ClashPair | null = null;

  /**
   * Call once per tick with this tick's post-i-frame connecting hits,
   * only while the Clash state is Idle or Cooldown — tickMatch() skips
   * this (and the whole normal hit-resolution path) entirely while
   * Active; see tickActive() below for that branch.
   */
  processTickHits(hits: HitSnapshotInput[]): { toResolveNormally: ResolvedHitToApply[] } {
    const catches = hits.filter((h) => h.hit.caughtOpponentDashing);
    const normalHits = hits.filter((h) => !h.hit.caughtOpponentDashing);
    const passthrough: ResolvedHitToApply[] = catches.map((h) => ({ ...h, forceMultiplier: 1 }));

    const firstAttackerHit = normalHits.find((h) => h.hit.attackerIsFirst) ?? null;
    const secondAttackerHit = normalHits.find((h) => !h.hit.attackerIsFirst) ?? null;

    // Same-tick delta is 0 — always within the window; isWithinClashWindow
    // stays the single source of truth for "compatible" (see module
    // comment above for why cross-tick detection isn't implemented yet).
    if (!firstAttackerHit || !secondAttackerHit || !isWithinClashWindow(0)) {
      return { toResolveNormally: [...passthrough, ...normalHits.map((h) => ({ ...h, forceMultiplier: 1 }))] };
    }

    if (this.controller.isOnCooldown()) {
      return {
        toResolveNormally: [
          ...passthrough,
          { ...firstAttackerHit, forceMultiplier: computeCooldownAlternativeMultiplier(firstAttackerHit.defenderSpeedMps, firstAttackerHit.attackerSpeedMps) },
          { ...secondAttackerHit, forceMultiplier: computeCooldownAlternativeMultiplier(secondAttackerHit.defenderSpeedMps, secondAttackerHit.attackerSpeedMps) },
        ],
      };
    }

    if (this.controller.getState() === ClashState.Idle) {
      this.activeClashPair = { firstAttackerHit, secondAttackerHit };
      this.activeClashLocalTickIndex = 0;
      this.controller.tryStart({
        firstStaminaFraction: firstAttackerHit.attackerStaminaFraction,
        secondStaminaFraction: secondAttackerHit.attackerStaminaFraction,
        firstSpeedMps: firstAttackerHit.attackerSpeedMps,
        secondSpeedMps: secondAttackerHit.attackerSpeedMps,
      });
      return { toResolveNormally: passthrough }; // Both hits consumed into the Clash — no normal knockback for either.
    }

    // Active — unreachable in practice (tickMatch() never calls this method while Active), kept as a safe fallback rather than silently dropping the hits.
    return { toResolveNormally: [...passthrough, { ...firstAttackerHit, forceMultiplier: 1 }, { ...secondAttackerHit, forceMultiplier: 1 }] };
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
    const loser = winnerIsFirst ? second : first;
    const loserIsFirst = !winnerIsFirst;

    const knockback = computeKnockback({
      baseForce: winningHit.hit.hitbox.knockbackForce * CLASH_IMPACT_MULTIPLIER,
      attackerSpeedMps: winningHit.attackerSpeedMps,
      defenderSpeedMps: winningHit.defenderSpeedMps,
      defenderStabilityFraction: winningHit.defenderStabilityFraction,
      defenderStaminaPenaltyFraction: winningHit.defenderStaminaPenaltyFraction,
      attackerVelocityXZ: winningHit.attackerVelocityXZ,
      impactDirectionXZ: normalize(subtract(winningHit.defenderPositionXZ, winningHit.attackerPositionXZ)),
    });
    applyKnockback(loser.body, winningHit.attackerPositionXZ, winningHit.defenderPositionXZ, knockback);
    loser.dodge.registerLaunch(!isGrounded(physics, loser.collider));

    const stabilityDamageAmount = computeStabilityDamage(winningHit.hit.hitbox.stabilityDamage) * CLASH_IMPACT_MULTIPLIER;
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
    const impulseMagnitude = CLASH_TIE_REPULSION_BASE_FORCE * CLASH_IMPACT_MULTIPLIER * KNOCKBACK_IMPULSE_PER_FORCE_UNIT;
    const horizontal = scale(direction, impulseMagnitude);
    const upward = impulseMagnitude * KNOCKBACK_UPWARD_LAUNCH_FRACTION;

    second.body.applyImpulse({ x: horizontal.x, y: upward, z: horizontal.z }, true);
    first.body.applyImpulse({ x: -horizontal.x, y: upward, z: -horizontal.z }, true);
    first.dodge.registerLaunch(!isGrounded(physics, first.collider));
    second.dodge.registerLaunch(!isGrounded(physics, second.collider));
  }
}
