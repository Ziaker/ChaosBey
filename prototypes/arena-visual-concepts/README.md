# Arena Visual Concepts — prototype

An interactive Three.js page for comparing **three temporary visual directions for the arena** before its final look is approved (GDD sections 35, 36 and 98). All three use the current game arena scale from `src/arena/colliders/ArenaTuning.ts`: floor radius 12 m and a wall of about 2 m. The Beys shown are the round-2 concepts from `../bey-visual-concepts/`, at game size.

**Bowl depth:** each arena has its own profile. A is a parabolic dish (2.2 m by default), B is a funnel that slopes almost to the center (3.0 m), and C has a flat 2.6 m center plateau and then a curve (2.2 m). The slider changes the depth live. The game's physics floor is still **flat**; making it concave is a gameplay decision for later (GDD section 35).

This is **visual exploration only**. It imports nothing from `src/`, and it changes no colliders, ring-out rules, dimensions or gameplay. The Bey movement is a scripted demo loop, not physics.

| | Direction | Floor | Boundary | Lighting | Background | Impact / Clash |
|---|---|---|---|---|---|---|
| **A** | Foundry Pit | Brushed steel plates, welded seams, hazard band | 16 riveted steel panels, hazard rail | 4 warm overhead work lamps, haze | Dark hall with fog | Orange sparks; lamps flare white, stripes glow |
| **B** | Rift Crater | Basalt with glowing violet fissures, deeper bowl | Rock rim + animated energy barrier | Cold moonlight + fissure glow | Night sky, stars, drifting shards | Violet sparks; fissures and barrier surge magenta |
| **C** | Tournament Stadium | Light polymer with sports markings, red edge band | Clear polycarbonate wall, posts, LED rail | Bright 8-spot ring rig | Stands with crowd | White sparks; LED rail flashes both player colors, crowd camera flashes |

## Open it

- **In the browser, no setup:** these prototypes are also published as claude.ai Artifacts. Rebuild one with `node prototypes/tools/build-artifact.mjs prototypes/arena-visual-concepts <out.html>`.
- **Locally:** run `npm run dev` and open `/prototypes/arena-visual-concepts/`. For the production preview, open `/ChaosBey/prototypes/arena-visual-concepts/`.

## Controls

| Action | Control |
|---|---|
| Pick an arena | `1`–`3` or the panel buttons |
| Pick the two Beys | The dropdowns in the panel |
| Change the camera | Overview `O`, Game cam `G` (opponent-focused chase), Top `T`, Free `F` (or just drag) |
| Demo motion | `M` |
| Clash lighting | `X` |
| Trigger a wall impact | `I` |
| Bowl depth | Slider in the panel, 0–4 m of rim height above the center |

## Files

| File | Contents |
|---|---|
| `src/arenas/types.ts` | `ArenaConcept` / `BuiltArena` contract |
| `src/arenas/common.ts` | Bowl floor mesh, floor canvas, sky dome, seeded RNG |
| `src/arenas/foundryPit.ts` | Concept A (tuning at the top of the file) |
| `src/arenas/riftCrater.ts` | Concept B (tuning at the top of the file) |
| `src/arenas/tournamentStadium.ts` | Concept C (tuning at the top of the file) |
| `src/viewer/ArenaViewer.ts` | Scene, Bey demo loop, sparks, Clash blend, cameras |
| `src/main.ts` | UI wiring and the automation hook (`window.__arenaLab`) |
