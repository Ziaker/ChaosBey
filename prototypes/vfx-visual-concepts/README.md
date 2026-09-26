# VFX Language Lab — prototype

An interactive page that compares **complete VFX languages** on the same scripted combat moments, before any final combat VFX is chosen (GDD sections 1.6, 26, 51, 54 and 98). The owner asked for only these two directions:

- **A — Mechanical:** physical and grounded. Metal sparks with gravity that bounce on the bowl, metal chips, dust, scuff marks left on the floor, short camera shake and short hitstop. Colors come from the arena's spark palette.
- **B — Anime impact:** graphic and exaggerated. A negative-flash impact frame, impact stars, flat shockwave rings, long spark lines, screen focus lines, colored slashes and afterimages in each Bey's color, longer hitstop and stronger shake.
- **C — Hybrid (owner direction, round 2):** A's metal sparks, chips and dust on contact and at high speed, plus B's hits, Dash, speed lines, dodge, break, landing and ring-out. The impact frame appears **only on HIGH (heavy) attacks**. It also adds a new **wind burst**: a spiky, twisting funnel of wind (a small anime-style hurricane) behind the Bey on every sudden advance, which covers Dash release, dodge activation and the new "Wind burst" moment.

A and B stay in the lab as references.

**Wind burst: 3 options (round 3)**, based on the owner's reference image and compared side by side with `Q`:

1. **Sonic Boom:** 3 jagged vertical shockwave rings (a vapor-cone look) in quick sequence, resting on the floor. Compact.
2. **Comet Wake:** long torn wind streaks stretched along the real path of the advance, plus spiral lines wrapping the Bey. The Bey's color appears only on thin accents.
3. **Cel Cyclone:** the full reference in solid cel shading: rings, torn wake, spiral, toon dust clouds and debris.

The v1 funnel stays available (`U`).

The lab covers nine moments: collision hit, Dash Attack (charge + release), Circular Attack counter, Perfect Dodge, wind burst (advance), Stability Break, jump landing, wall scrape and ring-out. Each has light, medium and heavy intensity, and every effect scales with the impact magnitude `m` (GDD 51: VFX must not lie about power).

This is **visual exploration only**. The Bey motion is choreography, not physics, and nothing in `src/` changes. The page reuses the approved arena (3.2 m bowl) and the round-2 Beys.

## Open it

- **In the browser, no setup:** these prototypes are also published as claude.ai Artifacts. Rebuild this one with `node prototypes/tools/build-artifact.mjs prototypes/vfx-visual-concepts <out.html>`.
- **Locally:** run `npm run dev` and open `/prototypes/vfx-visual-concepts/`.

## Controls

| Action | Control |
|---|---|
| Pick an effect | `1`–`9` |
| Pick the view | Wind 1 \| 2 \| 3 `Q` (default), Hybrid `H`, `A`, `B`, compare B \| C `W`, compare A \| B `V` |
| Pick the wind style (for `H` and `W`) | `J` Sonic Boom, `K` Comet Wake, `L` Cel Cyclone, `U` v1 funnel |
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
| `src/languages/hybrid.ts` | Language C: composes A and B, plus the 4 wind-burst styles (tuning at the top of the file) |
| `src/scenarios/scenarios.ts` | The 9 choreographies and the events they fire |
| `src/fx/` | Effect runtime (`FxLayer`, `StreakSparks`), primitives and procedural textures |
| `src/stage/World.ts` | One scene: arena + Beys + language, with its own hitstop and slow-motion clock |
| `src/stage/VfxStage.ts` | Renderer, split view, camera, screen overlays (focus lines, tint, impact frame) |

## Mapping to the game (for later)

Each language handler corresponds to a game event that already exists or is planned. `hit` maps to HitResolved and knockback, `dashCharge` and `dashRelease` to AttackController, `perfectDodge` to the dodge system, `stabilityBreak` to StabilityBreak, `landing` to landing, `scrape` to wall contact, `windBurst` to Dash release and dodge start, and `ringOut` to RingOut. The chosen language would replace the placeholders in `src/vfx/`, driven by those events (GDD 158).
