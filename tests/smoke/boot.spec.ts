import { expect, test } from '@playwright/test';

test('production build boots under /ChaosBey/ to the Main Menu, PLAY starts the match, no fatal errors', async ({ page }) => {
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

  // The plain game URL opens the Main Menu (GDD 56); PLAY is the normal
  // player flow into the match, through the same ?mode=play route a direct
  // link uses.
  await page.getByTestId('main-menu-play').click();
  await expect(page).toHaveURL(/\/ChaosBey\/\?mode=play$/);

  // Debug overlay is visible on boot by default (RuntimeConfig) and reports
  // the Combat state once bootstrap() has finished wiring physics/render and
  // the Milestone 2 match is running (GDD section 9: Sandbox was only ever
  // the Milestone 0 placeholder-scene state).
  // If boot fails, say why: main.ts logs "ChaosBey failed to boot: <error>"
  // and the listeners above have it, but the assertion below would otherwise
  // fail on the missing overlay without ever printing it (this is how a
  // browser-specific boot failure, e.g. no WebGL, becomes diagnosable from
  // the CI log alone).
  try {
    await expect(page.locator('#debug-overlay-root pre')).toContainText('Combat', { timeout: 15_000 });
  } catch (error) {
    throw new Error(
      `the game never reached Combat. Console errors: ${JSON.stringify(consoleErrors)}. Failed requests: ${JSON.stringify(failedRequests)}.\n${String(error)}`,
    );
  }

  // Let a few fixed ticks and render frames run to catch startup-only failures.
  await page.waitForTimeout(1000);

  expect(failedRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
