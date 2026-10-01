# ChaosBey — Prototype Integration Map

**Date:** 2026-10-01 · **Against:** `main@30afa27` (after PRs #69, #70 and #71) and the open PRs #24, #64, #67.
**Scope:** where every visual prototype stands and where it plugs in. This document ports nothing and decides nothing. It replaces the conclusions of the older plan in PR #67 where they went stale (section 3).

Precedence stays: `OWNER_DECISIONS_MASTER.md` → `VISUAL_APPROVALS_MASTER.md` → the area's approval doc. "Prototype exists" never means "decision closed".

**States:** `ALREADY INTEGRATED` · `PARTIALLY INTEGRATED` · `READY TO PORT` · `OWNER CHOICE REQUIRED` · `DEFERRED`.

## 1. The map

| Prototype | Source of truth | Approval | In `src/` today | State | Plugs into (foundation seam) | Depends on | Still open |
|---|---|---|---|---|---|---|---|
| **Bey Concept Lab** (4-piece anatomy, 9 concepts) | `visual-prototypes-approval.md` §1 · `prototypes/bey-visual-concepts/` | Anatomy and the 9 concepts approved | Placeholder mesh (`createBeyMesh`, "NOT FINAL"); 3 gameplay definitions only | **READY TO PORT** (geometry). Gameplay for the other 6: **OWNER CHOICE REQUIRED** | `BeyVisualDefinition` + registry + `newBeyVisuals`. Connect the 3 real archetypes first; the other 6 stay visual-only, no stats | none | Final names, palettes, spin readability (Defense A/B/C and Stamina B ambiguous at 22 rad/s), stats per Bey |
| **Bey Motion Lab** | `motion-approval.md` §16 · `prototypes/bey-motion-concepts/` | Directions A/B/C approved; values not final | Integrated M11: A/B/C in Pregame, B default | **ALREADY INTEGRATED**. PR #71 (steering/grip, gravity −10.5, short hop, flat dodge) was merged on 2026-10-01 and is the current baseline; Collision DI is **not** in `main` | not a presentation port | none | Default direction, per-Bey tuning, `ext-0`, spin readability, Collision DI |
| **Arena Concept Lab** | `visual-prototypes-approval.md` §2–3 · `prototypes/arena-visual-concepts/` | Geometry approved; 3 directions valid; default arena open | Palettes/lights/spark colours via `ArenaPresets`; bowls A/B/C as playtest floors with a temporary lathe mesh. Approved arena art (rivets, truss, fissures, LEDs, Clash light) not ported | **PARTIALLY INTEGRATED** · art: **OWNER CHOICE REQUIRED** (default arena) | `ArenaVisualDefinition` + `arenaVisuals`. Visual never reaches a collider (tested) | none for art. Bowl pull / ring-out volume are a separate gameplay decision | Default arena, bowl slope pull, ring-out volume, wall openings, contrast with condition visuals |
| **Stamina & Stability Lab** | `condition-visual-approval.md` · `prototypes/condition-visual-concepts/` | A/B/C approved, 1–3 combinable, 49 values | Not in `src/` | **READY TO PORT** | `BeyPresentationState` (stamina, stability, broken, wobbleSeverity, deficits) + `stabilityBroken` + `conditionVisuals` + a Settings option (≥1 layer on) | 4-piece Bey for A's rattle/seams (not a hard blocker) | Default combination, same for both Beys?, zero Stamina without Stamina defeat, names, contrast on Tournament/Rift |
| **VFX Language Lab** (Hybrid C + Cel Cyclone, 36 values) | `visual-prototypes-approval.md` §3b–3c · `prototypes/vfx-visual-concepts/` | Approved | M4 placeholders (sparks, landing burst, trails, speed lines) and, from the same language, drift skid marks/sparks and per-arena spark colours | **PARTIALLY INTEGRATED** · full Hybrid: **OWNER CHOICE REQUIRED** (shake conflict) then READY TO PORT | `VfxDirector` + events + anchors + `hybridVfx` | Shake × camera decision; hitstop stays with `HitstopClock` (lab's own clock is dropped) | Shake ×1.35 vs preset shake; jump/air-attack/air-recovery VFX and per-Bey particles are **DEFERRED** (not prototyped) |
| **Clash Presentation Lab** (Overdrive + camera B) | `clash-presentation-approval.md` · **code only in PR #24** (`claude/clash-presentation-lab`, draft, conflicts with `main`) | Approved | Camera B forced, no orbit ✔; tug-of-war bar in `CombatHud` ✔. Overdrive visuals (contact pose, speedlines, dust, resolution) ✘ | **PARTIALLY INTEGRATED** · rest **READY TO PORT** from the branch | `ClashPresentationSnapshot` + `clashStarted/Progress/Resolved` + `clashPresentation` | VFX seam first (shares dust/spark language) | Tie style, Beys overlapping on screen, reduced-intensity variant, pulse shake, bowl in physics |
| **Camera Lab** | `camera-approval.md` · `prototypes/camera-concepts/` | A/B/C approved, 43 values each | Director + presets + Settings; in-game `ARENA_CAMERA_RIGS` override min/max distance and height | **ALREADY INTEGRATED** — baseline, no redesign | `CameraPresentationSnapshot` (read-only; the director stays the only authority) | none | Default for new players, FOV × preset, Perfect Dodge / Intro cameras, slow motion, post-freeze Ring-Out/Finisher feed |
| **Combat HUD Lab** (A/B/C) | `OWNER_DECISIONS_MASTER.md` §10, §13.1 · PR #64 (`chatgpt/combat-hud-lab`, draft, base `c828a90`) | **Not chosen** | Functional `CombatHud` (M10), temporary look | **OWNER CHOICE REQUIRED** | `HudPresentationState` + `newHud` | Rebase/update #64 onto current `main` (#71 has landed; its base is stale) | Which of A/B/C. In production the Dash lock-on is drawn only by the debug layers (`DebugVisualLayers`), not by `CombatHud`; whether the lab shows it was not checked |
| UI theme, Intro/Countdown/Launch, Post-FX, SFX | `VISUAL_APPROVALS_MASTER.md` §11 | Not prototyped / not decided | — | **DEFERRED** | — | — | everything |

## 2. What the foundation provides (`src/presentation/`)

Gameplay produces facts; the session hands each finished tick to a hub; visual systems attach to the hub. Gameplay never imports this layer (a test fails if it does), and the layer never imports Rapier, the AI, the camera director, sessions or UI.

| Piece | File | Notes |
|---|---|---|
| Flags (all **off**) | `features.ts` | `newBeyVisuals`, `conditionVisuals`, `hybridVfx`, `clashPresentation`, `newHud`, `arenaVisuals`. Dev switch: `?pfx=hybridVfx,newHud` or `?pfx=all`. Nothing sits behind a flag yet |
| Events | `events.ts` | Derived after the tick from the `MatchTickResult`, the existing `ImpactEvent` list and the Clash tracker. Only events with a real source |
| State selectors (pure) | `state.ts` | Normalized per-Bey state, read-only camera snapshot, recent-impact memory. No visual thresholds |
| Clash adapter | `clash.ts` | Snapshot of the real `ClashController`; no rule copied |
| HUD contract | `hud.ts` | Plain data, world positions instead of bodies. `CombatHud` adopts it when the HUD is chosen |
| Hub / lifecycle | `hub.ts` | `create → onEvents/update → reset → dispose`; one system per id; faulty system isolated and counted |
| VFX director | `vfx.ts` | `PresentationEvent → VfxDirector → VfxEffect`. Ships with no effects |
| Bey visual registry + anchors | `beyVisual.ts` | `BeyVisualDefinition` (Top Layer / Ring / Disc / Driver) ≠ gameplay definition. Anchors `center, tip, topLayer, ringRim` by name |
| Materials / palettes | `materials.ts` | Registry that ships empty |
| Arena split | `arena.ts` | `ArenaPhysicsDefinition` vs `ArenaVisualDefinition` |
| Observability | `sceneStats.ts`, `session.getPresentationStats()` | Objects, meshes, particles, triangles, hub counters. No thresholds (no baseline yet) |

How the brief's event list maps: `BeySpawned` is `create(context)`; stamina/stability/attack-energy "changed" are state, not events; `MatchEnded` belongs to the play flow (match score), outside a session. `ClashProgress` fires on each mash edge. `collisionResolved` is fed by movement impacts today; when PR #71's Collision DI adds contact episodes it should map onto this event instead of adding a parallel one.

**Legacy paths left exactly as they were** (they move behind the director when the Hybrid language replaces them): `VfxManager` is fed by `MatchSession.tickCameraAndVfx`; `DriftVfx` is updated in `renderFrame`; the Clash-active "progressive spark" is a synthetic `hit` impact event.

**Attaching a future system:**
```ts
const unsubscribe = session.getPresentation().attach(system); // system: PresentationSystem
// or: director.register(effect) on a VfxDirector attached the same way
```

## 3. Corrections to the older plan (PR #67) and to stale text

- **#67 predates #69, #70 and #71.** Its control/camera/physics statements are stale. The code's default is camera-relative Directional again (commit `80c3d77`, the input layer resolves the yaw each tick). `docs/ai/m11-status.md` "Fix 7" still describes the earlier world-relative mapping under the same name: that section is superseded by the commit and the header of `src/input/directional/screenDirection.ts`. Rule for presentation and physics alike: read only the **resolved** `moveIntent`, never the camera.
- **#67 said the HUD had no lab:** PR #64 exists (A/B/C over a real `MatchSession`).
- **#67's order put arena physics early:** the physics/feel pass came first (#71, merged 2026-10-01), then the HUD choice, then the visual batches below.
- **Still valid from #67:** Clash Overdrive's code lives only on `claude/clash-presentation-lab` (6 commits); shake and hitstop each need a single authority; the Camera measurements (`camera-approval.md` §7) are still to be repeated with the integrated movement (`motion-approval.md` §16.4 lists it as open) and #71 has now landed, so the repeat is due.
- **README / masters say the 9 Beys are "selectable/playable":** production has 3 gameplay definitions. The 9 are approved visuals; gameplay for 6 is undefined.
- **`camera-approval.md` says the 43 values are unchanged:** in-game, `ARENA_CAMERA_RIGS` overrides `minDistance`, `maxDistance`, `cameraHeight` (owner request, recorded only in `m11-status.md`).
- **`visual-prototypes-approval.md` §4.1 ("which 3 Beys") is superseded** (master override); the file itself is not annotated.
- **"Nothing in `src/`" is too strong:** the drift VFX and arena spark colours are approved language already in the game. The large packages (full Hybrid + Cel Cyclone, condition visuals, Clash Overdrive, final Bey models) are not.

## 4. Order from here

`A` physics pass (#71) — done · `B` merged 2026-10-01; Collision DI is not part of it → `C` rebase/update the HUD Lab (#64) and let the owner pick → `D` neutral infrastructure (this PR) → `E` Bey 4-piece visuals on the 3 archetypes → `F` condition visuals → `G` Hybrid VFX + Cel Cyclone (settle shake) → `H` Clash Overdrive from PR #24 → `I` arena art that does not change physics (bowl changes stay separate) → `J` chosen HUD → `K` composition, readability and performance pass. Step `B` has happened, so the baseline is known: the stale lines in section 3 can now be corrected in the docs themselves.

## 5. Predicted conflicts

| Where | With | What to do |
|---|---|---|
| `MatchSession.ts`, `createMatchScene.ts` (touched by this PR) | none of #71 (merged without conflict), #64 or #24 touch them (file lists compared) | Rebase is mechanical. Later visual PRs will edit the same two files: keep each change behind its flag |
| `tickMatch.ts`, `MovementController.ts`, `PhysicsWorld.ts` (changed by the merged #71) | a Collision DI follow-up, if it comes | Untouched here. If Collision DI exposes contact data, extend `PresentationEventDeriver` (the only file that maps gameplay facts to events) onto `collisionResolved` |
| `createArenaColliders.ts` builds colliders **and** arena meshes in one call | arena-art integration | Split into physics and visual builders then, not before; the collider-signature test guards it |
| `vite.config.ts` build inputs, `prototypes/camera-concepts` director | PR #24 | Port the Clash lab deliberately; do not merge the branch. Preserve `claude/clash-presentation-lab` (tag it) before it is ever deleted |
| `MainMenu.ts`, `appMode.ts`, `main.ts` | PR #64 | Not touched here |
| `docs/ai/m11-status.md`, `docs/design-decisions/*` | stale lines in section 3 | Left as they are in this PR; correct them in a docs-only follow-up now that #71 is in |
| `createBeyMesh.ts` carries the tip-at-collider-bottom anchoring | Bey visual integration | Every new visual must keep that rule; anchors default to mesh bounds and should be declared exactly by final visuals |
