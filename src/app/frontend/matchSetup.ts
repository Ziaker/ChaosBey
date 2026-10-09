// ============================================================
// MATCH SETUP — WHAT THE PLAYER CHOSE BEFORE A MATCH (M10)
// The pregame choices as plain data, and the functions that turn them
// into what a match is built from. Character Select fills the player's
// Bey; the Pregame screen fills the rest.
// ============================================================

import { DEFAULT_VFX_OPTIONS, type VfxOptions } from '../../vfx/hybrid/intensityTiers';
import { CONCEPT_BEYS, conceptBeyFor } from '../../bey/archetype/BeyConceptRoster';
import { DEFAULT_AI_DIFFICULTY_TIER, type AiDifficultyTierId } from '../../ai/difficulty/AiDifficultyTiers';
import { DEFAULT_ARENA_PRESET, arenaPreset, isPresetGeometry, type ArenaGeometry, type ArenaPresetId } from '../../arena/presets/ArenaPresets';
import { DEFAULT_ARENA_FLOOR, type ArenaFloorId } from '../../arena/floor/ArenaFloorProfile';
import { CLASH_IMPACT_MULTIPLIER_DEFAULT } from '../../combat/clash/ClashTuning';
import { createDefaultMatchConfig, type MatchConfig, resolveMatchConfig } from '../../config/match/MatchConfig';
import { DEFAULT_MOTION_DIRECTION, type MotionDirectionId } from '../../bey/motion/MotionPresets';
import { REAL_BASE_PARAMS, sanitizeRealParams, type RealParams } from '../../bey/real/RealTuning';
import { DEFAULT_REAL_CAMERA, REAL_CAMERA_MODES, type RealCameraMode } from '../../camera/real/RealCameraModes';
import { realMatchOverrides } from '../../bey/real/realMatchRules';
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
  /** M11: the motion direction — Motion Lab A / B (default) / C. */
  readonly motion: MotionDirectionId;
  /** Fixed match seed text, or null for a fresh random seed every match. */
  readonly seedText: string | null;
  /** Advanced gameplay rules the Pregame exposes as sliders (owner, 2026-10-02), passed straight into MatchConfig. */
  readonly rules: MatchRules;
  /** Lote 9: visual options (presentation only — not MatchConfig, not the replay). */
  readonly visual: VfxOptions;
  /** Bey Real (0.59.0): the alternative mode — off by default. Absent on a setup saved before it existed. */
  readonly real?: RealSetup;
}

/** The Bey Real block of the Pregame: whether the mode is on, the camera, and every value of the mode (RealTuning.ts). */
export interface RealSetup {
  readonly enabled: boolean;
  readonly camera: RealCameraMode;
  /** Which preset the values came from, for the label; the values themselves are what counts. */
  readonly presetId: string;
  readonly params: RealParams;
}

export function defaultRealSetup(): RealSetup {
  return { enabled: false, camera: DEFAULT_REAL_CAMERA, presetId: 'base', params: { ...REAL_BASE_PARAMS } };
}

/** A saved or typed Bey Real block, checked field by field (anything unknown falls back to the base). */
export function sanitizeRealSetup(raw: unknown): RealSetup {
  const base = defaultRealSetup();
  if (!raw || typeof raw !== 'object') return base;
  const value = raw as Partial<RealSetup>;
  return {
    enabled: value.enabled === true,
    camera: (REAL_CAMERA_MODES as readonly unknown[]).includes(value.camera) ? (value.camera as RealCameraMode) : base.camera,
    presetId: typeof value.presetId === 'string' ? value.presetId : base.presetId,
    params: sanitizeRealParams(value.params as Partial<Record<keyof RealParams, unknown>> | undefined),
  };
}

/** True while the setup plays Bey Real. */
export function isRealMode(setup: MatchSetup): boolean {
  return setup.real?.enabled === true;
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
    real: defaultRealSetup(),
  };
}

/** The Pregame-adjustable gameplay rules: a slice of MatchConfig, so each one reaches the match (and its replay) through the one config path. */
export type MatchRules = Pick<
  MatchConfig,
  'ringOutDelayS' | 'dashCooldownS' | 'momentumGain' | 'momentumFillS' | 'momentumDecayS' | 'bodyCollisionDamage' | 'momentumLossOnCollision' | 'jumpFullHeightM' | 'jumpShortHopHeightM' | 'movementStaminaDrain' | 'dodgeCooldownS' | 'circularLaunchForce'
  | 'arenaBowlDepthM' | 'roundTimeLimitS' | 'winByKo' | 'winByRingOut' | 'winBySpinOut' | 'accelerationScale' | 'topSpeedScale' | 'airControl' | 'jumpStaminaCost' | 'jumpCooldownS' | 'speedDamageGain' | 'dashCarriesSpeed'
  | 'turnRateScale' | 'turnSpeedRetention' | 'jumpHoldForFullS' | 'gravityScale' | 'contactRepelMps' | 'attackRecoilMps' | 'highSpeedControl' | 'arenaSizeScale' | 'gameSpeed' | 'clashLaunchMps' | 'dodgeStaminaCost' | 'dodgeDistanceScale' | 'contactLiftMps' | 'knockbackScale' | 'spinStaminaDrain' | 'circularLockAfterHitS' | 'bodyContactControlLossScale'
  | 'circularAttack' | 'beySizeScale' | 'airRecoveryMinDelayS' | 'funnelPull' | 'railsEnabled' | 'railSpeed'
>;

/** The rule keys the Pregame offers (Lote 9: all of them reset together and are remembered between matches). */
export const MATCH_RULE_KEYS = [
  'ringOutDelayS', 'dashCooldownS', 'momentumGain', 'momentumFillS', 'momentumDecayS', 'bodyCollisionDamage', 'momentumLossOnCollision', 'jumpFullHeightM', 'jumpShortHopHeightM', 'movementStaminaDrain', 'dodgeCooldownS', 'circularLaunchForce',
  'arenaBowlDepthM', 'roundTimeLimitS', 'winByKo', 'winByRingOut', 'winBySpinOut', 'accelerationScale', 'topSpeedScale', 'airControl', 'jumpStaminaCost', 'jumpCooldownS', 'speedDamageGain', 'dashCarriesSpeed',
  'turnRateScale', 'turnSpeedRetention', 'jumpHoldForFullS', 'gravityScale', 'contactRepelMps', 'attackRecoilMps', 'highSpeedControl', 'arenaSizeScale', 'gameSpeed', 'clashLaunchMps', 'dodgeStaminaCost', 'dodgeDistanceScale', 'contactLiftMps', 'knockbackScale', 'spinStaminaDrain', 'circularLockAfterHitS', 'bodyContactControlLossScale',
  'circularAttack', 'beySizeScale', 'airRecoveryMinDelayS', 'funnelPull', 'railsEnabled', 'railSpeed',
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
    speedDamageGain: config.speedDamageGain,
    dashCarriesSpeed: config.dashCarriesSpeed,
    turnRateScale: config.turnRateScale,
    turnSpeedRetention: config.turnSpeedRetention,
    jumpHoldForFullS: config.jumpHoldForFullS,
    gravityScale: config.gravityScale,
    contactRepelMps: config.contactRepelMps,
    attackRecoilMps: config.attackRecoilMps,
    highSpeedControl: config.highSpeedControl,
    arenaSizeScale: config.arenaSizeScale,
    gameSpeed: config.gameSpeed,
    clashLaunchMps: config.clashLaunchMps,
    dodgeStaminaCost: config.dodgeStaminaCost,
    dodgeDistanceScale: config.dodgeDistanceScale,
    contactLiftMps: config.contactLiftMps,
    knockbackScale: config.knockbackScale,
    spinStaminaDrain: config.spinStaminaDrain,
    circularLockAfterHitS: config.circularLockAfterHitS,
    bodyContactControlLossScale: config.bodyContactControlLossScale,
    circularAttack: config.circularAttack,
    beySizeScale: config.beySizeScale,
    airRecoveryMinDelayS: config.airRecoveryMinDelayS,
    funnelPull: config.funnelPull,
    railsEnabled: config.railsEnabled,
    railSpeed: config.railSpeed,
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
  const config = classicMatchConfigFor(setup);
  // Bey Real: the same config path, with the mode's rules on top (realMatchRules.ts) and `real` for the motion model.
  return setup.real?.enabled ? { ...config, ...realMatchOverrides(setup.real.params) } : config;
}

function classicMatchConfigFor(setup: MatchSetup): MatchConfig {
  return resolveMatchConfig({
    clashImpactMultiplier: setup.clashImpactMultiplier,
    arenaWallHeightM: setup.arena.geometry.wallHeightM,
    arenaWallRestitution: setup.arena.geometry.wallRestitution,
    arenaFloor: setup.arena.geometry.floor ?? DEFAULT_ARENA_FLOOR,
    motion: setup.motion ?? DEFAULT_MOTION_DIRECTION,
    // Owner, 2026-10-07: a round starts with the Launch System A (docs/design-decisions/launch-system-approval.md). Not a rule the Pregame changes.
    launchSequence: true,
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

// v2 (owner, 2026-10-04): new defaults (speed ×1.45, funnel 7 m, jump rule) must not be hidden by a remembered v1 setup.
const SETUP_STORAGE_KEY = 'chaosbey.pregame.last.v2';
/**
 * Bumped when an owner decision changes a rule's default. A setup saved before it that still holds the OLD default
 * takes the new one (the player never chose that value); a value the player changed is kept.
 * 1 (owner, 2026-10-05): dodge cooldown 2.5 s -> 1.25 s.
 */
const RULES_DEFAULTS_REVISION = 1;
const SUPERSEDED_DEFAULTS: readonly { readonly revision: number; readonly key: string; readonly oldDefault: number }[] = [{ revision: 1, key: 'dodgeCooldownS', oldDefault: 2.5 }];

/** The parts of a setup the Pregame remembers between matches (and reloads): everything but the seed. */
export function saveLastSetup(setup: MatchSetup, storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try {
    storage?.setItem(SETUP_STORAGE_KEY, JSON.stringify({ ...setup, seedText: null, rulesDefaultsRevision: RULES_DEFAULTS_REVISION }));
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
  const savedRevision = typeof (raw as { rulesDefaultsRevision?: unknown }).rulesDefaultsRevision === 'number' ? (raw as { rulesDefaultsRevision: number }).rulesDefaultsRevision : 0;
  for (const key of MATCH_RULE_KEYS) {
    const value = (saved.rules as Record<string, unknown> | undefined)?.[key];
    const superseded = SUPERSEDED_DEFAULTS.some((d) => d.key === key && savedRevision < d.revision && value === d.oldDefault);
    if (!superseded && typeof value === typeof rules[key] && (typeof value !== 'number' || Number.isFinite(value))) rules[key] = value;
  }
  const visual: Record<string, unknown> = { ...base.visual };
  for (const key of Object.keys(DEFAULT_VFX_OPTIONS)) {
    const value = (saved.visual as Record<string, unknown> | undefined)?.[key];
    if (typeof value === 'number' && Number.isFinite(value)) visual[key] = value;
  }
  return {
    ...base,
    opponentBeyId: typeof saved.opponentBeyId === 'string' && rosterEntryExists(saved.opponentBeyId) ? saved.opponentBeyId : base.opponentBeyId,
    ai: saved.ai && typeof saved.ai === 'object' ? { ...base.ai, ...saved.ai } : base.ai,
    roundsToWin: saved.roundsToWin ?? base.roundsToWin,
    arena: saved.arena && typeof saved.arena === 'object' && saved.arena.geometry ? { ...base.arena, ...saved.arena, geometry: { ...base.arena.geometry, ...saved.arena.geometry } } : base.arena,
    clashImpactMultiplier: typeof saved.clashImpactMultiplier === 'number' ? saved.clashImpactMultiplier : base.clashImpactMultiplier,
    motion: saved.motion ?? base.motion,
    rules: sanitizeMatchRules(rules as unknown as MatchRules),
    visual: visual as unknown as VfxOptions,
    real: sanitizeRealSetup((raw as { real?: unknown }).real),
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

/** Short names and formats of the Pregame rules, for the "What to expect" summary (Lote 9). */
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
  airControl: { name: 'air control', format: (v) => `×${(v as number).toFixed(2)}` },
  jumpStaminaCost: { name: 'jump stamina cost', format: (v) => `${(v as number).toFixed(0)}` },
  jumpCooldownS: { name: 'jump cooldown', format: (v) => `${(v as number).toFixed(1)} s` },
  speedDamageGain: { name: 'speed → damage', format: (v) => ((v as number) === 0 ? 'off' : `${Math.round((v as number) * 100)}%`) },
  dashCarriesSpeed: { name: 'Dash keeps momentum', format: (v) => (v ? 'on' : 'off') },
  turnRateScale: { name: 'turn rate', format: (v) => `×${(v as number).toFixed(2)}` },
  turnSpeedRetention: { name: 'speed kept in turns', format: (v) => `${Math.round((v as number) * 100)}%` },
  jumpHoldForFullS: { name: 'hold for full jump', format: (v) => `${(v as number).toFixed(2)} s` },
  gravityScale: { name: 'gravity', format: (v) => `×${(v as number).toFixed(1)}` },
  contactRepelMps: { name: 'contact repel', format: (v) => `${(v as number).toFixed(1)} m/s` },
  attackRecoilMps: { name: 'attack recoil', format: (v) => `${(v as number).toFixed(1)} m/s` },
  dodgeStaminaCost: { name: 'dodge stamina cost', format: (v) => ((v as number) === 0 ? 'free' : `${(v as number).toFixed(0)}`) },
  dodgeDistanceScale: { name: 'dodge distance', format: (v) => `×${(v as number).toFixed(2)}` },
  contactLiftMps: { name: 'contact lift', format: (v) => `${(v as number).toFixed(1)} m/s` },
  knockbackScale: { name: 'knockback', format: (v) => `×${(v as number).toFixed(2)}` },
  spinStaminaDrain: { name: 'spin stamina drain', format: (v) => `×${(v as number).toFixed(1)}` },
  circularLockAfterHitS: { name: 'Circular lockout after a hit', format: (v) => `${(v as number).toFixed(2)} s` },
  bodyContactControlLossScale: { name: 'control loss on body contact', format: (v) => `×${(v as number).toFixed(2)}` },
  arenaSizeScale: { name: 'stage size', format: (v) => `×${(v as number).toFixed(2)}` },
  gameSpeed: { name: 'game speed', format: (v) => `×${(v as number).toFixed(2)}` },
  clashLaunchMps: { name: 'Clash knockback', format: (v) => `${(v as number).toFixed(0)} m/s` },
  highSpeedControl: { name: 'control at speed', format: (v) => `${Math.round((v as number) * 100)}%` },
  circularAttack: { name: 'Circular attack', format: (v) => (v ? 'on' : 'off') },
  beySizeScale: { name: 'Bey size', format: (v) => `×${(v as number).toFixed(2)}` },
  airRecoveryMinDelayS: { name: 'recovery time', format: (v) => `${(v as number).toFixed(2)} s` },
  funnelPull: { name: 'funnel pull', format: (v) => `×${(v as number).toFixed(1)}` },
  railsEnabled: { name: 'Rails', format: (v) => (v ? 'on' : 'off') },
  railSpeed: { name: 'rail speed', format: (v) => `×${(v as number).toFixed(2)}` },
};

/**
 * Every advanced rule, the arena's walls, Clash impact and the visual options back to their defaults (Bey, AI, arena look,
 * floor profile, motion direction, rounds and seed stay). The Pregame's "Reset to defaults" and the Pause menu's "Default
 * rules" are this one function.
 */
export function withDefaultRules(setup: MatchSetup): MatchSetup {
  const preset = arenaPreset(setup.arena.presetId).geometry;
  return {
    ...setup,
    rules: defaultMatchRules(),
    visual: DEFAULT_VFX_OPTIONS,
    clashImpactMultiplier: CLASH_IMPACT_MULTIPLIER_DEFAULT,
    arena: { ...setup.arena, geometry: { ...setup.arena.geometry, wallHeightM: preset.wallHeightM, wallRestitution: preset.wallRestitution } },
  };
}

/**
 * Polish (owner, 2026-10-07, idea 10): everything this match plays differently from the defaults, in the player's words —
 * custom walls, a Clash impact other than ×1, a movement direction other than the default, and every rule that differs
 * (changedRuleLines). Empty = the match is on the defaults. Shown on the Pause menu, so "the drift feels odd" can be told
 * apart from "this match has custom rules".
 */
export function activeRuleLines(setup: MatchSetup): string[] {
  const lines: string[] = [];
  const walls = setup.arena.geometry;
  if (!isPresetGeometry(setup.arena.presetId, walls)) lines.push(`Walls ${walls.wallHeightM.toFixed(1)} m high, bounce ${walls.wallRestitution.toFixed(2)}`);
  if (setup.clashImpactMultiplier !== CLASH_IMPACT_MULTIPLIER_DEFAULT) lines.push(`Clash impact ×${setup.clashImpactMultiplier.toFixed(2)}`);
  if ((setup.motion ?? DEFAULT_MOTION_DIRECTION) !== DEFAULT_MOTION_DIRECTION) lines.push(`Movement direction ${setup.motion}`);
  if (isRealMode(setup)) lines.push(`Bey Real (influence ${Math.round(setup.real!.params.influence * 100)}%, ${setup.real!.params.stageRadiusM.toFixed(0)} m stage)`);
  return [...lines, ...changedRuleLines(setup)];
}

/** "Dash cooldown 2.00 s", … for every rule that differs from its default (Lote 9: the explanation reflects the values). */
export function changedRuleLines(setup: MatchSetup): string[] {
  const defaults = defaultMatchRules();
  const rules = setup.rules ?? defaults;
  return MATCH_RULE_KEYS.filter((key) => rules[key] !== defaults[key]).map((key) => `${RULE_SUMMARY[key].name} ${RULE_SUMMARY[key].format(rules[key])}`);
}

// ============================================================
// Saved rule configurations (owner, 2026-10-04: "adicione a opção de salvar configuração de regras avançadas").
// Named snapshots of the Advanced rules (gameplay rules, walls, Clash impact, visual options), kept in this browser.
// Loading one runs it through the same checks as the remembered setup, so an old save can't break the Pregame.
// ============================================================

const RULE_PRESETS_KEY = 'chaosbey.pregame.rulePresets.v1';

export interface SavedRuleConfig {
  readonly rules: MatchRules;
  readonly visual: VfxOptions;
  readonly clashImpactMultiplier: number;
  readonly walls: { readonly wallHeightM: number; readonly wallRestitution: number };
}

export function loadRuleConfigs(storage: Pick<Storage, 'getItem'> | null = safeStorage()): Record<string, SavedRuleConfig> {
  try {
    const text = storage?.getItem(RULE_PRESETS_KEY);
    const raw = text ? (JSON.parse(text) as unknown) : null;
    return raw && typeof raw === 'object' ? (raw as Record<string, SavedRuleConfig>) : {};
  } catch {
    return {};
  }
}

export function saveRuleConfig(name: string, setup: MatchSetup, storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeStorage()): void {
  const all = loadRuleConfigs(storage);
  all[name] = { rules: setup.rules, visual: setup.visual, clashImpactMultiplier: setup.clashImpactMultiplier, walls: { wallHeightM: setup.arena.geometry.wallHeightM, wallRestitution: setup.arena.geometry.wallRestitution } };
  try {
    storage?.setItem(RULE_PRESETS_KEY, JSON.stringify(all));
  } catch {
    // Storage blocked: nothing is saved.
  }
}

export function deleteRuleConfig(name: string, storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeStorage()): void {
  const all = loadRuleConfigs(storage);
  delete all[name];
  try {
    storage?.setItem(RULE_PRESETS_KEY, JSON.stringify(all));
  } catch {
    // Storage blocked.
  }
}

/** The setup with a saved configuration applied (validated field by field against today's rules). */
export function withRuleConfig(setup: MatchSetup, saved: SavedRuleConfig): MatchSetup {
  const rules: Record<string, unknown> = { ...defaultMatchRules() };
  for (const key of MATCH_RULE_KEYS) {
    const value = (saved.rules as Record<string, unknown> | undefined)?.[key];
    if (typeof value === typeof rules[key] && (typeof value !== 'number' || Number.isFinite(value))) rules[key] = value;
  }
  const visual: Record<string, unknown> = { ...DEFAULT_VFX_OPTIONS };
  for (const key of Object.keys(DEFAULT_VFX_OPTIONS)) {
    const value = (saved.visual as unknown as Record<string, unknown> | undefined)?.[key];
    if (typeof value === 'number' && Number.isFinite(value)) visual[key] = value;
  }
  const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
  return {
    ...setup,
    rules: sanitizeMatchRules(rules as unknown as MatchRules),
    visual: visual as unknown as VfxOptions,
    clashImpactMultiplier: num(saved.clashImpactMultiplier, setup.clashImpactMultiplier),
    arena: { ...setup.arena, geometry: { ...setup.arena.geometry, wallHeightM: num(saved.walls?.wallHeightM, setup.arena.geometry.wallHeightM), wallRestitution: num(saved.walls?.wallRestitution, setup.arena.geometry.wallRestitution) } },
  };
}
