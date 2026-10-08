import { describe, expect, it } from 'vitest';
import {
  ADVANCED_CATEGORIES,
  ADVANCED_CONTROLS,
  ADVANCED_KEYS,
  categoryOf,
  controlsOf,
  isModified,
  isToggle,
  modifiedCount,
  modifiedKeys,
  normalOriginalValue,
  readAdvanced,
  resetCategory,
  writeAdvanced,
} from '../../src/app/frontend/advancedControls';
import {
  OFFICIAL_PRESETS,
  OFFICIAL_PRESET_IDS,
  advancedSnapshot,
  applyPreset,
  detectPreset,
  presetValues,
} from '../../src/app/frontend/pregamePresets';
import {
  MATCH_RULE_KEYS,
  createDefaultMatchSetup,
  defaultMatchRules,
  sanitizeMatchRules,
  withArenaFloor,
  withArenaPreset,
  withDefaultRules,
  type MatchSetup,
} from '../../src/app/frontend/matchSetup';

// Pregame overhaul (docs/design-decisions/pregame-overhaul.md): the Advanced registry and the five official presets.

const base = (): MatchSetup => createDefaultMatchSetup();

describe('Advanced controls registry', () => {
  it('has a control for every MatchRules key, Clash impact, both wall values and the four effects sliders', () => {
    const keys = new Set<string>(ADVANCED_KEYS);
    for (const key of MATCH_RULE_KEYS) expect(keys.has(key), key).toBe(true);
    for (const extra of ['clashImpact', 'wallHeightM', 'wallRestitution', 'vfx.intensity', 'vfx.effectSize', 'vfx.groundWaves', 'vfx.dust']) {
      expect(keys.has(extra), extra).toBe(true);
    }
    expect(ADVANCED_KEYS.length).toBe(new Set(ADVANCED_KEYS).size);
  });

  it('uses unique ids and puts every control in one of the six categories, each with at least one control', () => {
    expect(new Set(ADVANCED_CONTROLS.map((c) => c.id)).size).toBe(ADVANCED_CONTROLS.length);
    expect([...ADVANCED_CATEGORIES]).toEqual(['movement', 'jump', 'combat', 'arena', 'round', 'visual']);
    for (const category of ADVANCED_CATEGORIES) expect(controlsOf(category).length, category).toBeGreaterThan(0);
    for (const control of ADVANCED_CONTROLS) expect(categoryOf(control.key)).toBe(control.category);
  });

  it('has the canonical default of every control inside its own range and on its step', () => {
    const setup = base();
    for (const control of ADVANCED_CONTROLS) {
      const value = normalOriginalValue(setup, control.key);
      if (isToggle(control)) {
        expect(typeof value, control.id).toBe('boolean');
        continue;
      }
      const { min, max, step } = control.range;
      expect(value as number, control.id).toBeGreaterThanOrEqual(min - 1e-9);
      expect(value as number, control.id).toBeLessThanOrEqual(max + 1e-9);
      const steps = ((value as number) - min) / step;
      expect(Math.abs(steps - Math.round(steps)), `${control.id} on step`).toBeLessThan(1e-6);
    }
  });
});

describe('Official presets', () => {
  it('are the five approved ones, in the approved order, each with its brief description', () => {
    expect([...OFFICIAL_PRESET_IDS]).toEqual(['normal', 'realistic', 'epic', 'smooth', 'strategic']);
    expect(OFFICIAL_PRESETS.map((p) => p.label)).toEqual(['Normal Original', 'Realistic', 'Epic', 'Smooth', 'Strategic']);
    for (const preset of OFFICIAL_PRESETS) expect(preset.description.length, preset.id).toBeGreaterThan(20);
    expect(OFFICIAL_PRESETS[0]!.provisional).toBe(false);
    for (const preset of OFFICIAL_PRESETS.slice(1)) expect(preset.provisional, preset.id).toBe(true);
  });

  it('make Normal Original exactly the canonical defaults (no second copy of the numbers)', () => {
    const setup = base();
    const values = presetValues('normal', setup);
    const rules = defaultMatchRules();
    for (const key of MATCH_RULE_KEYS) expect(values[key], key).toEqual(rules[key]);
    for (const key of ADVANCED_KEYS) expect(values[key], key).toEqual(normalOriginalValue(setup, key));
    expect(modifiedCount(applyPreset(setup, 'normal'))).toBe(0);
    expect(withDefaultRules(setup)).toEqual(applyPreset(setup, 'normal'));
  });

  it('resolve a complete Advanced configuration, inside every legal range, on every step', () => {
    const setup = base();
    for (const preset of OFFICIAL_PRESETS) {
      const values = presetValues(preset.id, setup);
      for (const control of ADVANCED_CONTROLS) {
        const value = values[control.key];
        if (isToggle(control)) {
          expect(typeof value, `${preset.id}/${control.id}`).toBe('boolean');
          continue;
        }
        const { min, max, step } = control.range;
        expect(value as number, `${preset.id}/${control.id} >= min`).toBeGreaterThanOrEqual(min - 1e-9);
        expect(value as number, `${preset.id}/${control.id} <= max`).toBeLessThanOrEqual(max + 1e-9);
        const steps = ((value as number) - min) / step;
        expect(Math.abs(steps - Math.round(steps)), `${preset.id}/${control.id} on step`).toBeLessThan(1e-6);
      }
    }
  });

  it('survive the rules\' own sanitising untouched (a preset is never altered by the match)', () => {
    const setup = base();
    for (const preset of OFFICIAL_PRESETS) {
      const applied = applyPreset(setup, preset.id);
      expect(sanitizeMatchRules(applied.rules)).toEqual(applied.rules);
    }
  });

  it('are pairwise different and each one differs from Normal Original (except Normal itself)', () => {
    const setup = base();
    const snapshots = OFFICIAL_PRESETS.map((p) => JSON.stringify(advancedSnapshot(applyPreset(setup, p.id))));
    expect(new Set(snapshots).size).toBe(OFFICIAL_PRESETS.length);
    for (const preset of OFFICIAL_PRESETS.slice(1)) expect(modifiedCount(applyPreset(setup, preset.id)), preset.id).toBeGreaterThan(5);
  });

  it('follow their tuning direction against Normal Original', () => {
    const setup = base();
    const n = presetValues('normal', setup);
    const real = presetValues('realistic', setup);
    const epic = presetValues('epic', setup);
    const smooth = presetValues('smooth', setup);
    const strat = presetValues('strategic', setup);
    // Realistic (owner, 2026-10-08): FAST but physical — never slower than Normal; a strong funnel pull; less control at speed
    // and in the air; heavier; harder physical collisions; restrained effects.
    expect(real.topSpeedScale).toBeGreaterThanOrEqual(n.topSpeedScale as number);
    expect(real.accelerationScale).toBeGreaterThanOrEqual(n.accelerationScale as number);
    expect(real.gameSpeed).toBeGreaterThanOrEqual(n.gameSpeed as number);
    expect(real.funnelPull).toBeGreaterThan(n.funnelPull as number);
    expect(real.highSpeedControl).toBeLessThan(n.highSpeedControl as number);
    expect(real.airControl).toBeLessThan(n.airControl as number);
    expect(real.gravityScale).toBeGreaterThan(n.gravityScale as number);
    expect(real.knockbackScale).toBeGreaterThan(n.knockbackScale as number);
    expect(real.clashLaunchMps).toBeGreaterThanOrEqual(n.clashLaunchMps as number);
    expect(real['vfx.intensity']).toBeLessThan(n['vfx.intensity'] as number);
    // Epic: faster, harder-hitting, bigger jumps, stronger effects.
    expect(epic.topSpeedScale).toBeGreaterThan(n.topSpeedScale as number);
    expect(epic.accelerationScale).toBeGreaterThan(n.accelerationScale as number);
    expect(epic.knockbackScale).toBeGreaterThan(n.knockbackScale as number);
    expect(epic.clashLaunchMps).toBeGreaterThan(n.clashLaunchMps as number);
    expect(epic.jumpFullHeightM).toBeGreaterThan(n.jumpFullHeightM as number);
    expect(epic['vfx.intensity']).toBeGreaterThan(n['vfx.intensity'] as number);
    // Smooth: responsive, keeps speed, full control, forgiving air, less control loss on contact.
    expect(smooth.accelerationScale).toBeGreaterThan(n.accelerationScale as number);
    expect(smooth.turnSpeedRetention).toBeGreaterThanOrEqual(n.turnSpeedRetention as number);
    expect(smooth.airControl).toBeGreaterThan(n.airControl as number);
    expect(smooth.bodyContactControlLossScale).toBeLessThan(n.bodyContactControlLossScale as number);
    // Strategic: slower than Epic, momentum and stamina matter, costs and cooldowns, less permissive than Smooth.
    expect(strat.topSpeedScale).toBeLessThan(epic.topSpeedScale as number);
    expect(strat.momentumFillS).toBeGreaterThan(n.momentumFillS as number);
    expect(strat.spinStaminaDrain).toBeGreaterThan(n.spinStaminaDrain as number);
    expect(strat.dashCooldownS).toBeGreaterThan(n.dashCooldownS as number);
    expect(strat.dodgeStaminaCost).toBeGreaterThan(n.dodgeStaminaCost as number);
    expect(strat.jumpStaminaCost).toBeGreaterThan(n.jumpStaminaCost as number);
    expect(strat.highSpeedControl).toBeLessThan(smooth.highSpeedControl as number);
  });

  it('only change the Advanced configuration — never the Beys, the AI, the arena look, the floor, the movement direction, the rounds or the seed', () => {
    let setup = withArenaFloor(withArenaPreset(base(), 'rift'), 'bowl-a');
    setup = { ...setup, opponentBeyId: 'defense-prototype', roundsToWin: 3, motion: 'C', seedText: 'keep-me' } as MatchSetup;
    for (const preset of OFFICIAL_PRESETS) {
      const applied = applyPreset(setup, preset.id);
      expect(applied.playerBeyId, preset.id).toBe(setup.playerBeyId);
      expect(applied.opponentBeyId).toBe('defense-prototype');
      expect(applied.ai).toEqual(setup.ai);
      expect(applied.roundsToWin).toBe(3);
      expect(applied.motion).toBe('C');
      expect(applied.seedText).toBe('keep-me');
      expect(applied.arena.presetId).toBe('rift');
      expect(applied.arena.geometry.floor).toBe('bowl-a');
    }
  });

  it('keep the walls on the arena the player picked (the preset never forces a wall height)', () => {
    for (const presetId of ['foundry', 'rift', 'tournament'] as const) {
      const setup = withArenaPreset(base(), presetId);
      for (const preset of OFFICIAL_PRESETS) {
        const applied = applyPreset(setup, preset.id);
        expect(readAdvanced(applied, 'wallHeightM')).toBe(normalOriginalValue(setup, 'wallHeightM'));
        expect(readAdvanced(applied, 'wallRestitution')).toBe(normalOriginalValue(setup, 'wallRestitution'));
      }
    }
  });
});

describe('Preset detection, MODIFIED and resets', () => {
  it('recognises each official preset after applying it, and Normal Original on a fresh setup', () => {
    expect(detectPreset(base())).toBe('normal');
    for (const preset of OFFICIAL_PRESETS) expect(detectPreset(applyPreset(base(), preset.id)), preset.id).toBe(preset.id);
  });

  it('turns into Custom on a manual edit and back into the preset when the value returns', () => {
    for (const preset of OFFICIAL_PRESETS) {
      const applied = applyPreset(base(), preset.id);
      const original = readAdvanced(applied, 'gravityScale') as number;
      const edited = writeAdvanced(applied, 'gravityScale', original + 0.5);
      expect(detectPreset(edited), preset.id).toBe('custom');
      expect(detectPreset(writeAdvanced(edited, 'gravityScale', original)), preset.id).toBe(preset.id);
    }
  });

  it('is robust to floating-point noise from sliders (0.1 + 0.2)', () => {
    const setup = applyPreset(base(), 'smooth');
    const noisy = writeAdvanced(setup, 'airControl', 2.2 + 4e-9);
    expect(readAdvanced(noisy, 'airControl')).not.toBe(2.2);
    expect(detectPreset(noisy)).toBe('smooth');
  });

  it('is Custom for a toggle edit as well', () => {
    expect(detectPreset(writeAdvanced(base(), 'circularAttack', false))).toBe('custom');
    expect(detectPreset(writeAdvanced(base(), 'vfx.dust', 0.5))).toBe('custom');
    expect(detectPreset(writeAdvanced(base(), 'clashImpact', 1.5))).toBe('custom');
  });

  it('counts MODIFIED against Normal Original, per category and in total', () => {
    let setup = base();
    expect(modifiedCount(setup)).toBe(0);
    setup = writeAdvanced(setup, 'gravityScale', 5);
    setup = writeAdvanced(setup, 'airControl', 0.5);
    setup = writeAdvanced(setup, 'jumpFullHeightM', 2);
    setup = writeAdvanced(setup, 'vfx.dust', 0.5);
    expect(modifiedCount(setup)).toBe(4);
    expect(modifiedCount(setup, 'movement')).toBe(2);
    expect(modifiedCount(setup, 'jump')).toBe(1);
    expect(modifiedCount(setup, 'visual')).toBe(1);
    expect(modifiedCount(setup, 'combat')).toBe(0);
    expect(isModified(setup, 'gravityScale')).toBe(true);
    expect(isModified(setup, 'topSpeedScale')).toBe(false);
    expect(modifiedKeys(setup)).toEqual(['gravityScale', 'airControl', 'jumpFullHeightM', 'vfx.dust']);
  });

  it('resets one category to Normal Original and leaves the others alone', () => {
    const setup = applyPreset(base(), 'epic');
    const reset = resetCategory(setup, 'movement');
    expect(modifiedCount(reset, 'movement')).toBe(0);
    expect(modifiedCount(reset, 'combat')).toBe(modifiedCount(setup, 'combat'));
    expect(modifiedCount(reset, 'visual')).toBe(modifiedCount(setup, 'visual'));
    expect(detectPreset(reset)).toBe('custom');
  });

  it('makes Reset all produce exactly Normal Original', () => {
    for (const preset of OFFICIAL_PRESETS) {
      const reset = withDefaultRules(applyPreset(base(), preset.id));
      expect(detectPreset(reset), preset.id).toBe('normal');
      expect(modifiedCount(reset)).toBe(0);
    }
  });

  it('every category reset of a preset lands on Normal Original together', () => {
    let setup = applyPreset(base(), 'strategic');
    for (const category of ADVANCED_CATEGORIES) setup = resetCategory(setup, category);
    expect(detectPreset(setup)).toBe('normal');
  });
});
