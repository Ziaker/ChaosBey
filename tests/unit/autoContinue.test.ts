// Owner playtest (after M11): after a round or match result, the dialog's own
// primary action (Next round / Rematch) runs by itself after 4 s, unless the
// player continues first or stops it — and never twice.

import { describe, expect, it } from 'vitest';
import { AUTO_CONTINUE_S, AutoContinueCountdown, type CountdownClock } from '../../src/app/frontend/AutoContinue';

class FakeClock implements CountdownClock {
  t = 0;
  private timers: { at: number; fn: () => void; id: number }[] = [];
  private nextId = 1;
  now(): number {
    return this.t;
  }
  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.timers.push({ at: this.t + ms, fn, id });
    return id;
  }
  clearTimeout(handle: unknown): void {
    this.timers = this.timers.filter((x) => x.id !== handle);
  }
  advance(ms: number): void {
    this.t += ms;
    const due = this.timers.filter((x) => x.at <= this.t);
    this.timers = this.timers.filter((x) => x.at > this.t);
    for (const x of due) x.fn();
  }
}

describe('result auto-continue (4 s)', () => {
  it('is 4 seconds', () => {
    expect(AUTO_CONTINUE_S).toBe(4);
  });

  it('runs the action by itself after 4 s, once, with the countdown going 4 → 0', () => {
    const clock = new FakeClock();
    let runs = 0;
    const c = new AutoContinueCountdown(AUTO_CONTINUE_S, () => runs++, clock);
    expect(c.remainingS()).toBeCloseTo(4, 5);
    clock.advance(2500);
    expect(c.remainingS()).toBeCloseTo(1.5, 5);
    expect(runs).toBe(0);
    clock.advance(1499);
    expect(runs).toBe(0);
    clock.advance(1);
    expect(runs).toBe(1);
    expect(c.getState()).toBe('fired');
    clock.advance(10_000);
    expect(runs).toBe(1);
  });

  it('Continue before 4 s runs it at once and cancels the rest of the countdown', () => {
    const clock = new FakeClock();
    let runs = 0;
    const c = new AutoContinueCountdown(AUTO_CONTINUE_S, () => runs++, clock);
    clock.advance(1200);
    expect(c.fire(true)).toBe(true);
    expect(runs).toBe(1);
    clock.advance(5000);
    expect(runs).toBe(1);
  });

  it('Stop cancels it: the dialog stays, nothing runs; Continue afterwards still does', () => {
    const clock = new FakeClock();
    let runs = 0;
    const c = new AutoContinueCountdown(AUTO_CONTINUE_S, () => runs++, clock);
    clock.advance(1000);
    c.stop();
    expect(c.getState()).toBe('stopped');
    expect(c.remainingS()).toBe(0);
    clock.advance(10_000);
    expect(runs).toBe(0);
    expect(c.fire(true)).toBe(true);
    expect(runs).toBe(1);
  });

  it('a press on the same instant the timer ends starts one transition, not two', () => {
    const clock = new FakeClock();
    let runs = 0;
    const c = new AutoContinueCountdown(AUTO_CONTINUE_S, () => runs++, clock);
    clock.advance(4000); // the timer fires…
    expect(c.fire(true)).toBe(false); // …and the press in the same instant does nothing more
    expect(runs).toBe(1);

    const d = new AutoContinueCountdown(AUTO_CONTINUE_S, () => runs++, clock);
    expect(d.fire(true)).toBe(true); // the press first…
    clock.advance(4000); // …then the timer's moment: nothing more
    expect(runs).toBe(2);
  });

  it('closing the dialog another way (Leave match, Main Menu) never fires it later', () => {
    const clock = new FakeClock();
    let runs = 0;
    const c = new AutoContinueCountdown(AUTO_CONTINUE_S, () => runs++, clock);
    clock.advance(1000);
    c.dispose();
    clock.advance(10_000);
    expect(runs).toBe(0);
  });
});
