// ============================================================
// SETTINGS (M10, GDD 55/56)
// Graphics quality, camera effects, fullscreen, focus-loss pause, HUD
// hints and the developer overlay, plus the keyboard and gamepad controls.
// Opened from the Main Menu and from the Pause menu. Every change is saved
// and handed to `onChange` at once, so it applies live where it can.
// Keyboard: ↑/↓ row, ←/→ change, Esc back.
// ============================================================

import { CAMERA_PRESET_SETTINGS, QUALITY_PROFILES, DEFAULT_PLAYER_SETTINGS, toggleConditionLayer, type CameraPresetSetting, type ConditionLayerSetting, type ControlScheme, type GameFeelSettingKey, type PlayerSettings } from '../../config/settings/PlayerSettings';
import { presentationFeaturesFromLocation } from '../../presentation/features';
import { CAMERA_PRESET_NAMES, CAMERA_PRESET_NOTES } from '../../camera/director/CameraRig';
import { QualityPreset } from '../../config/runtime/QualityPreset';
import { GAMEPAD_BINDINGS, currentGamepads, readFirstGamepad } from '../../input/devices/gamepadMapping';
import { button, el, ensureFrontendStyle, keyHint, segmentedControl } from './frontendStyle';
import { isFullscreen, isFullscreenSupported, toggleFullscreen } from './fullscreen';
import { navigationIntent, wrapIndex } from './listNavigation';

export interface SettingsOptions {
  readonly settings: PlayerSettings;
  readonly onChange: (settings: PlayerSettings) => void;
  readonly onBack: () => void;
  /** Over a paused match (translucent) instead of a full page. */
  readonly overlay?: boolean;
}

const CONDITION_LAYER_LABELS: readonly (readonly [ConditionLayerSetting, string])[] = [
  ['A', 'A · Mechanical wear'],
  ['B', 'B · Spirit aura'],
  ['C', 'C · Floor instrument'],
];

type BooleanKey = 'cameraEffects' | 'pauseOnFocusLoss' | 'controlHints' | 'debugOverlayOnStart' | GameFeelSettingKey;

interface Row {
  readonly buttons: HTMLButtonElement[];
  refresh(settings: PlayerSettings): void;
  step(settings: PlayerSettings, delta: number): PlayerSettings;
}

const KEYBOARD_BINDINGS: readonly { readonly label: string; readonly keys: string }[] = [
  { label: 'Steer', keys: '← →' },
  { label: 'Forward / back', keys: '↑ ↓' },
  { label: 'Attack (hold to charge a Dash)', keys: 'Z' },
  { label: 'Hop / jump / drift', keys: 'X' },
  { label: 'Dodge', keys: 'C' },
  { label: 'Pause', keys: 'Esc' },
];

/** The control scheme's note and its two movement rows (action, keyboard, gamepad) in the controls table. */
const CONTROL_TEXT: Readonly<Record<ControlScheme, { readonly note: string; readonly rows: readonly (readonly [string, string, string])[] }>> = {
  opponent: {
    note: 'Default. ↑ moves toward your opponent, ↓ away from them, ← → circle around them. It only depends on where the Beys are — the camera never steers you.',
    rows: [['Move (toward / around the opponent)', '← → ↑ ↓', 'Left stick / D-pad']],
  },
  classic: {
    note: 'Kart-like: ← → steer the Bey, ↑ ↓ accelerate and brake/reverse along the way it\'s facing, regardless of the camera.',
    rows: [
      ['Steer', '← →', 'Left stick ← → / D-pad ← →'],
      ['Accelerate / brake', '↑ ↓', 'Left stick ↑ ↓ / D-pad ↑ ↓ / RT, LT'],
    ],
  },
  arena: {
    note: 'Fixed arena directions: ↑ always goes the same way in the arena, → the same way too, whichever way the camera is facing. The camera never steers you.',
    rows: [['Move (fixed arena directions)', '← → ↑ ↓', 'Left stick / D-pad']],
  },
  screen: {
    note: 'Screen-relative: ↑ goes up the screen. A new direction reads the camera at once, and a held direction follows the camera when it really turns, so the arrows keep meaning what you see.',
    rows: [['Move (up the screen)', '← → ↑ ↓', 'Left stick / D-pad']],
  },
};

const QUALITY_NOTES: Readonly<Record<QualityPreset, string>> = {
  [QualityPreset.Low]: 'Lowest resolution, no speed trails. For slow machines.',
  [QualityPreset.Medium]: 'Balanced resolution with every effect.',
  [QualityPreset.High]: 'Full resolution on high-density screens.',
};

export class SettingsScreen {
  private readonly root: HTMLElement;
  private readonly rows: Row[] = [];
  private readonly qualityNote = el('p', 'cb-hint', 'settings-quality-note');
  private readonly controlNote = el('p', 'cb-hint', 'settings-control-note');
  private readonly cameraNote = el('p', 'cb-hint', 'settings-camera-note');
  /** The first two rows of the controls table (movement), which depend on the control scheme. */
  private readonly movementRows: HTMLTableCellElement[][] = [];
  private readonly fullscreenButton: HTMLButtonElement;
  private readonly padStatus = el('p', 'cb-hint', 'settings-gamepad-status');
  private readonly padTimer: ReturnType<typeof setInterval>;
  private settings: PlayerSettings;
  private focusRow = 0;
  private closed = false;

  constructor(
    mount: HTMLElement,
    private readonly options: SettingsOptions,
  ) {
    ensureFrontendStyle();
    injectSettingsStyle();
    this.settings = options.settings;
    this.root = el('div', `cb-screen cb-settings ${options.overlay ? 'cb-settings--overlay' : 'cb-screen--opaque'}`, 'settings');
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Settings');

    const panel = el('section', 'cb-panel cb-settings__panel');
    const eyebrow = el('p', 'cb-eyebrow');
    eyebrow.textContent = 'Options';
    const title = el('h1', 'cb-title');
    title.textContent = 'Settings';

    const graphics = this.section('Graphics');
    graphics.append(
      this.choiceRow<QualityPreset>('quality', 'Quality', [QualityPreset.Low, QualityPreset.Medium, QualityPreset.High].map((q) => ({ value: q, label: q })), (s) => s.quality, (s, v) => ({ ...s, quality: v })),
      this.qualityNote,
      this.choiceRow<CameraPresetSetting>(
        'camera',
        'Camera',
        CAMERA_PRESET_SETTINGS.map((id) => ({ value: id, label: CAMERA_PRESET_NAMES[id] })),
        (s) => s.cameraPreset,
        (s, v) => ({ ...s, cameraPreset: v }),
      ),
      this.cameraNote,
      this.toggleRow('camera-effects', 'Camera shake & zoom', 'cameraEffects'),
    );
    this.fullscreenButton = button('Fullscreen', '', 'settings-fullscreen', () => void toggleFullscreen().then(() => this.refresh()));
    this.fullscreenButton.disabled = !isFullscreenSupported();
    const fullscreenRow = el('div', 'cb-settings__row');
    const fullscreenLabel = el('span', 'cb-field-label');
    fullscreenLabel.textContent = 'Display';
    fullscreenRow.append(fullscreenLabel, this.fullscreenButton);
    graphics.append(fullscreenRow);

    const play = this.section('Play');
    play.append(
      // Owner, 2026-10-04: Screen (reads camera) is the one control scheme; no selector.
      this.controlNote,
      this.toggleRow('pause-on-focus-loss', 'Pause when the window loses focus', 'pauseOnFocusLoss'),
      this.toggleRow('control-hints', 'Control hints on the HUD', 'controlHints'),
      this.toggleRow('debug-overlay', 'Developer overlay (F3) on start', 'debugOverlayOnStart'),
    );

    // Condition languages (A / B / C): shown while the conditionVisuals presentation flag is on, which it is in the normal game;
    // an explicit ?pfx allowlist without it hides the section (the pre-0.16 Settings screen).
    let condition: HTMLElement | null = null;
    if (presentationFeaturesFromLocation().conditionVisuals) {
      condition = this.section('Condition (Stamina, Stability, Broken)');
      for (const [id, label] of CONDITION_LAYER_LABELS) {
        condition.append(
          this.choiceRow<boolean>(
            `condition-${id.toLowerCase()}`,
            label,
            [{ value: true, label: 'On' }, { value: false, label: 'Off' }],
            (s) => s.conditionLayers.includes(id),
            (s, v) => ({ ...s, conditionLayers: toggleConditionLayer(s.conditionLayers, id, v) }),
          ),
        );
      }
      const note = el('p', 'cb-hint', 'settings-condition-note');
      note.textContent = 'Pick any combination; at least one stays on. The spin slowing and the blur are always shown.';
      condition.append(note);
    }

    // Owner, 2026-10-05: impact and readability feedback, each with its own switch (presentation only).
    const feel = this.section('Game feel');
    feel.append(
      this.toggleRow('counter-feedback', 'Counter hit burst ("COUNTER!")', 'counterFeedback'),
      this.toggleRow('hit-flash', 'Hit flash on the Bey that is hit', 'hitFlash'),
      this.toggleRow('hit-shake', 'Hit shake during the impact freeze', 'hitShake'),
      this.toggleRow('ring-out-warning', 'Ring-out warning (red screen edges)', 'ringOutWarning'),
      this.toggleRow('refused-input', 'Refused press feedback on the HUD', 'refusedInputFeedback'),
    );

    const controls = this.section('Controls');
    const table = el('table', 'cb-settings__controls', 'settings-controls');
    const head = el('tr');
    for (const text of ['Action', 'Keyboard', 'Gamepad']) {
      const th = el('th');
      th.textContent = text;
      head.append(th);
    }
    table.append(head);
    KEYBOARD_BINDINGS.forEach((binding, i) => {
      const tr = el('tr');
      const pad = GAMEPAD_BINDINGS[i]!;
      const cells: HTMLTableCellElement[] = [];
      for (const text of [binding.label, binding.keys, pad.buttons]) {
        const td = el('td');
        td.textContent = text;
        tr.append(td);
        cells.push(td);
      }
      if (i < 2) this.movementRows.push(cells);
      table.append(tr);
    });
    controls.append(table, this.padStatus);

    const footer = el('div', 'cb-footer');
    const hints = el('div', 'cb-footer__hints');
    hints.append(keyHint(['↑', '↓'], 'Row'), keyHint(['←', '→'], 'Change'), keyHint(['Esc'], 'Back'));
    footer.append(
      hints,
      button('Reset to defaults', '', 'settings-reset', () => this.change(DEFAULT_PLAYER_SETTINGS)),
      button('Back', 'cb-button--primary', 'settings-back', () => this.back()),
    );

    const body = el('div', 'cb-settings__body');
    // The condition section sits between Play and Controls, in the same order as its rows in the keyboard navigation.
    body.append(...(condition ? [graphics, play, condition, feel, controls] : [graphics, play, feel, controls]));
    panel.append(eyebrow, title, body, footer);
    this.root.append(panel);
    mount.append(this.root);

    this.refresh();
    this.rows[0]?.buttons.find((b) => b.getAttribute('aria-checked') === 'true')?.focus();
    window.addEventListener('keydown', this.handleKey);
    document.addEventListener('fullscreenchange', this.refreshFullscreen);
    this.padTimer = setInterval(() => this.refreshPadStatus(), 1000);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    window.removeEventListener('keydown', this.handleKey);
    document.removeEventListener('fullscreenchange', this.refreshFullscreen);
    clearInterval(this.padTimer);
    this.root.remove();
  }

  private section(title: string): HTMLElement {
    const section = el('section', 'cb-settings__section');
    const heading = el('h2', 'cb-settings__heading');
    heading.textContent = title;
    section.append(heading);
    return section;
  }

  private choiceRow<T>(id: string, label: string, choices: readonly { value: T; label: string }[], read: (s: PlayerSettings) => T, write: (s: PlayerSettings, v: T) => PlayerSettings): HTMLElement {
    const wrapper = el('div', 'cb-settings__row');
    const labelNode = el('span', 'cb-field-label');
    labelNode.id = `settings-label-${id}`;
    labelNode.textContent = label;
    const rowIndex = this.rows.length;
    const control = segmentedControl<T>(`settings-${id}`, labelNode.id, choices, (value) => {
      this.focusRow = rowIndex;
      this.change(write(this.settings, value));
    });
    this.rows.push({
      buttons: control.buttons,
      refresh: (s) => control.refresh(read(s)),
      step: (s, delta) => {
        const index = choices.findIndex((c) => c.value === read(s));
        return write(s, choices[wrapIndex(index, delta, choices.length)]!.value);
      },
    });
    wrapper.append(labelNode, control.group);
    return wrapper;
  }

  private toggleRow(id: string, label: string, key: BooleanKey): HTMLElement {
    return this.choiceRow<boolean>(id, label, [{ value: true, label: 'On' }, { value: false, label: 'Off' }], (s) => s[key], (s, v) => ({ ...s, [key]: v }));
  }

  private change(next: PlayerSettings): void {
    this.settings = next;
    this.refresh();
    this.options.onChange(next);
  }

  private refresh(): void {
    for (const row of this.rows) row.refresh(this.settings);
    const profile = QUALITY_PROFILES[this.settings.quality];
    this.qualityNote.textContent = `${QUALITY_NOTES[this.settings.quality]} (pixel ratio up to ${profile.maxPixelRatio}, speed trails ${profile.trails ? 'on' : 'off'})`;
    this.cameraNote.textContent = `${CAMERA_PRESET_NOTES[this.settings.cameraPreset]} Clashes always use Cinematic Hybrid.`;
    const scheme = CONTROL_TEXT[this.settings.controlScheme];
    this.controlNote.textContent = scheme.note;
    this.movementRows.forEach((cells, i) => {
      const texts = scheme.rows[i];
      cells[0]!.parentElement!.hidden = !texts;
      texts?.forEach((text, j) => (cells[j]!.textContent = text));
    });
    this.refreshFullscreen();
    this.refreshPadStatus();
  }

  private readonly refreshFullscreen = (): void => {
    this.fullscreenButton.textContent = !isFullscreenSupported() ? 'Fullscreen unavailable' : isFullscreen() ? 'Exit fullscreen' : 'Enter fullscreen';
  };

  private refreshPadStatus(): void {
    const pad = readFirstGamepad(currentGamepads());
    this.padStatus.textContent = pad ? `Gamepad connected: ${pad.id}` : 'No gamepad detected. Connect one and press any button.';
  }

  private back(): void {
    if (!this.closed) this.options.onBack();
  }

  private readonly handleKey = (event: KeyboardEvent): void => {
    const intent = navigationIntent(event.code);
    if (!intent) return;
    if (intent === 'confirm' && event.target instanceof HTMLButtonElement && !event.target.classList.contains('cb-segment')) return; // Enter on Fullscreen/Reset/Back clicks it.
    event.preventDefault();
    const focusChecked = (): void => this.rows[this.focusRow]?.buttons.find((b) => b.getAttribute('aria-checked') === 'true')?.focus();
    switch (intent) {
      case 'previous':
        this.focusRow = wrapIndex(this.focusRow, -1, this.rows.length);
        focusChecked();
        break;
      case 'next':
        this.focusRow = wrapIndex(this.focusRow, 1, this.rows.length);
        focusChecked();
        break;
      case 'decrease':
      case 'increase':
        this.change(this.rows[this.focusRow]!.step(this.settings, intent === 'decrease' ? -1 : 1));
        focusChecked();
        break;
      case 'back':
        this.back();
        break;
      case 'confirm':
        break;
    }
  };
}

let settingsStyleInjected = false;
function injectSettingsStyle(): void {
  if (settingsStyleInjected) return;
  settingsStyleInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .cb-settings { display: flex; justify-content: center; align-items: flex-start; padding: 28px 16px; box-sizing: border-box; overflow-y: auto; }
    .cb-settings--overlay { background: rgba(4, 5, 9, 0.8); z-index: 1200; }
    .cb-settings__panel { width: min(720px, 100%); box-sizing: border-box; display: flex; flex-direction: column; gap: 14px; }
    .cb-settings__body { display: flex; flex-direction: column; gap: 18px; }
    .cb-settings__panel > .cb-footer { position: sticky; bottom: -16px; margin: 0 -16px -16px; padding: 12px 16px 16px; background: var(--cb-panel-solid); border-top: 1px solid var(--cb-line); border-radius: 0 0 6px 6px; }
    .cb-settings__section { display: flex; flex-direction: column; gap: 10px; }
    .cb-settings__heading { margin: 0; font-size: 13px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--cb-accent); font-weight: 600; border-bottom: 1px solid var(--cb-line); padding-bottom: 6px; }
    .cb-settings__row { display: grid; grid-template-columns: minmax(160px, 1fr) minmax(0, 1.4fr); gap: 12px; align-items: center; }
    .cb-settings__row .cb-field-label { letter-spacing: 0.08em; text-transform: none; font-size: 14px; color: var(--cb-text); }
    .cb-settings__controls { border-collapse: collapse; font-size: 13px; width: 100%; }
    .cb-settings__controls th { text-align: left; color: var(--cb-text-dim); font-weight: 600; font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; padding: 4px 8px 6px 0; }
    .cb-settings__controls td { padding: 5px 8px 5px 0; border-top: 1px solid var(--cb-line); }
    .cb-settings__controls td:nth-child(2), .cb-settings__controls td:nth-child(3) { font-family: var(--cb-mono); color: var(--cb-text-dim); }
    @media (max-width: 640px) { .cb-settings__row { grid-template-columns: 1fr; gap: 6px; } .cb-footer__hints { display: none; } }
  `;
  document.head.append(style);
}
