import { expect, test } from '@playwright/test';
import { BASELINE_MENU_URL, baselineUrl } from './presentationBaseline';
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

  await page.goto(baselineUrl('/ChaosBey/?mode=play'));
  const select = page.getByTestId('character-select');
  await expect(select).toBeVisible({ timeout: 15_000 });

  // Nine Beys (owner, Lote 8: a 3×3 grid, a row per family); the first is focused and described.
  await expect(page.getByTestId('character-select-option-attack-prototype')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('character-select-detail')).toContainText('Hits hardest');

  // Keyboard: two steps down (two families) focuses Stamina A; Enter chooses it.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('character-select-option-stamina-prototype')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('character-select-detail')).toContainText('outlasting');
  await page.keyboard.press('Enter');
  await expect(select).toHaveCount(0);

  // Pregame: the explanation follows the choices, from the AI's real numbers.
  const pregame = page.getByTestId('pregame');
  await expect(pregame).toBeVisible();
  await expect(page.getByTestId('pregame-player')).toHaveText('You play STAMINA A');
  await expect(page.getByTestId('pregame-opponent-bey-attack-prototype')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('pregame-ai-level-rival')).toHaveAttribute('aria-checked', 'true');
  const reaction = page.getByTestId('pregame-cap-reaction');
  await expect(reaction).toContainText('0.22 s'); // Attack AI, Rival
  await page.getByTestId('pregame-ai-level-ace').click();
  await expect(reaction).toContainText('0.12 s'); // 0.22 × 0.55
  await expect(page.getByTestId('pregame-ai')).toContainText('Ace');
  // Keyboard from the AI level row (the click focused it): ↓↓↓↓↓ (style, arena, floor, movement) to Match length, ← to a single round.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByTestId('pregame-rounds-1')).toHaveAttribute('aria-checked', 'true');
  // Arena: Rift Crater, then a moved wall slider (custom walls).
  await page.getByTestId('pregame-arena-rift').click();
  await expect(page.getByTestId('pregame-rules')).toContainText('Rift Crater');
  // Advanced rules: a lower wall and a fixed seed.
  await page.getByTestId('pregame-advanced').locator('summary').click();
  await page.getByTestId('pregame-wall-height').fill('0.8');
  await expect(page.getByTestId('pregame-wall-height-value')).toHaveText('0.8 m');
  await expect(page.getByTestId('pregame-rules')).toContainText('Custom walls: 0.8 m high, bounce 0.40');
  // Owner 2026-10-02: the Ring-out delay slider (0-3 s, provisional default 1.5 s) reaches the match.
  await expect(page.getByTestId('pregame-ring-out-delay-value')).toHaveText('1.50 s');
  await page.getByTestId('pregame-ring-out-delay').fill('0.5');
  await expect(page.getByTestId('pregame-ring-out-delay-value')).toHaveText('0.50 s');
  // Owner 2026-10-02 (Lote 2): the Dash cooldown slider (0.5-5 s, provisional default 1.5 s).
  await expect(page.getByTestId('pregame-dash-cooldown-value')).toHaveText('1.50 s');
  await page.getByTestId('pregame-dash-cooldown').fill('2.5');
  await expect(page.getByTestId('pregame-dash-cooldown-value')).toHaveText('2.50 s');
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
      walls: [session.matchConfig.arenaWallHeightM, session.matchConfig.arenaWallRestitution],
      ringOutDelayS: session.matchConfig.ringOutDelayS,
      dashCooldownS: session.matchConfig.dashCooldownS,
    };
  });
  // The pick plays first; the default opponent is the next roster entry (no mirror).
  expect(match.beys).toEqual(['stamina-prototype', 'attack-prototype']);
  expect(match.seed).toBe('flow-seed');
  expect(match.opponent).toBe('AI (archetype, ace)');
  expect(match.walls).toEqual([0.8, 0.4]);
  expect(match.ringOutDelayS).toBe(0.5);
  expect(match.dashCooldownS).toBe(2.5);

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
  await page.goto(baselineUrl('/ChaosBey/?mode=play'));
  await expect(select).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(BASELINE_MENU_URL);
  await expect(page.getByTestId('main-menu')).toBeVisible();

  expect(consoleErrors).toEqual([]);
});
