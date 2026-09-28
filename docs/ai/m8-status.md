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
| this PR (M8 Debug Lab A) | `MatchSession` (shared live-match pipeline), Debug Lab mode, GDD 69 inspector, pause/step/restart/seed/speed, controller switching | open |

## GDD 144 headline items

| Requirement | Implementation | Evidence | Status |
|---|---|---|---|
| Inspectors | `src/debug/inspectors/buildInspection.ts`, Debug Lab panel | `tests/deterministic/matchSession.test.ts`, `tests/smoke/debugLab.spec.ts` | DONE (this PR) |
| Raw state | Same inspector: transform, linear, angular, surface, resources, combat, dodge, jump, Clash, AI, camera, performance, telemetry | same | DONE (this PR) |
| Force visualization | — | — | MISSING (next Debug Lab block) |
| Scenario presets | — | — | MISSING |
| Controller switching | `src/app/session/SideControllers.ts` — keyboard / AI (any archetype personality) / idle / scripted, per side, live | `matchSession.test.ts`, `debugLab.spec.ts` | DONE for the live lab (this PR); batch pairings with #31/Self Test |
| Batch tests | #31 `runAiBatch()` (headless) | #31 `selfTestBatch.test.ts` | PARTIAL — pending #31 merge + browser Self Test |
| Anomaly detection | #31: non-finite position, velocity/angular checks, crash, hang | #31 tests | PARTIAL — remaining GDD 67 detectors missing |
| Simulation acceleration | Debug Lab speed 1/2/4/8× = more fixed ticks per step (never a bigger delta); headless batches are unthrottled | `debugLab.spec.ts` (8× runs > 90 ticks/s) | PARTIAL — browser Self Test fast-forward via `stepManyTicks()` missing |
| Reports | #31 GDD 163 report object | #31 tests | PARTIAL — report view/export + Debug Lab "export debug report" missing |

## GDD 69 — inspectable data (Debug Lab)

All categories are shown. Gaps are labeled UNSUPPORTED in the panel with the reason:

- Match score — best-of-3 series scoring is not implemented yet (single round per match) — outside M8.
- Last state hash, divergence state — UNSUPPORTED (M9).
- Scale — rigid bodies have no scale (documented, not a gap).

## GDD 70 — Debug Lab controls

| Control | Status |
|---|---|
| pause / resume / single-step | DONE (this PR) |
| restart same seed / new seed (plus typed seed, copy seed) | DONE (this PR) |
| toggle AI control / automated controller, change AI profile | DONE (this PR) — AI personality per side; only one difficulty profile exists (tier list is an owner decision, GDD 59/171.4) |
| teleport, set velocity / angular velocity, set Stamina / Stability / Attack Energy, force attack state, reset cooldowns, trigger/prepare Clash | MISSING |
| visualize colliders, hitboxes, velocity, angular axis, forces/impulses, target path, ring-out boundaries | MISSING |
| toggle VFX layers, toggle camera effects | MISSING |
| export debug report | MISSING |

## Owner-reserved items touching M8

- **Main Menu entry for DEBUG LAB / SELF TEST** (GDD 1.2, 56): the menu's
  final visual treatment is behind the visual approval gate (GDD 1.6,
  171.10). Functional access is `?mode=debug-lab` meanwhile.
  BLOCKED BY OWNER — does not block other M8 items.
