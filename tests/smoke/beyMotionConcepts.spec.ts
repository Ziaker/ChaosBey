import { expect, test } from '@playwright/test';

// Smoke test for the isolated Bey Motion Lab (visual exploration only):
// loads the production page, shows every concept in motion, switches
// layouts, cameras, spin presets, blur and the spin-down, checks the
// animation keeps advancing, and fails on any console error.

interface MotionLabState {
  layout: string;
  camera: string;
  spinRate: number;
  blur: boolean;
  beys: number;
  frames: number;
  effectiveSpinRate: number;
  spinningDown: boolean;
  primary: string;
  secondary: string;
}

declare global {
  interface Window {
    __beyMotionLab: {
      ids: string[];
      select(id: string, second?: boolean): void;
      layout(layout: string): void;
      set(patch: Record<string, unknown>): void;
      spinDown(): void;
      state(): MotionLabState;
    };
  }
}

test('bey motion lab loads, animates every concept and responds to its controls', async ({ page }) => {
  test.setTimeout(180_000); // software WebGL in CI is slow
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });

  await page.goto('/ChaosBey/prototypes/bey-motion-concepts/');
  await page.waitForFunction(() => Boolean(window.__beyMotionLab) && window.__beyMotionLab.state().frames > 2, null, { timeout: 60_000 });
  const state = () => page.evaluate(() => window.__beyMotionLab.state());
  const framesAdvance = async () => {
    const before = (await state()).frames;
    await page.waitForFunction((f) => window.__beyMotionLab.state().frames > f + 2, before, { timeout: 30_000 });
  };

  await expect(page.locator('.concept-button')).toHaveCount(9);
  expect((await state()).spinRate, 'starts at the game spin rate').toBe(22);

  // Every concept, solo, via keys 1–9.
  const ids = await page.evaluate(() => window.__beyMotionLab.ids);
  expect(ids).toHaveLength(9);
  for (const [i, id] of ids.entries()) {
    await page.keyboard.press(String(i + 1));
    expect((await state()).primary).toBe(id);
  }
  await framesAdvance();

  // All nine at once, then a duel with a second pick.
  await page.keyboard.press('a');
  expect((await state()).beys).toBe(9);
  await framesAdvance();
  await page.keyboard.press('w');
  await page.keyboard.press('Shift+Digit9');
  const duel = await state();
  expect(duel.beys).toBe(2);
  expect(duel.secondary).toBe('stamina-c');

  // Cameras, spin presets, blur, spin-down.
  for (const [key, camera] of [['c', 'close'], ['t', 'top'], ['g', 'combat']] as const) {
    await page.keyboard.press(key);
    expect((await state()).camera).toBe(camera);
  }
  await page.locator('#spin-presets button').nth(2).click();
  expect((await state()).spinRate).toBe(90);
  await page.keyboard.press('b');
  expect((await state()).blur).toBe(true);
  await framesAdvance();
  await page.keyboard.press('n');
  expect((await state()).spinningDown).toBe(true);
  await page.waitForFunction(() => window.__beyMotionLab.state().effectiveSpinRate < 90, null, { timeout: 30_000 });

  await expect(page.locator('#readout')).toContainText('fold');
  expect(errors).toEqual([]);
});
