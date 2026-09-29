import { expect, test } from '@playwright/test';
import { ROUND_WALL_TIMEOUT_MS, describeRun, playRoundToEnd } from './support/playRoundToEnd';

// ============================================================
// REPEATED-MATCH STABILITY (M7 ALPHA-READINESS HARDENING)
// GDD section 9: there is no in-game Rematch/Restart flow yet (M9) — the
// only way to play "another match" today is a fresh page load. This smoke
// is the closest available proxy for "many partidas/restarts in a row":
// boot -> Combat -> RoundEnd, several times over fresh reloads, checking
// each one is clean (no console errors, a real terminal outcome) and that
// JS heap usage across reloads doesn't grow unbounded (a same-process leak
// surviving navigation, as opposed to ordinary per-page garbage).
// ============================================================

const RUNS = 3;
const BOOT_TIMEOUT_MS = 15_000;

test('several fresh boot -> Combat -> RoundEnd cycles in a row stay clean and stable', async ({ page }) => {
  // One test doing several full rounds, each budgeted in simulated time
  // (see playRoundToEnd.ts): typical rounds take seconds, but the timeout
  // has to cover RUNS worst-case rounds plus their boots.
  test.setTimeout(RUNS * (ROUND_WALL_TIMEOUT_MS + BOOT_TIMEOUT_MS) + 30_000);
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));

  const heapSamplesBytes: (number | null)[] = [];
  const outcomes: string[] = [];

  for (let run = 0; run < RUNS; run++) {
    await page.goto('/ChaosBey/?mode=play&quick');
    const overlay = page.locator('#debug-overlay-root pre');
    await expect(overlay, `run ${run}: boot`).toContainText('Combat', { timeout: BOOT_TIMEOUT_MS });

    const round = await playRoundToEnd(page, overlay);
    console.log(`[repeatedMatchStability smoke] run ${run}: ${describeRun(round)}`);
    expect(round.reachedRoundEnd, `run ${run}: should reach RoundEnd within the budget (${describeRun(round)})`).toBe(true);
    outcomes.push(round.outcome ?? 'unknown');

    const heapBytes = await page.evaluate(() => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null);
    heapSamplesBytes.push(heapBytes);
  }

  console.log(`[repeatedMatchStability smoke] outcomes: ${outcomes.join(', ')}`);
  console.log(`[repeatedMatchStability smoke] heap samples (MB): ${heapSamplesBytes.map((b) => (b === null ? 'n/a' : (b / 1_048_576).toFixed(1))).join(', ')}`);

  expect(outcomes.length).toBe(RUNS);
  for (const outcome of outcomes) {
    expect(['FirstWinsByKo', 'SecondWinsByKo', 'FirstWinsByRingOut', 'SecondWinsByRingOut', 'Draw']).toContain(outcome);
  }

  // Chromium exposes performance.memory without extra flags in this
  // environment; if it ever doesn't, this just skips the memory check
  // rather than failing the whole smoke over an unrelated API gap.
  const heapSamples = heapSamplesBytes.filter((b): b is number => b !== null);
  if (heapSamples.length === RUNS) {
    const first = heapSamples[0]!;
    const last = heapSamples[heapSamples.length - 1]!;
    // Generous bound: this catches an unbounded same-process leak across
    // reloads, not ordinary run-to-run GC noise.
    expect(last, 'JS heap after repeated fresh loads should not have ballooned').toBeLessThan(first * 3 + 50_000_000);
  }

  expect(consoleErrors).toEqual([]);
});
