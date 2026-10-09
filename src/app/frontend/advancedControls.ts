// ============================================================
// ADVANCED CONTROLS — the one list of every Advanced setting (Pregame overhaul, owner 2026-10-07)
// docs/design-decisions/pregame-overhaul.md: Advanced is organised in six categories (Movement / Jump / Combat / Arena /
// Round / Visual), shows each value's Normal Original default and a MODIFIED state against it, and the official presets
// (pregamePresets.ts) are complete configurations of exactly these controls. This file is data and pure helpers — no DOM —
// so the screen, the presets and the tests all read the same list, and a setting cannot exist in one and not the others.
//
// Where a value lives: most are MatchRules (matchSetup.ts, the slice of MatchConfig the Pregame passes on); Clash impact is
// the setup's own multiplier; the wall height and bounce are the arena geometry; the four effects sliders are VfxOptions
// (presentation only). `readAdvanced` / `writeAdvanced` / `normalOriginalValue` hide that.
// ============================================================

import { RING_OUT_DELAY_RANGE } from '../../arena/ringout/RingOutTuning';
import { CIRCULAR_LAUNCH_FORCE_RANGE, DASH_COOLDOWN_RANGE } from '../../combat/attacks/AttackTuning';
import { BODY_COLLISION_DAMAGE_RANGE, MOMENTUM_DECAY_RANGE, MOMENTUM_FILL_RANGE, MOMENTUM_GAIN_RANGE, MOMENTUM_LOSS_ON_COLLISION_RANGE } from '../../bey/momentum/MomentumTuning';
import { JUMP_FULL_HEIGHT_RANGE, JUMP_HOLD_FOR_FULL_RANGE, JUMP_SHORT_HOP_HEIGHT_RANGE } from '../../drift/DriftTuning';
import { MOVEMENT_STAMINA_DRAIN_RANGE } from '../../bey/stamina/StaminaTuning';
import { DODGE_COOLDOWN_RANGE } from '../../dodge/DodgeTuning';
import { SPEED_DAMAGE_GAIN_RANGE } from '../../combat/attacks/SpeedDamage';
import { CLASH_IMPACT_MULTIPLIER_DEFAULT } from '../../combat/clash/ClashTuning';
import { ARENA_WALL_BOUNCE_RANGE, ARENA_WALL_HEIGHT_RANGE, arenaPreset } from '../../arena/presets/ArenaPresets';
import {
  ACCELERATION_SCALE_RANGE,
  AIR_CONTROL_RANGE,
  AIR_RECOVERY_MIN_DELAY_RANGE,
  ARENA_BOWL_DEPTH_RANGE,
  ARENA_SIZE_SCALE_RANGE,
  BEY_SIZE_SCALE_RANGE,
  BODY_CONTACT_CONTROL_LOSS_RANGE,
  CIRCULAR_LOCK_RANGE,
  CLASH_LAUNCH_RANGE,
  CONTACT_LIFT_RANGE,
  DODGE_DISTANCE_SCALE_RANGE,
  DODGE_STAMINA_COST_RANGE,
  GAME_SPEED_RANGE,
  GRAVITY_SCALE_RANGE,
  FUNNEL_PULL_RANGE,
  RAIL_SPEED_RANGE,
  IMPACT_PUSH_RANGE,
  JUMP_COOLDOWN_RANGE,
  JUMP_STAMINA_COST_RANGE,
  KNOCKBACK_SCALE_RANGE,
  ROUND_TIME_LIMIT_RANGE,
  SPIN_STAMINA_DRAIN_RANGE,
  TOP_SPEED_SCALE_RANGE,
  TURN_RATE_SCALE_RANGE,
  TURN_SPEED_RETENTION_RANGE,
} from '../../config/match/MatchConfig';
import { DEFAULT_VFX_OPTIONS, VFX_DUST_RANGE, VFX_EFFECT_SIZE_RANGE, VFX_GROUND_WAVES_RANGE, VFX_INTENSITY_RANGE, type VfxOptions } from '../../vfx/hybrid/intensityTiers';
import { REAL_OWNED_RULE_KEYS } from '../../bey/real/realMatchRules';
import { CLASH_IMPACT_RANGE, MATCH_RULE_KEYS, RING_OUT_OFF_TIME_LIMIT_S, defaultMatchRules, sanitizeMatchRules, type MatchRules, type MatchSetup } from './matchSetup';

export const ADVANCED_CATEGORIES = ['movement', 'jump', 'combat', 'arena', 'round', 'visual'] as const;
export type AdvancedCategory = (typeof ADVANCED_CATEGORIES)[number];

export const ADVANCED_CATEGORY_LABELS: Readonly<Record<AdvancedCategory, string>> = {
  movement: 'Movement',
  jump: 'Jump',
  combat: 'Combat',
  arena: 'Arena',
  round: 'Round',
  visual: 'Visual',
};

export type MatchRuleKey = (typeof MATCH_RULE_KEYS)[number];
export type VisualKey = `vfx.${keyof VfxOptions}`;
/** Every Advanced value: a MatchRules key, Clash impact, the two wall values or one of the four effects sliders. */
export type AdvancedKey = MatchRuleKey | 'clashImpact' | 'wallHeightM' | 'wallRestitution' | VisualKey;
export type AdvancedValue = number | boolean;

export interface AdvancedRange {
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

export interface SliderControl {
  readonly kind: 'slider';
  readonly id: string;
  readonly key: AdvancedKey;
  readonly category: AdvancedCategory;
  readonly label: string;
  readonly range: AdvancedRange;
  readonly format: (value: number) => string;
  readonly note: string;
  /** Greyed out (and locked) while this holds — e.g. the Circular's sliders with the Circular off. */
  readonly disabledWhen?: (setup: MatchSetup) => boolean;
}

export interface ToggleControl {
  readonly kind: 'toggle';
  readonly id: string;
  readonly key: MatchRuleKey;
  readonly category: AdvancedCategory;
  readonly label: string;
  readonly note: string;
}

export type AdvancedControl = SliderControl | ToggleControl;

const pct = (v: number): string => `${Math.round(v * 100)}%`;
const times = (v: number): string => `×${v.toFixed(2)}`;
const sec = (v: number): string => `${v.toFixed(2)} s`;
const meters = (v: number): string => `${v.toFixed(2)} m`;
const noCircular = (setup: MatchSetup): boolean => !setup.rules.circularAttack;

const CLASSIC_CONTROLS: readonly AdvancedControl[] = [
  // ---- movement ----
  { kind: 'slider', category: 'movement', id: 'acceleration', label: 'Acceleration', range: ACCELERATION_SCALE_RANGE, key: 'accelerationScale', format: times, note: 'How fast every Bey gets up to speed. Provisional.' },
  { kind: 'slider', category: 'movement', id: 'top-speed', label: 'Top speed', range: TOP_SPEED_SCALE_RANGE, key: 'topSpeedScale', format: times, note: 'Every Bey\'s top speed before momentum. Provisional.' },
  { kind: 'slider', category: 'movement', id: 'turn-rate', label: 'Turn rate', range: TURN_RATE_SCALE_RANGE, key: 'turnRateScale', format: times, note: 'How fast every Bey turns. Provisional.' },
  { kind: 'slider', category: 'movement', id: 'turn-speed-retention', label: 'Speed kept in turns', range: TURN_SPEED_RETENTION_RANGE, key: 'turnSpeedRetention', format: pct, note: 'How much of the speed a turn would scrub off is kept. 0% = the old turns. Provisional.' },
  { kind: 'slider', category: 'movement', id: 'high-speed-control', label: 'Control at speed', range: TURN_SPEED_RETENTION_RANGE, key: 'highSpeedControl', format: pct, note: 'How much steering control the Bey keeps as it gets faster. 100% = as much as when slow (no slide at speed). 0% = the old slip. Provisional.' },
  { kind: 'slider', category: 'movement', id: 'gravity', label: 'Gravity', range: GRAVITY_SCALE_RANGE, key: 'gravityScale', format: (v) => `×${v.toFixed(1)}`, note: 'How fast Beys fall. Jump heights stay the same; they just take less time. ×1 = 10.5 m/s² (reads as slow motion at this scale). Provisional.' },
  { kind: 'slider', category: 'movement', id: 'funnel-pull', label: 'Funnel pull', range: FUNNEL_PULL_RANGE, key: 'funnelPull', format: times, note: 'How hard the floor\'s slope pulls every Bey toward the centre (gravity along the slope). It adds speed and direction to everything — a Bey let go slides down and through the funnel, and can only rest on the flat bottom. ×1 = gravity as it is, 0 = none. Provisional.' },
  { kind: 'slider', category: 'movement', id: 'air-control', label: 'Air control', range: AIR_CONTROL_RANGE, key: 'airControl', format: times, note: 'How much a Bey can steer while in the air. ×1 = as designed, 0 = none. Provisional.' },
  { kind: 'slider', category: 'movement', id: 'spin-stamina-drain', label: 'Spin stamina drain', range: SPIN_STAMINA_DRAIN_RANGE, key: 'spinStaminaDrain', format: (v) => `×${v.toFixed(1)}`, note: 'The Stamina every Bey loses just by spinning. ×1 = 0.4/s (Stamina 0 = spin-out, which at ×1 takes minutes). Raise it for spin-outs. Provisional.' },
  { kind: 'slider', category: 'movement', id: 'movement-stamina-drain', label: 'Movement stamina drain', range: MOVEMENT_STAMINA_DRAIN_RANGE, key: 'movementStaminaDrain', format: pct, note: 'Stamina spent by moving fast (the spin itself always drains a little). 100% = 30% less than before. Stamina 0 loses the round (spin-out).' },
  { kind: 'slider', category: 'movement', id: 'momentum-gain', label: 'Momentum gain', range: MOMENTUM_GAIN_RANGE, key: 'momentumGain', format: (v) => `+${Math.round(v * 100)}%`, note: 'How much full momentum raises the top speed. Provisional.' },
  { kind: 'slider', category: 'movement', id: 'momentum-fill', label: 'Momentum build-up', range: MOMENTUM_FILL_RANGE, key: 'momentumFillS', format: (v) => `${v.toFixed(1)} s`, note: 'Seconds of fast, steady movement to fill momentum.' },
  { kind: 'slider', category: 'movement', id: 'momentum-decay', label: 'Momentum decay', range: MOMENTUM_DECAY_RANGE, key: 'momentumDecayS', format: sec, note: 'Seconds for full momentum to drain when you brake, turn hard or stop.' },
  // ---- jump ----
  { kind: 'slider', category: 'jump', id: 'jump-full-height', label: 'Full jump height', range: JUMP_FULL_HEIGHT_RANGE, key: 'jumpFullHeightM', format: meters, note: 'How high a held X jump goes. The wall is 2 m: a full jump near the rim can clear it. Provisional.' },
  { kind: 'slider', category: 'jump', id: 'jump-short-hop-height', label: 'Short hop height', range: JUMP_SHORT_HOP_HEIGHT_RANGE, key: 'jumpShortHopHeightM', format: meters, note: 'How high a quick X tap hops.' },
  { kind: 'slider', category: 'jump', id: 'jump-hold-for-full', label: 'Hold X for full jump', range: JUMP_HOLD_FOR_FULL_RANGE, key: 'jumpHoldForFullS', format: (v) => `${v.toFixed(2)} s`, note: 'The only rule for the height: released before this = the short hop, still held = the full jump (it leaves the floor then). Steering never changes it.' },
  { kind: 'slider', category: 'jump', id: 'jump-stamina-cost', label: 'Jump stamina cost', range: JUMP_STAMINA_COST_RANGE, key: 'jumpStaminaCost', format: (v) => (v === 0 ? 'free' : `${v.toFixed(0)}`), note: 'Stamina each hop or jump costs; a Bey without that much can\'t jump. Provisional.' },
  { kind: 'slider', category: 'jump', id: 'jump-cooldown', label: 'Jump cooldown', range: JUMP_COOLDOWN_RANGE, key: 'jumpCooldownS', format: (v) => (v === 0 ? 'none' : `${v.toFixed(1)} s`), note: 'Time after a jump before the next; a press meanwhile is kept. Provisional.' },
  // ---- combat ----
  { kind: 'toggle', category: 'combat', id: 'circular-attack', label: 'Circular attack (Ataque giratório)', key: 'circularAttack', note: 'Off: no Circular in the match — a Z tap does nothing, hold Z for the Dash as always. The AI never uses it either (no counter). The Clash stays.' },
  { kind: 'slider', category: 'combat', id: 'dash-cooldown', label: 'Dash cooldown', range: DASH_COOLDOWN_RANGE, key: 'dashCooldownS', format: sec, note: 'Time after a Dash before the next can charge, for you and the AI (the CD line refills; full = ready). Provisional.' },
  { kind: 'slider', category: 'combat', id: 'speed-damage', label: 'Speed → damage', range: SPEED_DAMAGE_GAIN_RANGE, key: 'speedDamageGain', format: (v) => (v === 0 ? 'off' : `${Math.round(v * 100)}%`), note: 'Faster hits hurt more: at a Bey\'s own top speed (a Dash: its own speed) the damage is as designed; full momentum (twice as fast) at 50% deals ×1.5, a hit from a standstill ×0.5. 0 = off. Provisional.' },
  { kind: 'toggle', category: 'combat', id: 'dash-carries-speed', label: 'Dash keeps momentum', key: 'dashCarriesSpeed', note: 'A Dash never runs slower than you were going when you fired it: the speed you built up hits harder. Provisional.' },
  { kind: 'slider', category: 'combat', id: 'dodge-distance', label: 'Dodge distance', range: DODGE_DISTANCE_SCALE_RANGE, key: 'dodgeDistanceScale', format: (v) => `×${v.toFixed(2)}`, note: 'How far a dodge goes (same duration and i-frames, faster). ×1 = 12.6 m/s. Provisional.' },
  { kind: 'slider', category: 'combat', id: 'dodge-stamina-cost', label: 'Dodge stamina cost', range: DODGE_STAMINA_COST_RANGE, key: 'dodgeStaminaCost', format: (v) => (v === 0 ? 'free' : `${v.toFixed(0)}`), note: 'Stamina a dodge costs. A dodge never drains movement Stamina either.' },
  { kind: 'slider', category: 'combat', id: 'dodge-cooldown', label: 'Dodge cooldown', range: DODGE_COOLDOWN_RANGE, key: 'dodgeCooldownS', format: sec, note: 'Time between dodges.' },
  { kind: 'slider', category: 'combat', id: 'recovery-time', label: 'Recovery time', range: AIR_RECOVERY_MIN_DELAY_RANGE, key: 'airRecoveryMinDelayS', format: (v) => `${v.toFixed(2)} s`, note: 'The least time a launched Bey must fly before C (Air Recovery) works. A stronger hit adds to it: +0.01 s per unit of force (at most +0.6 s; a typical hit +0.25 s). C pressed earlier does nothing. Provisional.' },
  { kind: 'slider', category: 'combat', id: 'contact-repel', label: 'Contact repel', range: IMPACT_PUSH_RANGE, key: 'contactRepelMps', format: (v) => `${v.toFixed(1)} m/s`, note: 'Any touch throws both Beys apart at least this fast, whatever their speeds; an attack throws the defender 1.5× this. 0 = off. Provisional.' },
  { kind: 'slider', category: 'combat', id: 'contact-lift', label: 'Contact lift', range: CONTACT_LIFT_RANGE, key: 'contactLiftMps', format: (v) => `${v.toFixed(1)} m/s`, note: 'Upward push a contact gives (with the contact repel / attack recoil). 0 = none. Provisional.' },
  { kind: 'slider', category: 'combat', id: 'knockback', label: 'Knockback', range: KNOCKBACK_SCALE_RANGE, key: 'knockbackScale', format: (v) => `×${v.toFixed(2)}`, note: 'Scales every knockback: hits, collisions, the Circular launch, contact repel and recoil. Provisional.' },
  { kind: 'slider', category: 'combat', id: 'attack-recoil', label: 'Attack recoil', range: IMPACT_PUSH_RANGE, key: 'attackRecoilMps', format: (v) => `${v.toFixed(1)} m/s`, note: 'How hard a landed attack throws the attacker back. 0 = off. Provisional.' },
  { kind: 'slider', category: 'combat', id: 'clash-launch', label: 'Clash knockback', range: CLASH_LAUNCH_RANGE, key: 'clashLaunchMps', format: (v) => `${v.toFixed(0)} m/s`, note: 'How hard the Clash loser is launched (away and up). It can do nothing but the Air Recovery until it recovers or lands; the winner recovers for 0.4 s. 0 = the hit\'s own knockback only. Provisional.' },
  { kind: 'slider', category: 'combat', id: 'circular-lock', label: 'Circular lockout after a hit', range: CIRCULAR_LOCK_RANGE, key: 'circularLockAfterHitS', disabledWhen: noCircular, format: (v) => `${v.toFixed(2)} s`, note: 'The Circular is defensive: it can\'t be started while knocked back, nor for this long after taking damage. Provisional.' },
  { kind: 'slider', category: 'combat', id: 'body-contact-control-loss', label: 'Control loss on body contact', range: BODY_CONTACT_CONTROL_LOSS_RANGE, key: 'bodyContactControlLossScale', format: (v) => `×${v.toFixed(2)}`, note: 'How long a plain Bey-to-Bey touch (no attack) takes away ground control, × the base. 0.8 = 20% shorter (owner). Provisional.' },
  { kind: 'slider', category: 'combat', id: 'circular-launch-force', label: 'Circular launch force', range: CIRCULAR_LAUNCH_FORCE_RANGE, key: 'circularLaunchForce', disabledWhen: noCircular, format: (v) => `×${v.toFixed(1)}`, note: 'How hard an active Circular (tap Z) throws whoever touches it. Provisional.' },
  { kind: 'slider', category: 'combat', id: 'body-collision-damage', label: 'Body collision damage', range: BODY_COLLISION_DAMAGE_RANGE, key: 'bodyCollisionDamage', format: (v) => `×${v.toFixed(1)}`, note: 'Stability damage the slower Bey takes when the Beys collide without attacking. ×1 = a Circular Attack at a 10 m/s difference. Provisional.' },
  { kind: 'slider', category: 'combat', id: 'momentum-loss', label: 'Momentum loss on collision', range: MOMENTUM_LOSS_ON_COLLISION_RANGE, key: 'momentumLossOnCollision', format: pct, note: 'Share of momentum the faster Bey loses in a collision (also on a hit taken or a wall impact). Provisional.' },
  { kind: 'slider', category: 'combat', id: 'clash-impact', label: 'Clash impact', range: CLASH_IMPACT_RANGE, key: 'clashImpact', format: times, note: 'How hard the loser of a Clash is knocked back and how much Stability it loses.' },
  // ---- arena ----
  { kind: 'slider', category: 'arena', id: 'game-speed', label: 'Game speed', range: GAME_SPEED_RANGE, key: 'gameSpeed', format: (v) => `×${v.toFixed(2)}`, note: 'The whole match runs this much faster than real time: movement, attacks, gravity, effects. ×1.2 = 20% faster (owner). Provisional.' },
  { kind: 'slider', category: 'arena', id: 'bey-size', label: 'Bey size', range: BEY_SIZE_SCALE_RANGE, key: 'beySizeScale', format: (v) => `×${v.toFixed(2)}`, note: 'Both Beys\' size in the match: body, model, attack reach and every effect (same weight). ×1 = as designed. The stage size and the effects size (Visual) are their own sliders. Provisional.' },
  { kind: 'slider', category: 'arena', id: 'stage-size', label: 'Stage size', range: ARENA_SIZE_SCALE_RANGE, key: 'arenaSizeScale', format: (v) => `×${v.toFixed(2)} (${Math.round(36 * v)} m radius)`, note: 'How big the stage is. ×1 = 36 m radius. The floor, walls, ring-out line, art and camera all follow it. Provisional.' },
  { kind: 'slider', category: 'arena', id: 'bowl-depth', label: 'Bowl depth (funnel)', range: ARENA_BOWL_DEPTH_RANGE, key: 'arenaBowlDepthM', format: meters, note: 'How deep the bowl is (rim above the centre): the floor\'s collider, art, spawns and effects all follow it. 0 = flat. Owner base rule on the Funnel.' },
  { kind: 'slider', category: 'arena', id: 'wall-height', label: 'Wall height', range: ARENA_WALL_HEIGHT_RANGE, key: 'wallHeightM', format: (v) => `${v.toFixed(1)} m`, note: 'A low wall lets a launched Bey fly out of the arena; a tall one keeps it in. The default is the arena\'s own.' },
  { kind: 'slider', category: 'arena', id: 'wall-bounce', label: 'Wall bounce', range: ARENA_WALL_BOUNCE_RANGE, key: 'wallRestitution', format: (v) => v.toFixed(2), note: 'How hard the wall throws a Bey back into the fight. The default is the arena\'s own.' },
  { kind: 'toggle', category: 'arena', id: 'rails', label: 'Rails', key: 'railsEnabled', note: 'Rail grinding: long rails with two gates inside the wall that carry a jumping Bey out of the arena and back in. The Bey is untouchable on a rail. Off = the match is played as if the stages had no rails. Provisional.' },
  { kind: 'slider', category: 'arena', id: 'rail-speed', label: 'Rail speed', range: RAIL_SPEED_RANGE, key: 'railSpeed', format: (v) => `×${v.toFixed(2)}`, note: 'How fast a Bey travels along a rail (the speed it starts at, the one it builds toward, and how quickly). ×1 = 8 → 32 m/s over about 6 s. Provisional.' },
  // ---- round ----
  { kind: 'slider', category: 'round', id: 'round-time-limit', label: 'Round time limit', range: ROUND_TIME_LIMIT_RANGE, key: 'roundTimeLimitS', format: (v) => (v === 0 ? 'no timer' : `${v.toFixed(0)} s`), note: 'When time runs out with nobody beaten, the round is a draw (provisional). No timer by default.' },
  { kind: 'slider', category: 'round', id: 'ring-out-delay', label: 'Ring-out delay', range: RING_OUT_DELAY_RANGE, key: 'ringOutDelayS', format: sec, note: 'How long a Bey must stay outside the arena before the ring-out counts (back inside resets it). 0 = instant. Provisional.' },
  { kind: 'toggle', category: 'round', id: 'win-ko', label: 'Win by knock-out', key: 'winByKo', note: 'A hit on a Broken Bey ends the round.' },
  { kind: 'toggle', category: 'round', id: 'win-ring-out', label: 'Win by ring-out', key: 'winByRingOut', note: `Leaving the arena ends the round. Off needs a timer: ${RING_OUT_OFF_TIME_LIMIT_S} s is set if there is none.` },
  { kind: 'toggle', category: 'round', id: 'win-spin-out', label: 'Win by spin-out', key: 'winBySpinOut', note: 'Stamina 0 ends the round. At least one win condition stays on. Optional HP: not implemented (needs the owner\'s definition).' },
  // ---- visual ----
  { kind: 'slider', category: 'visual', id: 'vfx-intensity', label: 'Effects intensity', range: VFX_INTENSITY_RANGE, key: 'vfx.intensity', format: pct, note: 'Size and amount of every hit, landing and movement effect. Visual only: changes no outcome and is not in the replay.' },
  { kind: 'slider', category: 'visual', id: 'vfx-effect-size', label: 'Effects size', range: VFX_EFFECT_SIZE_RANGE, key: 'vfx.effectSize', format: times, note: 'How big every effect is drawn — hits, Dash, Circular, dodge, drift, landing, Clash, recovery, condition. Effects already follow the Bey size; this multiplies on top. Visual only: changes no outcome and is not in the replay.' },
  { kind: 'slider', category: 'visual', id: 'vfx-ground-waves', label: 'Ground waves', range: VFX_GROUND_WAVES_RANGE, key: 'vfx.groundWaves', format: pct, note: 'Size of the shockwave rings on the floor. 0 = none.' },
  { kind: 'slider', category: 'visual', id: 'vfx-dust', label: 'Dust', range: VFX_DUST_RANGE, key: 'vfx.dust', format: pct, note: 'How much dust Dashes, dodges and landings raise. 0 = none. Camera options stay out of this screen (camera frozen).' },
];

/**
 * Bey Real (0.59.0): the mode's own block sets these (its sliders reach them through realMatchRules.ts) or the mode does not use
 * them at all (the classic handling model, momentum's top speed, the control-loss window). While the mode is on their classic
 * sliders are locked — one place to change each value, and no slider that does nothing.
 */
const REAL_LOCKED_KEYS: ReadonlySet<AdvancedKey> = new Set<AdvancedKey>([...REAL_OWNED_RULE_KEYS, 'momentumGain', 'momentumFillS', 'momentumDecayS', 'bodyContactControlLossScale', 'wallHeightM', 'wallRestitution']);
const realModeOn = (setup: MatchSetup): boolean => setup.real?.enabled === true;

/** Every Advanced control, grouped by category and in the order the Pregame shows them. */
export const ADVANCED_CONTROLS: readonly AdvancedControl[] = CLASSIC_CONTROLS.map((control) =>
  control.kind === 'slider' && REAL_LOCKED_KEYS.has(control.key) ? { ...control, disabledWhen: (setup: MatchSetup) => realModeOn(setup) || (control.disabledWhen?.(setup) ?? false) } : control,
);

/** True when this control is locked by the Bey Real block (so the Pregame can say why). */
export function isLockedByRealMode(control: AdvancedControl, setup: MatchSetup): boolean {
  return control.kind === 'slider' && REAL_LOCKED_KEYS.has(control.key) && realModeOn(setup);
}

export function isToggle(control: AdvancedControl): control is ToggleControl {
  return control.kind === 'toggle';
}

export function controlsOf(category: AdvancedCategory): readonly AdvancedControl[] {
  return ADVANCED_CONTROLS.filter((c) => c.category === category);
}

/** Every key that carries an Advanced value (the Pregame has a control for each; a test keeps it so). */
export const ADVANCED_KEYS: readonly AdvancedKey[] = ADVANCED_CONTROLS.map((c) => c.key);

export function categoryOf(key: AdvancedKey): AdvancedCategory {
  return ADVANCED_CONTROLS.find((c) => c.key === key)!.category;
}

function isVisualKey(key: AdvancedKey): key is VisualKey {
  return key.startsWith('vfx.');
}

function visualField(key: VisualKey): keyof VfxOptions {
  return key.slice(4) as keyof VfxOptions;
}

/** The current value of one Advanced setting. */
export function readAdvanced(setup: MatchSetup, key: AdvancedKey): AdvancedValue {
  if (key === 'clashImpact') return setup.clashImpactMultiplier;
  if (key === 'wallHeightM') return setup.arena.geometry.wallHeightM;
  if (key === 'wallRestitution') return setup.arena.geometry.wallRestitution;
  if (isVisualKey(key)) return setup.visual[visualField(key)] ?? DEFAULT_VFX_OPTIONS[visualField(key)] ?? 1;
  return setup.rules[key as keyof MatchRules];
}

/**
 * The setup with one Advanced setting changed. `enforce` runs the rules' own consistency check afterwards (at least one win
 * condition stays on; ring-out off needs a timer) — the toggles use it, the sliders do not, as before the overhaul.
 */
export function writeAdvanced(setup: MatchSetup, key: AdvancedKey, value: AdvancedValue, enforce = false): MatchSetup {
  if (key === 'clashImpact') return { ...setup, clashImpactMultiplier: value as number };
  if (key === 'wallHeightM') return { ...setup, arena: { ...setup.arena, geometry: { ...setup.arena.geometry, wallHeightM: value as number } } };
  if (key === 'wallRestitution') return { ...setup, arena: { ...setup.arena, geometry: { ...setup.arena.geometry, wallRestitution: value as number } } };
  if (isVisualKey(key)) return { ...setup, visual: { ...setup.visual, [visualField(key)]: value as number } };
  const rules = { ...setup.rules, [key]: value } as MatchRules;
  return { ...setup, rules: enforce ? sanitizeMatchRules(rules) : rules };
}

/**
 * The Normal Original value of one setting for this setup: the game's canonical default (the same source the match uses —
 * never a second copy), and for the wall height and bounce the default of the arena the player picked.
 */
export function normalOriginalValue(setup: MatchSetup, key: AdvancedKey): AdvancedValue {
  if (key === 'clashImpact') return CLASH_IMPACT_MULTIPLIER_DEFAULT;
  if (key === 'wallHeightM') return arenaPreset(setup.arena.presetId).geometry.wallHeightM;
  if (key === 'wallRestitution') return arenaPreset(setup.arena.presetId).geometry.wallRestitution;
  if (isVisualKey(key)) return DEFAULT_VFX_OPTIONS[visualField(key)] ?? 1;
  return defaultMatchRules()[key as keyof MatchRules];
}

/** Numbers compare after rounding to 6 decimals, so a slider's float noise (0.1 + 0.2) never hides a match. */
function same(a: AdvancedValue, b: AdvancedValue): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.round(a * 1e6) === Math.round(b * 1e6);
  return a === b;
}

export function isModified(setup: MatchSetup, key: AdvancedKey): boolean {
  return !same(readAdvanced(setup, key), normalOriginalValue(setup, key));
}

/** The settings that differ from Normal Original, in the Pregame's order. */
export function modifiedKeys(setup: MatchSetup): AdvancedKey[] {
  return ADVANCED_KEYS.filter((key) => isModified(setup, key));
}

export function modifiedCount(setup: MatchSetup, category?: AdvancedCategory): number {
  return ADVANCED_CONTROLS.filter((c) => (category === undefined || c.category === category) && isModified(setup, c.key)).length;
}

/** One category back to Normal Original; the others stay as they are. */
export function resetCategory(setup: MatchSetup, category: AdvancedCategory): MatchSetup {
  let next = setup;
  for (const control of controlsOf(category)) next = writeAdvanced(next, control.key, normalOriginalValue(setup, control.key));
  return next;
}

/** Two setups have the same Advanced configuration (the comparison the preset matching uses). */
export function sameAdvanced(a: MatchSetup, b: MatchSetup): boolean {
  return ADVANCED_KEYS.every((key) => same(readAdvanced(a, key), readAdvanced(b, key)));
}
