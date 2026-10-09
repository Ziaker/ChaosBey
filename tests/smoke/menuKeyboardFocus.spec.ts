import { expect, test } from './support/launchFixture';
import { BASELINE_MENU_URL, baselineUrl } from './presentationBaseline';

// Enter on a focused button activates that button, not the screen's main
// action: Tab (or a click) to Back and press Enter goes back.

test('Enter on a focused Back button goes back, on Character Select and Pregame', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  // Pregame: focus Back, Enter → Character Select (not "start match").
  await page.goto(baselineUrl('/ChaosBey/?mode=play'));
  await page.getByTestId('character-select-confirm').click({ timeout: 15_000 });
  await expect(page.getByTestId('pregame')).toBeVisible();
  await page.getByTestId('pregame-back').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('character-select')).toBeVisible();
  expect(await page.evaluate(() => window.__chaosBeyPlay!.getSession())).toBeNull();

  // Character Select: focus Back, Enter → Main Menu (not "choose this Bey").
  await page.getByTestId('character-select-back').focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(BASELINE_MENU_URL);
  await expect(page.getByTestId('main-menu')).toBeVisible();
  expect(errors).toEqual([]);
});

test('Enter on a focused Pause menu button runs that button', async ({ page }) => {
  await page.goto(baselineUrl('/ChaosBey/?mode=play'));
  await page.getByTestId('character-select-confirm').click({ timeout: 15_000 });
  await page.getByTestId('pregame-start').click();
  await expect.poll(() => page.evaluate(() => window.__chaosBeyPlay?.getScreen()), { timeout: 15_000 }).toBe('match');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pause-menu')).toBeVisible();
  // Tab from Resume to Restart round, then Enter: the round restarts (not resume).
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('pause-menu-restart')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('pause-menu')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__chaosBeyPlay?.getScreen()), { timeout: 15_000 }).toBe('match');
  expect(await page.evaluate(() => window.__chaosBeyPlay!.getSession()!.getTickIndex())).toBeLessThan(120);
});
