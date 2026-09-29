# ChaosBey

A browser-based 3D spinning-top arena combat simulator, built with Three.js, Rapier 3D and Vite, deployed to GitHub Pages.

The authoritative design specification and AI-agent operating contract lives in the project's master design document (provided to development agents out-of-band). Every meaningful design decision in this codebase traces back to it — when this README and that document disagree, the document wins.

## Canonical design decisions

Before reopening any visual/design question, read [`docs/design-decisions/README.md`](docs/design-decisions/README.md). For visual prototypes and approvals, the mandatory entry point is [`docs/design-decisions/VISUAL_APPROVALS_MASTER.md`](docs/design-decisions/VISUAL_APPROVALS_MASTER.md).

Those documents distinguish **prototyped**, **approved** and **integrated** work and record later owner overrides over older snapshots. In particular, all **9 approved Bey concepts are selectable/playable**; older text that says to choose only three final Beys is superseded on that point.

## Status: Milestone 1 — Physical Movement Prototype

**Milestone 0 (Foundation)** — merged: Vite + TypeScript project under the `/ChaosBey/` GitHub Pages subpath, Three.js renderer bootstrap, Rapier 3D physics world with a fixed 60 Hz timestep loop decoupled from render FPS, seeded deterministic RNG (gameplay/AI/cosmetic streams), top-level game state machine skeleton, `CombatController` abstraction with a `KeyboardController`, runtime quality-preset config, telemetry event bus, debug overlay (`F3`), physics safety diagnostics, unit tests + a production smoke test, and a GitHub Actions workflow (typecheck → test → build → smoke test → deploy to Pages).

**Milestone 1 (this branch)** — one temporary Bey that behaves like a spinning object, not a sliding puck (GDD section 137):

- One temporary Bey rigid body + a circular arena (floor + wall-segment boundary).
- Force/response-based movement: acceleration/steering never snap position or velocity directly. Heading is its own gameplay value with steering inertia; the actual velocity only gradually realigns to it via lateral/longitudinal grip, producing real slip at speed.
- Rotation split per GDD section 17/83: the physics rigid body's real orientation carries collision-driven **tilt**, corrected by an upright recovery torque + damping; a decoupled **spin** value drives fast continuous visual rotation that never touches physics; a small bounded **wobble** oscillation (visual-only) grows on impact and decays.
- Wall/floor bounce with restitution materials, and impacts feed an angular impulse into the spin/tilt system (knockback rotation).
- Drift: tap `X` for a small hop, hold it while steering to slide with reduced lateral grip, release to gradually recover normal grip. No mini-turbo (not approved).
- Debug overlay now shows the full translational/rotational diagnostic set: intended steering vector, actual velocity vector, speed, heading, slip angle, lateral/longitudinal grip, grounded state, drift state, angular velocity, spin rate, tilt, wobble energy.
- A `ScriptedController` (drives the same `CombatController` interface as keyboard/AI) backs a deterministic physics self-test suite: straight acceleration, high-speed steering/slip, wall bounce (no tunneling, angular response, no runaway energy), long-run wobble/finite-value stability, upright recovery, and the full hop→drift→recover flow.
- A temporary, non-final camera just follows the Bey so movement is actually testable — not the approved camera director (that's Milestone 4).

Not yet implemented: combat, stamina/stability/attack-energy, Clash, AI, real camera direction, VFX, UI screens, Debug Lab, replay. See the master design document's milestone list.

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

Progress on the rest of Milestone 8 is tracked in [`docs/ai/m8-status.md`](docs/ai/m8-status.md).

## Keyboard bindings

- Arrow keys — steer / move (connected — drives the Milestone 1 movement prototype)
- `X` — hop / drift (connected — tap for a small hop, hold + steer to drift)
- `Z` — attack (reserved — not yet connected to any combat system)
- `C` — dodge (reserved — not yet connected to any dodge system)
- `Esc` — pause (reserved — not yet connected to a pause state)
- `F3` — toggle debug overlay (connected)
