import { expect, test } from '@playwright/test';
import { baselineUrl } from './presentationBaseline';

// Owner, 2026-10-02 (Lote 9): the Pregame's Advanced rules are grouped (Movement, Jump, Combat, Arena, Round rules,
// Visual), every value shows its default, Reset to defaults restores them, a moved value reaches the real match, and
// the last setup comes back after a reload.

test('Pregame advanced rules: groups, defaults, reset, into the match, remembered after a reload', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(baselineUrl('/ChaosBey/?mode=play'));
  await page.getByTestId('character-select').waitFor({ timeout: 20_000 });
  await page.keyboard.press('Enter');
  await page.getByTestId('pregame').waitFor();
  await page.getByTestId('pregame-advanced').locator('summary').click();

  for (const group of ['movement', 'jump', 'combat', 'arena', 'round', 'visual']) await expect(page.getByTestId(`pregame-group-${group}`)).toBeVisible();
  await expect(page.getByTestId('pregame-bowl-depth-default')).toHaveText('default 8.50 m');
  await expect(page.getByTestId('pregame-round-time-limit-value')).toHaveText('no timer');

  await page.getByTestId('pregame-bowl-depth').fill('4');
  await page.getByTestId('pregame-top-speed').fill('1.2');
  await page.getByTestId('pregame-win-spin-out').uncheck();
  await expect(page.getByTestId('pregame-bowl-depth-value')).toHaveText('4.00 m');
  await expect(page.getByTestId('pregame-rules')).toContainText('Bowl depth 4.00 m');
  await expect(page.getByTestId('pregame-rules')).toContainText('top speed ×1.20');
  await expect(page.getByTestId('pregame-rules')).not.toContainText('spin-out (Stamina 0)');

  // Reset to defaults brings everything back.
  await page.getByTestId('pregame-reset-defaults').click();
  await expect(page.getByTestId('pregame-bowl-depth-value')).toHaveText('8.50 m');
  await expect(page.getByTestId('pregame-win-spin-out')).toBeChecked();

  // Move two values again and play: they reach the match.
  await page.getByTestId('pregame-bowl-depth').fill('4');
  await page.getByTestId('pregame-jump-cooldown').fill('1');
  // Item 11 (owner, 2026-10-04): speed → damage and "Dash keeps momentum" are Combat options too.
  await expect(page.getByTestId('pregame-speed-damage-value')).toHaveText('50%');
  await expect(page.getByTestId('pregame-dash-carries-speed')).toBeChecked();
  await page.getByTestId('pregame-speed-damage').fill('1');
  await page.getByTestId('pregame-dash-carries-speed').uncheck();
  await expect(page.getByTestId('pregame-rules')).toContainText('speed → damage 100%');
  await page.getByTestId('pregame-start').click();
  await expect.poll(() => page.evaluate(() => window.__chaosBeyPlay?.getScreen()), { timeout: 20_000 }).toBe('match');
  const config = await page.evaluate(() => window.__chaosBeyPlay!.getSession()!.matchConfig);
  expect(config).toMatchObject({ arenaBowlDepthM: 4, jumpCooldownS: 1, speedDamageGain: 1, dashCarriesSpeed: false });

  // Reload: the Pregame remembers them.
  await page.goto(baselineUrl('/ChaosBey/?mode=play'));
  await page.getByTestId('character-select').waitFor({ timeout: 20_000 });
  await page.keyboard.press('Enter');
  await page.getByTestId('pregame').waitFor();
  await expect(page.getByTestId('pregame-bowl-depth-value')).toHaveText('4.00 m');
  await expect(page.getByTestId('pregame-jump-cooldown-value')).toHaveText('1.0 s');
  expect(errors).toEqual([]);
});
