// ============================================================
// LAUNCH HUD — the Timing Snap meter and what the player is asked to do (Launch System A)
// The approved prototype's launch panel, in the game's own HUD language: the entry point readout, the TIMING meter with the
// ideal window and the moving marker, the LAUNCH button, and the round-start label (ROUND START → TARGET · TIME YOUR LAUNCH →
// LAUNCH → ENTRY). After the release the grade of the launch (PERFECT / STRONG / CLEAN / WEAK) shows for a moment, with the
// prototype's speed lines and flash. The numbers shown are the sequence's; nothing here decides anything (design doc §8: the
// prototype's readouts are tuning instrumentation, not final HUD or balance — only the grade word is kept).
// ============================================================

import { LAUNCH_TUNING, launchGrade, type LaunchGrade } from '../../launch/LaunchTuning';
import type { LaunchView } from '../../launch/LaunchSequence';
import { currentGamepads, readFirstGamepad } from '../../input/devices/gamepadMapping';
import { el, ensureFrontendStyle } from './frontendStyle';

export interface LaunchHudOptions {
  /** The side's accent (CSS color), for the meter's marker and the target text. */
  readonly accentCss: string;
  /** A person pressed the on-screen LAUNCH button. */
  readonly onLaunch: () => void;
  /** The entry point was put back on the default (the Center button). */
  readonly onCenter: () => void;
}

const GRADE_SHOW_S = 1.4;
const FLASH_DECAY_PER_S = 9;

const PHASE_LABEL: Record<LaunchView['phase'], string> = {
  mounted: 'ROUND START',
  armed: 'TARGET · TIME YOUR LAUNCH',
  release: 'LAUNCH',
  flight: 'ENTRY',
  landed: 'COMBAT',
};

let styleInjected = false;

export class LaunchHud {
  private readonly root = el('div', 'cb-launch', 'launch-hud');
  private readonly label = el('div', 'cb-launch__label', 'launch-phase');
  private readonly grade = el('div', 'cb-launch__grade', 'launch-grade');
  private readonly panel = el('div', 'cb-launch__panel', 'launch-panel');
  private readonly point = el('div', 'cb-launch__point', 'launch-point');
  private readonly meter = el('div', 'cb-launch__meter', 'launch-meter');
  private readonly window = el('div', 'cb-launch__window');
  private readonly marker = el('div', 'cb-launch__marker', 'launch-marker');
  private readonly button = el('button', 'cb-button cb-button--primary cb-launch__button', 'launch-button') as HTMLButtonElement;
  private readonly center = el('button', 'cb-button cb-launch__center', 'launch-center') as HTMLButtonElement;
  private readonly hint = el('div', 'cb-launch__hint', 'launch-hint');
  private readonly speedLines = el('div', 'cb-launch__speed', 'launch-speedlines');
  private readonly flashLayer = el('div', 'cb-launch__flash', 'launch-flash');
  private gradeLeftS = 0;
  private flash = 0;
  private lastPhase: LaunchView['phase'] | null = null;
  private hintKey = '';

  constructor(mount: HTMLElement, options: LaunchHudOptions) {
    ensureFrontendStyle();
    injectLaunchStyle();
    this.root.style.setProperty('--launch-accent', options.accentCss);
    const pointLabel = el('span', 'cb-launch__caption');
    pointLabel.textContent = 'ENTRY POINT';
    const timingCaption = el('div', 'cb-launch__caption cb-launch__caption--row');
    const timingLeft = el('span');
    timingLeft.textContent = 'TIMING';
    const timingRight = el('span');
    timingRight.textContent = 'IDEAL WINDOW';
    timingCaption.append(timingLeft, timingRight);
    // The ideal window: where a press is worth most (the sweet spot ± a quarter of the whole window).
    const half = LAUNCH_TUNING.markerWindowHalfWidth * 0.25;
    this.window.style.left = `${(LAUNCH_TUNING.markerSweetSpot - half) * 100}%`;
    this.window.style.width = `${half * 2 * 100}%`;
    this.meter.append(this.window, this.marker);
    this.center.type = 'button';
    this.center.textContent = 'Center';
    this.center.addEventListener('click', () => options.onCenter());
    const pointRow = el('div', 'cb-launch__row');
    pointRow.append(pointLabel, this.point, this.center);
    this.button.type = 'button';
    this.button.textContent = 'LAUNCH';
    this.button.addEventListener('click', () => options.onLaunch());
    const left = el('div', 'cb-launch__left');
    left.append(pointRow, timingCaption, this.meter, this.hint);
    this.panel.append(left, this.button);
    this.root.append(this.speedLines, this.flashLayer, this.label, this.grade, this.panel);
    mount.append(this.root);
    this.update(0, null);
  }

  /** Once per rendered frame; `view` is null before the sequence exists. */
  update(dt: number, view: LaunchView | null): void {
    if (this.flash > 0.002) {
      this.flash *= Math.exp(-FLASH_DECAY_PER_S * dt);
      this.flashLayer.style.opacity = this.flash.toFixed(3);
    } else this.flashLayer.style.opacity = '0';
    if (this.gradeLeftS > 0) {
      this.gradeLeftS = Math.max(0, this.gradeLeftS - dt);
      this.grade.style.opacity = Math.min(1, this.gradeLeftS * 2).toFixed(3);
      if (this.gradeLeftS === 0) this.grade.hidden = true;
    }
    if (!view) return;
    this.label.textContent = PHASE_LABEL[view.phase];
    this.label.dataset['phase'] = view.phase;
    // Once the Beys have landed the fight's own banner (ROUND N · FIGHT!) takes the screen; the launch's label has said its last word.
    this.label.hidden = view.phase === 'landed';
    const prelaunch = view.phase === 'mounted' || view.phase === 'armed';
    this.panel.hidden = !prelaunch;
    this.speedLines.classList.toggle('is-on', view.phase === 'release' || view.phase === 'flight');
    if (prelaunch) {
      const t = view.targets.first;
      this.point.textContent = `X ${t.x.toFixed(1)} · Z ${t.z.toFixed(1)}`;
      this.marker.style.left = `${view.marker * 100}%`;
      this.marker.classList.toggle('is-ideal', Math.abs(view.marker - LAUNCH_TUNING.markerSweetSpot) <= LAUNCH_TUNING.markerWindowHalfWidth * 0.25);
      this.button.disabled = view.phase !== 'armed';
      this.refreshHint();
    }
    if (view.phase !== this.lastPhase) {
      if (view.phase === 'release') this.showRelease(view);
      this.lastPhase = view.phase;
    }
  }

  private showRelease(view: LaunchView): void {
    const quality = view.qualities.first ?? 0;
    const grade: LaunchGrade = view.grade ?? launchGrade(quality);
    this.grade.textContent = grade;
    this.grade.dataset['grade'] = grade;
    this.grade.hidden = false;
    this.grade.style.opacity = '1';
    this.gradeLeftS = GRADE_SHOW_S;
    this.flash = quality > LAUNCH_TUNING.gradePerfectAt ? 0.9 : 0.25;
  }

  private refreshHint(): void {
    const pad = readFirstGamepad(currentGamepads()) !== null;
    const key = String(pad);
    if (key === this.hintKey) return;
    this.hintKey = key;
    const items = pad
      ? [['Stick', 'move the entry point'], ['A / X', 'launch']]
      : [['← → ↑ ↓', 'move the entry point'], ['Z / X', 'launch'], ['click', 'place it on the arena']];
    this.hint.replaceChildren(
      ...items.map(([k, meaning]) => {
        const item = el('span', 'cb-launch__hintitem');
        const cap = el('span', 'cb-key');
        cap.textContent = k!;
        item.append(cap, document.createTextNode(` ${meaning}`));
        return item;
      }),
    );
  }

  dispose(): void {
    this.root.remove();
  }
}

function injectLaunchStyle(): void {
  if (styleInjected) return;
  styleInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .cb-launch { position: fixed; inset: 0; pointer-events: none; font: 13px/1.3 var(--cb-font); color: var(--cb-text); z-index: 1060; --launch-accent: var(--cb-accent); }
    .cb-launch__label { position: absolute; top: 118px; left: 50%; transform: translateX(-50%); font: 800 clamp(16px, 2.4vw, 30px)/1 var(--cb-mono); letter-spacing: 0.18em; color: #fff; text-shadow: 0 0 18px rgba(110, 231, 255, 0.55); white-space: nowrap; }
    .cb-launch__label[hidden] { display: none; }
    .cb-launch__grade { position: absolute; top: 40%; left: 50%; transform: translate(-50%, -50%); font: 900 clamp(36px, 6vw, 72px)/1 var(--cb-mono); letter-spacing: 0.22em; text-shadow: 0 0 26px currentColor; }
    .cb-launch__grade[hidden] { display: none; }
    .cb-launch__grade[data-grade="PERFECT"] { color: #7be4ff; }
    .cb-launch__grade[data-grade="STRONG"] { color: #7dffa8; }
    .cb-launch__grade[data-grade="CLEAN"] { color: #ffe066; }
    .cb-launch__grade[data-grade="WEAK"] { color: #ff9f6b; }
    .cb-launch__panel { position: absolute; left: 50%; bottom: 26px; transform: translateX(-50%); display: flex; gap: 14px; align-items: stretch; width: min(640px, calc(100vw - 28px)); padding: 12px 14px; background: rgba(8, 10, 16, 0.82); border: 1px solid var(--cb-line); border-top: 3px solid var(--launch-accent); border-radius: 6px; pointer-events: auto; backdrop-filter: blur(3px); }
    .cb-launch__panel[hidden] { display: none; }
    .cb-launch__left { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
    .cb-launch__row { display: flex; align-items: center; gap: 10px; }
    .cb-launch__caption { font: 600 11px/1 var(--cb-mono); letter-spacing: 0.14em; color: var(--cb-text-dim); }
    .cb-launch__caption--row { display: flex; justify-content: space-between; }
    .cb-launch__point { flex: 1; text-align: right; font: 700 13px/1 var(--cb-mono); color: var(--launch-accent); }
    .cb-launch__center { padding: 6px 12px; font-size: 12px; }
    .cb-launch__meter { position: relative; height: 16px; background: rgba(255, 255, 255, 0.08); border: 1px solid var(--cb-line-strong); border-radius: 4px; overflow: hidden; }
    .cb-launch__window { position: absolute; top: 0; bottom: 0; background: rgba(125, 255, 168, 0.32); border-left: 1px solid rgba(125, 255, 168, 0.8); border-right: 1px solid rgba(125, 255, 168, 0.8); }
    .cb-launch__marker { position: absolute; top: -1px; bottom: -1px; width: 4px; margin-left: -2px; background: #fff; box-shadow: 0 0 8px #fff; border-radius: 2px; }
    .cb-launch__marker.is-ideal { background: #7dffa8; box-shadow: 0 0 12px #7dffa8; }
    .cb-launch__hint { display: flex; gap: 14px; flex-wrap: wrap; font-size: 12px; color: var(--cb-text-dim); }
    .cb-launch__button { min-width: 120px; font-size: 16px; letter-spacing: 0.2em; }
    .cb-launch__speed { position: absolute; inset: 0; opacity: 0; transition: opacity 120ms linear; background: repeating-conic-gradient(from 0deg at 50% 52%, rgba(255, 255, 255, 0.16) 0deg 0.5deg, transparent 0.5deg 5deg); -webkit-mask-image: radial-gradient(circle at 50% 52%, transparent 18%, #000 70%); mask-image: radial-gradient(circle at 50% 52%, transparent 18%, #000 70%); }
    .cb-launch__speed.is-on { opacity: 0.8; }
    .cb-launch__flash { position: absolute; inset: 0; background: #fff; opacity: 0; mix-blend-mode: screen; }
  `;
  document.head.append(style);
}
