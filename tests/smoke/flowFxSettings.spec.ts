import { type Page } from '@playwright/test';
import { expect, test } from './support/launchFixture';
import { GAME_DEFAULTS } from './gameDefaults';

// ============================================================
// FLOW FX SETTINGS (Fluxo do Bey, owner 2026-10-08), production build.
// - Settings → Visual effects has a slider for every value, starting on the owner's numbers;
//   a change is saved and survives a reload.
// - In a match the effects are attached and driven by the match; a slider moved from the
//   Pause menu applies live.
// ============================================================

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  return errors;
}

const savedFlowFx = (page: Page): Promise<{ dustStyle: string; comicWords: boolean; values: Record<string, number> } | null> =>
  page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as { flowFx: { dustStyle: string; comicWords: boolean; values: Record<string, number> } }).flowFx : null;
  }, GAME_DEFAULTS.settingsStorageKey);

test('Settings → Visual effects: a slider for every value, saved and kept after a reload', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/ChaosBey/?mode=settings');
  await expect(page.getByTestId('settings')).toBeVisible();
  const sliders = page.locator('[data-testid^="settings-flow-"][type="range"]');
  expect(await sliders.count()).toBeGreaterThanOrEqual(23);
  // The owner's numbers, and the three cloud sliders they asked for.
  await expect(page.getByTestId('settings-flow-dustFade')).toHaveValue('0.95');
  await expect(page.getByTestId('settings-flow-dustOpacity')).toHaveValue('1');
  await expect(page.getByTestId('settings-flow-dustShrink')).toHaveValue('0.5');
  await expect(page.getByTestId('settings-flow-shadowOpacity')).toHaveValue('0.5');
  await expect(page.getByTestId('settings-flow-leanMaxDeg')).toHaveValue('26');
  await expect(page.getByTestId('settings-flow-dust-style-wave')).toHaveAttribute('aria-checked', 'true');

  await page.getByTestId('settings-flow-dust-style-cloud').click();
  await page.getByTestId('settings-flow-comic-words-false').click();
  const fade = page.getByTestId('settings-flow-dustFade');
  await fade.fill('0.3');
  await expect(fade).toHaveValue('0.3');
  await expect.poll(async () => (await savedFlowFx(page))?.values.dustFade).toBeCloseTo(0.3, 5);
  const saved = await savedFlowFx(page);
  expect(saved?.dustStyle).toBe('cloud');
  expect(saved?.comicWords).toBe(false);

  await page.reload();
  await expect(page.getByTestId('settings-flow-dustFade')).toHaveValue('0.3');
  await expect(page.getByTestId('settings-flow-dust-style-cloud')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('settings-reset-effects').click();
  await expect(page.getByTestId('settings-flow-dustFade')).toHaveValue('0.95');
  await expect(page.getByTestId('settings-flow-dust-style-wave')).toHaveAttribute('aria-checked', 'true');
  expect(errors).toEqual([]);
});

test('in a match the Fluxo do Bey system is attached, and a slider moved from Pause applies live', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/ChaosBey/?mode=play');
  await page.getByTestId('character-select-confirm').click({ timeout: 15_000 });
  await page.getByTestId('pregame-start').click();
  await expect.poll(() => page.evaluate(() => window.__chaosBeyPlay?.getScreen()), { timeout: 15_000 }).toBe('match');
  const flow = (): Promise<{ present: boolean; frames: number; shadowOpacity: number | null }> =>
    page.evaluate(() => {
      const flowFx = window.__chaosBeyPlay!.getSession()!.getFlowFx();
      const shadow = flowFx?.getShadow('first');
      return { present: flowFx !== null, frames: flowFx?.getStats().frames ?? 0, shadowOpacity: shadow ? (shadow.material as { opacity: number }).opacity : null };
    });
  await expect.poll(async () => (await flow()).frames, { timeout: 15_000 }).toBeGreaterThan(5);
  expect((await flow()).present).toBe(true);
  expect((await flow()).shadowOpacity).toBeCloseTo(0.5, 1);

  await page.keyboard.press('Escape');
  await page.getByTestId('pause-menu-settings').click();
  await expect(page.getByTestId('settings')).toBeVisible();
  await page.getByTestId('settings-flow-shadowOpacity').fill('0.2');
  await page.getByTestId('settings-back').click();
  await page.getByTestId('pause-menu-resume').click();
  await expect.poll(async () => (await flow()).shadowOpacity, { timeout: 10_000 }).toBeCloseTo(0.2, 1);
  expect(errors).toEqual([]);
});
