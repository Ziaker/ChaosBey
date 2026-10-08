import { expect, test } from '@playwright/test';

type LaunchHook = {
  state(): { concept: string; phase: string; dropTarget: { x: number; z: number } };
  setConcept(id: 'A' | 'B' | 'C'): void;
  setDropTarget(x: number, z: number): void;
  reset(): void;
  launchDemo(power?: number, aim?: number): void;
  finalDocumentLocks: {
    approvedConcept: string;
    preserveDualArrivalAnimation: boolean;
    visiblePhysicalLauncher: boolean;
    playerChoosesDropPoint: boolean;
    combatStartsOnFirstBounce: boolean;
    postLandingCountdown: boolean;
  };
};

test('approved Timing Snap lab starts Combat on landing with no post-landing countdown', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });

  await page.goto('/ChaosBey/prototypes/launch-system-concepts/');
  await page.waitForFunction(() => Boolean((window as unknown as { __launchSystemLab?: unknown }).__launchSystemLab));

  const locks = await page.evaluate(() => (window as unknown as { __launchSystemLab: LaunchHook }).__launchSystemLab.finalDocumentLocks);
  expect(locks).toEqual({
    approvedConcept: 'A',
    preserveDualArrivalAnimation: true,
    visiblePhysicalLauncher: true,
    playerChoosesDropPoint: true,
    combatStartsOnFirstBounce: true,
    postLandingCountdown: false,
  });

  await page.evaluate(() => {
    const lab = (window as unknown as { __launchSystemLab: LaunchHook }).__launchSystemLab;
    lab.setConcept('A');
    lab.setDropTarget(5, 8);
    lab.launchDemo();
  });

  // The flight itself is under one second. The rejected build then waited
  // another 3.15 s; the approved build must already be in Combat well before that.
  await page.waitForFunction(
    () => (window as unknown as { __launchSystemLab: LaunchHook }).__launchSystemLab.state().phase === 'combat',
    null,
    { timeout: 2_500 },
  );

  const state = await page.evaluate(() => (window as unknown as { __launchSystemLab: LaunchHook }).__launchSystemLab.state());
  expect(state.concept).toBe('A');
  expect(state.phase).toBe('combat');
  expect(state.dropTarget.x).toBeCloseTo(5, 1);
  expect(state.dropTarget.z).toBeCloseTo(8, 1);
  expect(errors).toEqual([]);
});
