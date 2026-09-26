// ============================================================
// CLASH MASH COUNTING
// Discrete mash-event counting for the Clash mini-contest (GDD): a
// combatant contributes at most one mash event per tick, regardless of
// how many qualifying actions (Z/X/C in the eventual real integration —
// this package only sees opaque action identifiers, never the real
// Action enum) it comes from. Simultaneous Z+X+C is one event; a real
// press and an AI contribution landing on the *same* tick for the *same*
// combatant is still one event (the AI feeds the same per-combatant input
// abstraction, not a second scoring channel); the same combatant mashing
// across separate ticks counts once per tick. Kept as plain
// functions/types with no dependency on the real input system, so
// Milestone 5's core logic doesn't couple to Milestone 4's input work.
// ============================================================

/**
 * Advances one combatant's mash-event counter by one fixed tick's worth of
 * input. `pressedActionIds` is whatever qualifying action identifiers
 * transitioned to pressed *this tick* (e.g. a future adapter would pass
 * ControllerActions.pressedThisFrame filtered to Z/X/C); `aiMashEventThisTick`
 * is that same combatant's AI-driven contribution for this tick (see
 * ClashAiMashSource below) when AI is the one mashing on its behalf. Either
 * source alone counts as one event; both present on the same tick for the
 * same combatant still count as exactly one — the AI feeds the same
 * per-combatant input, it isn't a second, additive scoring channel.
 */
export function nextMashEventCount(currentCount: number, pressedActionIds: ReadonlySet<string>, aiMashEventThisTick: boolean): number {
  const mashedThisTick = pressedActionIds.size > 0 || aiMashEventThisTick;
  return mashedThisTick ? currentCount + 1 : currentCount;
}

/**
 * Pure, deterministic abstraction for how the (future Milestone 7) AI
 * contributes mash events during a Clash. This package has no AI logic of
 * its own — just the contract ClashController's caller needs to decide,
 * per tick, whether the AI contributed a mash event this tick. The real
 * AI implementation drops in behind this interface later without
 * changing ClashController.
 */
export interface ClashAiMashSource {
  sampleTick(tickIndex: number, clashElapsedS: number): boolean;
}

/**
 * Deterministic placeholder implementation — NOT the real AI. Contributes
 * exactly one mash event every `intervalTicks` ticks (tick 0, 0+interval,
 * 0+2*interval, ...). Exists so self-tests (and early tuning) can exercise
 * the AI-mash pathway through ClashController without needing real AI
 * behavior; Milestone 7's actual AI mash strategy replaces this.
 */
export class FixedIntervalAiMashSource implements ClashAiMashSource {
  constructor(private readonly intervalTicks: number) {}

  sampleTick(tickIndex: number, _clashElapsedS: number): boolean {
    return this.intervalTicks > 0 && tickIndex % this.intervalTicks === 0;
  }
}

/**
 * Milestone 7: a no-op ClashAiMashSource for when a real AIController (or
 * any other CombatController) already contributes mash events through its
 * own real Z/X/C presses (ClashOrchestration.tickActive's
 * buildMashActionSet(secondActions) path) — using this alongside a real
 * controller avoids silently adding the FixedIntervalAiMashSource
 * placeholder's contribution on top of (and thus masking tuning
 * differences from) the controller's own personality-driven mash rate.
 */
export class NullAiMashSource implements ClashAiMashSource {
  sampleTick(_tickIndex: number, _clashElapsedS: number): boolean {
    return false;
  }
}
