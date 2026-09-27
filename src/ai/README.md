# src/ai — opponent AI (Milestone 7)

Drives a Bey through the same `CombatController` interface a keyboard player uses (GDD 113). It never touches a rigid body, a cooldown or a resource: everything it does is a button press a player could make.

## Pipeline (GDD 62)

Each fixed tick, in `controllers/AIController.ts`:

1. **Perception** — `perception/AiPerception.ts` (+ `EdgeAwareness.ts`): what a spectator can see of each Bey (position, velocity, heading, public system states, resources), plus the AI's own air-recovery window and Dodge affordability. Dash charge is reported only while live; edge risk also from the momentum-projected position. What each input really means over time: [`docs/ai/m7-source-semantics-audit.md`](../../docs/ai/m7-source-semantics-audit.md).
2. **World state** — `decision/WorldState.ts`: distances, closing speed, short-horizon prediction (difficulty-scaled), own Circular reach. `targeting` keeps the observed, predicted (null when prediction is off) and aimed-at opponent positions apart, with the prediction's horizon and strength.
3. **Risk** — `decision/RiskEvaluation.ts`: edge risk, opponent threat, own vulnerability, opportunity, punish window, edge pressure.
4. **Intent** — `decision/IntentSelection.ts` (pure): air recovery → edge danger + live hit (edge-safe evasion, part of the recovery) → edge recovery (with hysteresis) → Circular counter read → threat override (dodge / thrifty sidestep / stay grounded mid-dodge / hop only away from the edge / retreat) → scored candidates (all scores kept; attack candidates scaled by Clash willingness while a Clash could start). Randomness is pre-rolled by the controller and passed in via `DecisionContext`.
5. **Deliberate error** — `errors/IntentionalError.ts`: either a downgrade to Wait/Circle or a "slow to react" delay (the controller keeps its previous intent until the late decision lands); never on air recovery or a critical edge recovery (`isCriticalDecision`). While a late decision is pending the situation is still re-read at the reaction cadence, and a critical decision replaces it at once; anything else leaves it pending.
6. **Action** — `decision/ActionSelection.ts`: turns the intent into held/pressed actions (steering discipline, reverse for back-away moves, Dash release on line, counter tap timing, center-side edge pressure, sideways/inward evasion, Dodge aimed with the player's 8 key combinations and pressed only when it can start, one air-recovery press, going around an opponent blocking the way back from the edge, center-seeking circling).

Decisions refresh at the personality's reaction delay; actions are recomputed every tick. Commitments (a swing, a hop-into-drift, a counter stance while the opponent's Dash lasts) survive re-decisions — except a launch (air-recovery window), which interrupts them and is reacted to one reaction delay after the launch. A Dash charge being held when the launch lands is kept held for that whole flight — through the reaction delay (the previous intent can no longer release it), the air recovery and any later decision — until the Bey is back on the ground (releasing it would fire the Dash from the air). "Launched" is the air-recovery window, so a voluntary jump is unaffected: air attacks while jumping stay allowed.

## Data

- `personalities/` — per-archetype tendencies (GDD 64), including `counterAffinity`, `punishAffinity`, `edgePressureAffinity` (Part 2a) and `centerControl`, `collisionAvoidance`, `fatigueExploitation`, `dodgeThrift` (Part 2b; collision avoidance wears off with the anti-passivity tempo).
- `difficulty/AiDifficultyProfile.ts` — internal multipliers only. Player-facing tier count/names are **[OWNER REQUIRED]** (GDD 59/171).
- `adaptation/AdaptationTracker.ts` — bounded nudges from observed opponent habits.

Tuning constants sit at the top of the file that owns them; shared distances/timings in `decision/AiCombatRanges.ts`. All values are engineering placeholders (GDD 167).

## Observability

- Debug overlay (F3) section "ai (second, M7)": ideal vs. active intent, reason, top considered scores (debug state holds all; "[clash xN]" when Clash willingness shaped them), observed target vs. aim point, the prediction (position, horizon, trust — or "off"), risks, reaction timer, pending late reaction, action, adaptation.
- Telemetry: `AiDecision` on every fresh decision, with all candidate scores and any late-reaction delay.

## Tests

- Unit: `tests/unit/Ai*.test.ts`.
- Integration (real physics, `tickMatch`): `tests/deterministic/ai*.test.ts`, including `aiTactics.test.ts`, `aiEdgeThreat.test.ts`, `aiEdgeRecoveryBlocked.test.ts`, `aiAirRecovery.test.ts` (+ `aiAirRecoveryTiming`, `aiAirRecoveryPhantom`, `aiAirRecoveryDuringCharge`, `aiAirDashDuringReactionDelay`, the AI-vs-AI sweep `aiAirDashSweep`), `aiSlowToReact.test.ts` (+ `aiSlowToReactCriticalPreemption`), `aiClashWillingness.test.ts`, `aiTargetingDebug.test.ts`, the AI-vs-AI batch `aiBatchSelfTest.test.ts` and the archetype matrix `aiArchetypeMatrix.test.ts` (with `aiMatchRunner.ts`).
- Hitstop freeze boundary (headless, reproducing main.ts's freeze): `tests/deterministic/aiHitstopFreeze.test.ts`.
- Runtime (real loop, hitstop, overlay): `tests/smoke/aiRuntime.spec.ts` (two tests: hitstop/Clash/halt, and 600 simulated ticks of decisions/scores/aim).
- Extended stability sweep (opt-in, not run in ordinary CI): `tests/deterministic/aiStabilityBatchExtended.test.ts` — 360 matches (every archetype pairing x 40 seeds) via `AI_STABILITY_BATCH=1 npx vitest run tests/deterministic/aiStabilityBatchExtended.test.ts`. Run this after a change to `src/ai`, or periodically as a stabilization sweep. It asserts on genuine AI-behavior regressions (stalled attacks, button spam, mutual idle, unresolved rounds) and logs — without failing — two known physics-layer categories found during the 2026 M7 stabilization pass, out of M7's current scope (Bey Motion Lab owns physics/knockback/collision tuning for now):
  - A Circular counter landing on an active Dash can launch the dasher out of the arena mid-air before any air-recovery input matters (reproduces on `attack-prototype` vs `attack-prototype`, e.g. seed `ext-0`, round decided by ring-out in ~1.7s).
  - An AI can get wedged against the arena's edge collider while still correctly choosing to press forward — `AiSideStats.longestWedgedTicks` already names this a collision problem, not a decision bug — and the match can still resolve normally by KO once the pinned side's Stamina runs out, so it isn't caught by `aiArchetypeMatrix`'s "unresolved round" wedge check (reproduces on `attack-prototype` vs `defense-prototype`, seed `ext-32`).
