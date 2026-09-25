import { expect, test } from '@playwright/test';

test('production build boots, renders and produces no fatal console errors', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => {
    consoleErrors.push(`pageerror: ${error.message}`);
  });

  await page.goto('/');

  // Debug overlay is visible on boot by default (RuntimeConfig) and reports
  // the Sandbox state once bootstrap() has finished wiring physics/render.
  await expect(page.locator('#debug-overlay-root pre')).toContainText('Sandbox', { timeout: 15_000 });

  // Let a few fixed ticks and render frames run to catch startup-only failures.
  await page.waitForTimeout(1000);

  expect(consoleErrors).toEqual([]);
});
