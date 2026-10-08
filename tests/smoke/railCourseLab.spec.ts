import { expect, test } from '@playwright/test';

// Smoke test for the isolated Rail Course Lab prototype (0.55.0). Loads the production page, switches the course ideas, the
// views and the controls, lets a ride play and fails on any console error. Nothing here touches the game.

declare global {
  interface Window {
    __railLab: { ideas: string[]; state(): { idea: string; stage: string; railCount: number; view: string; phase: string | null; lengthM: number } };
  }
}

test('rail course lab loads, switches ideas, views and stages, and a ride plays', async ({ page }) => {
  test.setTimeout(180_000); // software WebGL in CI is slow
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });

  await page.goto('/ChaosBey/prototypes/rail-course-lab/');
  await page.waitForFunction(() => Boolean(window.__railLab));
  const state = () => page.evaluate(() => window.__railLab.state());

  await expect(page.locator('.idea')).toHaveCount(4);
  const lengths: number[] = [];
  for (const [i, id] of ['A', 'B', 'C', 'D'].entries()) {
    await page.keyboard.press(String(i + 1));
    expect((await state()).idea).toBe(id);
    lengths.push((await state()).lengthM);
  }
  expect(lengths.every((l) => l > 100)).toBe(true); // every idea is a long route, not a short arc

  // Measurements are shown, and a slider changes the course.
  await expect(page.locator('#readouts dt')).not.toHaveCount(0);
  const before = (await state()).lengthM;
  await page.locator('#p-sweepDeg').fill('60');
  await expect.poll(async () => (await state()).lengthM).not.toBe(before);

  for (const view of ['top', 'ride', 'free', 'overview']) {
    await page.keyboard.press('v');
    expect((await state()).view).toBe(view);
  }
  await page.selectOption('#stage', 'rift');
  expect((await state()).stage).toBe('rift');
  await page.locator('#rail-count button').nth(2).click();
  expect((await state()).railCount).toBe(3);

  // The ride preview runs and a jump is accepted at any moment.
  await page.keyboard.press('r');
  await expect.poll(async () => (await state()).phase, { timeout: 30_000 }).toBe('riding');
  await page.keyboard.press('Space');
  await page.waitForTimeout(500);
  expect(errors).toEqual([]);
});
