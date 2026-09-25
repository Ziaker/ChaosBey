import { describe, expect, it } from 'vitest';
import { GameState, GameStateMachine } from '../../src/app/lifecycle/GameState';

describe('GameStateMachine', () => {
  it('starts in Boot', () => {
    expect(new GameStateMachine().getCurrentState()).toBe(GameState.Boot);
  });

  it('transitions and notifies listeners with from/to states', () => {
    const machine = new GameStateMachine();
    const seenTransitions: Array<[GameState, GameState]> = [];
    machine.onTransition((from, to) => seenTransitions.push([from, to]));

    machine.transitionTo(GameState.Sandbox);

    expect(machine.getCurrentState()).toBe(GameState.Sandbox);
    expect(seenTransitions).toEqual([[GameState.Boot, GameState.Sandbox]]);
  });

  it('does not notify listeners for a no-op transition to the same state', () => {
    const machine = new GameStateMachine();
    machine.transitionTo(GameState.Sandbox);

    let notifyCount = 0;
    machine.onTransition(() => notifyCount++);
    machine.transitionTo(GameState.Sandbox);

    expect(notifyCount).toBe(0);
  });
});
