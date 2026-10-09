import { expect, test } from '@playwright/test';
import { baselineUrl } from './presentationBaseline';

// Owner, 2026-10-09: Bey Real in the Pregame — a switch, the three cameras, the "avançadamente avançado" block with every slider
// and its own explanation, the presets (the base is the owner's tuning), and the match it starts.

test('Pregame › Bey Real: switch, camera, advanced block, presets, and a real match in the mode', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(baselineUrl('/ChaosBey/?mode=play'));
  await page.getByTestId('character-select').waitFor({ timeout: 20_000 });
  await page.keyboard.press('Enter');
  await page.getByTestId('pregame').waitFor();

  // Off by default; the block says what is inherited.
  await page.getByTestId('pregame-real').locator('summary').first().click();
  await expect(page.getByTestId('pregame-real-state')).toHaveText('desligado');
  await expect(page.getByTestId('pregame-real-enabled')).not.toBeChecked();
  await expect(page.getByTestId('pregame-real-inherits')).toContainText('Continua igual');
  await expect(page.getByTestId('pregame-summary-mode')).toHaveText('Classic');

  // The three cameras.
  for (const mode of ['original', 'real', 'free']) await expect(page.getByTestId(`pregame-real-camera-${mode}`)).toBeVisible();
  await expect(page.getByTestId('pregame-real-camera-real')).toHaveAttribute('aria-checked', 'true');

  // The advanced-advanced block: every slider with its own explanation, the base preset first (the owner's numbers).
  await page.getByTestId('pregame-real-deep').locator('summary').first().click();
  await expect(page.getByTestId('pregame-real-preset-base')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('pregame-real-influence-value')).toHaveText('75%');
  await expect(page.getByTestId('pregame-real-cruiseSpeedMps-value')).toHaveText('14.0 m/s');
  await expect(page.getByTestId('pregame-real-stageRadiusM-value')).toHaveText('15.0 m');
  const notes = await page.locator('[data-testid^="pregame-real-note"], .cb-real__note').allTextContents();
  expect(notes.length).toBe(69); // every value of the owner's preset, each with its own explanation
  expect(new Set(notes).size).toBe(notes.length);
  await expect(page.getByTestId('pregame-real-influence')).toBeDisabled(); // sliders wait for the switch

  // Switch it on: the sliders wake up, the summary and the classic locks follow.
  await page.getByTestId('pregame-real-enabled').check();
  await expect(page.getByTestId('pregame-real-state')).toHaveText('ligado');
  await expect(page.getByTestId('pregame-real-influence')).toBeEnabled();
  await expect(page.getByTestId('pregame-summary-mode')).toContainText('Bey Real');
  await page.getByTestId('pregame-advanced').locator('summary').first().click();
  await page.getByTestId('pregame-tab-movement').click();
  await expect(page.getByTestId('pregame-top-speed')).toBeDisabled();

  // A moved slider shows as changed and the preset becomes a custom mix; the preset buttons put it back.
  await page.getByTestId('pregame-real-influence').fill('0.3');
  await expect(page.getByTestId('pregame-real-influence-value')).toHaveText('30%');
  await expect(page.getByTestId('pregame-real-influence-modified')).toBeVisible();
  await expect(page.getByTestId('pregame-real-preset-automatic')).toHaveAttribute('aria-checked', 'true'); // 30% is the "mais automático" preset
  await page.getByTestId('pregame-real-preset-wild').click();
  await expect(page.getByTestId('pregame-real-precessionRadPerS-value')).toHaveText('1.30 rad/s');
  await page.getByTestId('pregame-real-preset-base').click();
  await expect(page.getByTestId('pregame-real-influence-value')).toHaveText('75%');
  await page.getByTestId('pregame-real-camera-free').click();

  // Play: the match is a Bey Real match, with the 15 m stage, and the Beys move by themselves.
  await page.getByTestId('pregame-start').click();
  await expect.poll(() => page.evaluate(() => window.__chaosBeyPlay?.getScreen()), { timeout: 20_000 }).toBe('match');
  const config = await page.evaluate(() => window.__chaosBeyPlay!.getSession()!.matchConfig);
  expect(config.real).toMatchObject({ influence: 0.75, cruiseSpeedMps: 14, stageRadiusM: 15 });
  expect(config.arenaSizeScale).toBeCloseTo(15 / 36, 5);
  await page.waitForTimeout(2500);
  const speeds = await page.evaluate(() => {
    const s = window.__chaosBeyPlay!.getSession()!;
    const v = (side: 'first' | 'second') => {
      const l = s.getBey(side).body.linvel();
      return Math.hypot(l.x, l.z);
    };
    return [v('first'), v('second')];
  });
  expect(speeds[0]).toBeGreaterThan(2);
  expect(speeds[1]).toBeGreaterThan(2);
  expect(errors).toEqual([]);
});
