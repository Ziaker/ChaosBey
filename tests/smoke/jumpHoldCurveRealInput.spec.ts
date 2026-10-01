import { expect, test, type Page } from '@playwright/test';

// Owner report (2026-10-01): "the normal jump only does a short hop now" —
// found, while investigating, that every existing jump/air-control test
// (tests/deterministic/jumpAirControlHotfix.test.ts included) drives the
// hold duration by constructing ControllerActions directly, bypassing
// KeyboardController/ActionSampleBuffer entirely. That's exactly the gap
// the owner called out: a helper proven correct in isolation is not proof
// the real X-keydown -> held-for-N-ticks -> X-keyup path produces the same
// curve. This spec drives genuine OS-trusted key presses
// (page.keyboard.down/up, the closest thing to a real human key press
// Playwright can produce) through the actual KeyboardController ->
// DriftController -> physics pipeline, and asserts the one invariant the
// design requires (GDD): a longer hold produces a taller jump — never a
// flat short-hop/full-jump switch, and never a longer hold collapsing back
// down to a shorter one. It intentionally does not pin exact apex values
// (those stay tunable).
//
// A note on method, for whoever touches this next: an earlier version of
// this spec drove timing via a synthetic `window.dispatchEvent(new
// KeyboardEvent(...))` call scheduled with an in-page `setTimeout`, to
// avoid Playwright/CDP's own per-call dispatch jitter. That version
// reproducibly showed very-short "taps" occasionally reading as tall as a
// medium hold. Cross-checked against genuine `page.keyboard` input (this
// file), that never reproduced — so it was an artifact of timers/events
// racing the game's own requestAnimationFrame loop on one JS thread inside
// a headless/virtualized browser, not a real input bug. Real OS-dispatched
// key events don't show it. Documented here so it isn't "rediscovered" and
// chased again.

async function waitForBeyToSettle(page: Page): Promise<void> {
  // Cross-trial contamination (pressing X again before the Bey has fully
  // landed and come to rest) is a separate, pre-existing issue (present
  // since Milestone 3's original jumpDriftPressed && grounded gate, which
  // has no retry/buffer for a press that lands while airborne) and is not
  // what this spec measures — so each trial waits for a fully grounded,
  // near-zero vertical speed Bey before starting the next one.
  await page.waitForFunction(
    () => {
      const s = window.__chaosBeyDebugLab?.getSession();
      if (!s) return false;
      const r = s.getLastResult();
      const body = s.getBey('first').body;
      return !!r && r.first.grounded && Math.abs(body.linvel().y) < 0.05;
    },
    null,
    { timeout: 5000 },
  );
}

async function measureRealHoldApexM(page: Page, holdMs: number): Promise<number> {
  const baseY = await page.evaluate(() => window.__chaosBeyDebugLab!.getSession()!.getBey('first').body.translation().y);
  await page.evaluate(() => {
    const w = window as unknown as { __trialSamplesY: number[] };
    w.__trialSamplesY = [];
    const sample = (): void => {
      const s = window.__chaosBeyDebugLab?.getSession();
      if (s) w.__trialSamplesY.push(s.getBey('first').body.translation().y);
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.keyboard.down('x');
  if (holdMs > 0) await page.waitForTimeout(holdMs);
  await page.keyboard.up('x');
  await page.waitForTimeout(1600); // let the whole arc (even a full jump, ~1s airtime) finish and land
  await waitForBeyToSettle(page);
  const samples: number[] = await page.evaluate(() => (window as unknown as { __trialSamplesY: number[] }).__trialSamplesY);
  return Math.max(...samples, baseY) - baseY;
}

test('real X-key hold duration produces a strictly taller jump, tap through full hold (owner report, 2026-10-01)', async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/ChaosBey/?mode=debug-lab');
  await page.waitForFunction(() => window.__chaosBeyDebugLab?.getSession() != null, null, { timeout: 20_000 });
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await page.evaluate(() => window.__chaosBeyDebugLab!.setController('second', { kind: 'idle' }));
  await waitForBeyToSettle(page);

  // Spaced well apart — not just inside the ~220ms release window's own
  // ramp, but with enough separation between each pair — so that ordinary
  // down/up dispatch-timing jitter in a real keyboard round trip can't flip
  // two adjacent measurements. This is a test-robustness choice, not a
  // tuning one: the constants being exercised stay in DriftTuning.ts, and
  // a true instant tap (0ms) is included as its own, separate point.
  const holdsMs = [0, 120, 400];
  const apexes: number[] = [];
  for (const holdMs of holdsMs) {
    apexes.push(await measureRealHoldApexM(page, holdMs));
  }

  for (let i = 1; i < apexes.length; i++) {
    expect(apexes[i], `apex[${i}]=${apexes[i]} should exceed apex[${i - 1}]=${apexes[i - 1]} (holds: ${JSON.stringify(holdsMs)}, apexes: ${JSON.stringify(apexes)})`).toBeGreaterThan(
      apexes[i - 1]!,
    );
  }
  // Loose sanity bounds only (exact numbers stay tunable): the instant tap
  // should read as clearly short of a full jump, the longest real hold as
  // clearly reaching it.
  expect(apexes[0], `apexes=${JSON.stringify(apexes)}`).toBeLessThan(0.6);
  expect(apexes[apexes.length - 1], `apexes=${JSON.stringify(apexes)}`).toBeGreaterThan(0.9);

  expect(errors).toEqual([]);
});
