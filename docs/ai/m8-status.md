# M8 status — Debug Lab / Self Test expansion

Living checklist for Milestone 8 (GDD section 144, detailed by sections
1.2, 65–71, 162–164). Updated by every M8 PR. Status values:

- **DONE** — implemented, tested, on `main` (or in the PR named in the row until it merges);
- **PARTIAL** — some of the requirement exists, the rest is listed;
- **MISSING** — not built yet;
- **UNSUPPORTED (M9)** — depends on replay/state hashes, which GDD section 145 schedules for Milestone 9; reported as unsupported, never faked;
- **BLOCKED BY OWNER** — needs a decision reserved to the owner; does not block other M8 items.

## PRs

| PR | Scope | State |
|---|---|---|
| #31 | Shared headless Self-Test core (`src/self-test/`), AI batch runner, typed GDD 163 report | open (other session) |
| M8 Debug Lab (A+B+C, branch `claude/pensive-wright-bm4uss`) | `MatchSession` (shared live-match pipeline), Debug Lab mode, GDD 69 inspector, pause/step/restart/seed/speed, controller switching; GDD 70/71 visualization layers; overview camera, camera-effect and VFX toggles; logged mutation tools; JSON debug report | open |

## GDD 144 headline items

| Requirement | Implementation | Evidence | Status |
|---|---|---|---|
| Inspectors | `src/debug/inspectors/buildInspection.ts`, Debug Lab panel | `tests/deterministic/matchSession.test.ts`, `tests/smoke/debugLab.spec.ts` | DONE (Debug Lab PR) |
| Raw state | Same inspector: transform, linear, angular, surface, resources, combat, dodge, jump, Clash, AI, camera, performance, telemetry | same | DONE (Debug Lab PR) |
| Force visualization | `src/debug/visualization/DebugVisualLayers.ts`: colliders, hitboxes, ring-out, velocity/steering, spin axis/angular velocity, knockback + impact impulses, contacts + ground normal, lock-on, AI target path | `tests/deterministic/debugVisualLayers.test.ts`, `debugLab.spec.ts` | DONE (Debug Lab PR) |
| Scenario presets | — | — | MISSING |
| Controller switching | `src/app/session/SideControllers.ts` — keyboard / AI (any archetype personality) / idle / scripted, per side, live | `matchSession.test.ts`, `debugLab.spec.ts` | DONE for the live lab (Debug Lab PR); batch pairings with #31/Self Test |
| Batch tests | #31 `runAiBatch()` (headless) | #31 `selfTestBatch.test.ts` | PARTIAL — pending #31 merge + browser Self Test |
| Anomaly detection | #31: non-finite position, velocity/angular checks, crash, hang | #31 tests | PARTIAL — remaining GDD 67 detectors missing |
| Simulation acceleration | Debug Lab speed 1/2/4/8× = more fixed ticks per step (never a bigger delta); headless batches are unthrottled | `debugLab.spec.ts` (8× runs > 90 ticks/s) | PARTIAL — browser Self Test fast-forward via `stepManyTicks()` missing |
| Reports | #31 GDD 163 batch report object; Debug Lab `ChaosBeyDebugReportV1` (generate / copy / download) | #31 tests; `debugMutations.test.ts`, `debugLab.spec.ts` | PARTIAL — batch report view/export in the browser Self Test pending |

## GDD 69 — inspectable data (Debug Lab)

All categories are shown. Gaps are labeled UNSUPPORTED in the panel with the reason:

- Match score — best-of-3 series scoring is not implemented yet (single round per match) — outside M8.
- Last state hash, divergence state — UNSUPPORTED (M9).
- Scale — rigid bodies have no scale (documented, not a gap).

## GDD 70 — Debug Lab controls

| Control | Status |
|---|---|
| pause / resume / single-step | DONE (Debug Lab PR) |
| restart same seed / new seed (plus typed seed, copy seed) | DONE (Debug Lab PR) |
| toggle AI control / automated controller, change AI profile | DONE (Debug Lab PR) — AI personality per side; only one difficulty profile exists (tier list is an owner decision, GDD 59/171.4) |
| teleport, set velocity / angular velocity, set Stamina / Stability / Attack Energy, reset cooldowns | DONE (Debug Lab PR) — `src/debug/cheats/DebugMutations.ts`; every call logged on the session + `DebugMutation` telemetry |
| force attack state for test scenarios | DONE — through real inputs (Circular, full-charge Dash, hop, full jump, dodge) via `ForcedInputController`, never by writing state |
| trigger/prepare Clash | DONE — lines the Beys up and forces both Dash; the real 150 ms window decides |
| visualize colliders, hitboxes, velocity, angular axis, forces/impulses, target path, ring-out boundaries (+ contacts, normals, lock-on) | DONE (Debug Lab PR) |
| toggle VFX layers, toggle camera effects (+ overview camera) | DONE (Debug Lab PR) — render-only |
| export debug report | DONE (Debug Lab PR) — generate / copy / download JSON; replay section reports M9 as unsupported |

## Owner-reserved items touching M8

- **Main Menu entry for DEBUG LAB / SELF TEST** (GDD 1.2, 56): the menu's
  final visual treatment is behind the visual approval gate (GDD 1.6,
  171.10). Functional access is `?mode=debug-lab` meanwhile.
  BLOCKED BY OWNER — does not block other M8 items.
