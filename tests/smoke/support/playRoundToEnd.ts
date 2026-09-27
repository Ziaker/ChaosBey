import type { Locator, Page } from '@playwright/test';

// ============================================================
// PLAY ONE REAL ROUND TO ITS END (smoke helper)
// Drives the real Player-vs-AI round with the same plain input a person
// would use (hold ArrowUp, tap Z every ~300 ms) until the debug overlay
// shows RoundEnd, and reports how long that took.
//
// The budget is SIMULATED time, read from the overlay's own tick counter,
// not wall-clock time, for two reasons:
// - A round only ends by KO or Ring-Out, and every boot draws a fresh
//   random seed, so round length varies a lot. With this exact input
//   against the real AI, 60 rounds in the production build (running at
//   1.00x real time) took 12.4 s at the median and up to 29.9 s, with 4
//   over 25 s; 300 seeds headless reached 45.6 s. A fixed 25-30 s
//   wall-clock budget failed on real, legitimate rounds (main went red on
//   repeatedMatchStability).
// - The fixed-step loop caps catch-up, so under load the simulation can
//   run slower than the wall clock (see the note on SIMULATED_TICKS in
//   aiRuntime.spec.ts).
//
// The ceiling matches the one the headless AI match runner already uses
// for the same reason (DEFAULT_AI_MATCH_MAX_TICKS in
// tests/deterministic/aiMatchRunner.ts): ~100 simulated seconds.
// ============================================================

/** ~100 simulated seconds at the fixed 60 Hz step. */
export const ROUND_BUDGET_TICKS = 6000;
/** Fail fast, as a stall, if the tick counter stops advancing for this long. */
const STALL_WALL_MS = 10_000;
const PLAYER_TAP_INTERVAL_MS = 300;
const PLAYER_TAP_HOLD_MS = 50;
/** Worst-case wall time for one round: the full budget at real time, plus slack for a slow machine. */
export const ROUND_WALL_TIMEOUT_MS = Math.round((ROUND_BUDGET_TICKS / 60) * 1000 * 1.5);

export interface RoundRun {
  readonly reachedRoundEnd: boolean;
  /** The overlay's "round" line at the end (e.g. FirstWinsByKo), or null. */
  readonly outcome: string | null;
  readonly seed: string | null;
  readonly simulatedSeconds: number;
  readonly wallSeconds: number;
  /** Why the loop stopped without RoundEnd, if it did. */
  readonly stoppedBecause: 'roundEnd' | 'budget' | 'stalled' | 'wallTimeout';
  readonly finalOverlayText: string;
}

export function overlayField(text: string, label: string): string | null {
  const line = text.split('\n').find((l) => l.startsWith(label));
  return line ? line.slice(label.length).trim() : null;
}

function tickOf(text: string): number | null {
  const match = /^tick\s+(\d+)/m.exec(text);
  return match ? Number(match[1]) : null;
}

/** A one-line summary for assertion messages, so a failure says which seed and how long. */
export function describeRun(run: RoundRun): string {
  return `seed ${run.seed ?? '?'}, ${run.simulatedSeconds.toFixed(1)} s simulated in ${run.wallSeconds.toFixed(1)} s wall, stopped: ${run.stoppedBecause}, outcome: ${run.outcome ?? 'none'}`;
}

export async function playRoundToEnd(page: Page, overlay: Locator): Promise<RoundRun> {
  const read = async (): Promise<string> => (await overlay.textContent()) ?? '';
  const startText = await read();
  const startTick = tickOf(startText) ?? 0;
  const seed = overlayField(startText, 'seed');
  const startedAt = Date.now();
  let lastTick = startTick;
  let lastTickChangeAt = startedAt;
  let text = startText;
  let stoppedBecause: RoundRun['stoppedBecause'] = 'wallTimeout';

  try {
    while (Date.now() - startedAt < ROUND_WALL_TIMEOUT_MS) {
      await page.keyboard.down('ArrowUp');
      await page.keyboard.down('z');
      await page.waitForTimeout(PLAYER_TAP_HOLD_MS);
      await page.keyboard.up('z');
      await page.waitForTimeout(PLAYER_TAP_INTERVAL_MS - PLAYER_TAP_HOLD_MS);

      text = await read();
      if (/^state\s+RoundEnd/m.test(text)) {
        stoppedBecause = 'roundEnd';
        break;
      }
      const tick = tickOf(text) ?? lastTick;
      if (tick !== lastTick) {
        lastTick = tick;
        lastTickChangeAt = Date.now();
      } else if (Date.now() - lastTickChangeAt > STALL_WALL_MS) {
        stoppedBecause = 'stalled';
        break;
      }
      if (tick - startTick >= ROUND_BUDGET_TICKS) {
        stoppedBecause = 'budget';
        break;
      }
    }
  } finally {
    await page.keyboard.up('ArrowUp');
  }

  return {
    reachedRoundEnd: stoppedBecause === 'roundEnd',
    outcome: overlayField(text, 'round'),
    seed,
    simulatedSeconds: ((tickOf(text) ?? lastTick) - startTick) / 60,
    wallSeconds: (Date.now() - startedAt) / 1000,
    stoppedBecause,
    finalOverlayText: text,
  };
}
