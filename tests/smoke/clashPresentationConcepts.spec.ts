import { expect, test } from '@playwright/test';

// Smoke test for the isolated Clash Presentation Lab prototype (not the
// game's Clash — that stays src/combat/clash/, untouched). Loads the
// production page, runs a few scenarios through all three presentation
// directions to a full resolution, and fails on any console error.

test('clash presentation lab loads, runs scenarios through A/B/C to resolution, no console errors', async ({ page }) => {
  test.setTimeout(180_000); // software WebGL in CI is slow
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('response', (r) => {
    if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
  });

  await page.goto('/ChaosBey/prototypes/clash-presentation-concepts/');
  await page.waitForFunction(() => Boolean(window.__clashLab) && window.__clashLab.state().ticks > 3, null, { timeout: 60_000 });
  const state = () => page.evaluate(() => window.__clashLab.state());

  // Ten scenarios, three directions, three tie styles, three approved camera presets.
  await expect(page.locator('.scenario')).toHaveCount(10);
  await expect(page.locator('.option[data-id]')).toHaveCount(3);
  await expect(page.locator('.tie-style')).toHaveCount(3);
  await expect(page.locator('#camera-presets .chip')).toHaveCount(3);

  for (const [key, id] of [['1', 'A'], ['3', 'C'], ['2', 'B']] as const) {
    await page.keyboard.press(key);
    await expect(page.locator(`.option[data-id="${id}"]`)).toHaveAttribute('aria-pressed', 'true');
    expect((await state()).direction).toBe(id);
  }

  await page.evaluate(() => window.__clashLab.setPaused(true));

  // A normal, close Clash reaches resolution on all three directions.
  for (const direction of ['A', 'B', 'C'] as const) {
    await page.evaluate((d) => window.__clashLab.setDirection(d), direction);
    await page.evaluate(() => window.__clashLab.loadScenario('balanced'));
    await page.evaluate(() => window.__clashLab.advance(5.5));
    expect((await state()).phase).toBe('Cooldown');
  }

  // The dedicated Tie scenario really reaches Cooldown with the Tie presentation wired up (no console error along the way).
  await page.evaluate(() => window.__clashLab.loadScenario('tie'));
  await page.evaluate(() => window.__clashLab.advance(5.5));
  expect((await state()).phase).toBe('Cooldown');

  // Ring-out resolution scenario runs the full physical continuation without erroring.
  await page.evaluate(() => window.__clashLab.loadScenario('resolution-ring-out'));
  await page.evaluate(() => window.__clashLab.advance(7.5));
  expect((await state()).phase).toBe('Cooldown');

  // Cooldown scenario: watch the 10s countdown at high speed without erroring.
  await page.evaluate(() => window.__clashLab.loadScenario('cooldown-watch'));
  await page.evaluate(() => window.__clashLab.advance(15));
  expect((await state()).phase).toBe('Idle');

  // Resume real-time playback briefly.
  await page.evaluate(() => window.__clashLab.loadScenario('comeback'));
  await page.evaluate(() => window.__clashLab.setPaused(false));
  const t0 = (await state()).ticks;
  await page.waitForFunction((t) => window.__clashLab.state().ticks > t + 5, t0, { timeout: 30_000 });

  expect(errors).toEqual([]);
});
