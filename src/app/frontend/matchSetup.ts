// ============================================================
// MATCH SETUP — WHAT THE PLAYER CHOSE BEFORE A MATCH (M10)
// The pregame choices as plain data, and the functions that turn them
// into what a match is built from. Character Select fills the player's
// Bey; the Pregame screen fills the rest.
// ============================================================

import { DEFAULT_AI_DIFFICULTY_TIER, type AiDifficultyTierId } from '../../ai/difficulty/AiDifficultyTiers';
import { DEFAULT_ARENA_PRESET, arenaPreset, type ArenaGeometry, type ArenaPresetId } from '../../arena/presets/ArenaPresets';
import { DEFAULT_ARENA_FLOOR, type ArenaFloorId } from '../../arena/floor/ArenaFloorProfile';
import { CLASH_IMPACT_MULTIPLIER_DEFAULT } from '../../combat/clash/ClashTuning';
import { resolveMatchConfig, type MatchConfig } from '../../config/match/MatchConfig';
import type { MatchBeys } from '../bootstrap/createMatchScene';
import type { AiPersonalityChoice, SideControllerSpec } from '../session/SideControllers';
import { BEY_ROSTER, rosterEntry } from './beyRoster';
import type { RoundsToWin } from './matchScore';

export interface MatchSetup {
  readonly playerBeyId: string;
  readonly opponentBeyId: string;
  readonly ai: { readonly tier: AiDifficultyTierId; readonly style: AiPersonalityChoice };
  readonly roundsToWin: RoundsToWin;
  /** Arena preset (look + default walls) and the walls actually played (the preset's, or moved sliders). */
  readonly arena: { readonly presetId: ArenaPresetId; readonly geometry: ArenaGeometry };
  /** Advanced rules (GDD 152): scales the knockback a Clash resolution applies. */
  readonly clashImpactMultiplier: number;
  /** Fixed match seed text, or null for a fresh random seed every match. */
  readonly seedText: string | null;
}

/** Range the Pregame slider offers for the Clash impact multiplier. */
export const CLASH_IMPACT_RANGE = { min: 0.5, max: 2, step: 0.25 } as const;

/**
 * The opponent a player meets by default: the next Bey in the roster, so
 * the first match is never a mirror (Attack meets Defense, as in the
 * Debug Lab).
 */
export function defaultOpponentFor(playerBeyId: string): string {
  const index = BEY_ROSTER.findIndex((e) => e.definition.id === playerBeyId);
  const next = BEY_ROSTER[(index + 1) % BEY_ROSTER.length]!;
  return next.definition.id;
}

export function createDefaultMatchSetup(playerBeyId: string = BEY_ROSTER[0]!.definition.id): MatchSetup {
  return {
    playerBeyId,
    opponentBeyId: defaultOpponentFor(playerBeyId),
    ai: { tier: DEFAULT_AI_DIFFICULTY_TIER, style: 'archetype' },
    roundsToWin: 2,
    arena: { presetId: DEFAULT_ARENA_PRESET, geometry: arenaPreset(DEFAULT_ARENA_PRESET).geometry },
    clashImpactMultiplier: CLASH_IMPACT_MULTIPLIER_DEFAULT,
    seedText: null,
  };
}

/** The setup with a new player Bey; the opponent follows unless the player had picked one different from the default. */
export function withPlayerBey(setup: MatchSetup, playerBeyId: string): MatchSetup {
  if (playerBeyId === setup.playerBeyId) return setup;
  const opponentWasDefault = setup.opponentBeyId === defaultOpponentFor(setup.playerBeyId);
  return { ...setup, playerBeyId, opponentBeyId: opponentWasDefault ? defaultOpponentFor(playerBeyId) : setup.opponentBeyId };
}

/** The Bey definitions the match is built with (player first, opponent second). */
export function matchBeysFor(setup: MatchSetup): MatchBeys {
  return { first: rosterEntry(setup.playerBeyId).definition, second: rosterEntry(setup.opponentBeyId).definition };
}

/** The resolved match rules (the one MatchConfig path, GDD 101/166). */
export function matchConfigFor(setup: MatchSetup): MatchConfig {
  return resolveMatchConfig({
    clashImpactMultiplier: setup.clashImpactMultiplier,
    arenaWallHeightM: setup.arena.geometry.wallHeightM,
    arenaWallRestitution: setup.arena.geometry.wallRestitution,
    arenaFloor: setup.arena.geometry.floor ?? DEFAULT_ARENA_FLOOR,
  });
}

/** A new arena preset, with that preset's own walls (slider changes are reset). The floor profile is kept: it is independent of the look. */
export function withArenaPreset(setup: MatchSetup, presetId: ArenaPresetId): MatchSetup {
  return { ...setup, arena: { presetId, geometry: { ...arenaPreset(presetId).geometry, floor: setup.arena.geometry.floor ?? DEFAULT_ARENA_FLOOR } } };
}

/** M11 lane 4: the floor profile (flat, or bowl A/B/C for playtest). */
export function withArenaFloor(setup: MatchSetup, floor: ArenaFloorId): MatchSetup {
  return { ...setup, arena: { ...setup.arena, geometry: { ...setup.arena.geometry, floor } } };
}

export function opponentControllerFor(setup: MatchSetup): SideControllerSpec {
  return { kind: 'ai', personality: setup.ai.style, difficulty: setup.ai.tier };
}

/** A typed seed, trimmed; blank means random. */
export function normalizeSeedText(text: string): string | null {
  const trimmed = text.trim();
  return trimmed === '' ? null : trimmed;
}

// --- Matchup summary ---------------------------------------------------

export interface MatchupLine {
  readonly tone: 'good' | 'bad' | 'even';
  readonly text: string;
}

/** Your Bey against theirs, rating by rating, in the player's words. */
export function matchupLines(setup: MatchSetup): readonly MatchupLine[] {
  const you = rosterEntry(setup.playerBeyId).definition;
  const them = rosterEntry(setup.opponentBeyId).definition;
  const compare = (mine: number, theirs: number, better: string, worse: string, even: string): MatchupLine => {
    const numbers = `(${mine} vs ${theirs})`;
    if (mine > theirs) return { tone: 'good', text: `${better} ${numbers}` };
    if (mine < theirs) return { tone: 'bad', text: `${worse} ${numbers}` };
    return { tone: 'even', text: `${even} ${numbers}` };
  };
  const lines = [
    compare(you.ratings.attack, them.ratings.attack, 'You hit harder', 'They hit harder', 'Even attack'),
    compare(you.ratings.defense, them.ratings.defense, 'You are tougher', 'They are tougher', 'Even defense'),
    compare(you.ratings.stamina, them.ratings.stamina, 'You last longer', 'They last longer', 'Even stamina'),
  ];
  const massRatio = you.physical.massKg / them.physical.massKg;
  if (massRatio > 1.1) lines.push({ tone: 'good', text: 'You are heavier: harder to knock out of the ring' });
  else if (massRatio < 0.9) lines.push({ tone: 'bad', text: 'They are heavier: you get launched further' });
  return lines;
}
