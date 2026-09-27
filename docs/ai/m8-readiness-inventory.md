# M8 readiness inventory

Written while M7's closure-audit PR (#26) was pending review/CI, per
owner instruction: an inventory of what M8 (comprehensive inspectors, raw
state, force visualization, presets, controller switching, batches,
anomaly detection, simulation acceleration, reports) can already build
on, so whoever starts M8 doesn't spend hours rediscovering the
architecture. **Nothing here is implemented** — this is a map, not code.
No M8 feature (a Debug Lab UI, a batch-runner UI, simulation
acceleration) was started.

## 1. AI state already exposed

`src/ai/debug/AiDebugState.ts` — one read-only per-tick snapshot per
`AIController` instance (`getDebugState()`), already covering every field
GDD section 65 asks a Debug Mode to show (verified field-by-field against
the live overlay in `docs/ai/m7-hardening-report.md` §3): personality/
difficulty id, ideal vs. active intent + reasons, full considered-scores
array (not just the summary the overlay renders), Clash-willingness
multiplier, deliberate-error flag, dodge-roll outcome, observed/predicted/
aim position, prediction horizon/strength, distance, the four risk
fractions (edge/opponentThreat/selfVulnerability/opportunity), reaction
timer, pending late-reaction intent + remaining delay, a one-line chosen-
action summary, and the three adaptation EMAs. M8's inspector UI can read
this directly — no new AI-side plumbing needed for a first version.

**Gap for M8**: `difficultyProfileId` is a string id, not the profile's
five numeric multipliers. Fine today (only one profile exists, all
multipliers = 1); an inspector that wants to show *why* a non-default
profile behaves differently will need `AiDifficultyProfile`'s fields
added to `AiDebugState` (or read directly, since `AIController` already
holds a reference) — small, additive, no behavior change.

## 2. Telemetry events already recorded

`src/telemetry/events/TelemetryEvent.ts`'s `TelemetryEventKind`: `AppBoot`,
`Error`, `PhysicsAnomaly`, `MovementImpact`, `Hit`, `StabilityDamage`,
`StabilityBreak`, `Knockback`, `RingOut`, `Ko`, `RoundEnd`, `Dodged`,
`PerfectDodge`, `ClashStart`, `ClashMashInput`, `ClashResult`, `ClashEnd`,
`AiDecision`. Recorded through `TelemetryRecorder` (`src/telemetry/
recording/TelemetryRecorder.ts`), which `main.ts` already wires up for
the live game.

- **`AiDecision`** (recorded in `AIController.adoptDecision`, every fresh
  decision): personality id, intent, reason, `deliberateErrorApplied`,
  `edgeRiskFraction`, `opponentThreatFraction`, `extraReactionDelayS`, and
  the **full** considered-scores array — already a strict superset of
  what the live overlay shows. An M8 report/replay tool can reconstruct
  "what did the AI think and why" purely from this stream.
- **`PhysicsAnomaly`** (recorded in `main.ts`, from
  `src/physics/diagnostics/physicsSafety.ts`'s `checkLinearVelocity`/
  `checkAngularVelocity`): NaN/Infinity/implausible-magnitude detection
  **already exists and is wired into the live game loop** — but **not**
  into the headless test/batch-runner path (`tickMatch()`/
  `aiMatchRunner.ts`/`CombatHarness`). This hardening pass's own
  throwaway 1,350-match probe (`docs/ai/m7-hardening-report.md` §1) had
  to check this independently with ad hoc `Number.isFinite` calls because
  of that gap. **Concrete, low-risk M8 (or earlier, batch-runner-infra)
  task**: call `checkLinearVelocity`/`checkAngularVelocity` from inside
  `runAiMatch`'s own `onTick` (or `tickMatch` itself) and record/report
  through the same `PhysicsAnomaly` kind — the utility and the event kind
  already exist, they're just not connected to headless batches yet.

## 3. Batches that already exist

All real `tickMatch()`/`CombatHarness` runs, not simplified stand-ins:

- `tests/deterministic/aiArchetypeMatrix.test.ts` — every archetype
  pairing, asserts on *observed* behavioral differences (initiation rate,
  Dash rate, counter rate, patience), not just config.
- `tests/deterministic/aiBatchSelfTest.test.ts` — GDD-named "AI vs AI
  batch self-test."
- `tests/deterministic/aiStabilityBatchExtended.test.ts` — opt-in
  (`AI_STABILITY_BATCH=1`), 40 seeds × 9 pairings = 360 matches, asserts
  stalled-attack/press-spam/mutual-idle/unresolved-round budgets, logs
  (doesn't fail on) two known physics-layer categories.
- `tests/deterministic/aiVsPlayerStandIn.test.ts` — each archetype's real
  `AIController` against a deliberately plain, non-adaptive stand-in
  (`playerStandInController.ts`), since this headless environment has no
  human playtester.
- **This hardening pass's throwaway probe** (150 seeds × 9 pairings =
  1,350 matches + non-finite-state + stuck-Clash + determinism-at-scale
  checks; not committed — see `docs/ai/m7-hardening-report.md` §1) is a
  reasonable template for an M8 "hardening" preset (§5 below), but was
  deliberately not made permanent, since running it every CI cycle would
  cost real time for marginal signal beyond the 360-match batch.

All of the above share one runner: `tests/deterministic/
aiMatchRunner.ts`'s `runAiMatch(setup)` — seed, two `BeyDefinition`s,
optional personalities/difficulty override, optional `maxTicks`, and an
`onTick` hook for extra per-tick invariant checks — returning a rich
`AiMatchStats`/`AiSideStats` behavioral summary (intent-tick histogram,
attack counts, punish/counter counts, dodges, jumps, hits landed/dodged,
deliberate-error count, idle/stalled/wedged/near-edge streaks, press
rate, mean radius, final Stamina). **This is already most of what a batch
runner backend needs** — M8's job is a UI/orchestration layer on top of
`runAiMatch`, not a new execution engine.

## 4. Controllers already swappable

`tickMatch()`/`CombatHarness` only depend on the `CombatController`
interface (`sampleActions(context): ControllerActions`) — never on which
concrete implementation is behind it. Existing implementations:

- `KeyboardController` (`src/input/devices/KeyboardController.ts`) — real
  player input.
- `AIController` (`src/ai/controllers/AIController.ts`) — the M7 AI.
- `ScriptedController` (`src/automation/scripted-scenarios/
  ScriptedController.ts`) — deterministic physics self-tests (M1).
- `IdleController` (`src/automation/scripted-scenarios/
  IdleController.ts`) — a no-op stand-in.
- `playerStandInController.ts` (test-only) — the plain non-adaptive
  stand-in `aiVsPlayerStandIn.test.ts` uses.

An M8 "controller switching" UI (swap either side between Keyboard/AI/
Scripted/stand-in live, or in a batch config) needs no new controller
abstraction — it already exists and is already exercised by every test
above using a different pairing of controllers on the same
`CombatHarness`/`tickMatch()` path.

## 5. Deterministic scenarios already available

- `SeededRng` (`src/rng/SeededRng.ts`) + `RngStreams` — separate
  gameplay/AI/cosmetic RNG streams from one canonical, human-typeable
  seed (GDD section 73). Every AI test already seeds via
  `SeededRng.fromSeedText(...)`.
- `CombatHarness` (`tests/deterministic/combatHarness.ts`) — two real
  Beys through real physics/`tickMatch()`, headless, no renderer. Already
  the shared foundation for every deterministic AI test.
- Every existing AI test file is itself a named, reproducible scenario
  (e.g. "AI air recovery timing," "AI Clash willingness," "AI slow-to-
  react critical preemption") — see §6 for which ones read as natural
  Self-Test presets as-is.

## 6. Tests that could become Self-Test presets largely unchanged

GDD's Self Test is asked to support batches, AI-vs-AI, acceleration,
reduced rendering, automatic telemetry, assertions, seeds, and failure
reports. Candidates already shaped like a preset (a name, a fixed setup,
a pass/fail signal), needing only a UI wrapper, not new logic:

- **"Archetype matrix"** ← `aiArchetypeMatrix.test.ts` (every pairing,
  behavioral-difference assertions already built in).
- **"Extended stability sweep"** ← `aiStabilityBatchExtended.test.ts`
  (already parameterized by seed count; today fixed at 40, trivially
  raisable to whatever an M8 UI's slider asks for).
- **"vs. non-adaptive stand-in"** ← `aiVsPlayerStandIn.test.ts`.
- **"Air recovery timing"** / **"Clash willingness"** / **"Slow-to-react
  critical preemption"** ← their matching single-purpose deterministic
  test files, each already a narrow, named, reproducible scenario.
- **"Hardening sweep"** (not yet a file) ← this session's throwaway
  1,350-match + non-finite/stuck-Clash/determinism-at-scale probe (§3) is
  a ready-made template if M8 wants a heavier, opt-in preset above the
  permanent extended batch.

## 7. What's still missing (real M8 work, not pre-work)

For completeness, not as a to-do list to start now:

- No UI: no inspector panel, no batch-runner control surface, no report
  viewer. All of the above is backend/data only.
- No simulation acceleration (more fixed ticks per second, rendering
  reduced/off) — GDD explicitly scopes this to M8; `runAiMatch` already
  runs headless with no renderer, so the "reduced rendering" half is
  trivially already true for every batch above, but the "more fixed
  ticks per wall-clock second than production's own loop" half doesn't
  exist yet (each `runAiMatch` call is a straightforward fixed-tick
  `while` loop, not a batch scheduler).
- No anomaly-detection *reporting* layer (only ad hoc, per-probe
  `console.log`/`expect` assertions today) — `PhysicsAnomaly` telemetry
  exists (see §2) but nothing aggregates/surfaces it across a batch run
  yet.
- No force-visualization data path — out of AI's own lane regardless
  (physics/rendering).
