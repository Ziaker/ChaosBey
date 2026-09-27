# src/self-test — self-test core (Milestone 8)

Runs real matches headless, as fast as the CPU allows, and reports them. It is the shared core behind the deterministic AI-vs-AI suite and, later, the Debug Lab / Self Test screens (GDD 114, 144, 162–164). It contains no test framework and no assertions.

## Pieces

- `SelfTestMatchWorld.ts` — one match built from the game's own production pieces: the Rapier world, the arena colliders, two Beys, the round rules and the Clash orchestration. It is advanced one fixed tick at a time by the same `tickMatch()` that `main.ts` uses. It defaults to the live game's spawns (`app/bootstrap/matchSpawns.ts`) and has no renderer. `dispose()` frees the Rapier world. The test suite's `CombatHarness` is a thin subclass of it.
- `AiMatchSimulation.ts` — `simulateAiMatch()` plays one AI-vs-AI round to its end (or `maxTicks`). It returns:
  - the outcome;
  - a per-side behavior summary (intents, attacks, presses, idling, stalls, wedging);
  - physics anomalies: non-finite positions and `physicsSafety.ts`'s velocity checks. The first 20 are kept and all of them are counted;
  - tick timing.

  Seeding is `SeededRng.fromSeedText(\`${seed}/first\`)` and `…/second`, so a seed always replays the same match.
- `AiBatchRunner.ts` — `runAiBatch()` plays every matchup × seed and returns the GDD 163 report: matches, pass/fail, seeds, crashes, hangs, invalid states, average duration, ring-outs, KOs, Clash count, divergence, performance anomalies and failures. `summarizeAiBatch()` is the pure part.

## Report rules

- **Failure reasons.**
  - `crash`: the simulation threw. The batch records it and goes on.
  - `invalid-state`: any physics anomaly.
  - `hang`: the round is still `Ongoing` at `maxTicks` (default 6000 ticks, about 100 s).
- **Seeds.** Every failure keeps its exact match seed (`${seed}/${first.id}-vs-${second.id}`), so the match can be replayed.
- **Performance anomalies.** Ticks slower than one 60 fps frame (`slowTickThresholdMs`) are reported, not failed.
- **Divergence.** It is `{ status: 'unsupported', count: null }` until Milestone 9 brings state hashes and replay playback (GDD 145). It is never reported as `0`.

## Acceleration

- **Headless:** matches simply run one fixed tick after another, with no rendering. There is no bigger `deltaTime` (GDD 164).
- **In the browser (Debug Lab, a later PR):** acceleration uses `FixedTimestepLoop.stepManyTicks()`, keeping the fixed delta.
