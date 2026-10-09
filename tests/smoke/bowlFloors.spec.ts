import { expect, test } from './support/launchFixture';
import { baselineUrl } from './presentationBaseline';
import { GAME_DEFAULTS, otherFloor } from './gameDefaults';

// M11 lane 4: the approved bowls A/B/C as playtest floors, in the real app.
// - Pregame offers Flat (baseline) / Bowl A (default) / B / C; the match is built on
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

/** What the Pregame's rules line says for each floor. */
const FLOOR_RULE_TEXT: Readonly<Record<string, string>> = { 'bowl-a': 'Bowl A — Parabolic dish', 'bowl-b': 'Bowl B — Funnel' };

test('Pregame: the default floor is a bowl (the stage is not flat), another floor can be chosen and the match plays on it', async ({ page }) => {
  const errors = watchErrors(page);
  const def = GAME_DEFAULTS.arenaFloor; // the funnel (Bowl B) today
  const other = otherFloor(def);
  expect(def, 'the default stage is not flat').not.toBe('flat');
  await page.goto(baselineUrl('/ChaosBey/?mode=play'));
  await page.getByTestId('character-select-confirm').click({ timeout: 15_000 });
  await expect(page.getByTestId(`pregame-arena-floor-${def}`)).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('pregame-rules')).toContainText(FLOOR_RULE_TEXT[def]!);
  await page.getByTestId(`pregame-arena-floor-${other}`).click();
  await expect(page.getByTestId('pregame-rules')).toContainText(FLOOR_RULE_TEXT[other]!);
  // The floor is independent of the look: changing the arena keeps it.
  await page.getByTestId('pregame-arena-tournament').click();
  await expect(page.getByTestId(`pregame-arena-floor-${other}`)).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('pregame-start').click();
  await expect.poll(() => page.evaluate(() => window.__chaosBeyPlay?.getScreen()), { timeout: 15_000 }).toBe('match');
  await expect.poll(() => page.evaluate(() => window.__chaosBeyPlay!.getSession()!.getTickIndex()), { timeout: 15_000 }).toBeGreaterThan(120);
  const state = await page.evaluate(() => {
    const session = window.__chaosBeyPlay!.getSession()!;
    const p = session.getBey('first').body.translation();
    return { floor: session.matchConfig.arenaFloor, depth: session.matchConfig.arenaBowlDepthM, x: p.x, y: p.y, z: p.z };
  });
  expect(state.floor).toBe(other);
  // On the bowl (h = depth (r/36)^k: k = 2 for Bowl A, 1.3 for Bowl B; 36 m radius, the Pregame's funnel depth), resting on the floor, never under it.
  const floorY = state.depth * (Math.hypot(state.x, state.z) / 36) ** (other === 'bowl-a' ? 2 : 1.3);
  expect(state.y).toBeGreaterThan(floorY);
  expect(errors).toEqual([]);
});

test('Debug Lab: &floor= picks the floor, the panel switches it, the inspector shows the floor under the Bey', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(baselineUrl('/ChaosBey/?mode=debug-lab&floor=bowl-c'));
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
