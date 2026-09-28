// ============================================================
// FORCED INPUT CONTROLLER
// Wraps whatever drives a side (keyboard, AI, idle, script) and, on
// request, replaces its output with a short scripted input burst — the
// Debug Lab's "force attack state for test scenarios" (GDD section 70).
// Forcing through real inputs, rather than writing an attack state
// directly, keeps every forced Dash/Circular/Jump/Dodge going through the
// real AttackController/DriftController/DodgeController rules.
//
// The wrapped controller is still sampled every tick (its output is
// discarded while a burst plays), so an AI's own timers and RNG keep the
// same cadence they would have had.
// ============================================================

import { ScriptedController, type ScriptedFrame } from './ScriptedController';
import type { CombatController, ControllerActions, ControllerContext } from '../../input/actions/Action';

export class ForcedInputController implements CombatController {
  private burst: ScriptedController | null = null;
  private burstTicksRemaining = 0;

  constructor(private inner: CombatController) {}

  getInner(): CombatController {
    return this.inner;
  }

  setInner(inner: CombatController): void {
    this.inner = inner;
  }

  isForcing(): boolean {
    return this.burst !== null;
  }

  /** Plays `frames` (fromTick relative to now) for `durationTicks`, then hands control back. Replaces any burst in progress. */
  force(frames: readonly ScriptedFrame[], durationTicks: number): void {
    this.burst = new ScriptedController([...frames]);
    this.burstTicksRemaining = Math.max(1, Math.floor(durationTicks));
  }

  sampleActions(context: ControllerContext): ControllerActions {
    const innerActions = this.inner.sampleActions(context);
    if (!this.burst) return innerActions;
    const forced = this.burst.sampleActions(context);
    this.burstTicksRemaining--;
    if (this.burstTicksRemaining <= 0) this.burst = null;
    return forced;
  }
}
