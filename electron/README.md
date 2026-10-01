# ChaosBey desktop (local test build)

A thin Electron shell around the real game, for testing on Windows without
a browser, a terminal, `npm`, or a dev server. **Not** the project's
deployment target — that's still the web build on GitHub Pages
(https://ziaker.github.io/ChaosBey/). This exists purely so the owner can
double-click something and play.

## Build it

```bash
npm install          # once
npm run build:exe
```

This runs the same `npm run build` the web deploy uses (`tsc --noEmit &&
vite build`, producing `dist/`) and then packages that exact output with
`electron-builder`. No source file under `src/` or `vite.config.ts` is
touched or built differently for this — the desktop build and the web
build are the same `dist/`.

## What to open

```
release/win-unpacked/ChaosBey.exe
```

`release/win-unpacked/` is a self-contained, portable folder — copy the
whole folder wherever you like (a USB stick, another machine, anywhere);
everything the `.exe` needs (the Electron/Chromium runtime, `dist/`, the
few files in this directory) ships inside it. No installer, no admin
rights, nothing written outside that folder.

(A single-file portable `.exe` — electron-builder's NSIS "portable"
target — was considered and intentionally not used: building it requires
either a Windows machine or Wine, neither available in the environment
that produced this build. The unpacked folder above needs neither and is
the explicitly-accepted fallback. If a true single-file `.exe` is wanted
later, it's a one-line change to `package.json`'s `build.win.target` —
built and tested on an actual Windows machine, not asserted blind.)

## How it works

`main.cjs` is the entire desktop-specific code — a few dozen lines, no
game logic:

1. Starts a tiny local HTTP server (plain Node `http`/`fs`, no
   dependencies) on `127.0.0.1` that serves the packaged `dist/` folder
   under the exact same `/ChaosBey/` path GitHub Pages uses (`vite.config.ts`'s
   `GITHUB_PAGES_BASE`) — the production build's asset URLs are baked in
   under that path, so this is what makes the unmodified `dist/` output
   resolve correctly without a real web server or any path rewriting.
2. Opens one `BrowserWindow` pointed at that local URL.

That's it — no auto-update, no telemetry, no login, no custom menu, no
IPC exposed to the page (`contextIsolation: true`, `nodeIntegration:
false`, `sandbox: true`). Closing the window quits the app and stops the
local server.

## Verified before shipping

Built and run headless (Xvfb + the same Electron binary this packages,
pointed at the actual packaged `resources/app` folder — a real Windows
machine wasn't available in the environment that produced this build, so
this is the closest verification possible here):

- Reaches the Main Menu with no console/page errors.
- `PLAY` reaches Character Select with the real 3D Bey models and arena
  rendering (confirms asset loading and WebGL2).
- A real keyboard event (not just a script call) navigates Bey selection
  — confirms input reaches the page.
- `AudioContext` initializes to `"running"` with no errors.
- The web build (`npm run build` + the existing Playwright smoke suite)
  is unaffected by any of the above.

Not independently re-verified on real Windows hardware — if anything
looks different there (a Windows Defender SmartScreen prompt on first run
for an unsigned `.exe` is expected and normal; click "More info" → "Run
anyway"), that's the one gap this environment couldn't close.
