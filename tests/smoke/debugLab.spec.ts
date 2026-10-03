import { expect, test, type Page } from '@playwright/test';
import { baselineUrl } from './presentationBaseline';

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
  // One long walk through the Lab (~21 s locally, ~40% more on CI): the 30 s
  // default was already tight before the Motion Lab integration (19.3 s
  // locally) and its extra per-tick work pushed CI past it.
  test.setTimeout(60_000);
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));

  await page.goto(baselineUrl('/ChaosBey/?mode=debug-lab'));
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

  // Visualization layers (GDD 70/71) and render-only presentation toggles.
  for (const layer of ['colliders', 'hitboxes', 'ringOut', 'velocity', 'angular', 'forces', 'contacts', 'lockOn', 'targetPath']) {
    await page.getByTestId(`debug-lab-layer-${layer}`).check();
  }
  await page.getByTestId('debug-lab-camera-view').selectOption('overview');
  await page.getByTestId('debug-lab-camera-effects').uncheck();
  for (const vfx of ['impactBursts', 'trails', 'speedLines']) await page.getByTestId(`debug-lab-vfx-${vfx}`).uncheck();
  await page.waitForTimeout(1500);
  const visibleColliders = await page.evaluate(() => window.__chaosBeyDebugLab!.getLayers()!.countVisibleObjects('colliders'));
  expect(visibleColliders).toBeGreaterThan(30);
  // Layers survive a restart.
  await page.getByTestId('debug-lab-restart').click();
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__chaosBeyDebugLab!.getLayers()!.getEnabled().length)).toBe(9);

  // Mutations (GDD 70): logged, visible, and the report says the run is mutated.
  // Start from a fresh round: the 8x run above may already have ended it,
  // and a finished round is frozen (tickMatch stops advancing).
  await page.getByTestId('debug-lab-pause').click();
  await expect(status).toContainText('PAUSED');
  await page.getByTestId('debug-lab-restart').click();
  await expect.poll(() => readTick(page)).toBe(0);
  const log = page.getByTestId('debug-lab-mutation-log');
  await expect(log).toHaveAttribute('data-count', '0');
  await page.getByTestId('debug-lab-mut-x').fill('4');
  await page.getByTestId('debug-lab-mut-z').fill('-3');
  await page.getByTestId('debug-lab-mut-teleport').click();
  await expect(log).toHaveAttribute('data-count', '1');
  await expect(log).toContainText('first: teleport to (4.00, -3.00)');
  await page.getByTestId('debug-lab-mut-reset-cooldowns').click();
  await page.getByTestId('debug-lab-mut-force-jump').click();
  await page.getByTestId('debug-lab-mut-prepare-clash').click();
  await expect.poll(async () => Number(await log.getAttribute('data-count'))).toBeGreaterThanOrEqual(8); // teleport, reset, jump, then Prepare Clash: two teleports, reset (the Dash's included), two forced Dashes
  // Prepare Clash + run: a real Clash starts.
  await page.evaluate(() => window.__chaosBeyDebugLab!.step(240));
  await inspector.locator('[data-section="clash"] summary').click();
  await expect(inspector.locator('[data-section="clash"]')).toContainText(/State\s+(Active|Cooldown)/);
  await page.getByTestId('debug-lab-mut-resource').selectOption('stability');
  await page.getByTestId('debug-lab-mut-percent').fill('0');
  await page.getByTestId('debug-lab-mut-resource-apply').click();
  await expect(inspector.locator('[data-section="first-resources"]')).toContainText('BROKEN');

  await page.getByTestId('debug-lab-report-generate').click();
  const reportText = await page.getByTestId('debug-lab-report-text').inputValue();
  const report = JSON.parse(reportText);
  expect(report.format).toBe('ChaosBeyDebugReportV1');
  expect(report.mutated).toBe(true);
  expect(report.mutations.length).toBeGreaterThanOrEqual(9); // the 8 above + set Stability
  expect(report.replay.status).toBe('idle');
  expect(report.replay.stateHash).toMatch(/^[0-9a-f]{16}$/);
  expect(reportText).not.toMatch(/NaN|Infinity/);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('debug-lab-report-download').click()]);
  expect(download.suggestedFilename()).toMatch(/^chaosbey-debug-.*\.json$/);

  // Scenario presets (GDD 68): load the Clash preset and watch a real Clash start.
  await page.getByTestId('debug-lab-preset').selectOption('clash');
  await page.getByTestId('debug-lab-preset-load').click();
  await expect(status).toContainText('preset: Test Clash');
  await page.evaluate(() => window.__chaosBeyDebugLab!.step(200));
  await expect(inspector.locator('[data-section="clash"]')).toContainText(/State\s+Active/);
  await expect(inspector.locator('[data-section="match"]')).toContainText('Anomalies (GDD 67)');

  expect(consoleErrors).toEqual([]);
});

test('Debug Lab: restart() with an empty/whitespace seed does not crash or strand the session', async ({ page }) => {
  // DebugLabHandle.restart(seedText) is a public window.__chaosBeyDebugLab
  // API (used by this very file, not only the panel's own "typed seed"
  // button, which already trims and falls back at the DOM layer) — it must
  // stay robust on its own. An empty/blank string reaching
  // normalizeSeedText() throws ("seed text must not be empty"), which used
  // to escape createSession() uncaught and leave `session` stuck at null.
  await page.goto(baselineUrl('/ChaosBey/?mode=debug-lab'));
  await page.waitForFunction(() => window.__chaosBeyDebugLab?.getSession() !== null);

  for (const blank of ['', '   ']) {
    let threw: string | null = null;
    try {
      await page.evaluate(async (seedText) => {
        await window.__chaosBeyDebugLab!.restart(seedText);
      }, blank);
    } catch (error) {
      threw = String(error);
    }
    expect(threw, `restart(${JSON.stringify(blank)}) should not throw`).toBeNull();
    expect(await page.evaluate(() => window.__chaosBeyDebugLab?.getSession() !== null)).toBe(true);
    // The match still runs normally afterward.
    await page.evaluate(() => window.__chaosBeyDebugLab!.step(5));
    expect(await page.evaluate(() => window.__chaosBeyDebugLab!.getSession()!.getTickIndex())).toBeGreaterThan(0);
  }
});

test('Debug Lab: record a match, download the replay, import it and watch it verify live (M9)', async ({ page }) => {
  test.setTimeout(120_000);
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));
  await page.goto(baselineUrl('/ChaosBey/?mode=debug-lab'));
  await page.waitForFunction(() => window.__chaosBeyDebugLab?.getSession() !== null);
  const status = page.getByTestId('debug-lab-status');

  // Record 400 ticks from tick 0 (AI vs AI), then stop and download the file.
  await page.evaluate(async () => {
    const lab = window.__chaosBeyDebugLab!;
    lab.setController('first', { kind: 'ai', personality: 'archetype' });
    lab.setController('second', { kind: 'ai', personality: 'archetype' });
  });
  await page.getByTestId('debug-lab-replay-record').click();
  await expect(status).toContainText('recording from tick 0');
  await page.evaluate(() => window.__chaosBeyDebugLab!.step(400));
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('debug-lab-replay-stop').click()]);
  expect(download.suggestedFilename()).toMatch(/^chaosbey-replay-.*\.json$/);
  const file = await download.path();
  const text = (await import('node:fs')).readFileSync(file!, 'utf8');
  expect(JSON.parse(text).format).toBe('ChaosBeyReplayV2'); // M11: new recordings are V2

  // Import it through the panel and let it play out: every checkpoint must match.
  await page.getByTestId('debug-lab-replay-file').setInputFiles(file!);
  await expect.poll(() => page.evaluate(() => window.__chaosBeyDebugLab!.replayStatus())).toMatch(/^replaying/);
  await page.evaluate(() => window.__chaosBeyDebugLab!.step(1000));
  await expect.poll(() => page.evaluate(() => window.__chaosBeyDebugLab!.replayStatus())).toMatch(/^replay finished: VERIFIED/);
  const telemetrySection = page.getByTestId('debug-lab-inspector').locator('[data-section="telemetry"]');
  await telemetrySection.locator('summary').click();
  await expect(telemetrySection).toContainText(/Divergence state\s+replay finished: VERIFIED/);

  // A hand-edited file is refused (integrity), never played.
  const edited = JSON.parse(text);
  edited.frames[10].first.held = ['Dodge'];
  expect(await page.evaluate((t) => window.__chaosBeyDebugLab!.playReplay(t), JSON.stringify(edited))).toBe(false);
  await expect(status).toContainText('replay refused: integrity: integrity-mismatch');
  expect(consoleErrors).toEqual([]);
});
