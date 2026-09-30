import { expect, test } from '@playwright/test';
import * as fs from 'fs';

// Owner playtest (after M11): the camera should be third person behind the
// Bey, just a little above it, over the shoulder — not an aerial view of the
// arena. Checked through the camera actually on screen, for presets A/B/C, on
// the flat floor and on Bowl B: the player's Bey in the lower half, the
// opponent ahead and in frame, a shallow downward look, the eye inside the
// arena and above the floor.

test('camera A/B/C: over the shoulder, the player low in frame and the opponent ahead', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/ChaosBey/?mode=debug-lab');
  await expect.poll(() => page.evaluate(() => window.__chaosBeyDebugLab?.getSession() != null), { timeout: 20_000 }).toBe(true);
  fs.mkdirSync('test-results', { recursive: true });

  const report: Record<string, unknown> = {};
  for (const floor of ['flat', 'bowl-b'] as const) {
    for (const preset of ['A', 'B', 'C'] as const) {
      await page.evaluate(async ({ f, p }) => {
        const lab = window.__chaosBeyDebugLab!;
        await lab.setArenaFloor(f);
        lab.setCameraPreset(p);
        lab.setCameraView('game');
        lab.setController('first', { kind: 'idle' });
        lab.setController('second', { kind: 'idle' });
      }, { f: floor, p: preset });
      await page.waitForTimeout(2500); // settle, and let the camera arrive
      const m = await page.evaluate(() => {
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
          eyeToPlayer: Math.hypot(cam.position.x - p1.x, cam.position.z - p1.z),
          fov: cam.fov,
        };
      });
      await page.screenshot({ path: `test-results/camera-${floor}-${preset}.png` });
      report[`${floor} ${preset}`] = m;
      const label = `${floor} ${preset}: ${JSON.stringify(m)}`;
      expect(m.player.y, label).toBeLessThan(0);
      expect(Math.abs(m.player.x), label).toBeLessThan(1);
      expect(Math.abs(m.opponent.x), label).toBeLessThan(1);
      expect(Math.abs(m.opponent.y), label).toBeLessThan(1);
      expect(m.pitchDeg, label).toBeLessThan(30);
      expect(m.eyeHeightAbovePlayer, label).toBeLessThan(4.5);
      expect(m.eyeRadius, label).toBeLessThanOrEqual(10.6);
    }
  }
  fs.writeFileSync('test-results/camera-shoulder.json', JSON.stringify(report, null, 2));
  expect(errors).toEqual([]);
});
