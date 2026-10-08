// ============================================================
// PREGAME PRESETS — the five official Advanced presets (owner, 2026-10-07)
// docs/design-decisions/pregame-overhaul.md §4–§7: Normal Original, Realistic, Epic, Smooth and Strategic, plus the derived
// Custom state. A preset is a COMPLETE configuration of the Advanced controls (advancedControls.ts) — never a label that
// changes two or three values — and changes nothing outside Advanced: not the Bey, the opponent, the AI, the arena look,
// the floor or the A/B/C movement direction.
//
// Normal Original is the game's canonical defaults (matchSetup.ts defaultMatchRules / DEFAULT_VFX_OPTIONS / the arena's own
// walls): no second copy of "normal" numbers lives here, so a later change of a default moves it automatically. The four
// others are the canonical defaults plus the override tables below.
//
// *** THE NUMBERS BELOW ARE PROVISIONAL IMPLEMENTATION TUNING ***
// The owner approved each preset's identity and tuning direction, not these values (pregame-overhaul.md §6). They use only
// existing settings, inside their legal slider ranges and on their steps (tests/unit/pregamePresets.test.ts keeps that so),
// and are meant to be reviewed and tuned in this one place.
// ============================================================

import { DEFAULT_VFX_OPTIONS, type VfxOptions } from '../../vfx/hybrid/intensityTiers';
import { ADVANCED_CONTROLS, ADVANCED_KEYS, readAdvanced, writeAdvanced, normalOriginalValue, sameAdvanced, type AdvancedKey, type AdvancedValue, type MatchRuleKey } from './advancedControls';
import { defaultMatchRules, sanitizeMatchRules, type MatchRules, type MatchSetup } from './matchSetup';

export const OFFICIAL_PRESET_IDS = ['normal', 'realistic', 'epic', 'smooth', 'strategic'] as const;
export type OfficialPresetId = (typeof OFFICIAL_PRESET_IDS)[number];
/** The active preset: one of the five, or `custom` (derived: the Advanced configuration matches none of them). */
export type PresetId = OfficialPresetId | 'custom';

/** What a preset changes from Normal Original. Anything not listed stays at its canonical default. */
export interface PresetOverrides {
  readonly rules?: Partial<MatchRules>;
  readonly visual?: Partial<VfxOptions>;
  readonly clashImpact?: number;
}

export interface OfficialPreset {
  readonly id: OfficialPresetId;
  readonly label: string;
  /** The approved brief description, shown in the Pregame. */
  readonly description: string;
  /** False only for Normal Original (the canonical defaults). The other four are provisional tuning. */
  readonly provisional: boolean;
  readonly overrides: PresetOverrides;
}

/** In the display order the Pregame uses. */
export const OFFICIAL_PRESETS: readonly OfficialPreset[] = [
  {
    id: 'normal',
    label: 'Normal Original',
    description: "The original ChaosBey experience using the game's current recommended/default Advanced settings.",
    provisional: false,
    overrides: {},
  },
  {
    // Owner, 2026-10-08: "realismo = fisicamente EXATAMENTE igual a beyblade ... não é pra ser lento, é pra ser rápido mas
    // fisicamente realista, no combate, no knockback, em tudo", with the funnel acting on speed and direction. So: FAST
    // (acceleration and top speed above Normal, not below), a strong funnel pull (the slope drives everything), momentum that
    // builds and lasts (inertia), speed kept through turns but less steering authority at speed (a top slides), little air
    // control, heavier gravity, hard physical collisions (knockback, Clash and body damage up), restrained effects.
    id: 'realistic',
    label: 'Realistic',
    description: 'Heavier, more physical movement with more inertia and less exaggerated behavior.',
    provisional: true,
    overrides: {
      rules: {
        funnelPull: 2.2,
        accelerationScale: 2.2,
        topSpeedScale: 3,
        turnSpeedRetention: 0.95,
        highSpeedControl: 0.6,
        airControl: 0.8,
        gravityScale: 4.2,
        momentumGain: 2.2,
        momentumFillS: 5,
        momentumDecayS: 3.5,
        jumpFullHeightM: 2.5,
        jumpShortHopHeightM: 0.35,
        knockbackScale: 1.3,
        contactLiftMps: 3,
        clashLaunchMps: 32,
        bodyContactControlLossScale: 1.1,
        bodyCollisionDamage: 1.3,
      },
      visual: { intensity: 0.8, effectSize: 0.9, groundWaves: 0.7, dust: 0.8 },
    },
  },
  {
    // Faster, harder-hitting, more spectacular: higher speed and acceleration, a bigger momentum payoff, more intense Dash /
    // knockback / lift / Clash, bigger jumps, permissive cooldowns, stronger effects.
    id: 'epic',
    label: 'Epic',
    description: 'Faster, harder-hitting and more spectacular battles with frequent explosive moments.',
    provisional: true,
    overrides: {
      rules: {
        accelerationScale: 2.4,
        topSpeedScale: 3,
        turnRateScale: 2,
        momentumGain: 2.4,
        momentumFillS: 3,
        gravityScale: 3.2,
        jumpFullHeightM: 4.25,
        jumpShortHopHeightM: 0.8,
        dashCooldownS: 1,
        dodgeCooldownS: 1,
        speedDamageGain: 0.9,
        airRecoveryMinDelayS: 0.1,
        contactRepelMps: 18,
        contactLiftMps: 8,
        knockbackScale: 1.5,
        attackRecoilMps: 18,
        clashLaunchMps: 40,
        circularLaunchForce: 1.6,
        gameSpeed: 1.3,
      },
      visual: { intensity: 1.3, effectSize: 1.3, groundWaves: 1.3, dust: 1.2 },
      clashImpact: 1.5,
    },
  },
  {
    // Easier, fluid, predictable: responsive acceleration, speed kept through turns, full control at speed, forgiving air
    // control, less loss of control from contact, moderate knockback, quick recovery and mobility.
    id: 'smooth',
    label: 'Smooth',
    description: 'Easier, more fluid and predictable control with fewer harsh interruptions.',
    provisional: true,
    overrides: {
      rules: {
        accelerationScale: 2.2,
        turnRateScale: 2.1,
        turnSpeedRetention: 1,
        highSpeedControl: 1,
        airControl: 2.2,
        momentumDecayS: 3.5,
        momentumLossOnCollision: 0.05,
        dodgeCooldownS: 1,
        airRecoveryMinDelayS: 0.1,
        contactRepelMps: 12,
        contactLiftMps: 2,
        knockbackScale: 0.8,
        clashLaunchMps: 20,
        circularLockAfterHitS: 0.3,
        bodyContactControlLossScale: 0.3,
      },
    },
  },
  {
    // Deliberate: less top speed than Epic; momentum takes commitment to build and is worth keeping; stamina and cooldowns
    // matter; Dodge / Jump / Dash cost commitment; contact and ring-out pressure stay; less control permissiveness than Smooth.
    id: 'strategic',
    label: 'Strategic',
    description: 'More deliberate battles where positioning, momentum, stamina, cooldowns and timing matter more.',
    provisional: true,
    overrides: {
      rules: {
        accelerationScale: 1.5,
        topSpeedScale: 2.2,
        turnSpeedRetention: 0.6,
        highSpeedControl: 0.5,
        airControl: 0.8,
        spinStaminaDrain: 2,
        movementStaminaDrain: 0.6,
        momentumGain: 2,
        momentumFillS: 6,
        momentumDecayS: 4,
        jumpStaminaCost: 4,
        jumpCooldownS: 1.2,
        dashCooldownS: 3,
        speedDamageGain: 0.7,
        dodgeDistanceScale: 0.8,
        dodgeStaminaCost: 6,
        dodgeCooldownS: 2.5,
        airRecoveryMinDelayS: 0.5,
        circularLockAfterHitS: 1,
        bodyContactControlLossScale: 1,
        ringOutDelayS: 1,
        gameSpeed: 1,
      },
    },
  },
];

export function officialPreset(id: OfficialPresetId): OfficialPreset {
  return OFFICIAL_PRESETS.find((p) => p.id === id)!;
}

export function presetLabel(id: PresetId): string {
  return id === 'custom' ? 'Custom' : officialPreset(id).label;
}

/** The complete Advanced configuration of an official preset for this setup's arena (the walls follow the arena the player picked). */
export function presetValues(id: OfficialPresetId, setup: MatchSetup): Readonly<Record<AdvancedKey, AdvancedValue>> {
  const overrides = officialPreset(id).overrides;
  const rules = sanitizeMatchRules({ ...defaultMatchRules(), ...overrides.rules });
  const values = {} as Record<AdvancedKey, AdvancedValue>;
  for (const key of ADVANCED_KEYS) {
    if (key === 'clashImpact') values[key] = overrides.clashImpact ?? normalOriginalValue(setup, key);
    else if (key.startsWith('vfx.')) values[key] = overrides.visual?.[key.slice(4) as keyof VfxOptions] ?? DEFAULT_VFX_OPTIONS[key.slice(4) as keyof VfxOptions] ?? 1;
    else if (key === 'wallHeightM' || key === 'wallRestitution') values[key] = normalOriginalValue(setup, key);
    else values[key] = rules[key as MatchRuleKey];
  }
  return values;
}

/**
 * The setup with an official preset applied in one action: every Advanced value takes the preset's. Nothing else changes —
 * Player and Opponent Bey, AI level and style, the arena look and floor, the A/B/C movement direction, the match length and
 * the seed all stay.
 */
export function applyPreset(setup: MatchSetup, id: OfficialPresetId): MatchSetup {
  const values = presetValues(id, setup);
  let next = setup;
  for (const key of ADVANCED_KEYS) next = writeAdvanced(next, key, values[key]);
  return next;
}

/** The preset the current Advanced configuration is: an exact match with an official one (in display order), else Custom. */
export function detectPreset(setup: MatchSetup): PresetId {
  for (const preset of OFFICIAL_PRESETS) {
    if (sameAdvanced(setup, applyPreset(setup, preset.id))) return preset.id;
  }
  return 'custom';
}

/** Every Advanced value of a setup (for tests and the summary). */
export function advancedSnapshot(setup: MatchSetup): Readonly<Record<AdvancedKey, AdvancedValue>> {
  const values = {} as Record<AdvancedKey, AdvancedValue>;
  for (const control of ADVANCED_CONTROLS) values[control.key] = readAdvanced(setup, control.key);
  return values;
}
