// ============================================================
// PREGAME SIMULATOR (M10, GDD 56/59)
// The match setup between Character Select and the fight. Common choices
// first (opponent Bey, AI level, AI style, arena, match length); the
// selected sliders and experimental rules behind "Advanced rules" (wall
// height, wall bounce, Clash impact, fixed seed). The right
// column explains, from the real numbers, what the chosen opponent can do
// and how the matchup looks. Keyboard: ↑/↓ row, ←/→ change, Enter start,
// Esc back.
// ============================================================

import { RING_OUT_DELAY_RANGE } from '../../arena/ringout/RingOutTuning';
import { DASH_COOLDOWN_RANGE } from '../../combat/attacks/AttackTuning';
import {
  BODY_COLLISION_DAMAGE_RANGE,
  MOMENTUM_DECAY_RANGE,
  MOMENTUM_FILL_RANGE,
  MOMENTUM_GAIN_RANGE,
  MOMENTUM_LOSS_ON_COLLISION_RANGE,
} from '../../bey/momentum/MomentumTuning';
import { JUMP_FULL_HEIGHT_RANGE, JUMP_SHORT_HOP_HEIGHT_RANGE } from '../../drift/DriftTuning';
import { MOVEMENT_STAMINA_DRAIN_RANGE } from '../../bey/stamina/StaminaTuning';
import { DODGE_COOLDOWN_RANGE } from '../../dodge/DodgeTuning';
import { CIRCULAR_LAUNCH_FORCE_RANGE } from '../../combat/attacks/AttackTuning';
import { SPEED_DAMAGE_GAIN_RANGE } from '../../combat/attacks/SpeedDamage';
import { JUMP_HOLD_FOR_FULL_RANGE } from '../../drift/DriftTuning';
import { AI_DIFFICULTY_TIERS, aiDifficultyTier, type AiDifficultyTierId } from '../../ai/difficulty/AiDifficultyTiers';
import { isEditableEventTarget } from '../../input/devices/EditableTarget';
import { AI_PERSONALITY_CHOICES, resolveAiPersonality, type AiPersonalityChoice } from '../session/SideControllers';
import type { Bey } from '../../bey/core/Bey';
import { AI_STYLE_LABELS, aiCapabilities, aiStyleLines } from './aiExplanation';
import { BEY_ROSTER, rosterEntry } from './beyRoster';
import { button, el, ensureFrontendStyle, keyHint } from './frontendStyle';
import { navigationIntent, wrapIndex } from './listNavigation';
import { ROUNDS_TO_WIN_CHOICES, describeRoundsToWin, type RoundsToWin } from './matchScore';
import { CLASH_IMPACT_RANGE, changedRuleLines, defaultMatchRules, matchupLines, normalizeSeedText, RING_OUT_OFF_TIME_LIMIT_S, sanitizeMatchRules, withArenaFloor, withArenaPreset, type MatchRules, type MatchSetup } from './matchSetup';
import { ACCELERATION_SCALE_RANGE, AIR_CONTROL_RANGE, ARENA_BOWL_DEPTH_RANGE, JUMP_COOLDOWN_RANGE, JUMP_STAMINA_COST_RANGE, ROUND_TIME_LIMIT_RANGE, TOP_SPEED_SCALE_RANGE, GRAVITY_SCALE_RANGE, IMPACT_PUSH_RANGE, TURN_RATE_SCALE_RANGE, TURN_SPEED_RETENTION_RANGE } from '../../config/match/MatchConfig';
import { DEFAULT_VFX_OPTIONS, VFX_DUST_RANGE, VFX_GROUND_WAVES_RANGE, VFX_INTENSITY_RANGE, type VfxOptions } from '../../vfx/hybrid/intensityTiers';
import { CLASH_IMPACT_MULTIPLIER_DEFAULT } from '../../combat/clash/ClashTuning';
import { ARENA_FLOORS, ARENA_FLOOR_IDS, DEFAULT_ARENA_FLOOR, type ArenaFloorId } from '../../arena/floor/ArenaFloorProfile';
import { DEFAULT_MOTION_DIRECTION, MOTION_DIRECTIONS, MOTION_DIRECTION_IDS, type MotionDirectionId } from '../../bey/motion/MotionPresets';
import { ARENA_PRESETS, ARENA_WALL_BOUNCE_RANGE, ARENA_WALL_HEIGHT_RANGE, arenaPreset, isPresetGeometry, type ArenaPresetId } from '../../arena/presets/ArenaPresets';

export interface PregameOptions {
  readonly setup: MatchSetup;
  readonly onStart: (setup: MatchSetup) => void;
  readonly onBack: (setup: MatchSetup) => void;
}

interface ChoiceOption<T> {
  readonly value: T;
  readonly label: string;
  readonly accentCss?: string;
}

interface ChoiceRow<T> {
  readonly id: string;
  readonly label: string;
  readonly options: readonly ChoiceOption<T>[];
  get(setup: MatchSetup): T;
  set(setup: MatchSetup, value: T): MatchSetup;
}

// Heterogeneous rows share one list; each row only ever sees its own value type.
type AnyChoiceRow = ChoiceRow<never> & ChoiceRow<unknown>;

/** Compact names for the floor row's buttons (full names in the rules panel). */
const ARENA_FLOOR_SHORT_LABELS: Readonly<Record<ArenaFloorId, string>> = {
  flat: 'Flat',
  'bowl-a': 'Bowl A · Dish',
  'bowl-b': 'Bowl B · Funnel',
  'bowl-c': 'Bowl C · Plateau',
};

const ROWS: readonly AnyChoiceRow[] = [
  row<string>({
    id: 'opponent-bey',
    label: 'Opponent Bey',
    options: BEY_ROSTER.map((e) => ({ value: e.definition.id, label: e.label, accentCss: e.accentCss })),
    get: (s) => s.opponentBeyId,
    set: (s, v) => ({ ...s, opponentBeyId: v }),
  }),
  row<AiDifficultyTierId>({
    id: 'ai-level',
    label: 'AI level',
    options: AI_DIFFICULTY_TIERS.map((t) => ({ value: t.id, label: t.label })),
    get: (s) => s.ai.tier,
    set: (s, v) => ({ ...s, ai: { ...s.ai, tier: v } }),
  }),
  row<AiPersonalityChoice>({
    id: 'ai-style',
    label: 'AI style',
    options: AI_PERSONALITY_CHOICES.map((c) => ({ value: c, label: AI_STYLE_LABELS[c] })),
    get: (s) => s.ai.style,
    set: (s, v) => ({ ...s, ai: { ...s.ai, style: v } }),
  }),
  row<ArenaPresetId>({
    id: 'arena',
    label: 'Arena',
    options: ARENA_PRESETS.map((p) => ({ value: p.id, label: p.label, accentCss: `#${p.theme.rimHex.toString(16).padStart(6, '0')}` })),
    get: (s) => s.arena.presetId,
    set: (s, v) => withArenaPreset(s, v),
  }),
  row<ArenaFloorId>({
    id: 'arena-floor',
    label: 'Floor (playtest)',
    options: ARENA_FLOOR_IDS.map((id) => ({ value: id, label: ARENA_FLOOR_SHORT_LABELS[id] })),
    get: (s) => s.arena.geometry.floor ?? DEFAULT_ARENA_FLOOR,
    set: (s, v) => withArenaFloor(s, v),
  }),
  row<MotionDirectionId>({
    id: 'motion',
    label: 'Movement',
    options: MOTION_DIRECTION_IDS.map((id) => ({ value: id, label: MOTION_DIRECTIONS[id].name })),
    get: (s) => s.motion ?? DEFAULT_MOTION_DIRECTION,
    set: (s, v) => ({ ...s, motion: v }),
  }),
  row<RoundsToWin>({
    id: 'rounds',
    label: 'Match length',
    options: ROUNDS_TO_WIN_CHOICES.map((n) => ({ value: n, label: n === 1 ? '1 round' : `First to ${n}` })),
    get: (s) => s.roundsToWin,
    set: (s, v) => ({ ...s, roundsToWin: v }),
  }),
];

function row<T>(definition: ChoiceRow<T>): AnyChoiceRow {
  return definition as unknown as AnyChoiceRow;
}

export class PregameScreen {
  private readonly root = el('div', 'cb-screen cb-screen--opaque cb-pregame', 'pregame');
  private readonly rowButtons: HTMLButtonElement[][] = [];
  private readonly explanation = el('div', 'cb-pregame__explain', 'pregame-explanation');
  private readonly toggles: { readonly input: HTMLInputElement; readonly key: 'winByKo' | 'winByRingOut' | 'winBySpinOut' | 'dashCarriesSpeed' }[] = [];
  private readonly sliders: { readonly input: HTMLInputElement; readonly output: HTMLOutputElement; readonly read: (setup: MatchSetup) => number; readonly format: (value: number) => string }[] = [];
  private readonly seedInput = el('input', 'cb-pregame__seed', 'pregame-seed');
  private setup: MatchSetup;
  private focusRow = 0;
  private closed = false;

  constructor(
    mount: HTMLElement,
    private readonly options: PregameOptions,
  ) {
    ensureFrontendStyle();
    injectPregameStyle();
    this.setup = options.setup;

    const layout = el('div', 'cb-pregame__layout');
    const header = el('header', 'cb-pregame__header');
    const eyebrow = el('p', 'cb-eyebrow');
    eyebrow.textContent = 'Match setup';
    const title = el('h1', 'cb-title');
    title.textContent = 'Pregame simulator';
    const you = rosterEntry(this.setup.playerBeyId);
    const youLine = el('p', 'cb-pregame__you', 'pregame-player');
    youLine.style.setProperty('--bey-accent', you.accentCss);
    youLine.textContent = `You play ${you.label}`;
    header.append(eyebrow, title, youLine);

    const controls = el('section', 'cb-panel cb-pregame__controls');
    controls.setAttribute('aria-label', 'Match setup');
    ROWS.forEach((choiceRow, rowIndex) => controls.append(this.buildRow(choiceRow, rowIndex)));
    controls.append(this.buildAdvanced());

    const explain = el('section', 'cb-panel cb-pregame__explain-panel');
    explain.setAttribute('aria-label', 'What to expect');
    const explainTitle = el('h2', 'cb-pregame__heading');
    explainTitle.textContent = 'What to expect';
    explain.append(explainTitle, this.explanation);

    const footer = el('div', 'cb-footer cb-pregame__footer');
    const hints = el('div', 'cb-footer__hints');
    hints.append(keyHint(['↑', '↓'], 'Row'), keyHint(['←', '→'], 'Change'), keyHint(['Enter'], 'Start'), keyHint(['Esc'], 'Back'));
    footer.append(
      hints,
      button('Back', '', 'pregame-back', () => this.back()),
      button('Start match', 'cb-button--primary', 'pregame-start', () => this.start()),
    );

    layout.append(header, controls, explain, footer);
    this.root.append(layout);
    mount.append(this.root);

    this.refresh();
    this.rowButtons[0]?.find((b) => b.getAttribute('aria-checked') === 'true')?.focus();
    window.addEventListener('keydown', this.handleKey);
  }

  getSetup(): MatchSetup {
    return this.setup;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    window.removeEventListener('keydown', this.handleKey);
    this.root.remove();
  }

  private buildRow(choiceRow: AnyChoiceRow, rowIndex: number): HTMLElement {
    const wrapper = el('div', 'cb-pregame__row');
    const label = el('span', 'cb-field-label');
    label.id = `pregame-label-${choiceRow.id}`;
    label.textContent = choiceRow.label;
    const group = el('div', 'cb-segments', `pregame-${choiceRow.id}`);
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-labelledby', label.id);
    const buttons: HTMLButtonElement[] = [];
    for (const option of choiceRow.options) {
      const node = el('button', 'cb-segment', `pregame-${choiceRow.id}-${String(option.value)}`);
      node.type = 'button';
      node.setAttribute('role', 'radio');
      node.textContent = option.label;
      if (option.accentCss) node.style.setProperty('--bey-accent', option.accentCss);
      node.addEventListener('click', () => {
        this.focusRow = rowIndex;
        this.update(choiceRow.set(this.setup, option.value as never));
      });
      buttons.push(node);
      group.append(node);
    }
    this.rowButtons[rowIndex] = buttons;
    wrapper.append(label, group);
    return wrapper;
  }

  private buildAdvanced(): HTMLElement {
    const details = el('details', 'cb-pregame__advanced', 'pregame-advanced');
    const summary = el('summary');
    summary.textContent = 'Advanced rules';
    details.append(summary);

    // Owner, 2026-10-02 (Lote 9): grouped, every value with its default shown, one Reset to defaults.
    const rule = <K extends keyof MatchRules>(key: K) => ({
      read: (s: MatchSetup) => s.rules[key] as unknown as number,
      write: (s: MatchSetup, v: number) => ({ ...s, rules: { ...s.rules, [key]: v } }),
      defaultValue: defaultMatchRules()[key] as unknown as number,
    });
    const visual = (key: keyof VfxOptions) => ({
      read: (s: MatchSetup) => s.visual[key],
      write: (s: MatchSetup, v: number) => ({ ...s, visual: { ...s.visual, [key]: v } }),
      defaultValue: DEFAULT_VFX_OPTIONS[key],
    });
    const pct = (v: number): string => `${Math.round(v * 100)}%`;
    const times = (v: number): string => `×${v.toFixed(2)}`;
    const sec = (v: number): string => `${v.toFixed(2)} s`;
    const meters = (v: number): string => `${v.toFixed(2)} m`;

    const groups: { title: string; id: string; items: (DocumentFragment | HTMLElement)[] }[] = [
      {
        title: 'Movement',
        id: 'movement',
        items: [
          this.slider({ id: 'acceleration', label: 'Acceleration', range: ACCELERATION_SCALE_RANGE, ...rule('accelerationScale'), format: times, note: 'How fast every Bey gets up to speed. Default ×1.45 (owner, 2026-10-04). Provisional.' }),
          this.slider({ id: 'top-speed', label: 'Top speed', range: TOP_SPEED_SCALE_RANGE, ...rule('topSpeedScale'), format: times, note: 'Every Bey\'s top speed before momentum. Default ×1.45 (owner, 2026-10-04: at least 45% faster). Provisional.' }),
          this.slider({ id: 'turn-rate', label: 'Turn rate', range: TURN_RATE_SCALE_RANGE, ...rule('turnRateScale'), format: times, note: 'How fast every Bey turns. Default ×1.45 (owner, 2026-10-04: faster control). Provisional.' }),
          this.slider({ id: 'turn-speed-retention', label: 'Speed kept in turns', range: TURN_SPEED_RETENTION_RANGE, ...rule('turnSpeedRetention'), format: pct, note: 'How much of the speed a turn would scrub off is kept. 0% = the old turns. Default 85%. Provisional.' }),
          this.slider({ id: 'high-speed-control', label: 'Control at speed', range: TURN_SPEED_RETENTION_RANGE, ...rule('highSpeedControl'), format: pct, note: 'How much steering control the Bey keeps as it gets faster. 100% = as much as when slow (no slide at speed). 0% = the old slip. Provisional.' }),
          this.slider({ id: 'gravity', label: 'Gravity', range: GRAVITY_SCALE_RANGE, ...rule('gravityScale'), format: (v) => `×${v.toFixed(1)}`, note: 'How fast Beys fall. Jump heights stay the same; they just take less time. ×1 = 10.5 m/s² (reads as slow motion at this scale). Default ×2.5. Provisional.' }),
          this.slider({ id: 'air-control', label: 'Air control', range: AIR_CONTROL_RANGE, ...rule('airControl'), format: times, note: 'How much a Bey can steer while in the air. ×1 = as designed, 0 = none. Provisional.' }),
          this.slider({ id: 'movement-stamina-drain', label: 'Movement stamina drain', range: MOVEMENT_STAMINA_DRAIN_RANGE, ...rule('movementStaminaDrain'), format: pct, note: 'Stamina spent by moving fast (the spin itself always drains a little). 100% = 30% less than before. Stamina 0 loses the round (spin-out).' }),
          this.slider({ id: 'momentum-gain', label: 'Momentum gain', range: MOMENTUM_GAIN_RANGE, ...rule('momentumGain'), format: (v) => `+${Math.round(v * 100)}%`, note: 'How much full momentum raises the top speed. Default +150% (2.5× the top speed). Provisional.' }),
          this.slider({ id: 'momentum-fill', label: 'Momentum build-up', range: MOMENTUM_FILL_RANGE, ...rule('momentumFillS'), format: (v) => `${v.toFixed(1)} s`, note: 'Seconds of fast, steady movement to fill momentum.' }),
          this.slider({ id: 'momentum-decay', label: 'Momentum decay', range: MOMENTUM_DECAY_RANGE, ...rule('momentumDecayS'), format: sec, note: 'Seconds for full momentum to drain when you brake, turn hard or stop.' }),
        ],
      },
      {
        title: 'Jump',
        id: 'jump',
        items: [
          this.slider({ id: 'jump-full-height', label: 'Full jump height', range: JUMP_FULL_HEIGHT_RANGE, ...rule('jumpFullHeightM'), format: meters, note: 'How high a held X jump goes. Provisional 2.5 m (the wall is 2 m: a full jump near the rim can clear it).' }),
          this.slider({ id: 'jump-short-hop-height', label: 'Short hop height', range: JUMP_SHORT_HOP_HEIGHT_RANGE, ...rule('jumpShortHopHeightM'), format: meters, note: 'How high a quick X tap hops.' }),
          this.slider({ id: 'jump-hold-for-full', label: 'Hold X for full jump', range: JUMP_HOLD_FOR_FULL_RANGE, ...rule('jumpHoldForFullS'), format: (v) => `${v.toFixed(2)} s`, note: 'The only rule for the height: released before this = the short hop, still held = the full jump (it leaves the floor then). Steering never changes it. Default 0.2 s.' }),
          this.slider({ id: 'jump-stamina-cost', label: 'Jump stamina cost', range: JUMP_STAMINA_COST_RANGE, ...rule('jumpStaminaCost'), format: (v) => (v === 0 ? 'free' : `${v.toFixed(0)}`), note: 'Stamina each hop or jump costs; a Bey without that much can\'t jump. Provisional (free).' }),
          this.slider({ id: 'jump-cooldown', label: 'Jump cooldown', range: JUMP_COOLDOWN_RANGE, ...rule('jumpCooldownS'), format: (v) => (v === 0 ? 'none' : `${v.toFixed(1)} s`), note: 'Time after a jump before the next; a press meanwhile is kept. Provisional (none).' }),
        ],
      },
      {
        title: 'Combat',
        id: 'combat',
        items: [
          this.slider({ id: 'dash-cooldown', label: 'Dash cooldown', range: DASH_COOLDOWN_RANGE, ...rule('dashCooldownS'), format: sec, note: 'Time after a Dash before the next can charge, for you and the AI (the CD line refills; full = ready). Provisional.' }),
          this.slider({ id: 'speed-damage', label: 'Speed → damage', range: SPEED_DAMAGE_GAIN_RANGE, ...rule('speedDamageGain'), format: (v) => (v === 0 ? 'off' : `${Math.round(v * 100)}%`), note: 'Faster hits hurt more: at a Bey\'s own top speed (a Dash: its own speed) the damage is as designed; full momentum (twice as fast) at 50% deals ×1.5, a hit from a standstill ×0.5. 0 = off. Provisional.' }),
          this.toggle({ id: 'dash-carries-speed', label: 'Dash keeps momentum', key: 'dashCarriesSpeed', note: 'A Dash never runs slower than you were going when you fired it: the speed you built up hits harder. Provisional (on).' }),
          this.slider({ id: 'dodge-cooldown', label: 'Dodge cooldown', range: DODGE_COOLDOWN_RANGE, ...rule('dodgeCooldownS'), format: sec, note: 'Time between dodges.' }),
          this.slider({ id: 'contact-repel', label: 'Contact repel', range: IMPACT_PUSH_RANGE, ...rule('contactRepelMps'), format: (v) => `${v.toFixed(1)} m/s`, note: 'Any touch throws both Beys apart at least this fast, whatever their speeds; an attack throws the defender 1.5× this. 0 = off. Provisional.' }),
          this.slider({ id: 'attack-recoil', label: 'Attack recoil', range: IMPACT_PUSH_RANGE, ...rule('attackRecoilMps'), format: (v) => `${v.toFixed(1)} m/s`, note: 'How hard a landed attack throws the attacker back. 0 = off. Provisional.' }),
          this.slider({ id: 'circular-launch-force', label: 'Circular launch force', range: CIRCULAR_LAUNCH_FORCE_RANGE, ...rule('circularLaunchForce'), format: (v) => `×${v.toFixed(1)}`, note: 'How hard an active Circular (tap Z) throws whoever touches it. Provisional.' }),
          this.slider({ id: 'body-collision-damage', label: 'Body collision damage', range: BODY_COLLISION_DAMAGE_RANGE, ...rule('bodyCollisionDamage'), format: (v) => `×${v.toFixed(1)}`, note: 'Stability damage the slower Bey takes when the Beys collide without attacking. ×1 = a Circular Attack at a 10 m/s difference. Provisional.' }),
          this.slider({ id: 'momentum-loss', label: 'Momentum loss on collision', range: MOMENTUM_LOSS_ON_COLLISION_RANGE, ...rule('momentumLossOnCollision'), format: pct, note: 'Share of momentum the faster Bey loses in a collision (also on a hit taken or a wall impact). Provisional.' }),
          this.slider({ id: 'clash-impact', label: 'Clash impact', range: CLASH_IMPACT_RANGE, read: (s) => s.clashImpactMultiplier, write: (s, v) => ({ ...s, clashImpactMultiplier: v }), defaultValue: CLASH_IMPACT_MULTIPLIER_DEFAULT, format: times, note: 'How hard the loser of a Clash is knocked back and how much Stability it loses.' }),
        ],
      },
      {
        title: 'Arena',
        id: 'arena',
        items: [
          this.slider({ id: 'bowl-depth', label: 'Bowl depth (funnel)', range: ARENA_BOWL_DEPTH_RANGE, ...rule('arenaBowlDepthM'), format: meters, note: 'How deep the bowl is (rim above the centre): the floor\'s collider, art, spawns and effects all follow it. 0 = flat. Default 8.5 m on the Funnel (owner base rules, 2026-10-04).' }),
          this.slider({ id: 'wall-height', label: 'Wall height', range: ARENA_WALL_HEIGHT_RANGE, read: (s) => s.arena.geometry.wallHeightM, write: (s, v) => ({ ...s, arena: { ...s.arena, geometry: { ...s.arena.geometry, wallHeightM: v } } }), defaultValue: arenaPreset(this.setup.arena.presetId).geometry.wallHeightM, format: (v) => `${v.toFixed(1)} m`, note: 'A low wall lets a launched Bey fly out of the arena; a tall one keeps it in. Default: the arena\'s.' }),
          this.slider({ id: 'wall-bounce', label: 'Wall bounce', range: ARENA_WALL_BOUNCE_RANGE, read: (s) => s.arena.geometry.wallRestitution, write: (s, v) => ({ ...s, arena: { ...s.arena, geometry: { ...s.arena.geometry, wallRestitution: v } } }), defaultValue: arenaPreset(this.setup.arena.presetId).geometry.wallRestitution, format: (v) => v.toFixed(2), note: 'How hard the wall throws a Bey back into the fight. Default: the arena\'s.' }),
        ],
      },
      {
        title: 'Round rules',
        id: 'round',
        items: [
          this.slider({ id: 'round-time-limit', label: 'Round time limit', range: ROUND_TIME_LIMIT_RANGE, ...rule('roundTimeLimitS'), format: (v) => (v === 0 ? 'no timer' : `${v.toFixed(0)} s`), note: 'When time runs out with nobody beaten, the round is a draw (provisional). No timer by default.' }),
          this.slider({ id: 'ring-out-delay', label: 'Ring-out delay', range: RING_OUT_DELAY_RANGE, ...rule('ringOutDelayS'), format: sec, note: 'How long a Bey must stay outside the arena before the ring-out counts (back inside resets it). 0 = instant. Provisional.' }),
          this.toggle({ id: 'win-ko', label: 'Win by knock-out', key: 'winByKo', note: 'A hit on a Broken Bey ends the round.' }),
          this.toggle({ id: 'win-ring-out', label: 'Win by ring-out', key: 'winByRingOut', note: `Leaving the arena ends the round. Off needs a timer: ${RING_OUT_OFF_TIME_LIMIT_S} s is set if there is none.` }),
          this.toggle({ id: 'win-spin-out', label: 'Win by spin-out', key: 'winBySpinOut', note: 'Stamina 0 ends the round. At least one win condition stays on. Optional HP: not implemented (needs the owner\'s definition).' }),
        ],
      },
      {
        title: 'Visual',
        id: 'visual',
        items: [
          this.slider({ id: 'vfx-intensity', label: 'Effects intensity', range: VFX_INTENSITY_RANGE, ...visual('intensity'), format: pct, note: 'Size and amount of every hit, landing and movement effect. Visual only: changes no outcome and is not in the replay.' }),
          this.slider({ id: 'vfx-ground-waves', label: 'Ground waves', range: VFX_GROUND_WAVES_RANGE, ...visual('groundWaves'), format: pct, note: 'Size of the shockwave rings on the floor. 0 = none.' }),
          this.slider({ id: 'vfx-dust', label: 'Dust', range: VFX_DUST_RANGE, ...visual('dust'), format: pct, note: 'How much dust Dashes, dodges and landings raise. 0 = none. Camera options stay out of this screen (camera frozen).' }),
        ],
      },
    ];
    for (const group of groups) {
      const section = el('section', 'cb-pregame__group', `pregame-group-${group.id}`);
      const heading = el('h4', 'cb-pregame__group-title');
      heading.textContent = group.title;
      section.append(heading, ...group.items);
      details.append(section);
    }

    const reset = button('Reset to defaults', '', 'pregame-reset-defaults', () => this.resetAdvanced());

    const seedRow = el('label', 'cb-pregame__row');
    const seedLabel = el('span', 'cb-field-label');
    seedLabel.textContent = 'Seed';
    this.seedInput.type = 'text';
    this.seedInput.placeholder = 'random each match';
    this.seedInput.maxLength = 64;
    this.seedInput.spellcheck = false;
    this.seedInput.addEventListener('input', () => this.update({ ...this.setup, seedText: normalizeSeedText(this.seedInput.value) }));
    seedRow.append(seedLabel, this.seedInput);
    const seedNote = el('p', 'cb-hint');
    seedNote.textContent = 'Same seed, same inputs, same match. Leave blank for a new one every time.';

    details.append(seedRow, seedNote, reset);
    return details;
  }

  /** Lote 9: every advanced rule, the arena's walls, Clash impact and the visual options back to their defaults (Bey, AI, arena look, floor profile, rounds and seed stay). */
  private resetAdvanced(): void {
    const preset = arenaPreset(this.setup.arena.presetId).geometry;
    this.update({
      ...this.setup,
      rules: defaultMatchRules(),
      visual: DEFAULT_VFX_OPTIONS,
      clashImpactMultiplier: CLASH_IMPACT_MULTIPLIER_DEFAULT,
      arena: { ...this.setup.arena, geometry: { ...this.setup.arena.geometry, wallHeightM: preset.wallHeightM, wallRestitution: preset.wallRestitution } },
    });
  }

  private toggle(spec: { id: string; label: string; key: 'winByKo' | 'winByRingOut' | 'winBySpinOut' | 'dashCarriesSpeed'; note: string }): DocumentFragment {
    const fragment = document.createDocumentFragment();
    const wrapper = el('label', 'cb-pregame__row cb-pregame__row--toggle');
    const input = el('input', 'cb-pregame__toggle', `pregame-${spec.id}`);
    input.type = 'checkbox';
    const label = el('span', 'cb-field-label');
    label.textContent = spec.label;
    const def = el('span', 'cb-pregame__default');
    def.textContent = `default ${defaultMatchRules()[spec.key] ? 'on' : 'off'}`;
    input.addEventListener('change', () => this.update({ ...this.setup, rules: sanitizeMatchRules({ ...this.setup.rules, [spec.key]: input.checked }) }));
    this.toggles.push({ input, key: spec.key });
    wrapper.append(input, label, def);
    const note = el('p', 'cb-hint');
    note.textContent = spec.note;
    fragment.append(wrapper, note);
    return fragment;
  }

  private slider(spec: {
    id: string;
    label: string;
    range: { readonly min: number; readonly max: number; readonly step: number };
    read: (setup: MatchSetup) => number;
    write: (setup: MatchSetup, value: number) => MatchSetup;
    format: (value: number) => string;
    note: string;
    /** Lote 9: shown next to the value ("default …"). */
    defaultValue?: number;
  }): DocumentFragment {
    const fragment = document.createDocumentFragment();
    const wrapper = el('label', 'cb-pregame__row cb-pregame__row--slider');
    const label = el('span', 'cb-field-label');
    label.textContent = spec.label;
    if (spec.defaultValue !== undefined) {
      const def = el('span', 'cb-pregame__default', `pregame-${spec.id}-default`);
      def.textContent = `default ${spec.format(spec.defaultValue)}`;
      label.append(def);
    }
    const input = el('input', 'cb-pregame__slider', `pregame-${spec.id}`);
    input.type = 'range';
    input.min = String(spec.range.min);
    input.max = String(spec.range.max);
    input.step = String(spec.range.step);
    const output = el('output', 'cb-pregame__value', `pregame-${spec.id}-value`);
    input.addEventListener('input', () => this.update(spec.write(this.setup, Number(input.value))));
    this.sliders.push({ input, output, read: spec.read, format: spec.format });
    wrapper.append(label, input, output);
    const note = el('p', 'cb-hint');
    note.textContent = spec.note;
    fragment.append(wrapper, note);
    return fragment;
  }

  private update(next: MatchSetup): void {
    this.setup = next;
    this.refresh();
  }

  private refresh(): void {
    ROWS.forEach((choiceRow, rowIndex) => {
      const current = choiceRow.get(this.setup);
      choiceRow.options.forEach((option, optionIndex) => {
        const node = this.rowButtons[rowIndex]![optionIndex]!;
        const checked = option.value === current;
        node.setAttribute('aria-checked', String(checked));
        node.tabIndex = checked ? 0 : -1;
      });
    });
    for (const slider of this.sliders) {
      const value = slider.read(this.setup);
      slider.input.value = String(value);
      slider.output.textContent = slider.format(value);
    }
    for (const toggle of this.toggles) toggle.input.checked = this.setup.rules[toggle.key];
    if (normalizeSeedText(this.seedInput.value) !== this.setup.seedText) this.seedInput.value = this.setup.seedText ?? '';
    this.renderExplanation();
  }

  private renderExplanation(): void {
    const setup = this.setup;
    const you = rosterEntry(setup.playerBeyId);
    const them = rosterEntry(setup.opponentBeyId);
    const tier = aiDifficultyTier(setup.ai.tier);
    const personality = resolveAiPersonality(setup.ai.style, { definition: them.definition } as Bey);

    const matchup = el('div', 'cb-pregame__block', 'pregame-matchup');
    const matchupTitle = el('h3', 'cb-pregame__subheading');
    matchupTitle.innerHTML = '';
    const youTag = tag(you.label, you.accentCss);
    const themTag = tag(them.label, them.accentCss);
    matchupTitle.append(youTag, ' vs ', themTag);
    const list = el('ul', 'cb-pregame__lines');
    for (const line of matchupLines(setup)) {
      const item = el('li', `is-${line.tone}`);
      item.textContent = line.text;
      list.append(item);
    }
    matchup.append(matchupTitle, list);

    const ai = el('div', 'cb-pregame__block', 'pregame-ai');
    const aiTitle = el('h3', 'cb-pregame__subheading');
    aiTitle.textContent = `${tier.label} · ${AI_STYLE_LABELS[setup.ai.style]}`;
    const aiSummary = el('p', 'cb-pregame__summary');
    aiSummary.textContent = tier.summary;
    const bars = el('div', 'cb-pregame__caps');
    for (const capability of aiCapabilities(personality, tier.profile)) {
      const cap = el('div', 'cb-pregame__cap', `pregame-cap-${capability.key}`);
      const name = el('span', 'cb-pregame__cap-name');
      name.textContent = capability.label;
      const bar = el('div', 'cb-bar');
      const fill = el('div', 'cb-bar__fill');
      fill.style.width = `${Math.round(capability.score * 100)}%`;
      bar.append(fill);
      const readout = el('span', 'cb-pregame__cap-readout');
      readout.textContent = capability.readout;
      cap.append(name, bar, readout);
      bars.append(cap);
    }
    const style = el('ul', 'cb-pregame__lines cb-pregame__style');
    for (const line of aiStyleLines(personality)) {
      const item = el('li');
      item.textContent = line;
      style.append(item);
    }
    ai.append(aiTitle, aiSummary, bars, style);

    const rules = el('div', 'cb-pregame__block', 'pregame-rules');
    const rulesTitle = el('h3', 'cb-pregame__subheading');
    rulesTitle.textContent = 'Rules';
    const rulesList = el('ul', 'cb-pregame__lines');
    const addRule = (text: string): void => {
      const item = el('li');
      item.textContent = text;
      rulesList.append(item);
    };
    const arena = arenaPreset(setup.arena.presetId);
    const walls = setup.arena.geometry;
    addRule(`${arena.label}: ${arena.description}`);
    if (!isPresetGeometry(arena.id, walls)) addRule(`Custom walls: ${walls.wallHeightM.toFixed(1)} m high, bounce ${walls.wallRestitution.toFixed(2)}`);
    const floor = ARENA_FLOORS[walls.floor ?? DEFAULT_ARENA_FLOOR];
    addRule(floor.id === 'flat' ? `Floor: ${floor.label}` : `Floor (playtest): ${floor.label} — ${floor.description} Temporary look; walls measured from the rim.`);
    const motion = MOTION_DIRECTIONS[setup.motion ?? DEFAULT_MOTION_DIRECTION];
    addRule(`Movement ${motion.name}: ${motion.summary}`);
    addRule(describeRoundsToWin(setup.roundsToWin));
    const r = setup.rules;
    const ways = [r.winByKo ? 'a knock-out (a hit while broken)' : null, r.winByRingOut ? 'a ring-out' : null, r.winBySpinOut ? 'a spin-out (Stamina 0)' : null].filter((w): w is string => w !== null);
    addRule(`A round ends on ${ways.join(', ')}${r.roundTimeLimitS > 0 ? `, or a draw after ${r.roundTimeLimitS.toFixed(0)} s` : ''}. A draw scores nobody.`);
    if (r.arenaBowlDepthM !== defaultMatchRules().arenaBowlDepthM && walls.floor !== 'flat') addRule(r.arenaBowlDepthM === 0 ? 'Bowl depth 0 m: the floor is flat' : `Bowl depth ${r.arenaBowlDepthM.toFixed(2)} m (default ${defaultMatchRules().arenaBowlDepthM.toFixed(2)} m)`);
    // Item 11 (owner, 2026-10-04): speed decides how hard you hit.
    if (r.speedDamageGain > 0) addRule(`Speed is power: the faster a hit lands, the more damage it deals${r.dashCarriesSpeed ? ', and a Dash keeps the speed you built up' : ''}. Build momentum by moving fast and straight.`);
    const changed = changedRuleLines(setup);
    if (changed.length > 0) addRule(`Changed from the defaults: ${changed.join('; ')}.`);
    addRule(setup.clashImpactMultiplier === 1 ? 'Standard Clash impact' : `Clash impact ×${setup.clashImpactMultiplier.toFixed(2)}`);
    addRule(setup.seedText === null ? 'New random seed every match' : `Fixed seed "${setup.seedText}"`);
    rules.append(rulesTitle, rulesList);

    this.explanation.replaceChildren(matchup, ai, rules);
  }

  private start(): void {
    if (!this.closed) this.options.onStart(this.setup);
  }

  private back(): void {
    if (!this.closed) this.options.onBack(this.setup);
  }

  private changeFocusedRow(delta: number): void {
    const choiceRow = ROWS[this.focusRow]!;
    const index = choiceRow.options.findIndex((o) => o.value === choiceRow.get(this.setup));
    const next = choiceRow.options[wrapIndex(index, delta, choiceRow.options.length)]!;
    this.update(choiceRow.set(this.setup, next.value as never));
    this.focusCheckedIn(this.focusRow);
  }

  private focusCheckedIn(rowIndex: number): void {
    this.rowButtons[rowIndex]?.find((b) => b.getAttribute('aria-checked') === 'true')?.focus();
  }

  private readonly handleKey = (event: KeyboardEvent): void => {
    const intent = navigationIntent(event.code);
    if (!intent) return;
    // Typing a seed: keys belong to the field; Esc and Enter leave it.
    if (isEditableEventTarget(event.target)) {
      if (intent !== 'back' && event.code !== 'Enter') return;
      if (intent === 'back') {
        event.preventDefault();
        (event.target as HTMLElement).blur();
        return;
      }
    }
    // The sliders and the Advanced toggle keep their own keys.
    if ((this.sliders.some((sl) => sl.input === event.target) && (intent === 'decrease' || intent === 'increase')) || (event.target instanceof HTMLElement && event.target.tagName === 'SUMMARY' && intent === 'confirm')) return;
    // Enter/Space on Back or Start activates that button (Z still means "start").
    if (intent === 'confirm' && event.code !== 'KeyZ' && event.target instanceof HTMLButtonElement && !event.target.classList.contains('cb-segment')) return;
    event.preventDefault();
    switch (intent) {
      case 'previous':
        this.focusRow = wrapIndex(this.focusRow, -1, ROWS.length);
        this.focusCheckedIn(this.focusRow);
        break;
      case 'next':
        this.focusRow = wrapIndex(this.focusRow, 1, ROWS.length);
        this.focusCheckedIn(this.focusRow);
        break;
      case 'decrease':
        this.changeFocusedRow(-1);
        break;
      case 'increase':
        this.changeFocusedRow(1);
        break;
      case 'confirm':
        this.start();
        break;
      case 'back':
        this.back();
        break;
    }
  };
}

function tag(label: string, accentCss: string): HTMLElement {
  const node = el('span', 'cb-pregame__tag');
  node.style.setProperty('--bey-accent', accentCss);
  node.textContent = label;
  return node;
}

let pregameStyleInjected = false;
function injectPregameStyle(): void {
  if (pregameStyleInjected) return;
  pregameStyleInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .cb-pregame__layout { box-sizing: border-box; max-width: 1180px; margin: 0 auto; padding: 28px 24px; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); grid-template-areas: "header header" "controls explain" "footer footer"; gap: 18px; }
    .cb-pregame__header { grid-area: header; }
    .cb-pregame__you { margin: 6px 0 0; color: var(--cb-text-dim); }
    .cb-pregame__you::before { content: ''; display: inline-block; width: 10px; height: 10px; margin-right: 8px; border-radius: 50%; background: var(--bey-accent); box-shadow: 0 0 8px var(--bey-accent); }
    .cb-pregame__controls { grid-area: controls; display: flex; flex-direction: column; gap: 16px; align-self: start; }
    .cb-pregame__explain-panel { grid-area: explain; align-self: start; }
    .cb-pregame__footer { grid-area: footer; position: sticky; bottom: 0; padding: 12px 0 4px; background: linear-gradient(transparent, var(--cb-bg) 35%); }
    .cb-pregame__row { display: flex; flex-direction: column; gap: 6px; }
    .cb-pregame__row--slider { display: grid; grid-template-columns: 1fr 64px; grid-template-areas: "label label" "slider value"; align-items: center; }
    .cb-pregame__row--slider .cb-field-label { grid-area: label; }
    .cb-pregame__slider { grid-area: slider; accent-color: var(--cb-accent); }
    .cb-pregame__value { grid-area: value; font: 600 13px/1 var(--cb-mono); text-align: right; }
    .cb-pregame__advanced { border-top: 1px solid var(--cb-line); padding-top: 12px; display: block; }
    .cb-pregame__advanced summary { cursor: pointer; font-size: 13px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--cb-text-dim); }
    .cb-pregame__advanced[open] summary { margin-bottom: 12px; }
    .cb-pregame__advanced .cb-hint { margin: 2px 0 12px; }
    .cb-pregame__group { border-top: 1px solid var(--cb-line); padding-top: 10px; margin-top: 6px; }
    .cb-pregame__group-title { margin: 0 0 8px; font-size: 12px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--cb-text); }
    .cb-pregame__default { margin-left: 8px; font-size: 11px; color: var(--cb-text-dim); font-weight: 400; letter-spacing: 0; text-transform: none; }
    .cb-pregame__row.cb-pregame__row--toggle { display: flex; flex-direction: row; align-items: center; justify-content: flex-start; gap: 10px; text-align: left; grid-template-columns: none; }
    .cb-pregame__row--toggle .cb-field-label { margin: 0; }
    .cb-pregame__toggle { width: 18px; height: 18px; accent-color: var(--cb-accent, #6be3ff); }
    .cb-pregame__seed { font: 14px/1.2 var(--cb-mono); color: var(--cb-text); background: #0b0e16; border: 1px solid var(--cb-line-strong); border-radius: 4px; padding: 9px 10px; }
    .cb-pregame__heading { margin: 0 0 12px; font-size: 13px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--cb-text-dim); font-weight: 600; }
    .cb-pregame__explain { display: flex; flex-direction: column; gap: 16px; }
    .cb-pregame__block { display: flex; flex-direction: column; gap: 8px; }
    .cb-pregame__subheading { margin: 0; font-size: 16px; letter-spacing: 0.06em; }
    .cb-pregame__tag { color: var(--bey-accent); font-weight: 700; letter-spacing: 0.12em; }
    .cb-pregame__summary { margin: 0; font-size: 14px; }
    .cb-pregame__lines { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 3px; font-size: 13px; }
    .cb-pregame__lines .is-good { color: var(--cb-win); }
    .cb-pregame__lines .is-bad { color: var(--cb-warn); }
    .cb-pregame__style { color: var(--cb-text-dim); }
    .cb-pregame__caps { display: flex; flex-direction: column; gap: 6px; }
    .cb-pregame__cap { display: grid; grid-template-columns: 120px 90px 1fr; gap: 10px; align-items: center; font-size: 13px; }
    .cb-pregame__cap-readout { color: var(--cb-text-dim); font-size: 12px; }
    @media (max-width: 820px) {
      .cb-pregame__layout { grid-template-columns: minmax(0, 1fr); grid-template-areas: "header" "controls" "explain" "footer"; padding: 16px; }
      .cb-pregame__cap { grid-template-columns: 110px 1fr; }
      .cb-pregame__cap-readout { grid-column: 1 / -1; margin-top: -4px; }
      .cb-footer__hints { display: none; }
    }
  `;
  document.head.append(style);
}
