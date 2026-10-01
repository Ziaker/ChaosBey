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
    expect(run.stats).toMatchObject({ systems: 0, systemErrors: 0 });
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
  expect(after.systemIds).toEqual([]);
  // The restarted session reads the same page flags again.
  expect(Object.values(after.features).every(Boolean)).toBe(true);
  expect(errors).toEqual([]);
});
