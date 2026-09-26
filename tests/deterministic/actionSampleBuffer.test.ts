// ============================================================
// ACTION SAMPLE BUFFER SELF-TESTS
// Milestone 4 hitstop-safe input buffering: a gameplay tap made while
// simulation is frozen must not be lost, and hold-duration/charge clocks
// must not advance while frozen — while UI actions stay responsive
// through the freeze regardless.
// ============================================================

import { describe, expect, it } from 'vitest';
import { Action } from '../../src/input/actions/Action';
import { ActionSampleBuffer } from '../../src/input/devices/ActionSampleBuffer';

const DT = 1 / 60;

describe('ActionSampleBuffer — tap buffering across a hitstop freeze', () => {
  it('a tap made entirely during a frozen window is delivered exactly once, on the first unfrozen sample afterward', () => {
    const buffer = new ActionSampleBuffer();

    // The tap happens while frozen.
    buffer.registerPress(Action.Dodge);

    const duringFreeze = buffer.sample(DT, true);
    expect(duringFreeze.pressedThisFrame.has(Action.Dodge)).toBe(false);

    // Freeze continues a few more ticks — still buffered, not lost.
    const stillFrozen = buffer.sample(DT, true);
    expect(stillFrozen.pressedThisFrame.has(Action.Dodge)).toBe(false);

    // First real tick after the freeze ends — delivered now.
    const firstUnfrozen = buffer.sample(DT, false);
    expect(firstUnfrozen.pressedThisFrame.has(Action.Dodge)).toBe(true);

    // Exactly once — not re-delivered on the next tick.
    const secondUnfrozen = buffer.sample(DT, false);
    expect(secondUnfrozen.pressedThisFrame.has(Action.Dodge)).toBe(false);
  });

  it('coalesces multiple presses of the same action during a freeze into a single delivered edge', () => {
    const buffer = new ActionSampleBuffer();

    buffer.registerPress(Action.JumpDrift);
    buffer.registerRelease(Action.JumpDrift);
    buffer.registerPress(Action.JumpDrift);
    buffer.sample(DT, true); // still frozen — buffered.

    const delivered = buffer.sample(DT, false);
    expect(delivered.pressedThisFrame.has(Action.JumpDrift)).toBe(true);

    const next = buffer.sample(DT, false);
    expect(next.pressedThisFrame.has(Action.JumpDrift)).toBe(false);
  });

  it('a tap made just before a freeze is unaffected — it was already flushed on its own unfrozen sample', () => {
    const buffer = new ActionSampleBuffer();
    buffer.registerPress(Action.Attack);

    const unfrozen = buffer.sample(DT, false);
    expect(unfrozen.pressedThisFrame.has(Action.Attack)).toBe(true);

    const frozenAfter = buffer.sample(DT, true);
    expect(frozenAfter.pressedThisFrame.has(Action.Attack)).toBe(false);
  });
});

describe('ActionSampleBuffer — hold-duration clock freezes with the simulation', () => {
  it('does not advance while frozen, and resumes correctly once unfrozen', () => {
    const buffer = new ActionSampleBuffer();
    buffer.registerPress(Action.Attack);

    const first = buffer.sample(DT, false);
    expect(first.holdDuration(Action.Attack)).toBeCloseTo(DT, 5);

    // Frozen for several ticks — held the whole time, but no charge time
    // should accrue.
    for (let i = 0; i < 10; i++) {
      const frozen = buffer.sample(DT, true);
      expect(frozen.holdDuration(Action.Attack)).toBeCloseTo(DT, 5);
    }

    // Resumes advancing from where it left off, as if the freeze never
    // happened.
    const afterFreeze = buffer.sample(DT, false);
    expect(afterFreeze.holdDuration(Action.Attack)).toBeCloseTo(DT * 2, 5);
  });

  it('a press that happens while frozen starts its hold-duration clock at 0 and stays there until unfrozen', () => {
    const buffer = new ActionSampleBuffer();
    buffer.registerPress(Action.JumpDrift);

    const frozen1 = buffer.sample(DT, true);
    expect(frozen1.holdDuration(Action.JumpDrift)).toBe(0);
    const frozen2 = buffer.sample(DT, true);
    expect(frozen2.holdDuration(Action.JumpDrift)).toBe(0);

    const unfrozen = buffer.sample(DT, false);
    expect(unfrozen.holdDuration(Action.JumpDrift)).toBeCloseTo(DT, 5);
  });
});

describe('ActionSampleBuffer — UI actions stay responsive through a freeze', () => {
  it('flushes DebugToggle/Pause immediately even while the simulation is frozen', () => {
    const buffer = new ActionSampleBuffer();
    buffer.registerPress(Action.DebugToggle);

    const duringFreeze = buffer.sample(DT, true);
    expect(duringFreeze.pressedThisFrame.has(Action.DebugToggle)).toBe(true);

    // Already flushed — not delivered again later.
    const next = buffer.sample(DT, false);
    expect(next.pressedThisFrame.has(Action.DebugToggle)).toBe(false);
  });

  it('a UI action pressed during a freeze does not also get buffered as a pending gameplay press', () => {
    const buffer = new ActionSampleBuffer();
    buffer.registerPress(Action.Pause);
    buffer.sample(DT, true);

    // If Pause had leaked into the gameplay buffer, it would show up here
    // too — it must not.
    const later = buffer.sample(DT, false);
    expect(later.pressedThisFrame.has(Action.Pause)).toBe(false);
  });
});

describe('ActionSampleBuffer — every UI action stays responsive through a freeze', () => {
  // Regression: SettingsToggle (F4) was missing from the UI-action set, so a
  // press during hitstop was held back like a gameplay input until the
  // freeze ended, unlike F3.
  it.each([Action.Pause, Action.DebugToggle, Action.SettingsToggle])('%s is delivered on the frozen sample itself', (action) => {
    const buffer = new ActionSampleBuffer();
    buffer.registerPress(action);
    expect(buffer.sample(DT, true).pressedThisFrame.has(action)).toBe(true);
  });
});
