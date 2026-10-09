// ============================================================
// BEY REAL — THE PREGAME BLOCK
// Owner, 2026-10-09: the alternative mode's switch, its camera, its presets and — in a block of its own, "avançadamente
// avançado" — every slider of the mode, each with its own explanation always visible under it. The values live in the
// MatchSetup (`setup.real`, RealTuning.ts); this panel only draws them and writes them back through `onChange`.
//
// Only the sliders a match already uses are shown (RealTuning's `live`), so none is dead; the rest come as the engine learns them.
// The classic Advanced sliders the mode takes over are locked while it is on (advancedControls.ts `isLockedByRealMode`).
// ============================================================

import {
  REAL_BASE_PARAMS,
  REAL_GROUP_ORDER,
  REAL_GROUP_TITLES,
  REAL_PRESETS,
  liveRealSpecs,
  matchingRealPreset,
  realPresetValues,
  type RealParamKey,
  type RealParamSpec,
} from '../../bey/real/RealTuning';
import { REAL_CAMERA_LABELS, REAL_CAMERA_MODES, type RealCameraMode } from '../../camera/real/RealCameraModes';
import { button, el } from './frontendStyle';
import { defaultRealSetup, type MatchSetup, type RealSetup } from './matchSetup';

export interface RealModePanelOptions {
  readonly getSetup: () => MatchSetup;
  readonly onChange: (next: MatchSetup) => void;
}

interface ControlView {
  readonly spec: RealParamSpec;
  readonly wrapper: HTMLElement;
  readonly input: HTMLInputElement;
  readonly output: HTMLElement;
  readonly defaultText: HTMLElement;
  readonly modified: HTMLButtonElement;
}

/** What stays the same as the classic game, and what changes — shown once, at the top of the block. */
const INHERITS_TEXT =
  'Continua igual: a mesma arena e física (Rapier), Clash, Estabilidade/Quebra/KO, ring-out, spin-out e tempo, a mesma IA de ataque e defesa, HUD, efeitos, replays e as regras do Pregame. ' +
  'Muda: o Bey é conduzido por um piloto automático (você influencia), a física é de pião real (cuba, atrito, giro), sem Drift e sem controle no ar, e os sliders de movimento normais ficam travados.';

export class RealModePanel {
  readonly element = el('details', 'cb-pregame__advanced cb-real', 'pregame-real');
  private readonly state = el('span', 'cb-pregame__chip', 'pregame-real-state');
  private readonly enabledInput = el('input', 'cb-pregame__toggle', 'pregame-real-enabled');
  private readonly cameraButtons = new Map<RealCameraMode, HTMLButtonElement>();
  private readonly presetButtons = new Map<string, HTMLButtonElement>();
  private readonly presetText = el('p', 'cb-hint cb-real__preset-text', 'pregame-real-preset-text');
  private readonly deep = el('details', 'cb-real__deep', 'pregame-real-deep');
  private readonly deepCount = el('span', 'cb-pregame__chip', 'pregame-real-deep-count');
  private readonly resetButton = button('Voltar ao base', 'cb-button--small', 'pregame-real-reset', () => this.write(() => ({ ...defaultRealSetup(), enabled: this.real().enabled, camera: this.real().camera })));
  private readonly views: ControlView[] = [];

  constructor(private readonly options: RealModePanelOptions) {
    injectRealStyle();
    const summary = el('summary');
    const title = el('span');
    title.textContent = 'Bey Real';
    summary.append(title, this.state);

    const intro = el('p', 'cb-hint');
    intro.textContent = 'Modo alternativo: o Bey gira e se move sozinho como um pião de verdade, você influencia o rumo e aperta só Dash, Giratório, Pulo e Esquiva.';

    const enabledLabel = el('label', 'cb-real__switch');
    this.enabledInput.type = 'checkbox';
    this.enabledInput.addEventListener('change', () => this.write((r) => ({ ...r, enabled: this.enabledInput.checked })));
    const enabledText = el('span');
    enabledText.textContent = 'Jogar no modo Bey Real';
    enabledLabel.append(this.enabledInput, enabledText);

    const inherits = el('p', 'cb-hint cb-real__inherits', 'pregame-real-inherits');
    inherits.textContent = INHERITS_TEXT;

    this.element.append(summary, intro, enabledLabel, inherits, this.buildCamera(), this.buildDeep());
  }

  private real(): RealSetup {
    return this.options.getSetup().real ?? defaultRealSetup();
  }

  private write(change: (real: RealSetup) => RealSetup): void {
    const setup = this.options.getSetup();
    this.options.onChange({ ...setup, real: change(setup.real ?? defaultRealSetup()) });
  }

  private buildCamera(): HTMLElement {
    const block = el('div', 'cb-real__block', 'pregame-real-camera');
    const label = el('span', 'cb-field-label');
    label.textContent = 'Câmera';
    const group = el('div', 'cb-real__camera');
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', 'Câmera do Bey Real');
    for (const mode of REAL_CAMERA_MODES) {
      const node = button(REAL_CAMERA_LABELS[mode], 'cb-button--small cb-real__camera-option', `pregame-real-camera-${mode}`, () => this.write((r) => ({ ...r, camera: mode })));
      node.setAttribute('role', 'radio');
      this.cameraButtons.set(mode, node);
      group.append(node);
    }
    const note = el('p', 'cb-hint');
    note.textContent = 'A câmera nunca move o Bey: as setas continuam sendo as da arena, em qualquer câmera. A livre gira ao arrastar o mouse, aproxima com a roda e volta ao início com duplo clique.';
    block.append(label, group, note);
    return block;
  }

  private buildDeep(): HTMLElement {
    const summary = el('summary');
    const title = el('span');
    title.textContent = 'Avançadamente avançado';
    summary.append(title, this.deepCount);
    this.deep.append(summary);

    const hint = el('p', 'cb-hint');
    hint.textContent = 'Todos os sliders do modo, cada um com a sua explicação. O preset Base são os números que você afinou no laboratório.';
    const presets = el('div', 'cb-real__presets', 'pregame-real-presets');
    presets.setAttribute('role', 'radiogroup');
    presets.setAttribute('aria-label', 'Presets do Bey Real');
    for (const preset of REAL_PRESETS) {
      const node = button(preset.label, 'cb-button--small', `pregame-real-preset-${preset.id}`, () => this.write((r) => ({ ...r, presetId: preset.id, params: realPresetValues(preset.id) })));
      node.setAttribute('role', 'radio');
      node.title = preset.description;
      this.presetButtons.set(preset.id, node);
      presets.append(node);
    }
    this.deep.append(hint, presets, this.presetText);

    const specs = liveRealSpecs();
    for (const group of REAL_GROUP_ORDER) {
      const inGroup = specs.filter((s) => s.group === group);
      if (inGroup.length === 0) continue;
      const section = el('section', 'cb-real__group', `pregame-real-group-${group}`);
      const heading = el('h3', 'cb-pregame__heading');
      heading.textContent = REAL_GROUP_TITLES[group];
      section.append(heading);
      for (const spec of inGroup) section.append(this.buildControl(spec));
      this.deep.append(section);
    }
    this.deep.append(this.resetButton);
    return this.deep;
  }

  private buildControl(spec: RealParamSpec): HTMLElement {
    const wrapper = el('div', 'cb-pregame__ctl cb-pregame__ctl--slider cb-real__ctl', `pregame-real-ctl-${spec.key}`);
    const head = el('div', 'cb-pregame__ctl-head');
    const label = el('label', 'cb-field-label');
    label.textContent = spec.label;
    const defaultText = el('span', 'cb-pregame__default', `pregame-real-${spec.key}-default`);
    const modified = el('button', 'cb-chip-modified', `pregame-real-${spec.key}-modified`);
    modified.type = 'button';
    modified.textContent = 'Alterado';
    modified.title = 'Diferente do Base — clique para voltar';
    modified.hidden = true;
    modified.addEventListener('click', () => this.setValue(spec.key, REAL_BASE_PARAMS[spec.key]));
    head.append(label, modified, defaultText);

    const input = el('input', 'cb-pregame__slider', `pregame-real-${spec.key}`);
    input.id = `pregame-real-input-${spec.key}`;
    label.htmlFor = input.id;
    input.type = 'range';
    input.min = String(spec.min);
    input.max = String(spec.max);
    input.step = String(spec.step);
    const note = el('p', 'cb-hint cb-real__note');
    note.id = `pregame-real-note-${spec.key}`;
    note.textContent = spec.note;
    input.setAttribute('aria-describedby', note.id);
    const output = el('output', 'cb-pregame__value', `pregame-real-${spec.key}-value`);
    input.addEventListener('input', () => this.setValue(spec.key, Number(input.value)));
    const line = el('div', 'cb-pregame__ctl-line');
    line.append(input, output);
    wrapper.append(head, line, note);
    this.views.push({ spec, wrapper, input, output, defaultText, modified });
    return wrapper;
  }

  private setValue(key: RealParamKey, value: number): void {
    this.write((r) => {
      const params = { ...r.params, [key]: value };
      return { ...r, params, presetId: matchingRealPreset(params) ?? 'custom' };
    });
  }

  /** Redraws from the setup (called by the Pregame after every change). */
  refresh(setup: MatchSetup): void {
    const real = setup.real ?? defaultRealSetup();
    this.state.textContent = real.enabled ? 'ligado' : 'desligado';
    this.state.classList.toggle('is-modified', real.enabled);
    this.enabledInput.checked = real.enabled;
    for (const [mode, node] of this.cameraButtons) {
      node.setAttribute('aria-checked', String(real.camera === mode));
      node.classList.toggle('is-selected', real.camera === mode);
    }
    const active = matchingRealPreset(real.params);
    for (const [id, node] of this.presetButtons) {
      node.setAttribute('aria-checked', String(active === id));
      node.classList.toggle('is-selected', active === id);
    }
    const preset = REAL_PRESETS.find((p) => p.id === active);
    this.presetText.textContent = preset ? `${preset.label}: ${preset.description}` : 'Personalizado: uma mistura sua; nenhum preset tem exatamente estes valores.';
    let changed = 0;
    for (const view of this.views) {
      const { spec } = view;
      const value = real.params[spec.key];
      const isModified = Math.round(value * 1e6) !== Math.round(REAL_BASE_PARAMS[spec.key] * 1e6);
      if (isModified) changed += 1;
      view.input.value = String(value);
      view.output.textContent = spec.format(value);
      view.defaultText.textContent = `base ${spec.format(REAL_BASE_PARAMS[spec.key])}`;
      view.modified.hidden = !isModified;
      view.wrapper.classList.toggle('is-modified', isModified);
      view.input.disabled = !real.enabled;
      view.wrapper.classList.toggle('is-disabled', !real.enabled);
    }
    this.deepCount.textContent = changed > 0 ? `${changed} alterado${changed === 1 ? '' : 's'}` : 'base';
    this.deepCount.classList.toggle('is-modified', changed > 0);
    this.resetButton.disabled = changed === 0;
  }

  /** True when the keyboard focus is inside this block (the Pregame leaves the arrows to the sliders then). */
  contains(node: Node | null): boolean {
    return node !== null && this.element.contains(node);
  }
}

let realStyleInjected = false;
function injectRealStyle(): void {
  if (realStyleInjected) return;
  realStyleInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .cb-real { display: flex; flex-direction: column; gap: 12px; }
    .cb-real > summary { margin-bottom: 0; }
    .cb-real[open] > summary { margin-bottom: 4px; }
    .cb-real__switch { display: flex; align-items: center; gap: 10px; font-size: 14px; cursor: pointer; }
    .cb-real__inherits { margin: 0; }
    .cb-real__block { display: flex; flex-direction: column; gap: 8px; }
    .cb-real__camera, .cb-real__presets { display: flex; flex-wrap: wrap; gap: 8px; }
    .cb-real__camera-option.is-selected, .cb-real__presets .is-selected { border-color: var(--cb-accent); color: #fff; background: rgba(255, 255, 255, 0.06); }
    .cb-real__deep { border: 1px solid var(--cb-line); border-radius: 6px; padding: 12px; display: flex; flex-direction: column; gap: 12px; }
    .cb-real__deep > summary { cursor: pointer; display: flex; align-items: center; gap: 10px; font-size: 12px; letter-spacing: 0.22em; text-transform: uppercase; color: var(--cb-text-dim); font-weight: 600; }
    .cb-real__deep[open] > summary { margin-bottom: 4px; }
    .cb-real__group { display: flex; flex-direction: column; gap: 14px; border-top: 1px solid var(--cb-line); padding-top: 12px; }
    .cb-real__ctl.is-disabled { opacity: 0.45; }
    .cb-real__note { display: block; margin: 0; }
    .cb-real__preset-text { margin: 0; }
  `;
  document.head.append(style);
}
