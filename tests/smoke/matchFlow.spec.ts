import { expect, test } from '@playwright/test';

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

const MAX_RUN_MS = 30_000;
const PLAYER_TAP_INTERVAL_MS = 300;

test('a real Player-vs-AI match reaches RoundEnd with a real terminal outcome (KO or Ring-Out)', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));

  await page.goto('/ChaosBey/');
  const overlay = page.locator('#debug-overlay-root pre');
  await expect(overlay).toContainText('Combat', { timeout: 15_000 });

  const readOverlay = async (): Promise<string> => (await overlay.textContent()) ?? '';
  const readField = (text: string, label: string): string | null => {
    const line = text.split('\n').find((l) => l.startsWith(label));
    return line ? line.slice(label.length).trim() : null;
  };

  const startedAt = Date.now();
  let sawRoundEnd = false;
  while (Date.now() - startedAt < MAX_RUN_MS) {
    // Same plain "a person would do this" input as tests/smoke/aiRuntime.spec.ts: advance and periodically swing.
    await page.keyboard.down('ArrowUp');
    await page.keyboard.down('z');
    await page.waitForTimeout(50);
    await page.keyboard.up('z');
    await page.waitForTimeout(PLAYER_TAP_INTERVAL_MS - 50);

    const text = await readOverlay();
    if (/^state\s+RoundEnd/m.test(text)) {
      sawRoundEnd = true;
      break;
    }
  }
  await page.keyboard.up('ArrowUp');

  expect(sawRoundEnd, 'the match should reach RoundEnd within the run budget').toBe(true);

  const finalText = await readOverlay();
  const outcome = readField(finalText, 'round');
  console.log(`[matchFlow smoke] terminal outcome: ${outcome}`);
  expect(outcome, 'RoundEnd must carry a real terminal outcome, not left Ongoing').not.toBeNull();
  expect(outcome).not.toBe('Ongoing');
  expect(['FirstWinsByKo', 'SecondWinsByKo', 'FirstWinsByRingOut', 'SecondWinsByRingOut', 'Draw']).toContain(outcome);

  // GDD section 9: no Rematch/Restart flow exists yet — the frozen
  // RoundEnd snapshot (tickMatch's own guard) should hold steady rather
  // than silently resuming or erroring out.
  await page.waitForTimeout(500);
  const laterText = await readOverlay();
  expect(readField(laterText, 'round')).toBe(outcome);
  expect(laterText).not.toContain('SIMULATION HALTED');

  expect(consoleErrors).toEqual([]);
});
