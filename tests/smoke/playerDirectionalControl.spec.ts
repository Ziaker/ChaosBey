import { expect, test, type Page } from '@playwright/test';

// M11 directional control, "Fix 7" (2026-10-01, see screenDirection.ts's
// header for the full history): ↑/↓/←/→ move the player's Bey relative to
// the CURRENT camera — ↑ always away from it, → always to its right, and
// so on, recomputed fresh every tick, no latching. Verified across several
// very different real camera orientations (the game's own dynamic camera,
// placed differently each run by moving the idle opponent to a different
// side of the player) by measuring the Bey's actual WORLD displacement and
// checking it against that run's own camera direction — the point being
// verified is that a held key reads the same way ON SCREEN in every one of
// them, which means its WORLD effect is expected to differ between them
// (that's the whole fix). The Debug Lab's "overview" camera is a fixed
// debug-only view that overrides rendering without being the real
// CameraDirector output, so it's not used here — it would measure a
// camera that was never actually driving the control.

type Direction = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';

const nextFrame = (page: Page): Promise<unknown> => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

interface DriveResult {
  /** The Bey's actual velocity direction once it's had time to turn and settle — not accumulated displacement, which a wall bounce could contaminate. */
  readonly velocity: { x: number; z: number };
  readonly cameraYawDeg: number;
}

async function holdAndMeasure(page: Page, key: Direction, opponentXZ: { x: number; z: number }): Promise<DriveResult> {
  await page.evaluate(
    async ({ opponentXZ }) => {
      const lab = window.__chaosBeyDebugLab!;
      await lab.restart('m11-directional-smoke');
      lab.setPaused(true);
      lab.step(40); // land and settle
      // The player's Bey at the centre; the idle opponent placed differently each run, which the real two-fighter camera frames differently each time.
      const session = lab.getSession()!;
      const first = session.getBey('first').body;
      const second = session.getBey('second').body;
      first.setTranslation({ x: 0, y: first.translation().y, z: 0 }, true);
      first.setLinvel({ x: 0, y: 0, z: 0 }, true);
      second.setTranslation({ x: opponentXZ.x, y: second.translation().y, z: opponentXZ.z }, true);
      second.setLinvel({ x: 0, y: 0, z: 0 }, true);
      lab.step(30); // give the camera real time to settle on this fight's own framing
    },
    { opponentXZ },
  );
  await nextFrame(page);
  await page.keyboard.down(key);
  // 1.25 s: long enough for a full turnaround (brake, pivot, go) at the Bey's turn rate — short enough that it never reaches the arena wall (a bounce there would contaminate the reading).
  await page.evaluate(() => window.__chaosBeyDebugLab!.step(75));
  const result = await page.evaluate(() => {
    const session = window.__chaosBeyDebugLab!.getSession()!;
    const v = session.getBey('first').body.linvel();
    return { velocity: { x: v.x, z: v.z }, cameraYawDeg: session.getLastCameraOutput()?.yawDeg ?? 0 };
  });
  await page.keyboard.up(key);
  return result;
}

/** "Away from the camera" on the ground, for a CameraDirector-convention yaw in degrees. */
function awayFromCamera(yawDeg: number): { x: number; z: number } {
  const yawRad = (yawDeg * Math.PI) / 180;
  return { x: -Math.sin(yawRad), z: -Math.cos(yawRad) };
}

function normalize(v: { x: number; z: number }): { x: number; z: number } {
  const len = Math.hypot(v.x, v.z);
  return len > 1e-6 ? { x: v.x / len, z: v.z / len } : { x: 0, z: 0 };
}

test('Directional (default, camera-relative): arrows move the Bey relative to the CURRENT camera, differently when the real camera is framed very differently', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/ChaosBey/?mode=debug-lab');
  await expect.poll(() => page.evaluate(() => window.__chaosBeyDebugLab?.getSession() != null), { timeout: 20_000 }).toBe(true);
  await page.evaluate(() => window.__chaosBeyDebugLab!.setController('second', { kind: 'idle' }));
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.evaluate(() => window.__chaosBeyDebugLab!.setCameraView('game')); // the real CameraDirector-driven view — never 'overview', a fixed debug-only camera that isn't what drives the control.

  const EXPECTED_SCREEN_DIR: Record<Direction, 'away' | 'toward' | 'left' | 'right'> = {
    ArrowUp: 'away',
    ArrowDown: 'toward',
    ArrowLeft: 'left',
    ArrowRight: 'right',
  };
  // Two very different opponent placements, so the real two-fighter camera frames the fight from two very different angles.
  const OPPONENT_POSITIONS = { near: { x: 7.5, z: 7.5 }, far: { x: -8, z: 3 } };

  const worldByPlacement: Record<string, Partial<Record<Direction, DriveResult>>> = {};
  for (const [placement, opponentXZ] of Object.entries(OPPONENT_POSITIONS)) {
    worldByPlacement[placement] = {};
    for (const key of Object.keys(EXPECTED_SCREEN_DIR) as Direction[]) {
      const result = await holdAndMeasure(page, key, opponentXZ);
      worldByPlacement[placement]![key] = result;
      const away = awayFromCamera(result.cameraYawDeg);
      const right = { x: -away.z, z: away.x }; // matches screenToWorld's own right = perpendicular(fromYaw(yaw))
      const expected = EXPECTED_SCREEN_DIR[key];
      const toward = { x: -away.x, z: -away.z };
      const left = { x: -right.x, z: -right.z };
      const expectedDir = expected === 'away' ? away : expected === 'toward' ? toward : expected === 'left' ? left : right;
      const dir = normalize(result.velocity);
      const dot = dir.x * expectedDir.x + dir.z * expectedDir.z;
      const label = `${placement} ${key}: velocity (${result.velocity.x.toFixed(3)}, ${result.velocity.z.toFixed(3)}), camera yaw ${result.cameraYawDeg.toFixed(1)}°, dot ${dot.toFixed(3)}`;
      expect(dot, label).toBeGreaterThan(0.9); // reads as the expected screen direction for THIS run's own real camera
    }
  }

  // The load-bearing check for "Fix 7": the SAME key produces a DIFFERENT
  // world velocity direction when the real camera is framing the fight
  // from a different angle (a different opponent placement) — because
  // it's resolved relative to the camera, not a fixed world axis. A fixed
  // world-relative scheme (the pre-"Fix 7" Directional) would fail this
  // by producing the SAME direction regardless of the camera.
  let anyDiffered = false;
  for (const key of Object.keys(EXPECTED_SCREEN_DIR) as Direction[]) {
    const a = worldByPlacement.near![key]!;
    const b = worldByPlacement.far![key]!;
    const da = normalize(a.velocity);
    const db = normalize(b.velocity);
    if (Math.abs(a.cameraYawDeg - b.cameraYawDeg) > 20 && Math.hypot(da.x - db.x, da.z - db.z) > 0.3) {
      anyDiffered = true;
    }
  }
  expect(anyDiffered, 'both opponent placements produced the same velocity direction for every key — camera-relative mapping is not actually being exercised').toBe(true);

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

  // Under Directional (default, "Fix 7"), a held arrow resolves to a
  // non-zero moveIntent on every tick it's held — never raw held actions
  // (those are stripped, see DirectionalController.ts's header) — so the
  // only legitimate reason for it to go to zero is one of the approved
  // input locks (inputLockReason.ts: Hitstop, an Active Clash, or a
  // decided round).
  async function driveAndTrace(key: Direction, jump: boolean, ticks: number) {
    await page.keyboard.down(key);
    if (jump) await page.keyboard.down('KeyX');
    const result = await page.evaluate(
      ({ ticksToRun }) => {
        const lab = window.__chaosBeyDebugLab!;
        const session = lab.getSession()!;
        const violations: unknown[] = [];
        for (let i = 0; i < ticksToRun; i++) {
          lab.step(1);
          const actions = session.getLastActions('first');
          const move = actions?.moveIntent;
          const moveLen = move ? Math.hypot(move.x, move.z) : 0;
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
          if (moveLen < 0.01 && lockReason === 'none') {
            violations.push({
              tick: session.getTickIndex(),
              held: [...(actions?.held ?? [])],
              moveIntent: move ?? null,
              velocity: bey.body.linvel(),
              grounded,
              cameraYawDeg: camera?.yawDeg ?? null,
              driftState: session.getLastResult()?.first.driftState,
            });
          }
        }
        return { violations, finalController: session.getController('first')?.constructor?.name };
      },
      { ticksToRun: ticks },
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

test('Directional (default): a held key always reads "away from the camera" on screen through a real AI fight with a real orbiting camera', async ({ page }) => {
  // Reproduces the owner's bug report directly and proves "Fix 7" fixes
  // it: holding ArrowUp the entire time through a real fight (so the
  // camera genuinely swings through a wide orbit), the resolved world
  // direction must keep pointing away from the camera's CURRENT position
  // on every single tick — not a fixed world vector (that's what read
  // "backwards" about half the time before this fix, verified with the
  // same dot-product measurement used to diagnose the original report).
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
      const move = actions?.moveIntent;
      const camera = session.getLastCameraOutput();
      const yawDeg = camera?.yawDeg ?? 0;
      cameraYawsDeg.push(yawDeg);
      const len = move ? Math.hypot(move.x, move.z) : 0;
      if (!move || len < 0.01) {
        violations.push({ tick: session.getTickIndex(), reason: 'moveIntent missing or zero while ArrowUp held', moveIntent: move ?? null });
        continue;
      }
      const yawRad = (yawDeg * Math.PI) / 180;
      const away = { x: -Math.sin(yawRad), z: -Math.cos(yawRad) };
      const dot = (move.x * away.x + move.z * away.z) / len;
      if (dot < 0.95) {
        violations.push({ tick: session.getTickIndex(), reason: 'did not read as away-from-camera', dot, moveIntent: move, cameraYawDeg: yawDeg });
      }
    }
    return { violations, cameraYawRangeDeg: Math.max(...cameraYawsDeg) - Math.min(...cameraYawsDeg) };
  });
  await page.keyboard.up('ArrowUp');

  expect(result.violations, `violations while holding ArrowUp under Directional: ${JSON.stringify(result.violations, null, 2)}`).toEqual([]);
  expect(result.cameraYawRangeDeg, 'the camera never moved at all — this run does not actually exercise the fix').toBeGreaterThan(10);
  expect(errors).toEqual([]);
});

test('Settings offers Directional (default, camera-relative) and Classic control', async ({ page }) => {
  await page.goto('/ChaosBey/?mode=settings');
  const row = page.getByTestId('settings-control-scheme');
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row.getByRole('radio', { name: 'Directional' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('settings-control-note')).toContainText('Default');
  await row.getByRole('radio', { name: 'Classic' }).click();
  await expect(row.getByRole('radio', { name: 'Classic' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('settings-control-note')).toContainText('Kart-like');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('chaosbey.settings.player.v1') ?? '{}').controlScheme)).toBe('classic');
});
