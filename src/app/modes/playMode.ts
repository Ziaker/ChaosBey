// ============================================================
// PLAY MODE — THE NORMAL PLAYER-VS-AI MATCH
// `?mode=play` is the player flow (M10): Character Select, the match
// against the real M7 AIController, then Results (app/frontend/
// PlayFlow.ts). `?mode=play&quick` skips the screens and starts the
// default match straight away with the F3 overlay up — the developer and
// smoke-test route the play mode used to be. Both run the same match loop
// (app/frontend/MatchRunner.ts, over MatchSession).
// ============================================================

import type { AppRenderer } from '../bootstrap/createRenderer';
import { DEFAULT_MATCH_BEYS } from '../bootstrap/createMatchScene';
import { GameStateMachine } from '../lifecycle/GameState';
import { MatchRunner } from '../frontend/MatchRunner';
import { PlayFlow } from '../frontend/PlayFlow';
import { resolveMatchConfig } from '../../config/match/MatchConfig';
import { resolveAttackProfileSettings } from '../../config/attack-profile/AttackProfileSettings';
import { loadAttackProfileOverrides } from '../../config/attack-profile/AttackProfileStorage';
import { createDefaultRuntimeConfig } from '../../config/runtime/RuntimeConfig';
import { DebugOverlay } from '../../debug/overlay/DebugOverlay';
import { AttackProfileSettingsPanel } from '../../debug/settings/AttackProfileSettingsPanel';
import { generateRandomSeedText } from '../../rng/stringSeed';
import { TelemetryRecorder } from '../../telemetry/recording/TelemetryRecorder';
import { recordAppBoot, recordUncaughtErrors } from './appTelemetry';

export interface PlayModeMounts {
  readonly debugOverlayRoot: HTMLElement;
  readonly attackSettingsRoot: HTMLElement;
  /** Where the player screens (Character Select, Results…) go. */
  readonly screenRoot: HTMLElement;
}

export interface PlayModeOptions {
  /** Skip the screens and start the default match (`?mode=play&quick`). */
  readonly quick: boolean;
}

export async function startPlayMode(appRenderer: AppRenderer, mounts: PlayModeMounts, options: PlayModeOptions): Promise<void> {
  const runtimeConfig = createDefaultRuntimeConfig();
  const telemetry = new TelemetryRecorder();
  const stateMachine = new GameStateMachine();

  // Owner requirement (PR #8 review): per-archetype BeyAttackProfile values
  // must be editable from the game's settings, not locked in code.
  // Resolved once at boot from whatever the settings panel last persisted.
  const attackProfileSettings = resolveAttackProfileSettings(loadAttackProfileOverrides() ?? undefined);

  // The F3 overlay is a developer tool: up on boot in quick play, hidden
  // (still one F3 away) in the player flow.
  const debugOverlay = new DebugOverlay(mounts.debugOverlayRoot, options.quick && runtimeConfig.debugOverlayVisibleOnBoot);
  const attackProfileSettingsPanel = new AttackProfileSettingsPanel(mounts.attackSettingsRoot);

  recordAppBoot(telemetry);
  recordUncaughtErrors(telemetry);

  const deps = { appRenderer, telemetry, stateMachine, debugOverlay, attackProfileSettingsPanel };

  if (options.quick) {
    // Milestone 7: the opponent is a real AIController whose personality
    // matches its own Bey's archetype (GDD section 64).
    const runner = await MatchRunner.start(deps, {
      seedText: generateRandomSeedText(),
      beys: DEFAULT_MATCH_BEYS,
      matchConfig: resolveMatchConfig(),
      attackProfileSettings,
      opponent: { kind: 'ai', personality: 'archetype' },
    });
    window.addEventListener('beforeunload', () => {
      runner.stop();
      appRenderer.dispose();
    });
    return;
  }

  const flow = new PlayFlow({
    ...deps,
    screenRoot: mounts.screenRoot,
    attackProfileSettings,
    navigate: (href) => window.location.assign(href),
    location: window.location,
  });
  flow.start();
  window.addEventListener('beforeunload', () => appRenderer.dispose());
}
