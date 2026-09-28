import { expect, test } from '@playwright/test';

// Browser Self Test smoke (GDD 66, 162–164): ?mode=self-test runs a real
// AI-vs-AI batch on the shared core, at real time and accelerated, shows
// the GDD 163 report, runs a scenario preset, and logs no console error.

test('Self Test: batch at 1x and accelerated, GDD 163 report, scenario preset, download', async ({ page }) => {
  test.setTimeout(180_000);
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));

  await page.goto('/ChaosBey/?mode=self-test');
  const status = page.getByTestId('self-test-status');
  await expect(status).toHaveText('idle', { timeout: 15_000 });
  await expect(page.locator('#app-canvas')).toBeHidden();

  // Real time (1x): about 60 fixed ticks per second.
  const tickNow = () => page.evaluate(() => window.__chaosBeySelfTest!.simulatedTicks());
  await page.evaluate(() => {
    window.__chaosBeySelfTest!.setSpeed(1);
    void window.__chaosBeySelfTest!.runBatch({ seeds: ['smoke-rt-0', 'smoke-rt-1', 'smoke-rt-2', 'smoke-rt-3'], maxTicks: 6000 });
  });
  await expect.poll(tickNow).toBeGreaterThan(5);
  const t0 = await tickNow();
  await page.waitForTimeout(2000);
  const realTimeRate = ((await tickNow()) - t0) / 2;
  expect(realTimeRate).toBeGreaterThan(20);
  expect(realTimeRate).toBeLessThan(120);

  // 64x: far more fixed ticks per second, same fixed delta.
  await page.evaluate(() => window.__chaosBeySelfTest!.setSpeed(64));
  const t1 = await tickNow();
  await page.waitForTimeout(1000);
  const acceleratedRate = (await tickNow()) - t1;
  expect(acceleratedRate).toBeGreaterThan(realTimeRate * 4);
  await page.evaluate(() => window.__chaosBeySelfTest!.stop());
  await expect(status).toContainText('batch stopped', { timeout: 30_000 });

  // A short batch at max speed through the UI, to the report.
  await page.getByTestId('self-test-seed-count').fill('1');
  const boxes = page.locator('input[data-matchup]');
  for (let i = 2; i < (await boxes.count()); i++) await boxes.nth(i).uncheck();
  await page.getByTestId('self-test-speed').selectOption('0');
  await page.getByTestId('self-test-run-batch').click();
  await expect(status).toContainText('batch done: 2 matches', { timeout: 120_000 });
  const report = page.getByTestId('self-test-report');
  for (const field of ['matches', 'pass / fail', 'crashes', 'hangs', 'invalid states', 'average duration', 'ring-outs / KOs', 'Clash count', 'divergence', 'acceleration']) {
    await expect(report).toContainText(field);
  }
  // M9: every match was replayed from its own recording; none diverged.
  await expect(report).toContainText(/divergence\s+0 of 2 replays/);

  // A scenario preset.
  await page.getByTestId('self-test-preset').selectOption('clash');
  await page.getByTestId('self-test-run-preset').click();
  await expect(page.getByTestId('self-test-scenarios')).toContainText(/PASSED\s+Test Clash/, { timeout: 60_000 });

  // M9: the real replay-reproduction preset (record, export, import, replay, negative checks).
  await page.getByTestId('self-test-preset').selectOption('replay-reproduction');
  await page.getByTestId('self-test-run-preset').click();
  await expect(page.getByTestId('self-test-scenarios')).toContainText(/PASSED\s+Test Replay Reproduction/, { timeout: 120_000 });

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('self-test-download').click()]);
  expect(download.suggestedFilename()).toMatch(/^chaosbey-self-test-.*\.json$/);

  expect(consoleErrors).toEqual([]);
});
