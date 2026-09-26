// ============================================================
// TELEMETRY EVENT TYPES
// Full gameplay event catalog (GDD section 74) grows with each milestone.
// Milestone 2 added the minimal combat event set the GDD calls out by
// name: Hit, StabilityDamage, StabilityBreak, Knockback, RingOut, Ko,
// RoundEnd. Milestone 3 adds Dodged/PerfectDodge. AI/replay events are
// added alongside the systems that produce them.
// ============================================================

import type { ActiveHitbox } from '../../combat/attacks/AttackController';
import type { RoundOutcome } from '../../combat/round-rules/RoundState';
import type { ClashOutcome } from '../../combat/clash/ClashController';

export enum TelemetryEventKind {
  AppBoot = 'AppBoot',
  Error = 'Error',
  PhysicsAnomaly = 'PhysicsAnomaly',
  MovementImpact = 'MovementImpact',
  Hit = 'Hit',
  StabilityDamage = 'StabilityDamage',
  StabilityBreak = 'StabilityBreak',
  Knockback = 'Knockback',
  RingOut = 'RingOut',
  Ko = 'Ko',
  RoundEnd = 'RoundEnd',
  Dodged = 'Dodged',
  PerfectDodge = 'PerfectDodge',
  ClashStart = 'ClashStart',
  ClashMashInput = 'ClashMashInput',
  ClashResult = 'ClashResult',
  ClashEnd = 'ClashEnd',
  AiDecision = 'AiDecision',
}

export interface TelemetryEventBase {
  kind: TelemetryEventKind;
  /** Fixed-simulation tick index at the moment this event was recorded, or -1 outside of an active simulation. */
  tick: number;
  /** Wall-clock time for correlating with browser logs. */
  timestampMs: number;
}

export interface AppBootEvent extends TelemetryEventBase {
  kind: TelemetryEventKind.AppBoot;
  buildVersion: string;
  commitHash: string | null;
}

export interface ErrorEvent extends TelemetryEventBase {
  kind: TelemetryEventKind.Error;
  message: string;
  stack: string | null;
}

export interface PhysicsAnomalyEvent extends TelemetryEventBase {
  kind: TelemetryEventKind.PhysicsAnomaly;
  anomalyKind: string;
  detail: string;
}

/**
 * A significant, unmodeled velocity change detected on the Bey body — a
 * wall/floor bounce today. Provisional/generic until combat exists to
 * distinguish WallImpact from BeyCollision etc. (GDD section 74).
 */
export interface MovementImpactEvent extends TelemetryEventBase {
  kind: TelemetryEventKind.MovementImpact;
  speedDeltaMps: number;
}

/** An attack hitbox landed on the opponent. Circular-catches-Dash (GDD section 23/107) is marked distinctly via caughtOpponentDashing rather than folded into a generic hit. */
export interface HitTelemetryEvent extends TelemetryEventBase {
  kind: TelemetryEventKind.Hit;
  attackerIsFirst: boolean;
  hitboxKind: ActiveHitbox['kind'];
  caughtOpponentDashing: boolean;
}

export interface StabilityDamageEvent extends TelemetryEventBase {
  kind: TelemetryEventKind.StabilityDamage;
  targetIsFirst: boolean;
  amount: number;
}

export interface StabilityBreakEvent extends TelemetryEventBase {
  kind: TelemetryEventKind.StabilityBreak;
  targetIsFirst: boolean;
}

export interface KnockbackTelemetryEvent extends TelemetryEventBase {
  kind: TelemetryEventKind.Knockback;
  targetIsFirst: boolean;
  force: number;
}

export interface RingOutTelemetryEvent extends TelemetryEventBase {
  kind: TelemetryEventKind.RingOut;
  targetIsFirst: boolean;
}

/** The Bey that was knocked out (a qualifying hit while already Broken — GDD section 29). */
export interface KoEvent extends TelemetryEventBase {
  kind: TelemetryEventKind.Ko;
  targetIsFirst: boolean;
}

export interface RoundEndEvent extends TelemetryEventBase {
  kind: TelemetryEventKind.RoundEnd;
  outcome: RoundOutcome;
}

/** An attack that would have connected was nullified by the target's dodge i-frames (Milestone 3). */
export interface DodgedEvent extends TelemetryEventBase {
  kind: TelemetryEventKind.Dodged;
  targetIsFirst: boolean;
}

/**
 * A dodged hit whose i-frames were within the tighter "perfect" sub-window.
 * Detection/telemetry only — the GDD requires Perfect Dodge's actual
 * gameplay reward to be approved separately before it exists, so this
 * event carries no bonus effect (see DodgeTuning.ts).
 */
export interface PerfectDodgeEvent extends TelemetryEventBase {
  kind: TelemetryEventKind.PerfectDodge;
  targetIsFirst: boolean;
}

/** A Clash (Milestone 5) begins — two attacks connected within the compatible window. */
export interface ClashStartEvent extends TelemetryEventBase {
  kind: TelemetryEventKind.ClashStart;
  firstStaminaFraction: number;
  secondStaminaFraction: number;
  firstSpeedMps: number;
  secondSpeedMps: number;
}

/** One mash event registered for one side during an Active Clash — fired once per side per tick it actually advances (real Z/X/C press or the AI-mash abstraction; see ClashMash.ts's at-most-one-per-tick rule), not once per raw key. */
export interface ClashMashInputEvent extends TelemetryEventBase {
  kind: TelemetryEventKind.ClashMashInput;
  isFirst: boolean;
  mashEventCount: number;
}

/** A Clash resolved (Active -> Cooldown). */
export interface ClashResultEvent extends TelemetryEventBase {
  kind: TelemetryEventKind.ClashResult;
  outcome: ClashOutcome;
  firstClashPower: number;
  secondClashPower: number;
  firstMashEventCount: number;
  secondMashEventCount: number;
}

/** A Clash's Cooldown has fully elapsed (Cooldown -> Idle) — normal Clash detection can trigger again. */
export interface ClashEndEvent extends TelemetryEventBase {
  kind: TelemetryEventKind.ClashEnd;
}

/**
 * Milestone 7: an AIController made a fresh intent decision (GDD section
 * 65/74 — AI decisions are debug/telemetry-visible, not a black box).
 * Fired only on an actual reaction-delay-gated decision, not every fixed
 * tick — see AIController.ts's reaction-delay cadence.
 */
export interface AiDecisionEvent extends TelemetryEventBase {
  kind: TelemetryEventKind.AiDecision;
  personalityId: string;
  intent: string;
  reason: string;
  deliberateErrorApplied: boolean;
  edgeRiskFraction: number;
  opponentThreatFraction: number;
}

export type TelemetryEvent =
  | AppBootEvent
  | ErrorEvent
  | PhysicsAnomalyEvent
  | MovementImpactEvent
  | HitTelemetryEvent
  | StabilityDamageEvent
  | StabilityBreakEvent
  | KnockbackTelemetryEvent
  | RingOutTelemetryEvent
  | KoEvent
  | RoundEndEvent
  | DodgedEvent
  | PerfectDodgeEvent
  | ClashStartEvent
  | ClashMashInputEvent
  | ClashResultEvent
  | ClashEndEvent
  | AiDecisionEvent;
