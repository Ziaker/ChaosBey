import { expect, test } from '@playwright/test';

// Smoke test for the isolated arena visual-concepts prototype (visual
// exploration only). Loads the production page, cycles the three arenas
// and the demo controls, and fails on any console error.

declare global {
  interface Window {
    __arenaLab: { ids: string[]; state(): { mode: string; motion: boolean; clash: boolean } };
  }
}

test('arena visual concepts prototype loads, switches arenas and responds to controls', async ({ page }) => {
  test.setTimeout(180_000); // software WebGL in CI is slow
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });

  await page.goto('/ChaosBey/prototypes/arena-visual-concepts/');
  await page.waitForFunction(() => Boolean(window.__arenaLab));
  const state = () => page.evaluate(() => window.__arenaLab.state());

  await expect(page.locator('.arena-button')).toHaveCount(3);
  for (const [i, letter] of ['A', 'B', 'C'].entries()) {
    await page.keyboard.press(String(i + 1));
    await expect(page.locator('#arena-title')).toContainText(`CONCEPT ${letter}`);
  }
  await page.keyboard.press('g');
  expect((await state()).mode).toBe('gameplay');
  await page.keyboard.press('x');
  expect((await state()).clash).toBe(true);
  await page.keyboard.press('m');
  expect((await state()).motion).toBe(false);
  await page.keyboard.press('i');
  await page.selectOption('#bey-2', 'stamina-c');
  await page.waitForTimeout(500);
  expect(errors).toEqual([]);
});
