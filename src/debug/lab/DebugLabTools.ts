// ============================================================
// DEBUG LAB TOOLS — MUTATION + REPORT CONTROLS
// DOM for the GDD section 70 mutation tools and the debug report. Every
// mutation button is styled as a danger control and says, in its group
// title, that it changes the simulation; each one goes through
// DebugMutations (which logs it on the session). Developer tool UI only.
// ============================================================

import type { MatchSession, Side } from '../../app/session/MatchSession';
import {
  FORCED_ACTIONS,
  forceAction,
  prepareClash,
  resetCooldowns,
  setAngularVelocity,
  setLinearVelocity,
  setResourceFraction,
  teleportBey,
  type DebugResource,
} from '../cheats/DebugMutations';
import type { DebugReport } from '../report/buildDebugReport';
import { debugReportFileName } from '../report/buildDebugReport';
import { button, labeled } from './DebugLabPanel';

// ============================================================
// DEBUG LAB TOOLS — TUNING
// ============================================================

/** Mutation log lines shown in the panel (the session keeps all of them). */
const MUTATION_LOG_VISIBLE_LINES = 8;

export interface DebugLabToolsHost {
  getSession(): MatchSession | null;
  /** Called after any mutation so the panel/inspector refresh. */
  onMutated(): void;
  buildReport(): DebugReport | null;
}

export interface DebugLabTools {
  readonly mutationControls: HTMLElement[];
  readonly reportControls: HTMLElement[];
  refreshLog(): void;
}

export function createDebugLabTools(host: DebugLabToolsHost): DebugLabTools {
  let side: Side = 'first';

  const run = (fn: (session: MatchSession) => void): void => {
    const session = host.getSession();
    if (!session) return;
    fn(session);
    host.onMutated();
    refreshLog();
  };

  const sideSelect = select('debug-lab-mut-side', [
    ['first', 'First Bey'],
    ['second', 'Second Bey'],
  ]);
  sideSelect.addEventListener('change', () => {
    side = sideSelect.value === 'second' ? 'second' : 'first';
  });

  const x = numberInput('debug-lab-mut-x', 0);
  const y = numberInput('debug-lab-mut-y', 0);
  const z = numberInput('debug-lab-mut-z', 0);
  const vectorRow = row([x, y, z]);

  const teleport = danger(button('Teleport to (x, z)', 'debug-lab-mut-teleport', () => run((s) => teleportBey(s, side, x.valueAsNumber || 0, z.valueAsNumber || 0))));
  const setVelocity = danger(
    button('Set velocity (x, y, z) m/s', 'debug-lab-mut-velocity', () =>
      run((s) => setLinearVelocity(s, side, { x: x.valueAsNumber || 0, y: y.valueAsNumber || 0, z: z.valueAsNumber || 0 })),
    ),
  );
  const setAngular = danger(
    button('Set angular velocity (x, y, z) rad/s', 'debug-lab-mut-angular', () =>
      run((s) => setAngularVelocity(s, side, { x: x.valueAsNumber || 0, y: y.valueAsNumber || 0, z: z.valueAsNumber || 0 })),
    ),
  );

  const resourceSelect = select('debug-lab-mut-resource', [
    ['stamina', 'Stamina'],
    ['stability', 'Stability'],
    ['attackEnergy', 'Attack Energy'],
  ]);
  const percent = numberInput('debug-lab-mut-percent', 100);
  percent.min = '0';
  percent.max = '100';
  const setResource = danger(
    button('Set resource to %', 'debug-lab-mut-resource-apply', () =>
      run((s) => setResourceFraction(s, side, resourceSelect.value as DebugResource, (percent.valueAsNumber || 0) / 100)),
    ),
  );

  const reset = danger(button('Reset cooldowns (both + Clash)', 'debug-lab-mut-reset-cooldowns', () => run((s) => resetCooldowns(s))));
  const forced = FORCED_ACTIONS.map((action) => danger(button(`Force: ${action.label}`, `debug-lab-mut-force-${action.id}`, () => run((s) => forceAction(s, side, action.id)))));
  const clash = danger(button('Prepare Clash (line up + both Dash)', 'debug-lab-mut-prepare-clash', () => run((s) => prepareClash(s))));

  const log = document.createElement('pre');
  log.className = 'debug-lab__log';
  log.setAttribute('data-testid', 'debug-lab-mutation-log');

  function refreshLog(): void {
    const mutations = host.getSession()?.getDebugMutations() ?? [];
    log.textContent =
      mutations.length === 0
        ? 'No mutations — this run is a pure replay of its seed + controllers.'
        : `${mutations.length} mutation(s) — the seed alone no longer reproduces this run:\n` +
          mutations
            .slice(-MUTATION_LOG_VISIBLE_LINES)
            .map((m) => `t${m.tickIndex}  ${m.description}`)
            .join('\n');
    log.setAttribute('data-count', String(mutations.length));
  }
  refreshLog();

  // ---- Report ----
  const reportText = document.createElement('textarea');
  reportText.className = 'debug-lab__report';
  reportText.readOnly = true;
  reportText.rows = 6;
  reportText.setAttribute('data-testid', 'debug-lab-report-text');
  reportText.placeholder = 'Generate a report to see it here.';
  let lastReport: DebugReport | null = null;
  const generate = button('Generate debug report', 'debug-lab-report-generate', () => {
    lastReport = host.buildReport();
    reportText.value = lastReport ? JSON.stringify(lastReport, null, 2) : '';
  });
  const copy = button('Copy report', 'debug-lab-report-copy', () => {
    if (!reportText.value) lastReport = host.buildReport();
    if (lastReport && !reportText.value) reportText.value = JSON.stringify(lastReport, null, 2);
    void navigator.clipboard?.writeText(reportText.value).catch(() => undefined);
  });
  const download = button('Download report (.json)', 'debug-lab-report-download', () => {
    lastReport = host.buildReport();
    if (!lastReport) return;
    const json = JSON.stringify(lastReport, null, 2);
    reportText.value = json;
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = debugReportFileName(lastReport);
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  return {
    mutationControls: [
      note('Changes the simulation. Every action is logged; reports mark the run as mutated.'),
      labeled('Target', sideSelect),
      labeled('x / y / z', vectorRow),
      teleport,
      setVelocity,
      setAngular,
      labeled('Resource', resourceSelect),
      labeled('Percent', percent),
      setResource,
      reset,
      ...forced,
      clash,
      labeled('Mutation log', log),
    ],
    reportControls: [generate, copy, download, reportText],
    refreshLog,
  };
}

function danger(element: HTMLButtonElement): HTMLButtonElement {
  element.setAttribute('data-danger', 'true');
  return element;
}

function select(testId: string, options: readonly (readonly [string, string])[]): HTMLSelectElement {
  const element = document.createElement('select');
  element.setAttribute('data-testid', testId);
  for (const [value, text] of options) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = text;
    element.append(option);
  }
  element.addEventListener('change', () => element.blur());
  return element;
}

function numberInput(testId: string, initial: number): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'number';
  input.step = 'any';
  input.value = String(initial);
  input.className = 'debug-lab__number';
  input.setAttribute('data-testid', testId);
  return input;
}

function row(children: HTMLElement[]): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'debug-lab__row';
  wrapper.append(...children);
  return wrapper;
}

function note(text: string): HTMLElement {
  const element = document.createElement('div');
  element.className = 'debug-lab__note';
  element.textContent = text;
  return element;
}
