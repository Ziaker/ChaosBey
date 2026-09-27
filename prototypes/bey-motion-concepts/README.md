# Bey Motion Lab — prototype

**Status:** the three motion directions (A/B/C) below and this lab's physical language are approved as base directions and as a tuning tool. The 33 slider values shown are still prototype values, not approved production tuning — see `docs/design-decisions/motion-approval.md` for the exact, owner-worded scope of what is approved vs. still open (including the `ext-0`/`ext-32` cases and spin readability). Nothing here is integrated into the game yet.

Interactive prototype for **comparing, tuning and approving how a ChaosBey moves** before any new motion language is integrated into the game. The goal is a Bey that reads as a spinning mechanical object, not a rigid disc sliding on the floor.

- **Isolated.** It imports nothing from `src/` and changes no gameplay, physics, collider, knockback, stat or balance.
- **Prototype values.** Every value here is a prototype value, not final balance.
- **Preset names are lab identifiers,** not game modes.
- **Models.** The 3D models are the Bey Lab's round-2 concepts, built by the same code.

It has two sections (tabs).

## 1. Motion physics (default tab)

A small deterministic motion model written for the lab (`src/physics/model.ts`, fixed 1/240 s steps, no randomness). Every behavior the spec asks for is driven by a live parameter:
- **Driving and grip:** heading vs. velocity, slip, grip and grip recovery.
- **Attitude:** tilt/lean (into acceleration and with speed), wobble, and a precession-like response (gyroscopic coupling).
- **Recovery:** upright recovery with damping, fading back in gradually after impacts.
- **Impacts:** Bey-Bey restitution, linear-to-angular transfer (body whirl and spin change), knockback with lift, tumble/whirl above a threshold, angular damping.
- **Contacts:** floor bounce, wall bounce, wall friction/scrape, and ring-out over a 2 m wall.
- **Safety clamps** on speed and angular speed.

It is **not** the game's physics: the game runs Rapier with its own controllers.

### Presets
| | Name (lab only) | Direction |
|---|---|---|
| **A** | Stable Arcade | Firm and readable: small tilt, wobble and tumble, fast recovery, high grip. |
| **B** | Physical Hybrid | Starts from the game's current movement values (accel 14, top 11 m/s, turn 2.6 rad/s, lateral grip 5.5, air grip 0.4, wobble 6° at 7 Hz): weight and inertia, expressive slip and tilt, impacts transfer spin and lean, physical but controlled recovery. |
| **C** | Wild Mechanical | Strong angular reactions: big tilt, wobble, bounce and tumble, dramatic ricochets, still clamped for stability. |

### Parameters
There are 33 sliders grouped by Drive, Grip/slip, Tilt/lean, Wobble/precession, Recovery, Impacts/bounce and Stability limits (`src/physics/params.ts`):
- each slider shows its current value and unit, with a tooltip explaining it;
- sliders changed from the selected preset are highlighted and counted;
- **Reset to preset** restores the selected preset;
- **Copy JSON** writes `{ preset, modified, params }`, the record to keep once the owner approves a mix.

### Reproducible scenarios
- Straight acceleration
- High-speed curve
- Diagonal / heading vs velocity
- Drift / slip
- Wall impact (head-on)
- Ricochet (40°)
- Wall scrape
- Weak knockback
- Strong knockback
- Tumble (glancing strong hit)
- Floor bounce
- Wobble & recovery
- **M7 ext-0 analog:** counter → ring-out
- **M7 ext-32 analog:** pinned at the wall

Scenarios are scripted (inputs + attack hits) and deterministic. **Restart** (`R`) replays one exactly with the current preset and sliders, which makes shot-for-shot comparison possible. The timeline scrubs; seeking re-simulates from 0 and lands on the same state.

### Game replays: what the game does today
The two M7 findings are exported from the game's own headless simulation (the same harness as the deterministic tests), tick by tick, as data the lab plays back with the same overlays. They are **investigated here, not fixed in the game**.

| Replay | Seed / pairing | What happens |
|---|---|---|
| `m7-ext-0.json` | `ext-0`, attack vs attack | At 0.77 s Bey 1 hits and at 0.92 s Bey 2 takes a knockback of force 37.6. Bey 2 is thrown at ~28 m/s with 7.4 m/s up, above the 2 m wall, and rings out at tick 106 (1.77 s). |
| `m7-ext-32.json` | `ext-32`, attack vs defense | **Bey 1 (attack-prototype)** sits at r ≈ 12.1 m, past the 12 m floor edge, barely moving, for **23.5 s** from t ≈ 11.9 s: wedged in the edge wall collider. The M7 report named the Defense Bey; with this harness's seed convention it is the Attack Bey. |

Key moments are detected from the data and offered as jump buttons: hits, knockbacks, the longest wedge, the highest point and the ring-out crossing. Refresh the replays after a game physics change with:

```bash
npx vitest run --config prototypes/bey-motion-concepts/scripts/vitest.export.config.ts
```

### Analog scenarios vs. presets (measured)
| Scenario | A | B | C |
|---|---|---|---|
| M7 ext-0 analog (same ~28 m/s launch) | no ring-out, barely leaves the floor | no ring-out: 1.3 m high, hits the 2 m wall | **ring-out** at 0.5 s (3.4 m high) |
| Drift: time with grip broken | 0 s | 1.2 s | 2.7 s |
| Tumble: peak whirl | 0.3 rad/s | 1.9 rad/s | 12.5 rad/s |
| Wall impact: peak tilt | 10° | 13° | 57° |

### Debug
- **Arrows:** velocity (green), heading (blue), steering (yellow), spin axis (white), contact normal (red, 0.5 s after a contact).
- **Trail.**
- **Live table per Bey:**
  - speed, heading-vs-velocity angle;
  - tilt, tilt rate, whirl, spin;
  - wobble, grip (+ SLIP), upright recovery torque;
  - height (+ AIR);
  - state: TUMBLE, WALL, RING-OUT, and the game's attack state in replays.

### Cameras
- Combat (reference), follow Bey 1/2, top, side, free orbit.
- "Combat" reproduces the game's **current** combat camera as a reference only.
- **Camera language is not designed here.** A separate Camera Lab comes after the motion is approved, using the approved motion.

### Integration rule
Motion Lab → owner tests A/B/C and sliders → owner picks or mixes → the approved values and behaviors are recorded (Copy JSON) → only then is integration planned, with tests for the approved behavior. Nothing here is integrated before that.

## 2. Spin readability

The nine round-2 concepts at game scale, game spin rate, tilt and wobble, on choreographed paths, seen from a reproduction of the game's combat camera, with a per-concept 60 fps aliasing readout.

### What it mirrors from the game (as of `main@0b945f2`)

| What | Value | Source |
|---|---|---|
| Visual spin rate | 22 rad/s (≈ 210 rpm, 21°/frame at 60 fps) | `src/bey/spin/SpinTuning.ts` `BASE_SPIN_RATE_RAD_S` |
| Wobble | ±6° × energy, 7 Hz, a rock about the Bey's local X axis | `SpinTuning.ts` + `src/app/bootstrap/createMatchScene.ts` |
| Reference tilt | 35° | `SpinTuning.ts` `MAX_GAMEPLAY_TILT_RAD` |
| Wobble at zero Stamina | ≥ 0.25 energy | `src/bey/stamina/StaminaTuning.ts` |
| Combat camera: base framing | 9 m **horizontal** distance, 6 m above the focus, FOV 55° | `src/camera/CameraTuning.ts` |
| Combat camera: separation | +0.6 m per meter of separation beyond 3 m, clamped 7–16 m | `src/camera/CombatCameraController.ts` |
| Combat camera: placement | behind the player on the fight axis, 0.35 rad to one shoulder; orbit smoothed | `CombatCameraController.ts` |
| Combat camera: speed | above 14 m/s: pulls back +2 m, up +0.6 m, +4° FOV | `CameraTuning.ts` |
| Bey size | ~1.3–1.4 m (same `BEY_SCALE` as the Arena Lab) | `prototypes/arena-visual-concepts` |
| Arena floor | 12 m radius, flat (the approved bowl is not integrated yet) | — |

### Controls (spin readability)

| Action | UI | Key |
|---|---|---|
| Layout: one Bey / two / all nine | Solo / Duel / All 9 | `Q` / `W` / `A` |
| Pick a concept | panel buttons | `1`–`9` |
| Pick the second Bey (Duel) | Shift + click | `Shift` + `1`–`9` |
| Spin rate | slider, presets 22 (game) / 45 / 90 / 150 rad/s | — |
| Reverse spin direction | Reverse direction | `V` |
| Spin-down (a Bey running out of Stamina: spin → 0 over 8 s, wobble grows) | Spin-down | `N` |
| Static tilt, wobble energy | sliders | — |
| Wobble style: the game's rock, or a precession alternative | Rock (game) / Precession | — |
| Movement: still / circle / figure 8, speed 0–18 m/s | buttons + slider | `M` toggles still |
| Camera: combat / close / top / free orbit (drag) | buttons | `G` / `C` / `T` / `F` |
| Time: 1× / ¼× / 1/20×, pause | buttons | `S` (¼×), `Space` |
| Spin blur (sub-frame ghosts, off by default: the game has none) | Spin blur | `B` |

### Readability at 60 fps (the panel's readout)

The game draws one image per frame. A ring whose feature repeats N times looks identical every 360°/N, so the eye reads **the rotation per frame modulo 360°/N** (the "wagon wheel" effect):
- near 0, the ring looks **frozen**;
- just under a full period, it looks like it turns **backwards**;
- near half a period, the direction is **ambiguous**.

The readout computes this per concept for the current spin rate, from each ring's feature count (`src/symmetry.ts`, taken from the ring builders).

Computed verdicts at 60 fps:

| Concept | Ring fold | 22 rad/s (game) | 45 | 90 | 150 |
|---|---|---|---|---|---|
| Attack A | 4 | forward | ambiguous | FROZEN | backwards |
| Attack B | 1 (asymmetric) | true spin | true spin | true spin | jumps |
| Attack C | 2 | forward | forward | ambiguous | backwards |
| Defense A | 8 | ambiguous | FROZEN | backwards | forward |
| Defense B | 6 | ambiguous | backwards | ambiguous | ambiguous |
| Defense C | 8 | ambiguous | FROZEN | backwards | forward |
| Stamina A | 5 | forward | backwards | forward | FROZEN |
| Stamina B | 6 (+ 48 rim teeth) | ambiguous (teeth: backwards) | backwards | ambiguous | ambiguous (teeth: forward) |
| Stamina C | 3 | forward | ambiguous | backwards | forward |

At the game's current 22 rad/s:
- **Defense A, B and C** and **Stamina B** do not read a clear spin direction.
- No single spin rate reads cleanly for all nine concepts.

This is a finding for the owner to weigh, not a decision.

## Open decisions this lab informs (owner only)

- [ ] **Final visual spin rate.** Keep 22 rad/s, or change it? A spin rate can also vary per Bey, or with Stamina.
- [ ] **Spin readability.** Accept aliasing, or counter it with one or more of:
  - spin blur or a motion smear;
  - an asymmetric accent on every ring;
  - fewer, larger features.
- [ ] **Wobble style.** The game's rock about one axis, or precession.
- [ ] **Which 3 finals, one per archetype** (still open in the inventory). This lab lets them be judged at game speed and distance.
- [x] **Motion language direction:** A, B and C are approved as base directions (`docs/design-decisions/motion-approval.md`). Still open: a single default, or a final mix — record that choice with Copy JSON when made.
- [ ] **The two M7 edge cases.** Is a ~28 m/s counter launch over the wall acceptable (ext-0)? The edge wedge (ext-32) is a collision problem to fix at integration. Recorded as investigation scenarios, not approved fixes, in `docs/design-decisions/motion-approval.md`.

## Files

```
index.html                   page shell, both panels, CSS
src/main.ts                  tabs + automation hook (window.__beyMotionLab.{physics,spin})
src/physicsSection.ts        motion physics panel: presets, sliders, scenarios, replays, transport, debug, readout
src/physics/model.ts         the lab's motion model (deterministic)
src/physics/params.ts        parameter specs + presets A/B/C
src/physics/scenarios.ts     reproducible scenarios
src/physics/PhysicsViewer.ts rendering, overlays, cameras, replay playback, key moments
src/replays/*.json           exported game replays (data only)
scripts/replays.export.ts    replay exporter (runs the game's headless sim)
src/spinSection.ts           spin readability panel
src/MotionViewer.ts          spin readability scene (paths, combat camera, blur ghosts)
src/tuning.ts                mirrored game values (with sources)
src/symmetry.ts              ring fold per concept + aliasing math
```

Tests:
- `tests/unit/BeyMotionLabModel.test.ts` checks the model: stable and finite in every scenario × preset and at every slider extreme; deterministic; presets ordered A < B < C; slip recovers; upright recovery; wall bounce and ring-out.
- `tests/smoke/beyMotionConcepts.spec.ts` exercises both sections in the browser.
