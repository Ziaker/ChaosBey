# M7 — hardening / regression-coverage / observability report

Follow-up to `docs/ai/m7-closure-audit.md`, run while PR #26 (the closure
audit's fixes) awaited CI/review. Per owner instruction: harden and
verify the existing M7 implementation using the tooling that already
exists — no new AI mechanics, no rebalancing, no M8 features (batch
runner UI, inspectors, simulation acceleration). Nothing in this report
changed AI behavior; where a probe found zero anomalies, nothing was
touched.

## 1. Large AI-vs-AI hardening sweep

The permanent extended batch (`tests/deterministic/
aiStabilityBatchExtended.test.ts`, opt-in via `AI_STABILITY_BATCH=1`)
covers 40 seeds × 9 archetype pairings = 360 matches. For this hardening
pass, a throwaway probe (not added to the permanent suite — 1,350 matches
plus the physics-safety instrumentation below would meaningfully lengthen
every future `AI_STABILITY_BATCH=1` run for marginal extra signal once
run once at this scale) ran **150 seeds × 9 pairings = 1,350 matches**,
covering every combination the owner asked for (attack×attack,
attack×defense, attack×stamina, defense×defense, defense×stamina,
stamina×stamina, and their mirrors) with added, stricter checks beyond
what the permanent batch already asserts:

- **Non-finite state**: every tick, both Beys' real `RigidBody`
  position and velocity (x/y/z) were checked with `Number.isFinite`. This
  is the same class of check `src/physics/diagnostics/physicsSafety.ts`
  already does for the live game (called from `main.ts`), but that
  utility isn't wired into `tickMatch()`/`runAiMatch()` itself, so this
  hardening pass exercised it independently at the AI-vs-AI batch level
  rather than assuming production's own diagnostic would have caught it
  here too.
- **Clash stuck Active**: flagged any Clash whose `Active` streak
  exceeded `CLASH_TARGET_DURATION_S` (4s) + 1s slack — a hang in the
  mash-resolution timer would show up here.
- Reused the permanent batch's own checks (stalled attacks, button spam,
  mutual idle, unresolved-round budget) at the larger N, to see whether
  40 seeds happened to be too few to catch something 150 would.
- **Determinism at scale**: 5 additional seeds, each run twice
  independently through `runAiMatch`, compared byte-for-byte on outcome,
  tick count, hits landed (both sides), `AttackDash` intent-tick count,
  Clash count, and mean distance.

**Result: 0 objective anomalies across all 1,350 matches** (no
non-finite state, no stuck Clash, no new stalled-attack/press-spam/
mutual-idle/unresolved-round finding beyond what the 360-match batch
already tolerates) **and exact determinism on every one of the 5 sampled
seeds** run twice. This is strong additional confidence beyond the
360-match batch, not a new finding — nothing here changed any code.

## 2. Regression-coverage audit

Reviewed existing coverage against the owner's list of areas that "have
implementation but maybe thin coverage": perception, prediction, edge
recovery, intentional errors, adaptation, attack commitments, Clash
transitions, reaction delay, airborne-state transitions, low resources,
opponent-near-edge.

Every one of these already has direct, targeted test coverage, not just
incidental exercise through the batch runners:

| Area | Coverage |
|---|---|
| Perception | `AiPerceptionAndRisk.test.ts` (edge distance/risk, speed, imminent-hitbox flag, per-field risk assertions), `aiTargetingDebug.test.ts` |
| Prediction | `AiWorldStatePrediction.test.ts`, `aiTargetingDebug.test.ts` (observed vs. predicted vs. aim, prediction-off case) |
| Edge recovery | `aiEdgeAwareness.test.ts`, `aiEdgeThreat.test.ts` + `AiEdgeThreat.test.ts`, `aiEdgeRecoveryBlocked.test.ts` + `AiEdgeRecoveryBlocked.test.ts` |
| Intentional errors | `AiIntentionalError.test.ts`, `aiSlowToReact.test.ts`, `aiSlowToReactCriticalPreemption.test.ts` |
| Adaptation | `AiAdaptationTracker.test.ts` (bounded nudges, rate-0 disables) |
| Attack commitments | `aiCombatBehaviors.test.ts`, `aiTactics.test.ts`, `AiActionSelection.test.ts` (Dash release/heading gate, Circular tap, counter timing) |
| Clash transitions | `aiClash.test.ts` (now 4 cases after the closure audit), `aiClashWillingness.test.ts` |
| Reaction delay | `aiSlowToReact.test.ts` (the delay mechanism itself); ordinary (non-error) reaction cadence is exercised throughout every deterministic AI test via `AIController`'s own gating |
| Airborne-state transitions | `aiAirRecovery.test.ts`, `aiAirRecoveryTiming.test.ts`, `aiAirRecoveryPhantom.test.ts`, `aiAirRecoveryDuringCharge.test.ts`, `aiAirDashDuringReactionDelay.test.ts`, `aiAirDashSweep.test.ts`, `aiJumpDrift.test.ts` |
| Low resources (own vulnerability, opponent fatigue) | `AiPerceptionAndRisk.test.ts`'s "reports higher selfVulnerability when Broken/low Stability" and "reports higher opportunity against a Broken opponent"; fatigue exploitation specifically referenced in `AiIntentSelection.test.ts`/`AiArchetypeTraits.test.ts` |
| Opponent near edge | `AiIntentSelection.test.ts`, `AiActionSelection.test.ts`'s "edge pressure" describe block, `aiClashWillingness.test.ts` |

**No coverage gap found that justified a new test.** Nothing was added
here — the owner's instruction was explicit that behavior should only
change (or tests only be added) if a real gap or bug turns up, and this
audit's own review (source read + the fact that the full 593-test suite
and both hardening sweeps above pass) didn't find one. The one
pre-existing thin spot — `physicsSafety.ts`'s NaN/Infinity checks not
being wired into `tickMatch()`/the AI batch runners themselves — was
worked around for this hardening pass's own probe (see §1) rather than
turned into a permanent addition, since the throwaway sweep already
proved 1,350 real matches never trip it; a permanent version of that
check is noted for the M8 batch-runner inventory instead of added here.

## 3. AI observability audit (data existing and correct, not new UI)

GDD section 65's Debug Mode requirement: "AI current target, current
intent, current decision, considered action scores where practical,
reaction timer, perceived opponent state, edge risk, predicted path,
chosen attack, why a dodge/jump was chosen, difficulty modifiers,
deliberate-error event if one occurred."

Checked `src/ai/debug/AiDebugState.ts` (the data contract) against
`src/debug/overlay/DebugOverlay.ts` (line ~196-207: the `-- ai (second,
M7) --` block) to confirm every field is both **present** and **actually
rendered**, not just defined and unused:

- Target/aim: `observedOpponentXZ` / `aimPositionXZ` — rendered as
  `target / aim`.
- Intent/decision: `idealIntent`/`idealIntentReason`,
  `activeIntent`/`activeIntentReason` — both rendered, with a
  `[DELIBERATE ERROR]` tag when one applied.
- Considered scores: `consideredScoresSummary` — rendered as `scores`.
- Reaction timer: `reactionTimerS` — rendered, plus `pendingIntent`/
  `pendingDelayRemainingS` for a late reaction in flight.
- Perceived opponent state / edge risk / opportunity: `edgeRiskFraction`,
  `opponentThreatFraction`, `selfVulnerabilityFraction`,
  `opportunityFraction` — all rendered on one `risk` line.
- Predicted path: `predictedOpponentXZ`/`predictionHorizonS`/
  `predictionStrength` — rendered, with an explicit "off (aims at the
  observed position)" case when prediction is disabled (never silently
  showing a stale or fabricated value).
- Chosen attack / why a dodge/jump was chosen: `chosenActionSummary` and
  `dodgeAttemptSucceeds` (rendered as `dodge roll: succeeds/fails` while
  `DodgeThreat` is active) — plus `activeIntentReason` already carries
  the "why" text for every intent, dodge/jump included.
- Deliberate-error event: `deliberateErrorApplied` — rendered as the
  `[DELIBERATE ERROR]` tag next to `active intent`.
- Difficulty modifiers: `difficultyProfileId` is rendered (`personality
  X / difficulty Y`), but the overlay shows the profile's **id**, not its
  five numeric multipliers (`reactionDelayMultiplier`,
  `errorRateMultiplier`, `predictionStrength` — already shown separately
  under `prediction` — `adaptationMultiplier`, `clashMashRateMultiplier`).

**One minor, non-blocking observation**: showing only the difficulty
profile's id (not its numeric multipliers) matches GDD 65 in spirit
today, because the only profile that exists
(`DEFAULT_AI_DIFFICULTY_PROFILE`) has every multiplier at 1 (a no-op) —
there is nothing numeric yet to show that the id doesn't already imply.
This becomes worth revisiting once a second, non-default internal
profile exists (still not a player-facing tier decision — see
`AiDifficultyProfile.ts`'s own header) and its multipliers actually
differ from 1. Noted for the M8/difficulty-tooling inventory below, not
changed here — showing multipliers today would just show five `1`s.

Also confirmed telemetry (`AIController.adoptDecision`'s
`TelemetryEventKind.AiDecision` record): personality id, intent, reason,
`deliberateErrorApplied`, `edgeRiskFraction`, `opponentThreatFraction`,
`extraReactionDelayS`, and the **full** (not summarized) `consideredScores`
array are all recorded on every fresh decision — a strict superset of
what the overlay shows, consistent with GDD 65's own distinction between
a live debug view and a recorded trace.

**No observability gap found.** All required data already exists and is
already correctly surfaced through both the live overlay and telemetry.
No new UI was built (that's M8's Debug Lab work, per the owner's own
scoping) — this was purely a check that M7 already did its part.
