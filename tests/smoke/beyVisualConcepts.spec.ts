import { expect, test } from '@playwright/test';

// Smoke test for the isolated Bey visual-concepts prototype page (visual
// exploration only, not gameplay). Verifies it loads from the production
// build under the GitHub Pages subpath, all nine concepts render without
// console errors, and the view controls respond.

interface LabState {
  settled: boolean;
  mode: string;
  autoRotate: boolean;
  silhouette: boolean;
  exploded: boolean;
  cameraDistance: number;
  cameraHeight: number;
  measurements: { diameter: number; height: number; tipLength: number } | null;
}

declare global {
  interface Window {
    __beyConceptLab: { ids: string[]; state(): LabState };
  }
}

test('bey visual concepts prototype loads, switches all nine concepts and responds to view controls', async ({ page }) => {
  test.setTimeout(180_000); // software WebGL in CI is slow; nine models + shadows
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('response', (r) => {
    if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
  });

  // Archived round 1 must keep loading too.
  await page.goto('/ChaosBey/prototypes/bey-visual-concepts-round1/');
  await page.waitForFunction(() => Boolean(window.__beyConceptLab));

  await page.goto('/ChaosBey/prototypes/bey-visual-concepts/');
  await page.waitForFunction(() => Boolean(window.__beyConceptLab));
  const state = (): Promise<LabState> => page.evaluate(() => window.__beyConceptLab.state());
  const settle = (): Promise<unknown> => page.waitForFunction(() => window.__beyConceptLab.state().settled, null, { timeout: 30_000 });

  // Nine concept buttons; selecting each (keys 1–9) builds a model.
  await expect(page.locator('.concept-button')).toHaveCount(9);
  const ids = await page.evaluate(() => window.__beyConceptLab.ids);
  for (let i = 0; i < 9; i++) {
    await page.keyboard.press(String(i + 1));
    await expect(page.locator(`.concept-button[data-concept-id="${ids[i]}"]`)).toHaveAttribute('aria-pressed', 'true');
    const m = (await state()).measurements;
    expect(m?.diameter ?? 0).toBeGreaterThan(3);
  }
  await page.locator('.concept-button[data-concept-id="attack-b"]').click();
  await expect(page.locator('#concept-info')).toContainText('ATTACK — CONCEPT B');

  // Auto rotate toggles off/on with R.
  const initialRotate = (await state()).autoRotate;
  await page.keyboard.press('r');
  expect((await state()).autoRotate).toBe(!initialRotate);

  // Top view puts the camera (almost) straight above.
  await page.keyboard.press('t');
  await settle();
  expect((await state()).mode).toBe('top');

  // Diagonal view is above the floor but well below vertical.
  await page.getByRole('button', { name: /Diagonal/ }).click();
  await settle();
  expect((await state()).mode).toBe('diagonal');

  // Dragging orbits the camera and switches to FREE.
  const canvas = page.locator('#lab-canvas');
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 220, box.y + box.height / 2 + 60, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => (await state()).mode, { timeout: 10_000 }).toBe('free');

  // Mouse wheel zooms.
  const before = (await state()).cameraDistance;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -300);
  await expect.poll(async () => (await state()).cameraDistance, { timeout: 10_000 }).toBeLessThan(before * 0.95);

  // Below view goes under the floor so the tip can be inspected.
  await page.keyboard.press('b');
  await settle();
  expect((await state()).cameraHeight).toBeLessThan(0);

  // Explode separates the four pieces (and toggles back).
  await page.keyboard.press('e');
  expect((await state()).exploded).toBe(true);
  await page.keyboard.press('e');
  expect((await state()).exploded).toBe(false);

  // Silhouette mode toggles.
  await page.keyboard.press('k');
  expect((await state()).silhouette).toBe(true);

  expect(errors).toEqual([]);
});
