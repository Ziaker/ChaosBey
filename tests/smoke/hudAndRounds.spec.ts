import { type Page } from '@playwright/test';
import { expect, test } from './support/launchFixture';
import { baselineUrl } from './presentationBaseline';
import { ROUND_WALL_TIMEOUT_MS, describeRun, playRoundToEnd } from './support/playRoundToEnd';
import { GAME_DEFAULTS } from './gameDefaults';

// ============================================================
// COMBAT HUD AND ROUNDS (M10 lane E), production build.
// The HUD shows both sides from the live match, names how a round ended,
// and a "first to 2" match goes round result → round 2 with the score
// carried; control hints follow the setting.
// ============================================================

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  return errors;
}

const widthPercent = async (page: Page, testId: string): Promise<number> => Number.parseFloat((await page.getByTestId(testId).getAttribute('style'))?.match(/width:\s*([\d.]+)%/)?.[1] ?? 'NaN');

test('the HUD reads the live match, a round ends with its banner, and round 2 carries the score', async ({ page }) => {
  test.setTimeout(ROUND_WALL_TIMEOUT_MS + 90_000);
  const errors = watchErrors(page);
  await page.goto(baselineUrl('/ChaosBey/?mode=play'));
  await page.getByTestId('character-select-confirm').click({ timeout: 15_000 });
  await expect(page.getByTestId('pregame-rounds-2')).toHaveAttribute('aria-checked', 'true'); // default: first to 2
  await page.getByTestId('pregame-start').click();
  await expect.poll(() => page.evaluate(() => window.__chaosBeyPlay?.getScreen()), { timeout: 15_000 }).toBe('match');

  // HUD: both cards, round 1, empty pips, start banner, hints on by default.
  const hud = page.getByTestId('combat-hud');
  await expect(hud).toBeVisible();
  await expect(page.getByTestId('hud-first')).toContainText('YOU');
  await expect(page.getByTestId('hud-second')).toContainText('Rival AI');
  await expect(page.getByTestId('hud-round')).toContainText('ROUND 1');
  await expect(page.getByTestId('hud-banner')).toContainText('FIGHT!');
  await expect(page.getByTestId('hud-hints')).toBeVisible();
  // Round-start cue of what the arrows mean (Screen control): on with the hints.
  await expect(page.getByTestId('hud-up-cue')).toBeVisible();
  await expect(page.getByTestId('hud-pips-player').locator('.is-won')).toHaveCount(0);

  // The meters follow the match: Stamina drains from full.
  await expect.poll(() => widthPercent(page, 'hud-first-stamina'), { timeout: 10_000 }).toBeLessThan(100);
  const sessionStamina = await page.evaluate(() => window.__chaosBeyPlay!.getSession()!.getLastResult()!.first.staminaFraction);
  expect(Math.abs((await widthPercent(page, 'hud-first-stamina')) / 100 - sessionStamina)).toBeLessThan(0.05);

  // Owner 2026-10-02 (Lote 2): the old ATK line is the Dash cooldown (CD), full = Dash ready at the start.
  await expect(page.getByTestId('hud-first').locator('.cb-hud__meter--dash-cd .cb-hud__meter-name')).toHaveText('DASH');
  await expect.poll(() => widthPercent(page, 'hud-first-dash-cd'), { timeout: 10_000 }).toBeGreaterThan(99);
  // Owner 2026-10-02 (Lote 3): the momentum line is on both cards and follows the session.
  await expect(page.getByTestId('hud-first-momentum')).toBeAttached();
  await expect(page.getByTestId('hud-second-momentum')).toBeAttached();
  const sessionMomentum = await page.evaluate(() => window.__chaosBeyPlay!.getSession()!.getLastResult()!.first.momentum);
  expect(Math.abs((await widthPercent(page, 'hud-first-momentum')) / 100 - sessionMomentum)).toBeLessThan(0.1);

  // Play round 1 for real.
  await page.keyboard.press('F3');
  const round = await playRoundToEnd(page, page.locator('#debug-overlay-root pre'));
  expect(round.reachedRoundEnd, describeRun(round)).toBe(true);
  await expect(page.getByTestId('hud-banner')).toHaveText(/RING OUT!|K\.O\.!|DRAW/);

  if (round.outcome === 'Draw') {
    // A draw scores nobody: the round result offers the next round with 0 – 0.
    await expect(page.getByTestId('match-results')).toContainText('0 – 0');
  } else {
    // First to 2: after one win the match goes on.
    await expect(page.getByTestId('match-results-headline')).toHaveText(/^ROUND 1: (VICTORY|DEFEAT)$/, { timeout: 10_000 });
  }
  await page.getByTestId('match-results-next-round').click();
  await expect.poll(() => page.evaluate(() => window.__chaosBeyPlay?.getScreen()), { timeout: 15_000 }).toBe('match');
  await expect(page.getByTestId('hud-round')).toContainText('ROUND 2');
  const score = await page.evaluate(() => window.__chaosBeyPlay!.getScore());
  expect(score.rounds).toBe(1);
  await expect(page.getByTestId('hud-pips-player').locator('.is-won')).toHaveCount(score.player);
  await expect(page.getByTestId('hud-pips-opponent').locator('.is-won')).toHaveCount(score.opponent);
  // Round 2 plays its own seed, derived from the match seed.
  const seeds = await page.evaluate(() => ({ match: window.__chaosBeyPlay!.getMatchSeed(), round: window.__chaosBeyPlay!.getSession()!.seedText }));
  expect(seeds.round).toBe(`${seeds.match}/round-2`);

  // Leaving from Pause removes the HUD with the match.
  await page.keyboard.press('Escape');
  await page.getByTestId('pause-menu-leave').click();
  await expect(hud).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('control hints follow the setting', async ({ page }) => {
  const errors = watchErrors(page);
  await page.addInitScript((key) => localStorage.setItem(key, JSON.stringify({ controlHints: false })), GAME_DEFAULTS.settingsStorageKey);
  await page.goto(baselineUrl('/ChaosBey/?mode=play'));
  await page.getByTestId('character-select-confirm').click({ timeout: 15_000 });
  await page.getByTestId('pregame-start').click();
  await expect(page.getByTestId('combat-hud')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('hud-hints')).toBeHidden();
  await expect(page.getByTestId('hud-up-cue')).toBeHidden();
  expect(errors).toEqual([]);
});
