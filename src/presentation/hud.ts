// ============================================================
// HUD PRESENTATION CONTRACT
// The data any combat HUD consumes: the same numbers for every candidate
// (the Combat HUD Lab's A/B/C in PR #64, the current functional HUD, and
// whatever is chosen). A HUD built on this never touches physics bodies,
// Rapier, AI internals or the camera director; where a HUD needs a screen
// position it gets world positions and projects them with its own camera.
//
// This module defines the contract and its pure selector only. The current
// CombatHud still reads the session directly; it adopts this when the HUD
// direction is chosen (OWNER_DECISIONS_MASTER.md 13.1). Nothing here
// designs or changes a HUD.
// ============================================================

import type { WorldPositionM } from '../camera/ImpactEvents';
import type { ClashPresentationSnapshot } from './clash';
import type { PresentationSide } from './events';
import type { BeyPresentationState, MatchPresentationState, RoundPresentationState } from './state';

/** What the play flow (not a session) knows: which round of how many, and the score. Optional: the Debug Lab has none. */
export interface HudMatchFlowState {
  readonly roundNumber: number;
  readonly roundsToWin: number;
  readonly score: { readonly first: number; readonly second: number };
}

export interface HudBeyState {
  readonly side: PresentationSide;
  readonly definitionId: string;
  readonly stamina: number;
  readonly stability: number;
  readonly broken: boolean;
  readonly attackEnergy: number;
  readonly dashCharge: number;
  readonly attackState: BeyPresentationState['attackState'];
  readonly driftState: BeyPresentationState['driftState'];
  readonly airborne: boolean;
  readonly speedFraction: number;
}

export interface HudPresentationState {
  readonly tick: number;
  readonly round: RoundPresentationState;
  readonly flow: HudMatchFlowState | null;
  readonly first: HudBeyState;
  readonly second: HudBeyState;
  readonly clash: ClashPresentationSnapshot;
  /** World positions of both Beys, for HUD elements anchored in the scene (the Clash bar sits between them). */
  readonly worldPositions: Readonly<Record<PresentationSide, WorldPositionM>>;
}

function hudBey(bey: BeyPresentationState): HudBeyState {
  return {
    side: bey.side,
    definitionId: bey.definitionId,
    stamina: bey.stamina,
    stability: bey.stability,
    broken: bey.broken,
    attackEnergy: bey.attackEnergy,
    dashCharge: bey.dashCharge,
    attackState: bey.attackState,
    driftState: bey.driftState,
    airborne: bey.airborne,
    speedFraction: bey.speedFraction,
  };
}

export function selectHudPresentationState(
  match: MatchPresentationState,
  worldPositions: Readonly<Record<PresentationSide, WorldPositionM>>,
  flow: HudMatchFlowState | null = null,
): HudPresentationState {
  return {
    tick: match.tick,
    round: match.round,
    flow,
    first: hudBey(match.first),
    second: hudBey(match.second),
    clash: match.clash,
    worldPositions,
  };
}
