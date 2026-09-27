import { expect, test } from '@playwright/test';
import { ROUND_WALL_TIMEOUT_MS, describeRun, overlayField, playRoundToEnd } from './support/playRoundToEnd';

// ============================================================
// MATCH FLOW — REAL RUNTIME (M7 ALPHA-READINESS HARDENING)
// GDD section 9: Combat and RoundEnd are the only two real top-level states
// wired today (no MainMenu/CharacterSelect/PregameSetup/MatchEnd/Rematch
// yet — main.ts boots straight into Combat, and tickMatch freezes the
// snapshot once RoundState is over; there is no restart short of a page
// reload). This smoke confirms that one full Combat -> RoundEnd cycle
// resolves in the real browser loop with a real terminal outcome (a KO or
// a Ring-Out, not left "Ongoing"), the same way the headless deterministic
// suite already proves for tickMatch() alone (tests/deterministic/ai*.ts).
// ============================================================

test('a real Player-vs-AI match reaches RoundEnd with a real terminal outcome (KO or Ring-Out)', async ({ page }) => {
  // The round is budgeted in simulated time (see playRoundToEnd.ts); the
  // timeout covers a worst-case round plus boot.
  test.setTimeout(ROUND_WALL_TIMEOUT_MS + 45_000);
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));

  await page.goto('/ChaosBey/');
  const overlay = page.locator('#debug-overlay-root pre');
  await expect(overlay).toContainText('Combat', { timeout: 15_000 });

  const readOverlay = async (): Promise<string> => (await overlay.textContent()) ?? '';

  // Same plain "a person would do this" input as tests/smoke/aiRuntime.spec.ts: advance and periodically swing.
  const round = await playRoundToEnd(page, overlay);
  console.log(`[matchFlow smoke] ${describeRun(round)}`);
  expect(round.reachedRoundEnd, `the match should reach RoundEnd within the run budget (${describeRun(round)})`).toBe(true);

  const finalText = await readOverlay();
  const outcome = overlayField(finalText, 'round');
  console.log(`[matchFlow smoke] terminal outcome: ${outcome}`);
  expect(outcome, 'RoundEnd must carry a real terminal outcome, not left Ongoing').not.toBeNull();
  expect(outcome).not.toBe('Ongoing');
  expect(['FirstWinsByKo', 'SecondWinsByKo', 'FirstWinsByRingOut', 'SecondWinsByRingOut', 'Draw']).toContain(outcome);

  // GDD section 9: no Rematch/Restart flow exists yet — the frozen
  // RoundEnd snapshot (tickMatch's own guard) should hold steady rather
  // than silently resuming or erroring out.
  await page.waitForTimeout(500);
  const laterText = await readOverlay();
  expect(overlayField(laterText, 'round')).toBe(outcome);
  expect(laterText).not.toContain('SIMULATION HALTED');

  expect(consoleErrors).toEqual([]);
});
