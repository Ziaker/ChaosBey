// ============================================================
// SELF TEST MODE (GDD sections 66, 144, 162–164)
// The browser Self Test, reached with ?mode=self-test. Everything it runs
// is the shared Self-Test core (src/self-test/): AI-vs-AI batches through
// AiBatchSession (the same code as runAiBatch, stepped), GDD 68 scenario
// presets through ScenarioRunner, the GDD 67 detector on every tick, and
// the GDD 163 report.
//
// Acceleration (GDD 164): the FixedTimestepLoop's fixed step drives the
// pace; each fixed step simulates `speed` fixed ticks (1× = real time) or,
// at "max", as many as fit a per-frame time budget. The physics delta is
// never enlarged. Rendering is reduced to a 2D minimap (GDD 66: optional
// rendering disable/reduction); the 3D renderer is not used here.
//
// Developer tool UI, not a final menu or HUD (GDD 1.6, 171.10).
// ============================================================

import { ALL_BEY_ARCHETYPES } from '../../bey/archetype/BeyArchetypes';
import { FixedTimestepLoop } from '../../physics/fixed-step/FixedTimestepLoop';
import { AiBatchSession, matchupLabel, type AiBatchMatchup, type AiBatchReport } from '../../self-test/AiBatchRunner';
import { SCENARIO_PRESETS, findScenarioPreset } from '../../self-test/scenarios/ScenarioPresets';
import { runScenario, type ScenarioResult } from '../../self-test/scenarios/ScenarioRunner';
import { SelfTestMinimap } from './SelfTestMinimap';
import { renderBatchReport, renderScenarioResults, selfTestReportJson } from './selfTestReportView';

// ============================================================
// SELF TEST MODE — TUNING
// ============================================================

/** Speed choices: fixed ticks simulated per production fixed step. 0 = "max" (time budget per frame). */
export const SELF_TEST_SPEED_CHOICES: readonly number[] = [1, 4, 16, 64, 0];
/** At "max", milliseconds of simulation per rendered frame (keeps the page responsive). */
const MAX_SPEED_FRAME_BUDGET_MS = 12;
/** At "max", ticks per chunk between budget checks. */
const MAX_SPEED_CHUNK_TICKS = 60;
const DEFAULT_SEED_COUNT = 3;
const DEFAULT_MAX_TICKS = 6000;

export interface SelfTestHandle {
  runBatch(options?: { seeds?: string[]; matchups?: AiBatchMatchup[]; maxTicks?: number }): Promise<AiBatchReport>;
  runScenarios(ids?: string[], aiSide?: 'first' | 'second'): Promise<ScenarioResult[]>;
  setSpeed(ticksPerStep: number): void;
  stop(): void;
  isRunning(): boolean;
  lastBatchReport(): AiBatchReport | null;
  /** Fixed ticks simulated by the running (or last) batch so far — finished matches plus the current one. */
  simulatedTicks(): number;
}

declare global {
  interface Window {
    __chaosBeySelfTest?: SelfTestHandle;
  }
}

export function allMatchups(): AiBatchMatchup[] {
  return ALL_BEY_ARCHETYPES.flatMap((first) => ALL_BEY_ARCHETYPES.map((second) => ({ firstDefinition: first, secondDefinition: second })));
}

export async function startSelfTestMode(mount: HTMLElement): Promise<SelfTestHandle> {
  injectStyles();
  const root = div('self-test');
  root.setAttribute('data-testid', 'self-test');
  const left = div('self-test__col self-test__controls');
  const center = div('self-test__col self-test__center');
  const right = div('self-test__col self-test__report');
  root.append(left, center, right);
  mount.append(root);

  const title = div('self-test__title');
  title.textContent = 'SELF TEST';
  const subtitle = div('self-test__subtitle');
  subtitle.textContent = 'Developer tool · temporary UI (not final menu) · headless core, 2D minimap';
  const status = div('self-test__status');
  status.setAttribute('data-testid', 'self-test-status');
  const progressBar = document.createElement('progress');
  progressBar.max = 1;
  progressBar.value = 0;
  progressBar.setAttribute('data-testid', 'self-test-progress');
  const minimap = new SelfTestMinimap();
  const reportView = document.createElement('pre');
  reportView.className = 'self-test__pre';
  reportView.setAttribute('data-testid', 'self-test-report');
  reportView.textContent = 'Run a batch or the scenario presets to see a report.';
  const failuresView = div('self-test__failures');
  failuresView.setAttribute('data-testid', 'self-test-failures');
  const scenarioView = document.createElement('pre');
  scenarioView.className = 'self-test__pre';
  scenarioView.setAttribute('data-testid', 'self-test-scenarios');

  // ---- controls ----
  const matchupBoxes = allMatchups().map((matchup) => {
    const label = document.createElement('label');
    label.className = 'self-test__check';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = true;
    box.setAttribute('data-matchup', matchupLabel(matchup));
    label.append(box, text(matchupLabel(matchup).replace(/-prototype/g, '')));
    return { matchup, box, label };
  });
  const seedPrefix = input('self-test-seed-prefix', 'text', 'self-test');
  const seedCount = input('self-test-seed-count', 'number', String(DEFAULT_SEED_COUNT));
  const maxTicks = input('self-test-max-ticks', 'number', String(DEFAULT_MAX_TICKS));
  const speedSelect = document.createElement('select');
  speedSelect.setAttribute('data-testid', 'self-test-speed');
  for (const speed of SELF_TEST_SPEED_CHOICES) {
    const option = document.createElement('option');
    option.value = String(speed);
    option.textContent = speed === 0 ? 'max (as fast as the CPU allows)' : speed === 1 ? '1× (real time)' : `${speed}× (${speed} fixed ticks per step)`;
    speedSelect.append(option);
  }
  speedSelect.value = '0';

  const presetSelect = document.createElement('select');
  presetSelect.setAttribute('data-testid', 'self-test-preset');
  for (const preset of SCENARIO_PRESETS) {
    const option = document.createElement('option');
    option.value = preset.id;
    option.textContent = preset.supported ? preset.label : `${preset.label} (unsupported until M9)`;
    presetSelect.append(option);
  }
  const pairingSelect = document.createElement('select');
  pairingSelect.setAttribute('data-testid', 'self-test-pairing');
  for (const [value, label] of [
    ['', 'scripted vs scripted'],
    ['second', 'scripted (first) vs AI (second)'],
    ['first', 'AI (first) vs scripted (second)'],
  ] as const) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    pairingSelect.append(option);
  }

  // ---- run state ----
  let speed = 0;
  let batch: AiBatchSession | null = null;
  let batchResolve: ((report: AiBatchReport) => void) | null = null;
  let dueTicks = 0;
  let pumping = false;
  let stopRequested = false;
  let lastReport: AiBatchReport | null = null;
  let lastScenarioResults: ScenarioResult[] = [];
  let lastLabel = '';
  let lastShownCompleted = -1;

  const setStatus = (line: string): void => {
    status.textContent = line;
  };

  const showBatchReport = (report: AiBatchReport, finished: boolean): void => {
    reportView.textContent = renderBatchReport(report, finished);
    renderFailures(report);
    progressBar.max = Math.max(1, batch ? batch.progress().total : report.matches);
    progressBar.value = report.matches;
  };

  const renderFailures = (report: AiBatchReport): void => {
    failuresView.replaceChildren();
    for (const failure of report.failures) {
      const rowEl = div('self-test__failure');
      rowEl.setAttribute('data-seed', failure.seed);
      const info = text(`${failure.seed} — ${failure.failureReasons.join(', ')}${failure.crashMessage ? ` (${failure.crashMessage})` : ''}${failure.detections.length ? ` — ${failure.detections.map((d) => `${d.kind}${d.knownIssue ? `[${d.knownIssue}]` : ''}@t${d.tick}`).join(', ')}` : ''}`);
      const replay = button('Replay seed (1×)', () => void handle.runBatch({ seeds: [failure.seed.split('/')[0]!], matchups: allMatchups().filter((m) => matchupLabel(m) === failure.matchup), maxTicks: Number(maxTicks.value) || DEFAULT_MAX_TICKS }).then(() => undefined), 'self-test-replay');
      replay.addEventListener('click', () => {
        speed = 1;
        speedSelect.value = '1';
      });
      const copy = button('Copy seed', () => void navigator.clipboard?.writeText(failure.seed).catch(() => undefined), 'self-test-copy-seed');
      rowEl.append(info, replay, copy);
      failuresView.append(rowEl);
    }
  };

  const finishBatch = (): void => {
    if (!batch) return;
    const report = batch.report();
    lastReport = report;
    showBatchReport(report, true);
    setStatus(`batch ${stopRequested ? 'stopped' : 'done'}: ${report.matches} matches, ${report.failed} failed (${report.unknownInvalidStates} unknown invalid states) · ${report.timing.simulatedPerWallSecond.toFixed(1)}× real time`);
    batch.dispose();
    batch = null;
    minimap.draw(null);
    const resolve = batchResolve;
    batchResolve = null;
    resolve?.(report);
  };

  const pump = async (): Promise<void> => {
    if (pumping || !batch) return;
    pumping = true;
    try {
      if (stopRequested) {
        finishBatch();
        return;
      }
      if (speed === 0) {
        const start = performance.now();
        while (batch && !batch.isDone && performance.now() - start < MAX_SPEED_FRAME_BUDGET_MS && !stopRequested) {
          await batch.step(MAX_SPEED_CHUNK_TICKS);
        }
      } else if (dueTicks > 0) {
        const ticks = dueTicks;
        dueTicks = 0;
        await batch.step(ticks);
      }
      if (!batch) return;
      const progress = batch.progress();
      if (progress.current) {
        const a = progress.current.world.first.body.translation();
        const b = progress.current.world.second.body.translation();
        minimap.draw({ first: a, second: b, caption: `${progress.current.matchup.replace(/-prototype/g, '')} · ${progress.current.seed.split('/')[0]} · t${progress.current.tick}` });
      }
      progressBar.max = Math.max(1, progress.total);
      progressBar.value = progress.completed;
      if (progress.completed !== lastShownCompleted) {
        lastShownCompleted = progress.completed;
        if (progress.completed > 0) showBatchReport(batch.report(), false);
      }
      setStatus(`running batch: match ${Math.min(progress.completed + 1, progress.total)} / ${progress.total}${progress.current ? ` · tick ${progress.current.tick}` : ''}`);
      if (batch.isDone) finishBatch();
    } finally {
      pumping = false;
    }
  };

  const loop = new FixedTimestepLoop({
    onFixedTick: () => {
      if (batch && speed > 0) dueTicks += speed;
    },
    onRenderFrame: () => {
      if (batch) void pump();
    },
    onFatalError: (error) => {
      console.error('Self Test loop halted:', error);
      setStatus(`HALTED: ${error instanceof Error ? error.message : String(error)}`);
    },
  });
  loop.start();

  const handle: SelfTestHandle = {
    runBatch: (options = {}) => {
      if (batch) return Promise.reject(new Error('a batch is already running'));
      const count = Math.max(1, Math.floor(Number(seedCount.value) || DEFAULT_SEED_COUNT));
      const seeds = options.seeds ?? Array.from({ length: count }, (_, i) => `${seedPrefix.value || 'self-test'}-${i}`);
      const matchups = options.matchups ?? matchupBoxes.filter((m) => m.box.checked).map((m) => m.matchup);
      stopRequested = false;
      dueTicks = 0;
      lastShownCompleted = -1;
      minimap.clear();
      lastLabel = `${matchups.length} matchup(s) × ${seeds.length} seed(s)`;
      batch = new AiBatchSession({ matchups, seeds, maxTicks: options.maxTicks ?? (Math.floor(Number(maxTicks.value)) || DEFAULT_MAX_TICKS) });
      setStatus(`running batch: ${lastLabel}`);
      return new Promise<AiBatchReport>((resolve) => {
        batchResolve = resolve;
      });
    },
    runScenarios: async (ids, aiSide) => {
      const presets = (ids ?? SCENARIO_PRESETS.map((p) => p.id)).map((id) => findScenarioPreset(id)).filter((p) => p !== undefined);
      const results: ScenarioResult[] = [];
      for (const preset of presets) {
        setStatus(`running scenario ${results.length + 1} / ${presets.length}: ${preset.label}`);
        results.push(await runScenario(preset, { aiSide }));
        scenarioView.textContent = renderScenarioResults(results);
        await nextFrame();
      }
      lastScenarioResults = results;
      setStatus(`scenarios done: ${results.filter((r) => r.status === 'passed').length} passed, ${results.filter((r) => r.status === 'failed').length} failed, ${results.filter((r) => r.status === 'unsupported').length} unsupported`);
      return results;
    },
    setSpeed: (ticks) => {
      speed = Math.max(0, Math.floor(ticks));
      speedSelect.value = String(speed);
    },
    stop: () => {
      stopRequested = true;
    },
    isRunning: () => batch !== null,
    simulatedTicks: () => {
      if (!batch) return lastReport ? lastReport.entries.reduce((sum, e) => sum + e.ticks, 0) : 0;
      const progress = batch.progress();
      return batch.report().entries.reduce((sum, e) => sum + e.ticks, 0) + (progress.current?.tick ?? 0);
    },
    lastBatchReport: () => lastReport,
  };

  speedSelect.addEventListener('change', () => handle.setSpeed(Number(speedSelect.value)));

  const download = button(
    'Download report (.json)',
    () => {
      const json = selfTestReportJson(lastReport, lastScenarioResults);
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `chaosbey-self-test-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    'self-test-download',
  );

  left.append(
    title,
    subtitle,
    status,
    group('AI vs AI batch (GDD 162/163)', [
      ...matchupBoxes.map((m) => m.label),
      labeledEl('Seed prefix', seedPrefix),
      labeledEl('Seeds per matchup', seedCount),
      labeledEl('Max ticks per match (hang limit)', maxTicks),
      labeledEl('Speed (GDD 164)', speedSelect),
      button('Run batch', () => void handle.runBatch(), 'self-test-run-batch'),
      button('Stop', () => handle.stop(), 'self-test-stop'),
    ]),
    group('Scenario presets (GDD 68)', [
      labeledEl('Preset', presetSelect),
      labeledEl('Controllers (GDD 66)', pairingSelect),
      button('Run preset', () => void handle.runScenarios([presetSelect.value], (pairingSelect.value || undefined) as 'first' | 'second' | undefined), 'self-test-run-preset'),
      button('Run all presets', () => void handle.runScenarios(undefined, (pairingSelect.value || undefined) as 'first' | 'second' | undefined), 'self-test-run-all-presets'),
    ]),
    group('Report', [download]),
  );
  center.append(minimap.canvas, progressBar, scenarioView);
  right.append(reportView, failuresView);

  setStatus('idle');
  window.addEventListener('beforeunload', () => {
    loop.stop();
    batch?.dispose();
  });
  window.__chaosBeySelfTest = handle;
  return handle;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function div(className: string): HTMLDivElement {
  const element = document.createElement('div');
  element.className = className;
  return element;
}

function text(value: string): Text {
  return document.createTextNode(value);
}

function input(testId: string, type: string, value: string): HTMLInputElement {
  const element = document.createElement('input');
  element.type = type;
  element.value = value;
  element.setAttribute('data-testid', testId);
  return element;
}

function button(label: string, onClick: () => void, testId: string): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  element.setAttribute('data-testid', testId);
  element.addEventListener('click', () => {
    onClick();
    element.blur();
  });
  return element;
}

function labeledEl(labelText: string, control: HTMLElement): HTMLElement {
  const wrapper = document.createElement('label');
  wrapper.className = 'self-test__labeled';
  const span = document.createElement('span');
  span.textContent = labelText;
  wrapper.append(span, control);
  return wrapper;
}

function group(titleText: string, children: (HTMLElement | Text)[]): HTMLElement {
  const wrapper = document.createElement('fieldset');
  wrapper.className = 'self-test__group';
  const legend = document.createElement('legend');
  legend.textContent = titleText;
  wrapper.append(legend, ...children);
  return wrapper;
}

let stylesInjected = false;
function injectStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .self-test { pointer-events: auto; position: fixed; inset: 0; display: grid; grid-template-columns: 300px 340px 1fr; gap: 8px; padding: 8px; box-sizing: border-box; background: #05050a; font: 11px/1.35 ui-monospace, Menlo, Consolas, monospace; color: #d8e0f0; overflow: hidden; }
    .self-test__col { overflow-y: auto; background: rgba(8, 10, 18, 0.9); border: 1px solid #334; padding: 8px; box-sizing: border-box; }
    .self-test__title { font-weight: bold; font-size: 13px; color: #ffd166; }
    .self-test__subtitle { color: #8a93a8; margin-bottom: 6px; }
    .self-test__status { color: #7ee0a0; margin-bottom: 6px; white-space: pre-wrap; }
    .self-test__group { border: 1px solid #334; margin: 6px 0; padding: 4px 6px 6px; display: flex; flex-wrap: wrap; gap: 4px; }
    .self-test__group legend { color: #9fb3ff; padding: 0 4px; }
    .self-test button, .self-test select, .self-test input { font: inherit; color: #e6ecff; background: #1a2033; border: 1px solid #45507a; padding: 2px 6px; }
    .self-test__check { display: flex; gap: 4px; width: 100%; }
    .self-test__check input { width: auto; }
    .self-test__labeled { display: flex; flex-direction: column; width: 100%; gap: 2px; }
    .self-test__labeled > span { color: #8a93a8; }
    .self-test__minimap { width: 100%; height: auto; border: 1px solid #334; }
    .self-test progress { width: 100%; }
    .self-test__pre { white-space: pre-wrap; margin: 0; }
    .self-test__failure { border-top: 1px solid #334; padding: 4px 0; display: flex; flex-wrap: wrap; gap: 4px; }
  `;
  document.head.append(style);
}
