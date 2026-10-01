import { expect, test, type Page } from '@playwright/test';

// Owner report (2026-10-01): "the normal jump only does a short hop now."
//
// Every existing jump/air-control test (tests/deterministic/
// jumpAirControlHotfix.test.ts included) drives the hold duration by
// constructing ControllerActions directly, bypassing KeyboardController/
// ActionSampleBuffer entirely. That's exactly the gap the owner called
// out: a helper proven correct in isolation is not proof the real
// X-keydown -> held-for-N-ticks -> X-keyup path produces the same curve.
//
// What these specs actually exercise, precisely (owner review correction,
// 2026-10-01 — an earlier revision overstated this): `page.keyboard.down/
// up` is Playwright's automation input, delivered through Chromium's
// normal input pipeline to the page's real `window.addEventListener
// ('keydown'/'keyup', ...)` handlers — i.e. the actual production
// KeyboardController code a key press reaches. It is a real step up from
// constructing ControllerActions by hand, because it exercises that real
// listener, ActionSampleBuffer, and DriftController end to end. It is
// NOT a physical human pressing a physical key on a real Windows machine,
// and this file does not claim otherwise. It cannot, by itself, rule out
// anything specific to: the packaged Electron build, or real OS-level
// focus/blur behavior — those are tracked separately (see the PR body and
// JumpInputDiagnostics.ts).
//
// A note on method, for whoever touches this next: an earlier version of
// this spec drove timing via a synthetic `window.dispatchEvent(new
// KeyboardEvent(...))` call scheduled with an in-page `setTimeout`, to
// avoid Playwright/CDP's own per-call dispatch jitter. That version
// reproducibly showed very-short "taps" occasionally reading as tall as a
// medium hold. Cross-checked against `page.keyboard` (this file), that
// never reproduced — so it was an artifact of a synthetic timer racing the
// game's own requestAnimationFrame loop on one JS thread in a headless/
// virtualized browser, not a real input bug. Documented here so it isn't
// "rediscovered" and chased again.
//
// Hold-duration labels below are spaced wider than the owner's original
// ask (every ~40-60ms) for a concrete, measured reason: Playwright's own
// `keyboard.down`/`up` round trip through CDP has tens-of-milliseconds of
// jitter per call (confirmed via the game's own jumpAssistElapsedS
// instrumentation — see JumpInputDiagnostics.ts — logging a *larger*
// internally-measured hold for a "shorter" labeled one often enough to
// flake a tightly-spaced assertion). A real physical key press has no such
// jitter (OS keyboard scan rate is ~1ms), so this is a Playwright/CDP
// limitation on how fine a duration CI can reliably request — not a
// statement about how finely the game itself can distinguish hold
// durations. The instrumented build (?jumpDiag=1) is how the owner's own,
// real keyboard gets the fine-grained picture.

const HOLDS_MS = [0, 130, 260, 450];

function assertMonotonicRamp(holdsMs: number[], apexes: number[]): void {
  // Every pair up to and including the last point still inside the
  // ~220ms release window (JUMP_RELEASE_WINDOW_S) must strictly grow —
  // the design's own ramp guarantees this. The final pair crosses into
  // the saturated/full-jump plateau, where holding longer is allowed, by
  // design, to stop adding height (full-jump saturation, tests/
  // deterministic/jumpAirControlHotfix.test.ts's own section 34), so that
  // pair only requires not collapsing back down, not continued growth.
  for (let i = 1; i < holdsMs.length - 1; i++) {
    expect(apexes[i], `apex[${i}]=${apexes[i]} should exceed apex[${i - 1}]=${apexes[i - 1]} (holds: ${JSON.stringify(holdsMs)}, apexes: ${JSON.stringify(apexes)})`).toBeGreaterThan(
      apexes[i - 1]!,
    );
  }
  expect(apexes[apexes.length - 1], `apexes=${JSON.stringify(apexes)}`).toBeGreaterThanOrEqual(apexes[apexes.length - 2]! - 0.02);
}

async function waitForDebugLabBeyToSettle(page: Page): Promise<void> {
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

async function measureDebugLabHoldApexM(page: Page, holdMs: number): Promise<number> {
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
  await waitForDebugLabBeyToSettle(page);
  const samples: number[] = await page.evaluate(() => (window as unknown as { __trialSamplesY: number[] }).__trialSamplesY);
  return Math.max(...samples, baseY) - baseY;
}

test('Debug Lab: real X-key hold duration produces a taller jump at every step up to full (owner report, 2026-10-01)', async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/ChaosBey/?mode=debug-lab');
  await page.waitForFunction(() => window.__chaosBeyDebugLab?.getSession() != null, null, { timeout: 20_000 });
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await page.evaluate(() => window.__chaosBeyDebugLab!.setController('second', { kind: 'idle' }));
  await waitForDebugLabBeyToSettle(page);

  const apexes: number[] = [];
  for (const holdMs of HOLDS_MS) {
    apexes.push(await measureDebugLabHoldApexM(page, holdMs));
  }

  assertMonotonicRamp(HOLDS_MS, apexes);
  expect(apexes[0], `apexes=${JSON.stringify(apexes)}`).toBeLessThan(0.6);
  expect(apexes[apexes.length - 1], `apexes=${JSON.stringify(apexes)}`).toBeGreaterThan(0.9);
  expect(errors).toEqual([]);
});

test.describe('real match jump curve', () => {
  // A live AI opponent can, independent of jump-cut logic, transiently
  // clip/bounce the player's Bey (see the PR body) — when that overlaps
  // with this test's own X press, it triggers a separate, already-known
  // bug (jumpDriftPressed && !grounded silently drops the press, tracked
  // in JumpInputDiagnostics.ts's pressDroppedWhileAirborne event), not a
  // regression in computeJumpReleaseCapMps. That's a real, reproducible
  // issue worth fixing on its own, but intentionally not fixed by this PR
  // (owner instruction — it changes control semantics). Retrying absorbs
  // its rare, random timing so this test still reliably catches an actual
  // regression in the cut logic itself, which would fail deterministically
  // on every retry, not just sometimes.
  test.describe.configure({ retries: 2 });

  test('Real match (PLAY mode, live AI opponent): X-key hold duration produces a taller jump at every step up to full (owner report, 2026-10-01)', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // The actual player flow (Character Select -> Pregame -> match), the
  // same path tests/smoke/driftFeedback.spec.ts's "Play:" test already
  // uses — a real match, real AI opponent, real HUD/round flow, not the
  // Debug Lab's bare arena. (Note: ?mode=play&quick, despite its name,
  // bypasses PlayFlow entirely via MatchRunner.start directly — see
  // src/app/modes/playMode.ts — so window.__chaosBeyPlay, which only
  // PlayFlow sets, is never defined there; this is the real flow.) This is
  // the closest this spec gets to the conditions the owner actually played
  // in, short of the packaged Electron build itself, which Playwright
  // can't drive.
  await page.goto('/ChaosBey/?mode=play');
  await page.getByTestId('character-select').waitFor({ timeout: 20_000 });
  await page.keyboard.press('Enter');
  await page.getByTestId('pregame-start').click();
  await page.waitForFunction(() => window.__chaosBeyPlay?.getScreen() === 'match' && window.__chaosBeyPlay.getSession() != null, null, { timeout: 30_000 });
  await page.waitForTimeout(1500); // past the FIGHT banner
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());

  const waitForSettle = async (): Promise<void> => {
    await page.waitForFunction(
      () => {
        const s = window.__chaosBeyPlay?.getSession();
        if (!s) return false;
        const r = s.getLastResult();
        const body = s.getBey('first').body;
        return !!r && r.first.grounded && Math.abs(body.linvel().y) < 0.05;
      },
      null,
      { timeout: 5000 },
    );
    // A live AI opponent means "grounded now" doesn't mean "grounded for
    // the next several ticks" — a nudge/bounce right after this resolves
    // is exactly what feeds the known airborne-press-drop bug (see the PR
    // body). A short settle margin reduces, though cannot eliminate, that
    // race; a real fix belongs to that separately-tracked issue, not here.
    await page.waitForTimeout(150);
  };

  // A real match has a real AI opponent: a Dash/Clash hit landing on the
  // player's Bey mid-air stacks knockback on top of whatever vy the jump
  // still has (the same additive-impulse mechanism PR #74/#75 relied on to
  // fix the ring-out scenario) — producing a height no amount of X-holding
  // alone can reach (the approved jump ceiling is ~1.5m; this threshold is
  // deliberately well above it). That is a real combat interaction, not a
  // jump-hold-duration defect, so a trial landing in that range is retried
  // once (after a fresh settle) rather than treated as this test's signal.
  const COMBAT_CONTAMINATION_THRESHOLD_M = 1.6;

  const measureOnce = async (holdMs: number): Promise<number> => {
    const baseY = await page.evaluate(() => window.__chaosBeyPlay!.getSession()!.getBey('first').body.translation().y);
    await page.evaluate(() => {
      const w = window as unknown as { __trialSamplesY: number[] };
      w.__trialSamplesY = [];
      const sample = (): void => {
        const s = window.__chaosBeyPlay?.getSession();
        if (s) w.__trialSamplesY.push(s.getBey('first').body.translation().y);
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await page.keyboard.down('x');
    if (holdMs > 0) await page.waitForTimeout(holdMs);
    await page.keyboard.up('x');
    await page.waitForTimeout(1600);
    await waitForSettle();
    const samples: number[] = await page.evaluate(() => (window as unknown as { __trialSamplesY: number[] }).__trialSamplesY);
    return Math.max(...samples, baseY) - baseY;
  };

  const measure = async (holdMs: number): Promise<number> => {
    // Re-confirm settle immediately before pressing (not just once before
    // the whole loop) — a live AI opponent can nudge/clip the player Bey
    // between trials, and starting a hold while the Bey still has residual
    // vertical velocity from that would add to this hop's own launch
    // velocity, confounding the height-vs-duration measurement with
    // unrelated combat physics.
    await waitForSettle();
    const first = await measureOnce(holdMs);
    if (first <= COMBAT_CONTAMINATION_THRESHOLD_M) return first;
    await waitForSettle();
    return measureOnce(holdMs);
  };

  await waitForSettle();
  const apexes: number[] = [];
  for (const holdMs of HOLDS_MS) {
    apexes.push(await measure(holdMs));
    await page.waitForTimeout(700);
  }

  assertMonotonicRamp(HOLDS_MS, apexes);
  expect(apexes[0], `apexes=${JSON.stringify(apexes)}`).toBeLessThan(0.6);
  expect(apexes[apexes.length - 1], `apexes=${JSON.stringify(apexes)}`).toBeGreaterThan(0.9);
  expect(errors).toEqual([]);
  });
});
