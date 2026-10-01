import { expect, test } from '@playwright/test';

// Presentation foundation: the ?pfx= development flags reach a real session in
// the production build, change nothing a player can see or the simulation does,
// and leave no console error. Nothing is attached behind any flag yet, so the
// hub runs empty; the point is that flags on, flags off and a typo all play the
// same match and the legacy placeholder visuals stay in place.

async function playQuickMatch(page: import('@playwright/test').Page, search: string): Promise<{ stats: unknown; visuals: unknown; errors: string[] }> {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));

  await page.goto(`/ChaosBey/?mode=play&quick&seed=presentation-flags${search}`);
  await expect.poll(() => page.evaluate(() => window.__chaosBeyPlay?.getScreen()), { timeout: 15_000 }).toBe('match');
  await expect.poll(() => page.evaluate(() => window.__chaosBeyPlay?.getSession()?.getTickIndex() ?? 0), { timeout: 15_000 }).toBeGreaterThan(120);

  const result = await page.evaluate(() => {
    const session = window.__chaosBeyPlay!.getSession()!;
    return {
      stats: session.getPresentationStats().hub,
      visuals: [session.match.visuals.first.definition.id, session.match.visuals.second.definition.id],
      features: session.getPresentation().features,
    };
  });
  return { stats: result.stats, visuals: { ids: result.visuals, features: result.features }, errors };
}

test('?pfx=all, no flags and a mistyped flag all start the same match with the placeholder visuals and no console errors', async ({ browser }) => {
  const runs: Awaited<ReturnType<typeof playQuickMatch>>[] = [];
  for (const search of ['', '&pfx=all', '&pfx=notAFeature']) {
    const context = await browser.newContext();
    const page = await context.newPage();
    runs.push(await playQuickMatch(page, search));
    await context.close();
  }

  for (const run of runs) {
    expect(run.errors).toEqual([]);
    expect(run.stats).toMatchObject({ systems: 0, systemErrors: 0 });
    expect((run.visuals as { ids: string[] }).ids).toEqual(['placeholder:attack-prototype', 'placeholder:defense-prototype']);
  }
  const flags = runs.map((run) => (run.visuals as { features: Record<string, boolean> }).features);
  expect(Object.values(flags[0]!).some(Boolean)).toBe(false);
  expect(Object.values(flags[1]!).every(Boolean)).toBe(true);
  expect(Object.values(flags[2]!).some(Boolean)).toBe(false);
});
