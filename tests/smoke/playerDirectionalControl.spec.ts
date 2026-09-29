import { expect, test, type Page } from '@playwright/test';

// M11 directional control: ↑/↓/←/→ move the player's Bey that way ON THE
// SCREEN, whatever way the camera looks. Checked in two camera
// orientations (the Debug Lab's high overview, looking -Z, and the game's
// chase camera behind the first Bey), by projecting the Bey's velocity
// through the camera actually on screen.

type Direction = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';

/** The on-screen camera's view and projection matrices right now (what the player aims with when pressing the key). */
async function cameraMatrices(page: Page): Promise<{ view: number[]; proj: number[] }> {
  return page.evaluate(() => {
    const camera = window.__chaosBeyDebugLab!.getCamera();
    camera.updateMatrixWorld();
    return { view: [...camera.matrixWorldInverse.elements], proj: [...camera.projectionMatrix.elements] };
  });
}

/** Screen-space direction (NDC, +y up) of the first Bey's move from `from` to where it is now, through the given camera. */
async function screenDisplacement(page: Page, from: { x: number; y: number; z: number }, matrices: { view: number[]; proj: number[] }): Promise<{ x: number; y: number }> {
  return page.evaluate(({ start, view, proj }) => {
    const lab = window.__chaosBeyDebugLab!;
    const p = lab.getSession()!.getBey('first').body.translation();
    const ndc = (x: number, y: number, z: number): { x: number; y: number } => {
      // view then projection, column-major 4x4
      const vx = view[0]! * x + view[4]! * y + view[8]! * z + view[12]!;
      const vy = view[1]! * x + view[5]! * y + view[9]! * z + view[13]!;
      const vz = view[2]! * x + view[6]! * y + view[10]! * z + view[14]!;
      const vw = view[3]! * x + view[7]! * y + view[11]! * z + view[15]!;
      const cx = proj[0]! * vx + proj[4]! * vy + proj[8]! * vz + proj[12]! * vw;
      const cy = proj[1]! * vx + proj[5]! * vy + proj[9]! * vz + proj[13]! * vw;
      const cw = proj[3]! * vx + proj[7]! * vy + proj[11]! * vz + proj[15]! * vw;
      return { x: cx / cw, y: cy / cw };
    };
    const a = ndc(start.x, p.y, start.z);
    const b = ndc(p.x, p.y, p.z);
    return { x: b.x - a.x, y: b.y - a.y };
  }, { start: from, ...matrices });
}

const nextFrame = (page: Page): Promise<unknown> => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

async function holdAndMeasure(page: Page, key: Direction): Promise<{ x: number; y: number }> {
  const start = await page.evaluate(async () => {
    const lab = window.__chaosBeyDebugLab!;
    await lab.restart('m11-directional-smoke');
    lab.setPaused(true);
    lab.step(40); // land and settle
    // Room in every direction: the player's Bey at the centre, the idle opponent well off the four axes.
    const session = lab.getSession()!;
    const first = session.getBey('first').body;
    const second = session.getBey('second').body;
    first.setTranslation({ x: 0, y: first.translation().y, z: 0 }, true);
    first.setLinvel({ x: 0, y: 0, z: 0 }, true);
    second.setTranslation({ x: 7.5, y: second.translation().y, z: 7.5 }, true);
    second.setLinvel({ x: 0, y: 0, z: 0 }, true);
    lab.step(5);
    return first.translation();
  });
  // Let a frame draw so the camera the player sees is the one this view places.
  await nextFrame(page);
  const matrices = await cameraMatrices(page);
  await page.keyboard.down(key);
  // 1.25 s: long enough for a full turnaround (brake, pivot, go) at the Bey's turn rate.
  await page.evaluate(() => window.__chaosBeyDebugLab!.step(75));
  await page.keyboard.up(key);
  return screenDisplacement(page, start, matrices);
}

test('arrows move the Bey up/down/left/right on screen in two camera orientations', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/ChaosBey/?mode=debug-lab');
  await expect.poll(() => page.evaluate(() => window.__chaosBeyDebugLab?.getSession() != null), { timeout: 20_000 }).toBe(true);
  // Nobody else moving: the opponent idles.
  await page.evaluate(() => window.__chaosBeyDebugLab!.setController('second', { kind: 'idle' }));
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

  for (const view of ['overview', 'game'] as const) {
    await page.evaluate((v) => window.__chaosBeyDebugLab!.setCameraView(v), view);
    const expected: Record<Direction, { axis: 'x' | 'y'; sign: 1 | -1 }> = {
      ArrowUp: { axis: 'y', sign: 1 },
      ArrowDown: { axis: 'y', sign: -1 },
      ArrowLeft: { axis: 'x', sign: -1 },
      ArrowRight: { axis: 'x', sign: 1 },
    };
    for (const key of Object.keys(expected) as Direction[]) {
      const screen = await holdAndMeasure(page, key);
      const { axis, sign } = expected[key];
      const other = axis === 'x' ? 'y' : 'x';
      const label = `${view} ${key}: screen displacement (${screen.x.toFixed(3)}, ${screen.y.toFixed(3)})`;
      expect(screen[axis] * sign, label).toBeGreaterThan(0);
      expect(Math.abs(screen[axis]), label).toBeGreaterThan(Math.abs(screen[other]));
    }
  }

  // The inspector shows the desired input next to the physical heading.
  const desired = await page.evaluate(() => window.__chaosBeyDebugLab!.getSession()!.getLastActions('first')?.moveIntent ?? null);
  expect(desired).not.toBeNull();
  expect(errors).toEqual([]);
});

test('Settings offers Directional (default) and Classic control', async ({ page }) => {
  await page.goto('/ChaosBey/?mode=settings');
  const row = page.getByTestId('settings-control-scheme');
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row.getByRole('radio', { name: 'Directional' })).toHaveAttribute('aria-checked', 'true');
  await row.getByRole('radio', { name: 'Classic' }).click();
  await expect(row.getByRole('radio', { name: 'Classic' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('settings-control-note')).toContainText('Tank steering');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('chaosbey.settings.player.v1') ?? '{}').controlScheme)).toBe('classic');
});
