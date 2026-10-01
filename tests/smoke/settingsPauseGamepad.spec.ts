import { expect, test, type Page } from '@playwright/test';

// ============================================================
// SETTINGS, PAUSE, FOCUS LOSS, GAMEPAD (M10 lane D), production build.
// - SETTINGS from the Main Menu saves and survives a reload.
// - Esc pauses the match (no ticks), Esc resumes; losing focus pauses;
//   Settings opened from Pause apply live; Leave match returns to Pregame.
// - A scripted standard gamepad drives the menus and the Bey.
// ============================================================

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  return errors;
}

async function startDefaultMatch(page: Page): Promise<void> {
  await page.goto('/ChaosBey/?mode=play');
  await page.getByTestId('character-select-confirm').click({ timeout: 15_000 });
  await page.getByTestId('pregame-start').click();
  await expect.poll(() => page.evaluate(() => window.__chaosBeyPlay?.getScreen()), { timeout: 15_000 }).toBe('match');
}

const tickOf = (page: Page): Promise<number> => page.evaluate(() => window.__chaosBeyPlay!.getSession()!.getTickIndex());

test('Settings from the Main Menu are saved and survive a reload', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/ChaosBey/');
  await page.getByTestId('main-menu-settings').click();
  await expect(page).toHaveURL(/\/ChaosBey\/\?mode=settings$/);
  const settings = page.getByTestId('settings');
  await expect(settings).toBeVisible();
  await expect(page.getByTestId('settings-quality-Medium')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('settings-quality-Low').click();
  await expect(page.getByTestId('settings-quality-note')).toContainText('speed trails off');
  await page.getByTestId('settings-camera-effects-false').click();
  await expect(page.getByTestId('settings-controls')).toContainText('Start');

  await page.reload();
  await expect(page.getByTestId('settings-quality-Low')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('settings-camera-effects-false')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\/ChaosBey\/$/);
  await expect(page.getByTestId('main-menu')).toBeVisible();
  expect(errors).toEqual([]);
});

test('Esc pauses and resumes, focus loss pauses, Settings apply from Pause, Leave match returns to Pregame', async ({ page }) => {
  const errors = watchErrors(page);
  await startDefaultMatch(page);

  // Esc: paused, and the match really stops ticking.
  await expect.poll(() => tickOf(page)).toBeGreaterThan(20);
  await page.keyboard.press('Escape');
  const pause = page.getByTestId('pause-menu');
  await expect(pause).toBeVisible();
  expect(await page.evaluate(() => window.__chaosBeyPlay!.getScreen())).toBe('paused');
  const pausedAt = await tickOf(page);
  await page.waitForTimeout(500);
  expect(await tickOf(page)).toBe(pausedAt);

  // Esc again resumes.
  await page.keyboard.press('Escape');
  await expect(pause).toHaveCount(0);
  await expect.poll(() => tickOf(page)).toBeGreaterThan(pausedAt + 10);

  // Losing focus (alt-tab) pauses.
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(pause).toBeVisible();
  const blurredAt = await tickOf(page);
  await page.waitForTimeout(400);
  expect(await tickOf(page)).toBe(blurredAt);

  // Settings from Pause: a change applies live and is saved.
  await page.getByTestId('pause-menu-settings').click();
  await expect(page.getByTestId('settings')).toBeVisible();
  await page.getByTestId('settings-quality-High').click();
  await page.getByTestId('settings-back').click();
  await expect(pause).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('chaosbey.settings.player.v1') ?? '{}').quality)).toBe('High');

  // Resume by button, then Leave match from a new pause.
  await page.getByTestId('pause-menu-resume').click();
  await expect.poll(() => tickOf(page)).toBeGreaterThan(blurredAt + 10);
  await page.keyboard.press('Escape');
  await page.getByTestId('pause-menu-leave').click();
  await expect(page.getByTestId('pregame')).toBeVisible();
  expect(await page.evaluate(() => window.__chaosBeyPlay!.getSession())).toBeNull();
  expect(errors).toEqual([]);
});

test('a standard gamepad drives the menus, the Bey and the pause', async ({ page }) => {
  const errors = watchErrors(page);
  // A scripted pad behind navigator.getGamepads(): window.__pad.pressed / axes.
  await page.addInitScript(() => {
    const state = { pressed: [] as number[], axes: [0, 0, 0, 0] };
    (window as unknown as { __pad: typeof state }).__pad = state;
    navigator.getGamepads = () =>
      [
        {
          id: 'Scripted Pad (STANDARD GAMEPAD)',
          index: 0,
          connected: true,
          mapping: 'standard',
          timestamp: performance.now(),
          buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: state.pressed.includes(i), touched: false, value: state.pressed.includes(i) ? 1 : 0 })),
          axes: state.axes,
        } as unknown as Gamepad,
      ];
  });
  const tap = async (button: number): Promise<void> => {
    await page.evaluate((b) => ((window as unknown as { __pad: { pressed: number[] } }).__pad.pressed = [b]), button);
    await page.waitForTimeout(120);
    await page.evaluate(() => ((window as unknown as { __pad: { pressed: number[] } }).__pad.pressed = []));
    await page.waitForTimeout(120);
  };
  const A = 0;
  const DOWN = 13;
  const START = 9;

  await page.goto('/ChaosBey/?mode=play');
  await expect(page.getByTestId('character-select')).toBeVisible({ timeout: 15_000 });
  await tap(DOWN);
  await tap(DOWN);
  await expect(page.getByTestId('character-select-option-stamina-prototype')).toHaveAttribute('aria-selected', 'true');
  await tap(A);
  await expect(page.getByTestId('pregame')).toBeVisible();
  await tap(A); // Pregame: A starts the match.
  await expect.poll(() => page.evaluate(() => window.__chaosBeyPlay?.getScreen()), { timeout: 15_000 }).toBe('match');
  expect(await page.evaluate(() => window.__chaosBeyPlay!.getSession()!.getBey('first').definition.id)).toBe('stamina-prototype');

  // The stick drives the Bey (M11 Directional default, camera-relative —
  // "Fix 7", see PlayerSettings.ts's header): full tilt up-right is a
  // full-strength camera-relative world direction, and no turn/throttle
  // actions are held (that's Classic, now a selectable, non-default option).
  await page.evaluate(() => ((window as unknown as { __pad: { axes: number[] } }).__pad.axes = [1, -1, 0, 0]));
  await expect
    .poll(() =>
      page.evaluate(() => {
        const actions = window.__chaosBeyPlay!.getSession()!.getLastActions('first');
        const move = actions?.moveIntent;
        return { held: [...(actions?.held ?? [])], strength: move ? Math.round(Math.hypot(move.x, move.z) * 100) / 100 : null };
      }),
    )
    .toEqual({ held: [], strength: 1 });
  await page.evaluate(() => ((window as unknown as { __pad: { axes: number[] } }).__pad.axes = [0, 0, 0, 0]));

  // Start pauses; B (back) resumes.
  await tap(START);
  await expect(page.getByTestId('pause-menu')).toBeVisible();
  await tap(1);
  await expect(page.getByTestId('pause-menu')).toHaveCount(0);
  expect(await page.evaluate(() => window.__chaosBeyPlay!.getScreen())).toBe('match');
  expect(errors).toEqual([]);
});
