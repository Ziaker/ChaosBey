import { expect, test } from '@playwright/test';

// ============================================================
// AI RUNTIME SMOKE (MILESTONE 7 PART 2)
// The real runtime path the headless AI tests can't cover: main.ts's
// loop with the AI opponent, hitstop freezes (decided by the camera and
// applied in main.ts, not in tickMatch), Clash presentation, the debug
// overlay, and the fatal-error path. Observed through the Debug Overlay's
// text element (#debug-overlay-root pre, the same element boot.spec.ts
// reads), which is visible on boot (RuntimeConfig.debugOverlayVisibleOnBoot)
// and only refreshes while visible — so this test never presses F3.
//
// Transient states (a hitstop lasts a few frames) are caught by a
// MutationObserver installed in the page, which records flags on every
// overlay update; the test reads the flags at the end instead of polling.
//
// Clash needs both sides attacking within a ~150 ms window. The player
// here taps Z (Circular) periodically to make that possible, but nothing
// in the runtime can force it deterministically, so Clash is asserted only
// if it actually happened — otherwise the run is annotated as not having
// exercised it.
// ============================================================

const MAX_RUN_MS = 25_000;
const PLAYER_TAP_INTERVAL_MS = 300;
/** After a hitstop ends, the fixed-step tick must keep advancing at least this much (~0.5 s). */
const MIN_TICKS_AFTER_HITSTOP = 30;
/** Once a Clash is seen Active, how long to keep running for it to resolve (~4 s presentation). */
const CLASH_RESOLVE_GRACE_MS = 7_000;

interface SmokeFlags {
  hitstopActiveSeen: boolean;
  tickWhenFirstHitstopEnded: number | null;
  clashActiveSeen: boolean;
  clashLeftActive: boolean;
  haltedSeen: boolean;
  gameStates: string[];
  firstTick: number | null;
  lastTick: number | null;
  aiSectionSeen: boolean;
  aiScoresSeen: boolean;
  updates: number;
}

declare global {
  interface Window {
    __aiSmoke?: SmokeFlags;
  }
}

test('AI opponent runs in the real loop through hits, hitstop and (when it happens) Clash, with no fatal or console errors', async ({ page }) => {
  test.setTimeout(60_000);

  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));

  await page.goto('/ChaosBey/');
  const overlay = page.locator('#debug-overlay-root pre');
  await expect(overlay).toContainText('Combat', { timeout: 15_000 });
  await expect(overlay).toBeVisible();

  await page.evaluate(() => {
    const pre = document.querySelector('#debug-overlay-root pre');
    if (!pre) throw new Error('debug overlay text element not found');
    const flags: SmokeFlags = {
      hitstopActiveSeen: false,
      tickWhenFirstHitstopEnded: null,
      clashActiveSeen: false,
      clashLeftActive: false,
      haltedSeen: false,
      gameStates: [],
      firstTick: null,
      lastTick: null,
      aiSectionSeen: false,
      aiScoresSeen: false,
      updates: 0,
    };
    window.__aiSmoke = flags;
    let hitstopWasActive = false;

    const read = (): void => {
      const text = pre.textContent ?? '';
      flags.updates++;
      const tickMatch = /^tick\s+(\d+)/m.exec(text);
      const tick = tickMatch ? Number(tickMatch[1]) : null;
      if (tick !== null) {
        if (flags.firstTick === null) flags.firstTick = tick;
        flags.lastTick = tick;
      }
      // First "state" line is the game state; the Clash section has its own.
      const gameState = /^state\s+(\w+)/m.exec(text)?.[1];
      if (gameState && !flags.gameStates.includes(gameState)) flags.gameStates.push(gameState);
      const clashState = /^state\s+(\w+)/m.exec(text.split('-- clash (M5) --')[1] ?? '')?.[1];
      if (clashState === 'Active') flags.clashActiveSeen = true;
      else if (flags.clashActiveSeen && clashState) flags.clashLeftActive = true;

      const hitstopActive = /^hitstop\s+ACTIVE/m.test(text);
      if (hitstopActive) flags.hitstopActiveSeen = true;
      if (hitstopWasActive && !hitstopActive && flags.tickWhenFirstHitstopEnded === null) flags.tickWhenFirstHitstopEnded = tick;
      hitstopWasActive = hitstopActive;

      if (text.includes('SIMULATION HALTED')) flags.haltedSeen = true;
      if (text.includes('-- ai (second, M7) --') && !text.includes('(no AIController attached)')) flags.aiSectionSeen = true;
      if (/^scores\s+\S/m.test(text)) flags.aiScoresSeen = true;
    };

    new MutationObserver(read).observe(pre, { subtree: true, childList: true, characterData: true });
    read();
  });

  const flags = async (): Promise<SmokeFlags> => (await page.evaluate(() => window.__aiSmoke)) as SmokeFlags;

  const startedAt = Date.now();
  let clashFirstSeenAt: number | null = null;
  while (Date.now() - startedAt < MAX_RUN_MS) {
    // A player tap (Circular) — the same key a person presses.
    await page.keyboard.down('z');
    await page.waitForTimeout(50);
    await page.keyboard.up('z');
    await page.waitForTimeout(PLAYER_TAP_INTERVAL_MS - 50);

    const current = await flags();
    if (current.clashActiveSeen && clashFirstSeenAt === null) clashFirstSeenAt = Date.now();
    const hitstopRecovered =
      current.tickWhenFirstHitstopEnded !== null && (current.lastTick ?? 0) >= current.tickWhenFirstHitstopEnded + MIN_TICKS_AFTER_HITSTOP;
    const roundOver = current.gameStates.includes('RoundEnd');
    const clashSettled = !current.clashActiveSeen || current.clashLeftActive || Date.now() - (clashFirstSeenAt ?? Date.now()) > CLASH_RESOLVE_GRACE_MS;
    if (hitstopRecovered && roundOver && clashSettled) break;
  }

  const result = await flags();
  const clashCoverage = result.clashActiveSeen ? 'Clash exercised (Active seen, then left Active)' : 'Clash NOT exercised in this run';
  test.info().annotations.push({ type: 'coverage', description: clashCoverage });
  console.log(`[aiRuntime smoke] ${clashCoverage}; game states seen: ${result.gameStates.join(', ')}; ticks ${result.firstTick}..${result.lastTick}; overlay updates ${result.updates}`);

  expect(result.updates, 'the observer saw the overlay update').toBeGreaterThan(10);
  expect(result.gameStates).toContain('Combat');
  expect(result.aiSectionSeen, 'AI debug section is live in the real runtime').toBe(true);
  expect(result.aiScoresSeen, 'AI considered-scores line is live').toBe(true);
  expect(result.hitstopActiveSeen, 'at least one real hit froze the simulation (hitstop ACTIVE)').toBe(true);
  expect(result.tickWhenFirstHitstopEnded, 'the hitstop ended').not.toBeNull();
  expect(result.lastTick!, 'the fixed-step loop kept advancing after the hitstop').toBeGreaterThanOrEqual(
    result.tickWhenFirstHitstopEnded! + MIN_TICKS_AFTER_HITSTOP,
  );
  if (result.clashActiveSeen) expect(result.clashLeftActive, 'a Clash that started also resolved (not stuck Active)').toBe(true);
  expect(result.haltedSeen, 'no fatal simulation halt').toBe(false);
  expect(consoleErrors).toEqual([]);
});
