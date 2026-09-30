import { expect, test } from '@playwright/test';

// Main Menu (GDD 1.2, 56) with the owner's Developer / Debug section
// (option C): developer Labs and Self Test sit only inside that section,
// open the existing modes through their ?mode= URLs, and Back / Escape /
// the browser Back button all return to the menu. The normal PLAY flow is
// covered end to end by boot.spec.ts.

test('Main Menu: Developer / Debug section opens Debug, Combat HUD Lab and Self Test', async ({ page }) => {
  test.setTimeout(90_000);
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));

  await page.goto('/ChaosBey/');
  const menu = page.getByTestId('main-menu');
  await expect(menu).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#app-canvas')).toBeHidden();

  // Top level: the player flow plus the section button; no developer tool.
  const play = page.getByTestId('main-menu-play');
  const developerToggle = page.getByTestId('main-menu-developer');
  const debugLab = page.getByTestId('main-menu-debug-lab');
  const combatHudLab = page.getByTestId('main-menu-combat-hud-lab');
  const selfTest = page.getByTestId('main-menu-self-test');
  const back = page.getByTestId('main-menu-back');
  await expect(play).toBeVisible();
  await expect(play).toBeFocused();
  await expect(developerToggle).toHaveText('Developer / Debug');
  await expect(developerToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(debugLab).toBeHidden();
  await expect(combatHudLab).toBeHidden();
  await expect(selfTest).toBeHidden();

  // Open the section: only the developer tools and Back are shown.
  await developerToggle.click();
  await expect(developerToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(debugLab).toBeVisible();
  await expect(combatHudLab).toBeVisible();
  await expect(selfTest).toBeVisible();
  await expect(debugLab).toBeFocused();
  await expect(play).toBeHidden();

  // Back returns to the top level, with focus on the section button.
  await back.click();
  await expect(play).toBeVisible();
  await expect(debugLab).toBeHidden();
  await expect(developerToggle).toBeFocused();

  // Keyboard: Enter opens the section, Escape closes it.
  await page.keyboard.press('Enter');
  await expect(debugLab).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(debugLab).toBeHidden();
  await expect(developerToggle).toBeFocused();

  // DEBUG LAB opens the existing Debug Lab through ?mode=debug-lab.
  await developerToggle.click();
  await debugLab.click();
  await expect(page).toHaveURL(/\/ChaosBey\/\?mode=debug-lab$/);
  await expect(page.getByTestId('debug-lab-status')).toContainText('RUNNING', { timeout: 15_000 });
  await expect(menu).toHaveCount(0);

  // The browser Back button returns to the menu.
  await page.goBack();
  await expect(page).toHaveURL(/\/ChaosBey\/$/);
  await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 15_000 });

  // COMBAT HUD LAB is a first-class developer Lab and boots a real MatchSession.
  await page.getByTestId('main-menu-developer').click();
  await page.getByTestId('main-menu-combat-hud-lab').click();
  await expect(page).toHaveURL(/\/ChaosBey\/\?mode=combat-hud-lab$/);
  await expect(page.getByTestId('combat-hud-lab')).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(() => window.__chaosBeyCombatHudLab?.getSession() !== null);
  await expect(page.getByTestId('main-menu')).toHaveCount(0);

  await page.goBack();
  await expect(page).toHaveURL(/\/ChaosBey\/$/);
  await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 15_000 });

  // SELF TEST opens the existing Self Test through ?mode=self-test.
  await page.getByTestId('main-menu-developer').click();
  await page.getByTestId('main-menu-self-test').click();
  await expect(page).toHaveURL(/\/ChaosBey\/\?mode=self-test$/);
  await expect(page.getByTestId('self-test-status')).toHaveText('idle', { timeout: 15_000 });
  await expect(page.getByTestId('main-menu')).toHaveCount(0);

  expect(consoleErrors).toEqual([]);
});

test('Main Menu: unknown modes fall back to the menu', async ({ page }) => {
  await page.goto('/ChaosBey/?mode=nonsense');
  await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 15_000 });
});
