import { expect, test } from '@playwright/test';

// Smoke test for the isolated Camera Lab prototype (not the game's camera).
// Loads the production page under the GitHub Pages subpath, runs real
// fights through all three camera directions, switches views, scenarios
// and speed, edits a slider, and fails on any console error.

test('camera lab loads, runs real fights through A/B/C and keeps both Beys in frame', async ({ page }) => {
  test.setTimeout(180_000); // software WebGL in CI is slow
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('response', (r) => {
    if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
  });

  await page.goto('/ChaosBey/prototypes/camera-concepts/');
  await page.waitForFunction(() => Boolean(window.__cameraLab) && !window.__cameraLab.state().loading && window.__cameraLab.state().frames > 3, null, { timeout: 60_000 });
  const lab = () => page.evaluate(() => window.__cameraLab.state());

  // Three directions, twelve scenarios.
  await expect(page.locator('.preset')).toHaveCount(3);
  await expect(page.locator('.scenario')).toHaveCount(12);
  for (const [key, id] of [['1', 'A'], ['3', 'C'], ['2', 'B']] as const) {
    await page.keyboard.press(key);
    await expect(page.locator(`.preset[data-id="${id}"]`)).toHaveAttribute('aria-pressed', 'true');
  }

  // Compare view renders three viewports on the same fight.
  await page.keyboard.press('q');
  await page.evaluate(() => window.__cameraLab.setPaused(true));
  await page.evaluate(() => window.__cameraLab.advance(1));
  expect((await lab()).viewports).toBe(3);
  await expect(page.locator('.vp-hud:not([hidden])')).toHaveCount(3);

  // Clash: the director switches to its Clash mode on the real Clash.
  await page.evaluate(() => window.__cameraLab.loadScenario('clash-setup'));
  await page.evaluate(() => window.__cameraLab.advance(3.5));
  expect((await lab()).mode).toBe('Clash');

  // Final hit: KO → Finisher.
  await page.evaluate(() => window.__cameraLab.loadScenario('final-hit'));
  await page.evaluate(() => window.__cameraLab.advance(2.5));
  expect((await lab()).mode).toBe('Finisher');

  // A normal duel stretch: every preset keeps the opponent in frame.
  await page.evaluate(() => window.__cameraLab.loadScenario('normal-duel'));
  await page.evaluate(() => window.__cameraLab.advance(8));
  const read = await page.evaluate(() => window.__cameraLab.readability());
  for (const id of ['A', 'B', 'C'] as const) {
    expect(read[id].opponentInFrame).toBeGreaterThan(0.9);
    expect(read[id].maxFov).toBeLessThanOrEqual(120);
  }

  // A slider edit is live and marked; ↺ puts it back.
  const slider = page.locator('#param-baseFov');
  await slider.fill('80');
  const row = page.locator('.tune-row').filter({ has: slider });
  await expect(row).toHaveClass(/changed/);
  await row.locator('.mini').click();
  await expect(row).not.toHaveClass(/changed/);

  // Back to single view, play in real time at a different speed.
  await page.keyboard.press('q');
  await page.keyboard.press('s');
  await page.evaluate(() => window.__cameraLab.setPaused(false));
  const t0 = (await lab()).ticks;
  await page.waitForFunction((t) => window.__cameraLab.state().ticks > t + 5, t0, { timeout: 30_000 });
  expect((await lab()).viewports).toBe(1);

  expect(errors).toEqual([]);
});
