import { expect, test, type Page } from '@playwright/test';
import { GAME_DEFAULTS } from './gameDefaults';

// The normal game (0.16.0): no query string at all. The five approved
// presentation packages are on by default: Character Select shows the same
// approved concept the match uses, the match runs the condition, Hybrid VFX,
// Clash and arena systems, Settings shows the condition languages, a Perfect
// Dodge gets its Hybrid VFX feedback, and leaving and starting matches again
// never piles up systems or scene objects. Nothing here passes ?pfx.

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  return errors;
}

const SYSTEMS = ['flow-fx', 'condition-visuals', 'hybrid-vfx', 'clash-presentation', 'arena-visuals'];

async function matchView(page: Page) {
  return page.evaluate(() => {
    const session = window.__chaosBeyPlay!.getSession()!;
    const root = session.getSceneRoot();
    return {
      features: { ...session.getPresentation().features } as Record<string, boolean>,
      systems: [...session.getPresentation().systemIds()],
      visuals: [session.match.visuals.first.definition.id, session.match.visuals.second.definition.id],
      art: root.children.filter((c) => c.name.startsWith('arena-art-')).map((c) => c.name),
      sceneChildren: root.parent ? root.parent.children.length : -1,
      systemErrors: session.getPresentationStats().hub.systemErrors,
    };
  });
}

test('Character Select previews the concept the match uses, and the match runs the approved packages, with no query string', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = watchErrors(page);
  await page.goto('/ChaosBey/');
  await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('main-menu-play').click();
  await expect(page.getByTestId('character-select')).toBeVisible({ timeout: 20_000 });
  expect(new URL(page.url()).searchParams.has('pfx')).toBe(false);

  const preview = () => page.evaluate(() => window.__chaosBeyPlay!.getPreviewVisualId());
  await expect.poll(preview).toBe('concept:attack-a');
  await page.keyboard.press('ArrowDown');
  await expect.poll(preview).toBe('concept:defense-a');
  await page.keyboard.press('ArrowDown');
  await expect.poll(preview).toBe('concept:stamina-a');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect.poll(preview).toBe('concept:attack-a');
  await page.keyboard.press('Enter');

  await expect(page.getByTestId('pregame')).toBeVisible();
  await page.getByTestId('pregame-start').click();
  await expect.poll(() => page.evaluate(() => window.__chaosBeyPlay?.getSession()?.getTickIndex() ?? 0), { timeout: 30_000 }).toBeGreaterThan(60);

  const first = await matchView(page);
  expect(first.features).toEqual({ newBeyVisuals: true, conditionVisuals: true, hybridVfx: true, clashPresentation: true, newHud: false, arenaVisuals: true });
  expect(first.systems).toEqual(SYSTEMS);
  // The player picked Attack: the match wears the same concept the pedestal showed.
  expect(first.visuals[0]).toBe('concept:attack-a');
  expect(first.visuals[1]).toMatch(/^concept:/);
  expect(first.art).toHaveLength(1);
  expect(first.systemErrors).toBe(0);

  // Leave the match (Pause -> Leave) and start again: same systems, same scene size.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pause-menu')).toBeVisible();
  await page.getByTestId('pause-menu-leave').click();
  await expect(page.getByTestId('pregame')).toBeVisible();
  await page.getByTestId('pregame-start').click();
  await expect.poll(() => page.evaluate(() => window.__chaosBeyPlay?.getSession()?.getTickIndex() ?? 0), { timeout: 30_000 }).toBeGreaterThan(60);
  const second = await matchView(page);
  expect(second.systems).toEqual(SYSTEMS);
  expect(second.art).toHaveLength(1);
  expect(second.sceneChildren).toBe(first.sceneChildren);
  expect(second.systemErrors).toBe(0);
  expect(errors).toEqual([]);
});

test('Settings shows the condition languages with no query string: the default set, any combination, never none, persisted, reset to the default', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/ChaosBey/?mode=settings');
  await expect(page.getByTestId('settings')).toBeVisible({ timeout: 20_000 });
  const on = (id: string) => page.getByTestId(`settings-condition-${id}-true`);
  const off = (id: string) => page.getByTestId(`settings-condition-${id}-false`);
  // The defaults (all three on since 2026-10-04) come from the game, so a changed default does not break this spec.
  const defaults = GAME_DEFAULTS.conditionLayers.map((layer) => layer.toLowerCase());
  for (const id of ['a', 'b', 'c']) await expect(defaults.includes(id) ? on(id) : off(id)).toHaveAttribute('aria-checked', 'true');
  // Start the walk-through from all three on, whatever the default is.
  for (const id of ['a', 'b', 'c']) await on(id).click();
  // A alone.
  await off('b').click();
  await off('c').click();
  await expect(on('a')).toHaveAttribute('aria-checked', 'true');
  await expect(off('b')).toHaveAttribute('aria-checked', 'true');
  await expect(off('c')).toHaveAttribute('aria-checked', 'true');
  // Turning off the last one is refused: at least one always stays on.
  await off('a').click();
  await expect(on('a')).toHaveAttribute('aria-checked', 'true');
  // A + C.
  await on('c').click();
  await expect(on('c')).toHaveAttribute('aria-checked', 'true');
  // Persisted across a reload.
  await page.reload();
  await expect(on('a')).toHaveAttribute('aria-checked', 'true');
  await expect(off('b')).toHaveAttribute('aria-checked', 'true');
  await expect(on('c')).toHaveAttribute('aria-checked', 'true');
  // Reset to defaults.
  await page.getByTestId('settings-reset').click();
  for (const id of ['a', 'b', 'c']) await expect(defaults.includes(id) ? on(id) : off(id)).toHaveAttribute('aria-checked', 'true');
  expect(errors).toEqual([]);
});

test('a Perfect Dodge in the normal game gets its Hybrid VFX feedback, with no contact hit', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  await page.goto('/ChaosBey/?mode=debug-lab');
  await expect.poll(() => page.evaluate(() => window.__chaosBeyDebugLab?.getSession()?.getTickIndex() ?? 0), { timeout: 20_000 }).toBeGreaterThan(30);
  await page.evaluate(async () => {
    const lab = window.__chaosBeyDebugLab!;
    lab.setPaused(true);
    await lab.restart('perfect-dodge-normal');
    const session = lab.getSession()!;
    session.setController('first', { kind: 'idle' });
    session.setController('second', { kind: 'idle' });
    const place = (side: 'first' | 'second', z: number) => {
      const body = session.getBey(side).body;
      body.setTranslation({ x: 0, y: body.translation().y, z }, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    };
    place('first', -0.75);
    place('second', 0.75);
    lab.step(40);
    const events: string[] = [];
    (window as unknown as { __pdEvents: string[] }).__pdEvents = events;
    session.getPresentation().attach({ id: 'pd-probe', onEvents: (batch) => { for (const e of batch) events.push(e.kind === 'hitResolved' ? `hit:${e.defenderSide}` : e.kind); }, dispose: () => undefined });
    // Action enum values (src/input/actions/Action.ts): the dodge and the attack start on the same tick.
    session.forceInput('second', 'sideways dodge', [{ fromTick: 0, held: ['Dodge', 'SteerRight'] as never }, { fromTick: 1, held: [] }], 3);
    session.forceInput('first', 'circular attack', [{ fromTick: 0, held: ['Attack'] as never }, { fromTick: 2, held: [] }], 3);
    lab.step(30);
  });
  await page.waitForTimeout(300);
  const result = await page.evaluate(() => ({
    events: (window as unknown as { __pdEvents: string[] }).__pdEvents,
    hybrid: (window.__chaosBeyDebugLab!.getSession()!.getPresentationStats().hub.perSystem['hybrid-vfx'] ?? null) as Record<string, number> | null,
  }));
  expect(result.events).toContain('perfectDodge');
  expect(result.events).not.toContain('hit:second');
  expect(result.hybrid).not.toBeNull();
  expect(result.hybrid!.droppedSlowMotion).toBeGreaterThan(0); // the Perfect Dodge's request, received and dropped (no time scaling)
  expect(errors).toEqual([]);
});

test('every Dash raises dust in the normal game, a short one included (owner, 2026-10-02)', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  await page.goto('/ChaosBey/?mode=debug-lab');
  await expect.poll(() => page.evaluate(() => window.__chaosBeyDebugLab?.getSession()?.getTickIndex() ?? 0), { timeout: 20_000 }).toBeGreaterThan(30);
  const dust = () => page.evaluate(() => (window.__chaosBeyDebugLab!.getSession()!.getPresentationStats().hub.perSystem['hybrid-vfx'] ?? { dust: -1 }).dust ?? -1);
  await page.evaluate(async () => {
    const lab = window.__chaosBeyDebugLab!;
    lab.setPaused(true);
    await lab.restart('dash-dust-normal');
    const session = lab.getSession()!;
    session.setController('first', { kind: 'idle' });
    session.setController('second', { kind: 'idle' });
    lab.step(30);
  });
  const before = await dust();
  expect(before).toBeGreaterThanOrEqual(0);
  // A short Dash: Attack held just past the tap window (no real charge), then released. Step until it is active,
  // then let real frames draw it (the effects follow the rendered state).
  await page.evaluate(() => {
    const lab = window.__chaosBeyDebugLab!;
    const session = lab.getSession()!;
    session.forceInput('first', 'short dash', [{ fromTick: 0, held: ['Attack'] as never }, { fromTick: 9, held: [] }], 12);
    for (let i = 0; i < 20 && session.getBey('first').attack.getState() !== 'DashActive'; i++) lab.step(1);
  });
  expect(await page.evaluate(() => window.__chaosBeyDebugLab!.getSession()!.getBey('first').attack.getState())).toBe('DashActive');
  await expect.poll(dust, { timeout: 20_000 }).toBeGreaterThan(before);
  expect(errors).toEqual([]);
});
