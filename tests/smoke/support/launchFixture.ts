// The Launch System A (0.61.0) starts every round of the player flow with a launch the player makes: the entry point, then one
// press of LAUNCH. A browser spec that is about something else (the HUD, the settings, a whole match) still has to get past it,
// so this `test` presses the real on-screen LAUNCH button the moment it can be pressed, in every page it opens — the same click
// a player makes, through the real launch (the marker, the release, both Beys arriving). A spec about the launch itself turns it
// off with `test.use({ autoLaunch: false })` and drives the launch by hand.

import { expect, test as base } from '@playwright/test';

/** Presses LAUNCH whenever it is pressable. Runs inside the page. */
const AUTO_LAUNCH = `
  setInterval(() => {
    const button = document.querySelector('[data-testid="launch-button"]');
    if (button && !button.disabled) button.click();
  }, 40);
`;

export const test = base.extend<{ autoLaunch: boolean }>({
  autoLaunch: [true, { option: true }],
  page: async ({ page, autoLaunch }, use) => {
    if (autoLaunch) await page.addInitScript(AUTO_LAUNCH);
    await use(page);
  },
});

export { expect };
