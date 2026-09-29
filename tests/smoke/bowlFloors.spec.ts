import { expect, test } from '@playwright/test';

// M11 lane 4: the approved bowls A/B/C as playtest floors, in the real app.
// - Pregame offers Flat (default) / Bowl A / B / C; the match is built on
//   the chosen floor, and the Bey stands on it.
// - The Debug Lab takes `&floor=` and switches floors from its panel.

function watchErrors(page: import('@playwright/test').Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

test('Pregame: Flat by default, a bowl can be chosen and the match plays on it', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/ChaosBey/?mode=play');
  await page.getByTestId('character-select-confirm').click({ timeout: 15_000 });
  await expect(page.getByTestId('pregame-arena-floor-flat')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('pregame-arena-floor-bowl-a').click();
  await expect(page.getByTestId('pregame-rules')).toContainText('Bowl A — Parabolic dish');
  // The floor is independent of the look: changing the arena keeps it.
  await page.getByTestId('pregame-arena-tournament').click();
  await expect(page.getByTestId('pregame-arena-floor-bowl-a')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('pregame-start').click();
  await expect.poll(() => page.evaluate(() => window.__chaosBeyPlay?.getScreen()), { timeout: 15_000 }).toBe('match');
  await expect.poll(() => page.evaluate(() => window.__chaosBeyPlay!.getSession()!.getTickIndex()), { timeout: 15_000 }).toBeGreaterThan(120);
  const state = await page.evaluate(() => {
    const session = window.__chaosBeyPlay!.getSession()!;
    const p = session.getBey('first').body.translation();
    return { floor: session.matchConfig.arenaFloor, x: p.x, y: p.y, z: p.z };
  });
  expect(state.floor).toBe('bowl-a');
  // On the bowl (h = 3.2 (r/12)²), resting on the floor, never under it.
  const floorY = 3.2 * (Math.hypot(state.x, state.z) / 12) ** 2;
  expect(state.y).toBeGreaterThan(floorY);
  expect(errors).toEqual([]);
});

test('Debug Lab: &floor= picks the floor, the panel switches it, the inspector shows the floor under the Bey', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/ChaosBey/?mode=debug-lab&floor=bowl-c');
  await expect.poll(() => page.evaluate(() => window.__chaosBeyDebugLab?.getSession()?.matchConfig.arenaFloor ?? null), { timeout: 20_000 }).toBe('bowl-c');
  await expect(page.getByTestId('debug-lab-arena-floor')).toHaveValue('bowl-c');
  await page.getByTestId('debug-lab-arena-floor').selectOption('bowl-b');
  await expect.poll(() => page.evaluate(() => window.__chaosBeyDebugLab!.getSession()?.matchConfig.arenaFloor ?? null), { timeout: 15_000 }).toBe('bowl-b');
  await page.evaluate(() => window.__chaosBeyDebugLab!.step(120));
  const linear = page.getByTestId('debug-lab-inspector').locator('[data-section="first-linear"]');
  await linear.locator('summary').click();
  await expect(linear).toContainText('Bowl B — Funnel');
  await expect(linear).toContainText('Downhill pull');
  expect(errors).toEqual([]);
});
