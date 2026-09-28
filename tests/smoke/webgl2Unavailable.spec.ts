import { expect, test } from '@playwright/test';

// ============================================================
// WEBGL2 UNAVAILABLE — VISIBLE BOOT FAILURE
// GDD section 117: a release may fail gracefully, but must stay
// diagnosable. A browser/device that can't create a WebGL2 context (no GPU,
// a blocklisted driver, WebGL disabled) must show the player a plain
// message, not a blank page, while the real error is still logged to the
// console. Simulated here the way such a browser behaves: the canvas
// refuses every WebGL context.
// ============================================================

test('without WebGL2 the player sees a clear message instead of a blank page, and the error is still logged', async ({ page }) => {
  const consoleErrors: Promise<string>[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    // message.text() renders an Error argument differently per browser
    // (Firefox gives just "Error"), so read each logged value itself.
    consoleErrors.push(
      Promise.all(message.args().map((arg) => arg.evaluate((value) => (value instanceof Error ? `${value.name}: ${value.message}` : String(value)))))
        .then((parts) => parts.join(' '))
        .catch(() => message.text()),
    );
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (type === 'webgl2' || type === 'webgl' || type === 'experimental-webgl') return null;
      return (original as (this: HTMLCanvasElement, ...args: unknown[]) => RenderingContext | null).call(this, type, ...rest);
    } as typeof HTMLCanvasElement.prototype.getContext;
  });

  await page.goto('/ChaosBey/');

  const screen = page.locator('#boot-failure');
  await expect(screen).toBeVisible({ timeout: 15_000 });
  await expect(screen).toHaveAttribute('role', 'alert');
  await expect(screen).toContainText("ChaosBey couldn't start");
  await expect(screen).toContainText("Your browser or device couldn't create a WebGL2 context.");
  await expect(screen).toContainText('Update your browser and graphics drivers, or try another browser or device.');
  await expect(screen).toContainText('Technical details are in the browser console.');

  // The game itself did not start behind the message.
  await expect(page.locator('#debug-overlay-root pre')).toHaveCount(0);

  // Still diagnosable: the failure is logged, and it is the WebGL2 case.
  const loggedErrors = await Promise.all(consoleErrors);
  expect(loggedErrors.some((text) => text.includes('ChaosBey failed to boot') && text.includes('WebGl2UnavailableError: WebGL2 context could not be created')), JSON.stringify(loggedErrors)).toBe(true);
  // Handled, not an uncaught exception.
  expect(pageErrors).toEqual([]);
});
