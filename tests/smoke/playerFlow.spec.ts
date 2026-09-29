import { expect, test } from '@playwright/test';
import { ROUND_WALL_TIMEOUT_MS, describeRun, playRoundToEnd } from './support/playRoundToEnd';

// ============================================================
// PLAYER FLOW (M10): Character Select → Pregame → match → Results →
// Rematch / Main Menu, in the production build. What the player picks is
// what the match really builds, and every exit leaves the page clean.
// ============================================================

test('Character Select and Pregame set up the match that really runs, and Results leads to a rematch and the menu', async ({ page }) => {
  test.setTimeout(ROUND_WALL_TIMEOUT_MS + 90_000);
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));

  await page.goto('/ChaosBey/?mode=play');
  const select = page.getByTestId('character-select');
  await expect(select).toBeVisible({ timeout: 15_000 });

  // Three Beys; the first is focused and described.
  await expect(page.getByTestId('character-select-option-attack-prototype')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('character-select-detail')).toContainText('Hits hardest');

  // Keyboard: two steps down focuses Stamina; Enter chooses it.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('character-select-option-stamina-prototype')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('character-select-detail')).toContainText('outlasting');
  await page.keyboard.press('Enter');
  await expect(select).toHaveCount(0);

  // Pregame: the explanation follows the choices, from the AI's real numbers.
  const pregame = page.getByTestId('pregame');
  await expect(pregame).toBeVisible();
  await expect(page.getByTestId('pregame-player')).toHaveText('You play STAMINA');
  await expect(page.getByTestId('pregame-opponent-bey-attack-prototype')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('pregame-ai-level-rival')).toHaveAttribute('aria-checked', 'true');
  const reaction = page.getByTestId('pregame-cap-reaction');
  await expect(reaction).toContainText('0.22 s'); // Attack AI, Rival
  await page.getByTestId('pregame-ai-level-ace').click();
  await expect(reaction).toContainText('0.12 s'); // 0.22 × 0.55
  await expect(page.getByTestId('pregame-ai')).toContainText('Ace');
  // Keyboard from the AI level row (the click focused it): ↓↓ to Match length, ← to a single round.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByTestId('pregame-rounds-1')).toHaveAttribute('aria-checked', 'true');
  // Advanced rules: a fixed seed.
  await page.getByTestId('pregame-advanced').locator('summary').click();
  await page.getByTestId('pregame-seed').fill('flow-seed');
  await expect(page.getByTestId('pregame-rules')).toContainText('Fixed seed "flow-seed"');
  await page.getByTestId('pregame-start').click();

  await expect(pregame).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__chaosBeyPlay?.getScreen()), { timeout: 15_000 }).toBe('match');
  const match = await page.evaluate(() => {
    const play = window.__chaosBeyPlay!;
    const session = play.getSession()!;
    return {
      beys: [session.getBey('first').definition.id, session.getBey('second').definition.id],
      seed: session.seedText,
      opponent: session.describeController('second'),
    };
  });
  // The pick plays first; the default opponent is the next roster entry (no mirror).
  expect(match.beys).toEqual(['stamina-prototype', 'attack-prototype']);
  expect(match.seed).toBe('flow-seed');
  expect(match.opponent).toBe('AI (archetype, ace)');

  // Play the round for real (F3 shows the overlay the helper reads).
  await page.keyboard.press('F3');
  const overlay = page.locator('#debug-overlay-root pre');
  await expect(overlay).toContainText('Combat');
  const round = await playRoundToEnd(page, overlay);
  expect(round.reachedRoundEnd, describeRun(round)).toBe(true);

  const results = page.getByTestId('match-results');
  await expect(results).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('match-results-headline')).toHaveText(/^(VICTORY|DEFEAT|DRAW)$/);
  await expect(page.getByTestId('match-results-rematch')).toBeFocused();

  // Rematch: a new match, same setup; the fixed seed replays the same opening.
  await page.getByTestId('match-results-rematch').click();
  await expect(results).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__chaosBeyPlay?.getScreen()), { timeout: 15_000 }).toBe('match');
  const rematch = await page.evaluate(() => {
    const session = window.__chaosBeyPlay!.getSession()!;
    return { first: session.getBey('first').definition.id, seed: session.seedText };
  });
  expect(rematch).toEqual({ first: 'stamina-prototype', seed: 'flow-seed' });

  // Esc on Character Select goes back to the Main Menu.
  await page.goto('/ChaosBey/?mode=play');
  await expect(select).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\/ChaosBey\/$/);
  await expect(page.getByTestId('main-menu')).toBeVisible();

  expect(consoleErrors).toEqual([]);
});
