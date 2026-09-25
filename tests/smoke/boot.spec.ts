import { expect, test } from '@playwright/test';

test('production build boots under /ChaosBey/, renders and produces no fatal errors', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => {
    consoleErrors.push(`pageerror: ${error.message}`);
  });

  const failedRequests: string[] = [];
  page.on('requestfailed', (request) => {
    failedRequests.push(`${request.method()} ${request.url()} — ${request.failure()?.errorText}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400) {
      failedRequests.push(`${response.status()} ${response.url()}`);
    }
  });

  // Navigate to the absolute GitHub Pages path explicitly rather than
  // relying on baseURL + a relative goto('/'): a leading-slash path in
  // page.goto() resolves against the ORIGIN, not baseURL's own path, so
  // goto('/') would silently drop the /ChaosBey/ prefix and this test
  // could pass while testing the wrong (unscoped) URL.
  await page.goto('/ChaosBey/');
  expect(new URL(page.url()).pathname).toBe('/ChaosBey/');

  // Debug overlay is visible on boot by default (RuntimeConfig) and reports
  // the Sandbox state once bootstrap() has finished wiring physics/render.
  await expect(page.locator('#debug-overlay-root pre')).toContainText('Sandbox', { timeout: 15_000 });

  // Let a few fixed ticks and render frames run to catch startup-only failures.
  await page.waitForTimeout(1000);

  expect(failedRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
