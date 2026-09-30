import { expect, test } from '@playwright/test';

// M11: the approved Motion Lab movement directions A/B/C in the real app.
// - Pregame offers Movement A / B (default) / C; the match is built with it.
// - The Debug Lab takes `&motion=` and switches it from its panel; the
//   inspector shows the direction, grip and the attitude.

function watchErrors(page: import('@playwright/test').Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

test('Pregame: movement B by default, C can be chosen and the match plays with it', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/ChaosBey/?mode=play');
  await page.getByTestId('character-select-confirm').click({ timeout: 15_000 });
  await expect(page.getByTestId('pregame-motion-B')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('pregame-rules')).toContainText('Movement B — Physical Hybrid');
  await page.getByTestId('pregame-motion-C').click();
  await expect(page.getByTestId('pregame-rules')).toContainText('Movement C — Wild Mechanical');
  await page.getByTestId('pregame-start').click();
  await expect.poll(() => page.evaluate(() => window.__chaosBeyPlay?.getScreen()), { timeout: 15_000 }).toBe('match');
  await expect.poll(() => page.evaluate(() => window.__chaosBeyPlay!.getSession()!.getTickIndex()), { timeout: 15_000 }).toBeGreaterThan(120);
  const motion = await page.evaluate(() => window.__chaosBeyPlay!.getSession()!.matchConfig.motion);
  expect(motion).toBe('C');
  expect(errors).toEqual([]);
});

test('Debug Lab: &motion= picks the direction, the panel switches it, the inspector shows it', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/ChaosBey/?mode=debug-lab&motion=A');
  await expect.poll(() => page.evaluate(() => window.__chaosBeyDebugLab?.getSession()?.matchConfig.motion ?? null), { timeout: 20_000 }).toBe('A');
  await expect(page.getByTestId('debug-lab-motion')).toHaveValue('A');
  await page.getByTestId('debug-lab-motion').selectOption('C');
  await expect.poll(() => page.evaluate(() => window.__chaosBeyDebugLab!.getSession()?.matchConfig.motion ?? null), { timeout: 15_000 }).toBe('C');
  await page.evaluate(() => window.__chaosBeyDebugLab!.step(120));
  const surface = page.getByTestId('debug-lab-inspector').locator('[data-section="first-surface"]');
  await surface.locator('summary').click();
  await expect(surface).toContainText('C — Wild Mechanical');
  await expect(surface).toContainText('Grip (Motion Lab)');
  expect(errors).toEqual([]);
});
