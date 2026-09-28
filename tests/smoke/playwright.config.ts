import { defineConfig, devices } from '@playwright/test';

// Production smoke test (GDD section 115: "build; load; start match; no
// console fatal errors"). Runs against the actual `dist` build served the
// same way GitHub Pages would serve it (under the /ChaosBey/ base), not the
// dev server, so it also catches base-path/asset-loading regressions.
const PORT = 4173;

// GDD section 115/131/133: browser support isn't assumed just because the
// build compiles — Firefox is a real target, not only Chromium. Opt-in via
// env var rather than always-on: this repo's sandboxed dev containers can't
// download the Firefox binary (network policy), so making it unconditional
// would break the suite there. CI sets it in its own parallel Firefox job
// (.github/workflows/deploy.yml, job smoke-firefox).
const INCLUDE_FIREFOX = process.env.CHAOSBEY_PW_INCLUDE_FIREFOX === '1';

// Firefox runs the game's own smokes only. The prototype labs are isolated
// approval pages, not the product, and render minutes of software WebGL
// each; they stay Chromium-only so the Firefox job doesn't double CI time.
const GAME_SMOKE_SPECS = /(^|\/)(boot|inputFocusLoss|matchFlow|repeatedMatchStability|aiRuntime|debugLab|selfTest|webgl2Unavailable)\.spec\.ts$/;

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
    ...(INCLUDE_FIREFOX
      ? [
          {
            name: 'firefox',
            testMatch: GAME_SMOKE_SPECS,
            use: {
              ...devices['Desktop Firefox'],
              // CI runners have no GPU, and headless Firefox blocklists
              // software WebGL2 there ("AllowWebgl2:false restricts context
              // creation on this system"), which three.js needs, so the game
              // never boots. force-enabled lifts that blocklist for the test
              // browser only; the game and the smokes are unchanged. (CI also
              // runs this project headed on xvfb with Mesa software GL, since
              // headless Firefox has no GL driver there — see deploy.yml.)
              launchOptions: { firefoxUserPrefs: { 'webgl.force-enabled': true } },
            },
          },
        ]
      : []),
  ],
  webServer: {
    command: `npm run preview -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/ChaosBey/`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
