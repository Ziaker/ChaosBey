import { expect, test, type Page } from '@playwright/test';

// Debug Lab smoke (GDD sections 1.2, 69, 70, 144): the production build
// opens the lab at ?mode=debug-lab, its controls drive the real match, the
// inspector shows raw state, and nothing logs a console error.

async function readTick(page: Page): Promise<number> {
  return Number(await page.getByTestId('debug-lab-status').getAttribute('data-tick'));
}

async function firstPosition(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const session = window.__chaosBeyDebugLab?.getSession();
    if (!session) throw new Error('no Debug Lab session');
    const t = session.getBey('first').body.translation();
    const s = session.getBey('second').body.translation();
    return [session.getTickIndex(), t.x, t.y, t.z, s.x, s.y, s.z];
  });
}

test('Debug Lab: pause, step, restart, seeds, speed and controller switching on the real match', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));

  await page.goto('/ChaosBey/?mode=debug-lab');
  const status = page.getByTestId('debug-lab-status');
  await expect(status).toContainText('RUNNING', { timeout: 15_000 });
  await expect.poll(() => readTick(page), { timeout: 10_000 }).toBeGreaterThan(30);

  // Pause freezes the tick counter.
  await page.getByTestId('debug-lab-pause').click();
  await expect(status).toContainText('PAUSED');
  const pausedAt = await readTick(page);
  await page.waitForTimeout(500);
  expect(await readTick(page)).toBe(pausedAt);

  // Single step and multi-step advance exactly that many fixed ticks.
  await page.getByTestId('debug-lab-step').click();
  expect(await readTick(page)).toBe(pausedAt + 1);
  await page.getByTestId('debug-lab-step-many').click();
  expect(await readTick(page)).toBe(pausedAt + 11);

  // Inspector shows the GDD 69 categories.
  const inspector = page.getByTestId('debug-lab-inspector');
  for (const section of ['match', 'first-transform', 'second-ai', 'clash', 'camera', 'performance', 'telemetry']) {
    await expect(inspector.locator(`[data-section="${section}"]`)).toHaveCount(1);
  }
  await expect(inspector.locator('[data-section="match"]')).toContainText('Seed');

  // Restart same seed: the same AI-vs-AI fight replays tick for tick.
  await page.getByTestId('debug-lab-controller-first').selectOption('ai:archetype');
  const seed = await page.getByTestId('debug-lab-seed').inputValue();
  expect(seed.length).toBeGreaterThan(0);
  await page.evaluate(async () => {
    await window.__chaosBeyDebugLab!.restart(null);
    window.__chaosBeyDebugLab!.step(240);
  });
  const runA = await firstPosition(page);
  await page.getByTestId('debug-lab-restart').click();
  await expect.poll(() => readTick(page)).toBe(0);
  expect(await page.getByTestId('debug-lab-seed').inputValue()).toBe(seed);
  await page.evaluate(() => window.__chaosBeyDebugLab!.step(240));
  const runB = await firstPosition(page);
  expect(runB).toEqual(runA);

  // A typed seed is used verbatim.
  await page.getByTestId('debug-lab-seed').fill('lab-typed-seed');
  await page.getByTestId('debug-lab-restart-typed').click();
  await expect(inspector.locator('[data-section="match"]')).toContainText('lab-typed-seed');

  // New seed changes the seed.
  await page.getByTestId('debug-lab-new-seed').click();
  await expect.poll(() => page.getByTestId('debug-lab-seed').inputValue()).not.toBe('lab-typed-seed');

  // Controller switching: second side to Idle shows no AI state.
  await page.getByTestId('debug-lab-controller-second').selectOption('idle');
  await page.getByTestId('debug-lab-step').click();
  await expect(inspector.locator('[data-section="second-ai"] summary')).toHaveCount(1);
  await inspector.locator('[data-section="second-ai"] summary').click();
  await expect(inspector.locator('[data-section="second-ai"]')).toContainText('Idle — no AI state');

  // Speed-up: 8 fixed ticks per step runs far faster than real time.
  await page.getByTestId('debug-lab-speed').selectOption('8');
  await page.getByTestId('debug-lab-pause').click();
  await expect(status).toContainText('RUNNING');
  const before = await readTick(page);
  await page.waitForTimeout(1000);
  expect((await readTick(page)) - before).toBeGreaterThan(90);

  expect(consoleErrors).toEqual([]);
});
