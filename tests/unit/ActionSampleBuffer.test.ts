// ============================================================
// ACTION SAMPLE BUFFER — FOCUS LOSS (M7 ALPHA-READINESS HARDENING)
// Regression: a gameplay key pressed the instant before focus is lost
// (KeyboardController's window 'blur' -> clearHoldTracking()) must not
// still surface as pressedThisFrame afterward — with currentlyDown
// already cleared by the same blur, that would fire a "ghost" action
// (e.g. an Attack) once the player has already left the window, and
// break every caller's pressedThisFrame ⊆ held assumption (see e.g.
// tests/deterministic/aiBatchSelfTest.test.ts's assertContract).
// ============================================================

import { describe, expect, it } from 'vitest';
import { Action } from '../../src/input/actions/Action';
import { ActionSampleBuffer } from '../../src/input/devices/ActionSampleBuffer';

describe('ActionSampleBuffer focus loss', () => {
  it('drops a gameplay press that has not been sampled yet when focus is lost', () => {
    const buffer = new ActionSampleBuffer();
    buffer.registerPress(Action.Attack);
    buffer.clearHoldTracking();
    const sample = buffer.sample(1 / 60, false);
    expect(sample.pressedThisFrame.has(Action.Attack)).toBe(false);
  });

  it('still keeps a UI action (Pause) pressed just before focus loss — losing the very press that likely caused it (e.g. Alt+Tab) would be more surprising', () => {
    const buffer = new ActionSampleBuffer();
    buffer.registerPress(Action.Pause);
    buffer.clearHoldTracking();
    const sample = buffer.sample(1 / 60, false);
    expect(sample.pressedThisFrame.has(Action.Pause)).toBe(true);
  });

  it('still clears the hold-duration clock on focus loss (pre-existing behavior, unaffected by the pending-press fix)', () => {
    const buffer = new ActionSampleBuffer();
    buffer.registerPress(Action.Attack);
    buffer.sample(1 / 60, false); // flush the press so Attack is now "held".
    buffer.registerPress(Action.Attack); // re-press without a release in between would be a no-op in practice, but the hold clock is what matters here.
    buffer.clearHoldTracking();
    const sample = buffer.sample(1 / 60, false);
    expect(sample.holdDuration(Action.Attack)).toBe(0);
  });

  it('a press after focus loss is delivered normally (the fix only drops what was already pending)', () => {
    const buffer = new ActionSampleBuffer();
    buffer.clearHoldTracking();
    buffer.registerPress(Action.Attack);
    const sample = buffer.sample(1 / 60, false);
    expect(sample.pressedThisFrame.has(Action.Attack)).toBe(true);
  });
});
