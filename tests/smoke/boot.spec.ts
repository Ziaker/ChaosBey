import { expect, test } from './support/launchFixture';

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
  // The version and the build commit are on screen (owner request), so a playtest knows which build it runs.
  await expect(page.getByTestId('app-version')).toHaveText(/^v\d+\.\d+\.\d+( · [0-9a-f]{7,})?$/);

  // The plain game URL opens the Main Menu (GDD 56); PLAY opens the player
  // flow (M10) through the same ?mode=play route a direct link uses:
  // Character Select, Pregame, then the match.
  await page.getByTestId('main-menu-play').click();
  await expect(page).toHaveURL(/\/ChaosBey\/\?mode=play$/);

  // If boot fails, say why: main.ts logs "ChaosBey failed to boot: <error>"
  // and the listeners above have it, but the assertion below would otherwise
  // fail on the missing screen without ever printing it (this is how a
  // browser-specific boot failure, e.g. no WebGL, becomes diagnosable from
  // the CI log alone).
  try {
    await expect(page.getByTestId('character-select')).toBeVisible({ timeout: 15_000 });
  } catch (error) {
    throw new Error(
      `Character Select never opened. Console errors: ${JSON.stringify(consoleErrors)}. Failed requests: ${JSON.stringify(failedRequests)}.\n${String(error)}`,
    );
  }

  // Choose the focused Bey, keep the Pregame defaults: the real match starts.
  await page.getByTestId('character-select-confirm').click();
  await expect(page.getByTestId('character-select')).toHaveCount(0);
  await page.getByTestId('pregame-start').click();
  await expect(page.getByTestId('pregame')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__chaosBeyPlay?.getScreen()), { timeout: 15_000 }).toBe('match');
  await expect.poll(() => page.evaluate(() => window.__chaosBeyPlay?.getSession()?.getTickIndex() ?? 0)).toBeGreaterThan(30);

  // Let a few fixed ticks and render frames run to catch startup-only failures.
  await page.waitForTimeout(1000);

  expect(failedRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
