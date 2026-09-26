// ============================================================
// IMPACT EVENTS
// Pure mapping from a tickMatch() result to the small, position-tagged,
// magnitude-scored events camera shake/hitstop/FOV-punch and VFX consume
// (Milestone 4). Kept separate from tickMatch.ts itself so Milestone 3's
// combat orchestration stays untouched by presentation concerns (GDD
// section 1.4 component separation) — this only reads its output.
//
// Structural (not nominal) input types on purpose: this takes whatever
// object shape it needs from MatchTickResult without importing the whole
// module, so it stays trivially unit-testable with hand-built fixtures.
// ============================================================

import type { CombatEvent } from '../app/simulation/tickMatch';
import type { HitEvent } from '../combat/hit-detection/HitDetection';
import {
  DODGED_MAGNITUDE,
  KO_MAGNITUDE,
  PERFECT_DODGE_MAGNITUDE,
  RING_OUT_MAGNITUDE,
  STABILITY_BREAK_MAGNITUDE,
  knockbackMagnitude,
  landingMagnitude,
  movementImpactMagnitude,
} from './ImpactMagnitude';

export interface WorldPositionM {
  x: number;
  y: number;
  z: number;
}

export type ImpactEventKind = 'hit' | 'stabilityBreak' | 'ko' | 'ringOut' | 'perfectDodge' | 'dodged' | 'wallImpact' | 'landing' | 'clashResolved';

export interface ImpactEvent {
  kind: ImpactEventKind;
  /** 0..1, already run through ImpactMagnitude's profile-C escalation curve. */
  magnitude: number;
  worldPositionM: WorldPositionM;
  /** Which Bey this event is centered on — the defender for a hit/knockback-style event, the Bey itself for a wall impact or landing. */
  isFirst: boolean;
}

interface ImpactEventsBeySnapshotSubset {
  movement: { impactDeltaSpeedMps: number };
  justLanded: boolean;
  landingIntensity: number;
}

export interface ImpactEventsResultSubset {
  hitEvents: HitEvent[];
  combatEvents: CombatEvent[];
  first: ImpactEventsBeySnapshotSubset;
  second: ImpactEventsBeySnapshotSubset;
}

export function buildImpactEventsForTick(
  result: ImpactEventsResultSubset,
  firstPositionM: WorldPositionM,
  secondPositionM: WorldPositionM,
): ImpactEvent[] {
  const events: ImpactEvent[] = [];
  const positionFor = (isFirst: boolean): WorldPositionM => (isFirst ? firstPositionM : secondPositionM);

  // Every connecting attack, whichever resolution path it took (normal
  // knockback or Circular-catches-Dash) — using the hitbox's own
  // knockbackForce keeps this uniform across both paths without needing a
  // dedicated combatEvent for the catch-launch case.
  for (const hit of result.hitEvents) {
    const isFirst = !hit.attackerIsFirst;
    events.push({ kind: 'hit', magnitude: knockbackMagnitude(hit.hitbox.knockbackForce), worldPositionM: positionFor(isFirst), isFirst });
  }

  for (const combatEvent of result.combatEvents) {
    switch (combatEvent.kind) {
      case 'stabilityBreak':
        events.push({ kind: 'stabilityBreak', magnitude: STABILITY_BREAK_MAGNITUDE, worldPositionM: positionFor(combatEvent.targetIsFirst), isFirst: combatEvent.targetIsFirst });
        break;
      case 'ko':
        events.push({ kind: 'ko', magnitude: KO_MAGNITUDE, worldPositionM: positionFor(combatEvent.targetIsFirst), isFirst: combatEvent.targetIsFirst });
        break;
      case 'ringOut':
        events.push({ kind: 'ringOut', magnitude: RING_OUT_MAGNITUDE, worldPositionM: positionFor(combatEvent.targetIsFirst), isFirst: combatEvent.targetIsFirst });
        break;
      case 'perfectDodge':
        events.push({ kind: 'perfectDodge', magnitude: PERFECT_DODGE_MAGNITUDE, worldPositionM: positionFor(combatEvent.targetIsFirst), isFirst: combatEvent.targetIsFirst });
        break;
      case 'dodged':
        events.push({ kind: 'dodged', magnitude: DODGED_MAGNITUDE, worldPositionM: positionFor(combatEvent.targetIsFirst), isFirst: combatEvent.targetIsFirst });
        break;
      // 'stabilityDamage' and 'knockback' are intentionally not mapped
      // separately — the 'hit' event above already covers every
      // connecting attack once, from the same knockbackForce that also
      // drives combatEvent.knockback's force.
      default:
        break;
    }
  }

  if (result.first.movement.impactDeltaSpeedMps > 0) {
    events.push({ kind: 'wallImpact', magnitude: movementImpactMagnitude(result.first.movement.impactDeltaSpeedMps), worldPositionM: firstPositionM, isFirst: true });
  }
  if (result.second.movement.impactDeltaSpeedMps > 0) {
    events.push({ kind: 'wallImpact', magnitude: movementImpactMagnitude(result.second.movement.impactDeltaSpeedMps), worldPositionM: secondPositionM, isFirst: false });
  }

  if (result.first.justLanded) {
    events.push({ kind: 'landing', magnitude: landingMagnitude(result.first.landingIntensity), worldPositionM: firstPositionM, isFirst: true });
  }
  if (result.second.justLanded) {
    events.push({ kind: 'landing', magnitude: landingMagnitude(result.second.landingIntensity), worldPositionM: secondPositionM, isFirst: false });
  }

  return events;
}
