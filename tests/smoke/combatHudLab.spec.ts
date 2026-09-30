import { expect, test } from '@playwright/test';

// Combat HUD Lab approval smoke: the lab must run the real MatchSession,
// swap only presentation A/B/C, survive high-speed/Clash/round-end harnesses,
// and rebuild the real floor collider for flat + bowls A/B/C.
test('Combat HUD Lab: live A/B/C comparison, scenarios and bowls', async ({ page }) => {
  test.setTimeout(90_000);
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));

  await page.goto('/ChaosBey/?mode=combat-hud-lab');
  await page.waitForFunction(() => window.__chaosBeyCombatHudLab?.getSession() !== null, undefined, { timeout: 15_000 });
  await expect(page.getByTestId('combat-hud-lab')).toBeVisible();

  // Single view swaps the HUD presentation without rebuilding gameplay.
  const a = page.getByTestId('combat-hud-surface-A');
  const b = page.getByTestId('combat-hud-surface-B');
  const c = page.getByTestId('combat-hud-surface-C');
  await expect(a).toBeVisible();
  await expect(b).toBeHidden();
  await expect(c).toBeHidden();
  await page.getByTestId('combat-hud-direction-B').click();
  await expect(b).toBeVisible();
  expect(await page.evaluate(() => window.__chaosBeyCombatHudLab!.getDirection())).toBe('B');

  // Compare shows all three over the exact same live fight.
  await page.getByTestId('combat-hud-view-compare').click();
  await expect(a).toBeVisible();
  await expect(b).toBeVisible();
  await expect(c).toBeVisible();
  expect(await page.evaluate(() => window.__chaosBeyCombatHudLab!.getViewMode())).toBe('compare');

  // High-speed harness uses real body velocity, not a fake HUD fixture.
  await page.evaluate(() => window.__chaosBeyCombatHudLab!.setScenario('high-speed'));
  await page.waitForFunction(() => window.__chaosBeyCombatHudLab?.getScenario() === 'high-speed' && window.__chaosBeyCombatHudLab?.getSession() !== null);
  const highSpeed = await page.evaluate(() => {
    const v = window.__chaosBeyCombatHudLab!.getSession()!.getBey('first').body.linvel();
    return Math.hypot(v.x, v.z);
  });
  expect(highSpeed).toBeGreaterThan(10);

  // The Clash scenario must enter the real Clash controller's Active state.
  await page.evaluate(() => window.__chaosBeyCombatHudLab!.setScenario('clash'));
  const clashState = await page.evaluate(() => {
    const lab = window.__chaosBeyCombatHudLab!;
    const session = lab.getSession()!;
    for (let i = 0; i < 300; i++) {
      if (session.clash.controller.getState() === 'Active') break;
      session.tick();
    }
    return session.clash.controller.getState();
  });
  expect(clashState).toBe('Active');

  // Critical resources are read from the real Bey systems.
  await page.evaluate(() => window.__chaosBeyCombatHudLab!.setScenario('low-stamina'));
  await expect.poll(() => page.evaluate(() => window.__chaosBeyCombatHudLab!.getSession()!.getBey('first').stamina.resource.fraction)).toBeLessThan(0.2);

  // Ring-out/round-end smoke: the harness launches a real body and the real
  // RoundState must eventually finish it.
  await page.evaluate(() => window.__chaosBeyCombatHudLab!.setScenario('round-end'));
  const roundOver = await page.evaluate(() => {
    const session = window.__chaosBeyCombatHudLab!.getSession()!;
    for (let i = 0; i < 240 && !session.roundState.isOver; i++) session.tick();
    return { isOver: session.roundState.isOver, result: String(session.roundState.result) };
  });
  expect(roundOver.isOver).toBe(true);
  expect(roundOver.result).toMatch(/RingOut|Ko|Draw/);

  // The Lab compares against the actual approved floor profiles, rebuilding
  // MatchSession each time so physics/camera read the same selected floor.
  for (const floor of ['flat', 'bowl-a', 'bowl-b', 'bowl-c'] as const) {
    await page.evaluate((id) => window.__chaosBeyCombatHudLab!.setArenaFloor(id), floor);
    await expect.poll(() => page.evaluate(() => window.__chaosBeyCombatHudLab!.getSession()!.matchConfig.arenaFloor)).toBe(floor);
  }

  expect(consoleErrors).toEqual([]);
});
