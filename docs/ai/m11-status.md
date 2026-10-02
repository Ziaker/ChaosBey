# M11 — Gameplay Polish / Foundation — status

Owner order for M11:

1. **Directional control + Replay V2** ← this lane
2. Camera A/B/C presets in Settings + Clash forcing B without orbit
3. ext-32 root cause + regression test
4. Bowl A/B/C for playtest

## Lane 1 — directional control + Replay V2

### What changed

**Input semantics (default: Directional).**
> **SUPERSEDED (2026-10-01).** The control reference is no longer the camera, in any form (no yaw read, no latch, no per-tick tracking). The arrows are resolved in a `ControlReference` — four owner-selectable schemes (toward-opponent default, Classic, fixed arena, and the opt-in screen-relative exception) — see `docs/design-decisions/camera-gameplay-separation.md`. The camera/latch paragraphs below, and fixes 5–9 in this log, are history only.

- ↑ means "go up the screen", ↓ means down, ←/→ mean the sides. Diagonals are normalized to length 1.
- The analog stick gives continuous direction and strength: a 0.2 radial deadzone, then a magnitude from 0 to 1.
- `src/input/directional/screenDirection.ts` holds the pure mapping from screen to world.
- `DirectionalController` wraps the player's keyboard + gamepad and resolves the screen direction to a world X/Z direction. That resolved direction is the only thing that enters `ControllerActions.moveIntent` and the replay.
- In directional frames, the four Steer/Move actions are never held.

**Camera never inside the simulation. (Historical — the latch below was removed; the camera now has no input path at all.)**
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
- **Stays inside the arena.** A viewpoint that would fall past the arena's eye limit (`CAMERA_CONTAIN_RADIUS_M`: 10.5 m on the old 12 m arena, 34.5 m on the 36 m arena since 0.12.1) swings to the arena's inner side. The eye can never be farther out, so the wall is never between the camera and the Beys.
- **Still dynamic.** Zoom with separation, speed FOV, shake and impact punch, knockback follow, Clash (B, no orbit), ring-out and finisher are all kept.

**Tests** (`cameraRig.test.ts`):
- the eye stays inside 10.5 m in forced wall cases and in real lab fights, for every preset;
- a 50° circle around the opponent leaves the camera within 3°;
- running straight past the opponent turns it less than 45°.

The lab-fidelity test still compares the unmodified director with the lab's.

## Owner playtest fix 2 — the approved Motion Lab movement (after M11)

**Owner's direction:** "COMO ASSIM ESPERAR PEDIDO, EU SEMPRE APROVEI … AJEITA TUDO LOGO". The Motion Lab directions are integrated into the real controllers. Details and every deviation from the Lab are in `docs/design-decisions/motion-approval.md` §16.

**What the player gets:**
- **Movement A / B / C** in Pregame (a new row; B is the default) and in the Debug Lab (`&motion=`, a panel select, inspector rows).
- The choice is gameplay: it lives in `MatchConfig.motion` and is recorded in replays. A replay from before the option is valid and plays as B.

**What changed in the simulation:**
- **Planar drive:** the Lab's model.
  - Thrust stops at top speed; rolling drag applies only while coasting; overspeed bleeds off at 1.5/s.
  - Grip/slip with hysteresis: grip drops to `slipGrip` while slipping and on every impact, then recovers at `gripRecovery`.
  - Airborne grip, and the whirl ("rodopio"): glancing and above-threshold hits turn the heading.
  - The direction scales turn rate and lateral grip relative to B, so Attack/Defense/Stamina keep their differences.
- **Contacts:** Bey–Bey restitution, wall bounce and wall scrape come from the direction; the Lab's landing bounce (floor restitution 0 in Rapier); knockback × `knockbackScale` with `knockbackLift` of it upward.
- **Attitude:** the Lab's tilt model — lean into acceleration and speed, impact kick, post-impact spring fade, tumble, maxTilt stop, precession. It drives the render.

**The physics body no longer tilts.** Measured over 24 AI matches before this change: a Bey's rigid body was tipped past 57° in **25.6 %** of ticks (up to upside-down). It lay on its flat cylinder's rim, rolled like a coin, and was dragged around. A stopped Bey kept a 12 rad/s roll and drifted off by itself. After the change it is 0 %.

Knock-on fixes the lock needed:
- **Bodies never sleep:** a resting locked body fell asleep and read as airborne.
- **The ground check computes the contact fresh,** because the stored manifold went stale.
- **A tall Bey–Bey "bumper" collider on its own collision group:** two locked cylinders of different heights overlapping deeply were separated vertically and passed through each other.
- **A Dash drives only on the ground:** a countered dasher was pushed on over the wall at Dash speed.

**Kept from the game, not the Lab:** the floor's contact friction.
- The Lab has none, so a released B Bey there glides ~18 m from top speed; here it stops in ~1 s, as before.
- The owner's playtest note was that the Bey must not move by itself. The glide is an open option.

**Bowls (playtest floors):** `docs/ai/m11-bowl-comparison-data.md` is regenerated. On a bowl the upright body rests on its outer rim, as lane 4 was built. (Turning it to sit on the slope was tried and dropped: turning a body in contact shoves it, and it climbed the bowl at 35% stick at 9.5 m/s.)
- **Time in the air on a bowl:** ~60 % of the fight in lane 4, now ~22–26 %.
- **Outcomes:** fewer ring-outs, more KOs.
- **Light stick on bowl B:** 35% stick now leaves bowl B's centre at 0.08 m/s (lane 4: 0.24). The "light input on bowl B" item got stronger, and the test threshold went from 0.1 to 0.05.
- **At rest on a slope:** a Bey stays put, since floor friction holds it.

**Camera:** the Clash blend toward B is now eased and rate-limited (≥ 0.8 s for a full blend). The new fights put the player's eye up to ~12 m from B's, and the raw blend swept 0.6 m in one tick.

**Measurements:** 48 AI matches per direction on the same seeds as the old code.

| | old | A | B | C |
|---|---|---|---|---|
| median match length (ticks) | 410 | 610 | 562 | 1042 |
| ring-outs | 41 | 10 | 27 | 20 |
| anomalies | 0 | 0 | 0 | 0 |

**Consequences (reported, not hidden):**
- **Seeds re-pinned** (fights changed):
  - replay: replay-45 / replay-40;
  - camera lab: normal-duel `q`, ring-out-chase `b`;
  - hitstop test: `hitstop-freeze-6`.
- **Scenario timings re-measured:** ring-out z = 7 / tap +12; perfect-dodge +16; clash-cooldown Dash every 2 s from 7 s; and others.
- **AI (to retune, not tuned here):**
  - Ace no longer out-wins Rookie: 35–35 over 72 matches, versus 41–31 with the old movement. Deliberate errors (0.42×) and dodges (2.0×) still separate the tiers clearly.
  - Defense's punish margin over Attack fell from +0.12 to about +0.03. Its counter ratio stays 2.9–3.5×.
  - The two assertions were relaxed with these numbers in the test comments.
- **A few test allowances,** each with its before/after measurement in the test:
  - air-recovery window opens at ≤ 5 ticks (was ≤ 4);
  - mirror symmetry within 10 cm (was 5; B's bouncier Bey–Bey contact).

## Owner playtest fix 3 — the items left open by fix 2 ("então resolva")

**1. Ring-outs at ~2 s in the opening (fixed).** Both AIs Dash at the start; Defense's Circular caught Attack's Dash and the dasher flew on over the wall at ~15.5 m/s. On main before the Motion Lab movement it was the same: Attack vs Defense, 11 of 12 seeds ended by ring-out at 136 ticks.
- A caught Dash now keeps 30% of its horizontal speed (`CIRCULAR_CATCHES_DASH_HORIZONTAL_KEEP`), plus the upward launch.
- Every knockback (Circular catch, hit, Clash loss) now opens the post-impact grip window (`MovementController.registerKnockback`), so the knockback plays out instead of being steered away on the next tick. A wall hit inside that window is still detected: the window compares against the incoming velocity.
- **Stacked Beys:** with rotations locked, one Bey could rest on top of the other's tall bumper and the round never resolved. Bumpers now touch only when the two bodies overlap in height (a Rapier contact-filter hook, `PhysicsWorld.registerBeyBumper`), so a Bey that lands on top slides off.

**2. AI retune (measured; one assertion rewritten).**
- **Ace vs Rookie is back:** 72 matches — wins 53 vs 18 (old movement 41 vs 31; fix 2: 35 vs 35), hits dodged 204 vs 113, dodges 103 vs 59, deliberate errors 144 vs 359. The original thresholds (hits dodged > 1.5×, more wins) hold again.
- **Defense's punish share** (punishes / attacks) is where it was: 0.311–0.375 on matrix-0..11 and matrix-12..23, 0.33–0.35 before. It no longer beats Attack's: the margin is −0.03..+0.01, where it was +0.12..0.13.
  - Attack attacks ~35 times a minute, and opponents spend longer in recovery after bounces and landings, so about a third of Attack's attacks start in a window by chance.
  - Lowering Attack's `punishAffinity` from 0.5 to 0.2 left its share at 0.33–0.37, so it is not intent, and no personality was changed.
  - The matrix asserts Defense's share > 0.28 and keeps the counter-ratio check (Defense counters 2.0–3.2× more often than Attack).
- **Balance consequence (for the owner, not tuned):** without the free opening ring-out, Attack vs Defense went from Defense winning (18 of 24 on main, mostly those ring-outs) to Attack winning 16 of 24 by KO, in 11–13 s.

**3. Ring-outs under B are rarer but real.** A Circular catch no longer carries the dasher out. The AI ring-out traced under B (Defense vs Stamina, seed 3) came from a Dash hitting a Bey in the air, early in a jump, which sent it over the wall at ~16 m/s.
- The `ring-out` scenario preset and the Camera Lab's `ring-out-chase` now script exactly that. Both were swept: any jump from 2 to 16 ticks after the Dash release rings out, and the preset uses 8. In the Camera Lab, any jump from 1.28 to 1.48 s rings out at 2.0 s, and it uses 1.38 s.
- `clash-cooldown-collision`: since a Dash goes where its Bey faces, two Dashes released on the same tick after the Clash fly past each other. Second now releases 24 ticks after first, at 6.5 / 9.5 / 12.5 s. That is the middle of the 8–40 tick range that lands 1–3 hits in the cooldown.
- **Seeds re-pinned:**
  - replay: replay-50 for both tests (1243 ticks, 170 frozen);
  - Camera Lab normal-duel: `u`, 15 s. No seed a..z keeps a Clash for 24 s without a round end any more, since fights end by KO in 8–16 s.

**4. Light stick on Bowl B (measured; left as the physics gives it).** Bowl B is a funnel: it slopes almost from the centre. At 35% stick the thrust is weaker than the slope's pull, so the Bey stays within 0.63 m.

| stick | flat | Bowl A | Bowl B | Bowl C |
|---|---:|---:|---:|---:|
| 35% — speed at 2 s | 1.66 m/s | 4.74 m/s | 0.08 m/s | 1.66 m/s |
| 45% — speed at 2 s | 4.34 m/s | 7.52 m/s | 4.76 m/s | 5.47 m/s |
| 55% — speed at 2 s | 7.03 m/s | 6.28 m/s | 8.19 m/s | 7.91 m/s |

From 45% up, Bowl B is no harder than flat. The Lab and the game both scale thrust linearly with the stick. Making a light stick climb the funnel would mean a stick response curve (felt on every floor), a weaker funnel, or a slope assist. Each is a design choice for the owner, not a bug fix.

**5. The Lab's long glide** stays an open option (fix 2): the floor friction is kept.

**Bowls:** `docs/ai/m11-bowl-comparison-data.md` is regenerated. The flat arena has 3 ring-outs in 36 AI matches (12 before these fixes), and the bowls have 8–10 (2–5 before). Round lengths are now 14.8–16.0 s everywhere.

## Owner playtest fix 4 — the camera still turned, and the Bey did not go where it was told

**What the owner saw:** "a câmera ainda tá do mesmo jeito, controlar o bey ainda é horrível, ele ainda se move sozinho … ele ainda fica indo pra direções erradas ao invés de ir para a direção que eu estou movendo".

**Measured in the real game** (production build in Chromium, Play mode against the default AI, arrow keys held like a player; the probe records the Bey, the camera and the keys every frame):
- **The camera turned 127° in 3 s before any key was pressed.** The opponent circled, and the fix-1 camera re-aimed at the fight axis once it had turned past 60°. Every turn changes what ↑/↓/←/→ mean on the ground.
- **From rest, a direction 90° away moved the Bey 6 cm in half a second.** It left up to 42 cm off-line first, because thrust pushed along the old heading while it turned at the classic 2.6 rad/s. A direction straight behind moved it only 0.44 m in a whole second.
- **Released at top speed, it coasted 6.6 m over 1.35 s.**

**What changed:**
- **Camera (in-game arena mode, every preset):**
  - The angle is chosen once per round, behind the player on the opening axis, and held. There is no re-aiming at the fight axis and no impact re-framing turn.
  - It stays dynamic: the framing point follows the fight once it moves 1.5 m (no look-ahead), and zoom, FOV, shake, knockback follow, Clash, ring-out and finisher are kept.
  - It stays inside the arena by pulling the eye in and raising it, never by swinging the angle.
  - The Camera Lab director without the arena option is unchanged.
- **Directional control:**
  - The heading swings toward the wanted direction at 3× the classic turn rate (gain 12/s, easing 20/s). It is still limited and eased, so momentum, slip and drift play out.
  - Thrust along the heading is scaled by cos(error)², so a Bey still turning is not driven off at an angle.
  - Classic (tank) steering is unchanged.
- **Idle damping:** with no movement input, on the ground and outside an impact's window, speed decays at 4/s. This is proportional, so a pushed idle Bey still gives way, and knockbacks and bounces are not damped.

**After** (same probes):

| | before | after |
|---|---:|---:|
| Browser, camera yaw range over the fight | +20° … +151° | −25° … +3° (ring-out/knockback framing) |
| Browser, arrow held on open floor: velocity vs wanted direction | 46° → 0° over ~0.8 s, drifting with the camera | 0–2° |
| From rest, 90° away: distance in 0.5 s / 1 s (off-line) | 0.06 / 1.44 m (0.42 m) | 0.58 / 3.33 m (0.03 m) |
| From rest, straight behind: distance in 1 s | 0.44 m | 1.97 m |
| At top speed, 90° turn: sideways carry | 4.9 m | 3.1 m (slip/drift) |
| Released at top speed: stops after | 1.35 s, 6.6 m | 0.47 s, 1.7 m |

**Tests:**
- New: the camera holds within 2° while the opponent circles a standing player, for every preset. It does not drag along with 1 m shuffles. Both tests fail on the fix-1 camera.
- Directional tests updated to the new response: a quarter turn still takes more than 3 ticks and settles within half a second; straight behind brakes at once and moves the wanted way within half a second.
- Tests that threw a Bey with no input now drive it: the wall bounce, and the wall-hit / wall-ricochet presets (half a second of forward). Tests where an idle Bey sat in the driver's path now move it aside.
- The Stamina passive-share margin over Defense went from > +0.08 to > +0.06 (measured +0.084 → +0.075). The other identity checks keep their margins.
- Seeds re-pinned: replay-66 / replay-30, and Camera Lab normal-duel `g`.

## Owner playtest fix 5 — drift, over-the-shoulder camera, result auto-continue, visual audit

### 1. Drift: the state really did not stay on (mechanical), and nothing showed it (feedback)

**Traced** (`tap X → hop → X held → landing → Drifting → release → Recovering → Idle`), in the headless harness and in the browser:
- **The drift lasted 2–4 ticks.**
  - It ended as soon as the Bey stopped "steering". In directional control the heading reaches the held direction within a few ticks, so that happened almost at once.
  - It also ended on any tick off the ground, and the Motion Lab landing bounce lifts the Bey right after touchdown.
  - Measured: `drift` scenario, flat floor: 2 ticks.
- **Holding X almost always meant a tall jump instead.** The M3 variable jump adds height while X is held without steering, which is again almost always in directional control. The result was a 1.7 m, 1.3 s jump before any drift could start (browser log).
- **The landing took ~35% of the horizontal speed in one step** (6.4 → 4.2 m/s). That came from the floor collider's friction on the impact, so a drift landing read as a stop.
- **The test harness never passed the heading to DriftController.** `tickMatch` did. Fixed.

**Changes:**
- **The drift lasts while X is held.** Short air time (≤ 0.45 s: the landing bounce, a bump) does not end it. Releasing X starts the 0.5 s grip recovery as before.
- **Jump vs drift (owner's rule): X + going straight = the variable jump; X + a real turn = drift.**
  - **Reference:** when X is pressed, the drift latches that instant's direction: the Bey's motion at ≥ 2 m/s, otherwise the held direction or the heading.
  - **Arming:** a turn arms the drift for the rest of that X press. A turn is the held direction more than the existing directional steering threshold (0.25 rad) off that reference, or a turn key in classic control. The current heading is not used, because in directional control it catches up with the held direction within a few ticks.
  - **Once armed:** the height assist stops (the hop stays small), and the drift starts on landing, or on a later turn while X is still held.
  - **Without a turn:** the hop is the variable jump, standing or moving.
  - This replaces an intermediate rule ("moving ≥ 4 m/s with a direction held = drift") that took the high jump away while moving.
- **Jump on slopes:** the variable jump's height assist ran only while the absolute vertical speed was > 0. Going down a bowl's slope the Bey already falls with the floor (vy −2.9 m/s on Bowl B), so a held jump got no extra height there. "Rising" is now measured against the vertical speed at the hop. On the flat floor that base is 0, as before.
- **A landing keeps its horizontal speed** (the Motion Lab's landing model). This applies only when the landing step slowed the Bey along the same line, so a landing that also hits a wall or a Bey keeps what physics decided.
- **AI:** it lets go of X after 0.5 s of drift. Holding it for the whole decision left both AIs drifting round the rim for a full 100 s round.

**Feedback (render only):**
- **Skid marks and sparks** from the approved VFX language (see `visual-fidelity-audit.md` for exact sources and the drift-specific densities).
- **Arena spark colours** from the Arena Lab.
- **A scuff where the drift starts** and a **bright grip-regain ring where it ends**.
- **A 16° lean** into the turn against the slide.
- **A temporary "DRIFT" / "GRIP" tag** on the HUD. It is functional, not the final HUD.
- **F3 and Debug Lab rows:** drift state, X held, drift armed, grounded, slip angle, lateral grip, heading, velocity direction and heading − velocity.

**Evidence:**
- `drift.test.ts`, drift cycle: the full transition list, ~1 s of Drifting while X is held, speed kept through the landing, grip < 30% of normal, heading ≥ 45° off the velocity. It fails on the old code.
- `drift.test.ts`, jump vs drift:
  1. running straight + holding X is a tall jump (apex > 1.4× a tap hop) and never a drift;
  2. running + X + a turn is a small hop into Drifting;
  3. the drift goes on after the heading has reached the held direction;
  4. releasing X gives Recovering at once, then Idle;
  5. at rest, holding X is the variable jump, with or without a direction;
  6. flat and Bowl A/B/C through the scenario runner: straight + X gets the full height assist (> 0.25 s) and no drift, while X + turn gets none (< 0.05 s) and ≥ 35 Drifting ticks.
  - Tests 1 and 6 fail on the intermediate speed rule.
- The `drift` scenario now requires ≥ 35 Drifting ticks and ≥ 20° slip. Measured 47 ticks flat and 66–71 on bowls A/B/C; before, 2 ticks flat.
- `driftFeedback.spec.ts`, Play mode: DRIFT shows, 15+ skid decals, then GRIP, then Idle.
- `driftFeedback.spec.ts`, Debug Lab: flat and bowls A/B/C each give one start, one end and 49–62 skid decals.

### 2. Camera: third person behind the Bey, over the shoulder

The lab presets framed the fight's midpoint from 7–17 m out and 4.7–10 m up (pitch 28–43°). The game now uses an over-the-shoulder rig per preset (`SHOULDER_RIGS`):
- the eye sits behind the player's Bey on the player → opponent line, at A 5 m / 2.4 m up, B 4.2 m / 1.9 m, C 3.6 m / 1.5 m;
- it has a right-shoulder offset (A 0.5, B 0.8, C 1 m) and looks 40–50% of the way to the opponent;
- it pulls back a little with separation, so the opponent stays in frame.

The line is followed at each preset's own orbit smoothing and speed cap (A 40°/s, B 70°/s, C 105°/s), and held when the Beys touch. Against the wall the eye comes in and rises slightly, and the look point moves toward the player. FOV, shake, knockback, Clash (B, no orbit), ring-out and finisher are unchanged.

| | before (A/B/C, sep 4–8 m) | after |
|---|---|---|
| eye height above the player | 4.7–7.6 m | 1.5–2.7 m |
| pitch | 28–34° | 10–15° |
| player on screen (NDC y) | −0.28 … −0.60 | −0.28 … −0.36 (lower half) |

Tests:
- **Headless:** the player is in the lower half, the opponent is ahead and in frame, pitch is < 30° and eye height < 4.5 m, for every preset at 4 / 8 / 14 m. Turning never exceeds the cap; it holds when the Beys touch; on the bowls the eye stays inside the arena and above the floor.
- **Browser** (`cameraShoulder.spec.ts`): the same checks through the real camera, flat and Bowl B, with screenshots.

**Trade-off (superseded by fix 6 below):** following the player → opponent line means the camera turns when the fight turns, which is what the fix-4 camera had stopped. The arrows are latched per gesture (a held direction keeps its world meaning), but their meaning changes between gestures as the camera turns.

### 3. Result auto-continue (4 s)

After WIN / LOSE / DRAW the result dialog shows "Next round in 4.0 s" (or "Rematch in …" at the end of the match). After 4 s it runs exactly its primary button's action.
- The button still continues at once.
- "Stop auto" keeps the result on screen, and Continue still works afterwards.
- It fires at most once, so a press on the timer's instant cannot start two transitions.
- No rule changed: draws still score nobody, and there is no tiebreak.
- The finished round stays frozen, and the timer is UI time only.

Tests: `autoContinue.test.ts` (fake clock) and `resultAutoContinue.spec.ts` (round 1 WIN auto, round 2 LOSE pressed, round 3 DRAW stopped for 5.5 s, match end auto-rematch).

### 4. Visual prototypes

See `docs/design-decisions/visual-fidelity-audit.md` for the A/B/C classification and what was ported. The big approved integrations (the full Hybrid C VFX with Cel Cyclone, the condition visuals, and the Clash Overdrive visuals) are listed there and not started.

### Consequences

Replay seeds are re-pinned to replay-41 / replay-64. The low-grip preset now coasts after the drift (driving on hit the wall before grip was back).

## Owner playtest fix 6 — the Bey "moves by itself" and ignores the arrows; camera too close

Owner: "the Bey keeps moving by itself and doesn't respect my movement commands… the camera is too close, put it between the previous one and this one".

Measured in the browser (real key presses, production build, the error between the held arrow and the Bey's motion on screen, computed from the live render camera):

| | fix 5 | fix 6 |
|---|---|---|
| camera yaw range over the probe | −179 … 180° | −41 … 32° |
| yaw change while an arrow is held (max per frame) | up to 82° (eye pushed over the player) | 12° (only in Clash / against the wall in contact) |
| error, every held-arrow frame (median) | 22–25° | 11° |
| error, open floor, no contact (median; share < 10°) | 25°; 22% | 6°; 64% |

Causes and fixes:
1. **The camera turned under the player's input.** The shoulder camera followed the player → opponent line, so every AI move turned the screen — and what ↑/→ mean. Now the angle is held: it never turns while a direction is held, nor for 0.6 s after release; idle, it turns only when the opponent is about to leave the frame (50° off), at ≤ 20°/s.
2. **The view aimed between the Beys**, so even with the angle held it swung 15–40° as the opponent moved sideways; and when the wall/Bey guards pushed the eye nearly above the player, the screen's up/right flipped. The view now always faces the held angle (eye → focus locked to it horizontally, ≥ 3 m ahead); Clash, ring-out and finisher shots keep their own aim.
3. **Idle wall bounces slid on.** A bounce with no input now settles with the idle damping (a hit's knockback still plays out undamped): the idle slide after a wall bounce went 1.0 m → 0.42 m headless.
4. **Distance:** `SHOULDER_RIGS` sit between the lab camera and fix 5: A 6.5 m / 3.9 m up, B 5.6 / 3.2, C 4.8 / 2.6 (fix 5: 5 / 2.4, 4.2 / 1.9, 3.6 / 1.5; lab 7–17 m / 4.7–10 m). Brought in against the wall, the eye also comes down in proportion, so the pitch stays < 30°.

Tests: `cameraRig.test.ts` — the angle and the rendered view hold while the opponent swings ±45° (idle) and walks 120° round (steering); after release it waits ≥ 0.5 s and turns ≤ 20°/s (this test fails on the fix-5 director: the view swung 33°). The camera lab's `normal-duel` seed is re-pinned to `k` (Clash at 2.0 s, no round end in 15 s).

**Superseded by fix 7 below.** Fix 6 treated the symptom in the camera: it never touched why ↑/→ meant something different between gestures in the first place (Directional read the camera's yaw at all). Fix 7 removes that reading entirely, at which point the camera-hold/view-lock machinery in items 1–2 above has nothing left to compensate for.

## Owner playtest fix 7 — Directional is arena/world-relative; the camera cannot participate

Owner (closed decision, 2026-09): "a câmera não pode influenciar o controle… Directional deve ser ARENA/WORLD-RELATIVE… Esta decisão agora está FECHADA." Not a tuning pass on fix 6's camera lock — a different root cause. `DirectionalController` computed the world direction from the camera's yaw (`screenToWorld(screen, cameraYawRad)`), latched for one input gesture (`CameraYawLatch`) but re-read on release or a turn past 30°, so the same key could mean a different world direction depending on where the automatic camera pointed between gestures. Fix 6's camera-angle lock (items 1–2 above) reduced how often that happened (screen-error median 25° → 6°) without removing the coupling, and needed a ~60% taller `SHOULDER_RIGS` to keep both fighters in frame with the angle locked — both against the owner's "não resolva subindo muito a câmera".

**Fix:** `screenToWorld(screen)` is now a pure, fixed mapping (Up = world +Z, Right = world +X) with no camera parameter in its signature at all — the coupling is structurally impossible, not just avoided. `CameraYawLatch` is deleted; there is nothing left to latch. `CameraDirector`'s shoulder camera goes back to always following the player → opponent line (fix 5's behavior, items 1–2 of fix 6 reverted) — it can turn however it likes, since Directional input no longer reads it. `SHOULDER_RIGS` keeps fix 6's philosophy (pull the eye back, not up) at fix 5's heights: A 5.8 m / 2.4 m, B 5 m / 1.9 m, C 4.3 m / 1.5 m (fix 6 was 6.5/3.9, 5.6/3.2, 4.8/2.6; fix 5 was 5/2.4, 4.2/1.9, 3.6/1.5).

A genuinely separate bug fixed along the way, unrelated to the camera: a wall/Bey bounce with no movement input played out at full post-impact speed (11 m/s in, 7 m/s back, ~3 m of unbraked slide) — a real, physical version of "moves by itself". Now damped like any other idle motion; a real knockback (hit, counter, Clash loss) still plays out untouched. (Fix 6 found and fixed this same bug independently, via the same `MovementController.ts` change kept here.)

Tests: `directionalInput.test.ts` (world direction held constant while camera yaw sweeps 3 rad, from four starting yaws; no input + orbiting camera → zero intent; every held direction reflected immediately with no stuck intent); `directionalCameraIndependenceIntegration.test.ts` (30 s of real AI combat on Flat + Bowl A/B/C, real `MatchSession` + real `CameraRig`, moveIntent never drifts from the fixed mapping, controller owner never silently flips to AI, input responsive within 10 ticks of a real impact); `playerDirectionalControl.spec.ts` (real Playwright keyboard events: world displacement agrees between the Debug Lab's overview camera and the game's chase camera — two views that look nothing alike; a real AI fight traced tick-by-tick for a held-key-produces-no-movement violation, none found). `cameraRig.test.ts`'s fix-6-specific "does not chase the opponent" test is removed (the feature it tested is gone); the "low"/pitch ceilings return to fix 5's values (4.5 m / 31°, the latter loosened 1° for the wider fix-6-philosophy distances at wide separation).

## Owner playtest fix 8 — the in-game camera goes back to a dynamic, opponent-focused, two-fighter director (GDD §§48–50)

Owner (closed decision, 2026-09): reading the GDD literally, the in-game camera had drifted from its own design — "priorizar o oponente como relação focal; enquadrar dinamicamente ambos os lutadores; adaptar distância à separação; poder orbitar automaticamente; variar posicionamento por contexto; NÃO ficar permanentemente atrás do jogador." Fix 6's `playerSteering`/held-angle lock (reverted in PR #63's merge, see below) and fix 5–7's `ShoulderRig` (`heldYaw = baseYaw + PI`, updated whenever separation > 2.5 m) were both compensations for the pre-fix-7 camera-relative Directional input: fix 7 already made `screenToWorld` a pure, camera-free mapping, so nothing was left for either lock to compensate for. Keeping `ShoulderRig` after fix 7 left the in-game camera doing something the GDD never asked for: a camera rigidly behind the player, ignoring `opponentWeight`, automatic orbit lead, close-combat drift and side switching — all of which the Camera Lab (this game's own approved reference, `prototypes/camera-concepts/`) already implements and the "ported director = the approved Camera Lab" test in `cameraRig.test.ts` proves the game's `CameraDirector` reproduces tick for tick whenever `arena` isn't set.

**Fix:** `CameraDirector`'s `arena` option no longer carries a `shoulder: ShoulderRig` (the type and `SHOULDER_RIGS` are both deleted) and no longer has a "hold the angle once per round" branch either — both `heldYaw` code paths are gone. `arena` now means exactly one thing: contain the eye inside `containRadiusM` (pulled in and raised, never by swinging the angle) plus the existing floor guard for the bowls. Every other behaviour the in-game camera runs — `framingBias`/`opponentWeight` for the focus point and heading, automatic orbit lead (`axisRate`), close-combat drift, side switching (`updateSide`), look-ahead, encounter prediction, and offscreen rescue — is now unconditionally the same code the Camera Lab runs, because the `if (!arena)` guards around each of them are gone.

The one thing kept in-game-specific is height/distance, via `CameraRig`'s new `ARENA_CAMERA_RIGS` (replacing `SHOULDER_RIGS`): `minDistance`/`maxDistance`/`cameraHeight` overrides on top of the otherwise-untouched preset (A/B/C keep every other Lab parameter — FOV, orbit speed, damping, shake, contexts — unchanged). The overrides keep the close, low, third-person feel from fix 7's `ShoulderRig` at rest (A 5.8 m / 2.4 m, B 5 m / 1.9 m, C 4.3 m / 1.5 m) but, unlike `ShoulderRig`'s hard-capped `maxExtraDistanceM`, let `maxDistance` grow generously (A 13 m, B 14 m, C 15 m) so the director's own `separationResponse` can pull back as far as it needs to keep the opponent framed at wide separation; the arena's `containRadiusM` (10.5 m) and the existing `HEIGHT_PER_DISTANCE` keep that from ever reading as top-down (measured pitch stays under 46° even at 18 m separation, the practical maximum on this arena — see the scenario F test below).

**Measured** (`cameraTwoFighterFraming.test.ts`, scenarios A–K, every preset; `directionalCameraIndependenceIntegration.test.ts`'s new "fundamental test"):

| scenario | opponent visibility | longest opponent offscreen gap | notes |
|---|---:|---:|---|
| A/B/C/F/G/I/J (ordinary combat, incl. player or opponent pinned against the wall) | ≥ 98% (measured 100% in most) | < 0.3 s | offscreen rescue (distance/FOV) keeps both fighters framed even at 18 m separation or pinned to the rim |
| D/E (the player passes directly through/by the opponent's position) | ≥ 80% (measured 86–90%) | < 0.3 s | the axis genuinely inverts when a fighter passes the other; `AXIS_FREEZE_BELOW_M` holds through the pass, then the camera re-orbits at the preset's own speed cap — a brief, bounded reframe, not a bug |
| H (a strong knockback launches the opponent across the arena) | ≥ 90% | < 0.5 s | the launched fighter is explicitly the KnockbackFollow target during the follow itself; CombatFollow's two-fighter framing resumes once it settles |
| K (A on flat + bowls A/B/C) | ≥ 98% | < 0.3 s | same guarantee on every floor |

Orbit is never faster than each preset's own `orbitSpeed` cap (A 40°/s, B 70°/s, C 105°/s) or FOV faster than `fovMaxRate` (A 35°/s, B 60°/s, C 110°/s) in any scenario — measured exactly at the cap during the fastest forced turns (the opponent sweeping past at high angular speed), never above it. The "fundamental test" drives the opponent fully around a stationary player (360°) while a held ArrowUp is sampled through the real `DirectionalController` every tick: the camera's own yaw sweeps well over half a full turn (> 180° of accumulated rotation, every preset) while `moveIntent` reads exactly `{x:0, z:1}` on all 360 ticks — proof the orbit and the held direction are structurally independent, not independent by coincidence.

The automatic close-combat drift (`closeDrift`, GDD "órbita automática" while fighting up close) is alive again — measured ~8° (A), ~24° (B), ~40° (C) of drift over 2 s at touching range, bounded by `CLOSE_DRIFT_MAX_RAD` (≈ 51.6°) regardless of preset — where fix 5–7's `ShoulderRig` held the angle rigid inside `SHOULDER_AXIS_MIN_SEP_M` (2.5 m) instead.

**Removed** (fix 6/PR #63 leftovers, confirmed gone): `playerSteering`, `shoulderIdleS`, `SHOULDER_REAIM_IDLE_S/ZONE/RAD_S`, the "never turns while direction is held" rule, and the "view always faces the held angle" forcing block were already reverted when PR #62 reconciled with PR #63 (see the PR body). This fix goes one step further and removes the fix 5–7 `ShoulderRig`/`heldYaw` mechanism itself, which PR #63's revert had left in place — that mechanism existed for exactly the same now-obsolete reason (compensating for camera-relative input) and the GDD never asked for it.

Tests: `cameraRig.test.ts`'s "in-game arena camera" describe block is rewritten for the new priorities (opponent-visibility-first, not "player always in the lower half"); a new `cameraTwoFighterFraming.test.ts` implements the owner's 11 scenarios (A–K) with the exact metrics requested (visibility %, longest offscreen gap, max yaw/FOV rate, side switches/5 s, distance/pitch/separation range, rescue amount); `directionalCameraIndependenceIntegration.test.ts` gains the fundamental orbit-independence test above. `buildInspection.ts`'s Camera section drops the `SHOULDER_RIGS`-specific readout for the new `ARENA_CAMERA_RIGS` + framing-bias/opponent-weight one.

### Follow-up: scenario E's axis-crossing gap (owner playtest, same day)

The owner's playtest pass on fix 8 flagged two things before merge sign-off, per the hierarchy already approved (focus/rescue/distance/FOV before touching orbit): scenarios D/E's opponent visibility (measured 86–90%, reported as "D/E" but D was actually already 100% — only E, the player rushing past a stationary opponent, had the gap) and the 51.4° pitch peak with the player pinned against the wall (preset A, separation 10 m).

**Scenario E (fixed):** traced frame by frame, the gap is a single ~0.2 s window right after the player passes the opponent, once `AXIS_FREEZE_BELOW_M` releases and the fight axis flips by close to a half-turn in one tick. The reactive offscreen rescue (`this.rescue` growing only once a fighter is already offscreen) had too few ticks to build up before the crossing was over. Fix: `CROSSING_AXIS_RATE_RAD_S` detects exactly that single-tick axis flip (ordinary orbiting/strafing never approaches this rate) and jumps `rescue` to `CROSSING_RESCUE_PULSE` (0.55) immediately — distance and FOV only, since both already scale with `rescue` regardless of direction; no `rescueTowardFirst` guess needed, and no change to yaw/orbit speed. Gated on `arena` being set, so the unmodified Camera Lab (no `arena` option) is bit-for-bit unaffected — verified against `cameraRig.test.ts`'s "reproduces the lab director tick for tick" test (an earlier, wider attempt at this fix — a permanent wider "near the edge" rescue trigger margin — was dropped specifically because it broke that lab-parity test and pushed the wall-pinned scenario's pitch up further, the opposite of what was wanted).

Measured: scenario E opponent visibility 86.7% → 100% (A, B) / 98.9% (C, one remaining tick), D unaffected (already 100%), every other scenario (A/B/C/F/G/H/I/J/K) unchanged. `cameraTwoFighterFraming.test.ts`'s D/E test tightened from the temporary ≥80% allowance to the same ≥95% bar as every other CombatFollow scenario.

**Pitch peak (documented, not changed):** 51.4–51.75° at preset A, player at z=−10 (against the 10.5 m arena rim), opponent central, 10 m separation — `eyeRadius` sits exactly at `containRadiusM` (10.5 m), i.e. the containment guard is holding the eye at the arena's edge, and the extra height there comes from `containEye`'s own "raised to keep the framing" lift plus the separation-driven distance/height growth. Screenshot captured (`test-results/camera-A-player-near-wall.png`) for the owner's own visual judgment call, per their explicit request not to change this without seeing it first.
