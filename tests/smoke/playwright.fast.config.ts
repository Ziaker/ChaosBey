import { defineConfig } from '@playwright/test';
import base from './playwright.config';
import { SLOW_SPECS } from './slowSpecs';

// The fast smoke set: the whole suite minus the slow specs (see slowSpecs.ts). Same browser, same server, same settings.
export default defineConfig({
  ...base,
  testIgnore: SLOW_SPECS.map((file) => `**/${file}`),
});
