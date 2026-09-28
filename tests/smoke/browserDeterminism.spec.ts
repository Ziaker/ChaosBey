import { expect, test, type Page } from '@playwright/test';

// M9 lane E (hardening), in the browser (the production build on GitHub
// Pages' base path): real-time (1×) pacing, max-speed acceleration and a
// repeated run of the same AI-vs-AI batch must end every match on the same
// tick, with the same outcome and the same canonical state hash.
//
// Supported determinism (owner decision): reproduction within the same
// build in the project's reference environment. Chromium is the CI
// reference, not a requirement for players; bit-for-bit equality across
// JavaScript engines, browser versions or Node is not part of the
// contract (Node's V8 differs from Chromium's by up to 1 ULP in
// Math.sin/cos/pow).

const SEED = 'browser-determinism';
const MAX_TICKS = 600;

interface MatchSummary {
  seed: string;
  ticks: number;
  outcome: string | null;
  finalStateHash: string | null;
}

async function runBatch(page: Page, speed: number): Promise<MatchSummary[]> {
  return page.evaluate(
    async ({ seed, maxTicks, speed }) => {
      const handle = window.__chaosBeySelfTest!;
      handle.setSpeed(speed);
      const report = await handle.runBatch({ seeds: [seed], maxTicks });
      return report.entries.map((e) => ({ seed: e.seed, ticks: e.ticks, outcome: e.outcome, finalStateHash: e.finalStateHash }));
    },
    { seed: SEED, maxTicks: MAX_TICKS, speed },
  );
}

test('in the browser, 1× real time, max speed and a repeated run give identical matches', async ({ page }) => {
  test.setTimeout(240_000);
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));

  await page.goto('/ChaosBey/?mode=self-test');
  await expect(page.getByTestId('self-test-status')).toHaveText('idle', { timeout: 15_000 });
  // Two matchups keep the real-time run short (the others stay covered by the Node batches).
  const boxes = page.locator('input[data-matchup]');
  for (let i = 2; i < (await boxes.count()); i++) await boxes.nth(i).uncheck();

  const maxSpeed = await runBatch(page, 0);
  const repeated = await runBatch(page, 0);
  const realTime = await runBatch(page, 1);

  // Not vacuous: two real matches, each ending on a real hash.
  expect(maxSpeed).toHaveLength(2);
  for (const match of maxSpeed) {
    expect(match.ticks).toBeGreaterThan(30);
    expect(match.finalStateHash).toMatch(/^[0-9a-f]{16}$/);
  }
  expect(repeated).toEqual(maxSpeed);
  expect(realTime).toEqual(maxSpeed);
  expect(consoleErrors).toEqual([]);
});
