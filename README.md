# ChaosBey

A browser-based 3D spinning-top arena combat simulator, built with Three.js, Rapier 3D and Vite, deployed to GitHub Pages.

**Play it:** https://ziaker.github.io/ChaosBey/ — every merge to `main` is built, tested and deployed there automatically.

**Version:** 0.14.1 (`package.json`). The game shows its version and the commit it was built from in the bottom-right corner of every screen (e.g. `v0.14.1 · 8d51f79`); if it doesn't match the latest `main`, reload with Ctrl+Shift+R (GitHub Pages caches the page for a few minutes).

**Standing rule (every change, no exceptions):** each PR that changes the game, its rules, its content or its tooling must (1) bump the version in `package.json` (and `package-lock.json`) — patch for fixes, minor for features/gameplay/content changes — so the number in the corner of the game moves, and (2) update this README (the **Version** line above and the **Status** / **Latest changes** notes below). A unit test (`tests/unit/versionSync.test.ts`) fails if `package.json`, `package-lock.json` and this README disagree. The rule is also written in `CLAUDE.md` (§4), `docs/design-decisions/README.md` and the PR template.

The authoritative design specification and AI-agent operating contract lives in the project's master design document (provided to development agents out-of-band). Every meaningful design decision in this codebase traces back to it — when this README and that document disagree, the document wins.

## Canonical design decisions

Before reopening any visual/design question, read [`docs/design-decisions/README.md`](docs/design-decisions/README.md). For visual prototypes and approvals, the mandatory entry point is [`docs/design-decisions/VISUAL_APPROVALS_MASTER.md`](docs/design-decisions/VISUAL_APPROVALS_MASTER.md).

Where each visual prototype stands today and how it plugs into the game (flags, events, registries) is in [`docs/planning/PROTOTYPE_INTEGRATION_MAP.md`](docs/planning/PROTOTYPE_INTEGRATION_MAP.md).

Those documents distinguish **prototyped**, **approved** and **integrated** work and record later owner overrides over older snapshots. In particular, all **9 approved Bey concepts are selectable/playable**; older text that says to choose only three final Beys is superseded on that point.

## Latest changes

- **0.14.1 — Camera follows the bigger arena:** the in-game camera's eye limit (was 10.5 m from the centre) and its ring-out watch radius (was 9 m) were tuned for the 12 m arena and kept the view stuck near the middle of the 36 m one. They now derive from the floor and ring-out radii (eye limit 34.5 m, watch radius 33 m), so fights near the rim are followed from behind as before. Camera presets, framing behaviour and controls are otherwise unchanged. Details: [`docs/ai/camera-arena-scale.md`](docs/ai/camera-arena-scale.md).
- **0.14.0 — Approved arena art (visual batch 5):** Foundry Pit, Rift Crater and Tournament Stadium art behind the `arenaVisuals` presentation flag, **off by default**, built on the real floor profile and fitted to the 36 m stage (horizontal footprint x3, real-size walls/posts/seats, more copies at the same spacing, light rigs and sky scaled as a whole so the whole floor is lit). Colliders, camera and gameplay untouched. Still open (owner): default arena, final names/palettes. Screenshots: `docs/ai/arena-visuals-36m/`.
- **0.13.0 — Clash Overdrive presentation (visual batch 4):** the approved Overdrive Clash look (contact pose, speedlines, contact dust/sparks, mash pulses, resolution flash, arena contact light) ships behind the `clashPresentation` presentation flag, **off by default**; gameplay and camera untouched. Still open (owner): tie style, entry slow motion / per-mash hitstop, Clash shake, the "overdrive" bar style.
- **0.12.0 — Arena scale pass:** the stage is 3x wider (floor radius 12 m -> 36 m) and no longer flat: the default floor is a smooth bowl whose centre is 2.5 m below the rim. Ring-out radius 36.9 m, 96 wall segments. Known follow-ups (owner decisions): the in-game camera is still tuned for 12 m, and rounds are longer on the bigger stage. Details: [`docs/ai/arena-scale-pass.md`](docs/ai/arena-scale-pass.md).

## Status

Milestones 0–11 are merged and playable end to end, plus several rounds of owner playtest fixes on top (camera, movement/drift, jump height, input buffering, desktop packaging — see `docs/ai/*.md` and the git history for the detailed trail). This is a full match loop, not a prototype:

- **Movement & physics:** force/response-based movement on real Rapier 3D rigid bodies (no position/velocity snapping) — steering inertia, lateral/longitudinal grip and slip, wall/floor bounce with restitution, Bey-vs-Bey collision, a hop → drift → recover cycle (tap `X` for a small hop, hold + steer to drift), a variable-height jump (tap vs. hold shapes short/medium/full height), and a visual spin/tilt/wobble layer decoupled from the physics body's own (locked) rotation.
- **Combat:** Attack (`Z`, with a Dash Attack charge), Dodge (`C`, including Perfect Dodge), Knockback (impulse-based, reacts to Attack/Defense/Stability/approach angle), Stamina and Stability (with a Stability Break state), ring-out and KO win conditions, and a Clash (simultaneous-attack) mini-mechanic with its own mash-based resolution.
- **AI:** a full opponent AI (`src/ai/`) with per-archetype personalities and selectable difficulty tiers, used both in the Pregame Simulator and the headless Self Test batches.
- **Camera:** a single, data-driven `CameraDirector` (`src/camera/director/`) with three owner-approved presets (A/B/C, picked in Settings) — dynamic, opponent-focused framing, automatic orbit and side switching, context modes for high speed/close combat/knockback/Clash/ring-out/finisher. See `docs/design-decisions/camera-approval.md`.
- **Presentation:** a player flow (Main Menu → Character Select → Pregame Simulator → rounds → Results), a combat HUD (Stamina/Stability/Clash bars), VFX (impact bursts, speed lines, drift skid marks/sparks), gamepad support, Settings (quality, camera preset, shake, pause-on-focus-loss), and three selectable arena floors (flat + bowls A/B/C, both visually and physically — see `docs/design-decisions/visual-prototypes-approval.md`).
- **Tooling:** a Debug Lab (raw-state inspector, pause/step/speed, live controller switching, scenario presets, replay recording/playback), a browser Self Test (headless AI-vs-AI batches with an anomaly detector), deterministic replays (GDD/M9: a full match replays bit-for-bit from recorded inputs), and portable desktop test builds for Windows and macOS (see below).

Not yet done / still genuinely open: a final Combat HUD visual design, final per-Bey particle/trail identity (only per-archetype exists today), the full 4-piece Bey mesh (a 3-piece engineering placeholder ships today), Intro/Launch presentation, and the other items tracked in `docs/design-decisions/OWNER_DECISIONS_MASTER.md` §13. That file (read via `docs/design-decisions/README.md` first) is the up-to-date source for "what's still pending" — this README summarizes, it doesn't replace it.

## Development

```bash
npm install
npm run dev        # local dev server
npm run typecheck
npm test           # unit tests (Vitest)
npm run build      # production build to dist/
npm run preview    # serve the production build locally, under /ChaosBey/
npm run test:smoke # Playwright smoke test against the production build
```

Smoke-test environment variables:

- `CHAOSBEY_PW_CHROMIUM_PATH=/path/to/chrome` runs the smoke tests with an existing Chromium binary. Use it when a sandboxed container ships a Chromium revision that doesn't match what `@playwright/test` expects and can't download another one. CI leaves it unset and installs its own browser.

### Desktop local test build (Windows + macOS)

```bash
npm run build:exe   # Windows: builds the real production bundle, then packages it
npm run build:mac   # macOS (Intel + Apple Silicon): same, packaged as an unsigned .app
```

Windows produces a portable folder at `release/win-unpacked/` — copy the whole folder, then double-click `ChaosBey.exe` inside it. macOS produces `release/mac/ChaosBey.app` (Intel) and `release/mac-arm64/ChaosBey.app` (Apple Silicon) — right-click → Open the first time (unsigned app, Gatekeeper will otherwise refuse it). Either way it's the same production build GitHub Pages serves (no code changes for packaging), running in a plain Electron window; see [`electron/README.md`](electron/README.md) for details. The GitHub Actions workflow `.github/workflows/desktop-build.yml` builds both platforms on demand (Actions tab → "Desktop build (Windows + macOS)" → Run workflow) without needing any of this installed locally. This is a local-testing convenience only — the project's real target is still the web build above.

## Main Menu

The game URL (`/ChaosBey/`) opens the Main Menu (GDD 56).

- **PLAY** opens the player flow: Character Select (the Bey spins in 3D next to its ratings), the Pregame Simulator (opponent Bey, AI level Rookie / Rival / Ace and style, arena, match length, and advanced rules: wall height and bounce, Clash impact, fixed seed, with a "What to expect" explanation of the opponent), then rounds with the combat HUD until someone wins the match, then Results (Rematch / Change setup / Change Bey / Main Menu). `Esc` (or Start on a pad) pauses; losing window focus pauses too.
- **SETTINGS** (`?mode=settings`): quality Low / Medium / High, camera shake, fullscreen, pause on focus loss, HUD hints, developer overlay, and the controls.
- A standard gamepad works everywhere: stick / D-pad to move, A attack, X or LB hop / jump / drift, B or RB dodge, Start pause; in menus A confirms and B goes back.
- `?mode=play&quick` skips the screens and starts the default match with the debug overlay up (`&seed=…` fixes the seed). The developer tools are kept apart from the player flow, in a separate **Developer / Debug** section with **DEBUG LAB** and **SELF TEST** (Back or `Esc` returns). Each entry loads the same URL a direct link uses — `?mode=play`, `?mode=debug-lab`, `?mode=self-test` — so the browser Back button returns to the menu. The menu's look is provisional until its visual approval.

## Debug Lab

Open the Debug Lab from the Main Menu (Developer / Debug → DEBUG LAB) or with `?mode=debug-lab` (for example `/ChaosBey/?mode=debug-lab`) to get the Debug Lab: the real match with a raw-state inspector (GDD section 69) and developer controls (GDD section 70). Its panel is a temporary developer UI, not the final HUD or menu.

- `P` pause / resume · `N` step one fixed tick · `M` step ten ticks
- `R` restart with the same seed · `T` restart with a new seed (a typed seed can also be applied from the panel)
- speed 1× / 2× / 4× / 8× runs that many fixed 60 Hz ticks per step; it never enlarges the timestep
- each side can be driven by the keyboard, the AI (any archetype personality) or nothing (idle), switched live

The panel also loads the GDD 68 scenario presets into the live match and shows the GDD 67 anomaly detector's findings.

## Self Test

Open the Self Test from the Main Menu (Developer / Debug → SELF TEST) or with `?mode=self-test` for the browser Self Test (GDD 66, 162–164): AI-vs-AI batches over any matchups and seeds, the GDD 68 scenario presets (scripted vs scripted, or with one side swapped for the AI), the GDD 67 anomaly detector on every tick, and the GDD 163 report (download as JSON; failing seeds can be replayed). It runs the shared headless core in `src/self-test/`, 1× (real time) to 64× or as fast as the CPU allows — always more fixed ticks, never a bigger timestep — with a 2D minimap instead of the 3D renderer.

Milestone 8's own history is in [`docs/ai/m8-status.md`](docs/ai/m8-status.md) and [`docs/ai/m8-readiness-inventory.md`](docs/ai/m8-readiness-inventory.md).

## Keyboard bindings

- Arrow keys — move (camera-relative "Directional" by default — ↑ is always away from the camera; Classic/Bey-relative tank steering is a Settings option)
- `X` — hop / drift (tap for a small hop, hold + steer to drift, hold alone for a variable-height jump)
- `Z` — attack (hold to charge a Dash Attack)
- `C` — dodge (tight timing window for a Perfect Dodge)
- `Esc` — pause (losing window focus pauses too, if enabled in Settings)
- `F3` — toggle debug overlay
- `F4` — toggle the attack-profile settings panel

A standard gamepad works everywhere too — see "Main Menu" above.
