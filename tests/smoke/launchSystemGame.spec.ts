import { type Page } from '@playwright/test';
import { expect, test } from './support/launchFixture';
import { baselineUrl } from './presentationBaseline';

// ============================================================
// LAUNCH SYSTEM A — TIMING SNAP, IN THE GAME (0.61.0), production build.
// Owner-approved 2026-10-07 (docs/design-decisions/launch-system-approval.md): the round starts with both Beys mounted in
// physical launchers; the player chooses the entry point and presses LAUNCH once; both Beys travel into the stage; Combat
// begins as soon as both have touched down — no 3 / 2 / 1 / GO, no hold, no input lock.
// These specs drive the launch by hand (the other specs press LAUNCH by themselves: support/launchFixture.ts).
// ============================================================

test.use({ autoLaunch: false });

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  return errors;
}

async function startMatch(page: Page): Promise<void> {
  await page.goto(baselineUrl('/ChaosBey/?mode=play'));
  await page.getByTestId('character-select-confirm').click({ timeout: 15_000 });
  await page.getByTestId('pregame-start').click();
  await expect.poll(() => page.evaluate(() => window.__chaosBeyPlay?.getScreen()), { timeout: 15_000 }).toBe('match');
}

const phase = (page: Page): Promise<string | null> => page.evaluate(() => window.__chaosBeyPlay?.getLaunch()?.view.phase ?? null);
const tick = (page: Page): Promise<number> => page.evaluate(() => window.__chaosBeyPlay!.getSession()!.getTickIndex());

async function waitArmed(page: Page): Promise<void> {
  await expect.poll(() => phase(page), { timeout: 30_000 }).toBe('armed');
}

test('a round starts mounted in the launchers, with no match tick until the player launches', async ({ page }) => {
  const errors = watchErrors(page);
  await startMatch(page);
  await waitArmed(page);
  await expect(page.getByTestId('launch-hud')).toBeVisible();
  await expect(page.getByTestId('launch-phase')).toHaveText('TARGET · TIME YOUR LAUNCH');
  await expect(page.getByTestId('launch-meter')).toBeVisible();
  await expect(page.getByTestId('launch-button')).toBeEnabled();
  // Nothing of the fight runs while the launch waits for the person: no tick, no result, no launch result yet.
  const waiting = await page.evaluate(() => {
    const session = window.__chaosBeyPlay!.getSession()!;
    return { tick: session.getTickIndex(), result: session.getLaunchResult(), launched: window.__chaosBeyPlay!.getLaunch()?.finished };
  });
  expect(waiting).toEqual({ tick: 0, result: null, launched: false });
  // It waits as long as the player takes (the marker keeps sweeping, the Beys stay mounted).
  await page.waitForTimeout(1500);
  expect(await phase(page)).toBe('armed');
  expect(await tick(page)).toBe(0);
  expect(errors).toEqual([]);
});

test('the arrows choose the entry point, the point stays inside the arena, and Center puts it back', async ({ page }) => {
  const errors = watchErrors(page);
  await startMatch(page);
  await waitArmed(page);
  const target = (): Promise<{ x: number; z: number }> => page.evaluate(() => window.__chaosBeyPlay!.getLaunch()!.view.targets.first);
  const start = await target();
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(700);
  await page.keyboard.up('ArrowUp');
  const forward = await target();
  expect(forward.z).toBeGreaterThan(start.z + 1); // up = toward the opponent
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(500);
  await page.keyboard.up('ArrowRight');
  const right = await target();
  expect(right.x).toBeLessThan(forward.x - 1); // the first launcher looks along +z: screen-right is −x
  // Held long enough, it stops at the edge of the valid area (never outside the arena).
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(4000);
  await page.keyboard.up('ArrowUp');
  const edge = await target();
  expect(Math.hypot(edge.x, edge.z)).toBeLessThanOrEqual(36 * (29 / 36) + 0.01);
  await page.getByTestId('launch-center').click();
  const centred = await target();
  expect(centred.x).toBeCloseTo(start.x, 3);
  expect(centred.z).toBeCloseTo(start.z, 3);
  expect(await phase(page)).toBe('armed'); // choosing a point never launches
  expect(errors).toEqual([]);
});

test('a click on the arena places the entry point', async ({ page }) => {
  const errors = watchErrors(page);
  await startMatch(page);
  await waitArmed(page);
  const before = await page.evaluate(() => window.__chaosBeyPlay!.getLaunch()!.view.targets.first);
  const viewport = page.viewportSize()!;
  await page.mouse.click(viewport.width * 0.62, viewport.height * 0.42);
  const after = await page.evaluate(() => window.__chaosBeyPlay!.getLaunch()!.view.targets.first);
  expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeGreaterThan(1);
  expect(Math.hypot(after.x, after.z)).toBeLessThanOrEqual(29.01);
  expect(await phase(page)).toBe('armed');
  expect(errors).toEqual([]);
});

test('one press of LAUNCH releases both Beys, they arrive, and Combat runs at once — no countdown, no hold', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  await startMatch(page);
  await waitArmed(page);
  // Watch the whole event from inside the page: every phase seen, and the tick index at the moment of arrival and just after.
  await page.evaluate(() => {
    const seen: string[] = [];
    const log: { phases: string[]; landedAtMs: number | null; firstTickAtMs: number | null; flying: { first: boolean; second: boolean } } = { phases: seen, landedAtMs: null, firstTickAtMs: null, flying: { first: false, second: false } };
    (window as unknown as { __launchLog: typeof log }).__launchLog = log;
    const step = (): void => {
      const flow = window.__chaosBeyPlay!.getLaunch();
      const session = window.__chaosBeyPlay!.getSession();
      if (flow) {
        const p = flow.view.phase;
        if (seen[seen.length - 1] !== p) seen.push(p);
        if (p === 'landed' && log.landedAtMs === null) log.landedAtMs = performance.now();
      }
      if (session && session.getTickIndex() > 0 && log.firstTickAtMs === null) log.firstTickAtMs = performance.now();
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  await page.keyboard.press('z');
  await expect.poll(() => phase(page), { timeout: 5_000 }).not.toBe('armed');
  await expect(page.getByTestId('launch-grade')).toHaveAttribute('data-grade', /^(PERFECT|STRONG|CLEAN|WEAK)$/); // the grade of the launch (it fades after a moment)
  // The match starts right after the arrival.
  await expect.poll(() => tick(page), { timeout: 30_000 }).toBeGreaterThan(10);
  const log = await page.evaluate(() => (window as unknown as { __launchLog: { phases: string[]; landedAtMs: number | null; firstTickAtMs: number | null } }).__launchLog);
  // (A slow frame can step over the short 'release'; the travel itself and the landing are always seen.)
  expect(log.phases).toEqual(expect.arrayContaining(['armed', 'landed']));
  expect(log.phases.includes('release') || log.phases.includes('flight')).toBe(true);
  expect(log.phases.includes('countdown')).toBe(false);
  // No delay between the arrival and the first tick of the fight beyond a couple of frames (a countdown would be seconds).
  expect(log.landedAtMs).not.toBeNull();
  expect(log.firstTickAtMs).not.toBeNull();
  expect(log.firstTickAtMs! - log.landedAtMs!).toBeLessThan(400);
  // The result of the launch is what the match started from, and the screen has no countdown.
  const result = await page.evaluate(() => window.__chaosBeyPlay!.getSession()!.getLaunchResult());
  expect(result).not.toBeNull();
  expect(result!.first.quality).toBeGreaterThanOrEqual(0);
  await expect(page.getByText(/^(3|2|1|GO!?)$/)).toHaveCount(0);
  // The Beys fight: the HUD says FIGHT! and the first Bey answers to the arrows.
  await expect(page.getByTestId('hud-banner')).toContainText('FIGHT!');
  expect(errors).toEqual([]);
});

test('Esc during the launch pauses it, and Resume carries on with the same launch', async ({ page }) => {
  const errors = watchErrors(page);
  await startMatch(page);
  await waitArmed(page);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pause-menu')).toBeVisible();
  const armedAt = await page.evaluate(() => window.__chaosBeyPlay!.getLaunch()!.view.armedS);
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => window.__chaosBeyPlay!.getLaunch()!.view.armedS)).toBe(armedAt); // the marker is frozen
  await page.getByTestId('pause-menu-resume').click();
  await expect(page.getByTestId('pause-menu')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__chaosBeyPlay!.getLaunch()!.view.armedS)).toBeGreaterThan(armedAt);
  await page.keyboard.press('z');
  await expect.poll(() => tick(page), { timeout: 30_000 }).toBeGreaterThan(10);
  expect(errors).toEqual([]);
});

test('a key still held through the launch does not start a Dash the instant the fight begins', async ({ page }) => {
  test.setTimeout(120_000);
  await startMatch(page);
  await waitArmed(page);
  await page.keyboard.down('z'); // launch with Attack and keep holding it
  await expect.poll(() => tick(page), { timeout: 30_000 }).toBeGreaterThan(2);
  const attackStates = await page.evaluate(async () => {
    const out: string[] = [];
    for (let i = 0; i < 12; i++) {
      out.push(String(window.__chaosBeyPlay!.getSession()!.getLastResult()?.first.attackState));
      await new Promise((r) => requestAnimationFrame(r));
    }
    return out;
  });
  await page.keyboard.up('z');
  expect(attackStates.every((s) => s === 'Neutral')).toBe(true);
});
