# Bey Motion Lab — prototype

Interactive Three.js page that shows the **nine round-2 Bey concepts in motion**, the way the game renders a Bey:
- at game scale;
- at the game's visual spin rate, with tilt and wobble;
- moving across the floor;
- seen from the **combat camera**.

It fills the biggest open visual gap in the visual inventory ([`docs/design-decisions/visual-prototype-inventory.md`](../../docs/design-decisions/visual-prototype-inventory.md), section 10.2): the Bey Lab is a static/slow-turntable inspection, and nothing yet showed the concepts spinning at game speed from game distance.

This is **visual exploration only**:
- It imports nothing from `src/`. The game values it mirrors are **copied** into `src/tuning.ts`, each with its source file.
- It changes no gameplay, physics, collider, stat or balance.
- Movement is choreography, not physics.
- The models are the Bey Lab's own round-2 concepts, built by the same code (`../bey-visual-concepts/src/model/assembleConcept.ts`).

## Open it

```bash
npm run dev       # http://localhost:5173/prototypes/bey-motion-concepts/
# or, production build:
npm run build && npm run preview
                  # http://localhost:4173/ChaosBey/prototypes/bey-motion-concepts/
```

## What it mirrors from the game (as of `main@0b945f2`)

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

## Controls

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

## Readability at 60 fps (the panel's readout)

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

## Open visual decisions this lab informs (owner only)

- [ ] **Final visual spin rate.** Keep 22 rad/s, or change it? A spin rate can also vary per Bey, or with Stamina.
- [ ] **Spin readability.** Accept aliasing, or counter it with one or more of:
  - spin blur or a motion smear;
  - an asymmetric accent on every ring;
  - fewer, larger features.
- [ ] **Wobble style.** The game's rock about one axis, or precession.
- [ ] **Which 3 finals, one per archetype** (still open in the inventory). This lab lets them be judged at game speed and distance.

## Files

```
index.html          page shell + panel + CSS
src/main.ts         wiring, keyboard, readout, automation hook (window.__beyMotionLab)
src/MotionViewer.ts scene, Bey node chain (position → tilt × wobble → spin), paths, combat camera, blur ghosts
src/tuning.ts       mirrored game values (with sources) + lab ranges/presets
src/symmetry.ts     ring fold per concept + apparent-spin (aliasing) math
```

Smoke test: `tests/smoke/beyMotionConcepts.spec.ts`.
