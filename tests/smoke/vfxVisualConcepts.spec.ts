import { expect, test } from '@playwright/test';

// Smoke test for the isolated VFX language lab (visual exploration only):
// loads the production page, runs every effect in split view (both
// languages) at heavy intensity, and fails on any console error.

declare global {
  interface Window {
    __vfxLab: { scenarios: string[]; set(o: Record<string, string>): void; time(): number[] };
  }
}

test('vfx language lab loads and plays every effect in both languages', async ({ page }) => {
  test.setTimeout(240_000); // software WebGL in CI is slow
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });

  await page.goto('/ChaosBey/prototypes/vfx-visual-concepts/');
  await page.waitForFunction(() => Boolean(window.__vfxLab));
  const ids = await page.evaluate(() => window.__vfxLab.scenarios);
  expect(ids).toHaveLength(8);
  for (const id of ids) {
    await page.evaluate((s) => window.__vfxLab.set({ scenario: s, intensity: 'heavy', view: 'split' }), id);
    // Run past the main event of every scenario (all fire before t = 1.6 s).
    await page.waitForFunction(() => window.__vfxLab.time().every((t) => t > 1.6), null, { timeout: 60_000 });
  }
  await page.keyboard.press('a');
  await page.keyboard.press('b');
  await expect(page.locator('.badge')).toHaveCount(1);
  expect(errors).toEqual([]);
});
