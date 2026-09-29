import { expect, test } from '@playwright/test';

// M11 lane 2: the approved camera presets in the real app.
// - Settings offers Arena Fighter / Cinematic Hybrid / Hyper Dynamic, B by
//   default, persisted.
// - A match runs with each preset without console errors.
// - In the Debug Lab's Clash preset, the Clash forces camera B (no orbit)
//   for a player on A, then hands the camera back to A.

test('Settings: camera preset A/B/C, B by default, persisted', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/ChaosBey/?mode=settings');
  const row = page.getByTestId('settings-camera');
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('settings-camera-B')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('settings-camera-B')).toHaveText('Cinematic Hybrid');
  await page.getByTestId('settings-camera-C').click();
  await expect(page.getByTestId('settings-camera-note')).toContainText('Maximum spectacle');
  await page.reload();
  await expect(page.getByTestId('settings-camera-C')).toHaveAttribute('aria-checked', 'true');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('chaosbey.settings.player.v1') ?? '{}').cameraPreset)).toBe('C');
  expect(errors).toEqual([]);
});

test('a match runs on each camera preset, the preset reaching the game camera', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  for (const preset of ['A', 'B', 'C'] as const) {
    await page.goto('/ChaosBey/');
    await page.evaluate((p) => localStorage.setItem('chaosbey.settings.player.v1', JSON.stringify({ cameraPreset: p })), preset);
    await page.goto('/ChaosBey/?mode=play');
    await page.getByTestId('character-select-confirm').click({ timeout: 15_000 });
    await page.getByTestId('pregame-start').click();
    await expect.poll(() => page.evaluate(() => window.__chaosBeyPlay?.getScreen()), { timeout: 20_000 }).toBe('match');
    await expect.poll(() => page.evaluate(() => window.__chaosBeyPlay!.getSession()!.getTickIndex()), { timeout: 15_000 }).toBeGreaterThan(90);
    const camera = await page.evaluate(() => window.__chaosBeyPlay!.getSession()!.getLastCameraOutput());
    expect(camera!.preset).toBe(preset);
    expect(camera!.fovDeg).toBeGreaterThan(30);
    expect(camera!.fovDeg).toBeLessThanOrEqual(120);
  }
  expect(errors).toEqual([]);
});

test('Debug Lab Clash: a player on A sees camera B without orbit during the Clash, then A again', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/ChaosBey/?mode=debug-lab');
  await expect.poll(() => page.evaluate(() => window.__chaosBeyDebugLab?.getSession() != null), { timeout: 20_000 }).toBe(true);
  await page.evaluate(async () => {
    const lab = window.__chaosBeyDebugLab!;
    lab.setCameraPreset('A');
    await lab.loadPreset('clash');
    lab.setPaused(true);
  });
  // Step until the Clash camera fully owns the screen, recording the yaw around the Clash point.
  const run = await page.evaluate(() => {
    const lab = window.__chaosBeyDebugLab!;
    const samples: { blend: number; mode: string; preset: string; yaw: number; clash: string }[] = [];
    for (let i = 0; i < 900; i++) {
      lab.step(1);
      const session = lab.getSession()!;
      const cam = session.getLastCameraOutput()!;
      const p1 = session.getBey('first').body.translation();
      const p2 = session.getBey('second').body.translation();
      const mid = { x: (p1.x + p2.x) / 2, z: (p1.z + p2.z) / 2 };
      samples.push({ blend: cam.clashBlend, mode: cam.mode, preset: cam.preset, yaw: Math.atan2(cam.cameraPositionM.x - mid.x, cam.cameraPositionM.z - mid.z), clash: session.clash.controller.getState() });
      if (samples.length > 200 && samples.at(-1)!.blend === 0 && samples.some((s) => s.blend > 0.99)) break;
    }
    return samples;
  });
  const full = run.filter((s) => s.blend > 0.99);
  expect(full.length).toBeGreaterThan(60);
  expect(full.every((s) => s.mode === 'Clash' && s.preset === 'A')).toBe(true);
  // No orbit: the camera's angle around the Clash point barely moves while B holds the screen.
  let turn = 0;
  for (let i = 1; i < full.length; i++) turn += Math.abs(Math.atan2(Math.sin(full[i]!.yaw - full[i - 1]!.yaw), Math.cos(full[i]!.yaw - full[i - 1]!.yaw)));
  expect(turn).toBeLessThan(0.15);
  // Then the player's preset is back.
  const last = run.at(-1)!;
  expect(last.blend).toBe(0);
  expect(last.preset).toBe('A');
  expect(last.mode).not.toBe('Clash');
});
