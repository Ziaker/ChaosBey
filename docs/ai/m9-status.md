# M9 status — Replay, state hashes, divergence

Checklist for Milestone 9 (GDD sections 75, 76, 77, 145, 153). Updated by
every M9 PR. Shared contracts live in `src/replay/contracts.ts`; changing one
is a contract change and bumps its version.

Status values: **DONE** (merged and tested), **IN PROGRESS** (PR named),
**TODO**, **DEFERRED** (owner moved it out of M9).

## Owner decisions (2026-09-28, canonical)

1. **Hitstop belongs to the simulation.** It decides whether `tickMatch()`
   advances, so it can't be owned by the camera. The simulation owns the
   hitstop state; `MatchSession` freezes from it; the camera and VFX only read
   it. The headless Self Test applies the same rule. A replay never records a
   per-tick "frozen" flag.
2. **AI RNG: one independent stream per side**, derived from the canonical
   root seed: gameplay, `ai:first`, `ai:second`, cosmetic. The same derivation
   live, in the Debug Lab and headless, so one side's extra draws never shift
   the other's. Old Self Test seeds may change meaning; the scheme is
   versioned (`RNG_SCHEME_VERSION`).
3. **A replay carries the resolved deterministic config** (match config,
   resolved attack-profile overrides, spawns, Bey definitions). Playback never
   reads `localStorage` or the current defaults.
4. **The official hash is `CanonicalMatchStateV1`**, explicitly extracted and
   versioned. It is not `Rapier.World.takeSnapshot()`, which may exist later
   only as an optional diagnostic.
5. **Strict floats.** Only `-0 → +0` and NaN → one pattern are canonicalized;
   then a stable binary representation. No rounding. A tolerant comparator may
   exist for diagnosis only.
6. **Chromium is the only reference browser.** The guarantee: same build +
   same config + same seed + same inputs, in Chromium, gives the same hashes
   and the same result. Firefox is out of scope. The replay still carries a
   general fingerprint (format, schema and RNG versions, build/commit, Rapier
   version).
7. **Record and play back `ControllerActions`, per side, per fixed tick.** No
   raw keyboard events. Playback runs the real runtime through a
   `ReplayController`; there is no second simulator.
8. **Scope.** In M9: versioned schema, recording, playback, state hashes,
   divergence detection and reproduction, the serialization/import the Debug
   Lab and Self Test need, a real `replay-reproduction` preset, hardening.
   **DEFERRED:** IndexedDB, a match-history browser and player-facing history
   UX (only minimal technical persistence if strictly needed).

## Lanes

| Lane | Scope | Depends on | Touches `MatchSession.ts` | Status |
|---|---|---|---|---|
| Contracts | `src/replay/contracts.ts` + this file | — | no | DONE (#39) |
| A | M9-0 (hitstop into the simulation, RNG scheme 2) + `CanonicalMatchStateV1` + state hash | Contracts | yes (hitstop wiring, RNG) | DONE (#40) |
| B | `ChaosBeyReplayV1` format, encode/decode/validate, recorder, config snapshot — pure modules, no call-site hooks | Contracts | no | DONE (#41) |
| C | `ReplayController`, recorder hooks at the three `tickMatch` callers, headless replay runner, checkpoint compare, first-divergence bisect | A + B | yes (after A) | IN PROGRESS (branch `claude/m9-c-playback`, PR pending) |
| D | `replay-reproduction` preset, batch divergence, Debug Lab and Self Test integration | C | via `DebugLabMode` | IN PROGRESS (branch `claude/m9-d-integration`, on lane C; PR after #42 merges) |
| E | Deterministic hardening in Chromium: long AI-vs-AI replays, 1× vs max acceleration, headless vs browser | A/B partly, rest parallel with D | no | TODO |

A and B run in parallel: they share only `contracts.ts`. Only one lane at a
time edits `MatchSession.ts` (A, then C).

## Tick counting (contract)

Two counters, never mixed:

- **`TickIndex`**, zero-based: 0 is the first executed tick, which is the
  first controller sampling. Replay input frames are indexed by it.
- **`TicksCompleted`**: 0 is the initial state, before `TickIndex` 0;
  running `TickIndex` n brings it to n + 1 (`ticksCompletedAfter`).
  `CanonicalMatchState` and `StateCheckpoint` carry this, so a checkpoint's
  number always equals the state's own field, and the initial state can be
  checked.

Frozen ticks (hitstop or Clash) count in both.

## Lane A notes

- **One simulation.** `app/simulation/MatchStepper.ts` is the single
  per-tick step (hitstop check, controller sampling, `tickMatch()` unless
  frozen, hitstop update). `MatchSession`, the headless AI batches and the
  scenario runner all use it. `app/simulation/Hitstop.ts` owns the freeze;
  the camera only receives it. A test compares it tick for tick with the
  pre-M9 camera arithmetic, so live freeze timing is unchanged.
- **RNG scheme 2** is live: `createRngStreams` gives gameplay, `aiFirst`,
  `aiSecond` and cosmetic; live and headless derive them the same way.
- **What the hash covers.** `CanonicalMatchStateV1`
  (`src/replay/state/CanonicalMatchState.ts`): per Bey, the Rapier body
  (translation, rotation, linear/angular velocity, user force/torque,
  sleeping) and every gameplay system's `getDeterministicState()`; the
  round, both Clash parts and hitstop. A guard test fails if any system
  field is neither hashed nor excluded with a reason.
- **RNG is not in the hash** (refines the pre-implementation plan): the AI
  streams are consumed by controllers, and a replay records controller
  outputs, so playback never advances them; AI determinism is covered by
  the same-seed tests instead. The gameplay stream is not drawn by the
  simulation today; a test fails if that changes, and it then joins the
  schema with a version bump.
- **Proofs in `tests/deterministic/canonicalState.test.ts`:** same seed →
  identical hash every tick; a live AI-vs-AI match and a headless one with
  the same seed hash identically every tick, hitstop freezes included;
  scripted inputs likewise; rendering with any camera/VFX settings never
  changes the hash; FNV-1a 64 test vectors; strict floats (one ulp
  changes the hash).
- **Baseline changes (accepted):** the `clash-cooldown-collision` preset's
  second Dash moved from 7 s to 8 s; the ext-32 reproduction seed is now
  `self-test-32/defense-prototype-vs-stamina-prototype`.

## Lane B notes

Pure modules in `src/replay/format/`. None of them runs the simulation,
reads a controller or touches `localStorage`.

- **`ChaosBeyReplayV1`** has the fields `format`, `stateHashAlgorithm`,
  `fingerprint`, `config` (`DeterministicConfigSnapshot`), `frames`,
  `checkpoints` and `integrity`.
  - `frames[n]` is `{ tickIndex: n, first, second }`: both sides'
    `RecordedActions` for every tick from 0, with none skipped.
  - `checkpoints` are `{ ticksCompleted, hash }`, strictly increasing and
    within `[0, frames.length]`.
- **Deterministic encoding.** Keys are sorted at every level and there is
  no whitespace. JSON round-trips every finite double exactly, so the same
  replay always gives the same bytes. JSON writes -0 as 0, which the state
  hash already treats as equal.
- **`integrity`** is the FNV-1a 64 of all the other content. It detects a
  corrupted or hand-edited file. It is not a signature, since anyone can
  recompute it.
- **Strict decoding.** A file is either fully valid or refused, with every
  error listed by path and code:
  - malformed JSON;
  - wrong format;
  - an unsupported hash algorithm, RNG scheme, state schema or tick rate;
  - missing or unknown fields (at every level, including `matchConfig` and
    the attack profiles against this build's own shapes);
  - wrong types;
  - non-finite numbers (JSON reads `1e999` as Infinity);
  - unknown, unsorted or duplicated actions, and negative hold times;
  - an invalid, duplicate, out-of-order or missing `tickIndex`;
  - bad checkpoints;
  - an integrity mismatch.
- **`RecordedActions`** use sorted arrays and exact hold durations.
  `pressed` is not required to be a subset of `held`, because a UI action
  can be flushed as pressed with nothing held.
- **The config snapshot** is a detached copy of the resolved config plus
  this build's RNG scheme, state schema and tick rate. Each Bey is its id
  plus a digest of its gameplay content (physical, ratings, handling,
  attack). Presentation (particle, audio, appearance) is excluded: it never
  affects the simulation, and appearance holds functions.
- **The fingerprint** is the build version, commit and Rapier version.
  `compareFingerprints()` lists the mismatches. Refusing playback on a
  mismatch is the playback side's decision (lane C).
- **`ReplayRecorder`** takes a `TickIndex`, both sides' `ControllerActions`
  and an optional checkpoint, and returns a validated `ChaosBeyReplayV1`.
  It throws at once on a skipped or repeated `TickIndex`, or on a
  checkpoint that isn't for the state right after its tick.
- **Tests** are in `tests/replay/replayFormat.test.ts`:
  - fuzzed round-trips, exact floats included;
  - recording a real live AI-vs-AI match and decoding every tick back;
  - byte-identical re-encoding and key-order independence;
  - no `localStorage`;
  - the full rejection table.

  11 mutation checks on the validations are all caught.

## Lane C notes

Owner go-ahead (2026-09-28): lane C may build everything that doesn't
depend on lane B now; anything that consumes B's format or recorder is
integrated only after B is merged and `main` is green.

**Done without B (`src/replay/playback/`):**
- `ReplayController`: a `CombatController` that returns frame n for
  `TickIndex` n. It ignores `simulationFrozen`, because a recorded frame is
  already what the original controller returned after handling the freeze,
  and the replayed match freezes on the same ticks. It refuses to run past
  the recording (`ReplayExhaustedError`) and keeps its own copy of the
  frames.
- A `replay` `SideControllerSpec`, so a live `MatchSession` (and later the
  Debug Lab) plays back through the same path as play.
- `HeadlessReplayRun`: plays frames through `SelfTestMatchWorld` (the same
  `MatchStepper`) and emits `StateCheckpoint`s every N ticks plus the final
  state. The world must be built like the live match, including
  `NullAiMashSource`: a recorded AI's Clash presses are already in its
  frames.
- `compareCheckpoints()`: match, `diverged` (the last matching and the first
  mismatching `TicksCompleted`, which bound the window), or `incomplete`.
- `locateFirstDivergence()`: steps two runs in lockstep and returns the
  exact first differing `TicksCompleted`, the `TickIndex` that produced it,
  and the differing field paths. Runs are deterministic and a match is a
  few thousand ticks, so a linear re-run replaces snapshot bisection.

**Proofs (`tests/deterministic/replayPlayback.test.ts`):**
- A live AI-vs-AI match (1403 ticks, 211 of them frozen by hitstop) plays
  back headless with every per-tick checkpoint identical; the sparse
  checkpoints agree too.
- The same recording plays back in a live `MatchSession` with the identical
  hash on every tick.
- A single flipped movement input at a tick ≥ 900 is caught at exactly
  `TicksCompleted` k + 1: per-tick checkpoints close the window there, and
  the locator reports `TickIndex` k with the paths under `beys.first`. The
  mutated tick must be one where movement input is read: not frozen, no
  Active Clash, attack Neutral, and outside `MovementController`'s
  post-impact window, where input is deliberately ignored.
- Mutation checks, each caught: frame reuse on frozen ticks, an off-by-one
  in the locator's `TickIndex`, a compare that ignores mismatches, and a
  controller that doesn't copy its frames.

**Integrated after B merged (#41, `main` green):**
- **Recording at the three places that run ticks.** Each calls
  `ReplayCapture.afterTick()` right after its `MatchStepper` step:
  - `MatchSession.startReplayCapture()` / `finishReplayCapture()`, only
    from tick 0;
  - `AiMatchSetup.record` → `AiMatchRecord.replay`;
  - `ScenarioRunOptions.record` → `ScenarioResult.replay`.

  `ReplayCapture` holds each tick until the next one, so the final state is
  always checkpointed. By default it checkpoints every tick, so a
  divergence is pinned to the exact tick with no re-run.
- **Live recordings report Debug Lab state edits** (teleport, set
  resource, reset cooldowns, loading a preset) made while recording. They
  aren't inputs, so such a replay diverges at the tick right after the
  edit. Forced inputs aren't reported: they reach the match through the
  controllers, so the frames already contain them.
- **Playback (`playback/replayPlayback.ts`):**
  - `checkReplayCompatibility()` refuses a replay from another build (any
    fingerprint difference: build, commit, Rapier). It also refuses a Bey
    this build doesn't have, or has with different gameplay (the digest).
    `allowFingerprintMismatch` exists for diagnosis only.
  - It also refuses a replay without a checkpoint at `TicksCompleted` 0
    and at `frames.length` (`missing-boundary-checkpoint`), so `verified`
    always means that the initial and final states were reproduced.
    Intermediate checkpoints may be sparse.
  - `buildPlaybackWorld()` rebuilds the match from the replay's config
    alone: definitions resolved by id and digest, spawns, match config,
    and `NullAiMashSource`.
  - `framesFromReplay()` decodes the frames.
  - `playReplayHeadless()` plays through the real runtime and compares
    every stored checkpoint, returning `verified`, `diverged` (with the
    window) or `refused`. Live playback uses the `replay` controller spec
    in a `MatchSession` built from the replay's config.
- **Scenario recordings** start after the preset's `setup`. Playback must
  re-apply the same setup; the checkpoint at `TicksCompleted` 0 catches it
  when it doesn't.

**Proofs (`tests/deterministic/replayEndToEnd.test.ts`):**
- **Live → file → headless:** a 1403-tick fight with 211 hitstop-frozen
  ticks. Every per-tick checkpoint is reproduced, and the stored
  checkpoints equal the live session's own hashes.
- **Live → file → live `MatchSession`:** the identical hash on every tick.
- **AI batch hook:** per-tick and every-60 checkpoints, final state
  included, both verified.
- **Scenario hook:** verified with its setup; caught at `TicksCompleted` 0
  without it.
- **Refused:** a fingerprint from another build (and allowed with the
  diagnosis flag), an unknown Bey, and a Bey whose gameplay digest
  differs.
- **Refused when a re-sealed file lacks boundary checkpoints:** no
  checkpoints, only the initial one, or no final or no initial one. A
  replay with only the two boundaries still verifies.
- **Tampering:**
  - an edited file is refused at decode (integrity);
  - re-sealed edited inputs diverge inside the edited range, with a
    one-tick window;
  - a re-sealed altered checkpoint is caught at exactly that checkpoint.
- **Debug Lab:** a state edit is reported and diverges at the next tick; a
  forced input is not reported and still verifies.
- **Mutation checks,** each caught:
  - checkpoints labelled with the wrong tick count;
  - the final state not checkpointed;
  - the fingerprint not enforced;
  - the digest ignored;
  - wrong spawns;
  - the match config ignored;
  - the sides swapped;
  - a forced input counted as a state edit;
  - the scenario setup not re-applied;
  - the boundary-checkpoint refusal disabled.

## Lane D notes

- **`replay-reproduction` preset** (GDD 68, now supported). It records a
  real Attack vs Defense AI match (seed `replay-13`, up to 1200 ticks),
  exports it as `ChaosBeyReplayV1`, re-imports it, replays it through the
  real runtime and requires every checkpoint to match. Two negative
  self-checks run on re-sealed copies: edited inputs must diverge inside the
  edited range, and one altered checkpoint must diverge at exactly that
  checkpoint. Presets can carry a custom `run()`; the Debug Lab lists this
  one as "Self Test only". A playback blind to mismatches fails the preset.
- **Self Test divergence count** (GDD 163). With
  `AiBatchConfig.verifyReplays`, each match is recorded and, when it ends,
  replayed from its own recording. The world is rebuilt from the replay's
  config and played through the real runtime, inside the same tick budget,
  so the page stays responsive.
  - A replay that doesn't verify fails the match (`divergence`) and is
    listed with its first differing `TicksCompleted`.
  - An unverified batch reports "not checked", never 0.
  - The browser Self Test has a "Verify replays" option, on by default; its
    report shows "divergence 0 of N replays".
  - A state edit injected mid-match is caught at exactly the next state. A
    verdict forced to "verified" fails that test.
- **Debug Lab** (`DebugLabReplay.ts`, Replay panel, `window.__chaosBeyDebugLab`):
  - **Recording.** "Record from start" restarts and records from tick 0.
    "Stop & download" saves the `.json` and warns if Debug Lab state edits
    were made while recording.
  - **Playback.** "Import & play" decodes the file (refusing bad files),
    checks compatibility, and rebuilds the session from the replay's own
    config (never the Lab's `localStorage` overrides). It drives both sides
    with the replay controllers and compares the live state hash with every
    checkpoint as it ticks: "identical through TicksCompleted N",
    "DIVERGED at …" or "replay finished: VERIFIED". It stops at the end of
    the recording.
  - **Not playable in the Lab.** A replay of another matchup or with other
    spawns (e.g. a batch matchup) is refused with the reason: the Lab plays
    the live Attack vs Defense match.
  - **Inspector.** The "Replay / telemetry" section shows the real last
    state hash, the recording state and the divergence state.
  - **Debug report.** `replay` now carries the state hash and
    `idle`/`recording`/`replaying`.
  - **Status line.** It shows the latest message and "ROUND OVER" together,
    so a refusal is no longer hidden when the round has ended.
- **Smoke (Chromium):**
  - Debug Lab: record → download → import through the panel → VERIFIED
    live; a hand-edited file is refused (integrity).
  - Self Test: "0 of 2 replays", and the `replay-reproduction` preset
    passes.

## Known architecture facts (main@972f65d)

- Deterministic core: `tickMatch()` in `src/app/simulation/tickMatch.ts`,
  called by `MatchSession.tick()`, `stepAiMatchOnWorld()` (Self Test batches)
  and `runScenario()` (GDD 68 presets); each caller samples its own
  controllers.
- Hitstop today lives in `CombatCameraController` and is read by
  `MatchSession`; the headless world has none (fixed by lane A).
- RNG today: `MatchSession` shares one `ai` stream between both AIs; headless
  uses `${seed}/first|second` (fixed by lane A, scheme 2).
- Physics state that must be canonical includes each Bey body's
  translation, rotation, linear and angular velocity, the persistent user
  force/torque (`SpinController` uses `addTorque`) and the sleeping flag.
  Mass, damping, friction and restitution are set at build time from config.
- `replay-reproduction` is the only unsupported GDD 68 preset; lane D makes it
  real (record, export, import, play back, compare every checkpoint, plus a
  negative self-check that a mutated input is caught at the right tick).
