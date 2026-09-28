// The browser Self Test's building blocks: a batch stepped a few ticks at a
// time is the same batch as runAiBatch(); the report text covers GDD 163;
// scripted-vs-AI scenario runs (GDD 66).

import { describe, expect, it } from 'vitest';
import { ATTACK_ARCHETYPE, DEFENSE_ARCHETYPE, STAMINA_ARCHETYPE } from '../../src/bey/archetype/BeyArchetypes';
import { AiBatchSession, runAiBatch, type AiBatchMatchEntry } from '../../src/self-test/AiBatchRunner';
import { findScenarioPreset } from '../../src/self-test/scenarios/ScenarioPresets';
import { runScenario } from '../../src/self-test/scenarios/ScenarioRunner';
import { renderBatchReport, renderScenarioResults, selfTestReportJson } from '../../src/debug/self-test-ui/selfTestReportView';
import { resolveAppMode } from '../../src/app/modes/appMode';

const MATCHUPS = [
  { firstDefinition: ATTACK_ARCHETYPE, secondDefinition: DEFENSE_ARCHETYPE },
  { firstDefinition: STAMINA_ARCHETYPE, secondDefinition: ATTACK_ARCHETYPE },
];
const SEEDS = ['stepped-0', 'stepped-1'];
const shape = (e: AiBatchMatchEntry) => ({ seed: e.seed, outcome: e.outcome, ticks: e.ticks, clashes: e.clashes, failureReasons: e.failureReasons, detections: e.detections.map((d) => `${d.tick}/${d.kind}`) });

describe('AiBatchSession (stepped batch)', () => {
  it('stepping 37 ticks at a time gives exactly the matches runAiBatch gives', async () => {
    const whole = await runAiBatch({ matchups: MATCHUPS, seeds: SEEDS });
    const session = new AiBatchSession({ matchups: MATCHUPS, seeds: SEEDS });
    let steps = 0;
    let sawCurrent = false;
    while (!(await session.step(37))) {
      steps++;
      const progress = session.progress();
      expect(progress.total).toBe(4);
      if (progress.current) {
        sawCurrent = true;
        expect(progress.current.tick).toBeGreaterThan(0);
      }
    }
    expect(steps).toBeGreaterThan(10);
    expect(sawCurrent).toBe(true);
    const stepped = session.report();
    expect(stepped.entries.map(shape)).toEqual(whole.entries.map(shape));
    expect(stepped.matches).toBe(whole.matches);
    expect(session.progress().current).toBeNull();
  }, 240_000);

  it('dispose() mid-match frees the running world', async () => {
    const session = new AiBatchSession({ matchups: MATCHUPS.slice(0, 1), seeds: SEEDS.slice(0, 1) });
    await session.step(50);
    expect(session.progress().current).not.toBeNull();
    session.dispose();
    expect(session.progress().current).toBeNull();
  });
});

describe('Self Test report view', () => {
  it('shows every GDD 163 field and round-trips as JSON', async () => {
    const report = await runAiBatch({ matchups: MATCHUPS.slice(0, 1), seeds: SEEDS.slice(0, 1) });
    const textReport = renderBatchReport(report, true);
    for (const field of ['matches', 'pass / fail', 'crashes', 'hangs', 'invalid states', 'average duration', 'ring-outs / KOs', 'Clash count', 'divergence', 'performance', 'acceleration', 'seeds']) {
      expect(textReport, field).toContain(field);
    }
    expect(textReport).toMatch(/divergence\s+UNSUPPORTED/);
    const json = JSON.parse(selfTestReportJson(report, []));
    expect(json.format).toBe('ChaosBeySelfTestReportV1');
    expect(json.batch.matches).toBe(1);
    expect(json.knownIssues['ext-32']).toMatch(/wall/);
  }, 60_000);
});

describe('scripted vs AI scenarios (GDD 66)', () => {
  it('replaces one side with the real AI, deterministically, and passes on no crash / no invalid state', async () => {
    const preset = findScenarioPreset('dash-attack')!;
    const a = await runScenario(preset, { aiSide: 'second' });
    const b = await runScenario(preset, { aiSide: 'second' });
    expect(a.status).toBe('passed');
    expect(a.detail).toMatch(/^vs AI \(second\)/);
    expect({ ticks: b.ticks, detail: b.detail }).toEqual({ ticks: a.ticks, detail: a.detail });
    expect(renderScenarioResults([a])).toContain('Test Dash Attack');
  }, 60_000);

  it('the self-test mode route', () => {
    expect(resolveAppMode('?mode=self-test')).toBe('self-test');
  });
});
