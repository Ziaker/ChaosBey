import { expect, test, type Page } from '@playwright/test';

// M11 directional control (closed decision, owner playtest 2026-09):
// ↑/↓/←/→ move the player's Bey along a FIXED world direction (Up = world
// +Z, Right = world +X, etc.) — the camera plays no part in this at all,
// whatever it's currently doing on screen. Checked in two very different
// camera orientations (the Debug Lab's high overview, looking -Z, and the
// game's chase camera behind the first Bey) by measuring the Bey's actual
// WORLD displacement, not a screen-space projection: the whole point being
// verified is that the world result is identical no matter what the
// camera looks like.

type Direction = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';

const nextFrame = (page: Page): Promise<unknown> => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

async function holdAndMeasureWorldDisplacement(page: Page, key: Direction): Promise<{ x: number; z: number }> {
  const start = await page.evaluate(async () => {
    const lab = window.__chaosBeyDebugLab!;
    await lab.restart('m11-directional-smoke');
    lab.setPaused(true);
    lab.step(40); // land and settle
    // Room in every direction: the player's Bey at the centre, the idle opponent well off the four axes.
    const session = lab.getSession()!;
    const first = session.getBey('first').body;
    const second = session.getBey('second').body;
    first.setTranslation({ x: 0, y: first.translation().y, z: 0 }, true);
    first.setLinvel({ x: 0, y: 0, z: 0 }, true);
    second.setTranslation({ x: 7.5, y: second.translation().y, z: 7.5 }, true);
    second.setLinvel({ x: 0, y: 0, z: 0 }, true);
    lab.step(5);
    return first.translation();
  });
  // Let a frame draw so the (irrelevant, by design) on-screen camera updates too — proves nothing about it feeds back into input.
  await nextFrame(page);
  await page.keyboard.down(key);
  // 1.25 s: long enough for a full turnaround (brake, pivot, go) at the Bey's turn rate.
  await page.evaluate(() => window.__chaosBeyDebugLab!.step(75));
  await page.keyboard.up(key);
  const end = await page.evaluate(() => window.__chaosBeyDebugLab!.getSession()!.getBey('first').body.translation());
  return { x: end.x - start.x, z: end.z - start.z };
}

test('Directional (experimental): arrows move the Bey along a fixed world axis, identically in two very different camera orientations', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // Directional is no longer the default (Classic/Bey-relative is, see
  // PlayerSettings.ts's header) — the Debug Lab reads the control scheme
  // from Settings once at startup, so it must be set before the page loads.
  await page.addInitScript(() => localStorage.setItem('chaosbey.settings.player.v1', JSON.stringify({ controlScheme: 'directional' })));
  await page.goto('/ChaosBey/?mode=debug-lab');
  await expect.poll(() => page.evaluate(() => window.__chaosBeyDebugLab?.getSession() != null), { timeout: 20_000 }).toBe(true);
  // Nobody else moving: the opponent idles.
  await page.evaluate(() => window.__chaosBeyDebugLab!.setController('second', { kind: 'idle' }));
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

  const expected: Record<Direction, { axis: 'x' | 'z'; sign: 1 | -1 }> = {
    ArrowUp: { axis: 'z', sign: 1 },
    ArrowDown: { axis: 'z', sign: -1 },
    ArrowLeft: { axis: 'x', sign: -1 },
    ArrowRight: { axis: 'x', sign: 1 },
  };

  const worldByView: Record<string, Partial<Record<Direction, { x: number; z: number }>>> = {};
  for (const view of ['overview', 'game'] as const) {
    await page.evaluate((v) => window.__chaosBeyDebugLab!.setCameraView(v), view);
    worldByView[view] = {};
    for (const key of Object.keys(expected) as Direction[]) {
      const world = await holdAndMeasureWorldDisplacement(page, key);
      worldByView[view]![key] = world;
      const { axis, sign } = expected[key];
      const other = axis === 'x' ? 'z' : 'x';
      const label = `${view} ${key}: world displacement (${world.x.toFixed(3)}, ${world.z.toFixed(3)})`;
      expect(world[axis] * sign, label).toBeGreaterThan(0);
      expect(Math.abs(world[axis]), label).toBeGreaterThan(Math.abs(world[other]));
    }
  }

  // The load-bearing check: the SAME key produces the SAME world
  // displacement (within the noise of two independently-run 1.25 s drives)
  // in the overview camera and in the game's chase camera — two views that
  // look nothing alike. A camera-relative scheme would fail this outright.
  for (const key of Object.keys(expected) as Direction[]) {
    const a = worldByView.overview![key]!;
    const b = worldByView.game![key]!;
    const label = `${key}: overview (${a.x.toFixed(2)}, ${a.z.toFixed(2)}) vs game (${b.x.toFixed(2)}, ${b.z.toFixed(2)})`;
    expect(Math.hypot(a.x - b.x, a.z - b.z), label).toBeLessThan(1.5);
  }

  // The inspector shows the desired input next to the physical heading.
  const desired = await page.evaluate(() => window.__chaosBeyDebugLab!.getSession()!.getLastActions('first')?.moveIntent ?? null);
  expect(desired).not.toBeNull();
  expect(errors).toEqual([]);
});

test('real keyboard, real AI fight: holding a direction through jump/drift/knockback never silently zeroes input', async ({ page }) => {
  // Owner playtest requirement: never accept a tick where a held arrow
  // produces no applied movement without an observable reason. Runs a real
  // fight (a real AI opponent, so the camera moves a lot and real
  // knockbacks happen) with real Playwright keyboard events, and traces
  // every tick — any violation is reported with the full context asked
  // for (tick, state, input, desired vector, controller, lock reason,
  // velocity, grounded, camera) rather than masked by a threshold.
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/ChaosBey/?mode=debug-lab');
  await expect.poll(() => page.evaluate(() => window.__chaosBeyDebugLab?.getSession() != null), { timeout: 20_000 }).toBe(true);
  await page.evaluate(() => window.__chaosBeyDebugLab!.setController('second', { kind: 'ai', personality: 'archetype' }));
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.evaluate(() => window.__chaosBeyDebugLab!.setPaused(true));

  // Under Classic (default, this test doesn't override the control scheme),
  // a held arrow passes straight through as its raw Action — never through
  // moveIntent (see DirectionalController.ts's header) — so the only
  // legitimate reason for it to go missing from `held` is one of the
  // approved input locks (inputLockReason.ts: Hitstop, an Active Clash, or
  // a decided round).
  const EXPECTED_ACTION: Record<Direction, string> = { ArrowUp: 'MoveForward', ArrowDown: 'MoveBackward', ArrowLeft: 'SteerLeft', ArrowRight: 'SteerRight' };

  async function driveAndTrace(key: Direction, jump: boolean, ticks: number) {
    const expectedAction = EXPECTED_ACTION[key];
    await page.keyboard.down(key);
    if (jump) await page.keyboard.down('KeyX');
    const result = await page.evaluate(
      ({ ticksToRun, expectedAction }) => {
        const lab = window.__chaosBeyDebugLab!;
        const session = lab.getSession()!;
        const violations: unknown[] = [];
        for (let i = 0; i < ticksToRun; i++) {
          lab.step(1);
          const actions = session.getLastActions('first');
          const held = [...(actions?.held ?? [])] as string[];
          const bey = session.getBey('first');
          const grounded = session.getLastResult()?.first.grounded ?? false;
          const owner = session.getController('first');
          const ownerIsHuman = owner?.constructor?.name !== 'AIController';
          if (!ownerIsHuman) {
            violations.push({ reason: 'controller-owner-flipped-to-ai', tick: session.getTickIndex() });
            continue;
          }
          const camera = session.getLastCameraOutput();
          const isHitstopActive = camera?.isHitstopActive ?? false;
          const clashActive = session.clash.controller.getState() === 'Active';
          const roundOver = session.roundState.result !== 'Ongoing';
          const lockReason = isHitstopActive ? 'Hitstop' : clashActive ? 'Clash' : roundOver ? 'RoundEnd' : 'none';
          if (!held.includes(expectedAction) && lockReason === 'none') {
            violations.push({
              tick: session.getTickIndex(),
              held,
              moveIntent: actions?.moveIntent ?? null,
              velocity: bey.body.linvel(),
              grounded,
              cameraYawDeg: camera?.yawDeg ?? null,
              driftState: session.getLastResult()?.first.driftState,
            });
          }
        }
        return { violations, finalController: session.getController('first')?.constructor?.name };
      },
      { ticksToRun: ticks, expectedAction },
    );
    await page.keyboard.up(key);
    if (jump) await page.keyboard.up('KeyX');
    return result;
  }

  // ~4 s held forward (through whatever the real fight throws at it:
  // knockback, wall bounce, the opponent's own attacks), then a jump, then
  // a direction switch — all with the same key never released in between
  // except as scripted.
  const first = await driveAndTrace('ArrowUp', false, 240);
  expect(first.violations, `violations while holding ArrowUp: ${JSON.stringify(first.violations, null, 2)}`).toEqual([]);

  const withJump = await driveAndTrace('ArrowUp', true, 60);
  expect(withJump.violations, `violations while holding ArrowUp + Jump: ${JSON.stringify(withJump.violations, null, 2)}`).toEqual([]);

  const switched = await driveAndTrace('ArrowRight', false, 120);
  expect(switched.violations, `violations after switching to ArrowRight: ${JSON.stringify(switched.violations, null, 2)}`).toEqual([]);
  expect(switched.finalController).not.toBe('AIController');

  expect(errors).toEqual([]);
});

test('Classic (default): a held key keeps the same meaning while the real camera orbits through a real AI fight', async ({ page }) => {
  // Reproduces the owner's "Fix 6" report directly: the default scheme is
  // now Bey-relative (Classic), which has no absolute axis to fall out of
  // alignment with the screen as the camera orbits. This asserts the
  // structural guarantee in a real browser: ArrowUp always resolves to
  // Action.MoveForward held, on every tick, while a real fight makes the
  // camera swing through a large orbit — never routed through moveIntent,
  // never reading the camera at all.
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/ChaosBey/?mode=debug-lab');
  await expect.poll(() => page.evaluate(() => window.__chaosBeyDebugLab?.getSession() != null), { timeout: 20_000 }).toBe(true);
  await page.evaluate(() => window.__chaosBeyDebugLab!.setController('second', { kind: 'ai', personality: 'archetype' }));
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.evaluate(() => window.__chaosBeyDebugLab!.setPaused(true));

  await page.keyboard.down('ArrowUp');
  const result = await page.evaluate(() => {
    const lab = window.__chaosBeyDebugLab!;
    const session = lab.getSession()!;
    const violations: unknown[] = [];
    const cameraYawsDeg: number[] = [];
    for (let i = 0; i < 300; i++) {
      lab.step(1);
      const actions = session.getLastActions('first');
      const held = [...(actions?.held ?? [])] as string[];
      if (!held.includes('MoveForward')) {
        violations.push({ tick: session.getTickIndex(), held, moveIntent: actions?.moveIntent ?? null });
      }
      if (actions?.moveIntent != null) violations.push({ tick: session.getTickIndex(), reason: 'moveIntent set under Classic (default) control' });
      cameraYawsDeg.push(session.getLastCameraOutput()?.yawDeg ?? 0);
    }
    return { violations, cameraYawRangeDeg: Math.max(...cameraYawsDeg) - Math.min(...cameraYawsDeg) };
  });
  await page.keyboard.up('ArrowUp');

  expect(result.violations, `violations while holding ArrowUp under Classic: ${JSON.stringify(result.violations, null, 2)}`).toEqual([]);
  expect(result.cameraYawRangeDeg, 'the camera never moved at all — this run does not actually exercise independence').toBeGreaterThan(10);
  expect(errors).toEqual([]);
});

test('Settings offers Classic (default, Bey-relative) and Directional (experimental) control', async ({ page }) => {
  await page.goto('/ChaosBey/?mode=settings');
  const row = page.getByTestId('settings-control-scheme');
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row.getByRole('radio', { name: 'Classic' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('settings-control-note')).toContainText('Kart-like');
  await row.getByRole('radio', { name: 'Directional' }).click();
  await expect(row.getByRole('radio', { name: 'Directional' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('settings-control-note')).toContainText('Experimental');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('chaosbey.settings.player.v1') ?? '{}').controlScheme)).toBe('directional');
});
