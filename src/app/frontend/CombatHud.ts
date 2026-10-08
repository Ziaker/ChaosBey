// ============================================================
// COMBAT HUD (M10, GDD 50/56)
// The player's HUD over a running round:
// - a card per side: Stamina, Stability (red and tagged BROKEN when
//   broken), the Dash cooldown (CD: empties when a Dash is used, refills
//   during the cooldown, full = ready; owner 2026-10-02, it was the Attack
//   Energy line), and the player's Dash charge while charging;
// - the round and the score pips (first to N);
// - short banners: "ROUND n / FIGHT" at the start, "RING OUT!" / "K.O.!" /
//   "DRAW" at the end (never at a Clash resolution: the approved Clash has
//   no banner);
// - the approved Clash tug-of-war bar (clash-presentation-approval.md 3.5):
//   between the two Beys on screen, one half per Bey in its color, following
//   the live ClashPower, no text;
// - control hints (Settings), for the keyboard or the connected pad.
// Render-only: reads the session after each frame, never writes to it.
// The combat HUD has no approved final visual yet; this is the M10
// owner-authorized pass in the shared frontend style.
// ============================================================

import * as THREE from 'three';
import type { MatchSession } from '../session/MatchSession';
import { Action } from '../../input/actions/Action';
import { ClashState } from '../../combat/clash/ClashController';
import { computeClashPower } from '../../combat/clash/ClashFormula';
import { currentGamepads, readFirstGamepad } from '../../input/devices/gamepadMapping';
import { el, ensureFrontendStyle } from './frontendStyle';
import { UP_CUE_S, clashBarShare, followClashBar, hudSide, stepUpCue, type HudSide } from './hudModel';
import { arenaFloorRadius } from '../../arena/colliders/ArenaTuning';
import { isOutOfArena } from '../../arena/ringout/RingOut';

export interface CombatHudOptions {
  readonly player: { readonly label: string; readonly accentCss: string };
  readonly opponent: { readonly label: string; readonly accentCss: string; readonly subtitle: string };
  readonly roundNumber: number;
  readonly score: { readonly player: number; readonly opponent: number };
  readonly roundsToWin: number;
  readonly controlHints: boolean;
  /** Owner, 2026-10-05 (game feel): the HUD's own switches. Absent = all on. */
  readonly feel?: HudFeelOptions;
}

export interface HudFeelOptions {
  /** "COUNTER!" over a Circular that catches a Dash. */
  readonly counterFeedback: boolean;
  /** Red screen edges while the player's Bey is near the ring-out line or flying out. */
  readonly ringOutWarning: boolean;
  /** A refused Dodge / Attack press flashes and shakes its HUD line. */
  readonly refusedInputFeedback: boolean;
}

const ALL_FEEL_ON: HudFeelOptions = { counterFeedback: true, ringOutWarning: true, refusedInputFeedback: true };
/** Seconds the "COUNTER!" word floats. */
const COUNTER_WORD_S = 0.9;

/** How long the round-start banner stays up. */
const START_BANNER_MS = 1300;

/** How long the Clash bar stays on the real result after the Clash resolves. */
const CLASH_BAR_HOLD_S = 0.45;

interface CardParts {
  readonly root: HTMLElement;
  readonly stamina: HTMLElement;
  readonly stability: HTMLElement;
  readonly dashCooldown: HTMLElement;
  readonly dodgeCooldown: HTMLElement;
  readonly momentum: HTMLElement;
  readonly dash: HTMLElement | null;
  readonly tag: HTMLElement;
}

export class CombatHud {
  private readonly root = el('div', 'cb-hud', 'combat-hud');
  private readonly cards: { readonly first: CardParts; readonly second: CardParts };
  private readonly banner = el('div', 'cb-hud__banner', 'hud-banner');
  private readonly hints = el('div', 'cb-hud__hints', 'hud-hints');
  /** Owner polish, 2026-10-07 (idea 6): at the start of a round, a short cue of what the arrows mean (Screen control: ↑ goes up the screen, away from the camera). */
  private readonly upCue = el('div', 'cb-hud__upcue', 'hud-up-cue');
  private upCueLeftS = UP_CUE_S;
  /**
   * Temporary functional indicator (owner playtest, after M11): "DRIFT"
   * while the player's Bey is Drifting, "GRIP" while grip comes back — so a
   * playtest can tell "the drift never started" from "it started and I
   * didn't feel it". Not the final HUD.
   */
  private readonly driftTag = el('div', 'cb-hud__drift', 'hud-drift');
  /** Owner, 2026-10-04: thrown into the air with Air Recovery open — just the button to press, over the player's Bey. */
  private readonly recoverAlert = el('div', 'cb-hud__recover', 'hud-recover');
  private readonly breakFlash = el('div', 'cb-hud__break', 'hud-break');
  /** Owner, 2026-10-05: red screen edges, opacity = ring-out danger (0..1). */
  private readonly ringOutVignette = el('div', 'cb-hud__ringout', 'hud-ringout');
  private readonly counterWord = el('div', 'cb-hud__counter', 'hud-counter');
  private counterAt: { x: number; y: number; z: number } | null = null;
  private counterLeftS = 0;
  private feel: HudFeelOptions;
  private readonly clashBar = el('div', 'cb-hud__clash', 'hud-clash-bar');
  private readonly clashFirst = el('div', 'cb-hud__clash-half cb-hud__clash-half--first');
  private readonly clashSecond = el('div', 'cb-hud__clash-half cb-hud__clash-half--second');
  private bannerTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly projected = new THREE.Vector3();
  private clashActive = false;
  private previousDriftState = '';
  private driftLost = false;
  private clashShare = 0.5;
  private clashFirstOnLeft = true;
  private clashHoldS = 0;
  /** The hints shown: pad or keyboard, and whether the match has the Circular. Null = rebuild. */
  private hintsKey: string | null = null;
  /** Owner, 2026-10-05: false when the match has no Circular ("Ataque giratório: desligado"). */
  private hintsCircular = true;
  private hintsOn: boolean;

  constructor(
    mount: HTMLElement,
    private readonly options: CombatHudOptions,
  ) {
    ensureFrontendStyle();
    injectHudStyle();
    this.cards = {
      first: this.card('first', 'YOU', options.player.label, options.player.accentCss, true),
      second: this.card('second', 'CPU', `${options.opponent.label} · ${options.opponent.subtitle}`, options.opponent.accentCss, false),
    };

    const center = el('div', 'cb-hud__center', 'hud-round');
    const round = el('div', 'cb-hud__round');
    round.textContent = `ROUND ${options.roundNumber}`;
    const pips = el('div', 'cb-hud__pips');
    pips.append(this.pips(options.score.player, options.roundsToWin, options.player.accentCss, 'player'), el('span', 'cb-hud__pips-sep'), this.pips(options.score.opponent, options.roundsToWin, options.opponent.accentCss, 'opponent'));
    center.append(round, pips);

    this.clashFirst.style.setProperty('--half', options.player.accentCss);
    this.clashSecond.style.setProperty('--half', options.opponent.accentCss);
    this.clashBar.append(this.clashFirst, this.clashSecond);
    this.clashBar.hidden = true;

    this.feel = options.feel ?? ALL_FEEL_ON;
    this.counterWord.textContent = 'COUNTER!';
    this.hintsOn = options.controlHints;
    this.hints.hidden = !options.controlHints;
    this.upCue.textContent = '▲ UP THE SCREEN';
    this.upCue.hidden = !options.controlHints;
    this.root.append(this.cards.first.root, center, this.cards.second.root, this.clashBar, this.banner, this.hints, this.upCue, this.driftTag, this.recoverAlert, this.breakFlash, this.ringOutVignette, this.counterWord);
    mount.append(this.root);
    this.refreshHints();
    this.showBanner(`ROUND ${options.roundNumber}`, 'FIGHT!', START_BANNER_MS);
  }

  /** Call after each rendered frame. */
  update(session: MatchSession, camera: THREE.PerspectiveCamera, frameDeltaSeconds: number): void {
    this.updateUpCue(session, frameDeltaSeconds);
    const result = session.getLastResult();
    if (result) {
      this.fillCard(this.cards.first, hudSide(result.first));
      this.fillCard(this.cards.second, hudSide(result.second));
      const drift = result.first.driftState;
      // A drift that ends while X is still held was broken (a wall, a hit), not released: "DRIFT LOST" for the grip recovery.
      if (this.previousDriftState === 'Drifting' && drift === 'Recovering') this.driftLost = session.getLastActions('first')?.held.has(Action.JumpDrift) ?? false;
      else if (drift !== 'Recovering') this.driftLost = false;
      this.previousDriftState = drift;
      this.driftTag.dataset['state'] = drift;
      this.driftTag.textContent = drift === 'Drifting' ? 'DRIFT' : drift === 'Recovering' ? (this.driftLost ? 'DRIFT LOST' : 'GRIP') : '';
      this.driftTag.classList.toggle('is-drifting', drift === 'Drifting');
      this.driftTag.classList.toggle('is-recovering', drift === 'Recovering');
      this.driftTag.classList.toggle('is-lost', drift === 'Recovering' && this.driftLost);
    }
    this.updateClashBar(session, camera, frameDeltaSeconds);
    this.updateRecoverAlert(session, camera);
    this.fillDodge(this.cards.first, session.getBey('first').dodge.getReadiness());
    this.fillDodge(this.cards.second, session.getBey('second').dodge.getReadiness());
    this.consumeFeedback(session);
    this.updateCounterWord(camera, frameDeltaSeconds);
    this.updateRingOutWarning(session);
    this.hintsCircular = session.getBey('first').attack.isCircularEnabled();
    if (this.hintsOn) this.refreshHints();
  }

  /** Owner, 2026-10-05: the HUD's game-feel switches, live from Settings. */
  setFeel(feel: HudFeelOptions): void {
    this.feel = feel;
    if (!feel.ringOutWarning) this.ringOutVignette.style.opacity = '0';
    if (!feel.counterFeedback) {
      this.counterLeftS = 0;
      this.counterWord.classList.remove('is-on');
    }
  }

  private consumeFeedback(session: MatchSession): void {
    for (const event of session.drainHudFeedback()) {
      if (event.kind === 'counter' && this.feel.counterFeedback) {
        this.counterAt = event.position;
        this.counterLeftS = COUNTER_WORD_S;
        this.counterWord.classList.remove('is-on');
        void this.counterWord.offsetWidth; // restart the animation
        this.counterWord.classList.add('is-on');
      } else if (event.kind === 'refused' && this.feel.refusedInputFeedback) {
        const fill = event.action === 'dodge' ? this.cards.first.dodgeCooldown : this.cards.first.dashCooldown;
        const row = fill.parentElement!.parentElement!;
        row.classList.remove('is-refused');
        void row.offsetWidth; // restart the animation
        row.classList.add('is-refused');
        row.addEventListener('animationend', () => row.classList.remove('is-refused'), { once: true });
      }
    }
  }

  private updateCounterWord(camera: THREE.PerspectiveCamera, dt: number): void {
    this.counterLeftS = Math.max(0, this.counterLeftS - dt);
    if (this.counterLeftS <= 0 || !this.counterAt) {
      this.counterWord.classList.remove('is-on');
      return;
    }
    const rise = (1 - this.counterLeftS / COUNTER_WORD_S) * 0.8;
    const ndc = this.projected.set(this.counterAt.x, this.counterAt.y + 1.4 + rise, this.counterAt.z).project(camera);
    this.counterWord.style.left = `${((ndc.x + 1) / 2) * 100}%`;
    this.counterWord.style.top = `${((1 - ndc.y) / 2) * 100}%`;
  }

  /**
   * Owner, 2026-10-05: red screen edges for the player's Bey (first). Full while it is outside the ring-out line
   * (the ring-out clock is running); up to full while it flies outward in the outer part of the stage; a faint glow
   * on the ground right at the wall. Presentation only.
   */
  private updateRingOutWarning(session: MatchSession): void {
    if (!this.feel.ringOutWarning) return;
    const bey = session.getBey('first');
    // Out over the wall on a rail is the ride, not a danger (the ring-out clock does not run there).
    if (bey.rail.isOnRail()) {
      this.ringOutVignette.style.opacity = '0';
      return;
    }
    this.ringOutVignette.style.opacity = ringOutDanger(bey.body.translation(), bey.body.linvel(), session.getLastResult()?.first.grounded ?? true, isOutOfArena(bey.body.translation(), bey.arenaFloor)).toFixed(3);
  }

  /** Owner, 2026-10-04: the defeat cutscene's break — a white flash and one big word. */
  flashBreak(word: string): void {
    this.breakFlash.textContent = word;
    this.breakFlash.classList.remove('is-on');
    void this.breakFlash.offsetWidth; // restart the animation
    this.breakFlash.classList.add('is-on');
  }

  /** A big centred banner, e.g. "RING OUT!" at the end of the round. `durationMs` null = until disposed. */
  showBanner(title: string, subtitle = '', durationMs: number | null = null): void {
    if (this.bannerTimer !== null) clearTimeout(this.bannerTimer);
    this.banner.replaceChildren();
    const main = el('div', 'cb-hud__banner-title');
    main.textContent = title;
    this.banner.append(main);
    if (subtitle) {
      const sub = el('div', 'cb-hud__banner-sub');
      sub.textContent = subtitle;
      this.banner.append(sub);
    }
    this.banner.classList.remove('is-shown');
    void this.banner.offsetWidth; // restart the animation
    this.banner.classList.add('is-shown');
    this.bannerTimer = durationMs === null ? null : setTimeout(() => this.banner.classList.remove('is-shown'), durationMs);
  }

  setControlHints(visible: boolean): void {
    this.hints.hidden = !visible;
    this.hintsOn = visible;
    this.hintsKey = null;
    if (visible) this.refreshHints();
  }

  dispose(): void {
    if (this.bannerTimer !== null) clearTimeout(this.bannerTimer);
    this.root.remove();
  }

  private card(side: 'first' | 'second', eyebrow: string, name: string, accentCss: string, isPlayer: boolean): CardParts {
    const root = el('section', `cb-hud__card cb-hud__card--${side}`, `hud-${side}`);
    root.style.setProperty('--bey-accent', accentCss);
    const head = el('div', 'cb-hud__card-head');
    const who = el('span', 'cb-hud__who');
    who.textContent = eyebrow;
    const label = el('span', 'cb-hud__name');
    label.textContent = name;
    const tag = el('span', 'cb-hud__tag', `hud-${side}-tag`);
    head.append(who, label, tag);
    const meter = (kind: string, text: string): HTMLElement => {
      const row = el('div', `cb-hud__meter cb-hud__meter--${kind}`);
      const name = el('span', 'cb-hud__meter-name');
      name.textContent = text;
      const bar = el('div', 'cb-hud__bar');
      const fill = el('div', 'cb-hud__fill', `hud-${side}-${kind}`);
      bar.append(fill);
      row.append(name, bar);
      root.append(row);
      return fill;
    };
    root.append(head);
    const stamina = meter('stamina', 'STA');
    const stability = meter('stability', 'STB');
    const dashCooldown = meter('dash-cd', 'DASH');
    dashCooldown.parentElement!.parentElement!.title = 'Dash: green = you can Dash now; grey = still recharging';
    const dodgeCooldown = meter('dodge-cd', 'DODGE');
    dodgeCooldown.parentElement!.parentElement!.title = 'Dodge: green = you can dodge now; grey = still recharging';
    const dash = isPlayer ? meter('dash', 'CHARGE') : null;
    // Owner, 2026-10-02 (Lote 3): momentum as a thin line under the meters, no label (the card is not redesigned).
    const momentumTrack = el('div', 'cb-hud__momentum');
    momentumTrack.title = 'Momentum: full = top speed raised';
    const momentum = el('div', 'cb-hud__momentum-fill', `hud-${side}-momentum`);
    momentumTrack.append(momentum);
    root.append(momentumTrack);
    return { root, stamina, stability, dashCooldown, dodgeCooldown, momentum, dash, tag };
  }

  private fillCard(card: CardParts, side: HudSide): void {
    card.stamina.style.width = `${side.stamina * 100}%`;
    card.stability.style.width = `${side.stability * 100}%`;
    card.dashCooldown.style.width = `${side.dashReadiness * 100}%`;
    // Owner, 2026-10-04 ("nunca dá pra saber quando pode e quando não pode"): READY in bright green the moment a
    // Dash can start, WAIT with a grey refilling bar until then.
    card.dashCooldown.parentElement!.parentElement!.classList.toggle('is-ready', side.dashReadiness >= 1);
    card.momentum.style.width = `${side.momentum * 100}%`;
    if (card.dash) {
      card.dash.style.width = `${side.dashCharge * 100}%`;
      card.dash.parentElement!.parentElement!.classList.toggle('is-idle', side.dashCharge === 0);
    }
    card.root.classList.toggle('is-broken', side.broken);
    card.stamina.classList.toggle('is-low', side.stamina < 0.25);
    card.tag.textContent = side.tag ?? '';
  }

  private pips(wins: number, needed: number, accentCss: string, who: string): HTMLElement {
    const row = el('span', 'cb-hud__pip-row', `hud-pips-${who}`);
    row.style.setProperty('--bey-accent', accentCss);
    for (let i = 0; i < needed; i++) {
      const pip = el('span', `cb-hud__pip${i < wins ? ' is-won' : ''}`);
      row.append(pip);
    }
    return row;
  }

  private updateClashBar(session: MatchSession, camera: THREE.PerspectiveCamera, dt: number): void {
    const clash = session.clash.controller;
    const active = clash.getState() === ClashState.Active;
    if (active && !this.clashActive) {
      // A new Clash: the side each half sits on is decided now and kept.
      this.clashFirstOnLeft = this.screenX(session.getBey('first').body.translation(), camera) <= this.screenX(session.getBey('second').body.translation(), camera);
      this.clashShare = 0.5;
      this.clashBar.classList.toggle('is-swapped', !this.clashFirstOnLeft);
    }
    if (active) {
      const target = clashBarShare(
        computeClashPower(clash.getFirstMashEventCount(), clash.getFirstStaminaFractionAtStart(), clash.getFirstSpeedMpsAtStart()),
        computeClashPower(clash.getSecondMashEventCount(), clash.getSecondStaminaFractionAtStart(), clash.getSecondSpeedMpsAtStart()),
      );
      this.clashShare = followClashBar(this.clashShare, target, dt);
      this.clashHoldS = CLASH_BAR_HOLD_S;
    } else if (this.clashActive) {
      // Resolved: land on the real result, hold briefly.
      const last = clash.getLastResult();
      if (last) this.clashShare = clashBarShare(last.firstClashPower, last.secondClashPower);
    } else {
      this.clashHoldS = Math.max(0, this.clashHoldS - dt);
    }
    this.clashActive = active;

    const visible = active || this.clashHoldS > 0;
    this.clashBar.hidden = !visible;
    if (!visible) return;
    this.clashFirst.style.flexGrow = String(this.clashShare);
    this.clashSecond.style.flexGrow = String(1 - this.clashShare);
    // Between the two Beys, a little above their midpoint, kept in frame.
    const a = session.getBey('first').body.translation();
    const b = session.getBey('second').body.translation();
    this.projected.set((a.x + b.x) / 2, (a.y + b.y) / 2 + 1.1, (a.z + b.z) / 2).project(camera);
    const width = this.root.clientWidth || window.innerWidth;
    const height = this.root.clientHeight || window.innerHeight;
    const x = Math.min(width - 190, Math.max(190, ((this.projected.x + 1) / 2) * width));
    const y = Math.min(height - 60, Math.max(120, ((1 - this.projected.y) / 2) * height));
    this.clashBar.style.transform = `translate(${x - 160}px, ${y - 11}px) rotate(-18deg)`;
  }

  /** Owner, 2026-10-04: the dodge's cooldown / ready line (read from the session; presentation only). */
  private fillDodge(card: CardParts, readiness: number): void {
    card.dodgeCooldown.style.width = `${readiness * 100}%`;
    card.dodgeCooldown.parentElement!.parentElement!.classList.toggle('is-ready', readiness >= 1);
  }

  private updateRecoverAlert(session: MatchSession, camera: THREE.PerspectiveCamera): void {
    const bey = session.getBey('first');
    // Owner, 2026-10-04: the recovery spends the dodge. While launched with the dodge still recharging the alert shows
    // greyed, its border filling as the dodge recharges — pressing then does nothing, and now that reads on screen.
    // Owner, 2026-10-05: same while the recovery time runs (an early C does nothing; the HUD flashes it refused).
    const launched = session.getLastResult()?.first.grounded === false && bey.dodge.isAirRecoveryAvailable();
    const ready = launched && bey.dodge.canAirRecoverNow();
    const show = launched;
    this.recoverAlert.classList.toggle('is-on', show);
    this.recoverAlert.classList.toggle('is-wait', show && !ready);
    if (!show) return;
    // Owner, 2026-10-05: the recovery time (slider minimum + the launching force) fills it too — the slower of the two.
    const wait = bey.dodge.getRecoveryWait();
    const waitFill = wait.totalS > 0 ? 1 - wait.remainingS / wait.totalS : 1;
    this.recoverAlert.style.setProperty('--cb-recover-fill', `${Math.round(Math.min(bey.dodge.getReadiness(), waitFill) * 100)}%`);
    this.recoverAlert.textContent = readFirstGamepad(currentGamepads()) !== null ? 'B' : 'C';
    const p = bey.body.translation();
    const ndc = this.projected.set(p.x, p.y + 1.6, p.z).project(camera);
    this.recoverAlert.style.left = `${((ndc.x + 1) / 2) * 100}%`;
    this.recoverAlert.style.top = `${((1 - ndc.y) / 2) * 100}%`;
  }

  private screenX(position: { x: number; y: number; z: number }, camera: THREE.PerspectiveCamera): number {
    return this.projected.set(position.x, position.y, position.z).project(camera).x;
  }

  /**
   * The round-start cue: "▲ UP THE SCREEN", on while the hints are on, until the player first steers or UP_CUE_S have gone,
   * fading over its last second. Presentation only (it reads the player's held arrows; nothing reaches the match).
   */
  private updateUpCue(session: MatchSession, dt: number): void {
    const intent = session.getLastActions('first')?.moveIntent;
    const steering = intent !== undefined && Math.hypot(intent.x, intent.z) > 0.2;
    const cue = stepUpCue(this.upCueLeftS, steering, this.hintsOn, dt);
    this.upCueLeftS = cue.leftS;
    this.upCue.hidden = !cue.visible;
    this.upCue.style.opacity = String(cue.opacity);
  }

  private refreshHints(): void {
    const pad = readFirstGamepad(currentGamepads()) !== null;
    const key = `${pad}|${this.hintsCircular}`;
    if (key === this.hintsKey) return;
    this.hintsKey = key;
    const attack = this.hintsCircular ? 'attack · hold: Dash' : 'hold: Dash';
    const items = pad
      ? [['Stick', 'move (up = up the screen)'], ['A', attack], ['X', 'tap: hop · hold: jump · tap + hold: drift'], ['B', 'dodge'], ['Start', 'pause']]
      : [['← → ↑ ↓', 'move (↑ = up the screen)'], ['Z', attack], ['X', 'tap: hop · hold: jump · tap + hold: drift'], ['C', 'dodge'], ['Esc', 'pause']];
    this.hints.replaceChildren(
      ...items.map(([key, meaning]) => {
        const item = el('span', 'cb-hud__hint');
        const cap = el('span', 'cb-key');
        cap.textContent = key!;
        item.append(cap, ` ${meaning}`);
        return item;
      }),
    );
  }
}

/**
 * 0..1 ring-out danger for a Bey (owner, 2026-10-05): 1 outside the ring-out line; while airborne and flying outward,
 * rising with how far out it already is and how fast it goes out; on the ground, a faint glow at the wall only.
 */
export function ringOutDanger(position: { x: number; z: number }, velocity: { x: number; z: number }, grounded: boolean, outside: boolean): number {
  if (outside) return 1;
  const r = Math.hypot(position.x, position.z);
  const edge = r / arenaFloorRadius();
  if (!grounded && r > 1e-6) {
    const outward = (position.x * velocity.x + position.z * velocity.z) / r;
    const flying = clamp01((edge - 0.55) / 0.4) * clamp01(outward / 10);
    if (flying > 0) return Math.max(flying, 0.25 * clamp01((edge - 0.9) / 0.1));
  }
  return 0.25 * clamp01((edge - 0.9) / 0.1);
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

let hudStyleInjected = false;
function injectHudStyle(): void {
  if (hudStyleInjected) return;
  hudStyleInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .cb-hud { position: fixed; inset: 0; pointer-events: none; font: 13px/1.3 var(--cb-font); color: var(--cb-text); z-index: 1050; }
    .cb-hud__card { position: absolute; top: 14px; width: min(300px, 38vw); padding: 10px 12px; background: rgba(8, 10, 16, 0.72); border: 1px solid var(--cb-line); border-top: 3px solid var(--bey-accent); border-radius: 5px; display: flex; flex-direction: column; gap: 5px; backdrop-filter: blur(3px); }
    .cb-hud__card--first { left: 14px; }
    .cb-hud__card--second { right: 14px; }
    .cb-hud__card--second .cb-hud__card-head, .cb-hud__card--second .cb-hud__meter { flex-direction: row-reverse; }
    .cb-hud__card--second .cb-hud__fill { left: auto; right: 0; }
    .cb-hud__card-head { display: flex; align-items: baseline; gap: 8px; }
    .cb-hud__who { font-weight: 800; letter-spacing: 0.18em; color: var(--bey-accent); }
    .cb-hud__name { font-size: 12px; color: var(--cb-text-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .cb-hud__tag { margin-left: auto; font: 700 11px/1 var(--cb-mono); letter-spacing: 0.12em; color: var(--cb-warn); }
    .cb-hud__card--second .cb-hud__tag { margin-left: 0; margin-right: auto; }
    .cb-hud__meter { display: flex; align-items: center; gap: 8px; }
    .cb-hud__meter.is-idle { opacity: 0.35; }
    .cb-hud__meter-name { width: 46px; font: 600 10px/1 var(--cb-mono); letter-spacing: 0.1em; color: var(--cb-text-dim); }
    .cb-hud__card--second .cb-hud__meter-name { text-align: right; }
    .cb-hud__bar { position: relative; flex: 1; height: 7px; background: rgba(255, 255, 255, 0.08); border-radius: 4px; overflow: hidden; }
    .cb-hud__fill { position: absolute; inset: 0 auto 0 0; width: 100%; border-radius: 4px; transition: width 90ms linear; }
    .cb-hud__meter--stamina .cb-hud__fill { background: linear-gradient(90deg, #58e38c, #b6ff7a); }
    .cb-hud__meter--stamina .cb-hud__fill.is-low { background: #ff9f43; }
    .cb-hud__meter--stability .cb-hud__fill { background: linear-gradient(90deg, #5ab8ff, #8fe3ff); }
    .cb-hud__meter--dash-cd .cb-hud__fill, .cb-hud__meter--dodge-cd .cb-hud__fill { background: rgba(255, 255, 255, 0.28); }
    .cb-hud__meter--dash-cd .cb-hud__meter-name, .cb-hud__meter--dodge-cd .cb-hud__meter-name { color: var(--cb-text-dim); }
    .cb-hud__meter--dash-cd.is-ready .cb-hud__fill { background: #4dff88; box-shadow: 0 0 8px #4dff88; }
    .cb-hud__meter--dodge-cd.is-ready .cb-hud__fill { background: #4dc8ff; box-shadow: 0 0 8px #4dc8ff; }
    .cb-hud__meter--dash-cd.is-ready .cb-hud__meter-name { color: #4dff88; font-weight: 800; }
    .cb-hud__meter--dodge-cd.is-ready .cb-hud__meter-name { color: #4dc8ff; font-weight: 800; }
    .cb-hud__momentum { height: 2px; margin-top: 4px; background: rgba(255,255,255,0.08); border-radius: 1px; overflow: hidden; }
    .cb-hud__momentum-fill { height: 100%; width: 0; background: linear-gradient(90deg, #7ad7ff, #ffffff); }
    .cb-hud__card--second .cb-hud__momentum-fill { margin-left: auto; }
    .cb-hud__meter--dash .cb-hud__fill { background: #ffe066; }
    .cb-hud__card.is-broken { border-color: var(--cb-loss); animation: cb-hud-broken 0.5s ease-in-out infinite alternate; }
    .cb-hud__card.is-broken .cb-hud__meter--stability .cb-hud__fill { background: var(--cb-loss); }
    @keyframes cb-hud-broken { from { box-shadow: 0 0 0 rgba(255, 107, 107, 0); } to { box-shadow: 0 0 18px rgba(255, 107, 107, 0.55); } }
    .cb-hud__center { position: absolute; top: 14px; left: 50%; transform: translateX(-50%); text-align: center; padding: 6px 14px; background: rgba(8, 10, 16, 0.6); border: 1px solid var(--cb-line); border-radius: 5px; }
    .cb-hud__round { font-weight: 800; letter-spacing: 0.24em; font-size: 13px; }
    .cb-hud__pips { display: flex; gap: 10px; justify-content: center; align-items: center; margin-top: 4px; }
    .cb-hud__pips-sep { width: 1px; height: 10px; background: var(--cb-line-strong); }
    .cb-hud__pip-row { display: inline-flex; gap: 4px; }
    .cb-hud__pip { width: 9px; height: 9px; border-radius: 50%; border: 1px solid var(--bey-accent); }
    .cb-hud__pip.is-won { background: var(--bey-accent); box-shadow: 0 0 6px var(--bey-accent); }
    .cb-hud__banner { position: absolute; top: 34%; left: 0; right: 0; text-align: center; opacity: 0; transform: scale(0.92); transition: opacity 180ms ease-out, transform 180ms ease-out; }
    .cb-hud__banner.is-shown { opacity: 1; transform: scale(1); }
    .cb-hud__banner-title { font-size: clamp(34px, 7vw, 72px); font-weight: 900; letter-spacing: 0.16em; text-shadow: 0 0 24px rgba(110, 231, 255, 0.45), 0 4px 0 rgba(0, 0, 0, 0.6); }
    .cb-hud__banner-sub { margin-top: 4px; font-size: clamp(16px, 3vw, 26px); font-weight: 800; letter-spacing: 0.4em; color: var(--cb-warn); }
    .cb-hud__hints { position: absolute; bottom: 12px; left: 50%; transform: translateX(-50%); display: flex; gap: 14px; flex-wrap: wrap; justify-content: center; font-size: 12px; color: var(--cb-text-dim); background: rgba(8, 10, 16, 0.5); padding: 6px 12px; border-radius: 5px; max-width: calc(100vw - 32px); box-sizing: border-box; }
    .cb-hud__hints[hidden] { display: none; }
    .cb-hud__upcue { position: absolute; top: 22%; left: 50%; transform: translateX(-50%); font-size: 15px; font-weight: 700; letter-spacing: 0.14em; color: #fff; background: rgba(8, 10, 16, 0.55); border: 1px solid rgba(255, 255, 255, 0.35); padding: 6px 14px; border-radius: 999px; pointer-events: none; }
    .cb-hud__upcue[hidden] { display: none; }
    .cb-hud__break { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font: 900 72px/1 var(--cb-font); letter-spacing: 0.2em; color: #ffffff; text-shadow: 0 0 30px rgba(255, 80, 80, 0.9); opacity: 0; pointer-events: none; }
    .cb-hud__break.is-on { animation: cb-hud-break 1.5s ease-out forwards; }
    @keyframes cb-hud-break { 0% { opacity: 1; background: rgba(255, 255, 255, 0.85); } 12% { background: rgba(255, 255, 255, 0); } 80% { opacity: 1; } 100% { opacity: 0; background: rgba(255, 255, 255, 0); } }
    .cb-hud__recover { position: absolute; transform: translate(-50%, -100%); min-width: 46px; padding: 6px 12px; text-align: center; font: 900 30px/1 var(--cb-font); color: #10131a; background: #ffffff; border-radius: 8px; box-shadow: 0 0 22px rgba(255, 255, 255, 0.85); opacity: 0; pointer-events: none; }
    .cb-hud__recover.is-on { opacity: 1; animation: cb-hud-recover 0.35s ease-in-out infinite alternate; }
    .cb-hud__recover.is-on.is-wait { animation: none; opacity: 0.75; color: #c9cfdb; background: linear-gradient(90deg, #4a8bd6 var(--cb-recover-fill, 0%), #2a2f3a var(--cb-recover-fill, 0%)); box-shadow: none; }
    @keyframes cb-hud-recover { from { transform: translate(-50%, -100%) scale(1); } to { transform: translate(-50%, -100%) scale(1.18); } }
    .cb-hud__drift { position: absolute; bottom: 64px; left: 50%; transform: translateX(-50%); font: 900 22px/1 var(--cb-font); letter-spacing: 0.3em; padding: 6px 14px; border-radius: 4px; opacity: 0; transition: opacity 90ms linear; }
    .cb-hud__drift.is-drifting { opacity: 1; color: #1a1206; background: #ffcf4a; box-shadow: 0 0 18px rgba(255, 207, 74, 0.6); }
    .cb-hud__drift.is-recovering { opacity: 0.8; color: #ffcf4a; background: rgba(8, 10, 16, 0.6); border: 1px solid #ffcf4a; }
    .cb-hud__drift.is-recovering.is-lost { opacity: 1; color: #ffd9d9; background: rgba(120, 16, 16, 0.75); border-color: #ff5c5c; box-shadow: 0 0 14px rgba(255, 92, 92, 0.55); }
    .cb-hud__clash { position: absolute; top: 0; left: 0; width: 320px; height: 22px; display: flex; border-radius: 3px; overflow: hidden; box-shadow: 0 0 16px rgba(255, 224, 102, 0.55), 0 0 0 2px rgba(0, 0, 0, 0.6); }
    .cb-hud__clash[hidden] { display: none; }
    .cb-hud__clash.is-swapped { flex-direction: row-reverse; }
    .cb-hud__clash-half { flex: 1 1 0; background: var(--half); box-shadow: inset 0 0 10px rgba(255, 255, 255, 0.45); transition: none; }
    .cb-hud__ringout { position: absolute; inset: 0; opacity: 0; pointer-events: none; box-shadow: inset 0 0 90px 30px rgba(255, 40, 40, 0.85); transition: opacity 120ms linear; }
    .cb-hud__counter { position: absolute; transform: translate(-50%, -100%); font: 900 34px/1 var(--cb-font); letter-spacing: 0.12em; color: #ffd24a; text-shadow: 0 0 16px rgba(255, 170, 40, 0.9), 0 3px 0 rgba(0, 0, 0, 0.7); opacity: 0; pointer-events: none; white-space: nowrap; }
    .cb-hud__counter.is-on { animation: cb-hud-counter 0.9s ease-out forwards; }
    @keyframes cb-hud-counter { 0% { opacity: 0; transform: translate(-50%, -100%) scale(1.6); } 12% { opacity: 1; transform: translate(-50%, -100%) scale(1); } 70% { opacity: 1; } 100% { opacity: 0; } }
    .cb-hud__meter.is-refused { animation: cb-hud-refused 0.32s ease-out; }
    .cb-hud__meter.is-refused .cb-hud__bar { background: rgba(255, 70, 70, 0.55); }
    @keyframes cb-hud-refused { 0%, 100% { transform: translateX(0); } 20% { transform: translateX(-5px); } 40% { transform: translateX(5px); } 60% { transform: translateX(-3px); } 80% { transform: translateX(2px); } }
    @media (max-width: 640px) {
      .cb-hud__card { top: 8px; width: 42vw; padding: 7px 8px; }
      .cb-hud__card--first { left: 8px; } .cb-hud__card--second { right: 8px; }
      .cb-hud__name { display: none; }
      .cb-hud__center { top: auto; bottom: 10px; }
      .cb-hud__hints { display: none; }
    }
  `;
  document.head.append(style);
}
