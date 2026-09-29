// ============================================================
// REPLAY REPRODUCTION (GDD 68 "Test Replay Reproduction", M9 lane D)
// Records a real AI-vs-AI match, exports it as a ChaosBeyReplayV1 file,
// imports the file back, plays it through the real runtime and compares
// every checkpoint. Then two negative self-checks prove the comparison
// isn't blind: a copy with edited inputs must diverge inside the edited
// range, and a copy with one altered checkpoint must diverge at exactly
// that checkpoint (both re-sealed, so they pass the file's integrity
// check and only playback can catch them).
//
// It also binds a real GDD 68 scenario preset: a scenario is recorded
// after its `setup` places the Beys, and the file doesn't say which preset
// it came from, so playback must re-apply that same setup. The scenario
// replay must verify with the preset's setup and diverge at TicksCompleted
// 0 without it.
// ============================================================

import { ATTACK_ARCHETYPE, DEFENSE_ARCHETYPE } from '../../bey/archetype/BeyArchetypes';
import { Action } from '../../input/actions/Action';
import type { RuntimeFingerprint } from '../../replay/contracts';
import { decodeReplay, encodeReplay, sealReplay, type ChaosBeyReplayV1, type ReplayFrame } from '../../replay/format/ChaosBeyReplayV1';
import { currentRuntimeFingerprint } from '../../replay/format/runtimeFingerprint';
import { playReplayHeadless, type ReplayVerdict } from '../../replay/playback/replayPlayback';
import { simulateAiMatch } from '../AiMatchSimulation';
import { findScenarioPreset } from './ScenarioPresets';
import { runScenario } from './ScenarioRunner';

/** The GDD 68 preset whose setup the scenario half binds (Beys placed face to face, a real Clash). */
export const REPLAY_REPRODUCTION_SCENARIO = 'clash';

/**
 * A long Attack-vs-Defense fight with many hitstop freezes under RNG scheme
 * 2 (1403 ticks, 211 frozen; see the lane C tests); recorded up to MAX_TICKS.
 */
export const REPLAY_REPRODUCTION_SEED = 'replay-13';
const MAX_TICKS = 1200;
/** Input edits start here (the match must last longer; checked). */
const EDIT_FROM = 120;
const EDIT_LENGTH = 60;

export interface ReplayReproductionResult {
  readonly passed: boolean;
  readonly detail: string;
  readonly ticks: number;
  /** The recorded file, as exported (for download from the Self Test). */
  readonly replayText: string;
}

function reimport(text: string): ChaosBeyReplayV1 {
  const decoded = decodeReplay(text);
  if (!decoded.ok) throw new Error(`the exported replay did not import: ${decoded.errors.map((e) => `${e.path}: ${e.code}`).join('; ')}`);
  return decoded.replay;
}

/** A re-sealed copy with `edit` applied: integrity passes, only playback can tell. */
type EditableFrame = Omit<ReplayFrame, 'first'> & { first: Omit<ReplayFrame['first'], 'held'> & { held: Action[] } };

function tampered(replay: ChaosBeyReplayV1, edit: (frames: EditableFrame[], checkpoints: { ticksCompleted: number; hash: string }[]) => void): ChaosBeyReplayV1 {
  const frames: EditableFrame[] = replay.frames.map((f) => ({ ...f, first: { ...f.first, held: [...f.first.held] } }));
  const checkpoints = replay.checkpoints.map((c) => ({ ...c }));
  edit(frames, checkpoints);
  const { integrity: _integrity, ...rest } = replay;
  return reimport(encodeReplay(sealReplay({ ...rest, frames, checkpoints })));
}

function describe(verdict: ReplayVerdict): string {
  if (verdict.status === 'refused') return `refused (${verdict.refusals.map((r) => r.code).join(', ')})`;
  if (verdict.comparison.status === 'diverged') return `diverged at TicksCompleted ${verdict.comparison.firstMismatch.ticksCompleted} (last match ${verdict.comparison.lastMatch ?? 'none'})`;
  return verdict.status;
}

export async function runReplayReproduction(fingerprint?: RuntimeFingerprint): Promise<ReplayReproductionResult> {
  const current = fingerprint ?? (await currentRuntimeFingerprint());
  const record = await simulateAiMatch({
    seed: REPLAY_REPRODUCTION_SEED,
    firstDefinition: ATTACK_ARCHETYPE,
    secondDefinition: DEFENSE_ARCHETYPE,
    maxTicks: MAX_TICKS,
    record: { fingerprint: current },
  });
  if (!record.replay) throw new Error('the match was not recorded');
  const replayText = encodeReplay(record.replay); // export
  const replay = reimport(replayText); // import
  const ticks = replay.frames.length;
  const failures: string[] = [];
  const notes: string[] = [];

  const verdict = await playReplayHeadless(replay, current);
  if (verdict.status === 'verified') notes.push(`replayed ${ticks} ticks, ${replay.checkpoints.length} checkpoints identical`);
  else failures.push(`clean replay: ${describe(verdict)}`);

  if (ticks <= EDIT_FROM + EDIT_LENGTH) {
    failures.push(`match too short for the negative checks (${ticks} ticks)`);
  } else {
    // Edited inputs: flip MoveForward on a whole range, which is certain to reach ticks where movement is read.
    const editedInputs = tampered(replay, (frames) => {
      for (let n = EDIT_FROM; n < EDIT_FROM + EDIT_LENGTH; n++) {
        const held = frames[n]!.first.held;
        frames[n]!.first.held = (held.includes(Action.MoveForward) ? held.filter((a) => a !== Action.MoveForward) : [...held, Action.MoveForward]).sort();
      }
    });
    const inputs = await playReplayHeadless(editedInputs, current);
    const at = inputs.status === 'diverged' && inputs.comparison.status === 'diverged' ? inputs.comparison.firstMismatch.ticksCompleted : null;
    if (at !== null && at > EDIT_FROM && at <= EDIT_FROM + EDIT_LENGTH) notes.push(`edited inputs caught at TicksCompleted ${at}`);
    else failures.push(`edited inputs (ticks ${EDIT_FROM}..${EDIT_FROM + EDIT_LENGTH - 1}) not caught in range: ${describe(inputs)}`);

    // One altered checkpoint: caught at exactly that checkpoint.
    const target = Math.floor(ticks / 2);
    const editedCheckpoint = tampered(replay, (_frames, checkpoints) => {
      const cp = checkpoints.find((c) => c.ticksCompleted === target)!;
      cp.hash = cp.hash === '0000000000000000' ? '0000000000000001' : '0000000000000000';
    });
    const cpVerdict = await playReplayHeadless(editedCheckpoint, current);
    if (cpVerdict.status === 'diverged' && cpVerdict.comparison.status === 'diverged' && cpVerdict.comparison.firstMismatch.ticksCompleted === target) {
      notes.push(`altered checkpoint caught at TicksCompleted ${target}`);
    } else {
      failures.push(`altered checkpoint at TicksCompleted ${target}: ${describe(cpVerdict)}`);
    }
  }

  // A real scenario preset: recorded after its setup, replayed with and without that setup.
  const preset = findScenarioPreset(REPLAY_REPRODUCTION_SCENARIO);
  if (!preset?.setup) {
    failures.push(`scenario preset "${REPLAY_REPRODUCTION_SCENARIO}" not found or has no setup`);
  } else {
    const scenario = await runScenario(preset, { record: { fingerprint: current } });
    if (!scenario.replay) {
      failures.push(`scenario "${preset.id}" was not recorded (${scenario.status}: ${scenario.detail})`);
    } else {
      const scenarioReplay = reimport(encodeReplay(scenario.replay));
      const withSetup = await playReplayHeadless(scenarioReplay, current, { setup: preset.setup });
      if (withSetup.status === 'verified') notes.push(`scenario "${preset.id}" replayed with its setup: ${scenarioReplay.frames.length} ticks identical`);
      else failures.push(`scenario "${preset.id}" replayed with its setup: ${describe(withSetup)}`);
      const withoutSetup = await playReplayHeadless(scenarioReplay, current);
      if (withoutSetup.status === 'diverged' && withoutSetup.comparison.status === 'diverged' && withoutSetup.comparison.firstMismatch.ticksCompleted === 0) {
        notes.push(`scenario "${preset.id}" without its setup caught at TicksCompleted 0`);
      } else {
        failures.push(`scenario "${preset.id}" without its setup: ${describe(withoutSetup)} (expected a divergence at TicksCompleted 0)`);
      }
    }
  }

  return { passed: failures.length === 0, detail: failures.length === 0 ? notes.join('; ') : failures.join('; '), ticks, replayText };
}
