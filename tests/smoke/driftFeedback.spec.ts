import { expect, test, type Page } from '@playwright/test';
import { baselineUrl } from './presentationBaseline';
import * as fs from 'fs';

// Owner playtest (after M11): "hop with X, keep holding X — the drift has no
// clear visual indicator and often doesn't even seem to start". In the
// production build, with real key presses: the drift starts, lasts while X is
// held, draws skid marks and sparks, shows the temporary DRIFT tag, and ends
// with the grip-regain ring once X is released — on the flat floor and on
// bowls A/B/C.

async function driveIntoDrift(page: Page): Promise<void> {
  await page.keyboard.down('ArrowUp');
  // Build speed for 0.7 s of SIMULATION time (42 fixed ticks), not wall time: on a
  // slow runner (CI's software-rendered browser, or one CPU core — it fails on
  // main too) the frame rate drops and 700 ms of wall time is far fewer ticks.
  const startTick = await page.evaluate(() => (window.__chaosBeyPlay ?? window.__chaosBeyDebugLab)!.getSession()!.getTickIndex());
  await page.waitForFunction((t0) => (window.__chaosBeyPlay ?? window.__chaosBeyDebugLab)!.getSession()!.getTickIndex() >= t0 + 42, startTick, { timeout: 20_000 });
  // Turn as X goes down: X + a real turn is a drift (X held going straight
  // would be the variable jump — see DriftController).
  await page.keyboard.up('ArrowUp');
  // X first, then the turn: the drift latches its reference direction when X goes
  // down and starts on a turn AWAY from it, so a tick that sees ArrowRight already
  // held before X (two key events can land in different frames on a slow runner)
  // latches the turn itself as the reference and never drifts.
  await page.keyboard.down('x');
  await page.keyboard.down('ArrowRight');
}

async function releaseDrift(page: Page): Promise<void> {
  await page.keyboard.up('x');
  await page.keyboard.up('ArrowRight');
}

test('Play: the drift starts, shows DRIFT, skid marks and sparks, and ends with GRIP', async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(baselineUrl('/ChaosBey/?mode=play'));
  await page.getByTestId('character-select').waitFor({ timeout: 20_000 });
  await page.keyboard.press('Enter');
  await page.getByTestId('pregame-start').click();
  await page.waitForFunction(() => window.__chaosBeyPlay?.getScreen() === 'match' && window.__chaosBeyPlay.getSession() != null, null, { timeout: 30_000 });
  await page.waitForTimeout(1200); // past the FIGHT banner

  const tag = page.getByTestId('hud-drift');
  const states: string[] = [];
  await driveIntoDrift(page);
  await expect.poll(async () => (await tag.getAttribute('data-state')) ?? '', { timeout: 3000 }).toBe('Drifting');
  await expect(tag).toHaveText('DRIFT');
  // It stays in the drift while X is held.
  for (let i = 0; i < 4; i++) {
    await page.waitForTimeout(150);
    states.push((await tag.getAttribute('data-state')) ?? '');
  }
  fs.mkdirSync('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/drift-play.png' });
  const during = await page.evaluate(() => window.__chaosBeyPlay!.getSession()!.getDriftVfxCounts('first'));
  await releaseDrift(page);
  // Read state and text together, in one evaluation: on a slow, software-rendered
  // runner the Recovering window can pass between two separate reads (the state
  // poll saw Recovering, then the text read found it already gone). Whatever frame
  // we see after the release must be consistent: Recovering shows GRIP.
  const readTag = () => page.evaluate(() => {
    const el = document.querySelector('[data-testid="hud-drift"]');
    return `${el?.getAttribute('data-state') ?? ''}|${el?.textContent ?? ''}`;
  });
  let afterRelease = '';
  await expect
    .poll(async () => {
      afterRelease = await readTag(); // the first frame after the drift ended, state and text from the same read
      return afterRelease.split('|')[0];
    }, { timeout: 2000 })
    .not.toBe('Drifting');
  if (afterRelease.startsWith('Recovering')) expect(afterRelease).toBe('Recovering|GRIP');
  await expect.poll(async () => (await tag.getAttribute('data-state')) ?? '', { timeout: 3000 }).toBe('Idle');
  const after = await page.evaluate(() => window.__chaosBeyPlay!.getSession()!.getDriftVfxCounts('first'));

  expect(states.every((s) => s === 'Drifting'), states.join(',')).toBe(true);
  expect(during.driftStarts).toBe(1);
  expect(during.drawnDecals).toBeGreaterThan(15); // a continuous skid stripe
  expect(after.driftEnds).toBe(1);
  expect(errors).toEqual([]);
});

test('Debug Lab: the drift cycle on the flat floor and on bowls A/B/C', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(baselineUrl('/ChaosBey/?mode=debug-lab'));
  await expect.poll(() => page.evaluate(() => window.__chaosBeyDebugLab?.getSession() != null), { timeout: 20_000 }).toBe(true);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

  const results: Record<string, { starts: number; ends: number; decals: number; driftTicks: number }> = {};
  for (const floor of ['flat', 'bowl-a', 'bowl-b', 'bowl-c'] as const) {
    await page.evaluate(async (f) => {
      const lab = window.__chaosBeyDebugLab!;
      await lab.setArenaFloor(f);
      lab.setController('second', { kind: 'idle' });
      // The idle opponent waits off to the side, out of the drive's path.
      const second = lab.getSession()!.getBey('second').body;
      second.setTranslation({ x: 7, y: second.translation().y + 0.5, z: 6 }, true);
    }, floor);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.waitForTimeout(800); // land and settle
    await page.evaluate(() => {
      const w = window as unknown as { __driftTicks: number; __driftRaf: number };
      w.__driftTicks = 0;
      let last = -1;
      const loop = (): void => {
        const s = window.__chaosBeyDebugLab!.getSession();
        const r = s?.getLastResult();
        if (s && r && s.getTickIndex() !== last) {
          last = s.getTickIndex();
          if (r.first.driftState === 'Drifting') w.__driftTicks++;
        }
        w.__driftRaf = requestAnimationFrame(loop);
      };
      w.__driftRaf = requestAnimationFrame(loop);
    });
    await driveIntoDrift(page);
    await page.waitForTimeout(1600);
    await releaseDrift(page);
    await page.waitForTimeout(800);
    results[floor] = await page.evaluate(() => {
      const w = window as unknown as { __driftTicks: number; __driftRaf: number };
      cancelAnimationFrame(w.__driftRaf);
      const c = window.__chaosBeyDebugLab!.getSession()!.getDriftVfxCounts('first');
      return { starts: c.driftStarts, ends: c.driftEnds, decals: c.drawnDecals, driftTicks: w.__driftTicks };
    });
  }
  for (const [floor, r] of Object.entries(results)) {
    expect(r.starts, `${floor}: ${JSON.stringify(r)}`).toBeGreaterThanOrEqual(1);
    expect(r.ends, `${floor}: ${JSON.stringify(r)}`).toBeGreaterThanOrEqual(1);
    expect(r.decals, `${floor}: ${JSON.stringify(r)}`).toBeGreaterThan(10);
  }
  fs.mkdirSync('test-results', { recursive: true });
  fs.writeFileSync('test-results/drift-floors.json', JSON.stringify(results, null, 2));
  expect(errors).toEqual([]);
});
