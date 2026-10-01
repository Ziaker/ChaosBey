import { expect, test, type Page } from '@playwright/test';

// Presentation foundation in the production build: the ?pfx= development flags
// reach a real session, change nothing a player can see, and leave no console
// error; and a restart gives a fresh presentation hub while the old session's
// attached systems are disposed. Nothing is attached behind any flag yet, so
// the hub runs empty; the point is that flags on, flags off and a typo all play
// the same match and the legacy placeholder visuals stay in place.

async function openDebugLab(page: Page, search: string, errors: string[]): Promise<void> {
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  await page.goto(`/ChaosBey/?mode=debug-lab${search}`);
  await expect.poll(() => page.evaluate(() => window.__chaosBeyDebugLab?.getSession()?.getTickIndex() ?? 0), { timeout: 20_000 }).toBeGreaterThan(120);
}

test('?pfx=all, no flags and a mistyped flag all start the same match; only newBeyVisuals swaps the picture; no console errors', async ({ browser }) => {
  const seen: { stats: unknown; ids: string[]; features: Record<string, boolean>; errors: string[] }[] = [];
  for (const search of ['', '&pfx=all', '&pfx=notAFeature']) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors: string[] = [];
    await openDebugLab(page, search, errors);
    const result = await page.evaluate(() => {
      const session = window.__chaosBeyDebugLab!.getSession()!;
      return {
        stats: session.getPresentationStats().hub,
        ids: [session.match.visuals.first.definition.id, session.match.visuals.second.definition.id],
        features: { ...session.getPresentation().features } as Record<string, boolean>,
      };
    });
    seen.push({ ...result, errors });
    await context.close();
  }

  for (const run of seen) {
    expect(run.errors).toEqual([]);
    // conditionVisuals is the only flag that attaches a system so far.
    expect(run.stats).toMatchObject({ systems: run.features.conditionVisuals ? 1 : 0, systemErrors: 0 });
    expect(run.ids).toEqual(run.features.newBeyVisuals ? ['concept:attack-a', 'concept:defense-a'] : ['placeholder:attack-prototype', 'placeholder:defense-prototype']);
  }
  expect(Object.values(seen[0]!.features).some(Boolean)).toBe(false);
  expect(Object.values(seen[1]!.features).every(Boolean)).toBe(true);
  expect(Object.values(seen[2]!.features).some(Boolean)).toBe(false);
});

test('a restart builds a fresh presentation hub and disposes what was attached to the old session', async ({ page }) => {
  const errors: string[] = [];
  await openDebugLab(page, '&pfx=all', errors);

  await page.evaluate(() => {
    const session = window.__chaosBeyDebugLab!.getSession()!;
    const probe = { creates: 0, disposes: 0, states: 0 };
    (window as unknown as { __presentationProbe: typeof probe }).__presentationProbe = probe;
    session.getPresentation().attach({
      id: 'probe',
      create: () => void probe.creates++,
      onEvents: () => void probe.states++,
      dispose: () => void probe.disposes++,
    });
  });
  await expect.poll(() => page.evaluate(() => (window as unknown as { __presentationProbe: { states: number } }).__presentationProbe.states)).toBeGreaterThan(10);

  await page.evaluate(() => window.__chaosBeyDebugLab!.restart('presentation-restart'));
  await expect.poll(() => page.evaluate(() => window.__chaosBeyDebugLab?.getSession()?.getTickIndex() ?? 0), { timeout: 20_000 }).toBeGreaterThan(30);

  const after = await page.evaluate(() => {
    const probe = (window as unknown as { __presentationProbe: { creates: number; disposes: number; states: number } }).__presentationProbe;
    const hub = window.__chaosBeyDebugLab!.getSession()!.getPresentation();
    return { probe: { ...probe }, systemIds: [...hub.systemIds()], features: { ...hub.features } as Record<string, boolean> };
  });
  expect(after.probe.creates).toBe(1);
  expect(after.probe.disposes).toBe(1);
  // The restarted session builds its own condition system again (flag on); the probe is gone.
  expect(after.systemIds).toEqual(['condition-visuals']);
  // The restarted session reads the same page flags again.
  expect(Object.values(after.features).every(Boolean)).toBe(true);
  expect(errors).toEqual([]);
});

test('conditionVisuals in a real browser: three languages on worn Beys, no console errors, and the camera is exactly as with the flag off', async ({ browser }) => {
  const cameraAfter = async (search: string): Promise<{ camera: string; layers: unknown; stats: Record<string, number> | null; errors: string[] }> => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors: string[] = [];
    await openDebugLab(page, search, errors);
    await page.evaluate(async () => {
      const lab = window.__chaosBeyDebugLab!;
      lab.setPaused(true);
      await lab.restart('condition-camera-proof');
      lab.getSession()!.setConditionLayers(['A', 'B', 'C']);
      const match = lab.getSession()!.match;
      match.first.stamina.resource.set(0.2 * match.first.stamina.resource.max);
      match.first.stability.debugSetValue(0.1 * match.first.stability.resource.max);
      lab.step(90);
    });
    await page.waitForTimeout(500);
    const result = await page.evaluate(() => {
      const lab = window.__chaosBeyDebugLab!;
      const camera = lab.getCamera();
      const session = lab.getSession()!;
      return {
        camera: JSON.stringify([camera.position.toArray().map((v) => +v.toFixed(5)), camera.fov, camera.children.length]),
        layers: session.getConditionLayers(),
        stats: (session.getPresentationStats().hub.perSystem['condition-visuals'] ?? null) as Record<string, number> | null,
      };
    });
    await context.close();
    return { ...result, errors };
  };
  const off = await cameraAfter('');
  const on = await cameraAfter('&pfx=conditionVisuals,newBeyVisuals');
  expect(off.errors).toEqual([]);
  expect(on.errors).toEqual([]);
  expect(off.layers).toBeNull();
  expect(on.layers).toEqual(['A', 'B', 'C']);
  expect(on.stats).toMatchObject({ layers: 6 });
  expect(on.camera).toBe(off.camera);
});
