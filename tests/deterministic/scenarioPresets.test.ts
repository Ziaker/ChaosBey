// GDD 68 scenario presets, run headless on the shared Self-Test core.

import { describe, expect, it } from 'vitest';
import { SCENARIO_PRESETS, findScenarioPreset } from '../../src/self-test/scenarios/ScenarioPresets';
import { runScenario, runScenarioSuite } from '../../src/self-test/scenarios/ScenarioRunner';

const GDD_68_NAMES = [
  'Test Clash',
  'Test Dash Attack',
  'Test Circular Counter',
  'Test Ring-Out',
  'Test Wall Hit',
  'Test Wall Ricochet',
  'Test High Knockback',
  'Test Zero/Low Stamina',
  'Test Stability Break',
  'Test Perfect Dodge',
  'Test Air Recovery',
  'Test Jump Attack',
  'Test Strong Landing',
  'Test Drift',
  'Test Low Grip',
  'Test High-Speed Collision',
  'Test Clash Cooldown Collision',
  'Test Replay Reproduction',
];

describe('GDD 68 scenario presets', () => {
  it('cover every preset GDD 68 names', () => {
    const labels = SCENARIO_PRESETS.map((p) => p.label);
    for (const name of GDD_68_NAMES) expect(labels, name).toContain(name);
    expect(new Set(SCENARIO_PRESETS.map((p) => p.id)).size).toBe(SCENARIO_PRESETS.length);
  });

  it('every supported preset reproduces its scenario with no invalid state; replay reproduction is explicitly unsupported (M9)', async () => {
    const report = await runScenarioSuite();
    const failures = report.results.filter((r) => r.status === 'failed').map((r) => `${r.id}: ${r.detail}`);
    expect(failures).toEqual([]);
    expect(report.unsupported).toBe(1);
    const replay = report.results.find((r) => r.id === 'replay-reproduction')!;
    expect(replay.status).toBe('unsupported');
    expect(replay.detail).toMatch(/Milestone 9/);
    expect(report.passed).toBe(report.total - 1);
  }, 300_000);

  it('is deterministic: the same preset gives the same run', async () => {
    for (const id of ['clash', 'ring-out', 'drift', 'perfect-dodge']) {
      const preset = findScenarioPreset(id)!;
      const a = await runScenario(preset);
      const b = await runScenario(preset);
      expect({ ticks: b.ticks, detail: b.detail, status: b.status }, id).toEqual({ ticks: a.ticks, detail: a.detail, status: a.status });
    }
  }, 120_000);
});
