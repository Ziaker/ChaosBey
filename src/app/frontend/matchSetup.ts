// ============================================================
// MATCH SETUP — WHAT THE PLAYER CHOSE BEFORE A MATCH (M10)
// The pregame choices as plain data, and the functions that turn them
// into what a match is built from. Character Select fills the player's
// Bey; the Pregame screen fills the rest.
// ============================================================

import { DEFAULT_VFX_OPTIONS, sanitizeVfxOptions, type VfxOptions } from '../../vfx/hybrid/intensityTiers';
import { CONCEPT_BEYS, conceptBeyFor } from '../../bey/archetype/BeyConceptRoster';
import { AI_DIFFICULTY_TIERS, DEFAULT_AI_DIFFICULTY_TIER, type AiDifficultyTierId } from '../../ai/difficulty/AiDifficultyTiers';
import {
  ARENA_PRESETS,
  ARENA_WALL_BOUNCE_RANGE,
  ARENA_WALL_HEIGHT_RANGE,
  DEFAULT_ARENA_PRESET,
  arenaPreset,
  type ArenaGeometry,
  type ArenaPresetId,
} from '../../arena/presets/ArenaPresets';
import { ARENA_FLOOR_IDS, DEFAULT_ARENA_FLOOR, type ArenaFloorId } from '../../arena/floor/ArenaFloorProfile';
import { RING_OUT_DELAY_RANGE } from '../../arena/ringout/RingOutTuning';
import {
  BODY_COLLISION_DAMAGE_RANGE,
  MOMENTUM_DECAY_RANGE,
  MOMENTUM_FILL_RANGE,
  MOMENTUM_GAIN_RANGE,
  MOMENTUM_LOSS_ON_COLLISION_RANGE,
} from '../../bey/momentum/MomentumTuning';
import { MOVEMENT_STAMINA_DRAIN_RANGE } from '../../bey/stamina/StaminaTuning';
import { CIRCULAR_LAUNCH_FORCE_RANGE, DASH_COOLDOWN_RANGE } from '../../combat/attacks/AttackTuning';
import { CLASH_IMPACT_MULTIPLIER_DEFAULT } from '../../combat/clash/ClashTuning';
import {
  ACCELERATION_SCALE_RANGE,
  AIR_CONTROL_RANGE,
  ARENA_BOWL_DEPTH_RANGE,
  createDefaultMatchConfig,
  JUMP_COOLDOWN_RANGE,
  JUMP_STAMINA_COST_RANGE,
  ROUND_TIME_LIMIT_RANGE,
  TOP_SPEED_SCALE_RANGE,
  type MatchConfig,
  resolveMatchConfig,
} from '../../config/match/MatchConfig';
import { DODGE_COOLDOWN_RANGE } from '../../dodge/DodgeTuning';
import { JUMP_FULL_HEIGHT_RANGE, JUMP_SHORT_HOP_HEIGHT_RANGE } from '../../drift/DriftTuning';
import { DEFAULT_MOTION_DIRECTION, MOTION_DIRECTION_IDS, type MotionDirectionId } from '../../bey/motion/MotionPresets';
import type { MatchBeys } from '../bootstrap/createMatchScene';
import { AI_PERSONALITY_CHOICES, type AiPersonalityChoice, type SideControllerSpec } from '../session/SideControllers';
import { BEY_ROSTER, rosterEntry } from './beyRoster';
import { ROUNDS_TO_WIN_CHOICES, type RoundsToWin } from './matchScore';

export interface MatchSetup {
  readonly playerBeyId: string;
  readonly opponentBeyId: string;
  readonly ai: { readonly tier: AiDifficultyTierId; readonly style: AiPersonalityChoice };
  readonly roundsToWin: RoundsToWin;
  /** Arena preset (look + default walls) and the walls actually played (the preset's, or moved sliders). */
  readonly arena: { readonly presetId: ArenaPresetId; readonly geometry: ArenaGeometry };
  /** Advanced rules (GDD 152): scales the knockback a Clash resolution applies. */
  readonly clashImpactMultiplier: number;
  /** M11: the motion direction — Motion Lab A / B (default) / C. */
  readonly motion: MotionDirectionId;
  /** Fixed match seed text, or null for a fresh random seed every match. */
  readonly seedText: string | null;
  /** Advanced gameplay rules the Pregame exposes as sliders (owner, 2026-10-02), passed straight into MatchConfig. */
  readonly rules: MatchRules;
  /** Lote 9: visual options (presentation only — not MatchConfig, not the replay). */
  readonly visual: VfxOptions;
}

/** Range the Pregame slider offers for the Clash impact multiplier. */
export const CLASH_IMPACT_RANGE = { min: 0.5, max: 2, step: 0.25 } as const;

/**
 * The opponent a player meets by default: the same letter of the next family (Attack A meets Defense A, as in the
 * Debug Lab; Defense B meets Stamina B), so the first match is never a mirror — not even of gameplay, which B and C
 * share with their family for now (Lote 8).
 */
export function defaultOpponentFor(playerBeyId: string): string {
  const own = conceptBeyFor(playerBeyId);
  if (!own) return BEY_ROSTER[1]!.definition.id;
  const families = ['attack', 'defense', 'stamina'] as const;
  const nextFamily = families[(families.indexOf(own.family) + 1) % families.length];
  return CONCEPT_BEYS.find((c) => c.family === nextFamily && c.letter === own.letter)!.definition.id;
}

export function createDefaultMatchSetup(playerBeyId: string = BEY_ROSTER[0]!.definition.id): MatchSetup {
  return {
    playerBeyId,
    opponentBeyId: defaultOpponentFor(playerBeyId),
    ai: { tier: DEFAULT_AI_DIFFICULTY_TIER, style: 'archetype' },
    roundsToWin: 2,
    arena: { presetId: DEFAULT_ARENA_PRESET, geometry: arenaPreset(DEFAULT_ARENA_PRESET).geometry },
    clashImpactMultiplier: CLASH_IMPACT_MULTIPLIER_DEFAULT,
    motion: DEFAULT_MOTION_DIRECTION,
    seedText: null,
    rules: defaultMatchRules(),
    visual: DEFAULT_VFX_OPTIONS,
  };
}

/** The Pregame-adjustable gameplay rules: a slice of MatchConfig, so each one reaches the match (and its replay) through the one config path. */
export type MatchRules = Pick<
  MatchConfig,
  'ringOutDelayS' | 'dashCooldownS' | 'momentumGain' | 'momentumFillS' | 'momentumDecayS' | 'bodyCollisionDamage' | 'momentumLossOnCollision' | 'jumpFullHeightM' | 'jumpShortHopHeightM' | 'movementStaminaDrain' | 'dodgeCooldownS' | 'circularLaunchForce'
  | 'arenaBowlDepthM' | 'roundTimeLimitS' | 'winByKo' | 'winByRingOut' | 'winBySpinOut' | 'accelerationScale' | 'topSpeedScale' | 'strictSpeedCap' | 'airControl' | 'jumpStaminaCost' | 'jumpCooldownS'
>;

/** The rule keys the Pregame offers (Lote 9/12: all of them reset together and are remembered between matches). */
export const MATCH_RULE_KEYS = [
  'ringOutDelayS', 'dashCooldownS', 'momentumGain', 'momentumFillS', 'momentumDecayS', 'bodyCollisionDamage', 'momentumLossOnCollision', 'jumpFullHeightM', 'jumpShortHopHeightM', 'movementStaminaDrain', 'dodgeCooldownS', 'circularLaunchForce',
  'arenaBowlDepthM', 'roundTimeLimitS', 'winByKo', 'winByRingOut', 'winBySpinOut', 'accelerationScale', 'topSpeedScale', 'strictSpeedCap', 'airControl', 'jumpStaminaCost', 'jumpCooldownS',
] as const satisfies readonly (keyof MatchRules)[];

/**
 * Lote 9: win conditions stay playable — at least one is on (all three come back on otherwise), and with ring-out off
 * a round needs a time limit (a Bey knocked out of the arena could otherwise never be beaten): 90 s if none was set.
 */
export const RING_OUT_OFF_TIME_LIMIT_S = 90;
export function sanitizeMatchRules(rules: MatchRules): MatchRules {
  let r = rules;
  if (!r.winByKo && !r.winByRingOut && !r.winBySpinOut) r = { ...r, winByKo: true, winByRingOut: true, winBySpinOut: true };
  if (!r.winByRingOut && r.roundTimeLimitS <= 0) r = { ...r, roundTimeLimitS: RING_OUT_OFF_TIME_LIMIT_S };
  return r;
}

const clamp = (value: number, range: { readonly min: number; readonly max: number }): number => Math.min(range.max, Math.max(range.min, value));

/**
 * Persisted Pregame values are untrusted/old UI data. Clamp them against the exact range constants that the current
 * Pregame renders; do not change resolveMatchConfig globally, because replay/backcompat may intentionally carry an old
 * but valid resolved MatchConfig outside today's playtest sliders.
 */
function clampPersistedMatchRules(rules: MatchRules): MatchRules {
  return {
    ...rules,
    ringOutDelayS: clamp(rules.ringOutDelayS, RING_OUT_DELAY_RANGE),
    dashCooldownS: clamp(rules.dashCooldownS, DASH_COOLDOWN_RANGE),
    momentumGain: clamp(rules.momentumGain, MOMENTUM_GAIN_RANGE),
    momentumFillS: clamp(rules.momentumFillS, MOMENTUM_FILL_RANGE),
    momentumDecayS: clamp(rules.momentumDecayS, MOMENTUM_DECAY_RANGE),
    bodyCollisionDamage: clamp(rules.bodyCollisionDamage, BODY_COLLISION_DAMAGE_RANGE),
    momentumLossOnCollision: clamp(rules.momentumLossOnCollision, MOMENTUM_LOSS_ON_COLLISION_RANGE),
    jumpFullHeightM: clamp(rules.jumpFullHeightM, JUMP_FULL_HEIGHT_RANGE),
    jumpShortHopHeightM: clamp(rules.jumpShortHopHeightM, JUMP_SHORT_HOP_HEIGHT_RANGE),
    movementStaminaDrain: clamp(rules.movementStaminaDrain, MOVEMENT_STAMINA_DRAIN_RANGE),
    dodgeCooldownS: clamp(rules.dodgeCooldownS, DODGE_COOLDOWN_RANGE),
    circularLaunchForce: clamp(rules.circularLaunchForce, CIRCULAR_LAUNCH_FORCE_RANGE),
    arenaBowlDepthM: clamp(rules.arenaBowlDepthM, ARENA_BOWL_DEPTH_RANGE),
    roundTimeLimitS: clamp(rules.roundTimeLimitS, ROUND_TIME_LIMIT_RANGE),
    accelerationScale: clamp(rules.accelerationScale, ACCELERATION_SCALE_RANGE),
    topSpeedScale: clamp(rules.topSpeedScale, TOP_SPEED_SCALE_RANGE),
    airControl: clamp(rules.airControl, AIR_CONTROL_RANGE),
    jumpStaminaCost: clamp(rules.jumpStaminaCost, JUMP_STAMINA_COST_RANGE),
    jumpCooldownS: clamp(rules.jumpCooldownS, JUMP_COOLDOWN_RANGE),
  };
}

export function defaultMatchRules(): MatchRules {
  const config = createDefaultMatchConfig();
  return {
    arenaBowlDepthM: config.arenaBowlDepthM,
    roundTimeLimitS: config.roundTimeLimitS,
    winByKo: config.winByKo,
    winByRingOut: config.winByRingOut,
    winBySpinOut: config.winBySpinOut,
    accelerationScale: config.accelerationScale,
    topSpeedScale: config.topSpeedScale,
    strictSpeedCap: config.strictSpeedCap,
    airControl: config.airControl,
    jumpStaminaCost: config.jumpStaminaCost,
    jumpCooldownS: config.jumpCooldownS,
    ringOutDelayS: config.ringOutDelayS,
    dashCooldownS: config.dashCooldownS,
    momentumGain: config.momentumGain,
    momentumFillS: config.momentumFillS,
    momentumDecayS: config.momentumDecayS,
    bodyCollisionDamage: config.bodyCollisionDamage,
    momentumLossOnCollision: config.momentumLossOnCollision,
    jumpFullHeightM: config.jumpFullHeightM,
    jumpShortHopHeightM: config.jumpShortHopHeightM,
    movementStaminaDrain: config.movementStaminaDrain,
    dodgeCooldownS: config.dodgeCooldownS,
    circularLaunchForce: config.circularLaunchForce,
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
    motion: setup.motion ?? DEFAULT_MOTION_DIRECTION,
    ...sanitizeMatchRules({ ...defaultMatchRules(), ...(setup.rules ?? {}) }),
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

// --- Remembering the last setup (Lote 9) ----------------------------------

const SETUP_STORAGE_KEY = 'chaosbey.pregame.last.v1';

/** The parts of a setup the Pregame remembers between matches (and reloads): everything but the seed. */
export function saveLastSetup(setup: MatchSetup, storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try {
    storage?.setItem(SETUP_STORAGE_KEY, JSON.stringify({ ...setup, seedText: null }));
  } catch {
    // Private mode / blocked storage: the setup is simply not remembered.
  }
}

/**
 * The last setup used, validated against today's roster, rules and ranges; anything unknown or out of shape falls
 * back to the default, so an old save can never break the Pregame.
 */
export function loadLastSetup(storage: Pick<Storage, 'getItem'> | null = safeStorage()): MatchSetup | null {
  let raw: unknown;
  try {
    const text = storage?.getItem(SETUP_STORAGE_KEY);
    if (!text) return null;
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const saved = raw as Partial<MatchSetup>;
  const base = createDefaultMatchSetup(typeof saved.playerBeyId === 'string' && rosterEntryExists(saved.playerBeyId) ? saved.playerBeyId : undefined);
  const rules: Record<string, unknown> = { ...base.rules };
  for (const key of MATCH_RULE_KEYS) {
    const value = (saved.rules as Record<string, unknown> | undefined)?.[key];
    if (typeof value === typeof rules[key] && (typeof value !== 'number' || Number.isFinite(value))) rules[key] = value;
  }
  const visual = sanitizeVfxOptions(saved.visual);
  const clampedRules = clampPersistedMatchRules(rules as unknown as MatchRules);

  const savedAi = saved.ai && typeof saved.ai === 'object' ? saved.ai : null;
  const aiTier = AI_DIFFICULTY_TIERS.some((tier) => tier.id === savedAi?.tier) ? (savedAi!.tier as AiDifficultyTierId) : base.ai.tier;
  const aiStyle = AI_PERSONALITY_CHOICES.includes(savedAi?.style as AiPersonalityChoice) ? (savedAi!.style as AiPersonalityChoice) : base.ai.style;
  const roundsToWin = ROUNDS_TO_WIN_CHOICES.includes(saved.roundsToWin as RoundsToWin) ? (saved.roundsToWin as RoundsToWin) : base.roundsToWin;
  const motion = MOTION_DIRECTION_IDS.includes(saved.motion as MotionDirectionId) ? (saved.motion as MotionDirectionId) : base.motion;
  const clashImpactMultiplier = typeof saved.clashImpactMultiplier === 'number' && Number.isFinite(saved.clashImpactMultiplier)
    ? clamp(saved.clashImpactMultiplier, CLASH_IMPACT_RANGE)
    : base.clashImpactMultiplier;
  const arena = sanitizePersistedArena(saved.arena, base.arena);

  return {
    ...base,
    opponentBeyId: typeof saved.opponentBeyId === 'string' && rosterEntryExists(saved.opponentBeyId) ? saved.opponentBeyId : base.opponentBeyId,
    ai: { tier: aiTier, style: aiStyle },
    roundsToWin,
    arena,
    clashImpactMultiplier,
    motion,
    rules: sanitizeMatchRules(clampedRules),
    visual,
  };
}

function sanitizePersistedArena(saved: Partial<MatchSetup>['arena'], fallback: MatchSetup['arena']): MatchSetup['arena'] {
  if (!saved || typeof saved !== 'object' || !saved.geometry || typeof saved.geometry !== 'object') return fallback;
  if (!ARENA_PRESETS.some((preset) => preset.id === saved.presetId)) return fallback;

  const geometry = saved.geometry as ArenaGeometry;
  if (geometry.floor !== undefined && !ARENA_FLOOR_IDS.includes(geometry.floor as ArenaFloorId)) return fallback;

  const presetId = saved.presetId as ArenaPresetId;
  const own = arenaPreset(presetId).geometry;
  const wallHeightM = typeof geometry.wallHeightM === 'number' && Number.isFinite(geometry.wallHeightM)
    ? clamp(geometry.wallHeightM, ARENA_WALL_HEIGHT_RANGE)
    : own.wallHeightM;
  const wallRestitution = typeof geometry.wallRestitution === 'number' && Number.isFinite(geometry.wallRestitution)
    ? clamp(geometry.wallRestitution, ARENA_WALL_BOUNCE_RANGE)
    : own.wallRestitution;
  const floor = geometry.floor as ArenaFloorId | undefined;

  return {
    presetId,
    geometry: floor === undefined ? { ...own, wallHeightM, wallRestitution } : { ...own, wallHeightM, wallRestitution, floor },
  };
}

function rosterEntryExists(id: string): boolean {
  return BEY_ROSTER.some((e) => e.definition.id === id);
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Short names and formats of the Pregame rules, for the "What to expect" summary (Lote 9/12). */
const RULE_SUMMARY: Readonly<Record<(typeof MATCH_RULE_KEYS)[number], { readonly name: string; readonly format: (v: number | boolean) => string }>> = {
  ringOutDelayS: { name: 'ring-out delay', format: (v) => `${(v as number).toFixed(2)} s` },
  dashCooldownS: { name: 'Dash cooldown', format: (v) => `${(v as number).toFixed(2)} s` },
  momentumGain: { name: 'momentum gain', format: (v) => `+${Math.round((v as number) * 100)}%` },
  momentumFillS: { name: 'momentum build-up', format: (v) => `${(v as number).toFixed(1)} s` },
  momentumDecayS: { name: 'momentum decay', format: (v) => `${(v as number).toFixed(2)} s` },
  bodyCollisionDamage: { name: 'body collision damage', format: (v) => `×${(v as number).toFixed(1)}` },
  momentumLossOnCollision: { name: 'momentum loss on collision', format: (v) => `${Math.round((v as number) * 100)}%` },
  jumpFullHeightM: { name: 'full jump', format: (v) => `${(v as number).toFixed(2)} m` },
  jumpShortHopHeightM: { name: 'short hop', format: (v) => `${(v as number).toFixed(2)} m` },
  movementStaminaDrain: { name: 'movement stamina drain', format: (v) => `${Math.round((v as number) * 100)}%` },
  dodgeCooldownS: { name: 'dodge cooldown', format: (v) => `${(v as number).toFixed(2)} s` },
  circularLaunchForce: { name: 'Circular launch', format: (v) => `×${(v as number).toFixed(1)}` },
  arenaBowlDepthM: { name: 'bowl depth', format: (v) => `${(v as number).toFixed(2)} m` },
  roundTimeLimitS: { name: 'time limit', format: (v) => ((v as number) === 0 ? 'none' : `${(v as number).toFixed(0)} s`) },
  winByKo: { name: 'knock-out', format: (v) => (v ? 'on' : 'off') },
  winByRingOut: { name: 'ring-out', format: (v) => (v ? 'on' : 'off') },
  winBySpinOut: { name: 'spin-out', format: (v) => (v ? 'on' : 'off') },
  accelerationScale: { name: 'acceleration', format: (v) => `×${(v as number).toFixed(2)}` },
  topSpeedScale: { name: 'top speed', format: (v) => `×${(v as number).toFixed(2)}` },
  strictSpeedCap: { name: 'strict speed cap', format: (v) => (v ? 'on' : 'off') },
  airControl: { name: 'air control', format: (v) => `×${(v as number).toFixed(2)}` },
  jumpStaminaCost: { name: 'jump stamina cost', format: (v) => `${(v as number).toFixed(0)}` },
  jumpCooldownS: { name: 'jump cooldown', format: (v) => `${(v as number).toFixed(1)} s` },
};

/** "Dash cooldown 2.00 s", … for every rule that differs from its default (Lote 9: the explanation reflects the values). */
export function changedRuleLines(setup: MatchSetup): string[] {
  const defaults = defaultMatchRules();
  const rules = setup.rules ?? defaults;
  return MATCH_RULE_KEYS.filter((key) => rules[key] !== defaults[key]).map((key) => `${RULE_SUMMARY[key].name} ${RULE_SUMMARY[key].format(rules[key])}`);
}
