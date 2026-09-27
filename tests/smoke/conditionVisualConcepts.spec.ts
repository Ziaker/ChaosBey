import { expect, test } from '@playwright/test';

// Smoke test for the isolated Stamina & Stability visual prototype (visual
// exploration only, not gameplay). Loads the production build under the
// GitHub Pages subpath and exercises every direction, view and action,
// failing on any console error.

test('stamina & stability lab loads, switches directions and views, and reacts to every action', async ({ page }) => {
  test.setTimeout(180_000); // software WebGL in CI is slow
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('response', (r) => {
    if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
  });

  await page.goto('/ChaosBey/prototypes/condition-visual-concepts/');
  await page.waitForFunction(() => Boolean(window.__conditionLab) && window.__conditionLab.state().frames > 5);
  const state = () => page.evaluate(() => window.__conditionLab.state());
  const frames = async (n: number): Promise<void> => {
    const start = (await state()).frames;
    await page.waitForFunction((target) => window.__conditionLab.state().frames >= target, start + n, { timeout: 30_000 });
  };

  // Three directions, one at a time with keys 1–3.
  await expect(page.locator('.lang')).toHaveCount(3);
  for (const [key, id] of [['2', 'B'], ['3', 'C'], ['1', 'A']] as const) {
    await page.keyboard.press(key);
    await expect(page.locator(`.lang[data-lang="${id}"]`)).toHaveAttribute('aria-pressed', 'true');
    await frames(3);
  }

  // Mixing turns several on at once.
  await page.locator('#mix').check();
  await page.keyboard.press('2');
  await page.keyboard.press('3');
  expect((await state()).layers).toEqual({ A: true, B: true, C: true });

  // Tuning panel: 50 sliders; moving one marks it as changed.
  await expect(page.locator('#tune-groups input[type="range"]')).toHaveCount(50);
  const slider = page.locator('#tune-bShards');
  await slider.fill('10');
  await expect(page.locator('.tune-row').filter({ has: slider })).toHaveClass(/changed/);
  await frames(3);

  // Actions: break, recover, a hit, spin-out.
  await page.evaluate(() => window.__conditionLab.forceBreak());
  await frames(2);
  expect((await state()).broken).toBe(true);
  await expect(page.locator('#pill-broken')).toHaveClass(/on/);
  await page.evaluate(() => window.__conditionLab.forceRecover());
  await frames(2);
  expect((await state()).broken).toBe(false);
  await page.keyboard.press('c');
  await frames(40);
  await page.keyboard.press('o');
  await frames(5);
  expect((await state()).spinOut).toBeGreaterThan(0);

  // Manual sliders.
  await page.evaluate(() => window.__conditionLab.setManual(0.3, 0.5));
  await frames(2);
  const manual = await state();
  expect(manual.mode).toBe('manual');
  expect(manual.stamina).toBeCloseTo(0.3, 2);

  // Views: compare (3 worlds), both ladders (5 Beys), camera modes.
  await page.keyboard.press('q');
  await frames(3);
  expect((await state()).worlds).toBe(3);
  await expect(page.locator('.badge')).toHaveCount(3);
  await page.keyboard.press('e');
  await frames(3);
  expect(await state()).toMatchObject({ view: 'ladderStamina', beys: 5, camera: 'ladder' });
  await page.keyboard.press('z');
  await page.keyboard.press('t');
  await frames(40);
  expect(await state()).toMatchObject({ view: 'ladderStability', beys: 5 });
  await expect(page.locator('.ladder-label')).toHaveCount(5);
  await page.keyboard.press('l');
  await frames(3);
  expect(await state()).toMatchObject({ view: 'arena', camera: 'gameFar', worlds: 1 });
  await page.keyboard.press('v');
  await frames(3);
  expect((await state()).camera).toBe('close');

  // Back to the scripted fight.
  await page.keyboard.press('m');
  await frames(3);
  expect((await state()).mode).toBe('auto');

  expect(errors).toEqual([]);
});
