import { expect, test } from '@playwright/test';
import { baselineUrl } from './presentationBaseline';
import * as fs from 'fs';

// Owner playtest fix 8 (GDD §§48–50): the in-game camera is a dynamic,
// opponent-focused, two-fighter director again — not the fix 5–7 ShoulderRig
// that locked the eye to `baseYaw + PI` and prioritized "player in the lower
// half" above opponent visibility. Checked through the camera actually on
// screen: both fighters framed (opponent especially), distance/FOV responding
// to separation, low and close up-close, never top-down when far apart.
//
// Five named situations (owner's report §17.10): average combat, distant
// fighters, opponent lateral (camera must recompose, not just look at the
// player), player near the wall, and a high-speed orbit. Screenshots for each
// are written to test-results/ for the playtest report.

interface FramingMeasurement {
  readonly player: { x: number; y: number };
  readonly opponent: { x: number; y: number };
  readonly pitchDeg: number;
  readonly eyeHeightAbovePlayer: number;
  readonly eyeRadius: number;
  readonly fov: number;
  readonly separationM: number;
}

async function measure(page: import('@playwright/test').Page): Promise<FramingMeasurement> {
  return page.evaluate(() => {
    const lab = window.__chaosBeyDebugLab!;
    const cam = lab.getCamera();
    cam.updateMatrixWorld();
    const s = lab.getSession()!;
    const p1 = s.getBey('first').body.translation();
    const p2 = s.getBey('second').body.translation();
    const project = (p: { x: number; y: number; z: number }) => {
      const v = cam.position.clone().set(p.x, p.y, p.z).project(cam);
      return { x: v.x, y: v.y };
    };
    const dir = cam.getWorldDirection(cam.position.clone());
    return {
      player: project(p1),
      opponent: project(p2),
      pitchDeg: (-Math.asin(dir.y) * 180) / Math.PI,
      eyeHeightAbovePlayer: cam.position.y - p1.y,
      eyeRadius: Math.hypot(cam.position.x, cam.position.z),
      fov: cam.fov,
      separationM: Math.hypot(p1.x - p2.x, p1.z - p2.z),
    };
  });
}

async function place(page: import('@playwright/test').Page, p1: { x: number; z: number }, p2: { x: number; z: number }, v1?: { x: number; z: number }, v2?: { x: number; z: number }): Promise<void> {
  await page.evaluate(
    ({ p1, p2, v1, v2 }) => {
      const s = window.__chaosBeyDebugLab!.getSession()!;
      const first = s.getBey('first').body;
      const second = s.getBey('second').body;
      first.setTranslation({ x: p1.x, y: first.translation().y, z: p1.z }, true);
      second.setTranslation({ x: p2.x, y: second.translation().y, z: p2.z }, true);
      if (v1) first.setLinvel({ x: v1.x, y: 0, z: v1.z }, true);
      if (v2) second.setLinvel({ x: v2.x, y: 0, z: v2.z }, true);
    },
    { p1, p2, v1, v2 },
  );
}

test('two-fighter camera framing: both fighters visible, low and close, recomposes for a lateral opponent, near the wall, and at high speed', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(baselineUrl('/ChaosBey/?mode=debug-lab'));
  await expect.poll(() => page.evaluate(() => window.__chaosBeyDebugLab?.getSession() != null), { timeout: 20_000 }).toBe(true);
  fs.mkdirSync('test-results', { recursive: true });
  await page.evaluate(() => {
    const lab = window.__chaosBeyDebugLab!;
    lab.setCameraView('game');
    lab.setController('first', { kind: 'idle' });
    lab.setController('second', { kind: 'idle' });
  });

  const report: Record<string, unknown> = {};

  for (const preset of ['A', 'B', 'C'] as const) {
    await page.evaluate((p) => window.__chaosBeyDebugLab!.setCameraPreset(p), preset);

    // 1. Average combat: ordinary mid-range separation, roughly face to face.
    await place(page, { x: 0, z: -2.5 }, { x: 0, z: 2.5 });
    await page.waitForTimeout(2000);
    let m = await measure(page);
    await page.screenshot({ path: `test-results/camera-${preset}-average-combat.png` });
    report[`${preset} average combat`] = m;
    expect(Math.abs(m.player.x), `${preset} average: player on screen`).toBeLessThan(1);
    expect(Math.abs(m.opponent.x), `${preset} average: opponent on screen`).toBeLessThan(0.95);
    expect(Math.abs(m.opponent.y), `${preset} average: opponent on screen`).toBeLessThan(0.95);
    expect(m.eyeHeightAbovePlayer, `${preset} average: low, third-person`).toBeLessThan(4);

    // 2. Distant fighters: near the practical maximum separation on this arena.
    await place(page, { x: 0, z: -9 }, { x: 0, z: 9 });
    await page.waitForTimeout(3000);
    m = await measure(page);
    await page.screenshot({ path: `test-results/camera-${preset}-distant-fighters.png` });
    report[`${preset} distant fighters`] = m;
    expect(Math.abs(m.opponent.x), `${preset} distant: opponent on screen`).toBeLessThan(0.95);
    expect(Math.abs(m.opponent.y), `${preset} distant: opponent on screen`).toBeLessThan(0.95);
    expect(m.pitchDeg, `${preset} distant: never top-down`).toBeLessThan(60);

    // 3. Opponent lateral: well off the player's forward axis — the camera must recompose
    // toward the fight, not simply keep looking wherever the player last faced.
    await place(page, { x: 0, z: 0 }, { x: 6, z: 1 });
    await page.waitForTimeout(2500);
    m = await measure(page);
    await page.screenshot({ path: `test-results/camera-${preset}-opponent-lateral.png` });
    report[`${preset} opponent lateral`] = m;
    expect(Math.abs(m.opponent.x), `${preset} lateral: opponent on screen`).toBeLessThan(0.95);
    expect(Math.abs(m.opponent.y), `${preset} lateral: opponent on screen`).toBeLessThan(0.95);

    // 4. Player near the wall, opponent central.
    await place(page, { x: 0, z: -10 }, { x: 0, z: 0 });
    await page.waitForTimeout(2500);
    m = await measure(page);
    await page.screenshot({ path: `test-results/camera-${preset}-player-near-wall.png` });
    report[`${preset} player near wall`] = m;
    expect(Math.abs(m.opponent.x), `${preset} near wall: opponent on screen`).toBeLessThan(0.95);
    expect(Math.abs(m.opponent.y), `${preset} near wall: opponent on screen`).toBeLessThan(0.95);

    // 5. High-speed orbit: the player circling fast around a central opponent.
    await place(page, { x: -6, z: 0 }, { x: 0, z: 0 }, { x: 0, z: 10 });
    await page.waitForTimeout(300); // a few ticks of real speed before it decays — enough for HighSpeed context + FOV to respond
    m = await measure(page);
    await page.screenshot({ path: `test-results/camera-${preset}-high-speed-orbit.png` });
    report[`${preset} high-speed orbit`] = m;
    expect(m.fov, `${preset} high-speed: FOV opens up`).toBeGreaterThan(50);
  }

  fs.writeFileSync('test-results/camera-framing.json', JSON.stringify(report, null, 2));
  expect(errors).toEqual([]);
});
