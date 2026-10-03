// ============================================================
// PLAY FLOW — THE PLAYER'S PATH THROUGH A MATCH (M10, GDD 9/56)
// Character Select → Pregame → rounds until someone wins the match →
// Results → rematch / change setup / change Bey / Main Menu, in one page:
// the renderer, telemetry and debug panels are created once and each
// screen or round borrows them. Every step is a GameState, so the overlay
// and tests can read where the player is.
// ============================================================

import type { AppRenderer } from '../bootstrap/createRenderer';
import { GameState, type GameStateMachine } from '../lifecycle/GameState';
import { appModeHref } from '../modes/appMode';
import type { MatchSession } from '../session/MatchSession';
import type { BeyAttackProfileSettings } from '../../config/attack-profile/AttackProfileSettings';
import type { RoundOutcome } from '../../combat/round-rules/RoundState';
import type { DebugOverlay } from '../../debug/overlay/DebugOverlay';
import type { AttackProfileSettingsPanel } from '../../debug/settings/AttackProfileSettingsPanel';
import { generateRandomSeedText } from '../../rng/stringSeed';
import type { TelemetryRecorder } from '../../telemetry/recording/TelemetryRecorder';
import { arenaPreset } from '../../arena/presets/ArenaPresets';
import { rosterEntry } from './beyRoster';
import { CharacterSelectScreen } from './CharacterSelectScreen';
import { outcomeText } from './matchOutcome';
import { AUTO_CONTINUE_S } from './AutoContinue';
import { MatchResultsScreen, type MatchResultsAction } from './MatchResultsScreen';
import { MatchRunner } from './MatchRunner';
import { EMPTY_SCORE, matchWinner, roundSeed, scoreRound, type MatchScore } from './matchScore';
import { createDefaultMatchSetup, loadLastSetup, matchBeysFor, matchConfigFor, opponentControllerFor, saveLastSetup, withPlayerBey, type MatchSetup } from './matchSetup';
import { PregameScreen } from './PregameScreen';
import { SettingsScreen } from './SettingsScreen';
import { CombatHud } from './CombatHud';
import { roundEndBanner } from './hudModel';
import { aiDifficultyTier } from '../../ai/difficulty/AiDifficultyTiers';
import { AI_STYLE_LABELS } from './aiExplanation';
import { applyQuality, presentationFor } from './quality';
import { Action } from '../../input/actions/Action';
import { GamepadMenuKeys } from '../../input/devices/GamepadMenuKeys';
import { savePlayerSettings, type PlayerSettings } from '../../config/settings/PlayerSettings';

/** Time a finished round stays on screen (ring-out / finisher camera) before its result. */
const RESULTS_DELAY_MS = 1400;

export interface PlayFlowDeps {
  readonly appRenderer: AppRenderer;
  readonly screenRoot: HTMLElement;
  readonly telemetry: TelemetryRecorder;
  readonly stateMachine: GameStateMachine;
  readonly debugOverlay: DebugOverlay;
  readonly attackProfileSettingsPanel: AttackProfileSettingsPanel;
  readonly attackProfileSettings: BeyAttackProfileSettings;
  /** The player's settings at boot (the flow keeps them current and saves changes). */
  readonly settings: PlayerSettings;
  /** Loads another page (the Main Menu). */
  readonly navigate: (href: string) => void;
  readonly location: { readonly pathname: string; readonly search: string };
}

export type PlayFlowScreen = 'character-select' | 'pregame' | 'loading' | 'match' | 'paused' | 'settings' | 'round-result' | 'results';

/** Read-only view for smoke tests: window.__chaosBeyPlay. */
export interface PlayFlowHandle {
  getScreen(): PlayFlowScreen;
  getSetup(): MatchSetup;
  getSession(): MatchSession | null;
  getScore(): MatchScore;
  /** The current match's seed (each round derives its own from it). */
  getMatchSeed(): string | null;
  /** Id of the Bey visual on Character Select's pedestal (e.g. `concept:attack-a`), or null off that screen. */
  getPreviewVisualId(): string | null;
}

declare global {
  interface Window {
    __chaosBeyPlay?: PlayFlowHandle;
  }
}

export class PlayFlow {
  private screen: PlayFlowScreen = 'character-select';
  /** Lote 9: the last setup used comes back (validated), else the default. */
  private setup: MatchSetup = loadLastSetup() ?? createDefaultMatchSetup();
  private characterSelect: CharacterSelectScreen | null = null;
  private pregame: PregameScreen | null = null;
  private results: MatchResultsScreen | null = null;
  private pauseMenu: MatchResultsScreen | null = null;
  private settingsScreen: SettingsScreen | null = null;
  private hud: CombatHud | null = null;
  private settings: PlayerSettings;
  /** Game state to restore on resume (Combat or Clash). */
  private stateBeforePause: GameState = GameState.Combat;
  private readonly padMenu = new GamepadMenuKeys();
  private runner: MatchRunner | null = null;
  private resultsTimer: ReturnType<typeof setTimeout> | null = null;
  private score: MatchScore = EMPTY_SCORE;
  private matchSeed: string | null = null;
  /** Bumped on every screen change, so a round that finishes loading after the player left is dropped. */
  private generation = 0;

  constructor(private readonly deps: PlayFlowDeps) {
    this.settings = deps.settings;
    applyQuality(deps.appRenderer, this.settings);
    window.addEventListener('blur', this.handleFocusLoss);
    document.addEventListener('visibilitychange', this.handleVisibility);
    window.__chaosBeyPlay = {
      getScreen: () => this.screen,
      getSetup: () => this.setup,
      getSession: () => this.runner?.session ?? null,
      getScore: () => this.score,
      getMatchSeed: () => this.matchSeed,
      getPreviewVisualId: () => this.characterSelect?.previewVisualId ?? null,
    };
  }

  start(): void {
    this.openCharacterSelect();
  }

  /** The player's current settings (Settings changes included). */
  getSettings(): PlayerSettings {
    return this.settings;
  }

  private openCharacterSelect(): void {
    this.leaveCurrent();
    this.screen = 'character-select';
    this.deps.stateMachine.transitionTo(GameState.CharacterSelect);
    this.padMenu.start();
    this.characterSelect = new CharacterSelectScreen(this.deps.screenRoot, this.deps.appRenderer, {
      initialBeyId: this.setup.playerBeyId,
      onConfirm: (beyId) => {
        this.setup = withPlayerBey(this.setup, beyId);
        this.openPregame();
      },
      onBack: () => this.goToMainMenu(),
    });
  }

  private openPregame(): void {
    this.leaveCurrent();
    this.screen = 'pregame';
    this.deps.stateMachine.transitionTo(GameState.PregameSetup);
    this.padMenu.start();
    this.pregame = new PregameScreen(this.deps.screenRoot, {
      setup: this.setup,
      onStart: (setup) => {
        this.setup = setup;
        saveLastSetup(setup);
        this.startMatch();
      },
      onBack: (setup) => {
        this.setup = setup;
        this.openCharacterSelect();
      },
    });
  }

  /** A new match: score reset, seed fixed by the setup or drawn fresh. */
  private startMatch(): void {
    this.score = EMPTY_SCORE;
    this.matchSeed = this.setup.seedText ?? generateRandomSeedText();
    void this.startRound();
  }

  private async startRound(): Promise<void> {
    this.leaveCurrent();
    const generation = this.generation;
    this.screen = 'loading';
    this.deps.stateMachine.transitionTo(GameState.MatchLoading);
    const runner = await MatchRunner.start(
      this.deps,
      {
        seedText: roundSeed(this.matchSeed!, this.score.rounds + 1),
        beys: matchBeysFor(this.setup),
        matchConfig: matchConfigFor(this.setup),
        attackProfileSettings: this.deps.attackProfileSettings,
        opponent: opponentControllerFor(this.setup),
        arenaTheme: arenaPreset(this.setup.arena.presetId).theme,
        presentation: { ...presentationFor(this.settings), vfx: this.setup.visual },
        controlScheme: this.settings.controlScheme,
      },
      {
        onRoundOver: (outcome) => {
          this.hud?.showBanner(roundEndBanner(outcome) ?? '');
          this.scheduleRoundResult(outcome);
        },
        onFrame: (session, frameDeltaSeconds) => this.hud?.update(session, this.deps.appRenderer.camera, frameDeltaSeconds),
        onTick: (session, firstActions) => {
          if (firstActions.pressedThisFrame.has(Action.Pause) && !session.roundState.isOver) queueMicrotask(() => this.openPause());
        },
      },
    );
    if (generation !== this.generation) {
      runner.stop();
      return;
    }
    this.runner = runner;
    this.screen = 'match';
    this.padMenu.stop();
    const player = rosterEntry(this.setup.playerBeyId);
    const opponent = rosterEntry(this.setup.opponentBeyId);
    this.hud = new CombatHud(this.deps.screenRoot, {
      player: { label: player.label, accentCss: player.accentCss },
      opponent: { label: opponent.label, accentCss: opponent.accentCss, subtitle: `${aiDifficultyTier(this.setup.ai.tier).label} AI · ${AI_STYLE_LABELS[this.setup.ai.style]}` },
      roundNumber: this.score.rounds + 1,
      score: { player: this.score.player, opponent: this.score.opponent },
      roundsToWin: this.setup.roundsToWin,
      controlHints: this.settings.controlHints,
    });
  }

  // --- Pause (Esc / Start, or focus loss) --------------------------------

  private openPause(): void {
    const runner = this.runner;
    if (this.screen !== 'match' || !runner || runner.isRoundOver()) return;
    runner.pause();
    this.stateBeforePause = this.deps.stateMachine.getCurrentState();
    this.deps.stateMachine.transitionTo(GameState.Pause);
    this.showPauseMenu();
  }

  private showPauseMenu(): void {
    this.screen = 'paused';
    this.padMenu.start();
    const player = rosterEntry(this.setup.playerBeyId);
    const opponent = rosterEntry(this.setup.opponentBeyId);
    this.pauseMenu = new MatchResultsScreen(this.deps.screenRoot, {
      tone: 'neutral',
      headline: 'PAUSED',
      subline: `Round ${this.score.rounds + 1} · ${this.score.player} – ${this.score.opponent} · first to ${this.setup.roundsToWin}`,
      details: [`You (${player.label}) vs CPU (${opponent.label})`],
      testId: 'pause-menu',
      onBack: () => this.resume(),
      actions: [
        { id: 'resume', label: 'Resume', primary: true, run: () => this.resume() },
        { id: 'restart', label: 'Restart round', run: () => void this.startRound() },
        { id: 'settings', label: 'Settings', run: () => this.openPauseSettings() },
        { id: 'leave', label: 'Leave match', run: () => this.openPregame() },
        { id: 'main-menu', label: 'Main Menu', run: () => this.goToMainMenu() },
      ],
    });
  }

  private openPauseSettings(): void {
    this.pauseMenu?.close();
    this.pauseMenu = null;
    this.screen = 'settings';
    this.settingsScreen = new SettingsScreen(this.deps.screenRoot, {
      settings: this.settings,
      overlay: true,
      onChange: (settings) => this.changeSettings(settings),
      onBack: () => {
        this.settingsScreen?.close();
        this.settingsScreen = null;
        this.showPauseMenu();
      },
    });
  }

  private changeSettings(settings: PlayerSettings): void {
    this.settings = settings;
    savePlayerSettings(settings);
    applyQuality(this.deps.appRenderer, settings);
    this.runner?.setPresentation(presentationFor(settings));
    this.runner?.setControlScheme(settings.controlScheme);
    this.hud?.setControlHints(settings.controlHints);
    this.runner?.redraw();
  }

  private resume(): void {
    if (this.screen !== 'paused' || !this.runner) return;
    this.pauseMenu?.close();
    this.pauseMenu = null;
    this.padMenu.stop();
    this.screen = 'match';
    this.deps.stateMachine.transitionTo(this.stateBeforePause);
    this.runner.resume();
  }

  private readonly handleFocusLoss = (): void => {
    if (this.settings.pauseOnFocusLoss) this.openPause();
  };

  private readonly handleVisibility = (): void => {
    if (document.visibilityState === 'hidden') this.handleFocusLoss();
  };

  private scheduleRoundResult(outcome: RoundOutcome): void {
    const generation = this.generation;
    this.resultsTimer = setTimeout(() => {
      this.resultsTimer = null;
      if (generation === this.generation) this.showRoundResult(outcome);
    }, RESULTS_DELAY_MS);
  }

  private showRoundResult(outcome: RoundOutcome): void {
    const text = outcomeText(outcome);
    if (!text) return;
    this.score = scoreRound(this.score, outcome);
    const winner = matchWinner(this.score, this.setup.roundsToWin);
    const player = rosterEntry(this.setup.playerBeyId);
    const opponent = rosterEntry(this.setup.opponentBeyId);
    const scoreLine = `${this.score.player} – ${this.score.opponent}`;
    const matchup = `You (${player.label}) vs CPU (${opponent.label})`;
    const seedLine = `Match seed ${this.matchSeed}`;

    this.padMenu.start();
    if (winner === null) {
      // The match goes on: this round's result, then the next round.
      this.screen = 'round-result';
      this.deps.stateMachine.transitionTo(GameState.RoundEnd);
      this.results = new MatchResultsScreen(this.deps.screenRoot, {
        tone: text.result,
        headline: `ROUND ${this.score.rounds}: ${text.headline}`,
        subline: text.finish,
        details: [`Score ${scoreLine} · first to ${this.setup.roundsToWin}`, matchup],
        actions: [
          { id: 'next-round', label: 'Next round', primary: true, run: () => void this.startRound() },
          { id: 'forfeit', label: 'Leave match', run: () => this.openPregame() },
        ],
        autoContinue: { actionId: 'next-round', seconds: AUTO_CONTINUE_S, verb: 'Next round' },
      });
      return;
    }

    this.screen = 'results';
    this.deps.stateMachine.transitionTo(GameState.MatchEnd);
    const actions: MatchResultsAction[] = [
      { id: 'rematch', label: 'Rematch', primary: true, run: () => this.startMatch() },
      { id: 'change-setup', label: 'Change setup', run: () => this.openPregame() },
      { id: 'change-bey', label: 'Change Bey', run: () => this.openCharacterSelect() },
      { id: 'main-menu', label: 'Main Menu', run: () => this.goToMainMenu() },
    ];
    this.results = new MatchResultsScreen(this.deps.screenRoot, {
      tone: winner === 'player' ? 'win' : 'loss',
      headline: winner === 'player' ? 'VICTORY' : 'DEFEAT',
      subline: `Final round — ${text.finish}`,
      details: [this.setup.roundsToWin > 1 ? `Final score ${scoreLine}` : 'Single round', matchup, seedLine],
      actions,
      autoContinue: { actionId: 'rematch', seconds: AUTO_CONTINUE_S, verb: 'Rematch' },
    });
  }

  /** Closes whatever screen or round is up. */
  private leaveCurrent(): void {
    this.generation++;
    if (this.resultsTimer !== null) clearTimeout(this.resultsTimer);
    this.resultsTimer = null;
    this.characterSelect?.close();
    this.characterSelect = null;
    this.pregame?.close();
    this.pregame = null;
    this.results?.close();
    this.results = null;
    this.pauseMenu?.close();
    this.pauseMenu = null;
    this.settingsScreen?.close();
    this.settingsScreen = null;
    this.hud?.dispose();
    this.hud = null;
    this.runner?.stop();
    this.runner = null;
  }

  private goToMainMenu(): void {
    this.leaveCurrent();
    this.deps.navigate(appModeHref('menu', this.deps.location));
  }
}
