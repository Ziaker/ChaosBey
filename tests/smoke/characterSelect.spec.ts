import { expect, test } from '@playwright/test';

test('M10 player flow: Main Menu -> Character Select -> Pregame keeps the selected Bey', async ({ page }) => {
  test.setTimeout(90_000);
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));

  await page.goto('/ChaosBey/');
  await page.getByTestId('main-menu-play').click();
  await expect(page).toHaveURL(/\/ChaosBey\/\?mode=character-select$/);
  await expect(page.getByTestId('character-select')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#app-canvas')).toBeVisible();
  await expect(page.getByTestId('character-select-attack')).toHaveAttribute('aria-pressed', 'true');

  // Keyboard navigation is part of the player flow, not mouse-only UI.
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('character-select-defense')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('character-select-role')).toHaveText('DEFENSE');
  await expect(page.getByTestId('character-select-stats')).toContainText('8/10');

  await page.getByTestId('character-select-continue').click();
  await expect(page).toHaveURL(/\/ChaosBey\/\?mode=pregame&playerBey=defense-prototype$/);
  await expect(page.getByTestId('pregame-shell')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('pregame-player-bey')).toContainText('Defense');
  await expect(page.locator('#app-canvas')).toBeHidden();

  await page.getByTestId('pregame-back').click();
  await expect(page).toHaveURL(/\/ChaosBey\/\?mode=character-select&playerBey=defense-prototype$/);
  await expect(page.getByTestId('character-select-defense')).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });

  expect(consoleErrors).toEqual([]);
});
