// ============================================================
// DEBUG LAB PANEL — DOM FOR THE DEVELOPER TOOL
// Controls (left) and the GDD section 69 inspector (right). Deliberately
// plain monospace developer styling, labeled TEMPORARY: this is a
// debugging instrument (GDD sections 1.2, 70), not a decision about the
// final HUD, menus or UI theme, which remain behind the owner's visual
// approval gate (GDD sections 1.6, 60, 171).
// Rendering-only: every action goes through the callbacks the mode
// provides; the panel never touches the simulation itself.
// ============================================================

import type { InspectorSection } from '../inspectors/buildInspection';
import { AI_PERSONALITY_CHOICES, type SideControllerSpec } from '../../app/session/SideControllers';
import type { Side } from '../../app/session/MatchSession';

// ============================================================
// DEBUG LAB PANEL — TUNING
// ============================================================

/** Simulation-speed choices: fixed ticks run per production fixed step (never a larger delta — GDD section 164). */
export const DEBUG_LAB_SPEED_CHOICES: readonly number[] = [1, 2, 4, 8];
/** Ticks run by the "step ×N" button. */
export const DEBUG_LAB_MULTI_STEP_TICKS = 10;

export interface DebugLabPanelCallbacks {
  onTogglePause(): void;
  onStep(ticks: number): void;
  onRestart(seedText: string | null): void;
  onNewSeed(): void;
  onSpeed(ticksPerFixedStep: number): void;
  onController(side: Side, spec: SideControllerSpec): void;
}

export interface DebugLabPanelStatus {
  readonly paused: boolean;
  readonly speed: number;
  readonly seedText: string;
  readonly tickIndex: number;
  readonly firstController: SideControllerSpec;
  readonly secondController: SideControllerSpec;
  readonly message: string | null;
}

const CONTROLLER_OPTIONS: readonly { value: string; label: string; spec: SideControllerSpec }[] = [
  { value: 'keyboard', label: 'Keyboard (arrows / Z X C)', spec: { kind: 'keyboard' } },
  ...AI_PERSONALITY_CHOICES.map((personality) => ({
    value: `ai:${personality}`,
    label: `AI — ${personality === 'archetype' ? "own archetype's personality" : `${personality} personality`}`,
    spec: { kind: 'ai', personality } as SideControllerSpec,
  })),
  { value: 'idle', label: 'Idle (no input)', spec: { kind: 'idle' } },
];

export function controllerSpecValue(spec: SideControllerSpec): string {
  switch (spec.kind) {
    case 'ai':
      return `ai:${spec.personality}`;
    case 'scripted':
      return `scripted:${spec.label}`;
    default:
      return spec.kind;
  }
}

export class DebugLabPanel {
  private readonly root: HTMLElement;
  private readonly controls: HTMLElement;
  private readonly inspector: HTMLElement;
  private readonly statusLine: HTMLElement;
  private readonly pauseButton: HTMLButtonElement;
  private readonly seedInput: HTMLInputElement;
  private readonly speedSelect: HTMLSelectElement;
  private readonly controllerSelects: Record<Side, HTMLSelectElement>;
  private readonly sectionElements = new Map<string, { details: HTMLDetailsElement; body: HTMLElement }>();

  constructor(mount: HTMLElement, private readonly callbacks: DebugLabPanelCallbacks) {
    this.root = el('div', 'debug-lab');
    this.root.setAttribute('data-testid', 'debug-lab');
    injectStyles();

    this.controls = el('div', 'debug-lab__controls');
    this.inspector = el('div', 'debug-lab__inspector');
    this.inspector.setAttribute('data-testid', 'debug-lab-inspector');

    const title = el('div', 'debug-lab__title');
    title.textContent = 'DEBUG LAB';
    const subtitle = el('div', 'debug-lab__subtitle');
    subtitle.textContent = 'Developer tool · temporary UI (not final HUD/menu)';
    this.statusLine = el('div', 'debug-lab__status');
    this.statusLine.setAttribute('data-testid', 'debug-lab-status');

    this.pauseButton = button('Pause [P]', 'debug-lab-pause', () => callbacks.onTogglePause());
    const stepButton = button('Step 1 [N]', 'debug-lab-step', () => callbacks.onStep(1));
    const multiStepButton = button(`Step ${DEBUG_LAB_MULTI_STEP_TICKS} [M]`, 'debug-lab-step-many', () => callbacks.onStep(DEBUG_LAB_MULTI_STEP_TICKS));

    this.seedInput = document.createElement('input');
    this.seedInput.type = 'text';
    this.seedInput.className = 'debug-lab__seed';
    this.seedInput.setAttribute('data-testid', 'debug-lab-seed');
    this.seedInput.spellcheck = false;
    const restartSame = button('Restart same seed [R]', 'debug-lab-restart', () => callbacks.onRestart(null));
    const restartTyped = button('Restart with typed seed', 'debug-lab-restart-typed', () => callbacks.onRestart(this.seedInput.value.trim() || null));
    const newSeed = button('Restart new seed [T]', 'debug-lab-new-seed', () => callbacks.onNewSeed());
    const copySeed = button('Copy seed', 'debug-lab-copy-seed', () => void navigator.clipboard?.writeText(this.seedInput.value).catch(() => undefined));

    this.speedSelect = document.createElement('select');
    this.speedSelect.setAttribute('data-testid', 'debug-lab-speed');
    for (const speed of DEBUG_LAB_SPEED_CHOICES) {
      const option = document.createElement('option');
      option.value = String(speed);
      option.textContent = `${speed}× (${speed} fixed tick${speed > 1 ? 's' : ''} per step)`;
      this.speedSelect.append(option);
    }
    this.speedSelect.addEventListener('change', () => callbacks.onSpeed(Number(this.speedSelect.value)));

    this.controllerSelects = { first: this.controllerSelect('first'), second: this.controllerSelect('second') };

    this.controls.append(
      title,
      subtitle,
      this.statusLine,
      group('Simulation', [this.pauseButton, stepButton, multiStepButton, labeled('Speed', this.speedSelect)]),
      group('Seed', [this.seedInput, restartSame, restartTyped, newSeed, copySeed]),
      group('Controllers', [labeled('First Bey', this.controllerSelects.first), labeled('Second Bey', this.controllerSelects.second)]),
    );
    this.root.append(this.controls, this.inspector);
    mount.append(this.root);
  }

  /** Extra control groups added by later Debug Lab features (visualization, mutation, reports). */
  addGroup(titleText: string, children: HTMLElement[]): void {
    this.controls.append(group(titleText, children));
  }

  updateStatus(status: DebugLabPanelStatus): void {
    this.pauseButton.textContent = status.paused ? 'Resume [P]' : 'Pause [P]';
    this.pauseButton.setAttribute('data-paused', String(status.paused));
    if (document.activeElement !== this.seedInput) this.seedInput.value = status.seedText;
    this.speedSelect.value = String(status.speed);
    this.controllerSelects.first.value = controllerSpecValue(status.firstController);
    this.controllerSelects.second.value = controllerSpecValue(status.secondController);
    this.statusLine.textContent = `${status.paused ? 'PAUSED' : 'RUNNING'} · tick ${status.tickIndex}${status.message ? ` · ${status.message}` : ''}`;
    this.statusLine.setAttribute('data-tick', String(status.tickIndex));
  }

  updateInspector(sections: readonly InspectorSection[]): void {
    const seen = new Set<string>();
    for (const section of sections) {
      seen.add(section.id);
      let entry = this.sectionElements.get(section.id);
      if (!entry) {
        const details = document.createElement('details');
        details.className = 'debug-lab__section';
        details.setAttribute('data-section', section.id);
        details.open = section.id === 'match' || section.id.endsWith('-resources');
        const summary = document.createElement('summary');
        summary.textContent = section.title;
        const body = el('div', 'debug-lab__rows');
        details.append(summary, body);
        this.inspector.append(details);
        entry = { details, body };
        this.sectionElements.set(section.id, entry);
      }
      const summary = entry.details.querySelector('summary');
      if (summary && summary.textContent !== section.title) summary.textContent = section.title;
      // Only a visible section's rows are rebuilt; a collapsed one costs nothing.
      if (!entry.details.open) continue;
      const lines = section.rows.map((r) => `${r.unsupported ? '⊘ ' : ''}${r.label.padEnd(34)} ${r.value}`);
      const text = lines.join('\n');
      if (entry.body.textContent !== text) entry.body.textContent = text;
    }
    for (const [id, entry] of this.sectionElements) {
      if (!seen.has(id)) {
        entry.details.remove();
        this.sectionElements.delete(id);
      }
    }
  }

  isTypingInField(): boolean {
    const active = document.activeElement;
    return active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement;
  }

  private controllerSelect(side: Side): HTMLSelectElement {
    const select = document.createElement('select');
    select.setAttribute('data-testid', `debug-lab-controller-${side}`);
    for (const option of CONTROLLER_OPTIONS) {
      const element = document.createElement('option');
      element.value = option.value;
      element.textContent = option.label;
      select.append(element);
    }
    select.addEventListener('change', () => {
      const chosen = CONTROLLER_OPTIONS.find((o) => o.value === select.value);
      if (chosen) this.callbacks.onController(side, chosen.spec);
      select.blur();
    });
    return select;
  }
}

function el(tag: string, className: string): HTMLElement {
  const element = document.createElement(tag);
  element.className = className;
  return element;
}

export function button(label: string, testId: string, onClick: () => void): HTMLButtonElement {
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

export function labeled(labelText: string, control: HTMLElement): HTMLElement {
  const wrapper = el('label', 'debug-lab__labeled');
  const span = document.createElement('span');
  span.textContent = labelText;
  wrapper.append(span, control);
  return wrapper;
}

function group(titleText: string, children: HTMLElement[]): HTMLElement {
  const wrapper = el('fieldset', 'debug-lab__group');
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
    .debug-lab { position: fixed; inset: 0; pointer-events: none; font: 11px/1.35 ui-monospace, Menlo, Consolas, monospace; color: #d8e0f0; z-index: 1000; }
    .debug-lab__controls, .debug-lab__inspector { pointer-events: auto; position: absolute; top: 8px; bottom: 8px; overflow-y: auto; background: rgba(8, 10, 18, 0.88); border: 1px solid #334; padding: 8px; box-sizing: border-box; }
    .debug-lab__controls { left: 8px; width: 270px; }
    .debug-lab__inspector { right: 8px; width: min(560px, 48vw); }
    .debug-lab__title { font-weight: bold; font-size: 13px; color: #ffd166; }
    .debug-lab__subtitle { color: #8a93a8; margin-bottom: 6px; }
    .debug-lab__status { color: #7ee0a0; margin-bottom: 6px; }
    .debug-lab__group { border: 1px solid #334; margin: 6px 0; padding: 4px 6px 6px; display: flex; flex-wrap: wrap; gap: 4px; }
    .debug-lab__group legend { color: #9fb3ff; padding: 0 4px; }
    .debug-lab button, .debug-lab select, .debug-lab input { font: inherit; color: #e6ecff; background: #1a2033; border: 1px solid #45507a; padding: 2px 6px; }
    .debug-lab button:hover { background: #26304d; }
    .debug-lab button[data-danger="true"] { border-color: #c0504d; color: #ffb4b0; }
    .debug-lab__seed { width: 100%; box-sizing: border-box; }
    .debug-lab__labeled { display: flex; flex-direction: column; width: 100%; gap: 2px; }
    .debug-lab__labeled > span { color: #8a93a8; }
    .debug-lab__section summary { cursor: pointer; color: #9fb3ff; margin-top: 4px; }
    .debug-lab__rows { white-space: pre; overflow-x: auto; padding: 2px 0 4px 10px; }
  `;
  document.head.append(style);
}
