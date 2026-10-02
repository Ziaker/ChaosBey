# Inertial Duel Camera — composition-driven combat framing

**Status:** implemented in PR #89; technical validation in progress; owner visual/game-feel review still required before merge.

**Owner problem statement:** improve the camera without allowing it to influence player movement. The camera must behave more like an arena-fighter lock-on presentation system: it observes the duel and solves framing, while the player's movement remains owned by gameplay/input.

## 1. Non-negotiable causal boundary

This decision is downstream of `camera-gameplay-separation.md` and does not weaken it.

- Camera may observe gameplay state.
- Camera may move its eye/focus/FOV and choose presentation modes.
- Camera may never write gameplay, physics, `moveIntent`, controller state, replay state or RNG state.
- `opponent`, `classic` and `arena` control schemes remain camera-independent.
- `screen` remains the sole explicit opt-in exception: it may read camera orientation once per movement gesture, as already established by PR #81.
- A camera that is absent, frozen, real or deliberately hostile must produce identical gameplay for the three camera-free schemes.

The AST guard and deterministic `cameraGameplaySeparation` suite remain mandatory gates.

## 2. Problem with continuous fight-axis following

The historical director derived normal-combat yaw primarily from the instantaneous player→opponent axis. That works at low relative angular speed but is structurally unstable in ChaosBey because the subjects can cross, orbit, ricochet and reverse at high speed.

A crossing can invert the player→opponent vector by almost 180° in a few ticks. If that vector is also the camera's yaw authority, the camera treats a normal pass-through as an instruction to reorganize the world. Previous rescue logic could keep subjects visible, but visibility alone did not preserve spatial orientation.

The redesign therefore separates two questions:

1. **What is happening in the duel?** The base `CameraDirector` still answers this and produces distance/height/focus/FOV/shake/context information.
2. **Does the camera actually need to rotate?** `InertialDuelDirector` answers this from screen-space composition and persistent camera azimuth.

## 3. Architecture

The approved `CameraDirector` remains intact as the base/context generator. The game-facing `CameraRig` wraps it in `InertialDuelDirector`.

Normal combat owns a persistent `combatAzimuth`. It is initialized from the base shot but is not re-derived every tick from the player→opponent axis.

The final camera solves framing in this order:

1. preserve current combat azimuth when composition is healthy;
2. shift focus toward the endangered subject;
3. pull back;
4. open FOV;
5. add modest height through the reconstructed eye;
6. only then permit the minimum-direction yaw correction needed to recover composition.

Yaw correction has both angular-speed and angular-acceleration caps. The intent is not a fixed camera; it is a camera with spatial memory.

## 4. Safe frame, composition pressure and hysteresis

Both fighters are projected to normalized screen coordinates. `±1` is the actual viewport edge.

Each preset has:

- a **soft frame**, where optical rescue begins;
- a **hard frame**, where yaw may become immediately eligible;
- a soft-frame hold duration before yaw becomes eligible;
- bounded focus, distance and FOV rescue;
- bounded yaw velocity and acceleration.

As long as both fighters remain comfortably framed, a crossing or orbit is allowed to happen *inside the screen* without requiring the camera to swap hemispheres.

Optical rescue itself is stateful. Raw soft-frame violation is converted into a smoothed `rescuePressure` rather than applied directly every tick. Rescue pressure builds with a short attack constant and releases more slowly after subjects return inside the soft frame. This is intentional hysteresis: focus, distance and FOV do not pulse on/off when a Bey hovers around the threshold.

Current tuning:

| Preset | Rescue attack | Rescue release |
| --- | ---: | ---: |
| A — Arena Fighter | 0.10 s | 0.28 s |
| B — Cinematic Hybrid | 0.08 s | 0.24 s |
| C — Hyper Dynamic | 0.06 s | 0.20 s |

Hard-frame violations still allow immediate yaw eligibility; hysteresis does not delay an actual framing emergency. It only prevents soft-boundary pumping.

This is the central behavior change: **the fight may rotate inside the frame while the world remains spatially stable.**

## 5. Presets

A/B/C remain the owner-approved camera personalities. They share one architecture and differ only in tuning/aggressiveness.

- **A — Arena Fighter:** calmest, largest preference for optical rescue, lowest yaw rate/acceleration.
- **B — Cinematic Hybrid:** balanced baseline.
- **C — Hyper Dynamic:** fastest correction and strongest optical response, but still composition-driven rather than axis-follow driven.

The game-facing inertial tuning is:

| Parameter | A | B | C |
| --- | ---: | ---: | ---: |
| soft frame X/Y | 0.70 / 0.72 | 0.72 / 0.74 | 0.74 / 0.76 |
| hard frame X/Y | 0.88 / 0.90 | 0.90 / 0.92 | 0.92 / 0.94 |
| soft hold before yaw | 0.16 s | 0.13 s | 0.10 s |
| max yaw rate | 30°/s | 45°/s | 60°/s |
| max yaw acceleration | 90°/s² | 140°/s² | 220°/s² |
| max distance rescue | 5.5 m | 5.0 m | 4.5 m |
| max extra FOV | 10° | 11° | 12° |
| max focus rescue | 0.16 | 0.18 | 0.20 |

No preset is permitted to restore direct continuous fight-axis yaw authority. A/B/C continue to inherit the approved Camera Lab's FOV, shake, look-ahead, context and transition identity; a dynamic preset does not need to spin the world merely to prove that it is dynamic.

## 6. Cinematic takeovers

Clash, Ring-Out and Finisher are explicit presentation states and may temporarily own the shot.

When one of those modes has meaningful weight:

- the remembered normal-combat azimuth is frozen underneath it;
- normal composition yaw does not secretly advance while hidden;
- the special shot may use the base director's eye/focus/FOV;
- return to combat blends back to the preserved combat orientation rather than recomputing it from the current fight axis.

The previously approved Clash rule remains: Clash uses the Cinematic Hybrid/B presentation treatment even when another normal preset is selected.

## 7. Arena 3× integration

PR #89 also incorporates the camera-scale correction from PR #88:

- camera containment derives from the 36 m arena scale rather than the old 12 m assumptions;
- ring-out anticipation uses the arena-derived watch radius;
- an airborne Bey at mid-stage is not treated as a ring-out candidate simply because it is beyond the old 9 m threshold;
- the final post-composition eye reapplies containment, floor clearance and Bey clearance after the inertial wrapper reconstructs the shot.

The camera is therefore validated against the current stage geometry, not against obsolete 12 m presentation constants.

## 8. Spatial-stability metrics

Visibility is necessary but insufficient. The redesign adds metrics that can fail a camera even when both fighters remain technically visible:

- `totalYawTravelDeg` — cumulative functional composition yaw;
- `yawReversals` — direction reversals in composition yaw;
- `yawVelocityDegS`;
- `yawAccelerationDegS2`;
- `rescuePressure`;
- soft/hard screen-frame violation;
- duration outside the soft frame;
- per-fighter projected screen coordinates;
- whether functional composition correction is active;
- cinematic takeover blend.

The Debug Lab/presentation debug output exposes this state without feeding it back to gameplay.

## 9. Required regressions

The following scenarios are mandatory for the game-facing inertial camera, not only the raw Camera Lab director:

- A: opponent orbits player;
- B: player orbits opponent;
- C: mutual/counter orbit;
- D: opponent crossing;
- E: player high-speed pass-through;
- F: separation ladder;
- G: high-speed orbit / close-pressure stress;
- H: knockback follow;
- I: player near the 36 m rim;
- J: opponent near the 36 m rim;
- K: Flat + bowl profiles A/B/C.

In addition, dedicated pass-through and double-crossing tests must prove that crossing does not justify a camera half-turn or oscillatory side chasing.

## 10. Test interpretation change

Older tests sometimes used “the camera must orbit by >N degrees” as evidence that movement was camera-independent. That assertion encoded the old camera behavior, not the real owner invariant.

Those tests are superseded where necessary. The correct proof is:

- movement/world trajectory remains correct with the real camera attached;
- deterministic hostile/static/absent camera runs produce identical gameplay for camera-free control schemes;
- browser tests measure the player's world-space movement/bearing while the real camera is present and finite;
- separate camera tests prove that the camera *does* rotate when composition requires it and remains stable when it does not.

A camera that legitimately stays at the same yaw through a well-framed crossing is now a success condition, not a test failure.

## 11. What this feature must never do

Do not fix framing by:

- steering or rotating a Bey;
- changing movement vectors;
- reducing Bey speed or grip;
- suppressing crossings;
- making gameplay depend on camera yaw;
- restoring `gestureYaw`/camera callbacks into the normal control chain;
- forcing the camera permanently behind the player;
- adding scenario-specific teleports or physics exceptions;
- restoring continuous axis-follow under another name;
- adding arbitrary orbit only to make the camera appear “active”.

## 12. Completion gate

Before this feature can leave draft status:

- TypeScript typecheck green;
- full Vitest suite green;
- `inputCameraBoundary` green;
- `cameraGameplaySeparation` green;
- inertial pass-through/double-crossing tests green;
- inertial A–K matrix green for all A/B/C presets;
- production build green;
- Playwright smoke green;
- Windows + macOS desktop builds green;
- branch reconciled with current `main` and mergeable;
- `package.json`, `package-lock.json`, README and design-decision docs synchronized at the feature release version;
- owner still performs the final visual/game-feel review before merge.

## 13. Owner-review questions

Technical success does not automatically mean final feel approval. Owner review should focus on:

- whether crossings now preserve orientation instead of making the world chase the Beys;
- whether B still has enough cinematic energy;
- whether C is dynamic without becoming disorienting;
- whether knockback/high-speed framing feels responsive enough without axis-follow;
- whether any composition correction is perceptibly late near the edge;
- whether optical rescue breathes smoothly instead of pumping around the safe-frame boundary.

These are tuning/feel questions. They must not be “solved” by reopening the camera→movement dependency.
