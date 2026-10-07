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
  // The whole gesture is played from INSIDE the page, scheduled in simulation ticks — the game's own clock — and not as a
  // chain of Playwright key presses separated by waits. The game reads `KeyboardEvent.code` from the window and measures a
  // tap by simulation time, so synthetic events are what it sees from a keyboard; what they add is that the timing no longer
  // depends on how long a round trip to the browser takes. As separate Playwright calls the gesture failed on slow and loaded
  // runners: the 60 ms between the tap and the second press collapsed into one frame (a held press = the full jump), or a
  // longer wait outlasted the 1 s drift window.
  //   1. ArrowUp for 42 ticks (0.7 s) to build speed;
  //   2. release it, tap X (down + up at once = the short hop);
  //   3. 12 ticks later (0.2 s: inside the hop, a later frame than the tap) press X again and the turn, X first, then the
  //      turn: the drift latches its reference direction when X goes down and starts on a turn AWAY from it, so a tick that
  //      sees ArrowRight held before X latches the turn itself as the reference and never drifts.
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const session = (window.__chaosBeyPlay ?? window.__chaosBeyDebugLab)!.getSession()!;
        const fire = (type: 'keydown' | 'keyup', code: string, key: string): void => {
          window.dispatchEvent(new KeyboardEvent(type, { code, key, bubbles: true, cancelable: true }));
        };
        const steps: { atTick: number; run: () => void }[] = [];
        const start = session.getTickIndex();
        fire('keydown', 'ArrowUp', 'ArrowUp');
        steps.push({ atTick: start + 42, run: () => { fire('keyup', 'ArrowUp', 'ArrowUp'); fire('keydown', 'KeyX', 'x'); fire('keyup', 'KeyX', 'x'); } });
        steps.push({ atTick: start + 42 + 12, run: () => { fire('keydown', 'KeyX', 'x'); fire('keydown', 'ArrowRight', 'ArrowRight'); } });
        const startedAt = performance.now();
        const frame = (): void => {
          // One step per frame: a slow frame that jumps many ticks must not fold the tap and the second press into one.
          if (steps.length > 0 && session.getTickIndex() >= steps[0]!.atTick) steps.shift()!.run();
          if (steps.length === 0) resolve();
          else if (performance.now() - startedAt > 30_000) reject(new Error('the drift gesture timed out'));
          else requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      }),
  );
}

async function releaseDrift(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyX', key: 'x', bubbles: true, cancelable: true }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ArrowRight', key: 'ArrowRight', bubbles: true, cancelable: true }));
  });
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
  // The opponent stays out of the way (as in the Debug Lab test below): this checks the drift, and a bump from the AI
  // that launches the Bey is a legitimate drift end. With Lote 3's body collisions and Lote 4's longer full jump (X
  // goes down before the turn) it happened once on CI (Drifting,Recovering,Recovering,Idle) after passing the run before.
  await page.evaluate(() => {
    const s = window.__chaosBeyPlay!.getSession()!;
    s.setController('second', { kind: 'idle' });
    const p = s.getBey('first').body.translation();
    // Behind it: the drive goes forward. On the floor, not at the player's height: the default stage is a funnel
    // (Bowl B, 8.5 m deep), where that height is inside the floor 6 m further out (the opponent fell through, the
    // round ended as a ring-out and the HUD stayed on its last frame, "Drifting").
    const behind = { x: p.x, z: p.z - 6 };
    s.getBey('second').body.setTranslation({ x: behind.x, y: s.floorHeightAt(behind.x, behind.z) + 0.6, z: behind.z }, true);
    s.getBey('second').body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  });

  const tag = page.getByTestId('hud-drift');
  // Observe the drift from INSIDE the page, in simulation ticks, with the observer installed BEFORE the keys go down. This
  // used to be a poll, a text check and four 100 ms waits after the keys, each a round trip to the browser, and on a slow
  // or loaded runner those took so long that the Bey (top speed ×2.8: the wall is ~1.2 s of drift away) hit the wall, broke
  // the drift and the test saw it end before its first sample (CI; and 1 run in ~15 on a loaded machine). The drift's first
  // 30 ticks (0.5 s, the wall is further than that) are recorded as they happen, however late the test looks at them.
  await page.evaluate(() => {
    const hud = document.querySelector('[data-testid="hud-drift"]')!;
    const session = window.__chaosBeyPlay!.getSession()!;
    const watch = { text: null as string | null, states: [] as string[], counts: null as ReturnType<typeof session.getDriftVfxCounts> | null, firstTick: -1 };
    (window as unknown as { __driftWatch: typeof watch }).__driftWatch = watch;
    const frame = (): void => {
      if (watch.counts === null) {
        const state = hud.getAttribute('data-state') ?? '';
        if (watch.firstTick < 0 && state === 'Drifting') {
          watch.firstTick = session.getTickIndex();
          watch.text = hud.textContent;
        }
        if (watch.firstTick >= 0) {
          watch.states.push(state);
          if (session.getTickIndex() >= watch.firstTick + 30) watch.counts = session.getDriftVfxCounts('first');
        }
        requestAnimationFrame(frame);
      }
    };
    requestAnimationFrame(frame);
  });
  await driveIntoDrift(page);
  await page.waitForFunction(() => (window as unknown as { __driftWatch: { counts: unknown } }).__driftWatch.counts !== null, null, { timeout: 15_000 }).catch(async (error: Error) => {
    const watch = await page.evaluate(() => {
      const w = (window as unknown as { __driftWatch: { firstTick: number; states: string[] } }).__driftWatch;
      const session = window.__chaosBeyPlay!.getSession()!;
      return { firstTick: w.firstTick, states: w.states.slice(0, 40).join(','), tick: session.getTickIndex(), drift: session.getLastResult()?.first.driftState, round: session.roundState.result };
    });
    throw new Error(`${error.message} — ${JSON.stringify(watch)}`);
  });
  const drifting = await page.evaluate(() => (window as unknown as { __driftWatch: { text: string | null; states: string[]; counts: { driftStarts: number; drawnDecals: number } } }).__driftWatch);
  expect(drifting.text).toBe('DRIFT');
  const states = drifting.states;
  const during = drifting.counts;
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

  // The skid marks stay on the floor after the drift: the picture is taken once it has ended, not inside the drift.
  fs.mkdirSync('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/drift-play.png' });

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
