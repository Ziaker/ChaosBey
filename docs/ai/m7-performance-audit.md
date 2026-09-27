# M7 — AI performance audit (measurement only, no behavior change)

Per owner instruction: measure first, don't "creatively optimize." This
audit only measures; it changes no production code and no behavior. If a
real bottleneck had turned up, the plan was to fix it only if the fix
provably preserves determinism (same seed → same result) — none of the
measurements below found anything worth that risk.

Methodology: a temporary, throwaway probe (`tests/deterministic/
zzperf.test.ts`, deleted after this run — not part of the permanent
suite) drove the exact same production paths this audit's other work
already exercises: a real `AIController.sampleActions()` in isolation, and
full headless AI-vs-AI matches through the real `tickMatch()`/
`CombatHarness` orchestration via `aiMatchRunner.ts`'s `runAiMatch`.
Measured with `performance.now()` and `process.memoryUsage()`
(`--expose-gc` for a forced-GC memory sample), on this session's sandbox
container — absolute numbers will differ on other hardware, but the
*margins* below are wide enough that hardware variance doesn't change the
conclusion.

## `AIController.sampleActions()` cost in isolation

100,000 calls, no physics step (perception/world-state/risk/intent/
deliberate-error/action-selection only, on a stationary Attack-personality
pair):

- **Average: 3.79–4.29 µs/call.**
- 99.93% of calls finished under 100 µs.
- Only 3 of 100,000 calls exceeded 1 ms (worst: 3.4 ms) — consistent with
  an occasional V8 GC pause, not a systematic cost. Re-running showed a
  different, similarly rare, outlier count each time (never zero, never
  more than a handful) — a garbage-collector signature, not a per-call
  algorithmic spike.

At 60 Hz, one fixed tick's real-time budget is **16,667 µs**. Even the
*worst* observed single call (≈4 ms) is nowhere close to exhausting one
frame's budget on its own, and the typical call is over 4,000× smaller
than the budget.

## Full AI-vs-AI match cost (real physics, real `tickMatch()`)

Attack vs. Defense archetype, several match counts:

| Matches | Total wall time | Per-match avg | Ticks (all matches) | µs/tick |
|---|---|---|---|---|
| 1 | 535 ms | 535 ms | 1,398 | 383 (cold — JIT/first-run) |
| 10 | 710 ms | 71 ms | 7,085 | 100 |
| 100 | 5.59 s | 55.9 ms | 68,339 | 82 |

The first match is slower (JIT warmup, first physics-world allocation);
by 10–100 matches the steady-state cost is **~80–100 µs per simulated
tick** — this includes the *real* Rapier physics step, not just the AI's
own decision cost. That is still ~170–200× smaller than the 16,667 µs/tick
budget a production 60 Hz loop actually has. A 360-match extended-batch
run (this audit's §10) completes in ~24 s wall time for that reason — it
is not, and does not need to be, a performance concern today.

## Memory (leak sniff)

300 sequential headless matches (Attack vs. Stamina, forced GC every 50
matches via `--expose-gc`):

| After N matches | Heap used | RSS |
|---|---|---|
| 50 | 32.9 MB | 271.2 MB |
| 100 | 33.2 MB | 283.2 MB |
| 150 | 31.7 MB | 288.6 MB |
| 200 | 31.8 MB | 293.2 MB |
| 250 | 31.8 MB | 298.6 MB |
| 300 | 32.0 MB | 304.4 MB |

**Heap used is flat** (~32 MB, no growth trend across 300 matches) — no
JS-side leak in the AI's own decision code (`AIController`,
`AdaptationTracker`, `ActionSelector`, etc. never accumulate unbounded
state; this matches the source read in the main audit, where every
per-AI state field is either overwritten each decision or explicitly
bounded).

**RSS grows slowly** (~0.11 MB/match, ~33 MB over 300 matches). This
tracks a different, already-known cause, not an AI-code leak: each
`runAiMatch`/`CombatHarness.create()` call constructs a **new
`PhysicsWorld`** (a fresh Rapier WASM instance) per match — that's a
property of this *test harness's* per-match setup (real production only
ever has one `PhysicsWorld` for the whole process lifetime), not of the
AI. Confirmed by the shape of the growth: linear and small per match, and
heap (where an AI-code leak would show up first) stays flat throughout.
Not a finding to act on in this lane — noted for whoever eventually tunes
the batch-runner/self-test harness's own physics-world lifecycle (a good
candidate for `runAiMatch`'s test-harness lane, not AI, and not urgent at
this scale).

## Repeated per-tick work

Read (not just measured): `AIController.sampleActions()` calls
`extractRawState`/`perceiveCombatant`/`buildWorldState` exactly once per
own Bey and once per opponent Bey per tick — no duplicate perception
passes, no re-computation of the same value twice in one tick. Object
allocation per tick (a few small position/velocity/world-state records, a
`Set` for held actions) is the expected cost of the codebase's own
determinism/testability design (immutable per-tick snapshots — see the
main audit's pipeline section) and is already reflected in the µs/call
numbers above, which have plenty of headroom.

## Conclusion

**No action taken.** Nothing measured here is close to a real bottleneck
at today's scale (a single AI-vs-AI match, the 360-match extended batch,
or a future larger batch a few orders of magnitude bigger would still fit
comfortably in a human-scale wait). Per the owner's own rule (measure
before optimizing, and only touch it if it's actually where the cost is),
there is nothing here worth risking a determinism-affecting change for.
The one real opportunity — a self-test harness that reuses one
`PhysicsWorld` across many headless matches instead of one per match —
is a batch-runner/self-test infrastructure improvement, not an AI-code
change, and is noted here for the M8 preparation inventory
(`docs/ai/m8-readiness-inventory.md`) rather than acted on in this lane.
