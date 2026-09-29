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
