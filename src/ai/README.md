# src/ai — opponent AI (Milestone 7)

Drives a Bey through the same `CombatController` interface a keyboard player uses (GDD 113). It never touches a rigid body, a cooldown or a resource: everything it does is a button press a player could make.

## Pipeline (GDD 62)

Each fixed tick, in `controllers/AIController.ts`:

1. **Perception** — `perception/AiPerception.ts` (+ `EdgeAwareness.ts`): what a spectator can see of each Bey (position, velocity, heading, public system states, resources). Dash charge is reported only while live.
2. **World state** — `decision/WorldState.ts`: distances, closing speed, short-horizon prediction (difficulty-scaled), own Circular reach.
3. **Risk** — `decision/RiskEvaluation.ts`: edge risk, opponent threat, own vulnerability, opportunity, punish window, edge pressure.
4. **Intent** — `decision/IntentSelection.ts` (pure): edge-recovery override (with hysteresis) → Circular counter read → threat override (dodge / jump / retreat) → scored candidates. Randomness is pre-rolled by the controller and passed in via `DecisionContext`.
5. **Deliberate error** — `errors/IntentionalError.ts`: may downgrade to Wait/Circle, never below a critical edge recovery.
6. **Action** — `decision/ActionSelection.ts`: turns the intent into held/pressed actions (steering discipline, reverse for back-away moves, Dash release on line, counter tap timing, center-side edge pressure).

Decisions refresh at the personality's reaction delay; actions are recomputed every tick. Commitments (a swing, a hop-into-drift, a counter stance while the opponent's Dash lasts) survive re-decisions.

## Data

- `personalities/` — per-archetype tendencies (GDD 64), including `counterAffinity`, `punishAffinity`, `edgePressureAffinity`.
- `difficulty/AiDifficultyProfile.ts` — internal multipliers only. Player-facing tier count/names are **[OWNER REQUIRED]** (GDD 59/171).
- `adaptation/AdaptationTracker.ts` — bounded nudges from observed opponent habits.

Tuning constants sit at the top of the file that owns them; shared distances/timings in `decision/AiCombatRanges.ts`. All values are engineering placeholders (GDD 167).

## Observability

- Debug overlay (F3) section "ai (second, M7)": ideal vs. active intent, reason, top considered scores, risks, reaction timer, action, adaptation.
- Telemetry: `AiDecision` on every fresh decision.

## Tests

- Unit: `tests/unit/Ai*.test.ts`.
- Integration (real physics, `tickMatch`): `tests/deterministic/ai*.test.ts`, including `aiTactics.test.ts` and the AI-vs-AI batch `aiBatchSelfTest.test.ts`.
- Runtime (real loop, hitstop, overlay): `tests/smoke/aiRuntime.spec.ts`. Headless tests do not cover hitstop freezes or runtime telemetry, which still live in `main.ts`.
