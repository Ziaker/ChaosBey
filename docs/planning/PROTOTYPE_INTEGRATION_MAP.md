# ChaosBey — Prototype Integration Map

**Date:** 2026-10-01 (status updates through 2026-10-07, section 0) · **Against:** `main@73c04ab` (through #80) and the open PRs #24, #64, #67, #72, #75, #76.
**Scope:** where every visual prototype stands and where it plugs in. This document ports nothing and decides nothing. It replaces the conclusions of the older plan in PR #67 where they went stale (section 3).

**The camera is frozen for the whole visual integration pass (owner order, 2026-10-01): see section 6.** Nothing below changes a camera file, parameter, preset, event or behaviour; where a prototype and the current camera disagree, the prototype adapts or waits.

Precedence stays: `OWNER_DECISIONS_MASTER.md` → `VISUAL_APPROVALS_MASTER.md` → the area's approval doc. "Prototype exists" never means "decision closed".

**States:** `ALREADY INTEGRATED` · `PARTIALLY INTEGRATED` · `READY TO PORT` · `OWNER CHOICE REQUIRED` · `DEFERRED`.

## 0. Status update — 2026-10-02 (supersedes the "In `src/` today" and "State" columns below where they differ)

The visual integration pass of section 4 has landed, batch by batch, each behind its own flag. **Since 0.16.0 the five approved packages are ON in the normal game** (`PRESENTATION_FEATURES_DEFAULT` in `src/presentation/features.ts`; `newHud` stays off). An explicit `?pfx=` is an allowlist for isolation: it starts from all-off and turns on only what it names (`?pfx=hybridVfx`, `?pfx=all`; `?pfx=` alone is the all-off baseline, `PRESENTATION_FEATURES_OFF`). Character Select's preview resolves the Bey through the same function as the match (`beyVisualDefinitionFor`).

Provisional, not owner choices: each gameplay archetype wears concept A of its family (`concept:attack-a`, `concept:defense-a`, `concept:stamina-a`; B/C stay registered, visual-only); the Condition default is A alone.

| Batch | PR | Flag | Now |
|---|---|---|---|
| Foundation (hub, events, flags) | #72 | — | **INTEGRATED** |
| 1 — Bey 4-piece concepts (3 archetypes) | #82 | `newBeyVisuals` | **ON in normal play** (0.16.0), also on Character Select; gameplay for the other 6 concepts still **OWNER CHOICE REQUIRED** |
| 2 — Condition languages A/B/C | #84 | `conditionVisuals` | **ON in normal play** (0.16.0); Settings shows A/B/C (1–3, never none); default A is provisional, the owner's default combination still open |
| 3 — Hybrid VFX + Cel Cyclone | #85 | `hybridVfx` | **ON in normal play** (0.16.0); shake ×1.35 still pending metadata (no bridge), no time scaling. Since 0.54.0 the same flag also attaches **Flow FX** (`src/vfx/flow`: lean, shadow, volume dust, wind, impact rings, comic words; sliders in Settings → Visual effects; spec `docs/design-decisions/flow-fx-effects.md`) |
| 4 — Clash Overdrive | #86 (v0.13.0) | `clashPresentation` | **ON in normal play** (0.16.0); tie style (ASK FIRST), entry slow motion, per-mash hitstop, Clash shake and the "overdrive" bar style still frozen/open |
| 5 — Arena art (Foundry, Rift, Tournament) | #87 (v0.14.0) | `arenaVisuals` | **ON in normal play** (0.16.0), fitted to the 36 m stage (horizontal footprint ×3, real-size parts, light rigs/sky/haze scaled as a whole); default arena still **OWNER CHOICE REQUIRED** |
| HUD | ~~#64~~ closed | `newHud` (unused) | **NO LAB, NO A/B/C CHOICE** — owner 2026-10-02: the Combat HUD Lab is not needed; the HUD is the existing `CombatHud` |

Since this map was written the stage also became **3× / 36 m** (#83, v0.12.0) and the camera follows it (#88, v0.14.1: eye limit 34.5 m, ring-out watch 33 m). The camera freeze of section 6 applied to the visual batches, which touched no camera file; #88 was a separate, owner-requested camera fix, and the owner-approved Inertial Duel Camera (#89) is camera work outside this pass. PR #24 (Clash lab) and PR #67 (old plan) are now fully superseded by #86 and this map.

**Launch update — owner 2026-10-07:** **A — Timing Snap is approved**. Canonical prototype: `prototypes/launch-system-concepts/index.html`; decision: `docs/design-decisions/launch-system-approval.md`. It is not integrated into the normal round flow yet.

## 1. The map

| Prototype | Source of truth | Approval | In `src/` today | State | Plugs into (foundation seam) | Depends on | Still open |
|---|---|---|---|---|---|---|---|
| **Bey Concept Lab** (4-piece anatomy, 9 concepts) | `visual-prototypes-approval.md` §1 · `prototypes/bey-visual-concepts/` | Anatomy and the 9 concepts approved | Placeholder mesh (`createBeyMesh`, "NOT FINAL"); 3 gameplay definitions only | **READY TO PORT** (geometry). Gameplay for the other 6: **OWNER CHOICE REQUIRED** | `BeyVisualDefinition` + registry + `newBeyVisuals`. Connect the 3 real archetypes first; the other 6 stay visual-only, no stats | none | Final names, palettes, spin readability (Defense A/B/C and Stamina B ambiguous at 22 rad/s), stats per Bey |
| **Bey Motion Lab** | `motion-approval.md` §16 · `prototypes/bey-motion-concepts/` | Directions A/B/C approved; values not final | Integrated M11: A/B/C in Pregame, B default | **ALREADY INTEGRATED**. PR #71 (steering/grip, gravity, short hop, flat dodge) and #73/#74/#77 (single-impulse jump, air control, jump input buffer) are in the baseline; Collision DI is **not** in `main`. `SpinController` stays the only authority for tilt, wobble and tumble | not a presentation port | none | Default direction, per-Bey tuning, `ext-0`, spin readability, Collision DI |
| **Arena Concept Lab** | `visual-prototypes-approval.md` §2–3 · `prototypes/arena-visual-concepts/` | Geometry approved; 3 directions valid; default arena open | Palettes/lights/spark colours via `ArenaPresets`; bowls A/B/C as playtest floors with a temporary lathe mesh. Approved arena art (rivets, truss, fissures, LEDs, Clash light) not ported | **PARTIALLY INTEGRATED** · art: **OWNER CHOICE REQUIRED** (default arena) | `ArenaVisualDefinition` + `arenaVisuals`. Visual never reaches a collider (tested). `createArenaColliders.ts` stays **byte-for-byte intact**: with the flag on its temporary visuals go to a discarded group and the approved arena is built separately in the real scene | none for art. Bowl pull / ring-out volume are a separate gameplay decision | Default arena, bowl slope pull, ring-out volume, wall openings, contrast with condition visuals |
| **Stamina & Stability Lab** | `condition-visual-approval.md` · `prototypes/condition-visual-concepts/` | A/B/C approved, 1–3 combinable, 49 values | Not in `src/` | **READY TO PORT** | `BeyPresentationState` (stamina, stability, broken, wobbleSeverity, deficits) + `stabilityBroken` + `conditionVisuals` + a Settings option (≥1 layer on) | 4-piece Bey for A's rattle/seams (not a hard blocker). No second movement authority: tilt/wobble/tumble come from the real `SpinController`; the lab's knockback/tilt/recovery numbers were choreography | Default combination, same for both Beys?, zero Stamina without Stamina defeat, names, contrast on Tournament/Rift |
| **VFX Language Lab** (Hybrid C + Cel Cyclone, 36 values) | `visual-prototypes-approval.md` §3b–3c · `prototypes/vfx-visual-concepts/` | Approved | M4 placeholders (sparks, landing burst, trails, speed lines) and, from the same language, drift skid marks/sparks and per-arena spark colours | **PARTIALLY INTEGRATED** · full Hybrid: **READY TO PORT** except the shake and anything that scales time | `VfxDirector` + events + anchors + `hybridVfx`. Screen effects (impact frame, tint, focus lines) use their own overlay layer, never a child of the camera | Hitstop stays with `HitstopClock` (the lab's own clock is dropped). Legacy impact bursts are hidden with the existing `VfxManager.setLayerVisible`, not by editing `tickCameraAndVfx` | **PENDING — CAMERA/VFX SHAKE INTEGRATION · OWNER FROZE CAMERA FOR THIS PASS** (×1.35 kept only as approved metadata, no bridge). Perfect Dodge slow motion deferred. Jump/air-attack/air-recovery VFX and per-Bey particles **DEFERRED** (not prototyped) |
| **Clash Presentation Lab** (Overdrive + camera B) | `clash-presentation-approval.md` · **code only in PR #24** (`claude/clash-presentation-lab`, draft, conflicts with `main`) | Approved | Camera B forced, no orbit ✔; tug-of-war bar in `CombatHud` ✔. Overdrive visuals (contact pose, speedlines, dust, resolution) ✘ | **PARTIALLY INTEGRATED** · rest **READY TO PORT** from the branch (visuals only) | `ClashPresentationSnapshot` + `clashStarted/Progress/Resolved` + `clashPresentation`. The camera is read, never edited: `CameraRig.ts` already has `CLASH_FORCED_PRESET = 'B'` and `clashOrbit: false` | VFX seam first (shares dust/spark language) | Tie style (ASK FIRST), Beys overlapping on screen, reduced-intensity variant, pulse shake. **Deferred, they touch time/camera:** entry slow motion, per-mash hitstop |
| **Camera Lab** | `camera-approval.md` · `prototypes/camera-concepts/` | A/B/C approved, 43 values each | Director + presets + Settings; in-game `ARENA_CAMERA_RIGS` override min/max distance and height | **ALREADY INTEGRATED — FROZEN** by the owner for this pass (baseline, no edit of any kind) | `CameraPresentationSnapshot` (read-only; the director stays the only authority) | none | Default for new players, FOV × preset, Perfect Dodge / Intro cameras, slow motion, post-freeze Ring-Out/Finisher feed, shake × VFX: all stay open and untouched |
| **Combat HUD Lab** (A/B/C) | `OWNER_DECISIONS_MASTER.md` §10, §13.1 · PR #64 (`chatgpt/combat-hud-lab`, draft, base `c828a90`) | **Not chosen** | Functional `CombatHud` (M10), temporary look | **OWNER CHOICE REQUIRED** | `HudPresentationState` + `newHud` | Rebase/update #64 onto current `main` (#71 has landed; its base is stale) | Which of A/B/C. In production the Dash lock-on is drawn only by the debug layers (`DebugVisualLayers`), not by `CombatHud`; whether the lab shows it was not checked |
| **Launch System Lab — A Timing Snap** | `launch-system-approval.md` · `prototypes/launch-system-concepts/` | **A approved**: physical launchers, player-selected entry point, Timing Snap, dual arrival, immediate Combat on first bounce; no post-landing countdown | Normal game still starts rounds without this interactive launch | **READY TO PORT — OWNER APPROVED** | Round-start / Play flow; target validation from real arena floor; replay/AI/telemetry hooks | Existing Bey visuals, arena art/floor, Motion/VFX/Camera as their own authorities | Exact timing→gameplay tuning, AI target/timing policy, gamepad mapping |
| UI theme, extra Intro outside the approved Launch, Post-FX, SFX | `VISUAL_APPROVALS_MASTER.md` §11 | Launch itself decided; remaining items separate | — | **DEFERRED** | — | — | only the separate items named here |

## 2. What the foundation provides (`src/presentation/`)

Gameplay produces facts; the session hands each finished tick to a hub; visual systems attach to the hub. Gameplay never imports this layer (a test fails if it does), and the layer never imports Rapier, the AI, the camera director, sessions or UI.

| Piece | File | Notes |
|---|---|---|
| Flags | `features.ts` | `newBeyVisuals`, `conditionVisuals`, `hybridVfx`, `clashPresentation`, `newHud`, `arenaVisuals`. Normal game: `PRESENTATION_FEATURES_DEFAULT` (all but `newHud` on, since 0.16.0). All-off baseline: `PRESENTATION_FEATURES_OFF`. Isolation: `?pfx=hybridVfx,arenaVisuals`, `?pfx=all`, `?pfx=` (all off). (Historical: when this map was written nothing sat behind a flag yet.) |
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

- **#67 predates #69–#80 and #72.** Its control/camera/physics statements are stale.
- **Control today:** camera-relative Directional (commit `80c3d77`), with the camera yaw read once when the player starts to move and held until every direction is released (#79, "Fix 9"). Physics and presentation read only the **resolved** `moveIntent`, never the camera. `docs/ai/m11-status.md` "Fix 7" (line ~534) still describes the earlier world-relative mapping; `docs/ai/` was not touched by #80.
- **#67 said the HUD had no lab:** PR #64 exists (A/B/C over a real `MatchSession`, base `c828a90`).
- **#67's order and its "settle shake before VFX":** superseded. The camera is frozen, so the shake stays pending metadata and the rest of the VFX proceeds (section 6).
- **Camera × Motion re-measurement** (`motion-approval.md` §16.4): not part of this pass; the camera is frozen.
- **Still valid from #67:** Clash Overdrive's code lives only on `claude/clash-presentation-lab`; hitstop keeps a single authority (`HitstopClock`).
- **Fixed by #80, no longer stale:** `camera-approval.md` now records the `ARENA_CAMERA_RIGS` overrides, and the bowl is documented as a real heightfield collider (M11 lane 4).
- **Still stale after #80:** the README says all 9 Beys are "selectable/playable" (production has 3 gameplay definitions; the 9 are approved visuals, gameplay for 6 is undefined); `visual-prototypes-approval.md` §4 item 1 ("which 3 Beys") is superseded by the master override but not annotated.
- **"Nothing in `src/`" is too strong:** the drift VFX and arena spark colours are approved language already in the game. The large packages (full Hybrid + Cel Cyclone, condition visuals, Clash Overdrive, final Bey models) are not.

## 4. Order from here

Foundation (#72) merged → Bey 4-piece visuals on the 3 archetypes → condition visuals → Hybrid VFX + Cel Cyclone (no shake, no time scaling) → Clash Overdrive from PR #24 (visuals only) → arena art that does not change physics → update the HUD Lab (#64) without choosing A/B/C → composition, readability and performance pass. Each batch sits behind its flag, off by default, and proves the camera output is unchanged.

## 5. Predicted conflicts

| Where | With | What to do |
|---|---|---|
| `MatchSession.ts`, `createMatchScene.ts` (touched by this PR) | none of #71 (merged without conflict), #64 or #24 touch them (file lists compared) | Rebase is mechanical. Later visual PRs will edit the same two files: keep each change behind its flag |
| `tickMatch.ts`, `MovementController.ts`, `PhysicsWorld.ts` (changed by the merged #71) | a Collision DI follow-up, if it comes | Untouched here. If Collision DI exposes contact data, extend `PresentationEventDeriver` (the only file that maps gameplay facts to events) onto `collisionResolved` |
| `createArenaColliders.ts` builds colliders **and** arena meshes in one call | arena-art integration | Leave the file untouched (physics is off limits); route its temporary visuals to a discarded group when `arenaVisuals` is on. The collider-signature test guards the colliders |
| `vite.config.ts` build inputs, `prototypes/camera-concepts` director | PR #24 | Port the Clash lab deliberately; do not merge the branch. Preserve `claude/clash-presentation-lab` (tag it) before it is ever deleted |
| `MainMenu.ts`, `appMode.ts`, `main.ts` | PR #64 | Not touched here |
| `docs/ai/m11-status.md`, README, `visual-prototypes-approval.md` | stale lines in section 3 | Left as they are; a docs-only follow-up can correct them |
| `package.json`, `electron/` | PR #75 (Electron build) | No overlap; keep visual batches out of packaging files |
| `MatchSession.ts` camera blocks (`tickCameraAndVfx`, `cameraSnapshot` consumers) | camera freeze | Visual batches may add presentation hooks only; the diff of that file must show no hunk inside the camera blocks |
| `createBeyMesh.ts` carries the tip-at-collider-bottom anchoring | Bey visual integration | Every new visual must keep that rule; anchors default to mesh bounds and should be declared exactly by final visuals |

## 6. Camera freeze (owner order, 2026-10-01)

Nothing about the camera changes during the visual integration: no `CameraDirector`, `CameraRig`, `CameraParams`, preset, mode, FOV, framing, orbit, rescue, shake, slow motion, camera event, camera Setting, or camera test (except to prove nothing changed). The Camera Lab is not imported, ported or repeated. Old bugs, stale comments and mismatches found on the way are documented separately, never fixed here. Where a prototype conflicts with the current camera, the prototype adapts or waits.

Guard on every batch: (1) `git diff --name-only origin/main...HEAD` lists no camera path; (2) the neutrality test shows identical camera output (mode, eye, target, FOV, preset, shake) with each flag off, on and with systems attached; (3) new visual code never imports `camera/director/**`.

Held back because of it, for the owner: the VFX Lab shake ×1.35 (`PENDING — CAMERA/VFX SHAKE INTEGRATION`), the Perfect Dodge slow motion, the Clash entry slow motion and per-mash hitstop, any Perfect Dodge camera mode.
