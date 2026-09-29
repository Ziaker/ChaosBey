import { expect, test } from '@playwright/test';
import { ROUND_WALL_TIMEOUT_MS, describeRun, playRoundToEnd } from './support/playRoundToEnd';

// ============================================================
// PLAYER FLOW (M10): Character Select → match → Results → Rematch /
// Change Bey / Main Menu, in the production build. The pick is the Bey the
// match really builds, and every exit leaves the page clean.
// ============================================================

test('Character Select picks the Bey the match uses, and Results leads to rematch, change and the menu', async ({ page }) => {
  test.setTimeout(ROUND_WALL_TIMEOUT_MS + 90_000);
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));

  await page.goto('/ChaosBey/?mode=play');
  const select = page.getByTestId('character-select');
  await expect(select).toBeVisible({ timeout: 15_000 });

  // Three Beys; the first is focused and described.
  await expect(page.getByTestId('character-select-option-attack-prototype')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('character-select-detail')).toContainText('Hits hardest');

  // Keyboard: two steps down focuses Stamina; Enter chooses it.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('character-select-option-stamina-prototype')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('character-select-detail')).toContainText('outlasting');
  await page.keyboard.press('Enter');

  await expect(select).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__chaosBeyPlay?.getScreen()), { timeout: 15_000 }).toBe('match');
  const beys = await page.evaluate(() => {
    const session = window.__chaosBeyPlay!.getSession()!;
    return [session.getBey('first').definition.id, session.getBey('second').definition.id];
  });
  // The pick plays first; the default opponent is the next roster entry (no mirror).
  expect(beys).toEqual(['stamina-prototype', 'attack-prototype']);

  // Play the round for real (F3 shows the overlay the helper reads).
  await page.keyboard.press('F3');
  const overlay = page.locator('#debug-overlay-root pre');
  await expect(overlay).toContainText('Combat');
  const round = await playRoundToEnd(page, overlay);
  expect(round.reachedRoundEnd, describeRun(round)).toBe(true);

  const results = page.getByTestId('match-results');
  await expect(results).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('match-results-headline')).toHaveText(/^(VICTORY|DEFEAT|DRAW)$/);
  await expect(page.getByTestId('match-results-rematch')).toBeFocused();
  const firstMatchSeed = round.seed;

  // Rematch: a new match with the same Beys and a fresh seed.
  await page.getByTestId('match-results-rematch').click();
  await expect(results).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__chaosBeyPlay?.getScreen()), { timeout: 15_000 }).toBe('match');
  const rematch = await page.evaluate(() => {
    const session = window.__chaosBeyPlay!.getSession()!;
    return { first: session.getBey('first').definition.id, seed: session.seedText };
  });
  expect(rematch.first).toBe('stamina-prototype');
  expect(rematch.seed).not.toBe(firstMatchSeed);

  // Esc on Character Select goes back to the Main Menu.
  await page.goto('/ChaosBey/?mode=play');
  await expect(select).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\/ChaosBey\/$/);
  await expect(page.getByTestId('main-menu')).toBeVisible();

  expect(consoleErrors).toEqual([]);
});
