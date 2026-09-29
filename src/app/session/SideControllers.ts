// ============================================================
// SIDE CONTROLLERS — WHO DRIVES EACH BEY
// Builds the CombatController for one side of a MatchSession from a small,
// serializable spec, so the Debug Lab can switch a side between keyboard,
// the real M7 AI (any archetype personality) and an idle stand-in live
// (GDD section 70: toggle AI control / automated controller / change AI
// profile). Every option is an existing controller; nothing here adds new
// behavior.
// ============================================================

import { AIController } from '../../ai/controllers/AIController';
import { DEFAULT_AI_DIFFICULTY_PROFILE } from '../../ai/difficulty/AiDifficultyProfile';
import {
  ATTACK_AI_PERSONALITY,
  DEFENSE_AI_PERSONALITY,
  STAMINA_AI_PERSONALITY,
  personalityForBeyDefinitionId,
} from '../../ai/personalities/AiArchetypePersonalities';
import type { AiPersonality } from '../../ai/personalities/AiPersonality';
import type { Bey } from '../../bey/core/Bey';
import type { ClashController } from '../../combat/clash/ClashController';
import { IdleController } from '../../automation/scripted-scenarios/IdleController';
import { ScriptedController, type ScriptedFrame } from '../../automation/scripted-scenarios/ScriptedController';
import type { CombatController, ControllerActions } from '../../input/actions/Action';
import { ReplayController } from '../../replay/playback/ReplayController';
import type { PhysicsWorld } from '../../physics/world/PhysicsWorld';
import type { SeededRng } from '../../rng/SeededRng';
import type { TelemetryRecorder } from '../../telemetry/recording/TelemetryRecorder';

/** `archetype` = the personality matching this side's own Bey (what the live game uses). */
export type AiPersonalityChoice = 'archetype' | 'attack' | 'defense' | 'stamina';

export type SideControllerSpec =
  | { readonly kind: 'keyboard' }
  | { readonly kind: 'ai'; readonly personality: AiPersonalityChoice }
  | { readonly kind: 'idle' }
  | { readonly kind: 'scripted'; readonly label: string; readonly frames: readonly ScriptedFrame[] }
  /** M9 playback: recorded ControllerActions, `frames[n]` for TickIndex n (see ReplayController). */
  | { readonly kind: 'replay'; readonly label: string; readonly frames: readonly ControllerActions[] };

export interface SideControllerDeps {
  readonly physics: PhysicsWorld;
  readonly ownBey: Bey;
  readonly opponentBey: Bey;
  readonly clashController: ClashController;
  readonly aiRng: SeededRng;
  readonly telemetry: TelemetryRecorder | null;
  readonly keyboard: CombatController;
}

export const AI_PERSONALITY_CHOICES: readonly AiPersonalityChoice[] = ['archetype', 'attack', 'defense', 'stamina'];

export function resolveAiPersonality(choice: AiPersonalityChoice, ownBey: Bey): AiPersonality {
  switch (choice) {
    case 'archetype':
      return personalityForBeyDefinitionId(ownBey.definition.id);
    case 'attack':
      return ATTACK_AI_PERSONALITY;
    case 'defense':
      return DEFENSE_AI_PERSONALITY;
    case 'stamina':
      return STAMINA_AI_PERSONALITY;
  }
}

export function createSideController(spec: SideControllerSpec, deps: SideControllerDeps): CombatController {
  switch (spec.kind) {
    case 'keyboard':
      return deps.keyboard;
    case 'idle':
      return new IdleController();
    case 'scripted':
      return new ScriptedController([...spec.frames]);
    case 'replay':
      return new ReplayController(spec.frames, spec.label);
    case 'ai':
      return new AIController(
        deps.physics,
        deps.ownBey,
        deps.opponentBey,
        deps.clashController,
        resolveAiPersonality(spec.personality, deps.ownBey),
        DEFAULT_AI_DIFFICULTY_PROFILE,
        deps.aiRng,
        deps.telemetry,
      );
  }
}

export function describeControllerSpec(spec: SideControllerSpec): string {
  switch (spec.kind) {
    case 'keyboard':
      return 'Keyboard';
    case 'idle':
      return 'Idle';
    case 'scripted':
      return `Scripted (${spec.label})`;
    case 'replay':
      return `Replay (${spec.label})`;
    case 'ai':
      return `AI (${spec.personality})`;
  }
}
