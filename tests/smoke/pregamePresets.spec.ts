import { expect, test } from '@playwright/test';
import { baselineUrl } from './presentationBaseline';
import { openAdvanced, showControl } from './support/pregameAdvanced';

// Pregame overhaul (docs/design-decisions/pregame-overhaul.md): the five official presets with their descriptions, the
// derived Custom state, MODIFIED against Normal Original, Reset category / Reset all, and a preset reaching the real match
// without touching the Bey / AI / arena / floor / movement choices.

test('Pregame presets: five official ones, Custom when edited, MODIFIED, resets, and the preset reaches the match', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(baselineUrl('/ChaosBey/?mode=play'));
  await page.getByTestId('character-select').waitFor({ timeout: 20_000 });
  await page.keyboard.press('Enter');
  await page.getByTestId('pregame').waitFor();

  // Five presets in the approved order, each with its brief description; Normal Original is the active one.
  const labels = await page.locator('[data-testid^="pregame-preset-"][role="radio"] .cb-preset__name').allTextContents();
  expect(labels).toEqual(['Normal Original', 'Realistic', 'Epic', 'Smooth', 'Strategic']);
  await expect(page.getByTestId('pregame-preset-epic-description')).toContainText('Faster, harder-hitting');
  await expect(page.getByTestId('pregame-preset-normal')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('pregame-summary-modified')).toHaveText('All Normal Original');

  // Pick the choices a preset must not touch, then apply Epic.
  await page.getByTestId('pregame-opponent-bey-defense-prototype').click();
  await page.getByTestId('pregame-ai-level-ace').click();
  await page.getByTestId('pregame-arena-rift').click();
  await page.getByTestId('pregame-arena-floor-bowl-a').click();
  await page.getByTestId('pregame-motion-C').click();
  await page.getByTestId('pregame-preset-epic').click();
  await expect(page.getByTestId('pregame-preset-epic')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('pregame-summary-preset')).toHaveText('Epic');
  await expect(page.getByTestId('pregame-opponent-bey-defense-prototype')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('pregame-ai-level-ace')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('pregame-arena-rift')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('pregame-arena-floor-bowl-a')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('pregame-motion-C')).toHaveAttribute('aria-checked', 'true');

  // Epic's values are shown as MODIFIED, counted per category and in the header; a manual edit makes it Custom.
  await openAdvanced(page);
  await expect(page.getByTestId('pregame-advanced-count')).not.toHaveText('default');
  await (await showControl(page, 'game-speed')).waitFor();
  await expect(page.getByTestId('pregame-game-speed-modified')).toBeVisible();
  await expect(page.getByTestId('pregame-game-speed-value')).toHaveText('×1.30');
  await (await showControl(page, 'gravity')).fill('4');
  await expect(page.getByTestId('pregame-preset-state')).toContainText('Custom');
  await expect(page.getByTestId('pregame-preset-custom')).toHaveAttribute('aria-current', 'true');
  await expect(page.getByTestId('pregame-summary-preset')).toHaveText('Custom');
  for (const id of ['epic', 'normal']) await expect(page.getByTestId(`pregame-preset-${id}`)).toHaveAttribute('aria-checked', 'false');

  // Putting that value back restores the official preset's label.
  await (await showControl(page, 'gravity')).fill('3.2');
  await expect(page.getByTestId('pregame-preset-epic')).toHaveAttribute('aria-checked', 'true');

  // Reset category only restores the open category; Reset all produces exactly Normal Original.
  await showControl(page, 'game-speed');
  await page.getByTestId('pregame-reset-category').click();
  await expect(page.getByTestId('pregame-game-speed-value')).toHaveText('×1.20');
  await expect(page.getByTestId('pregame-tab-arena-count')).toHaveText('');
  await expect(page.getByTestId('pregame-preset-state')).toContainText('Custom');
  await page.getByTestId('pregame-reset-defaults').click();
  await expect(page.getByTestId('pregame-preset-normal')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('pregame-summary-modified')).toHaveText('All Normal Original');

  // Keyboard: a preset row ← / → applies a preset, ↓ moves on to the next row.
  await page.getByTestId('pregame-preset-normal').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('pregame-preset-realistic')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('pregame-preset-strategic')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('pregame-opponent-bey-defense-prototype')).toBeFocused();

  // A preset reaches the match.
  await page.getByTestId('pregame-preset-epic').click();
  await page.getByTestId('pregame-start').click();
  await expect.poll(() => page.evaluate(() => window.__chaosBeyPlay?.getScreen()), { timeout: 20_000 }).toBe('match');
  const config = await page.evaluate(() => window.__chaosBeyPlay!.getSession()!.matchConfig);
  expect(config).toMatchObject({ gameSpeed: 1.3, knockbackScale: 1.5, clashLaunchMps: 40, jumpFullHeightM: 4.25 });
  expect(errors).toEqual([]);
});
