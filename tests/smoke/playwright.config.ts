import { defineConfig, devices } from '@playwright/test';

// Production smoke test (GDD section 115: "build; load; start match; no
// console fatal errors"). Runs against the actual `dist` build served the
// same way GitHub Pages would serve it (under the /ChaosBey/ base), not the
// dev server, so it also catches base-path/asset-loading regressions.
const PORT = 4173;

// GDD section 115/131: browser support isn't assumed just because the
// build compiles — Firefox is a real target, not only Chromium. Opt-in via
// env var rather than always-on: this repo's sandboxed dev containers can't
// download the Firefox binary (network policy), so making it unconditional
// would break the suite there. CI (with real network access) can set this
// once someone verifies a real Firefox run first — see the "Browser
// hardening" note in the M7 alpha-readiness report for why this isn't
// already wired into .github/workflows/deploy.yml.
const INCLUDE_FIREFOX = process.env.CHAOSBEY_PW_INCLUDE_FIREFOX === '1';

export default defineConfig({
  testDir: './',
  timeout: 30_000,
  retries: 0,
  // One page at a time. The prototype labs render with software WebGL in CI
  // and take minutes each; run in parallel they starve each other of CPU
  // (the Bey and VFX lab smokes timed out side by side), and the AI runtime
  // smoke is timing-sensitive too.
  workers: 1,
  use: {
    baseURL: `http://localhost:${PORT}/ChaosBey/`,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Some sandboxed dev containers pin a pre-installed Chromium
        // revision that doesn't match what this @playwright/test version
        // expects and can't download a new one; point at that fixed path
        // via env var in that case instead of failing. CI installs its own
        // browser normally (see .github/workflows/deploy.yml) and leaves
        // this unset.
        launchOptions: process.env.CHAOSBEY_PW_CHROMIUM_PATH ? { executablePath: process.env.CHAOSBEY_PW_CHROMIUM_PATH } : undefined,
      },
    },
    ...(INCLUDE_FIREFOX ? [{ name: 'firefox', use: { ...devices['Desktop Firefox'] } }] : []),
  ],
  webServer: {
    command: `npm run preview -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/ChaosBey/`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
