# ChaosBey

A browser-based 3D spinning-top arena combat simulator, built with Three.js, Rapier 3D and Vite, deployed to GitHub Pages.

The authoritative design specification and AI-agent operating contract lives in the project's master design document (provided to development agents out-of-band). Every meaningful design decision in this codebase traces back to it — when this README and that document disagree, the document wins.

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

## Keyboard bindings

- Arrow keys — steer / move (connected — drives the Milestone 1 movement prototype)
- `X` — hop / drift (connected — tap for a small hop, hold + steer to drift)
- `Z` — attack (reserved — not yet connected to any combat system)
- `C` — dodge (reserved — not yet connected to any dodge system)
- `Esc` — pause (reserved — not yet connected to a pause state)
- `F3` — toggle debug overlay (connected)
