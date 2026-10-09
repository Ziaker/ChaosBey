import { expect, test } from './support/launchFixture';
import { baselineUrl } from './presentationBaseline';

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

test('losing window focus while a movement key is held does not leave the Bey accelerating forever', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));

  // The normal play flow (it exposes the session), with the opponent kept out of the way: this checks a stuck key,
  // and a hit or a body collision from the live AI legitimately raises the speed — seen once on CI (4.4 -> 9 m/s in
  // 0.5 s) with the quick-play match, which has no handle to idle it.
  await page.goto(baselineUrl('/ChaosBey/?mode=play'));
  await page.getByTestId('character-select').waitFor({ timeout: 20_000 });
  await page.keyboard.press('Enter');
  await page.getByTestId('pregame-start').click();
  await page.waitForFunction(() => window.__chaosBeyPlay?.getScreen() === 'match' && window.__chaosBeyPlay.getSession() != null, null, { timeout: 30_000 });
  await page.waitForTimeout(1200); // past the FIGHT banner
  await page.evaluate(() => {
    const s = window.__chaosBeyPlay!.getSession()!;
    s.setController('second', { kind: 'idle' });
    const p = s.getBey('first').body.translation();
    s.getBey('second').body.setTranslation({ x: p.x, y: p.y + 0.2, z: p.z - 6 }, true);
    s.getBey('second').body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  });

  const readSpeed = (): Promise<number> =>
    page.evaluate(() => {
      const v = window.__chaosBeyPlay!.getSession()!.getBey('first').body.linvel();
      return Math.hypot(v.x, v.z);
    });

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
