import { expect, test, type Page } from '@playwright/test';
import { baselineUrl } from './presentationBaseline';
import { GAME_DEFAULTS } from './gameDefaults';

// Control (owner, 2026-10-04): Screen (reads camera) is the game's one control scheme — ↑ goes up the screen, away from
// the camera (camera yaw + 180°). A new direction reads the camera at once; a held direction follows a camera that really
// turns, at most ~90°/s (createLatchedReference). These browser tests prove the mapping from WORLD velocity against the
// camera yaw the game camera really had, rather than requiring an artificial orbit. (Until 0.29 the default was the
// camera-free "Toward opponent" scheme; its specs were rewritten for Screen.) The Debug Lab's "overview" camera is a
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
  // Up to 1.25 s: long enough for a full turnaround (brake, pivot, go) at the Bey's turn rate. With the owner's faster
  // Beys (top speed ×2.8 and momentum) it can reach the wall inside that time, and a bounce would contaminate the
  // reading, so the velocity is the last one measured while the Bey was still well inside the arena and at speed.
  const result = await page.evaluate(() => {
    const lab = window.__chaosBeyDebugLab!;
    const body = lab.getSession()!.getBey('first').body;
    let velocity: { x: number; z: number } | null = null;
    for (let i = 0; i < 75; i++) {
      lab.step(1);
      const p = body.translation();
      const v = body.linvel();
      if (Math.hypot(p.x, p.z) < 24 && Math.hypot(v.x, v.z) > 6) velocity = { x: v.x, z: v.z };
    }
    return { velocity };
  });
  await page.keyboard.up(key);
  if (result.velocity === null) throw new Error(`${key}: the Bey never got up to speed inside the arena`);
  return { velocity: result.velocity, cameraYawDeg: cameraYawAtPressDeg };
}

function normalize(v: { x: number; z: number }): { x: number; z: number } {
  const len = Math.hypot(v.x, v.z);
  return len > 1e-6 ? { x: v.x / len, z: v.z / len } : { x: 0, z: 0 };
}

test('Screen control (the only scheme): arrows move the Bey up / down / left / right the screen, relative to the real game camera', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(baselineUrl('/ChaosBey/?mode=debug-lab'));
  await expect.poll(() => page.evaluate(() => window.__chaosBeyDebugLab?.getSession() != null), { timeout: 20_000 }).toBe(true);
  await page.evaluate(() => window.__chaosBeyDebugLab!.setController('second', { kind: 'idle' }));
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.evaluate(() => window.__chaosBeyDebugLab!.setCameraView('game')); // the real game camera, not the fixed debug overview

  // The player's Bey is at the origin. "Up" is away from the camera: the camera yaw at the press + 180° (fromYaw: x = sin, z = cos);
  // "right" is up turned clockwise seen from above: right = (-up.z, up.x). The opponent only sets where the camera ends up.
  // The idle opponent must stay off the four screen axes (a Bey that runs into it is knocked sideways: the old (-8, 3) lay
  // on the ArrowRight line and was hit after ~1 s now that the Beys are faster). The game camera keeps one world azimuth
  // (yaw ~194° → up bearing ~14°, right ~-76°), so the diagonals (59°, -31°) are clear of every axis.
  const OPPONENT_POSITIONS = { near: { x: 7.5, z: 7.5 }, far: { x: -6.2, z: 10.3 } };
  const upOf = (cameraYawDeg: number): { x: number; z: number } => {
    const yaw = ((cameraYawDeg + 180) * Math.PI) / 180;
    return { x: Math.sin(yaw), z: Math.cos(yaw) };
  };
  const expectedFor = (key: Direction, cameraYawDeg: number): { x: number; z: number } => {
    const up = upOf(cameraYawDeg);
    const right = { x: -up.z, z: up.x };
    return key === 'ArrowUp' ? up : key === 'ArrowDown' ? { x: -up.x, z: -up.z } : key === 'ArrowRight' ? right : { x: -right.x, z: -right.z };
  };

  for (const [placement, opponentXZ] of Object.entries(OPPONENT_POSITIONS)) {
    for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'] as Direction[]) {
      const result = await holdAndMeasure(page, key, opponentXZ);
      const expected = expectedFor(key, result.cameraYawDeg);
      const dir = normalize(result.velocity);
      const dot = dir.x * expected.x + dir.z * expected.z;
      const label = `${placement} ${key}: velocity (${result.velocity.x.toFixed(3)}, ${result.velocity.z.toFixed(3)}), camera yaw ${result.cameraYawDeg.toFixed(1)}°, dot ${dot.toFixed(3)}`;
      // ↑/↓ hold a straight screen direction; ←/→ are sideways on the screen (a mirrored ←/→ would read ≈ −0.8).
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
  await page.goto(baselineUrl('/ChaosBey/?mode=debug-lab'));
  await expect.poll(() => page.evaluate(() => window.__chaosBeyDebugLab?.getSession() != null), { timeout: 20_000 }).toBe(true);
  await page.evaluate(() => window.__chaosBeyDebugLab!.setController('second', { kind: 'ai', personality: 'archetype' }));
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.evaluate(() => window.__chaosBeyDebugLab!.setPaused(true));

  // Under the Screen scheme (the only one), a held arrow resolves to a
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

test('Screen control: a held ↑ keeps pointing up the screen (away from the camera) through a real AI fight with the real inertial camera', async ({ page }) => {
  // Screen (reads camera) is the one control scheme (owner, 2026-10-04). Holding ArrowUp the entire time through a real
  // fight, the resolved world direction must be "away from the camera" (camera yaw + 180°): it follows a camera that
  // really turns at most ~90°/s (createLatchedReference), so a camera that swings round after a wall hit may lead it for
  // a moment, but it never points at the opponent or anywhere else by itself — and it is never missing or zero.
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(baselineUrl('/ChaosBey/?mode=debug-lab'));
  await expect.poll(() => page.evaluate(() => window.__chaosBeyDebugLab?.getSession() != null), { timeout: 20_000 }).toBe(true);
  await page.evaluate(() => window.__chaosBeyDebugLab!.setController('second', { kind: 'ai', personality: 'archetype' }));
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.evaluate(() => window.__chaosBeyDebugLab!.setPaused(true));
  // The gesture reads the camera when the key goes down: let the camera exist and settle first (30 ticks, then a
  // rendered frame) so the press and the comparison see the same camera state. (On a slow software-rendered CI runner
  // the key-down once came before the camera had settled.)
  await page.evaluate(() => window.__chaosBeyDebugLab!.step(30));
  await nextFrame(page);

  await page.keyboard.down('ArrowUp');
  const result = await page.evaluate(() => {
    const lab = window.__chaosBeyDebugLab!;
    const session = lab.getSession()!;
    const violations: unknown[] = [];
    const cameraYawsDeg: number[] = [];
    let checked = 0;
    let aligned = 0;
    let worstDot = 1;
    for (let i = 0; i < 300; i++) {
      lab.step(1);
      const move = session.getLastActions('first')?.moveIntent;
      const yawDeg = session.getLastCameraOutput()?.yawDeg ?? 0;
      cameraYawsDeg.push(yawDeg);
      const len = move ? Math.hypot(move.x, move.z) : 0;
      if (!move || len < 0.01) {
        const camera = session.getLastCameraOutput();
        // The approved input locks (Hitstop, an Active Clash, a decided round) are the only legitimate zeros.
        const locked = (camera?.isHitstopActive ?? false) || session.clash.controller.getState() === 'Active' || session.roundState.result !== 'Ongoing';
        if (!locked) violations.push({ tick: session.getTickIndex(), reason: 'moveIntent missing or zero while ArrowUp held', moveIntent: move ?? null });
        continue;
      }
      const yaw = ((yawDeg + 180) * Math.PI) / 180;
      const dot = (move.x * Math.sin(yaw) + move.z * Math.cos(yaw)) / len;
      checked++;
      if (dot > 0.9) aligned++;
      worstDot = Math.min(worstDot, dot);
    }
    return { violations, checked, aligned, worstDot, cameraYawFinite: cameraYawsDeg.every(Number.isFinite) };
  });
  await page.keyboard.up('ArrowUp');

  expect(result.violations, `violations while holding ArrowUp: ${JSON.stringify(result.violations.slice(0, 5), null, 2)}`).toEqual([]);
  expect(result.checked, 'the direction was never checked').toBeGreaterThan(150);
  expect(result.aligned / result.checked, `up the screen on ${result.aligned} of ${result.checked} ticks (worst dot ${result.worstDot.toFixed(2)})`).toBeGreaterThan(0.9);
  expect(result.cameraYawFinite, 'camera yaw became non-finite').toBe(true);
  expect(errors).toEqual([]);
});

test('Settings has no control-scheme selector: Screen (reads camera) is the one scheme, described in a note and the controls table', async ({ page }) => {
  await page.goto('/ChaosBey/?mode=settings');
  await expect(page.getByTestId('settings')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('settings-control-scheme')).toHaveCount(0);
  await expect(page.getByTestId('settings-control-note')).toContainText('Screen-relative');
  await expect(page.getByTestId('settings-controls')).toContainText('Move (up the screen)');
  // Whatever else is changed and saved, the saved scheme is Screen.
  await page.getByTestId(`settings-quality-${GAME_DEFAULTS.quality === 'High' ? 'Medium' : 'High'}`).click();
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}').controlScheme, GAME_DEFAULTS.settingsStorageKey)).toBe('screen');
});
