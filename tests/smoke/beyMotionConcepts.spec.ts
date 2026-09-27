import { expect, test } from '@playwright/test';

// Smoke test for the isolated Bey Motion Lab (prototype only): loads the
// production page and exercises both sections — motion physics (presets,
// scenarios, game replays, sliders, reset, JSON record, seek, cameras) and
// spin readability (layouts, cameras, spin presets, blur, spin-down) —
// checks the animation keeps advancing, and fails on any console error.

interface PhysicsState {
  scenario: string;
  preset: string;
  modified: string[];
  time: number;
  duration: number;
  frames: number;
  camera: string;
  replay: boolean;
  readouts: Array<{ speed: number; tilt: number }>;
}

interface SpinState {
  layout: string;
  camera: string;
  spinRate: number;
  blur: boolean;
  beys: number;
  frames: number;
  effectiveSpinRate: number;
  spinningDown: boolean;
  primary: string;
  secondary: string;
}

declare global {
  interface Window {
    __beyMotionLab: {
      tab(t: 'physics' | 'spin'): void;
      currentTab(): string;
      physics: {
        scenarios(): string[];
        play(id: string): void;
        preset(id: 'A' | 'B' | 'C'): void;
        setParam(key: string, value: number): void;
        camera(mode: string): void;
        seek(t: number): void;
        moments(): Array<{ t: number; label: string }>;
        state(): PhysicsState;
      };
      spin: {
        ids: string[];
        select(id: string, second?: boolean): void;
        layout(layout: string): void;
        set(patch: Record<string, unknown>): void;
        spinDown(): void;
        state(): SpinState;
      };
    };
  }
}

test('bey motion lab: motion physics and spin readability sections load, animate and respond', async ({ page }) => {
  test.setTimeout(240_000); // software WebGL in CI is slow
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });

  await page.goto('/ChaosBey/prototypes/bey-motion-concepts/');
  await page.waitForFunction(() => Boolean(window.__beyMotionLab) && window.__beyMotionLab.physics.state().frames > 2, null, { timeout: 60_000 });
  const phys = () => page.evaluate(() => window.__beyMotionLab.physics.state());

  // ---- Motion physics (default tab) ----
  expect(await page.evaluate(() => window.__beyMotionLab.currentTab())).toBe('physics');
  const ids = await page.evaluate(() => window.__beyMotionLab.physics.scenarios());
  expect(ids.length).toBeGreaterThanOrEqual(14);
  expect(ids).toContain('replay-ext-0');
  expect(ids).toContain('replay-ext-32');
  await expect(page.locator('#scenario-list button')).toHaveCount(ids.length - 2);

  // Every scenario and replay starts and its clock advances.
  for (const id of ids) {
    await page.evaluate((s) => window.__beyMotionLab.physics.play(s), id);
    await page.waitForFunction(() => window.__beyMotionLab.physics.state().time > 0.05, null, { timeout: 30_000 });
    expect((await phys()).scenario).toBe(id);
  }

  // Presets by key; a slider change is tracked and reset restores the preset.
  await page.evaluate(() => window.__beyMotionLab.physics.play('wall'));
  for (const preset of ['A', 'C', 'B'] as const) {
    await page.keyboard.press(preset.toLowerCase());
    expect((await phys()).preset).toBe(preset);
  }
  await page.locator('input[data-param="wallBounce"]').fill('0.9');
  await page.locator('input[data-param="wallBounce"]').dispatchEvent('input');
  expect((await phys()).modified).toEqual(['wallBounce']);
  await page.locator('#copy-params').click();
  await expect(page.locator('#params-json')).toContainText('"wallBounce": 0.9');
  await page.locator('#reset-params').click();
  expect((await phys()).modified).toEqual([]);

  // Seek (a scenario is re-simulated deterministically) and cameras.
  await page.evaluate(() => window.__beyMotionLab.physics.seek(1.5));
  expect((await phys()).time).toBeCloseTo(1.5, 1);
  for (const [key, camera] of [['f', 'follow'], ['t', 'top'], ['v', 'side'], ['g', 'combat']] as const) {
    await page.keyboard.press(key);
    expect((await phys()).camera).toBe(camera);
  }

  // The ext-32 replay exposes the wedge as a key moment.
  await page.evaluate(() => window.__beyMotionLab.physics.play('replay-ext-32'));
  const moments = await page.evaluate(() => window.__beyMotionLab.physics.moments());
  expect(moments.some((m) => m.label.includes('wedged'))).toBe(true);
  await expect(page.locator('#moments button').first()).toBeVisible();

  // ---- Spin readability ----
  await page.locator('#tab-bar button[data-tab="spin"]').click();
  expect(await page.evaluate(() => window.__beyMotionLab.currentTab())).toBe('spin');
  const spin = () => page.evaluate(() => window.__beyMotionLab.spin.state());
  const spinFramesAdvance = async () => {
    const before = (await spin()).frames;
    await page.waitForFunction((f) => window.__beyMotionLab.spin.state().frames > f + 2, before, { timeout: 30_000 });
  };
  await expect(page.locator('.concept-button')).toHaveCount(9);
  expect((await spin()).spinRate, 'starts at the game spin rate').toBe(22);
  const spinIds = await page.evaluate(() => window.__beyMotionLab.spin.ids);
  for (const [i, id] of spinIds.entries()) {
    await page.keyboard.press(String(i + 1));
    expect((await spin()).primary).toBe(id);
  }
  await spinFramesAdvance();
  await page.keyboard.press('a');
  expect((await spin()).beys).toBe(9);
  await page.keyboard.press('w');
  await page.keyboard.press('Shift+Digit9');
  expect((await spin()).secondary).toBe('stamina-c');
  for (const [key, camera] of [['c', 'close'], ['t', 'top'], ['g', 'combat']] as const) {
    await page.keyboard.press(key);
    expect((await spin()).camera).toBe(camera);
  }
  await page.locator('#spin-presets button').nth(2).click();
  expect((await spin()).spinRate).toBe(90);
  await page.keyboard.press('b');
  expect((await spin()).blur).toBe(true);
  await spinFramesAdvance();
  await page.keyboard.press('n');
  await page.waitForFunction(() => window.__beyMotionLab.spin.state().effectiveSpinRate < 90, null, { timeout: 30_000 });
  await expect(page.locator('#readout')).toContainText('fold');

  expect(errors).toEqual([]);
});
