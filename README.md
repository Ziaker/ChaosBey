# ChaosBey

A browser-based 3D spinning-top arena combat simulator, built with Three.js, Rapier 3D and Vite, deployed to GitHub Pages.

The authoritative design specification and AI-agent operating contract lives in the project's master design document (provided to development agents out-of-band). Every meaningful design decision in this codebase traces back to it — when this README and that document disagree, the document wins.

## Status: Milestone 0 — Foundation

Implemented so far:

- Vite + TypeScript project, deployable under the `/ChaosBey/` GitHub Pages subpath.
- Three.js renderer bootstrap with a temporary placeholder scene (proves the render path only — not approved visual design).
- Rapier 3D physics world with a fixed 60 Hz timestep loop, decoupled from render FPS.
- Seeded, deterministic RNG with named streams (gameplay/AI/cosmetic) and human-friendly seed text normalization.
- Top-level game state machine skeleton.
- Controller abstraction (`CombatController`) with a keyboard implementation that samples the approved control scheme (arrows / Z / X / C) into actions — not yet wired to any gameplay effect (see Controls below).
- Runtime quality-preset config skeleton.
- Telemetry event bus + in-memory recorder skeleton.
- Debug overlay skeleton (toggle with `F3`).
- Physics safety diagnostics (non-finite / implausible velocity detection).
- Unit tests (Vitest) and a production smoke test (Playwright, against the built `/ChaosBey/`-scoped bundle).
- GitHub Actions workflow: typecheck → test → build → smoke test → deploy to Pages (on `main`).

Not yet implemented: combat, movement/steering feel, camera direction, VFX, AI, UI screens, Debug Lab, replay. See the master design document's milestone list.

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

## Reserved/approved keyboard bindings

These are the approved bindings the `KeyboardController` samples into actions. In this milestone there is no combat/movement system yet for most of them to drive — pressing arrows / Z / X / C / Esc is captured but has no visible effect. Only `F3` is actually wired to something right now (toggling the debug overlay).

- Arrow keys — steer / move (reserved — not yet connected to any movement system)
- `Z` — attack (reserved — not yet connected to any combat system)
- `X` — hop / jump / drift (reserved — not yet connected to any jump/drift system)
- `C` — dodge (reserved — not yet connected to any dodge system)
- `Esc` — pause (reserved — not yet connected to a pause state)
- `F3` — toggle debug overlay (connected)
