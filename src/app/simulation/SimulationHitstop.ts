// ============================================================
// SIMULATION HITSTOP — OWNS THE GAMEPLAY-FREEZE DECISION (M9-0A)
// A strong-enough impact freezes gameplay simulation itself for a brief,
// magnitude-scaled window (Milestone 4). This used to be decided entirely
// inside CombatCameraController — a presentation-only component documented
// as having "no Three.js dependency" but, via MatchSession reading its
// isHitstopActive output to decide whether tickMatch() should even run,
// actually owning a real gameplay rule. Any execution path without a
// camera (headless Self-Test/AiBatchRunner) never froze at all: a
// live-vs-headless behavioral gap that went undetected because nothing
// compared the two directly.
//
// This module is the single source of truth instead: live (MatchSession),
// Debug Lab (the same MatchSession) and headless (AiMatchSimulation's
// stepAiMatchOnWorld) each own one SimulationHitstop instance and drive it
// with collectHitstopImpactMagnitudes() from their own tick's MatchTickResult
// — the exact same rule everywhere. Values unchanged from the old
// CombatCameraController constants, so live feel is identical.
// ============================================================

import { ClashState } from '../../combat/clash/ClashController';
import { buildImpactEventsForTick, type ImpactEventsResultSubset } from '../../camera/ImpactEvents';
import { CLASH_RESOLVED_MAGNITUDE } from '../../camera/ImpactMagnitude';

export const HITSTOP_MIN_MAGNITUDE = 0.35;
export const HITSTOP_DURATION_PER_MAGNITUDE_S = 0.18;
export const HITSTOP_MAX_DURATION_S = 0.18;

/** buildImpactEventsForTick needs a WorldPositionM per event, but hitstop only ever looks at magnitude — a real position isn't needed, so every caller (including a headless world with no camera at all) can share this. */
const IGNORED_POSITION = { x: 0, y: 0, z: 0 };

/**
 * The magnitudes relevant to a hitstop decision for one tick, mirroring
 * exactly what MatchSession used to hand CombatCameraController.tick():
 * on the tick a Clash resolves, ONLY the resolution's own fixed magnitude
 * (never also the knockback/stabilityBreak/ko from that same resolution);
 * while a Clash is Active (still mashing, not yet resolved), nothing at
 * all (tickMatch's own Active branch already freezes everything itself);
 * otherwise, the ordinary per-tick impact events (hits, stability breaks,
 * KOs, ring-outs, dodges, wall impacts, landings).
 */
export function collectHitstopImpactMagnitudes(result: ImpactEventsResultSubset & { clashResolvedThisTick: unknown }, clashState: ClashState): number[] {
  if (result.clashResolvedThisTick) return [CLASH_RESOLVED_MAGNITUDE];
  if (clashState === ClashState.Active) return [];
  return buildImpactEventsForTick(result, IGNORED_POSITION, IGNORED_POSITION).map((event) => event.magnitude);
}

export class SimulationHitstop {
  private remainingS = 0;

  /** Registers this tick's impacts (if any) against the current freeze — pass [] (or skip the call) on a tick where gameplay itself didn't advance, so a cached/replayed result can't re-trigger it. */
  registerImpactMagnitudes(magnitudes: readonly number[]): void {
    for (const magnitude of magnitudes) {
      if (magnitude >= HITSTOP_MIN_MAGNITUDE) {
        const duration = Math.min(HITSTOP_MAX_DURATION_S, magnitude * HITSTOP_DURATION_PER_MAGNITUDE_S);
        this.remainingS = Math.max(this.remainingS, duration);
      }
    }
  }

  /** Real-time decay — call exactly once per fixed tick, regardless of whether gameplay itself is currently frozen, so the freeze actually ends. */
  decay(fixedDeltaSeconds: number): void {
    this.remainingS = Math.max(0, this.remainingS - fixedDeltaSeconds);
  }

  get isActive(): boolean {
    return this.remainingS > 0;
  }

  get remainingSeconds(): number {
    return this.remainingS;
  }
}
