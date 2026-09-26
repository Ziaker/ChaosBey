# VFX Language Lab — prototype

An interactive page that compares **two complete VFX languages** on the same scripted combat moments, before any final combat VFX is chosen (GDD sections 1.6, 26, 51, 54 and 98). The owner asked for only these two directions:

- **A — Mechanical:** physical and grounded. Metal sparks with gravity that bounce on the bowl, metal chips, dust, scuff marks left on the floor, short camera shake and short hitstop. Colors come from the arena's spark palette.
- **B — Anime impact:** graphic and exaggerated. A negative-flash impact frame, impact stars, flat shockwave rings, long spark lines, screen focus lines, colored slashes and afterimages in each Bey's color, longer hitstop and stronger shake.

The lab covers eight moments: collision hit, Dash Attack (charge + release), Circular Attack counter, Perfect Dodge, Stability Break, jump landing, wall scrape and ring-out. Each has light, medium and heavy intensity, and every effect scales with the impact magnitude `m` (GDD 51: VFX must not lie about power).

This is **visual exploration only**. The Bey motion is choreography, not physics, and nothing in `src/` changes. The page reuses the approved arena (3.2 m bowl) and the round-2 Beys.

## Open it

- **In the browser, no setup:** these prototypes are also published as claude.ai Artifacts. Rebuild this one with `node prototypes/tools/build-artifact.mjs prototypes/vfx-visual-concepts <out.html>`.
- **Locally:** run `npm run dev` and open `/prototypes/vfx-visual-concepts/`.

## Controls

| Action | Control |
|---|---|
| Pick an effect | `1`–`8` |
| Pick the view | Language A `A`, language B `B`, or the side-by-side split `V` |
| Pick the intensity | `Z` light, `X` medium, `C` heavy |
| Replay | `R` |
| Global slow motion | `S` |
| Orbit | Drag |

## Files

| File | Contents |
|---|---|
| `src/languages/types.ts` | Language contract: one handler per combat event, with magnitude `m` |
| `src/languages/mechanical.ts` | Language A (tuning at the top of the file) |
| `src/languages/anime.ts` | Language B (tuning at the top of the file) |
| `src/scenarios/scenarios.ts` | The 8 choreographies and the events they fire |
| `src/fx/` | Effect runtime (`FxLayer`, `StreakSparks`), primitives and procedural textures |
| `src/stage/World.ts` | One scene: arena + Beys + language, with its own hitstop and slow-motion clock |
| `src/stage/VfxStage.ts` | Renderer, split view, camera, screen overlays (focus lines, tint, impact frame) |

## Mapping to the game (for later)

Each language handler corresponds to a game event that already exists or is planned. `hit` maps to HitResolved and knockback, `dashCharge` and `dashRelease` to AttackController, `perfectDodge` to the dodge system, `stabilityBreak` to StabilityBreak, `landing` to landing, `scrape` to wall contact and `ringOut` to RingOut. The chosen language would replace the placeholders in `src/vfx/`, driven by those events (GDD 158).
