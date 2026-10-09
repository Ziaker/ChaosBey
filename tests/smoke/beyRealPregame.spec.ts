import { expect, test } from './support/launchFixture';
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

  // Classic by default: the mode is its own first step, and the Bey Real block is not on screen until it is chosen.
  await expect(page.getByTestId('pregame-mode-classic')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('pregame-mode-real')).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByTestId('pregame-real')).toBeHidden();
  await expect(page.getByTestId('pregame-section-preset')).toBeVisible();
  await expect(page.getByTestId('pregame-summary-mode')).toHaveText('Classic');

  // Choose Bey Real: the classic Preset steps aside, the Bey Real block takes its place.
  await page.getByTestId('pregame-mode-real').click();
  await expect(page.getByTestId('pregame-mode-real')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('pregame-real')).toBeVisible();
  await expect(page.getByTestId('pregame-section-preset')).toBeHidden();
  await expect(page.getByTestId('pregame-summary-mode')).toContainText('Bey Real');
  await page.getByTestId('pregame-real-inherits').locator('summary').click();
  await expect(page.getByTestId('pregame-real-inherits')).toContainText('Continua igual');

  // The three cameras.
  for (const mode of ['original', 'real', 'free']) await expect(page.getByTestId(`pregame-real-camera-${mode}`)).toBeVisible();
  await expect(page.getByTestId('pregame-real-camera-real')).toHaveAttribute('aria-checked', 'true');

  // The presets are on screen without opening anything: the base is the owner's tuning.
  await expect(page.getByTestId('pregame-real-preset-base')).toHaveAttribute('aria-checked', 'true');

  // The advanced-advanced block: every slider with its own explanation, in groups, with a filter.
  await page.getByTestId('pregame-real-deep').locator('summary').first().click();
  await page.getByTestId('pregame-real-group-auto').locator('summary').first().click();
  await expect(page.getByTestId('pregame-real-influence-value')).toHaveText('75%');
  await expect(page.getByTestId('pregame-real-cruiseSpeedMps-value')).toHaveText('18.0 m/s');
  await page.getByTestId('pregame-real-group-rules').locator('summary').first().click();
  await expect(page.getByTestId('pregame-real-stageRadiusM-value')).toHaveText('15.0 m');
  const notes = await page.locator('.cb-real__note').allTextContents();
  expect(notes.length).toBe(68); // every value of the mode, each with its own explanation
  expect(new Set(notes).size).toBe(notes.length);
  await page.getByTestId('pregame-real-filter').fill('parede');
  await expect(page.getByTestId('pregame-real-ctl-wallHeightM')).toBeVisible();
  await expect(page.getByTestId('pregame-real-ctl-influence')).toBeHidden();
  await page.getByTestId('pregame-real-filter').fill('xyzxyz');
  await expect(page.getByTestId('pregame-real-filter-empty')).toBeVisible();
  await page.getByTestId('pregame-real-filter').fill('');
  await expect(page.getByTestId('pregame-real-ctl-influence')).toBeVisible();

  // The classic movement sliders are locked, the arena ones are not: they are the same setting as the block's.
  await page.getByTestId('pregame-advanced').locator('summary').first().click();
  await page.getByTestId('pregame-tab-movement').click();
  await expect(page.getByTestId('pregame-top-speed')).toBeDisabled();
  await page.getByTestId('pregame-tab-arena').click();
  await expect(page.getByTestId('pregame-stage-size')).toBeEnabled();
  await expect(page.getByTestId('pregame-bowl-depth')).toBeEnabled();
  await expect(page.getByTestId('pregame-wall-height')).toBeEnabled();
  await page.getByTestId('pregame-wall-height').fill('10');
  await expect(page.getByTestId('pregame-real-wallHeightM-value')).toHaveText('10.0 m');
  await page.getByTestId('pregame-real-wallHeightM').fill('1.6');
  await expect(page.getByTestId('pregame-wall-height-value')).toHaveText('1.6 m');

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
  expect(config.real).toMatchObject({ influence: 0.75, cruiseSpeedMps: 18, stageRadiusM: 15 });
  expect(config.arenaSizeScale).toBeCloseTo(15 / 36, 5);
  // The round starts with the launch (0.61.0): measure after both Beys have arrived and the fight has run a while.
  await expect.poll(() => page.evaluate(() => window.__chaosBeyPlay!.getSession()!.getTickIndex()), { timeout: 30_000 }).toBeGreaterThan(30);
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
