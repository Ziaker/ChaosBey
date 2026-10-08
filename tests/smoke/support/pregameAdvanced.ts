import type { Page } from '@playwright/test';

/**
 * The Pregame's Advanced section (overhaul, 2026-10-07): closed by default, with one tab per category and only the
 * selected category's controls shown. These helpers open it and select the tab a control lives in, so a spec can then
 * `fill()` / `check()` it like before.
 */
export async function openAdvanced(page: Page): Promise<void> {
  const details = page.getByTestId('pregame-advanced');
  if ((await details.getAttribute('open')) === null) await details.locator('summary').click();
}

export async function openCategory(page: Page, category: string): Promise<void> {
  await openAdvanced(page);
  const tab = page.getByTestId(`pregame-tab-${category}`);
  if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click();
}

/** Opens Advanced and the tab that holds the control `pregame-<id>`; returns its locator. */
export async function showControl(page: Page, id: string) {
  await openAdvanced(page);
  const control = page.getByTestId(`pregame-${id}`);
  const category = await control.evaluate((node) => node.closest<HTMLElement>('[data-category]')?.dataset.category ?? null);
  if (!category) throw new Error(`pregame-${id} is not inside an Advanced category`);
  await openCategory(page, category);
  return control;
}
