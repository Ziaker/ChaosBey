// ============================================================
// PRESENTATION EVENTS
// The typed, neutral vocabulary future presentation systems (VFX, HUD,
// condition visuals, Clash presentation, audio) listen to, so none of them
// has to read ten gameplay systems itself.
//
//   gameplay state  →  presentation events + state  →  visual systems
//
// Gameplay never calls into this module. Every event is derived AFTER a tick
// from facts the simulation already produces and the session already
// collects: the MatchTickResult, the ImpactEvent list (the camera director
// and the existing VFX consume the same list) and the Clash tracker's edges.
// Nothing new is computed in gameplay and nothing here writes back.
//
// Only events with a real source today exist. What the master list in the
// brief maps to:
//   BeySpawned                       → PresentationSystem.create(context)
//   Stamina/Stability/AttackEnergy
//   Changed                          → state (BeyPresentationState), not events
//   MovementStateChanged             → driftStarted/driftEnded/jumpStarted + state
//   CollisionResolved                → collisionResolved (movement impacts today)
//   MatchEnded                       → owned by the play flow (matchScore), outside a session
// ============================================================

import type { MatchTickResult } from '../app/simulation/tickMatch';
import type { ClashMashInputEdge } from '../app/simulation/ClashPresentationTracker';
import type { ImpactEvent, WorldPositionM } from '../camera/ImpactEvents';
import type { ClashOutcome, ClashResult } from '../combat/clash/ClashController';
import { DriftState } from '../drift/DriftController';

export type PresentationSide = 'first' | 'second';

interface EventBase {
  /** Fixed tick the event was derived on. */
  readonly tick: number;
}

export type PresentationEvent =
  | (EventBase & { readonly kind: 'jumpStarted' | 'driftStarted' | 'driftEnded'; readonly side: PresentationSide })
  | (EventBase & { readonly kind: 'landed'; readonly side: PresentationSide; readonly magnitude: number; readonly position: WorldPositionM })
  | (EventBase & {
      readonly kind: 'hitResolved';
      /** The Bey that was hit. */
      readonly defenderSide: PresentationSide;
      /** The Bey that attacked; null only if the tick's hit list and impact list disagreed (never expected). */
      readonly attackerSide: PresentationSide | null;
      readonly magnitude: number;
      readonly position: WorldPositionM;
      readonly hitboxKind: 'circular' | 'dash' | null;
      readonly caughtOpponentDashing: boolean;
    })
  | (EventBase & { readonly kind: 'knockbackStarted'; readonly side: PresentationSide; readonly force: number; readonly directionXZ: { readonly x: number; readonly z: number } | null })
  /** A movement impact the simulation detected (a wall or floor bounce, a Bey bump). Not a combat hit. */
  | (EventBase & { readonly kind: 'collisionResolved'; readonly side: PresentationSide; readonly magnitude: number; readonly position: WorldPositionM })
  | (EventBase & { readonly kind: 'stabilityBroken' | 'perfectDodge' | 'dodged' | 'ko' | 'ringOut'; readonly side: PresentationSide; readonly magnitude: number; readonly position: WorldPositionM })
  | (EventBase & { readonly kind: 'clashStarted' })
  /** One side's mash count went up. `progress` is the Clash's elapsed share, 0..1. */
  | (EventBase & { readonly kind: 'clashProgress'; readonly side: PresentationSide; readonly mashEventCount: number; readonly progress: number })
  | (EventBase & { readonly kind: 'clashResolved'; readonly outcome: ClashOutcome; readonly firstClashPower: number; readonly secondClashPower: number })
  | (EventBase & { readonly kind: 'roundEnded'; readonly outcome: string });

export type PresentationEventKind = PresentationEvent['kind'];

/** The slice of a finished tick the deriver reads (a MatchTickResult satisfies it). */
export interface PresentationTickResult {
  readonly hitEvents: MatchTickResult['hitEvents'];
  readonly combatEvents: MatchTickResult['combatEvents'];
  readonly first: { readonly driftState: DriftState };
  readonly second: { readonly driftState: DriftState };
}

export interface PresentationTickInput {
  readonly tick: number;
  /** The tick's result, or null when hitstop froze gameplay this tick (nothing new happened in gameplay, so no gameplay-derived event is emitted). */
  readonly result: PresentationTickResult | null;
  /** The ImpactEvent list the camera and the legacy VFX consume this tick. */
  readonly impactEvents: readonly ImpactEvent[];
  readonly clash: {
    readonly started: boolean;
    /** Set on exactly the tick the Clash resolved. */
    readonly result: ClashResult | null;
    readonly mashEdges: readonly ClashMashInputEdge[];
    /** Elapsed share of the Clash, 0..1. */
    readonly progress: number;
  };
  readonly roundOver: boolean;
  /** The RoundOutcome name while over. */
  readonly roundOutcome: string;
}

const sideOf = (isFirst: boolean): PresentationSide => (isFirst ? 'first' : 'second');

/**
 * Turns finished ticks into PresentationEvents. Holds only the previous
 * tick's edge state (drift states, round over), so the same inputs in the
 * same order always give the same events; `reset()` forgets it (a restarted
 * round must not see an edge from the old one).
 */
export class PresentationEventDeriver {
  private previousDrift: Record<PresentationSide, DriftState> = { first: DriftState.Idle, second: DriftState.Idle };
  private previousRoundOver = false;

  reset(): void {
    this.previousDrift = { first: DriftState.Idle, second: DriftState.Idle };
    this.previousRoundOver = false;
  }

  derive(input: PresentationTickInput): PresentationEvent[] {
    const events: PresentationEvent[] = [];
    const tick = input.tick;

    if (input.result) {
      this.deriveMovementEdges(tick, input.result, events);
      this.deriveFromImpacts(tick, input.result, input.impactEvents, events);
      for (const combat of input.result.combatEvents) {
        if (combat.kind === 'knockback') {
          events.push({ kind: 'knockbackStarted', tick, side: sideOf(combat.targetIsFirst), force: combat.force, directionXZ: combat.directionXZ ?? null });
        }
      }
    }

    if (input.clash.started) events.push({ kind: 'clashStarted', tick });
    for (const edge of input.clash.mashEdges) {
      events.push({ kind: 'clashProgress', tick, side: sideOf(edge.isFirst), mashEventCount: edge.mashEventCount, progress: input.clash.progress });
    }
    if (input.clash.result) {
      events.push({
        kind: 'clashResolved',
        tick,
        outcome: input.clash.result.outcome,
        firstClashPower: input.clash.result.firstClashPower,
        secondClashPower: input.clash.result.secondClashPower,
      });
    }

    if (input.roundOver && !this.previousRoundOver) events.push({ kind: 'roundEnded', tick, outcome: input.roundOutcome });
    this.previousRoundOver = input.roundOver;
    return events;
  }

  private deriveMovementEdges(tick: number, result: PresentationTickResult, events: PresentationEvent[]): void {
    for (const side of ['first', 'second'] as const) {
      const previous = this.previousDrift[side];
      const current = result[side].driftState;
      if (current === previous) continue;
      if (current === DriftState.Hopping) events.push({ kind: 'jumpStarted', tick, side });
      if (current === DriftState.Drifting) events.push({ kind: 'driftStarted', tick, side });
      if (previous === DriftState.Drifting) events.push({ kind: 'driftEnded', tick, side });
      this.previousDrift[side] = current;
    }
  }

  private deriveFromImpacts(tick: number, result: PresentationTickResult, impacts: readonly ImpactEvent[], events: PresentationEvent[]): void {
    // The impact list builds one 'hit' per entry of result.hitEvents, in order.
    const hitImpacts = impacts.filter((impact) => impact.kind === 'hit');
    hitImpacts.forEach((impact, index) => {
      const hit = result.hitEvents[index];
      events.push({
        kind: 'hitResolved',
        tick,
        defenderSide: sideOf(impact.isFirst),
        attackerSide: hit ? sideOf(hit.attackerIsFirst) : null,
        magnitude: impact.magnitude,
        position: impact.worldPositionM,
        hitboxKind: hit ? hit.hitbox.kind : null,
        caughtOpponentDashing: hit ? hit.caughtOpponentDashing : false,
      });
    });

    for (const impact of impacts) {
      const side = sideOf(impact.isFirst);
      switch (impact.kind) {
        case 'wallImpact':
          events.push({ kind: 'collisionResolved', tick, side, magnitude: impact.magnitude, position: impact.worldPositionM });
          break;
        case 'landing':
          events.push({ kind: 'landed', tick, side, magnitude: impact.magnitude, position: impact.worldPositionM });
          break;
        case 'stabilityBreak':
          events.push({ kind: 'stabilityBroken', tick, side, magnitude: impact.magnitude, position: impact.worldPositionM });
          break;
        case 'perfectDodge':
        case 'dodged':
        case 'ko':
        case 'ringOut':
          events.push({ kind: impact.kind, tick, side, magnitude: impact.magnitude, position: impact.worldPositionM });
          break;
        // 'hit' is handled above; 'clashResolved' is a camera/VFX-pipeline beat and the Clash edge below is its source.
        default:
          break;
      }
    }
  }
}
