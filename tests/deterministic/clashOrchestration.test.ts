// ============================================================
// CLASH ORCHESTRATION — buildMashActionSet SELF-TESTS
// The real-input side of the integration: mapping ControllerActions onto
// the opaque string identifiers ClashMash.ts's nextMashEventCount() reads.
// Full end-to-end Clash integration (real tickMatch()) lives in
// clashIntegration.test.ts — this file isolates just this pure mapping.
// ============================================================

import { describe, expect, it } from 'vitest';
import { buildMashActionSet } from '../../src/app/simulation/ClashOrchestration';
import { Action, type ControllerActions } from '../../src/input/actions/Action';

function actionsWith(pressedThisFrame: Action[]): ControllerActions {
  return {
    held: new Set(pressedThisFrame),
    pressedThisFrame: new Set(pressedThisFrame),
    attackHoldDurationSeconds: 0,
    jumpDriftHoldDurationSeconds: 0,
  };
}

describe('buildMashActionSet', () => {
  it('maps Attack/JumpDrift/Dodge (Z/X/C) through unchanged', () => {
    const set = buildMashActionSet(actionsWith([Action.Attack, Action.JumpDrift, Action.Dodge]));
    expect(set.size).toBe(3);
    expect(set.has(Action.Attack)).toBe(true);
    expect(set.has(Action.JumpDrift)).toBe(true);
    expect(set.has(Action.Dodge)).toBe(true);
  });

  it('filters out every non-mash action (movement/steering/pause/debug)', () => {
    const set = buildMashActionSet(actionsWith([Action.MoveForward, Action.SteerLeft, Action.Pause, Action.DebugToggle]));
    expect(set.size).toBe(0);
  });

  it('mixes correctly — only the Z/X/C subset survives alongside unrelated actions pressed the same frame', () => {
    const set = buildMashActionSet(actionsWith([Action.MoveForward, Action.Attack, Action.SteerRight]));
    expect(Array.from(set)).toEqual([Action.Attack]);
  });

  it('an empty pressedThisFrame maps to an empty set', () => {
    expect(buildMashActionSet(actionsWith([])).size).toBe(0);
  });
});
