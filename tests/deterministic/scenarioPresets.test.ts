// GDD 68 scenario presets, run headless on the shared Self-Test core.

import { describe, expect, it } from 'vitest';
import { SCENARIO_PRESETS } from '../../src/self-test/scenarios/ScenarioPresets';
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

  it('every preset reproduces its scenario with no invalid state, replay reproduction included (M9)', async () => {
    const report = await runScenarioSuite();
    const failures = report.results.filter((r) => r.status === 'failed').map((r) => `${r.id}: ${r.detail}`);
    expect(failures).toEqual([]);
    expect(report.unsupported).toBe(0);
    expect(report.passed).toBe(report.total);
    const replay = report.results.find((r) => r.id === 'replay-reproduction')!;
    // A real replay, and both negative self-checks caught.
    expect(replay.ticks).toBeGreaterThan(180);
    expect(replay.detail).toMatch(/replayed \d+ ticks, \d+ checkpoints identical/);
    expect(replay.detail).toMatch(/edited inputs caught at TicksCompleted (\d+)/);
    expect(replay.detail).toMatch(/altered checkpoint caught at TicksCompleted (\d+)/);
    // A real scenario preset: verified with its setup re-applied, caught at the initial state without it.
    expect(replay.detail).toMatch(/scenario "clash" replayed with its setup: \d+ ticks identical/);
    expect(replay.detail).toContain('scenario "clash" without its setup caught at TicksCompleted 0');
  }, 300_000);

  it('is deterministic: every supported preset gives the same run twice (not just a hand-picked sample)', async () => {
    for (const preset of SCENARIO_PRESETS.filter((p) => p.supported)) {
      const a = await runScenario(preset);
      const b = await runScenario(preset);
      expect({ ticks: b.ticks, detail: b.detail, status: b.status }, preset.id).toEqual({ ticks: a.ticks, detail: a.detail, status: a.status });
    }
  }, 300_000);
});
