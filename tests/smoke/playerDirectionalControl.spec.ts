import { expect, test, type Page } from '@playwright/test';

// M11 control schemes (owner requirement, 2026-10-01: "a câmera nunca move
// o Bey"). Camera is downstream presentation. The default scheme ("Toward
// opponent") resolves the arrows from where the two Beys are — ↑ toward the
// opponent, ↓ away, ←/→ around them — so what a key does is identical
// wherever the real camera happens to be. The in-game camera is now
// intentionally spatially stable, so these browser tests prove the control
// mapping from WORLD velocity/bearing rather than requiring artificial orbit.
// The Debug Lab's "overview" camera is a fixed debug-only view, so it is not
// used here.

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
      // The player's Bey at the centre; move the idle opponent to a different bearing each run.
      // The real inertial camera is free to keep the same world azimuth if both fighters remain safely framed.
      const session = lab.getSession()!;
      const first = session.getBey('first').body;
      const second = session.getBey('second').body;
      first.setTranslation({ x: 0, y: first.translation().y, z: 0 }, true);
      first.setLinvel({ x: 0, y: 0, z: 0 }, true);
      second.setTranslation({ x: opponentXZ.x, y: second.translation().y, z: opponentXZ.z }, true);
      second.setLinvel({ x: 0, y: 0, z: 0 }, true);
      lab.step(30); // give the camera real time to compose the placement
    },
    { opponentXZ },
  );
  await nextFrame(page);
  // Diagnostic only: the camera may legitimately keep the same yaw under the inertial design.
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

test('Default scheme: arrows move the Bey toward / away from / around the opponent with the real inertial camera attached', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/ChaosBey/?mode=debug-lab');
  await expect.poll(() => page.evaluate(() => window.__chaosBeyDebugLab?.getSession() != null), { timeout: 20_000 }).toBe(true);
  await page.evaluate(() => window.__chaosBeyDebugLab!.setController('second', { kind: 'idle' }));
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.evaluate(() => window.__chaosBeyDebugLab!.setCameraView('game')); // the real game camera, not the fixed debug overview

  // The player's Bey is at the origin; "up" is the bearing to the opponent, "right" is up turned clockwise seen from above: right = (-up.z, up.x).
  const OPPONENT_POSITIONS = { near: { x: 7.5, z: 7.5 }, far: { x: -8, z: 3 } };
  const expectedFor = (key: Direction, opponent: { x: number; z: number }): { x: number; z: number } => {
    const up = normalize(opponent);
    const right = { x: -up.z, z: up.x };
    return key === 'ArrowUp' ? up : key === 'ArrowDown' ? { x: -up.x, z: -up.z } : key === 'ArrowRight' ? right : { x: -right.x, z: -right.z };
  };

  for (const [placement, opponentXZ] of Object.entries(OPPONENT_POSITIONS)) {
    for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'] as Direction[]) {
      const result = await holdAndMeasure(page, key, opponentXZ);
      const expected = expectedFor(key, opponentXZ);
      const dir = normalize(result.velocity);
      const dot = dir.x * expected.x + dir.z * expected.z;
      const label = `${placement} ${key}: velocity (${result.velocity.x.toFixed(3)}, ${result.velocity.z.toFixed(3)}), camera yaw ${result.cameraYawDeg.toFixed(1)}°, dot ${dot.toFixed(3)}`;
      // ↑/↓ hold a straight bearing; ←/→ circle the opponent, so the velocity direction rotates with the bearing while it builds up (a mirrored ←/→ would read ≈ −0.8).
      expect(dot, label).toBeGreaterThan(key === 'ArrowUp' || key === 'ArrowDown' ? 0.85 : 0.6);
      expect(Number.isFinite(result.cameraYawDeg), `${placement} ${key}: game camera yaw must stay finite`).toBe(true);
    }
  }

  // The inspector shows the desired input next to the physical heading.
  const desired = await page.evaluate(() => window.__chaosBeyDebugLab!.getSession()!.getLastActions('first')?.moveIntent ?? null);
  expect(desired).not.toBeNull();
  expect(errors).toEqual([]);
});

test('real keyboard, real AI fight: holding a direction through jump/drift/knockback never silently zeroes input', async ({ page }) => {
  // Owner playtest requirement: never accept a tick where a held arrow
  // produces no applied movement without an observable reason. Runs a real
  // fight (a real AI opponent, so camera composition and real knockbacks are
  // active) with real Playwright keyboard events, and traces every tick —
  // any violation is reported with the full context asked for (tick, state,
  // input, desired vector, controller, lock reason, velocity, grounded,
  // camera) rather than masked by a threshold.
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/ChaosBey/?mode=debug-lab');
  await expect.poll(() => page.evaluate(() => window.__chaosBeyDebugLab?.getSession() != null), { timeout: 20_000 }).toBe(true);
  await page.evaluate(() => window.__chaosBeyDebugLab!.setController('second', { kind: 'ai', personality: 'archetype' }));
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.evaluate(() => window.__chaosBeyDebugLab!.setPaused(true));

  // Under a directional scheme (default), a held arrow resolves to a
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

test('Default scheme: the camera never moves the Bey — a held ↑ keeps pointing at the opponent through a real AI fight with the real inertial camera', async ({ page }) => {
  // Owner: "a câmera move o bey sozinho — só o jogador move o jogador".
  // Holding ArrowUp the entire time through a real fight, the resolved world
  // direction must be the bearing to the opponent — a function of the Beys'
  // positions only. The camera may remain at one azimuth for the whole run;
  // spatial stability is now desired behavior, not a reason to fail the test.
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
    let checked = 0;
    for (let i = 0; i < 300; i++) {
      const a = session.getBey('first').body.translation(); // before this tick's input is sampled
      const b = session.getBey('second').body.translation();
      lab.step(1);
      const move = session.getLastActions('first')?.moveIntent;
      cameraYawsDeg.push(session.getLastCameraOutput()?.yawDeg ?? 0);
      const len = move ? Math.hypot(move.x, move.z) : 0;
      if (!move || len < 0.01) {
        violations.push({ tick: session.getTickIndex(), reason: 'moveIntent missing or zero while ArrowUp held', moveIntent: move ?? null });
        continue;
      }
      const d = Math.hypot(b.x - a.x, b.z - a.z);
      if (d < 0.5) continue;
      checked++;
      const dot = (move.x * (b.x - a.x) + move.z * (b.z - a.z)) / (len * d);
      if (dot < 0.99) violations.push({ tick: session.getTickIndex(), reason: 'not pointing at the opponent', dot, moveIntent: move });
    }
    return {
      violations,
      checked,
      cameraYawFinite: cameraYawsDeg.every(Number.isFinite),
      cameraYawRangeDeg: Math.max(...cameraYawsDeg) - Math.min(...cameraYawsDeg),
    };
  });
  await page.keyboard.up('ArrowUp');

  expect(result.violations, `violations while holding ArrowUp: ${JSON.stringify(result.violations.slice(0, 5), null, 2)}`).toEqual([]);
  expect(result.checked, 'the bearing was never checked').toBeGreaterThan(150);
  expect(result.cameraYawFinite, `camera yaw became non-finite; observed range ${result.cameraYawRangeDeg}`).toBe(true);
  expect(errors).toEqual([]);
});

test('Settings offers all four control schemes; the default is the camera-free "Toward opponent"', async ({ page }) => {
  await page.goto('/ChaosBey/?mode=settings');
  const row = page.getByTestId('settings-control-scheme');
  await expect(row).toBeVisible({ timeout: 15_000 });
  const note = page.getByTestId('settings-control-note');
  await expect(row.getByRole('radio', { name: 'Toward opponent' })).toHaveAttribute('aria-checked', 'true');
  await expect(note).toContainText('Default');
  await expect(note).toContainText('camera never steers');
  await row.getByRole('radio', { name: 'Classic' }).click();
  await expect(row.getByRole('radio', { name: 'Classic' })).toHaveAttribute('aria-checked', 'true');
  await expect(note).toContainText('Kart-like');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('chaosbey.settings.player.v1') ?? '{}').controlScheme)).toBe('classic');
  await row.getByRole('radio', { name: 'Arena (fixed)' }).click();
  await expect(note).toContainText('Fixed arena directions');
  await row.getByRole('radio', { name: 'Screen (reads camera)' }).click();
  await expect(note).toContainText('only option that reads the camera');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('chaosbey.settings.player.v1') ?? '{}').controlScheme)).toBe('screen');
});
