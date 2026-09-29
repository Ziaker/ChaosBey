// ============================================================
// PLAY FLOW — THE PLAYER'S PATH THROUGH A MATCH (M10, GDD 9/56)
// Character Select → match → Results → again / change / Main Menu, in one
// page: the renderer, telemetry and debug panels are created once and
// each screen or match borrows them. Every step is a GameState, so the
// overlay and tests can read where the player is.
// ============================================================

import type { AppRenderer } from '../bootstrap/createRenderer';
import { GameState, type GameStateMachine } from '../lifecycle/GameState';
import { appModeHref } from '../modes/appMode';
import type { MatchSession } from '../session/MatchSession';
import type { BeyAttackProfileSettings } from '../../config/attack-profile/AttackProfileSettings';
import { resolveMatchConfig } from '../../config/match/MatchConfig';
import type { RoundOutcome } from '../../combat/round-rules/RoundState';
import type { DebugOverlay } from '../../debug/overlay/DebugOverlay';
import type { AttackProfileSettingsPanel } from '../../debug/settings/AttackProfileSettingsPanel';
import { generateRandomSeedText } from '../../rng/stringSeed';
import type { TelemetryRecorder } from '../../telemetry/recording/TelemetryRecorder';
import { rosterEntry } from './beyRoster';
import { CharacterSelectScreen } from './CharacterSelectScreen';
import { outcomeText } from './matchOutcome';
import { MatchResultsScreen } from './MatchResultsScreen';
import { MatchRunner } from './MatchRunner';
import { createDefaultMatchSetup, matchBeysFor, type MatchSetup } from './matchSetup';

/** Time the finished round stays on screen (ring-out / finisher camera) before Results. */
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

export type PlayFlowScreen = 'character-select' | 'loading' | 'match' | 'results';

/** Read-only view for smoke tests: window.__chaosBeyPlay. */
export interface PlayFlowHandle {
  getScreen(): PlayFlowScreen;
  getSetup(): MatchSetup;
  getSession(): MatchSession | null;
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
  private results: MatchResultsScreen | null = null;
  private runner: MatchRunner | null = null;
  private resultsTimer: ReturnType<typeof setTimeout> | null = null;
  /** Bumped on every screen change, so a match that finishes loading after the player left is dropped. */
  private generation = 0;

  constructor(private readonly deps: PlayFlowDeps) {
    window.__chaosBeyPlay = {
      getScreen: () => this.screen,
      getSetup: () => this.setup,
      getSession: () => this.runner?.session ?? null,
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
        this.setup = beyId === this.setup.playerBeyId ? this.setup : createDefaultMatchSetup(beyId);
        void this.startMatch();
      },
      onBack: () => this.goToMainMenu(),
    });
  }

  private async startMatch(): Promise<void> {
    this.leaveCurrent();
    const generation = this.generation;
    this.screen = 'loading';
    this.deps.stateMachine.transitionTo(GameState.MatchLoading);
    const runner = await MatchRunner.start(
      this.deps,
      {
        seedText: this.setup.seedText ?? generateRandomSeedText(),
        beys: matchBeysFor(this.setup),
        matchConfig: resolveMatchConfig(),
        attackProfileSettings: this.deps.attackProfileSettings,
        opponent: { kind: 'ai', personality: 'archetype' },
      },
      { onRoundOver: (outcome) => this.scheduleResults(outcome) },
    );
    if (generation !== this.generation) {
      runner.stop();
      return;
    }
    this.runner = runner;
    this.screen = 'match';
  }

  private scheduleResults(outcome: RoundOutcome): void {
    const generation = this.generation;
    this.resultsTimer = setTimeout(() => {
      this.resultsTimer = null;
      if (generation === this.generation) this.showResults(outcome);
    }, RESULTS_DELAY_MS);
  }

  private showResults(outcome: RoundOutcome): void {
    const text = outcomeText(outcome);
    if (!text) return;
    this.screen = 'results';
    this.deps.stateMachine.transitionTo(GameState.MatchEnd);
    const player = rosterEntry(this.setup.playerBeyId);
    const opponent = rosterEntry(this.setup.opponentBeyId);
    const seed = this.runner?.session.seedText;
    this.results = new MatchResultsScreen(this.deps.screenRoot, {
      outcome: text,
      details: [`You (${player.label}) vs CPU (${opponent.label})`, ...(seed ? [`Seed ${seed}`] : [])],
      actions: [
        { id: 'rematch', label: 'Rematch', primary: true, run: () => void this.startMatch() },
        { id: 'change-bey', label: 'Change Bey', run: () => this.openCharacterSelect() },
        { id: 'main-menu', label: 'Main Menu', run: () => this.goToMainMenu() },
      ],
    });
  }

  /** Closes whatever screen or match is up. */
  private leaveCurrent(): void {
    this.generation++;
    if (this.resultsTimer !== null) clearTimeout(this.resultsTimer);
    this.resultsTimer = null;
    this.characterSelect?.close();
    this.characterSelect = null;
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
