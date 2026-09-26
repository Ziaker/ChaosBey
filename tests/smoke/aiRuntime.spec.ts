import { expect, test } from '@playwright/test';

/** 10 simulated seconds at the fixed 60 Hz step. */
const SIMULATED_TICKS = 600;

// Milestone 7 runtime check in a real browser: the production build's
// AIController (opponent) plays against an idle keyboard player while a
// MutationObserver records every Debug Overlay update. Proves, from what
// the overlay actually rendered (GDD section 65), that the AI decides,
// explains its decisions (scores, reasons), acts (attack/dodge/movement)
// and never renders a non-finite value — with no console errors.
test('AI opponent decides, explains and acts in the real game loop (Debug Overlay via MutationObserver)', async ({ page }) => {
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
  // Explains: considered scores are rendered (GDD section 65).
  expect(scoredLines.length).toBeGreaterThan(0);
  // Never renders a broken number.
  expect(reactionTimers.every((value) => Number.isFinite(value))).toBe(true);
  for (const text of aiSections) {
    expect(text).not.toMatch(/NaN|Infinity/);
  }

  expect(consoleErrors).toEqual([]);
});
