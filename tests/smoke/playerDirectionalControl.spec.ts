import { expect, test, type Page } from '@playwright/test';

// M11 directional control (owner requirement, 2026-10-01: "a câmera nunca
// move o Bey"). Camera is downstream presentation: it may observe gameplay
// and may never influence it. The arrows are resolved in a gameplay-owned
// control reference (the fixed arena frame today: ↑ = world +Z, → = world
// +X), so what a key does to the Bey is identical wherever the real,
// dynamic camera happens to be. Verified in a real browser by placing the
// idle opponent on very different sides of the player (the real two-fighter
// camera then frames the fight from very different angles) and measuring
// the Bey's actual WORLD velocity: it must be the same for every placement
// while the camera yaw differs. The Debug Lab's "overview" camera is a
// fixed debug-only view, so it is not used here.

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
  // Recorded only to prove the two placements really framed the camera differently; it plays no part in what the key does.
  const cameraYawAtPressDeg = await page.evaluate(() => window.__chaosBeyDebugLab!.getSession()!.getLastCameraOutput()?.yawDeg ?? 0);
  await page.keyboard.down(key);
  // 1.25 s: long enough for a full turnaround (brake, pivot, go) at the Bey's turn rate — short enough that it never reaches the arena wall (a bounce there would contaminate the reading).
  await page.evaluate(() => window.__chaosBeyDebugLab!.step(75));
  const result = await page.evaluate(() => {
    const session = window.__chaosBeyDebugLab!.getSession()!;
    const v = session.getBey('first').body.linvel();
    return { velocity: { x: v.x, z: v.z } };
  });
  await page.keyboard.up(key);
  return { ...result, cameraYawDeg: cameraYawAtPressDeg };
}

function normalize(v: { x: number; z: number }): { x: number; z: number } {
  const len = Math.hypot(v.x, v.z);
  return len > 1e-6 ? { x: v.x / len, z: v.z / len } : { x: 0, z: 0 };
}

test('Directional (default): arrows move the Bey along fixed arena directions, identically whichever way the real camera is framed', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/ChaosBey/?mode=debug-lab');
  await expect.poll(() => page.evaluate(() => window.__chaosBeyDebugLab?.getSession() != null), { timeout: 20_000 }).toBe(true);
  await page.evaluate(() => window.__chaosBeyDebugLab!.setController('second', { kind: 'idle' }));
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.evaluate(() => window.__chaosBeyDebugLab!.setCameraView('game')); // the real CameraDirector-driven view, so the camera really does move around

  // The fixed arena frame (input/directional/ControlReference.ts): ↑ = +Z, ↓ = -Z, → = +X, ← = -X.
  const EXPECTED_WORLD_DIR: Record<Direction, { x: number; z: number }> = {
    ArrowUp: { x: 0, z: 1 },
    ArrowDown: { x: 0, z: -1 },
    ArrowLeft: { x: -1, z: 0 },
    ArrowRight: { x: 1, z: 0 },
  };
  // Two very different opponent placements, so the real two-fighter camera frames the fight from two very different angles.
  const OPPONENT_POSITIONS = { near: { x: 7.5, z: 7.5 }, far: { x: -8, z: 3 } };

  const worldByPlacement: Record<string, Partial<Record<Direction, DriveResult>>> = {};
  for (const [placement, opponentXZ] of Object.entries(OPPONENT_POSITIONS)) {
    worldByPlacement[placement] = {};
    for (const key of Object.keys(EXPECTED_WORLD_DIR) as Direction[]) {
      const result = await holdAndMeasure(page, key, opponentXZ);
      worldByPlacement[placement]![key] = result;
      const expected = EXPECTED_WORLD_DIR[key];
      const dir = normalize(result.velocity);
      const dot = dir.x * expected.x + dir.z * expected.z;
      const label = `${placement} ${key}: velocity (${result.velocity.x.toFixed(3)}, ${result.velocity.z.toFixed(3)}), camera yaw ${result.cameraYawDeg.toFixed(1)}°, dot ${dot.toFixed(3)}`;
      expect(dot, label).toBeGreaterThan(0.9); // the fixed arena direction, whatever the camera is doing
    }
  }

  // The load-bearing check: the camera really was framed very differently
  // between the two placements, yet each key sent the Bey the same way.
  let cameraDiffered = false;
  for (const key of Object.keys(EXPECTED_WORLD_DIR) as Direction[]) {
    const a = worldByPlacement.near![key]!;
    const b = worldByPlacement.far![key]!;
    if (Math.abs(a.cameraYawDeg - b.cameraYawDeg) > 20) cameraDiffered = true;
    const da = normalize(a.velocity);
    const db = normalize(b.velocity);
    expect(Math.hypot(da.x - db.x, da.z - db.z), `${key}: the Bey went a different way when only the camera framing changed`).toBeLessThan(0.45);
  }
  expect(cameraDiffered, 'the two placements produced the same camera yaw — this run does not exercise camera independence').toBe(true);

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

  // Under Directional (default), a held arrow resolves to a
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

test('Directional (default): the camera never moves the Bey — a held key keeps one world direction through a real AI fight with a real orbiting camera', async ({ page }) => {
  // Owner: "a câmera move o bey sozinho — só o jogador move o jogador".
  // Holding ArrowUp the entire time through a real fight (so the camera
  // genuinely swings through a wide orbit), the resolved world direction
  // must be the control reference's ↑ (+Z) on every tick and NEVER change
  // while the key stays held, however far the camera orbits.
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
      if (Math.abs(move.x - 0) > 1e-9 || Math.abs(move.z - 1) > 1e-9) {
        violations.push({ tick: session.getTickIndex(), reason: 'the camera moved the Bey: world intent is not the fixed arena ↑ (+Z) while the key was held', moveIntent: move, cameraYawDeg: yawDeg });
      }
    }
    return { violations, cameraYawRangeDeg: Math.max(...cameraYawsDeg) - Math.min(...cameraYawsDeg) };
  });
  await page.keyboard.up('ArrowUp');

  expect(result.violations, `violations while holding ArrowUp under Directional: ${JSON.stringify(result.violations, null, 2)}`).toEqual([]);
  expect(result.cameraYawRangeDeg, 'the camera never moved at all — this run does not actually exercise the fix').toBeGreaterThan(10);
  expect(errors).toEqual([]);
});

test('Settings offers Directional (default, fixed arena directions) and Classic control', async ({ page }) => {
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
