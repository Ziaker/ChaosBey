import { expect, test } from '@playwright/test';

// Smoke test for the isolated SFX Lab prototype (a decision tool, not the
// game's audio). Loads the production page under the GitHub Pages subpath,
// makes per-event A/B/C/SEM SOM choices and checks they survive a reload,
// plays single sounds, A→B→C, a context sequence and a real AI fight, then
// renders every event × direction offline to prove each option is audible,
// doesn't clip and sits within a few dB of the other two directions.
// Fails on any console error or failed request.

test('sfx lab: per-event choices persist, sounds play in context and every option is audible', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('response', (r) => {
    if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
  });

  await page.goto('/ChaosBey/prototypes/sfx-concepts/');
  await page.waitForFunction(() => window.__sfxLab?.state().ready === true);
  const lab = () => page.evaluate(() => window.__sfxLab.state());

  // Every event is listed with A / B / C / SEM SOM, and nothing is decided for the owner.
  const initial = await lab();
  const eventCount = Object.keys(initial.choices).length;
  expect(eventCount).toBeGreaterThanOrEqual(30);
  expect(Object.values(initial.choices).every((c) => c === null)).toBe(true);
  await expect(page.locator('.event')).toHaveCount(eventCount);
  await expect(page.locator('.pick-btn')).toHaveCount(eventCount * 4);
  await expect(page.locator('.play-btn')).toHaveCount(eventCount * 3);
  await expect(page.locator('.preset')).toHaveCount(3);

  // Choose by clicking; the pressed button shows the current choice.
  const pick = (id: string, choice: string) => page.locator(`.event[data-id="${id}"] .pick-btn[data-choice="${choice}"]`);
  await pick('hit', 'B').click();
  await pick('spinHum', 'none').click();
  await pick('ko', 'C').click();
  await pick('dodge', 'A').click();
  await expect(pick('hit', 'B')).toHaveAttribute('aria-pressed', 'true');
  await expect(pick('hit', 'A')).toHaveAttribute('aria-pressed', 'false');
  await expect(pick('spinHum', 'none')).toHaveAttribute('aria-pressed', 'true');
  // Clicking the active choice again puts the event back to pending.
  await pick('dodge', 'A').click();
  await expect(pick('dodge', 'A')).toHaveAttribute('aria-pressed', 'false');
  expect((await lab()).choices).toMatchObject({ hit: 'B', spinHum: 'none', ko: 'C', dodge: null });
  await expect(page.locator('#counts .count[data-k="none"]')).toContainText('1');
  await expect(page.locator('#counts .count[data-k="pending"]')).toContainText(String(eventCount - 3));

  // Choices survive a reload.
  await page.reload();
  await page.waitForFunction(() => window.__sfxLab?.state().ready === true);
  expect((await lab()).choices).toMatchObject({ hit: 'B', spinHum: 'none', ko: 'C', dodge: null });
  await expect(pick('ko', 'C')).toHaveAttribute('aria-pressed', 'true');

  // Real-time audio: single options, then A→B→C.
  await page.locator('.event[data-id="hit"] .play-btn[data-dir="A"]').click();
  await page.waitForFunction(() => window.__sfxLab.state().audio === 'running' && window.__sfxLab.state().played >= 1);
  await page.locator('.event[data-id="hit"] .play-btn[data-dir="C"]').click();
  await page.waitForFunction(() => window.__sfxLab.state().played >= 2);
  const beforeCycle = (await lab()).played;
  await page.locator('.event[data-id="dodge"] .cycle-btn').click();
  await page.waitForFunction((n) => window.__sfxLab.state().played >= n + 3, beforeCycle, { timeout: 10_000 });
  const cycled = (await page.evaluate(() => window.__sfxLab.log())).slice(0, 3).map((e) => `${e.eventId}:${e.direction}`);
  expect(cycled.reverse()).toEqual(['dodge:A', 'dodge:B', 'dodge:C']);

  // A context sequence: SEM SOM stays silent, the other events still play.
  await page.evaluate(() => window.__sfxLab.choose('hit', 'none'));
  await page.locator('.scenario[data-id="break"]').click();
  await page.waitForFunction(() => window.__sfxLab.log().some((e) => e.eventId === 'stabilityRecover'), null, { timeout: 15_000 });
  const breakLog = await page.evaluate(() => window.__sfxLab.log());
  const hits = breakLog.filter((e) => e.eventId === 'hit').slice(0, 3);
  expect(hits).toHaveLength(3);
  expect(hits.every((e) => e.silent && !e.played)).toBe(true);
  expect(breakLog.some((e) => e.eventId === 'stabilityBreak' && e.played)).toBe(true);
  await page.evaluate(() => window.__sfxLab.choose('hit', 'B'));

  // The mix: the dense fight sequence drops or cuts something rather than piling everything up.
  await page.locator('.scenario[data-id="mix-stress"]').click();
  await page.waitForFunction(() => window.__sfxLab.log().some((e) => e.eventId === 'victory'), null, { timeout: 20_000 });
  const stress = await lab();
  expect(Object.values(stress.dropped).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);

  // A real AI fight from the game's own simulation, only listened to.
  await page.evaluate(() => window.__sfxLab.startLive('sfx-lab-15'));
  await page.waitForFunction(() => window.__sfxLab.state().liveTicks > 240, null, { timeout: 30_000 });
  const live = await lab();
  expect(live.live).toBe(true);
  expect(live.loops.some((k) => k.startsWith('live:spinHum'))).toBe(false); // spinHum is SEM SOM
  expect(live.loops.some((k) => k.startsWith('live:floorScrape'))).toBe(true);
  const liveLog = await page.evaluate(() => window.__sfxLab.log());
  expect(liveLog.some((e) => e.eventId === 'roundStart' && e.played)).toBe(true);
  // The distance cue can be switched off to compare.
  await expect(page.locator('#live-distance')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#live-distance').click();
  await expect(page.locator('#live-distance')).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Escape');
  expect((await lab()).live).toBe(false);

  // Every event × direction, rendered offline through the master limiter:
  // audible, not clipping, and level-matched across A/B/C.
  const measures = await page.evaluate(() => window.__sfxLab.measureAll());
  expect(measures).toHaveLength(eventCount * 3);
  const byEvent = new Map<string, number[]>();
  for (const m of measures) {
    expect(m.peak, `${m.eventId} ${m.direction} audible`).toBeGreaterThan(0.02);
    expect(m.peak, `${m.eventId} ${m.direction} clipping`).toBeLessThanOrEqual(1);
    expect(m.audibleS, `${m.eventId} ${m.direction} length`).toBeGreaterThan(0.02);
    byEvent.set(m.eventId, [...(byEvent.get(m.eventId) ?? []), m.lufs]);
  }
  for (const [id, loudness] of byEvent) expect(Math.max(...loudness) - Math.min(...loudness), `${id} A/B/C loudness spread`).toBeLessThanOrEqual(3);

  expect(errors).toEqual([]);
});
