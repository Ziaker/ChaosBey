import { expect, test, type Page } from '@playwright/test';

// Presentation flags in the production build. Without ?pfx the page gets the
// normal-game defaults (the five approved packages on, newHud off); an
// explicit ?pfx is an allowlist from all-off (`&pfx=` alone is the all-off
// baseline). Each flagged system is checked against that explicit baseline:
// same match, same camera, no console error; and a restart gives a fresh
// presentation hub while the old session's attached systems are disposed.

async function openDebugLab(page: Page, search: string, errors: string[]): Promise<void> {
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  await page.goto(`/ChaosBey/?mode=debug-lab${search}`);
  // A running session is all these checks need (they read flags, systems and visuals, or restart and step the Lab
  // themselves). The normal game and ?pfx=all deliberately run the full presentation here, which software WebGL in CI
  // draws at ~2 fps, so the Lab's real-time ticks come slowly: waiting for a few ticks proves the session runs
  // without making this a wall-clock test.
  await expect.poll(() => page.evaluate(() => window.__chaosBeyDebugLab?.getSession()?.getTickIndex() ?? 0), { timeout: 20_000 }).toBeGreaterThan(5);
}

test('no ?pfx is the normal game, ?pfx= is an allowlist (all, one, empty, a typo); only newBeyVisuals swaps the picture; no console errors', async ({ browser }) => {
  // Five fresh browser contexts in a row, two of them (no ?pfx, ?pfx=all) with every package on: the default 30 s
  // budget is for one page, not five.
  test.setTimeout(120_000);
  const seen: { stats: unknown; ids: string[]; features: Record<string, boolean>; errors: string[] }[] = [];
  for (const search of ['', '&pfx=all', '&pfx=notAFeature', '&pfx=hybridVfx', '&pfx=']) {
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
    // conditionVisuals, hybridVfx (which also attaches Flow FX), clashPresentation and arenaVisuals are the only flags that attach a system so far.
    expect(run.stats).toMatchObject({ systems: (run.features.conditionVisuals ? 1 : 0) + (run.features.hybridVfx ? 2 : 0) + (run.features.clashPresentation ? 1 : 0) + (run.features.arenaVisuals ? 1 : 0), systemErrors: 0 });
    expect(run.ids).toEqual(run.features.newBeyVisuals ? ['concept:attack-a', 'concept:defense-a'] : ['placeholder:attack-prototype', 'placeholder:defense-prototype']);
  }
  // No ?pfx: the normal game.
  expect(seen[0]!.features).toEqual({ newBeyVisuals: true, conditionVisuals: true, hybridVfx: true, clashPresentation: true, newHud: false, arenaVisuals: true });
  expect(Object.values(seen[1]!.features).every(Boolean)).toBe(true);
  // A typo, or an empty ?pfx=: the all-off baseline.
  expect(Object.values(seen[2]!.features).some(Boolean)).toBe(false);
  expect(Object.values(seen[4]!.features).some(Boolean)).toBe(false);
  // One name: only that package.
  expect(Object.entries(seen[3]!.features).filter(([, on]) => on).map(([id]) => id)).toEqual(['hybridVfx']);
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
  // The restarted session builds its own flag systems again; the probe is gone.
  expect(after.systemIds).toEqual(['flow-fx', 'condition-visuals', 'hybrid-vfx', 'clash-presentation', 'arena-visuals']);
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
  const off = await cameraAfter('&pfx=');
  const on = await cameraAfter('&pfx=conditionVisuals,newBeyVisuals');
  expect(off.errors).toEqual([]);
  expect(on.errors).toEqual([]);
  expect(off.layers).toBeNull();
  expect(on.layers).toEqual(['A', 'B', 'C']);
  expect(on.stats).toMatchObject({ layers: 6 });
  expect(on.camera).toBe(off.camera);
});

test('hybridVfx in a real browser: real effects from real events, screen overlay below the HUD, camera as with the flag off', async ({ browser }) => {
  const run = async (search: string): Promise<{ camera: string; stats: Record<string, number> | null; overlay: string | null; legacyBursts: boolean; errors: string[] }> => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors: string[] = [];
    await openDebugLab(page, search, errors);
    await page.evaluate(async () => {
      const lab = window.__chaosBeyDebugLab!;
      lab.setPaused(true);
      await lab.restart('hybrid-camera-proof');
      const session = lab.getSession()!;
      const hybrid = session.getHybridVfx();
      if (hybrid) {
        const a = session.match.first.body.translation();
        const at = { x: a.x, y: a.y, z: a.z };
        hybrid.onEvents(
          [
            { kind: 'hitResolved', tick: 1, defenderSide: 'second', attackerSide: 'first', magnitude: 0.95, position: at, hitboxKind: 'circular', caughtOpponentDashing: false },
            { kind: 'perfectDodge', tick: 1, side: 'first', magnitude: 0.9, position: at },
            { kind: 'stabilityBroken', tick: 1, side: 'second', magnitude: 0.9, position: at },
          ],
          null as never,
        );
      }
      lab.step(60);
    });
    await page.waitForTimeout(300);
    const result = await page.evaluate(() => {
      const lab = window.__chaosBeyDebugLab!;
      const camera = lab.getCamera();
      const session = lab.getSession()!;
      const overlay = document.querySelector('[data-testid="hybrid-vfx-overlay"]') as HTMLElement | null;
      return {
        camera: JSON.stringify([camera.position.toArray().map((v) => +v.toFixed(5)), camera.fov, camera.children.length]),
        stats: (session.getPresentationStats().hub.perSystem['hybrid-vfx'] ?? null) as Record<string, number> | null,
        overlay: overlay ? getComputedStyle(overlay).zIndex : null,
        legacyBursts: session.getVfxManager().isLayerVisible('impactBursts'),
      };
    });
    await context.close();
    return { ...result, errors };
  };
  const off = await run('&pfx=');
  const on = await run('&pfx=hybridVfx,newBeyVisuals');
  expect(off.errors).toEqual([]);
  expect(on.errors).toEqual([]);
  expect(off.stats).toBeNull();
  expect(off.overlay).toBeNull();
  expect(off.legacyBursts).toBe(true);
  // (The Debug Lab re-applies its own VFX layer toggles on a restart, so the legacy-burst switch is proven on the session in presentationNeutrality.)
  expect(on.overlay).toBe('900');
  expect(on.stats!.fx! + on.stats!.sparks!).toBeGreaterThan(5);
  expect(on.stats!.droppedShake).toBeGreaterThan(0);
  expect(on.camera).toBe(off.camera);
});

test('clashPresentation in a real browser: locked contact, speedlines and dust on a Clash, camera as with the flag off', async ({ browser }) => {
  const run = async (search: string): Promise<{ camera: string; stats: Record<string, number> | null; overlay: string | null; errors: string[] }> => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors: string[] = [];
    await openDebugLab(page, search, errors);
    await page.evaluate(async () => {
      const lab = window.__chaosBeyDebugLab!;
      lab.setPaused(true);
      await lab.restart('clash-camera-proof');
      const system = lab.getSession()!.getClashPresentation();
      if (system) {
        // A Clash that is Active (the real Clash state is not forced: only what the presentation reads is staged).
        const original = system.update.bind(system);
        (system as { update: typeof system.update }).update = (frame) =>
          original({ dtSeconds: frame.dtSeconds, state: frame.state ? { ...frame.state, clash: { phase: 'active', active: true, progress: 0.6, elapsedS: 2.4, firstPower: 1.6, secondPower: 1, firstMashEventCount: 4, secondMashEventCount: 3, resolution: null, cooldownRemainingS: 0 } } : null });
        const state = { tick: 5, round: {}, camera: null } as never;
        system.onEvents([{ kind: 'clashStarted', tick: 5 }, { kind: 'clashProgress', tick: 5, side: 'first', mashEventCount: 1, progress: 0.3 }], state);
      }
      lab.step(30);
    });
    // Software WebGL renders few frames a second: wait until the pose has settled in (the presentation clamps one frame to 50 ms).
    if (search.includes('clashPresentation')) {
      await page.waitForFunction(() => (window.__chaosBeyDebugLab!.getSession()!.getPresentationStats().hub.perSystem['clash-presentation']?.contactWeight ?? 0) >= 1, null, { timeout: 20_000 });
    }
    await page.waitForTimeout(300);
    const result = await page.evaluate(() => {
      const lab = window.__chaosBeyDebugLab!;
      const camera = lab.getCamera();
      const session = lab.getSession()!;
      const overlay = document.querySelector('[data-testid="clash-presentation-overlay"]') as HTMLElement | null;
      return {
        camera: JSON.stringify([camera.position.toArray().map((v) => +v.toFixed(5)), camera.fov, camera.children.length]),
        stats: (session.getPresentationStats().hub.perSystem['clash-presentation'] ?? null) as Record<string, number> | null,
        overlay: overlay ? getComputedStyle(overlay).zIndex : null,
      };
    });
    await context.close();
    return { ...result, errors };
  };
  const off = await run('&pfx=');
  const on = await run('&pfx=clashPresentation,newBeyVisuals');
  expect(off.errors).toEqual([]);
  expect(on.errors).toEqual([]);
  expect(off.stats).toBeNull();
  expect(off.overlay).toBeNull();
  expect(on.overlay).toBe('900');
  expect(on.stats!.contactWeight).toBe(1);
  expect(on.stats!.speedlinesDrawn).toBeGreaterThan(20);
  expect(on.stats!.dust! + on.stats!.grit!).toBeGreaterThan(5);
  expect(on.stats!.poseTiltFirstDeg).toBeGreaterThan(5);
  expect(on.camera).toBe(off.camera);
});

test('clashPresentation at a browser zoom below 100% (dpr 0.75): the speedlines leave no trace once the Clash ends (owner item 4)', async ({ browser }) => {
  // A zoomed-out browser (devicePixelRatio < 1) used to keep the last speedlines on screen: clear() only covered dpr x
  // the canvas. Visual check, so the presentation runs with its flag, not the all-off gameplay baseline.
  const context = await browser.newContext({ deviceScaleFactor: 0.75 });
  const page = await context.newPage();
  const errors: string[] = [];
  await openDebugLab(page, '&pfx=clashPresentation,newBeyVisuals', errors);
  await page.evaluate(async () => {
    const lab = window.__chaosBeyDebugLab!;
    lab.setPaused(true);
    await lab.restart('clash-camera-proof');
    const system = lab.getSession()!.getClashPresentation()!;
    const w = window as unknown as { __stagedClash: boolean };
    w.__stagedClash = true;
    const original = system.update.bind(system);
    (system as { update: typeof system.update }).update = (frame) =>
      original({
        dtSeconds: frame.dtSeconds,
        state: frame.state
          ? {
              ...frame.state,
              clash: w.__stagedClash
                ? { phase: 'active', active: true, progress: 0.6, elapsedS: 2.4, firstPower: 1.6, secondPower: 1, firstMashEventCount: 4, secondMashEventCount: 3, resolution: null, cooldownRemainingS: 0 }
                : { phase: 'idle', active: false, progress: 0.5, elapsedS: 0, firstPower: 0, secondPower: 0, firstMashEventCount: 0, secondMashEventCount: 0, resolution: null, cooldownRemainingS: 0 },
            }
          : null,
      });
    system.onEvents([{ kind: 'clashStarted', tick: 5 }, { kind: 'clashProgress', tick: 5, side: 'first', mashEventCount: 1, progress: 0.3 }], { tick: 5, round: {}, camera: null } as never);
    lab.step(30);
  });
  const paintedPixels = (): Promise<{ dpr: number; size: number[]; painted: number }> =>
    page.evaluate(() => {
      const canvas = document.querySelector('[data-testid="clash-presentation-overlay"] canvas') as HTMLCanvasElement;
      const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      let painted = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i]! > 0) painted++;
      return { dpr: window.devicePixelRatio, size: [canvas.width, canvas.height], painted };
    });
  await page.waitForFunction(() => (window.__chaosBeyDebugLab!.getSession()!.getPresentationStats().hub.perSystem['clash-presentation']?.speedlinesDrawn ?? 0) > 20, null, { timeout: 20_000 });
  const during = await paintedPixels();
  expect(during.dpr).toBe(0.75);
  expect(during.painted).toBeGreaterThan(1000);
  // The Clash ends: the overlay must go fully transparent, to the last device pixel.
  await page.evaluate(() => ((window as unknown as { __stagedClash: boolean }).__stagedClash = false));
  await expect.poll(async () => (await paintedPixels()).painted, { timeout: 20_000 }).toBe(0);
  expect(errors).toEqual([]);
  await context.close();
});

test('arenaVisuals in a real browser: the approved arena art draws, the temporary arena visuals are hidden, camera as with the flag off', async ({ browser }) => {
  const run = async (search: string): Promise<{ camera: string; art: string[]; hiddenHolder: boolean | null; errors: string[] }> => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors: string[] = [];
    await openDebugLab(page, search, errors);
    await page.evaluate(async () => {
      const lab = window.__chaosBeyDebugLab!;
      lab.setPaused(true);
      await lab.restart('arena-camera-proof');
      lab.step(60);
    });
    await page.waitForTimeout(500);
    const result = await page.evaluate(() => {
      const lab = window.__chaosBeyDebugLab!;
      const camera = lab.getCamera();
      const session = lab.getSession()!;
      const root = session.getSceneRoot();
      const holder = root.children.find((c) => c.name === 'discarded-temporary-arena-visuals');
      return {
        camera: JSON.stringify([camera.position.toArray().map((v) => +v.toFixed(5)), camera.fov, camera.children.length]),
        art: root.children.filter((c) => c.name.startsWith('arena-art-')).map((c) => c.name),
        hiddenHolder: holder ? !holder.visible : null,
      };
    });
    await context.close();
    return { ...result, errors };
  };
  const off = await run('&pfx=');
  const on = await run('&pfx=arenaVisuals');
  expect(off.errors).toEqual([]);
  expect(on.errors).toEqual([]);
  expect(off.art).toEqual([]);
  expect(off.hiddenHolder).toBeNull();
  expect(on.art).toEqual(['arena-art-foundry']);
  expect(on.hiddenHolder).toBe(true);
  expect(on.camera).toBe(off.camera);
});
