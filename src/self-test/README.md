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
- `AiBatchRunner.ts` — `runAiBatch()` plays every matchup × seed and returns the GDD 163 report: matches, pass/fail, seeds, crashes, hangs, invalid states, average duration, ring-outs, KOs, Clash count, divergence, performance anomalies and failures. `summarizeAiBatch()` is the pure part. `AiBatchSession` is the same batch, steppable a bounded number of fixed ticks at a time (the browser Self Test drives it); `runAiBatch()` is that session run to completion, so both are one code path. `stepAiMatchOnWorld()` is the per-match loop as a generator.
- `anomalies/MatchAnomalyDetector.ts` — the GDD 67 checks beyond the physics-safety ones: invalid rotation, left the world without ring-out, below the floor, stuck in the wall, state contradictions, resources out of range, permanent invulnerability / hitstop / Clash, cooldowns that never end, wobble explosion, non-finite spin, a body that disappears, and (warning only) an AI that stops acting. Thresholds are documented at the top of the file. Each condition is reported once per episode, and timer-based ones ignore ticks a Clash, hitstop or finished round froze. A finding matched to a recorded bug carries `knownIssue` (today: `ext-32`, the wall collider) and still fails the match. The live Debug Lab session runs the same detector.
- `scenarios/` — the 18 GDD 68 presets (`ScenarioPresets.ts`), their trace (`ScenarioTrace.ts`) and runner (`ScenarioRunner.ts`). Presets place the Beys, set resources and drive both sides with scripted real inputs; each states what must happen. `aiSide` swaps one side for the real AI (GDD 66 scripted vs AI). Replay reproduction is reported unsupported until Milestone 9. The Debug Lab can load any preset into the live match.

## Report rules

- **Failure reasons.**
  - `crash`: the simulation threw. The batch records it and goes on.
  - `invalid-state`: any physics anomaly.
  - `hang`: the round is still `Ongoing` at `maxTicks` (default 6000 ticks, about 100 s).
- **Seeds.** Every failure keeps its exact match seed (`${seed}/${first.id}-vs-${second.id}`), so the match can be replayed.
- **Performance anomalies.** Ticks slower than one 60 fps frame (`slowTickThresholdMs`) are reported, not failed.
- **Divergence.** It is `{ status: 'unsupported', count: null }` until Milestone 9 brings state hashes and replay playback (GDD 145). It is never reported as `0`.
- **Known issues.** `knownIssues` counts detections matched to a recorded bug; `unknownInvalidStates` counts invalid-state matches that are NOT all known — the number that must stay 0. Known findings are still failures: the report shows the bug, it doesn't hide it.
- **Warnings.** Detector warnings (e.g. `ai-inactive`) are listed per match and never fail it.

## Acceleration

- **Headless:** matches simply run one fixed tick after another, with no rendering. There is no bigger `deltaTime` (GDD 164).
- **In the browser (`?mode=self-test`):** the FixedTimestepLoop's fixed step sets the pace and each step simulates `speed` fixed ticks (1× = real time, up to 64×), or at "max" as many as fit a ~12 ms per-frame budget. The delta is always the fixed one. Rendering is reduced to a 2D minimap. The Debug Lab's 1–8× speed works the same way on the rendered match.
