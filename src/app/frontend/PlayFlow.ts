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
import { rosterEntry } from './beyRoster';
import { CharacterSelectScreen } from './CharacterSelectScreen';
import { outcomeText } from './matchOutcome';
import { MatchResultsScreen, type MatchResultsAction } from './MatchResultsScreen';
import { MatchRunner } from './MatchRunner';
import { EMPTY_SCORE, matchWinner, roundSeed, scoreRound, type MatchScore } from './matchScore';
import { createDefaultMatchSetup, matchBeysFor, matchConfigFor, opponentControllerFor, withPlayerBey, type MatchSetup } from './matchSetup';
import { PregameScreen } from './PregameScreen';

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
  /** Loads another page (the Main Menu). */
  readonly navigate: (href: string) => void;
  readonly location: { readonly pathname: string; readonly search: string };
}

export type PlayFlowScreen = 'character-select' | 'pregame' | 'loading' | 'match' | 'round-result' | 'results';

/** Read-only view for smoke tests: window.__chaosBeyPlay. */
export interface PlayFlowHandle {
  getScreen(): PlayFlowScreen;
  getSetup(): MatchSetup;
  getSession(): MatchSession | null;
  getScore(): MatchScore;
  /** The current match's seed (each round derives its own from it). */
  getMatchSeed(): string | null;
}

declare global {
  interface Window {
    __chaosBeyPlay?: PlayFlowHandle;
  }
}

export class PlayFlow {
  private screen: PlayFlowScreen = 'character-select';
  private setup: MatchSetup = createDefaultMatchSetup();
  private characterSelect: CharacterSelectScreen | null = null;
  private pregame: PregameScreen | null = null;
  private results: MatchResultsScreen | null = null;
  private runner: MatchRunner | null = null;
  private resultsTimer: ReturnType<typeof setTimeout> | null = null;
  private score: MatchScore = EMPTY_SCORE;
  private matchSeed: string | null = null;
  /** Bumped on every screen change, so a round that finishes loading after the player left is dropped. */
  private generation = 0;

  constructor(private readonly deps: PlayFlowDeps) {
    window.__chaosBeyPlay = {
      getScreen: () => this.screen,
      getSetup: () => this.setup,
      getSession: () => this.runner?.session ?? null,
      getScore: () => this.score,
      getMatchSeed: () => this.matchSeed,
    };
  }

  start(): void {
    this.openCharacterSelect();
  }

  private openCharacterSelect(): void {
    this.leaveCurrent();
    this.screen = 'character-select';
    this.deps.stateMachine.transitionTo(GameState.CharacterSelect);
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
    this.pregame = new PregameScreen(this.deps.screenRoot, {
      setup: this.setup,
      onStart: (setup) => {
        this.setup = setup;
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
      },
      { onRoundOver: (outcome) => this.scheduleRoundResult(outcome) },
    );
    if (generation !== this.generation) {
      runner.stop();
      return;
    }
    this.runner = runner;
    this.screen = 'match';
  }

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

    if (winner === null) {
      // The match goes on: this round's result, then the next round.
      this.screen = 'round-result';
      this.deps.stateMachine.transitionTo(GameState.RoundEnd);
      this.results = new MatchResultsScreen(this.deps.screenRoot, {
        outcome: { ...text, headline: `ROUND ${this.score.rounds}: ${text.headline}` },
        details: [`Score ${scoreLine} · first to ${this.setup.roundsToWin}`, matchup],
        actions: [
          { id: 'next-round', label: 'Next round', primary: true, run: () => void this.startRound() },
          { id: 'forfeit', label: 'Leave match', run: () => this.openPregame() },
        ],
      });
      return;
    }

    this.screen = 'results';
    this.deps.stateMachine.transitionTo(GameState.MatchEnd);
    const matchOutcome = winner === 'player' ? { ...text, result: 'win' as const, headline: 'VICTORY' } : { ...text, result: 'loss' as const, headline: 'DEFEAT' };
    const actions: MatchResultsAction[] = [
      { id: 'rematch', label: 'Rematch', primary: true, run: () => this.startMatch() },
      { id: 'change-setup', label: 'Change setup', run: () => this.openPregame() },
      { id: 'change-bey', label: 'Change Bey', run: () => this.openCharacterSelect() },
      { id: 'main-menu', label: 'Main Menu', run: () => this.goToMainMenu() },
    ];
    this.results = new MatchResultsScreen(this.deps.screenRoot, {
      outcome: { ...matchOutcome, finish: `Final round — ${text.finish}` },
      details: [this.setup.roundsToWin > 1 ? `Final score ${scoreLine}` : 'Single round', matchup, seedLine],
      actions,
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
    this.runner?.stop();
    this.runner = null;
  }

  private goToMainMenu(): void {
    this.leaveCurrent();
    this.deps.navigate(appModeHref('menu', this.deps.location));
  }
}
