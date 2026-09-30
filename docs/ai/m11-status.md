# M11 — Gameplay Polish / Foundation — status

Owner order for M11:

1. **Directional control + Replay V2** ← this lane
2. Camera A/B/C presets in Settings + Clash forcing B without orbit
3. ext-32 root cause + regression test
4. Bowl A/B/C for playtest

## Lane 1 — directional control + Replay V2

### What changed

**Input semantics (default: Directional).**
- ↑ means "go up the screen", ↓ means down, ←/→ mean the sides. Diagonals are normalized to length 1.
- The analog stick gives continuous direction and strength: a 0.2 radial deadzone, then a magnitude from 0 to 1.
- `src/input/directional/screenDirection.ts` holds the pure mapping from screen to world.
- `DirectionalController` wraps the player's keyboard + gamepad and resolves the screen direction to a world X/Z direction. That resolved direction is the only thing that enters `ControllerActions.moveIntent` and the replay.
- In directional frames, the four Steer/Move actions are never held.

**Camera never inside the simulation.**
- The input layer reads the camera yaw from the camera's right axis. That axis never degenerates, whether the camera looks straight down or at the horizon.
- The yaw is latched for the duration of a gesture (`CameraYawLatch`). Holding a direction keeps its world direction even while the automatic camera turns, so the camera can't feed back into the command.
- Releasing the direction, or turning it by more than 30°, re-reads the camera.

**Physics stays in charge (`MovementController`).**
- With a `moveIntent`, the heading turns toward the desired direction:
  - the target turn rate is proportional to the error (`DIRECTIONAL_STEER_GAIN_PER_S = 3`);
  - it is capped at the Bey's own turn rate;
  - it goes through the same `STEERING_RESPONSE_PER_S` easing as classic steering.
- Thrust = acceleration × stick magnitude × cos(heading error):
  - reverse thrust while the direction is behind;
  - none at 90°;
  - full thrust once facing it.
- Momentum, lateral grip, slip, drift, post-impact grip suppression, stamina and airborne factors are all unchanged.
- **Drift:** "steering" = a direction more than 0.25 rad off the heading.
- **Dodge:** goes toward the held world direction, or forward when none is held.

**Classic (Settings → Play → Control).**
- The old tank control: ←/→ turn the heading, ↑/↓ throttle.
- The setting disables the wrapper, so device actions pass through unchanged.
- It is persisted as `PlayerSettings.controlScheme` (`'directional' | 'classic'`, default directional). It can also be changed live from the Pause menu's settings.

**Replay V2.**
- `ChaosBeyReplayV2` = V1 plus a required `move` on every recorded action frame: `[x, z]` for a directional frame, `null` for a classic one (AI, scripted, Classic setting).
- New recordings are V2.
- V1 files still decode. Their frames have no `move`, so playback uses the classic semantics, with no reinterpretation.
- A V1 file carrying `move`, a V2 frame missing it, or a `move` that isn't a pair of length ≤ 1 is rejected.
- The state schema and RNG scheme are unchanged. AI/headless inputs have no `moveIntent`, so their simulation is bit-for-bit what it was.

**Presentation.**
- A discrete chevron on the floor ahead of the player's Bey shows its current **physical heading** (`src/vfx/HeadingArrow.ts`). It is render only.
- The desired input vector is **not** drawn in the game view. It appears only in:
  - the F3 overlay (`desired input`);
  - the Debug Lab inspector (Linear motion → "Desired input (world)" next to "Heading (physical)").
- The Debug Lab uses the same Directional/Classic setting.

### Acceptance criteria → evidence

| Criterion | Evidence |
|---|---|
| Keyboard and gamepad coherent | Both feed the same `DirectionalController`; stick wins when pushed, arrows/D-pad otherwise (`tests/unit/directionalInput.test.ts`) |
| Diagonal gives no speed gain | Screen diagonals normalized; world vector truncated to ≤ 1; physics caps magnitude at 1; diagonal top speed ≤ straight (`tests/deterministic/directionalMovement.test.ts`) |
| No instant snap | First tick heading change < 0.05 rad; per-tick change ≤ turn-rate cap; quarter turn not done after 10 ticks |
| Turn rate / inertia respected | Turn rate never above the cap; settles on target without overshoot > 0.15 rad; reverse-then-turn for a direction behind |
| Automatic camera can't produce absurd commands | Yaw latched per gesture (unit test: world direction constant while the camera yaw sweeps 3 rad) |
| Replay V2 record/playback hashes match | Directional player vs AI, 900 ticks, turning camera → V2 file → headless playback verified on every tick (`tests/deterministic/replayV2.test.ts`) |
| Replay V1 still valid | A V1-shaped file (no `move`, format V1) with classic steering verifies; existing M9 replay suites unchanged |
| AI/headless unchanged | AI frames carry no `moveIntent` → the legacy code path, same floats; existing deterministic/AI/replay suites pass |
| Debug Lab exposes desired input + physical heading | Inspector rows + F3 overlay line |
| Player-control smoke ↑/↓/←/→ in two camera orientations | `tests/smoke/playerDirectionalControl.spec.ts` (Debug Lab overview + game chase camera, velocity projected through the on-screen camera) |

### Known limits

- In Directional mode, the gamepad triggers (RT/LT, "forward/back" in Classic) still read as screen up/down. The stick or D-pad is the intended input.
- Drift in Directional mode needs the direction held off the heading. Once the heading catches up, the drift ends, just as it does in Classic when you release the steer key.

## Lane 2 — camera A/B/C in Settings + Clash forcing B without orbit

### What changed

- **The approved director is the game camera.** `prototypes/camera-concepts/src/director/` has been ported to `src/camera/director/` without changes:
  - the three presets, with every parameter identical to `camera-approval.md` §12;
  - the shared director constants.
  
  A test checks that the port reproduces the lab director tick for tick on real fights. `CombatCameraController` and `ClashCameraDirector` (the M4/M5 engineering values) are removed. Hitstop stays as it was, in `app/simulation/Hitstop.ts` (approval item 10.6).
- **Settings → Graphics → Camera** offers Arena Fighter (A), Cinematic Hybrid (B) and Hyper Dynamic (C), each with a one-line description.
  - The choice is saved in `PlayerSettings.cameraPreset`.
  - It is used in the normal match, the Pause menu's settings and the Debug Lab.
- **The Clash always forces B, without orbit** (`clash-presentation-approval.md` §3.6 and §5).
  - `CameraRig` runs A, B and C every tick on the same `FightFrame`, all three with `clashOrbit: false`.
  - The screen blends toward B following B's own Clash context weight, which ramps at B's approved `transitionSpeed`. Entering and leaving the Clash is therefore a smooth transition, never a cut.
  - Once that weight drops below 0.001, the player's preset is back exactly.
  - A player on B sees one continuous camera.
- **No unnecessary cuts.** Changing preset mid-match (from Pause → Settings) crossfades over 0.6 s.
- **Camera effects off** ("Camera shake & zoom") now removes the shake and the impact FOV punch. It no longer resets the FOV to a fixed value, so the preset's framing (speed FOV, contexts) remains.
- **Presentation only.** The camera reads a read-only `FightFrame` built from the tick. Nothing it computes reaches the simulation, the replay or the state hash. A test shows identical state hashes for A, B and C, including a live preset switch.
- **Debug.**
  - F3 shows `preset · mode` and `clash camera B` (the share on screen).
  - The Debug Lab inspector's Camera section shows: preset (and crossfade), active mode, forced B share, FOV and impact punch, target, distance, yaw and shoulder, shake, the high-speed context, and the director's modifiers.

### Choices made while items are still open in `camera-approval.md` §10 (need the owner's confirmation)

| Item | What this lane does | Why |
|---|---|---|
| 10.1 Default for a new player | **B** | The approval's recommendation; one line to change (`DEFAULT_PLAYER_SETTINGS.cameraPreset`) |
| 10.2 Switching mid-match | Allowed from Pause → Settings, with a 0.6 s crossfade | The approval's recommendation |
| 10.3 Names | Arena Fighter / Cinematic Hybrid / Hyper Dynamic, each with a short description | The lab's names |
| 10.4 Player base FOV | Not added (the preset's own FOV) | Undecided; nothing invented |
| 10.5 Shake ×1.35 | Not applied (the presets' shake as seen in the lab) | The approval's recommendation |
| 10.8 Ring-Out/Finisher after the round ends | The game still freezes at the end of the round; the Finisher frames the frozen scene. No presentation-only physics | Undecided; not changed |

### Tests

- `tests/deterministic/cameraRig.test.ts` (real lab fights):
  - the presets equal the approved values;
  - the port equals the lab director tick for tick;
  - `clashOrbit: false` changes nothing before the Clash and holds the angle during it (< 3° in total, against more than 45° for the lab orbit);
  - for A and C the Clash shows B, then the player's own camera exactly;
  - B sees one director;
  - no per-tick eye jump beyond what the directors themselves make;
  - both Beys stay in frame through the Clash;
  - the crossfade on a preset switch;
  - state hashes are identical across A, B and C.
- `tests/smoke/cameraPresets.spec.ts`:
  - Settings A/B/C with B as default, persisted;
  - a match on each preset;
  - Debug Lab Clash preset: a player on A sees B with no orbit, then A again.

## Lane 3 — ext-32: root cause and fix

### Root cause

The arena's edge wall is 32 flat box colliders (`src/arena/colliders/createArenaColliders.ts`). Each segment's rotation was `yaw = angle + π/2`, but the yaw that turns a box's width along the circle's tangent is `π/2 − angle`.

- With a yaw θ about +Y, the width axis becomes (cos θ, 0, −sin θ). The old code gave (−sin a, −cos a), where the tangent is (−sin a, +cos a).
- The two agree only on the four axes; the error is 2a.
- Around ±45°/±135°, the segments stood **radially, like fins, with open gaps between them**.
- The rendered wall is one smooth cylinder, so the gaps were invisible.

Measured before the fix (first wall hit along a ray from the centre, per angle):
- no wall at all at 40°, 50°, 130°, 140°, 220°, 230°, 310° and 320°;
- elsewhere a jagged ring between 10.65 m and 12.12 m instead of an even ~11.7 m.

The ext-32 trace (seed `self-test-32/defense-prototype-vs-stamina-prototype`) shows the mechanism. At −39°, a Bey drifting outward at 4.4 m/s passed from r = 11.06 to 12.6 m with no wall contact at all, ended up past the floor edge (12 m) but inside the ring-out radius (12.9 m), and fell with no ring-out. Wedges between two fins are the "stuck in the wall" half of the same bug.

This is a collider bug, not an AI one (as the M7 audit suspected) and not solver penetration.

### Fix

One line: `const tangentYaw = Math.PI / 2 - angle;`. After the fix, the wall is a closed ring at 11.70–11.74 m in every direction; the spread is only the 32-sided polygon's own.

Nothing is masked:
- no teleport, no clamp, no velocity cap;
- the playing area is unchanged (inner face still at 11.7 m);
- wall height, thickness, bounce and segment count are unchanged.

### Evidence

- **Sweep of 270 AI matches** (9 pairings × 30 seeds), every GDD 67 anomaly counted:
  - before: 48 (47 stuck-in-wall, 1 fell off the rim), in several pairings;
  - after: **0 anomalies of any kind**.
- **`tests/deterministic/arenaWall.test.ts`** passes with the fix, and all three of its checks fail on the old code:
  - rays every 0.5° at three heights all hit the wall at the inner face;
  - every segment is tangent;
  - a Bey thrown outward at the old gap angles and on the axes is stopped by the wall and stays on the floor. The throws cover 8, 15 and 28 m/s along the ground (28 m/s is the ext-0 launch size), plus the ext-32 airborne case.
- **The seed that reproduced ext-32** now plays with no anomaly, deterministically (`matchAnomalyDetector.test.ts`).

### Consequences (reported, not hidden)

- **The known-issue label is retired.** `ext-32` is no longer tagged, so a Bey in the wall or off the rim is again an *unknown* invalid state and fails a Self-Test batch. The known-issue registry is empty.
- **Every fight that reaches the wall now plays differently.** This affects the tests pinned to particular fights:
  - The replay seeds were re-pinned for the same preconditions: a long fight with many hitstop freezes. `replay-13` → `replay-15` (1301 ticks, 170 frozen) and `replay-11` → `replay-17` (1117 ticks, 151 frozen).
  - Two AI-behaviour margins were re-baselined with the new measurements. The qualitative relationships hold; the old margins were partly produced by the broken arena:
    - Ace vs Rookie, hits dodged: > 2× → > 1.5×. Measured 40 vs 24 (48 matches: 102 vs 61).
    - Ace vs Rookie, dodges: > 2× → > 1.4×. Measured 20 vs 13 (48 matches: 45 vs 29).
    - Ace errors (0.45×) and wins (17 vs 7) are unchanged in direction.
    - Defense counters vs Attack: > 1.5× → > 1.3×. Measured ~1.45×.
- **Old replays** recorded on an earlier build carry a different build commit in their fingerprint (already reported on import). Fights that touched the wall would diverge.

## Lane 4 — bowl A/B/C for playtest

### What this lane does (and doesn't)

- **Scope.** The three approved bowl profiles become **playable floors, for comparison**. `visual-prototypes-approval.md` §2: 3.2 m rim at R = 12 m.
  - **A**, parabolic dish: `3.2·(r/R)²`.
  - **B**, funnel: `3.2·(r/R)^1.3`.
  - **C**, 2.6 m central plateau: `3.2·((r−2.6)/9.4)^1.4`.
- **Nothing chosen.** No bowl is chosen: **Flat (current) stays the default**. The first-arena decision and the slope's gameplay effect remain open (approval §4, items 3–5).
- **Floor and look are separate.** The floor is independent of the arena's look (Foundry / Rift / Tournament).
- **Where to pick it:**
  - Pregame → **Floor (playtest)**: Flat / Bowl A · Dish / Bowl B · Funnel / Bowl C · Plateau.
  - Debug Lab → **Arena floor** (panel), `?mode=debug-lab&floor=bowl-a`, or `handle.setArenaFloor()`.

### How it's built

- **One source of truth.** `src/arena/floor/ArenaFloorProfile.ts` holds `h(r)`, its slope and normal. The collider, visual, spawns, placement, camera floor guard and debug readouts all read it.
- **Collider.** Flat keeps its exact cylinder. A bowl is a Rapier heightfield sampled from `h(r)`: 96 × 96 cells, internal-edge fix, within 2 mm of `h(r)`. Past the 12 m floor edge it drops away, as the flat floor ends there.
- **Wall.** Measured from the rim (approval §2.3): it spans y = 0 up to rim + wall height. The ext-32 ring from lane 3 is intact (tested).
- **Ring-out.** The radius (12.9 m) is unchanged.
- **Visual.** A **temporary** bowl: the approved profile turned on a lathe, painted with the current theme's floor material. The approved arena art is not integrated.
- **Replay.** `MatchConfig.arenaFloor` is gameplay, so it's recorded in every replay. Replays from before this field (all flat) still validate and play as flat; an unknown floor is refused.
- **Camera.** The approved director's floor guard follows the bowl (`floorHeightAt` option; flat = exactly as approved).
- **Debug.**
  - The Debug Lab inspector (Linear motion) and F3 show, under each Bey: profile, floor height and height above it, slope and normal, and downhill pull (g·sin slope). This is approval §5.1 item 5.

### One movement change, needed for slopes

**The problem.** `MovementController` drove a purely horizontal velocity, which assumes a flat floor. On a slope that velocity rammed the ramp and the Bey **bounced off it**. Measured while driving on the bowls: grounded only 28–43 of 60 ticks, tilt up to 16°, and drift, hop and jump failing because the Bey was in the air.

**The fix.** Now, when grounded on a bowl, the driven velocity is laid onto the floor's tangent plane, and any velocity away from the floor (a real bounce) is kept. The plane is taken at the Bey's **outer rim**: an upright flat base in a concave floor rests there, and using the centre's shallower slope lifted the rim off when rolling downhill.

**Result:**
- grounded 56–60 of 60 ticks at every speed;
- tilt ≤ 5°;
- every GDD 68 scenario check passes on every bowl except the ring-out throw (below).

**What stays unchanged:**
- **The flat arena is untouched.** The normal is vertical there, and the code path is skipped. Every earlier test and hash is unchanged.
- **The slope's pull still comes only from gravity and real contact**; there is no invented slope force.

### Comparison (all deterministic, headless, real runtime)

Generated by `BOWL_REPORT=1 npx vitest run tests/deterministic/arenaFloor.test.ts`. Full tables are in `docs/ai/m11-bowl-comparison-data.md`.

| | Flat | Bowl A | Bowl B | Bowl C |
|---|---:|---:|---:|---:|
| AI vs AI: ring-outs / KOs (36 matches) | 27 / 9 | 22 / 14 | 28 / 8 | 26 / 10 |
| Average round length | 13.7 s | 16.9 s | 16.4 s | 17.5 s |
| Time past r = 9 m | 31% | 25% | 23% | 24% |
| Time with no floor contact | 31% | 61% | 60% | 63% |
| Coasting from r = 8 m at rest (peak speed) | 0.04 m/s | 0.35 m/s | 0.43 m/s | 0.42 m/s |
| 35% stick from the centre: farthest in 4 s | 4.1 m | 4.8 m | 1.3 m | 3.8 m |
| Full stick: reaches r = 10 m | 1.77 s | 1.62 s | 1.68 s | 1.75 s |
| GDD 67 invalid states (probes, scenarios, AI) | 0 | 0 | 0 | 0 |

### What the numbers say (for the playtest — not a recommendation)

- **The slope barely pulls a Bey to the centre** under the current movement model. From rest at r = 8 m, a Bey creeps 0.04–0.43 m in 5 s. The movement model's lateral grip (5.5/s) absorbs most of gravity's sideways pull. How strong the pull *should* be is approval §4 item 4 (open), so it is left as the physics gives it.
- **The slope is felt mostly as effort and as air.**
  - **Effort:** climbing costs speed (top speed ~10.7–11 m/s against 12 on flat). A light stick struggles out of Bowl B's funnel centre (1.3 m in 4 s).
  - **Air:** Beys spend about **twice as long without floor contact** (60–63% against 31%). It is real flight, not jitter: on Bowl A, the Bey is more than 0.6 m above the floor for 91% of that airborne time. The flights come from climbing momentum, knockbacks and impacts on the slope, and the effect grows with radius. In the air a Bey has 15% of its thrust, so this changes how controllable a fight feels. This is the biggest difference to judge by hand.
- **Rounds last longer on every bowl** (+2.7 to +3.8 s), with less time at the edge and at the wall. Bowl A had the most KOs (14 of 36), Bowl B the most ring-outs (28).
- **The `ring-out` scenario preset.** That scripted throw no longer carries the Bey out on A and C: the round stays open. The wall is measured from the rim and the launch starts on a slope. It is a real difference of those floors, not a bug; the ring-out *rule* is unchanged.

### Tests

- **`tests/deterministic/arenaFloor.test.ts`:**
  - the profiles are the approved formulas;
  - the normals are consistent;
  - the collider matches `h(r)` within 2 mm, with the wall closed from the rim up;
  - the flat arena is exactly the old one;
  - spawns are lifted onto the floor;
  - per bowl: the probes (slow and fast climb, wall push at the edge, drop) with 0 invalid states;
  - the 13 GDD 68 scenarios per bowl without crash or invalid state, and their checks passing (ring-out reported);
  - AI vs AI across all 9 pairings resolving with 0 invalid states;
  - a bowl match is deterministic, and its V2 replay verifies;
  - a pre-bowl replay validates and plays as flat, and a bad floor is refused.
- **`tests/smoke/bowlFloors.spec.ts`:**
  - Pregame: Flat by default; Bowl A chosen and kept across an arena change; the match runs with the Bey on the bowl.
  - Debug Lab: `&floor=`, the panel switch, and the inspector's floor readout.

## Owner playtest fix 1 — the camera (after M11)

**What the owner saw:**
- "the Bey moves by itself with no logic";
- "the camera drifts away from the Bey for no reason, even ending up behind the arena where it is impossible to see".

**What was measured:**
- With the player against the wall and the opponent in the middle, all three approved presets put the camera **outside the arena** (r = 15.5–17.8 m, rim at 12 m), and the wall hid the Bey. The Camera Lab only measured whether a Bey was inside the frustum, never whether the wall was in the way.
- Holding ↑ for 2 s, the camera turned **95°**. The approved framing is "behind the player on the player → opponent axis", and that axis spins as the player moves around the opponent. With screen-relative controls (↑ = up the screen), the keys kept changing meaning, so the Bey seemed to wander.

**Owner's direction:** the camera must not move with the Bey constantly, must not be fixed, must be dynamic, and must stay inside the arena.

**What changed** (`CameraDirector` option `arena`, on for every preset via `RIG_DIRECTOR_OPTIONS`):
- **Holds its angle.** It keeps framing the fight on the player/opponent line, but ignores turns of that line under 60°, then glides to the new angle at the preset's own orbit smoothing and speed cap.
  - The line is treated as a line: when the Beys pass each other the camera keeps its side instead of swinging half-way round.
  - Below 4.5 m of separation, where the axis is noise, it holds.
  - No velocity-mixed heading, no automatic orbit drift or lead, no shoulder switching.
- **Stays inside the arena.** A viewpoint that would fall past 10.5 m from the centre swings to the arena's inner side. The eye can never be farther out, so the wall is never between the camera and the Beys.
- **Still dynamic.** Zoom with separation, speed FOV, shake and impact punch, knockback follow, Clash (B, no orbit), ring-out and finisher are all kept.

**Tests** (`cameraRig.test.ts`):
- the eye stays inside 10.5 m in forced wall cases and in real lab fights, for every preset;
- a 50° circle around the opponent leaves the camera within 3°;
- running straight past the opponent turns it less than 45°.

The lab-fidelity test still compares the unmodified director with the lab's.
