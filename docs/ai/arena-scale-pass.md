# Arena scale pass: 3x stage, central basin 2.5 m deep

Version: **0.12.0** (was 0.11.0).

Branch `claude/dazzling-sagan-14fgu0`. Separate from any jump/gameplay fix; camera, controls and input semantics were not touched.

## What changed

| | Before | After |
|---|---|---|
| Floor radius (`ARENA_FLOOR_RADIUS`) | 12 m | **36 m** (3x, horizontal plane only) |
| Wall height / thickness / floor thickness | 2 m / 0.6 m / 0.5 m | unchanged (vertical sizes do not scale) |
| Wall segments (`ARENA_WALL_SEGMENT_COUNT`) | 32 (chord ~2.4 m) | **96** (same chord, same polygon fidelity) |
| Ring-out radius (`RINGOUT_RADIUS_M`) | 12.9 m | **36.9 m** (same 0.9 m past the floor edge; deliberately not 3x = 38.7) |
| Default floor | flat | **bowl A, parabolic dish** (`DEFAULT_ARENA_FLOOR`) |
| Bowl depth (`BOWL_DEPTH_M`, rim above centre) | 3.2 m (at R = 12) | **2.5 m** (at R = 36) |
| Bowl C plateau radius | 2.6 m | 7.8 m (3x) |
| Heightfield cells | 96 (~0.26 m) | 288 (~0.25 m) |

Files: `src/arena/colliders/ArenaTuning.ts`, `src/arena/colliders/createArenaColliders.ts`, `src/arena/floor/ArenaFloorProfile.ts`, `src/arena/ringout/RingOutTuning.ts`; plus consumers: `src/self-test/arenaFloorComparison.ts`, `src/self-test/scenarios/ScenarioPresets.ts`, `src/debug/visualization/DebugVisualLayers.ts`, `src/replay/playback/replayPlayback.ts`, `src/config/match/MatchConfig.ts`, `prototypes/camera-concepts/src/fight/scenarios.ts`.

## How the 2.5 m depth is applied

The floor is a Rapier heightfield sampled from `h(r)` in `ArenaFloorProfile.ts` (one source of truth for collider, visuals, spawns, camera floor guard and debug). The default `bowl-a` is `h(r) = 2.5 * (r/36)^2`: the centre is at y = 0, the rim at y = 2.5 m. It is C1-smooth (slope 0 at the centre, no corner), and the steepest part is the wall end: `atan(2*2.5/36)` = 7.9 degrees at the rim. Gravity along the slope is therefore ~0.46 m/s^2 at r = 12 and ~1.36 m/s^2 at the rim. No extra "pull" force was invented. Bowls B (funnel) and C (plateau) keep their approved curves, scaled to the same 36 m / 2.5 m. The wall is still measured from the rim (it runs from y = 0 to rim + wall height).

## Did ring-out, wall collision and AI need adjusting?

- **Ring-out:** yes, one value, explicitly: `RINGOUT_RADIUS_M` 12.9 -> 36.9 (see table). Ring-out is still only reachable airborne over the wall.
- **Wall collision:** segments 32 -> 96 and the heightfield resolution 96 -> 288 cells, to keep the same fidelity. No wall height/thickness/friction/restitution change. `arenaWall.test.ts` still verifies a closed ring at every angle.
- **Flat floor collider:** the flat floor is now also a (flat) heightfield. At 36 m the old single cylinder collider produced ghost obstacles for a rolling Bey 1-2 m inside the wall (full stops at r = 33.5-34.4 m, measured in the movement harness); the heightfield does not. `flat` remains selectable only as a baseline.
- **AI:** no AI code or value changed. The AI reads the ring-out radius from `RINGOUT_RADIUS_M`, so its edge awareness follows the new radius. Edge margins are absolute metres, so they are proportionally tighter on the bigger stage.
- **Friction/grip:** nothing changed.

## Gameplay consequences you should know about (not silenced)

1. **Rounds are much longer.** Defense AI vs the fixed stand-in took 771-1503 ticks on 12 m flat; on the 36 m bowl three of eight seeds were still unresolved at 100 s and finished at 6767 / 8073 / 18421 ticks (the last after 63 hits). 36 m flat: one seed unresolved at 100 s. AI-vs-AI is milder (~1300-1400 ticks per match on the bowl). There is no round time limit in the game today. `aiVsPlayerStandIn.test.ts` ceiling was raised 6000 -> 24000 ticks for this reason; no AI was tuned.
2. **Ring-outs almost disappear** in AI-vs-AI on the bowl (0/15 for both Rift and Tournament; flat 36 m: 3/45). The rift-vs-tournament test now compares ring-outs with `>=` and round length strictly.
3. **The in-game camera was left untouched, as asked, but it is tuned for 12 m:** `CameraRig.ts` contains the eye within `containRadiusM: 10.5` of the centre and `CameraDirector.ts` watches ring-outs from `RINGOUT_WATCH_RADIUS_M = 9`. On a 36 m stage the camera cannot follow fights near the rim (see `02-match-near-wall.png`). A follow-up camera change is needed; I did not make it.
4. Spawns stay at +-4 m (start in the basin).

## Tests: what had to change and why

All fixtures near the old 12 m wall were re-expressed relative to `RINGOUT_RADIUS_M` / `ARENA_FLOOR_RADIUS`. Real behavioural findings, not just rescaling:

- `motionDirections` grip test used to read `slipGrip` only because the old run hit the wall (impacts drop grip to `slipGrip`); it now expects the slip model's own floor, `slipGrip * SLIP_GRIP_FLOOR_MULTIPLIER`.
- `physicsWeightFeelPass` "jump while moving" compared a 30-tick drive with a 120-tick one; it passed on 12 m because the jumped Bey hit the wall. The reference now uses the same 120 ticks (no jump behaviour touched).
- `clash-cooldown-collision` scenario: the wall used to bring the Beys back together; on 36 m every release sweep gave 0 hits, so first now has a 40-tick steer pulse (2-3 hits).
- `aiEdgeRecoveryBlocked` gap tolerance 0.4 -> 0.5 m (bowl downhill pull adds ~3 cm); `aiSlowToReactCriticalPreemption` kick 5.75 -> 6 m/s (the bowl trims the kick's reach).
- Seeds re-pinned: replay long/mutation seeds (`replay-0`, `replay-26`), Camera Lab `normal-duel` (`duel-p-i`), `aiDodgeRollGranularity`.
- Replays without `arenaFloor` still play as flat (playback resolves it explicitly), though recordings made on the 12 m arena cannot reproduce on 36 m anyway.
- Debug collider layer now draws the heightfield floor (it silently skipped it).

## Validation

Typecheck, `npm test` (fast suite), `npm run build` green; smoke `boot`, `bowlFloors`, `matchFlow` green locally. The full Playwright suite is left to CI.

Screenshots: `docs/ai/arena-scale-pass/` (`01` centre basin, `02` near the wall).
