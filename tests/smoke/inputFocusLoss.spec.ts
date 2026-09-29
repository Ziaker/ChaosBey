import { expect, test } from '@playwright/test';

// ============================================================
// INPUT FOCUS LOSS — STUCK-KEY REGRESSION (M7 ALPHA-READINESS HARDENING)
// GDD section 131: focus loss must clear stuck keys. KeyboardController
// already clears its held-key set on the window 'blur' event
// (handleWindowBlur) — this smoke confirms that holds in the real runtime
// loop too: a Bey moving under a held key stops accelerating once focus is
// lost, even though nothing ever sends the matching keyup (exactly what a
// real alt-tab/tab-switch does: the keyup can be swallowed by the OS/other
// window rather than reaching this page).
// ============================================================

const RAD_TO_SPEED_FIELD = /^speed\s+([\d.]+) m\/s/m;

test('losing window focus while a movement key is held does not leave the Bey accelerating forever', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));

  await page.goto('/ChaosBey/?mode=play&quick');
  const overlay = page.locator('#debug-overlay-root pre');
  await expect(overlay).toContainText('Combat', { timeout: 15_000 });

  const readSpeed = async (): Promise<number> => {
    const text = (await overlay.textContent()) ?? '';
    const match = RAD_TO_SPEED_FIELD.exec(text);
    if (!match) throw new Error(`speed field not found in overlay text: ${text.slice(0, 200)}`);
    return Number.parseFloat(match[1]!);
  };

  const initialSpeed = await readSpeed();

  // Hold a movement key long enough to actually accelerate.
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(400);
  const speedWhileHeld = await readSpeed();
  expect(speedWhileHeld, 'holding MoveForward should visibly accelerate the Bey').toBeGreaterThan(initialSpeed + 0.2);

  // Simulate real alt-tab/tab-switch: focus is lost WITHOUT a matching
  // keyup ever reaching this page (the OS/other window can swallow it).
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  const speedRightAfterBlur = await readSpeed();
  await page.waitForTimeout(500);
  const speedAfterSettling = await readSpeed();

  // If MoveForward were still stuck held, speed would keep climbing toward
  // the Bey's max — instead it should be decaying (drag/friction) or at
  // least not still rising past what it already reached.
  expect(speedAfterSettling, 'speed should not keep climbing once focus is lost — MoveForward must not be stuck held').toBeLessThanOrEqual(speedRightAfterBlur + 0.05);

  expect(consoleErrors).toEqual([]);
});
