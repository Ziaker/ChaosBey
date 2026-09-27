# M7 — AI closure / audit report

Audit against the code on `main@c7a01e4` (the tip of `main` at the time
this audit started; this branch, `claude/vibrant-fermi-3rasf3`, was
already checked out from it). Owner request: close M7 technically —
audit the existing AI pipeline against the GDD/owner decisions and real
code/test behavior, fix real bugs found strictly inside the AI's own
lane, and leave everything else (physics, knockback, arena, visuals,
CI infra, final balance, difficulty *tier* choices) alone.

This audit does not re-litigate design already approved in earlier M7
passes (Part 2a/2b, alpha-readiness hardening) — `docs/ai/
m7-source-semantics-audit.md` already covers the source-semantics side in
detail and is treated as still current; this report focuses on behavior,
Clash real-AI wiring, personalities, intentional error/adaptation,
difficulty architecture boundaries, and the wall-wedge/launch physics
categories, plus running every required test.

## 1. Pipeline / "AI obeys the same rules as a player"

**PASS.** `AIController.sampleActions()` (`src/ai/controllers/
AIController.ts`) reads only public getters (`RigidBody.translation()/
linvel()`, `AttackController.getState()`, `DodgeController.getState()`,
`StaminaSystem.resource`, etc. — see `extractRawState`) and produces its
entire output through `ControllerActions` (held/pressedThisFrame), the
same contract `KeyboardController`/`ScriptedController` use. It never
touches a `RigidBody` directly, never writes a resource system, never
sets `dashOverride`, never reads a private/internal field. The pipeline
is intact: `extractRawState` → `perceiveCombatant` (perception) →
`buildWorldState` (world state) → `evaluateRisk` (risk) → `selectIntent`
(intent) → `maybeApplyIntentionalError` (deliberate error) →
`ActionSelector.selectActions` (action selection) → `ControllerActions`
(controller output). No teleport, no direct Stamina/Stability/cooldown
mutation, no privileged information found anywhere in this path.

## 2. Perception / targeting

**PASS.** Cross-checked against `docs/ai/m7-source-semantics-audit.md`'s
per-input table (still accurate against current code): dash-charge
staleness fix (M7 Part 2a) and the air-recovery phantom-window fix (M7
Part 2b) are both still in place and still covered by
`aiAirRecoveryPhantom.test.ts` / `tests/unit`'s dash-charge coverage.
Prediction (`WorldState.targeting`) keeps observed/predicted/aim strictly
separate; `predictedOpponentXZ` is `null` when prediction is off (not a
relabeled observed position — unit-tested in `AiWorldStatePrediction.test.ts`).
Range checks always use the real observed position, never the aim point.

## 3. Edge awareness and survival

**PASS.** `EdgeAwareness.ts`/`AiPerception.ts`'s `edgeRiskFraction`/
`projectedEdgeRiskFraction` and `IntentSelection.ts`'s edge-override
ladder (air recovery > edge-danger-with-live-hit > edge-danger alone >
Dash read > imminent-hit) match GDD section 129 and the M7 Part 2b
decisions. `aiEdgeAwareness`, `aiEdgeThreat`, `aiEdgeRecoveryBlocked`,
`aiAirRecovery*` all pass. No case found where the AI picks an evasion
that a safer alternative was available for; `EVASIVE_JUMP_MAX_EDGE_RISK`
specifically forbids the hop near the edge, and `evasionDirection`/
`edgeRecoveryDirection` never add a component toward the attacker or
straight out of the ring.

## 4. Attack and commitments

**PASS.** Commitment locks (`committedToAttack`/`committedToDrift`/
`committedToCounter` in `AIController.sampleActions`) correctly survive
reaction-delay-gated re-decisions and are correctly interrupted by a real
launch. `ActionSelection.ts`'s Dash charge/release/heading-alignment gate,
Circular tap-then-release, and CounterAttack's timed tap were exercised
via `aiCombatBehaviors`, `aiTactics`, `aiDodgeRollGranularity`,
`aiJumpDrift`, and the extended batch (§10) with no stuck attacks,
no double release, no press spam (`MAX_PRESSES_PER_SECOND` asserted in
the extended batch), and no contradictory intent-vs-input found.

## 5. Clash — real AI

**BUG FOUND AND FIXED.** See "Bug fixed" below. Everything else: **PASS**.

- (1) AI generates real mash during `ClashState.Active` — confirmed:
  `AIController.sampleClashMashActions` presses real `Action.Attack/
  JumpDrift/Dodge` through the same `ActionSelector.commit` contract, fed
  into `ClashOrchestration.tickActive` → `buildMashActionSet` →
  `ClashController.tick`.
- (2) Mash depends on personality/difficulty — confirmed:
  `effectiveRate = personality.clashMashRatePerSecond * difficulty.clashMashRateMultiplier`.
- (3) No duplicated contribution from a hidden `FixedIntervalAiMashSource`
  alongside the real AI — confirmed: `main.ts` wires
  `new ClashOrchestration(matchConfig, new NullAiMashSource())`; a
  regression test already guards this
  (`aiClash.test.ts`'s "NullAiMashSource must be used" case).
- (4)/(5) A tick never counts more than one mash event per combatant, and
  simultaneous Attack+JumpDrift+Dodge never counts as three — confirmed
  in `ClashMash.ts`'s `nextMashEventCount` (boolean OR of "any qualifying
  press this tick", not a sum) and in `buildMashActionSet` (a `Set`, not a
  count).
- (6) Hitstop/freeze never generates phantom mash — confirmed:
  `isHitstopActive` is explicitly forced to `false` for the whole
  Clash-Active branch in `main.ts`'s render loop, so
  `context.simulationFrozen` is never true while `ClashState.Active`; the
  two freeze mechanisms (hitstop vs. Clash's own presentation freeze)
  never overlap.
- (7)/(8) Exiting Clash returns the AI to normal behavior, and the AI must
  not carry Clash presses into normal combat — **this is where the bug
  was**, see below.

## 6. The three archetype personalities

**PASS.** `AiArchetypePersonalities.ts` gives Attack/Defense/Stamina
distinct data (never distinct code paths). Re-ran `aiArchetypeMatrix.test.ts`
and `aiArchetypeBehavior.test.ts`, which assert on *observed* batch
behavior, not config: Attack initiates far more (and far more Dashes)
than Defense/Stamina; Defense counters Dashes and punishes commitment far
more; Stamina plays the most patient game, Dashes least, and spends
Stamina slowest. No rebalancing was done — a win-rate skew alone is not a
bug per the owner's own instruction, and none of the archetypes showed
incorrect (as opposed to merely different) behavior.

## 7. Intentional errors / humanity

**PASS.** `IntentionalError.ts`'s `isCriticalDecision` hard-excludes
`AirRecover` and a critical edge recovery (`edgeRisk >= 0.85`) from ever
being downgraded or delayed — and `AIController.preemptPendingIfCritical`
additionally lets a critical decision override an already-pending late
reaction. Both mistake kinds (slow-to-react, intent downgrade to Wait/
Circle) are bounded (`MAX_EXTRA_DELAY_S = 0.4s`; downgrade only to a safe,
passive intent, never to something unsafe). `aiSlowToReact.test.ts` and
`aiSlowToReactCriticalPreemption.test.ts` both pass, including the
determinism check (same seed → same action sequence).

## 8. Adaptation

**PASS.** `AdaptationTracker.ts` keeps three named, bounded EMAs (no
unbounded accumulation — an EMA is bounded to [0,1] by construction) and
`applyAdaptationNudge` caps its bias to ±0.15 caution / ±0.1 aggression,
scaled by `effectiveAdaptationRate` — `rate <= 0` returns the personality
unchanged (adaptation rate 0 truly disables it), and a higher rate only
changes how fast/strongly the same bounded nudge applies, never the rule
itself. `AiAdaptationTracker.test.ts` passes. No new adaptation mechanic
was added.

## 9. Difficulty — internal architecture only

**PASS / respected as out of scope.** `AiDifficultyProfile.ts`'s own
header is explicit that tier count/names/UI are `[OWNER REQUIRED]` and
unresolved by design; `DEFAULT_AI_DIFFICULTY_PROFILE` is the only profile
defined, with all multipliers at 1 (no-op). This audit did not add,
rename, or choose any player-facing difficulty tier, and did not treat the
existing single internal profile as a decision to do so. Only the
internal multipliers (reaction delay, error rate, prediction, adaptation,
Clash mash rate) were exercised, all through existing tests.

## 10. Required tests

Run from a clean `npm install` on this branch (`node_modules` was not
present at audit start):

| Command | Result |
|---|---|
| `npm run typecheck` | **PASS** — 0 errors |
| `npm test` (Vitest, full suite) | **PASS** — 591 passed, 1 skipped (592) after both fixes and all 5 new regression-test cases (586 before this audit's changes) |
| `npm run build` | **PASS** |
| `npm run test:smoke` | **12 failed on this container** — every failure is `browserType.launch: Executable doesn't exist at .../chromium_headless_shell-1243/...`, i.e. this sandbox's pre-installed Chromium revision doesn't match what this `@playwright/test` version expects by default. This is exactly the documented escape hatch in `tests/smoke/playwright.config.ts` (`CHAOSBEY_PW_CHROMIUM_PATH`). Re-running the full suite with `CHAOSBEY_PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome` got **11/12 passing**, including both `tests/smoke/aiRuntime.spec.ts` cases (one observed a real Clash go Active → resolve → back to normal: `"Clash exercised (Active seen, then left Active)"`) — a sandbox/CI infrastructure characteristic, not an AI bug, left alone per scope (Loft's lane). The one remaining failure, `repeatedMatchStability.spec.ts` ("run 0: should reach RoundEnd within the budget"), did **not** reproduce in two isolated re-runs — one against this fix, one against the pre-fix `AIController.ts` (temporarily checked out via `git checkout HEAD~1 -- src/ai/controllers/AIController.ts`, then restored) — both passed cleanly. That test races a real match against a **wall-clock** budget (25s of real time per run) while software-rendering (SwiftShader) under this sandbox's shared CPU; a one-off slow tick during the full-suite run (heavy WebGL labs running back-to-back) is consistent with the config's own documented CPU-contention note, not a code regression from this fix. |
| `AI_STABILITY_BATCH=1 npx vitest run tests/deterministic/aiStabilityBatchExtended.test.ts` | **PASS** — 360/360 matches (40 seeds × 9 archetype pairings), 47 known-physics notes logged (not failures — see §12), 0 unresolved rounds beyond the 5% budget, 0 stalled-attack/press-spam/mutual-idle regressions. |

Also ran individually: `aiArchetypeMatrix`, `aiArchetypeBehavior`,
`aiBatchSelfTest`, `aiVsPlayerStandIn`, `aiAirRecovery`, `aiSlowToReact`,
`aiClashWillingness`, `aiHitstopFreeze`, and (via the corrected chromium
path) `aiRuntime` (smoke) — all pass. Every other `tests/unit` and
`tests/deterministic` AI file is included in the full `npm test` run
above (591 passed covers all of them, including
`AiAdaptationTracker`, `AiIntentionalError`, `AiWorldStatePrediction`,
`AiEdgeThreat`, `AiEdgeRecoveryBlocked`, `AiEvasionAndDodge`,
`AiArchetypeTraits`, `AiIntentSelection`, `AiPerceptionAndRisk`).

## 11. Out of this lane (found nothing new; noted for completeness)

No physics/knockback/collider/arena/visual/camera/VFX/HUD/replay/menu/
gamepad/CI-infra/final-balance change was made. The Playwright chromium
path issue above is CI/sandbox infrastructure (Loft's lane) — noted, not
touched beyond using the documented env var to still get a real result.

## 12. Wall wedge / excessive launches

**Confirmed as a physics-layer characteristic, not an AI decision bug —
left untouched, per instruction.** The extended 360-match batch
(`AI_STABILITY_BATCH=1`, this run) reproduces both known categories
already documented in `aiStabilityBatchExtended.test.ts`'s own header:

- **Early ring-out from a knockback launch**: `attack-prototype vs
  attack-prototype`, reproduces on the majority of seeds (e.g. `ext-0`,
  `ext-2`, `ext-3`, `ext-4`, `ext-5`, …), round decided by ring-out in
  ~1.75–1.77s (seed `ext-39`: 1.37s); also reproduces
  `attack-prototype vs stamina-prototype` (e.g. `ext-5`: 1.60s, `ext-6`:
  1.52s) and `stamina-prototype vs attack-prototype` (e.g. `ext-0`:
  1.98s). In every one of these the AI's chosen action was a normal
  attack input (Circular counter/Dash) — the physical result is
  `KnockbackTuning`'s upward-launch component carrying the loser out
  mid-air before any air-recovery input has a chance to matter, which is
  a knockback-tuning matter, not an AI input choice.
- **Wall wedge**: `attack-prototype vs defense-prototype`, seed `ext-7`
  (defense side pinned 6.3s) and seed `ext-32` (attack side pinned 16.1s;
  defense side held the same intent for 21.1s straight while correctly
  pressing forward against a collider it's physically pinned against —
  `longestWedgedTicks=0.0s` on that side despite the long same-intent
  streak, i.e. the *opponent* was wedged, not this side, and this side's
  own steady-forward intent while circling a pinned opponent is the
  correct read, not a decision loop).

These are logged (not asserted on) by the test itself for exactly this
reason, and this audit did not touch knockback, collider, or arena code
to "fix" them.

## 13. Result table

| Requirement | Real implementation | Test/evidence | Verdict | Files |
|---|---|---|---|---|
| Pipeline / controller-only rule | `AIController`, `ActionSelector` | Full source read; `AiActionSelection.test.ts` | PASS | `src/ai/controllers/AIController.ts`, `src/ai/decision/ActionSelection.ts` |
| Perception/targeting semantics | `AiPerception.ts`, `WorldState.ts` | `docs/ai/m7-source-semantics-audit.md` re-checked against current code; `AiWorldStatePrediction.test.ts` | PASS | `src/ai/perception/AiPerception.ts`, `src/ai/decision/WorldState.ts` |
| Edge awareness/survival | `EdgeAwareness.ts`, `IntentSelection.ts` | `aiEdgeAwareness/EdgeThreat/EdgeRecoveryBlocked/AirRecovery*` | PASS | `src/ai/perception/EdgeAwareness.ts`, `src/ai/decision/IntentSelection.ts` |
| Attack/commitments | `ActionSelection.ts`, `AIController.ts` | `aiCombatBehaviors`, `aiTactics`, extended batch | PASS | `src/ai/decision/ActionSelection.ts` |
| Clash — real AI mash, no double-count | `AIController.sampleClashMashActions`, `ClashMash.ts`, `ClashOrchestration.ts` | `aiClash.test.ts`; new regression `AiActionSelection.test.ts` | **BUG FIXED** | `src/ai/controllers/AIController.ts` |
| Archetype personalities | `AiArchetypePersonalities.ts` | `aiArchetypeMatrix.test.ts`, `aiArchetypeBehavior.test.ts` | PASS | `src/ai/personalities/AiArchetypePersonalities.ts` |
| Intentional errors never block critical recovery | `IntentionalError.ts` | `aiSlowToReact*.test.ts` | PASS | `src/ai/errors/IntentionalError.ts` |
| Adaptation bounded, rate-0 disables | `AdaptationTracker.ts` | `AiAdaptationTracker.test.ts` | PASS | `src/ai/adaptation/AdaptationTracker.ts` |
| Difficulty stays internal-only | `AiDifficultyProfile.ts` | Source read (own header is explicit) | PASS (respected as out of scope) | `src/ai/difficulty/AiDifficultyProfile.ts` |
| Required test commands | — | See §10 | PASS (smoke needs `CHAOSBEY_PW_CHROMIUM_PATH` on this sandbox — infra, not AI) | — |
| Wall wedge / launch physics | — | Extended batch, seeds logged above | GAP (physics lane, documented, not fixed here) | n/a (for the physics lane) |

## Bug fixed (follow-up, from PR review): the dedicated Clash-mash selector must reset between separate Clashes

A review on the PR for this audit (reviewing HEAD `72970d2`) correctly
flagged a residual instance of the same leak the fix below closes:
`clashMashActionSelector` stops the Clash→normal-combat leak, but nothing
ever calls `commit()` on it between two separate Clashes (Cooldown/Idle,
normal combat in between) to clear its bookkeeping on its own. If Clash
A's last mash tick held `Action.Attack`, and Clash B's first mash tick
also happens to pick `Attack`, the still-unreset selector read `Attack`
as already held and produced no fresh `pressedThisFrame` — losing Clash
B's first mash event.

**Fix.** Added `ActionSelector.reset()` (clears `previousHeld`,
`holdStartedAtTick`, `currentTick`), and `AIController` now calls
`clashMashActionSelector.reset()` on the Idle/Cooldown → Active edge
(tracked via a new `wasClashActive` field), i.e. at the start of every
new Clash, before that Clash's first mash tick.

**Regression tests.**
- `tests/unit/AiActionSelection.test.ts`, new `describe('ActionSelector —
  dedicated Clash-mash selector must reset between separate Clashes (M7
  audit follow-up)')`: one case reproduces the gap on `ActionSelector` in
  isolation (repeated Attack across two unreset Clashes loses the second
  one's first event), one proves `reset()` fixes it.
- **Second review round** (on HEAD `da5cec4`) correctly pointed out that
  the isolated-`ActionSelector` tests above don't exercise the actual
  wiring in `AIController` — the bug was in whether `wasClashActive` and
  the real `clashMashActionSelector.reset()` call fire correctly on a real
  Idle/Cooldown → Active edge, not in whether `reset()` itself works.
  Added `tests/deterministic/aiClash.test.ts`'s new "regression: a real
  AIController resets its Clash-mash bookkeeping between two separate
  Clashes, through the controller itself" case: drives a real
  `AIController` (via `CombatHarness`, real physics) through two full,
  separate Clashes with a forced-deterministic RNG (`Object.create(base)`
  override, same pattern `aiSlowToReactCriticalPreemption.test.ts` already
  uses) that makes every Clash-mash roll succeed and always pick
  `Action.Attack` — so Clash A's last mash tick and Clash B's first mash
  tick are guaranteed to both be Attack, deterministically, no lucky seed
  needed. Between the two Clashes it calls `ai.sampleActions()` on a real
  Idle tick (exactly like `main.ts`'s per-tick loop), so the real
  `wasClashActive` transition is what triggers the reset, not a hand-set
  flag. Asserts Clash B's first tick actually presses (`pressedThisFrame`,
  not just `held`) Attack. **Verified this test is not vacuous**: with the
  `AIController`'s reset call temporarily disabled, this exact test fails
  (`expected false to be true` on the fresh-press assertion); restoring
  the call makes it pass again — confirmed before finalizing.

**Files changed (this follow-up):** `src/ai/decision/ActionSelection.ts`,
`src/ai/controllers/AIController.ts`, `tests/unit/AiActionSelection.test.ts`,
`tests/deterministic/aiClash.test.ts`.

## Bug fixed: Clash-mash held state leaking into normal combat

**What was wrong.** `AIController.sampleClashMashActions` (the AI's real
Clash mash path) and the normal-combat `ActionSelector.selectActions`
path shared one `ActionSelector` instance. `ActionSelector.commit()`
tracks `held`/`pressedThisFrame` as a diff against the *previous* tick's
held set, regardless of which of the two call sites produced that
previous tick. If the AI's Clash mash happened to be holding
`Action.Attack` on the tick the Clash resolved (Active → Cooldown), that
`Attack` stayed in the shared selector's "already held" bookkeeping. The
very next real decision after the Clash — if it wanted `AttackCircular`/
`AttackDash`/`PressAdvantage` and pressed `Action.Attack` — was diffed
against that stale "already held" state and produced **no fresh
`pressedThisFrame` press**. `AttackController.tick()` only starts an
attack from `AttackState.Neutral` on a real `pressedThisFrame` press
(never from `held` alone — see `src/combat/attacks/AttackController.ts`),
so that attack was silently swallowed: the AI "wanted" to attack (`held`
had `Attack`) but the real attack system never saw it start, until some
later tick released the button for at least one frame. This is exactly
the failure mode item 8 of the audit brief asks to guard against ("the AI
must not carry Clash presses into normal combat").

Confirmed with a standalone probe before touching production code
(`ActionSelector.commit(new Set([Action.Attack]), dt)` followed by
`selectActions(AttackCircular, ...)` on the same instance →
`pressedThisFrame.has(Action.Attack)` was `false` while `held.has(Action.Attack)`
was `true`).

**Fix.** `AIController` now holds a second, dedicated `ActionSelector`
(`clashMashActionSelector`) used only by `sampleClashMashActions`; the
normal-combat path keeps its own `actionSelector` untouched by the mash.
The two never share `held`/`pressedThisFrame`/hold-duration bookkeeping
again, so a Clash-mash press can never suppress (or fabricate) a
normal-combat press. Verified this doesn't interact with hitstop: while
`ClashState.Active`, `main.ts`'s render loop forces `isHitstopActive:
false` for the whole branch, so `context.simulationFrozen` is never true
during Clash — the two freeze mechanisms never overlap regardless of
which `ActionSelector` is used.

**Regression test.** `tests/unit/AiActionSelection.test.ts`, new
`describe('ActionSelector — Clash-mash held state must not leak into
normal combat (M7 audit regression)')`: one case documents the bug on a
shared selector (still true of the class itself — sharing one instance
for two purposes is the orchestration bug, not a class defect), one case
proves separate selectors (the actual fix, mirroring what `AIController`
now does) let the same post-Clash decision press `Attack` for real.

**Files changed:** `src/ai/controllers/AIController.ts`,
`tests/unit/AiActionSelection.test.ts`.

## Remaining limitations

- Player-facing difficulty tier count/names/UI remain
  `[OWNER REQUIRED]` and untouched, as instructed.
- Wall wedge and early-launch ring-outs (§12) remain physics-layer
  matters for the Bey Motion Lab / physics lane, not fixed here.
- The Playwright smoke suite needs `CHAOSBEY_PW_CHROMIUM_PATH` set to
  this sandbox's actual installed Chromium revision to run at all; this
  is a pre-existing, already-documented escape hatch in
  `tests/smoke/playwright.config.ts`, not a new problem, and not touched
  beyond using it to get a real pass/fail result for the AI smoke specs.
