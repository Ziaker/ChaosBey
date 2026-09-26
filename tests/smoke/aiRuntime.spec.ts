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

// ------------------------------------------------------------
// M7 Part 2b: a second, independent runtime check. The test above covers
// hitstop, thaw, Clash and the fatal path; this one runs a fixed amount of
// SIMULATED time (read from the overlay's own tick counter — the fixed-step
// loop caps catch-up, so wall-clock time is unreliable under load) and
// checks what the AI rendered: several intents, real attack/dodge presses,
// all-candidate scores, the observed vs. aim target line, and no NaN.
// ------------------------------------------------------------

/** 10 simulated seconds at the fixed 60 Hz step. */
const SIMULATED_TICKS = 600;

test('AI opponent decides, explains and acts over 600 simulated ticks — intents, actions, scores, aim, finite values (M7 Part 2b)', async ({ page }) => {
  test.setTimeout(90_000);
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));

  await page.goto('/ChaosBey/');
  const overlay = page.locator('#debug-overlay-root pre');
  await expect(overlay).toContainText('-- ai (second, M7) --', { timeout: 15_000 });

  await page.evaluate(() => {
    const root = document.getElementById('debug-overlay-root');
    if (!root) throw new Error('debug overlay root missing');
    const snapshots: string[] = [];
    (window as unknown as { __aiOverlaySnapshots: string[] }).__aiOverlaySnapshots = snapshots;
    const capture = () => {
      const text = root.querySelector('pre')?.textContent ?? '';
      if (snapshots[snapshots.length - 1] !== text) snapshots.push(text);
    };
    new MutationObserver(capture).observe(root, { subtree: true, childList: true, characterData: true });
    capture();
  });

  // 10 s of SIMULATED play, read from the overlay's own tick counter —
  // not wall-clock time: FixedTimestepLoop caps catch-up, so on a loaded
  // machine (software WebGL, other tests in parallel) 10 real seconds can
  // be far fewer simulated ones.
  const readTick = () =>
    page.evaluate(() => {
      const match = /tick\s+(\d+)/.exec(document.querySelector('#debug-overlay-root pre')?.textContent ?? '');
      return match ? Number(match[1]) : -1;
    });
  const startTick = await readTick();
  expect(startTick).toBeGreaterThanOrEqual(0);
  await expect.poll(readTick, { timeout: 70_000, intervals: [500] }).toBeGreaterThanOrEqual(startTick + SIMULATED_TICKS);

  const snapshots = await page.evaluate(() => (window as unknown as { __aiOverlaySnapshots: string[] }).__aiOverlaySnapshots);
  expect(snapshots.length).toBeGreaterThan(20);

  const field = (text: string, label: string): string | null => {
    const line = text.split('\n').find((l) => l.startsWith(label));
    return line ? line.slice(label.length).trim() : null;
  };
  const aiSections = snapshots.map((text) => text.slice(text.indexOf('-- ai (second, M7) --'))).filter((text) => text.startsWith('-- ai'));
  expect(aiSections.length).toBe(snapshots.length);

  const activeIntents = new Set(aiSections.map((text) => field(text, 'active intent')?.split(' ')[0]).filter(Boolean));
  const actions = new Set(aiSections.map((text) => field(text, 'action')).filter(Boolean));
  const scoredLines = aiSections.map((text) => field(text, 'scores')).filter((line) => line && /\d\.\d\d/.test(line));
  const reactionTimers = aiSections.map((text) => Number.parseFloat(field(text, 'reaction timer') ?? 'NaN'));

  // Decides: more than one intent over the run.
  expect(activeIntents.size, `intents seen: ${[...activeIntents].join(', ')}`).toBeGreaterThanOrEqual(3);
  // Acts: at least one real attack/dodge press or charge, not only movement.
  expect(
    [...actions].some((a) => a === 'begin attack' || a === 'tap circular' || a === 'charging dash' || a === 'dodge'),
    `actions seen: ${[...actions].join(', ')}`,
  ).toBe(true);
  // Explains: considered scores and the observed/aim target are rendered (GDD section 65).
  expect(scoredLines.length).toBeGreaterThan(0);
  expect(aiSections.every((text) => field(text, 'target / aim')?.startsWith('observed (') ?? false)).toBe(true);
  // Prediction is its own line: a real predicted position at the default difficulty, never folded into observed/aim.
  expect(aiSections.every((text) => field(text, 'prediction') !== null)).toBe(true);
  expect(aiSections.some((text) => /^\(-?\d+\.\d, -?\d+\.\d\) in \d\.\d\d s, trusted x\d\.\d\d$/.test(field(text, 'prediction') ?? ''))).toBe(true);
  expect(aiSections.every((text) => field(text, 'late reaction') !== null)).toBe(true);
  // Never renders a broken number.
  expect(reactionTimers.every((value) => Number.isFinite(value))).toBe(true);
  for (const text of aiSections) {
    expect(text).not.toMatch(/NaN|Infinity/);
  }

  expect(consoleErrors).toEqual([]);
});
