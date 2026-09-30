import { expect, test, type Page } from '@playwright/test';

// Owner playtest (after M11): after WIN / LOSE / DRAW the result's own
// continue action (Next round, or Rematch at the end of the match) runs by
// itself after 4 s, with a visible countdown; pressing it continues at once;
// "Stop auto" keeps the result on screen. Outcomes are forced here by
// putting a Bey past the ring-out line (the round ends through the normal
// ring-out rule), so every case is covered on every run.

type Side = 'first' | 'second';

async function ringOut(page: Page, sides: Side[]): Promise<void> {
  await page.evaluate((list) => {
    const s = window.__chaosBeyPlay!.getSession()!;
    for (const side of list) s.getBey(side).body.setTranslation({ x: side === 'first' ? 16 : -16, y: 2, z: 0 }, true);
  }, sides);
}

const screen = (page: Page) => page.evaluate(() => window.__chaosBeyPlay?.getScreen());
const score = (page: Page) => page.evaluate(() => window.__chaosBeyPlay!.getScore());

async function waitForMatch(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.__chaosBeyPlay?.getScreen() === 'match' && window.__chaosBeyPlay.getSession() != null), { timeout: 20_000 }).toBe(true);
  await page.waitForTimeout(300);
}

test('WIN, LOSE and DRAW auto-continue after 4 s; Continue is immediate; Stop keeps the result; MatchEnd auto-rematches', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/ChaosBey/?mode=play');
  await page.getByTestId('character-select').waitFor({ timeout: 20_000 });
  await page.keyboard.press('Enter');
  await page.getByTestId('pregame-start').click();
  await waitForMatch(page);
  const results = page.getByTestId('match-results');
  const countdown = page.getByTestId('match-results-countdown');

  // Round 1 — WIN (RoundEnd): nothing pressed, the next round starts 4 s after the result appears.
  await ringOut(page, ['second']);
  await expect(page.getByTestId('match-results-headline')).toHaveText('ROUND 1: VICTORY', { timeout: 10_000 });
  const shownAt = Date.now();
  await expect(countdown).toHaveText(/^Next round in [34]\.\d s$/);
  await expect.poll(() => screen(page), { timeout: 8000, intervals: [100] }).toBe('match');
  const autoAfterS = (Date.now() - shownAt) / 1000;
  expect(autoAfterS).toBeGreaterThan(3.3);
  expect(autoAfterS).toBeLessThan(5.5);
  await expect(page.getByTestId('hud-round')).toContainText('ROUND 2');
  expect(await score(page)).toMatchObject({ player: 1, opponent: 0, rounds: 1 });

  // Round 2 — LOSE: Next round pressed at once continues at once.
  await waitForMatch(page);
  await ringOut(page, ['first']);
  await expect(page.getByTestId('match-results-headline')).toHaveText('ROUND 2: DEFEAT', { timeout: 10_000 });
  const pressedAt = Date.now();
  await page.getByTestId('match-results-next-round').click();
  await expect.poll(() => screen(page), { timeout: 5000, intervals: [50] }).toBe('match');
  expect((Date.now() - pressedAt) / 1000).toBeLessThan(2);
  expect(await score(page)).toMatchObject({ player: 1, opponent: 1, rounds: 2 });

  // Round 3 — DRAW: Stop auto keeps the result up past 4 s; the score is unchanged (draws score nobody).
  await waitForMatch(page);
  await ringOut(page, ['first', 'second']);
  await expect(page.getByTestId('match-results-headline')).toHaveText(/^ROUND 3: DRAW/, { timeout: 10_000 });
  await page.getByTestId('match-results-stop-auto').click();
  await expect(countdown).toHaveText('Auto-continue stopped');
  await page.waitForTimeout(5500);
  expect(await screen(page)).toBe('round-result');
  await expect(results).toBeVisible();
  expect(await score(page)).toMatchObject({ player: 1, opponent: 1, rounds: 3 });
  await page.getByTestId('match-results-next-round').click();
  await expect.poll(() => screen(page), { timeout: 5000 }).toBe('match');

  // Round 4 — WIN takes the match (MatchEnd): the final result's Rematch runs by itself after 4 s.
  await waitForMatch(page);
  await ringOut(page, ['second']);
  await expect(page.getByTestId('match-results-headline')).toHaveText('VICTORY', { timeout: 10_000 });
  await expect(countdown).toHaveText(/^Rematch in [34]\.\d s$/);
  const finalAt = Date.now();
  await expect.poll(() => screen(page), { timeout: 8000, intervals: [100] }).toBe('match');
  expect((Date.now() - finalAt) / 1000).toBeGreaterThan(3.3);
  await expect(page.getByTestId('hud-round')).toContainText('ROUND 1');
  expect(await score(page)).toMatchObject({ player: 0, opponent: 0, rounds: 0 });
  expect(errors).toEqual([]);
});
