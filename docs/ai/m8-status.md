# M8 status — Debug Lab / Self Test expansion

Checklist for Milestone 8 (GDD section 144, detailed by sections
1.2, 65–71, 162–164). **M8 is complete on `main@fb93e05`:** every item is
DONE except the ones below marked UNSUPPORTED (M9) or BLOCKED BY OWNER.
Status values:

- **DONE** — implemented, tested and merged to `main`;
- **PARTIAL** — some of the requirement exists, the rest is listed;
- **MISSING** — not built yet;
- **UNSUPPORTED (M9)** — depends on replay/state hashes, which GDD section 145 schedules for Milestone 9; reported as unsupported, never faked;
- **BLOCKED BY OWNER** — needs a decision reserved to the owner; does not block other M8 items.

## PRs

| PR | Scope | State |
|---|---|---|
| #31 | Shared headless Self-Test core (`src/self-test/`), AI batch runner, typed GDD 163 report | merged (`6bd4024`) |
| #33 | Debug Lab: `MatchSession`, `?mode=debug-lab`, GDD 69 inspector, pause/step/restart/seed/speed, controller switching, GDD 70/71 visualization, presentation toggles, logged mutations, JSON debug report | merged (`dc0f40b`) |
| #34 | GDD 67 anomaly detector, GDD 68 scenario presets, steppable batch, browser `?mode=self-test` | merged (`fb93e05`) |

## GDD 144 headline items

| Requirement | Implementation | Evidence | Status |
|---|---|---|---|
| Inspectors | `src/debug/inspectors/buildInspection.ts`, Debug Lab panel | `matchSession.test.ts`, `debugLab.spec.ts` | DONE (#33) |
| Raw state | Same inspector: transform, linear, angular, surface, resources, combat, dodge, jump, Clash, AI, camera, performance, telemetry, anomalies | same | DONE (#33; anomalies row #34) |
| Force visualization | `src/debug/visualization/DebugVisualLayers.ts` | `debugVisualLayers.test.ts`, `debugLab.spec.ts` | DONE (#33) |
| Scenario presets | `src/self-test/scenarios/` — all 18 GDD 68 presets; headless runner + Debug Lab loader | `scenarioPresets.test.ts`, `sessionScenarios.test.ts`, `selfTest.spec.ts`, `debugLab.spec.ts` | DONE (17) + UNSUPPORTED (M9): Replay Reproduction |
| Controller switching | Debug Lab: keyboard / AI (any personality) / idle / scripted per side, live. Self Test: AI vs AI, scripted vs AI, scripted vs scripted | `matchSession.test.ts`, `selfTestStepped.test.ts` | DONE |
| Batch tests | #31 `runAiBatch()`; `AiBatchSession` (steppable, same code); browser Self Test | #31 tests, `selfTestStepped.test.ts`, `selfTest.spec.ts` | DONE |
| Anomaly detection | #31 physics-safety checks + `src/self-test/anomalies/MatchAnomalyDetector.ts` (every GDD 67 item; divergence UNSUPPORTED M9) in batches, scenarios and the live Debug Lab | `matchAnomalyDetector.test.ts`, `sessionScenarios.test.ts` | DONE |
| Simulation acceleration | Headless: unthrottled fixed ticks. Browser Self Test: 1×–64× fixed ticks per step or "max" per-frame budget. Debug Lab: 1–8×. Never a bigger delta | `selfTest.spec.ts` (1× ≈ 60 ticks/s, 64× > 4× that), `debugLab.spec.ts` | DONE |
| Reports | GDD 163 batch report (+ anomaly kinds, known issues, unknown invalid states, warnings), scenario results, Self Test JSON download; Debug Lab `ChaosBeyDebugReportV1` | `selfTestBatch.test.ts`, `selfTestStepped.test.ts`, `debugMutations.test.ts`, smokes | DONE |

## GDD 66 — Self Test mode

| Item | Status |
|---|---|
| one deterministic scenario | DONE — any preset, "Run preset" |
| batches of scenarios | DONE — "Run all presets" |
| AI vs AI | DONE — matchups × seeds |
| scripted-controller vs AI | DONE — preset with one side swapped for the AI |
| scripted vs scripted | DONE — presets |
| fast-forward / acceleration | DONE |
| optional rendering disable/reduction | DONE — headless core, 2D minimap, no 3D renderer |
| automatic telemetry capture | DONE — per-match stats, anomalies, detections in the report |
| pass/fail assertions | DONE — per match and per preset |
| seed logging | DONE — every match seed in the report; failing seeds copyable and replayable |
| automatic failure report | DONE — failures list + JSON |

## GDD 67 — automated failure detection

Every item is covered (see the table at the top of `MatchAnomalyDetector.ts`); "replay/state hash divergence" is UNSUPPORTED (M9). Thresholds are documented in that file.

## GDD 69 — inspectable data (Debug Lab)

All categories are shown. Gaps are labeled UNSUPPORTED in the panel with the reason:

- Match score — best-of-3 series scoring is not implemented yet (single round per match) — outside M8.
- Last state hash, divergence state — UNSUPPORTED (M9).
- Scale — rigid bodies have no scale (documented, not a gap).

## GDD 70 — Debug Lab controls

| Control | Status |
|---|---|
| pause / resume / single-step | DONE (#33) |
| restart same seed / new seed (plus typed seed, copy seed) | DONE (#33) |
| toggle AI control / automated controller, change AI profile | DONE (#33) — AI personality per side; only one difficulty profile exists (tier list is an owner decision, GDD 59/171.4) |
| teleport, set velocity / angular velocity, set Stamina / Stability / Attack Energy, reset cooldowns | DONE (#33) — every call logged + `DebugMutation` telemetry |
| force attack state for test scenarios | DONE (#33) — through real inputs via `ForcedInputController`, never by writing state |
| trigger/prepare Clash | DONE (#33) — the real 150 ms window decides |
| visualize colliders, hitboxes, velocity, angular axis, forces/impulses, target path, ring-out boundaries (+ contacts, normals, lock-on) | DONE (#33) |
| toggle VFX layers, toggle camera effects (+ overview camera) | DONE (#33) — render-only |
| export debug report | DONE (#33) |
| load scenario preset | DONE (#34) |

## Real problems the Self-Test found (future work, not M8)

- **ext-32 wall collider** (already recorded, `docs/design-decisions/motion-approval.md` §10.2 / §13.6): Beys end up inside the edge wall band (`stuck-in-wall`). It is the only invalid state the Self-Test has seen; it is reported as a failure tagged `ext-32`, not hidden.
  - Sweep `m8-sweep-0..19` × all 9 matchups (180 matches, live spawns): 0 crashes, 0 hangs, 0 warnings; **25 matches (14%) invalid, all ext-32** (32 `stuck-in-wall` + 3 `below-floor` detections), `unknownInvalidStates` 0; 138 ring-outs, 40 KOs, 2 draws; 37 Clashes; average round 11.2 s.
  - The existing opt-in extended batch (`AI_STABILITY_BATCH=1`, 360 matches) still passes.
- **New consequence of ext-32:** a Bey pushed past the floor edge (r > 12 m) but still inside the ring-out radius (12.9 m) falls off the world with no ring-out (`below-floor`, tagged `ext-32`). Reproducible from seed `self-test-5/stamina-prototype-vs-defense-prototype`. It belongs to the collider fix planned for integration, not to M8; no physics was changed.
- **Detector false positives fixed before merge:** dodge / Clash timers "stuck" during a Clash were the Clash freeze, not bugs; timer checks now ignore frozen ticks.

## Owner-reserved items touching M8

- **Main Menu entry for DEBUG LAB / SELF TEST** (GDD 1.2, 56): the menu's
  final visual treatment is behind the visual approval gate (GDD 1.6,
  171.10). Functional access is `?mode=debug-lab` / `?mode=self-test`.
  BLOCKED BY OWNER — does not block other M8 items.
