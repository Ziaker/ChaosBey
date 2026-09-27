# Stamina & Stability Lab — prototype

An interactive Three.js page with **three complete visual languages for a Bey's condition**: how Stamina, Stability and the Broken state (GDD 28–30, 84, 123) read on screen.

**Status (2026-09-27): all three APPROVED** as player-selectable options (any combination of 1, 2 or 3), with the owner's saved values and C's red light column removed. The decision record is `docs/design-decisions/condition-visual-approval.md`.

This is **visual exploration only**. It imports nothing from `src/` and changes no gameplay, physics, colliders, rules or balance. The motion is choreography, not the game's physics. It reuses the round-2 Bey concepts from `../bey-visual-concepts/` at game scale (about 1.3 m across) and the approved 3.2 m bowl with a neutral floor, because the arena's look is still an open choice.

## The three directions

| | A — Desgaste Mecânico | B — Aura de Espírito | C — Instrumento no Chão |
|---|---|---|---|
| **Idea** | Nothing that couldn't physically exist: motion, material, contact | The fighting spirit as visible energy, in the approved anime family | The floor projects an instrument under the Bey; the Bey stays clean |
| **Stamina** | The tip scribes a rosette on the floor that opens up; the rim grinds and throws sparks; faint smoke at the end | A flame aura in the Bey's colour: tall when fresh, short, flickering and broken into wisps when tired; anime spin lines | Outer arc with 10% ticks, white → amber → pulsing red; a notch runs at a quarter of the spin rate; the core pulses like a heartbeat that slows |
| **Stability** | The four pieces go loose and rattle, seams open, paint darkens and loses its lacquer; hits knock chips off | Hexagonal shield shards orbit the Bey, one per slice of Stability; hits shatter them, recovery re-forms them | Inner ring of segments; hits blank them (with a flash), recovery refills them one by one |
| **Broken** | Limping lean, rim grinding continuously, smoke from the Driver | Pulsing red outline, dazed stars, electric arcs, the aura turns to embers | Rotating hazard stripes (the red light column was removed by the owner) |

**Shared by all three (always on):** the physical degradation the GDD requires. The spin slows (the blur shell fades and the pieces become visible), the wobble and precession grow, a hit kicks harder when Stability is low, a broken Bey leans and hiccups, and at zero Stamina it spins out and falls onto its ring rim.

The one-shot Stability Break burst is **already approved** in the VFX Language Lab (decisions doc §3b). This lab covers the continuous state before it, the persistent broken state after it, and recovery.

## Open it

- **In the browser, no setup:** published as a claude.ai Artifact at https://claude.ai/artifact/XrFZjTjDfGF5BzTFWaPmzT (private to the owner until shared). Rebuild it with `node prototypes/tools/build-artifact.mjs prototypes/condition-visual-concepts <out.html>`.
- **Locally:** `npm run dev`, then open `/prototypes/condition-visual-concepts/`. Production preview: `/ChaosBey/prototypes/condition-visual-concepts/`.
- Deep links: `#a`, `#b`, `#c`, `#compare`, `#stamina`, `#stability`.

## Controls

| Action | Control |
|---|---|
| Pick a direction | `1` `2` `3` or the panel; tick **Misturar** to combine them |
| Game camera (my Bey) / opponent far away / close | `G` / `L` / `V`; drag to orbit freely |
| Compare A \| B \| C side by side | `Q` |
| Stamina ladder / Stability ladder (five Beys at fixed levels) | `E` / `T` |
| Light / medium / heavy hit | `Z` / `X` / `C` (in the ladders, all five are hit) |
| Break / recover / spin-out / restart | `B` / `R` / `O` / `N` |
| Scripted fight (auto) ↔ manual sliders | `M` |
| Pause / slow motion / tuning panel | `Space` / `S` / `P` |

The **scripted fight** loops in about 40 s: hits at 2.5, 5, 7.5 and 10 s (Break), recovery, three more hits (second Break), recovery, Stamina runs out around 35 s, spin-out, restart. The strip at the bottom marks each hit, Break (red), recovery (green) and spin-out (grey).

**Oponente longe** (`L`) puts the game camera behind the sparring partner, so the Bey under test is the far one, like the AI's Bey in a real match. Every direction has to read from there too.

## Tuning and saving the decision

The right panel has 49 sliders: 19 for the shared physical expression and 9–12 per direction. They start at the approved configuration; changes apply at once and rows in orange differ from it. The draft is kept in the browser.

- **Salvar como final** stores the values **and the selected direction(s)** in the artifact's shared store (document `config/final`), so Claude can read the decision back and record it.
- **Copiar valores** copies the same JSON.
- **Voltar ao aprovado** resets every slider to `APPROVED` in `src/tuning.ts`.

## Files

| File | Contents |
|---|---|
| `src/tuning.ts` | Every slider: `APPROVED`, live `TUNING`, ranges and labels |
| `src/sim/ConditionSim.ts` | Stamina / Stability / Broken / spin-out state and events; the scripted fight (demo choreography, not game rules) |
| `src/sim/BeyMotion.ts` | Shared physical choreography: spin rate, lean, precession, nutation, tip rosette, hit kick, spin-out |
| `src/stage/BeyRig.ts` | Round-2 concept at game scale; blur shell; material wear, glow, rattle and seam mods |
| `src/stage/World.ts` | Bowl or flat stage, lights, Beys with all three layers, sparring opponent, particles |
| `src/stage/Stage.ts` | Renderer, single / three-column viewports, camera modes |
| `src/languages/mechanical.ts` | Direction A (tuning at the top of the file) |
| `src/languages/spirit.ts` | Direction B (tuning at the top of the file) |
| `src/languages/instrument.ts` | Direction C (tuning at the top of the file) |
| `src/fx/Particles.ts`, `src/fx/glsl.ts` | Pooled particles; shared noise shader code |
| `src/ui/TuningPanel.ts` | Slider panel, draft, save / copy / reset |

## Checks

- `tests/unit/conditionVisualConcepts.test.ts` runs the scripted fight and checks the event order (break, recover, break, recover, spin-out, down, reset), keeps every value in range, checks that two motions fed by one sim stay identical (the compare view), finite and within 80° of lean, and that B's shards and C's segments and arc follow the condition through a whole fight for three different concepts.
- `tests/smoke/conditionVisualConcepts.spec.ts` loads the production page in Chromium, switches every direction, view and camera, fires every action and fails on any console error.
