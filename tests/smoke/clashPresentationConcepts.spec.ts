import { expect, test } from '@playwright/test';

// Smoke test for the isolated Clash Presentation Lab prototype (not the
// game's Clash — that stays src/combat/clash/, untouched). Loads the
// production page, runs a few scenarios through all three presentation
// directions to a full resolution, and fails on any console error.

test('clash presentation lab loads, runs scenarios through A/B/C to resolution, no console errors', async ({ page }) => {
  test.setTimeout(180_000); // software WebGL in CI is slow
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('response', (r) => {
    if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
  });

  await page.goto('/ChaosBey/prototypes/clash-presentation-concepts/');
  await page.waitForFunction(() => Boolean(window.__clashLab) && window.__clashLab.state().ticks > 3, null, { timeout: 60_000 });
  const state = () => page.evaluate(() => window.__clashLab.state());

  // Ten scenarios, three directions, three tie styles, three approved camera presets.
  await expect(page.locator('.scenario')).toHaveCount(10);
  await expect(page.locator('.option[data-id]')).toHaveCount(3);
  await expect(page.locator('.tie-style')).toHaveCount(3);
  await expect(page.locator('#camera-presets .chip')).toHaveCount(3);

  for (const [key, id] of [['1', 'A'], ['3', 'C'], ['2', 'B']] as const) {
    await page.keyboard.press(key);
    await expect(page.locator(`.option[data-id="${id}"]`)).toHaveAttribute('aria-pressed', 'true');
    expect((await state()).direction).toBe(id);
  }

  await page.evaluate(() => window.__clashLab.setPaused(true));

  // A normal, close Clash reaches resolution on all three directions, and
  // the direction only changes the presentation: the Clash result and the
  // physical continuation are identical shot for shot.
  const fingerprints: string[] = [];
  for (const direction of ['A', 'B', 'C'] as const) {
    await page.evaluate((d) => window.__clashLab.setDirection(d), direction);
    await page.evaluate(() => window.__clashLab.loadScenario('balanced'));
    await page.evaluate(() => window.__clashLab.advance(5.5));
    const s = await state();
    expect(s.phase).toBe('Cooldown');
    fingerprints.push(s.simFingerprint);
  }
  expect(fingerprints[0]).not.toBe('');
  expect(new Set(fingerprints).size).toBe(1);

  // Restart (R) mid-resolution replays from the top at normal speed: no
  // hitstop/slow-mo carried over, and the same run reproduces exactly.
  const firstRun = fingerprints[0];
  await page.keyboard.press('r');
  await page.waitForFunction(() => window.__clashLab.state().phase === 'Approach' && window.__clashLab.state().ticks === 1, null, { timeout: 30_000 });
  const s = await state();
  expect(s.hitstopRemainingS).toBe(0);
  expect(s.slowMoRemainingS).toBe(0);
  await page.evaluate(() => window.__clashLab.advance(5.5));
  expect((await state()).simFingerprint).toBe(firstRun);

  // The dedicated Tie scenario really reaches Cooldown with the Tie presentation wired up (no console error along the way).
  await page.evaluate(() => window.__clashLab.loadScenario('tie'));
  await page.evaluate(() => window.__clashLab.advance(5.5));
  expect((await state()).phase).toBe('Cooldown');

  // Ring-out resolution scenario runs the full physical continuation without erroring.
  await page.evaluate(() => window.__clashLab.loadScenario('resolution-ring-out'));
  await page.evaluate(() => window.__clashLab.advance(7.5));
  expect((await state()).phase).toBe('Cooldown');

  // Cooldown scenario: watch the 10s countdown at high speed without erroring.
  await page.evaluate(() => window.__clashLab.loadScenario('cooldown-watch'));
  await page.evaluate(() => window.__clashLab.advance(15));
  expect((await state()).phase).toBe('Idle');

  // Resume real-time playback briefly.
  await page.evaluate(() => window.__clashLab.loadScenario('comeback'));
  await page.evaluate(() => window.__clashLab.setPaused(false));
  const t0 = (await state()).ticks;
  await page.waitForFunction((t) => window.__clashLab.state().ticks > t + 5, t0, { timeout: 30_000 });

  expect(errors).toEqual([]);
});

// The presentation revision's 15-point re-verification, measured in the real page: locked contact
// with lean, speedlines, contact dust, the approved bowl, no rotating energy geometry, the
// screen-space force HUD, a camera that holds its angle, no result banner/pause, continuous
// resolution → knockback → fight, Tie, physical ring-out, A/B/C reproducibility, model swap.
test('clash presentation revision: contact, speedlines, dust, bowl, force HUD, steady camera, no result pause', async ({ page }) => {
  test.setTimeout(480_000); // software WebGL in CI is slow
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  await page.goto('/ChaosBey/prototypes/clash-presentation-concepts/');
  await page.waitForFunction(() => Boolean(window.__clashLab) && window.__clashLab.state().ticks > 3, null, { timeout: 60_000 });
  await page.evaluate(() => window.__clashLab.setPaused(true));
  const state = () => page.evaluate(() => window.__clashLab.state());
  const advance = (s: number) => page.evaluate((x) => window.__clashLab.advance(x), s);
  const load = (id: string) => page.evaluate((x) => window.__clashLab.loadScenario(x), id);

  // (6) The old rotating beam/helix/vortex is gone, and (10) there is no banner element at all.
  await expect(page.locator('#banner')).toHaveCount(0);
  const resultWords = /VENCE|VITÓRIA|DERROTA|FINALIZAÇÃO|EMPATE|SOBRECARGA|NOCAUTE|RING-OUT/i;
  const overlayTellsResult = () => page.evaluate((src) => {
    const re = new RegExp(src, 'i');
    return [...document.querySelectorAll('#overlay *')].filter((el) => !el.closest('.phase-hud, .harness-note') && el.children.length === 0 && re.test(el.textContent ?? '')).map((el) => el.textContent);
  }, resultWords.source);

  for (const direction of ['A', 'B', 'C'] as const) {
    await page.evaluate((d) => window.__clashLab.setDirection(d), direction);
    await load('balanced');
    await advance(0.45 + 0.3); // into Active
    const yaws: number[] = [];
    for (let i = 0; i < 6; i++) {
      await advance(0.55);
      const s = await state();
      const p = s.presentation;
      expect(s.phase, `${direction}: still in the Clash`).toBe('Active');
      // (1) the two Beys touch: rims meet at the collider contact distance (≤ a few cm of lean compensation).
      expect(Math.abs(p.contactGapM - 1.3), `${direction}: contact gap ${p.contactGapM}`).toBeLessThan(0.05);
      // (2) both lean into the contact.
      expect(Math.min(...p.tiltDeg), `${direction}: lean ${p.tiltDeg}`).toBeGreaterThan(5);
      // (3) speedlines drawn, (4) contact dust alive.
      expect(p.speedlinesDrawn, `${direction}: speedlines`).toBeGreaterThan(10);
      expect(p.dust.dust, `${direction}: dust`).toBeGreaterThan(10);
      // (5) approved bowl; Beys seated on its surface.
      expect(p.arenaDepthM).toBeCloseTo(3.2, 5);
      for (const h of p.tipAboveFloorM) expect(Math.abs(h), `${direction}: tip on the floor`).toBeLessThan(0.02);
      // (6) no cylinder geometry spinning between the Beys.
      expect(p.fxCylinderMeshes).toBe(0);
      // (7) HUD shown between the Beys: horizontally over their projected midpoint, above them.
      expect(p.hud.visible).toBe(true);
      expect(Math.abs(p.hud.x - p.hud.midX), `${direction}: HUD centered over the Beys`).toBeLessThan(120);
      expect(p.hud.y).toBeLessThan(p.hud.midY);
      yaws.push(p.cameraYawDeg);
      expect(await overlayTellsResult()).toEqual([]);
    }
    // (9) the camera holds its angle during the Clash (no orbit). The first ~second is the yaw's damped
    // settle from the Approach (shrinking steps); after that it is still. The removed Clash orbit turned
    // continuously (tens of degrees over a 4s Clash).
    expect(Math.max(...yaws) - Math.min(...yaws), `${direction}: camera yaw range ${yaws}`).toBeLessThan(5);
    const settled = yaws.slice(2);
    expect(Math.max(...settled) - Math.min(...settled), `${direction}: yaw after settling ${settled}`).toBeLessThan(1);

    // (10)(11) Resolution: no hitstop/slow-mo, no banner, and the fight carries straight on.
    await advance(0.5);
    let s = await state();
    expect(s.phase).toBe('Cooldown');
    expect(s.presentation.resolvedAtTick).toBeGreaterThan(0);
    expect(s.presentation.pauseRequestsSinceResolution, `${direction}: no hitstop/slow-mo from the result`).toEqual([]);
    expect(await overlayTellsResult()).toEqual([]);
    const before = s.simFingerprint;
    await advance(0.3);
    s = await state();
    expect(s.simFingerprint, 'physics keeps moving right after the result').not.toBe(before);
    expect(s.presentation.pauseRequestsSinceResolution).toEqual([]);
    expect(s.presentation.hud.visible, 'HUD gone with the Clash').toBe(false);
    expect(s.presentation.speedlinesDrawn).toBe(0);
    expect(s.presentation.contactWeight).toBe(0);
    for (const h of s.presentation.tipAboveFloorM) expect(Math.abs(h), 'seated after the knockback').toBeLessThan(0.05);
  }

  // (8) The HUD proportion follows the real advantage: opposite leads read opposite, and the comeback surges back.
  await page.evaluate(() => window.__clashLab.setDirection('B'));
  const shareAt = async (scenario: string, t: number) => {
    await load(scenario);
    await advance(t);
    return (await state()).presentation.hudShareFirst;
  };
  expect(await shareAt('player-dominates', 3)).toBeGreaterThan(0.8);
  expect(await shareAt('ai-dominates', 3)).toBeLessThan(0.2);
  await load('comeback');
  await advance(0.45 + 2.9);
  const trailing = (await state()).presentation;
  await advance(1.08);
  const surged = (await state()).presentation;
  expect(trailing.hudShareFirst).toBeLessThan(0.1);
  expect(surged.hudShareFirst).toBeGreaterThan(0.35);
  expect(Math.abs(surged.hud.leftShare - trailing.hud.leftShare), 'the on-screen bar itself moved').toBeGreaterThan(0.25);

  // (12) Tie: the bar is even through the Clash and the Tie resolves with no pause.
  await load('tie');
  await advance(3);
  expect((await state()).presentation.hudShareFirst).toBeCloseTo(0.5, 5);
  await advance(1.6);
  const tie = await state();
  expect(JSON.parse(tie.simFingerprint).result.outcome).toBe('Tie');
  expect(tie.presentation.pauseRequestsSinceResolution).toEqual([]);

  // (13) Ring-out is observed physics (flight over the wall), not a declared result.
  await load('resolution-ring-out');
  await advance(6);
  expect(JSON.parse((await state()).simFingerprint).ringOut).toBe(false); // false = the opponent (second) left the arena

  // (15) Swapping the Attack/Defense models mid-Clash keeps them seated and in contact.
  await load('balanced');
  await advance(2);
  for (const letter of ['B', 'C', 'A']) {
    await page.locator('#concepts-first .chip', { hasText: letter }).click();
    await page.locator('#concepts-second .chip', { hasText: letter }).click();
    const p = (await state()).presentation;
    expect([p.firstConcept, p.secondConcept]).toEqual([letter, letter]);
    for (const h of p.tipAboveFloorM) expect(Math.abs(h)).toBeLessThan(0.02);
    expect(Math.abs(p.contactGapM - 1.3)).toBeLessThan(0.05);
  }

  expect(errors).toEqual([]);
});
