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
| B | `ChaosBeyReplayV1` format, encode/decode/validate, recorder, config snapshot — pure modules, no call-site hooks | Contracts | no | TODO |
| C | `ReplayController`, recorder hooks at the three `tickMatch` callers, headless replay runner, checkpoint compare, first-divergence bisect | A + B | yes (after A) | IN PROGRESS (branch `claude/m9-c-playback`; the B-dependent parts wait for B on `main`) |
| D | `replay-reproduction` preset, batch divergence, Debug Lab and Self Test integration | C | via `DebugLabMode` | TODO |
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

**Waiting for B:**
- recorder hooks at the three `tickMatch` callers (`MatchSession`, the
  headless batches, the scenario runner), feeding B's `ReplayRecorder`;
- decoding `ChaosBeyReplayV1` into frames;
- building the playback world from `DeterministicConfigSnapshot`;
- refusing a replay whose fingerprint or versions don't match (GDD 77).

**Note for B/D:** a Debug Lab session with state mutations can't be
reproduced from its inputs alone (`MatchSession.getDebugMutations()`), so a
recording from such a session must be marked non-reproducible.

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
