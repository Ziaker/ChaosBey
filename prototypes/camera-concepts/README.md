# Camera Lab — prototype

An interactive page for choosing ChaosBey's camera. It shows **three complete camera directions** running on **real fights from the game's own simulation**, with sliders for every parameter, twelve reproducible scenarios and a debug view of why the camera is where it is.

Status: **prototype for approval**.
- The values are prototype values (GDD 167).
- The game's camera (`src/camera/`) is untouched, and nothing here is integrated.
- Final integration happens only after the owner picks a direction, or a mix.

## Direction it follows (GDD 48–50)

The lab keeps to the direction the GDD already sets:
- an opponent-focused arena camera, semi-over-the-shoulder;
- a high FOV that widens with speed, with a 120° ceiling;
- distance that adapts to the separation between the Beys;
- automatic, contextual orbit;
- no manual control;
- dedicated behaviour for high speed, close combat, knockback, Clash, Ring-Out and the final hit;
- spectacle never at the cost of reading the fight.

## The three directions

| | A — Arena Fighter | B — Cinematic Hybrid | C — Hyper Dynamic |
|---|---|---|---|
| **Goal** | Readability first | Premium middle ground | The dramatic ceiling the GDD allows |
| **Framing** | Very consistent, both Beys | Livelier, look-ahead | Strong look-ahead, predicted meetings |
| **Orbit** | Contained (0.2), ≤ 40°/s | Contextual (0.6), ≤ 70°/s | Strong (1.0), ≤ 105°/s |
| **FOV** | 58° → 74°, gentle | 62° → 88°, clear with speed | 66° → 100°, aggressive |
| **Distance** | 8.5–15 m, heavy damping | 7.2–17 m | 6–20 m, big swings |
| **Side (shoulder)** | Never switches | Switches rarely (≥ 6 s apart) | Switches with the action (≥ 3 s apart) |
| **Knockback / impact** | Light follow, no reframing | Controlled reframing | Big impacts re-compose the shot |
| **Shake** | Low | Medium | High, still capped |

## The real fight underneath

`src/fight/RealSimSource.ts` runs the game's own simulation:
- `PhysicsWorld` (Rapier) and `createArenaColliders`;
- `createBey` with the game's Attack and Defense archetypes;
- the same `tickMatch()` that `main.ts` and the deterministic test harness use.

It is driven through the game's `CombatController` interface, by one of:
- a `ScriptedController` (inputs as a function of time);
- the real `AIController`;
- an `IdleController`.

It only **reads** the game's modules. Physics, AI and balance are not changed for the camera's sake.

Two differences from `main.ts`, both presentation-only:
- **No hitstop.** A, B and C must watch the exact same fight.
- **Presentation continuation.** After a KO or ring-out, raw physics keeps running for 2.5 s so the Ring-Out and Finisher cameras have a trajectory to follow; `main.ts` freezes everything at round end. The HUD says so.

Scenario setup changes nothing in the rules, with one exception: Final Hit starts the opponent Broken through `StabilitySystem.applyDamage()`, the kind of "set Stability" action the GDD's Debug Lab allows.

**Ready for the Bey Motion Lab.** The director reads only `FightFrame` (`src/fight/FightFrame.ts`), and any `FightSource` can feed it. When movement from the Motion Lab is approved, it plugs in as another source, with no change to the director or the presets. The two labs don't depend on each other.

## Scenarios (reproducible: fixed 60 Hz tick + scripted input)

| Scenario | What happens | Camera contexts |
|---|---|---|
| Normal Duel | Real AI vs AI for 24 s: hits, a Clash, a Stability Break | CombatFollow, CloseCombat, KnockbackFollow |
| Close Combat | The two push into each other, trading Circulars | CloseCombat, light knockback |
| Far Separation | Opponent parked at the far wall; player loops on the other side (15–19 m apart) | CombatFollow at max distance |
| High Speed Pass | Full-speed run past the opponent, brake, turn, pass again | HighSpeed, look-ahead, predicted meeting |
| Opposite Direction Pass | Head-on at speed, crossing without contact | HighSpeed, frontal approach |
| Dash Approach | Charged Dash into a still opponent, then a short second Dash | HighSpeed (Dash), KnockbackFollow |
| Heavy Knockback | Full-charge Dash; the opponent hits the wall | KnockbackFollow (strong), wall impact |
| Wall Ricochet | Angled high-speed wall hit and rebound | Wall impact |
| Ring-Out Chase | The real AI's opening: the player is launched over the wall at 2.1 s | RingOut, Finisher |
| Clash Setup | Simultaneous Dashes into a real Clash (≈ 2.4–6.4 s) | Clash, KnockbackFollow afterwards |
| High-Speed Orbit | Circling the opponent while turning (~8 m/s) | Orbit during a high-speed turn |
| Final Hit | Opponent starts Broken; a strong Dash scores the KO | Finisher |

A scripted Circular-catches-Dash never cleared the 2 m wall in any timing tried, so Ring-Out Chase uses the real AI's opening, which does it on its own.

## Camera Director (`src/director/CameraDirector.ts`)

Gameplay provides context and intent through `FightFrame`:
- positions, velocities and attack states;
- intents such as "hit m=0.37 on the opponent", using the game's own `ImpactMagnitude` curve.

The director alone decides presentation. It is pure logic with no Three.js, runs on the fixed 60 Hz tick, and is unit-tested headless.

Modes are context weights that blend in and out at the *transition speed*:

`Clash > RingOut > Finisher > KnockbackFollow > HighSpeed > CloseCombat > CombatFollow`

The mode shown is the highest-priority context above 50%, with a 0.25 s minimum hold so the label cannot flicker.

**Readability guards**, all visible and tunable:
- **Filtering:** a low-pass on speed before the FOV or pull-back uses it, a FOV slew limit and a distance dead-band.
- **Motion caps:** an orbit speed cap (anti-nausea) and a side-switch cooldown plus 0.5 s hold.
- **Impacts:** a micro-impact threshold and a hard shake cap.
- **Collision:** floor clearance and Bey clearance.
- **Off-screen rescue:** if either Bey leaves the frame, the camera pulls back, widens and re-aims.

**`ReadabilityMeter`** measures each run:
- the time each Bey is in frame, and the longest gap;
- the lowest eye height;
- the maximum FOV;
- the fastest turn;
- side switches.

The HUD shows it live.

## Sliders (right panel, active preset)

Hover a slider to see what it does and its range. **↺** resets that one value; **Resetar preset** resets them all.

- **FOV:**
  - base FOV and maximum FOV (ceiling 120);
  - speed → FOV strength and curve;
  - FOV response;
  - maximum FOV change rate;
  - impact FOV punch.
- **Distance and height:**
  - minimum and maximum distance;
  - response to separation;
  - distance dead-band;
  - camera height;
  - vertical offset.
- **Orbit and side:**
  - lateral (shoulder) offset;
  - orbit strength, maximum orbit speed and orbit damping;
  - minimum time between side switches.
- **Smoothing:** position damping, rotation (target) damping and transition speed between modes.
- **Framing and look-ahead:**
  - target framing bias;
  - opponent framing weight;
  - look-ahead strength, velocity look-ahead and acceleration look-ahead;
  - encounter prediction.
- **Contexts:**
  - high-speed pull-back;
  - close-combat push-in;
  - knockback follow strength and delay;
  - recovery after cinematic displacement;
  - impact reframing.
- **Shake:** intensity, decay, speed contribution and impact contribution.
- **Readability guards:**
  - speed filter;
  - micro-impact threshold;
  - floor clearance;
  - Bey clearance;
  - off-screen rescue.

Buttons:
- **Salvar configurações** keeps the edits in this browser and, inside claude.ai, writes all three presets to the artifact's store (`config/camera`) for Claude to read.
- **Copiar JSON** copies the same data.

## Comparing

1. Pick a scenario. `[` and `]` step through them.
2. Press **Q** for **A | B | C**. It shows the same fight, three cameras, one 16:9 view each; every view is letterboxed to 16:9, like the game.
3. Or press **T** for **Sequência A→B→C**. It plays the scenario once with each camera, full size.
4. Use `1` `2` `3` to switch the active camera instantly. The fight keeps going, because all three directors always run.
5. Controls:
   - `Espaço` pauses and `R` restarts.
   - `S` cycles 1×, ½×, ¼× and 2×.
   - `L` toggles repeat.
6. Debug:
   - `D` toggles the 3D markers (the ◆ is the point followed; the cyan ring is the midpoint; the pink arrow is the look-ahead; the green and red arrows are velocities; the orange diamond is the predicted meeting);
   - `M` toggles the top-down minimap (cameras, FOV wedges, camera → target lines);
   - `H` toggles the text on screen.

   The left panel lists every value: mode, FOV, distance and target, camera target, player, opponent, midpoint, look-ahead, orbit angle, damping, shake and active modifiers.

Open it with `npm run dev` → `/prototypes/camera-concepts/`, or the production preview at `/ChaosBey/prototypes/camera-concepts/`. Link directly to a scenario with `#clash-setup`.

## Checks

- `tests/unit/cameraLab.test.ts`:
  - every scenario produces its situation in the real simulation, with no mocks;
  - runs are reproducible tick for tick;
  - for every preset × scenario: the opponent is in frame ≥ 90% and the player ≥ 85%, no opponent gap ≥ 0.75 s, the camera never goes under the floor clearance, the FOV stays ≤ 120°, the camera never turns faster than its own cap, and there are no side-switch storms;
  - the Clash, Ring-Out, Finisher and Close Combat modes appear where the fight produces them.
- `tests/smoke/cameraConcepts.spec.ts`: loads the production page and exercises presets, compare, Clash, Finisher, a duel, sliders and speed, with no console errors.

## Known limits

- The Beys are the game's current placeholder models, not the round-2 concepts. The camera is what's being judged.
- The arena is the game's current flat arena. The approved 3.2 m bowl is not integrated in the game yet.
- Rendering is interpolated between fixed ticks. The camera itself only changes on the 60 Hz tick, so its behaviour does not depend on the render frame rate.
