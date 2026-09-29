# SFX Lab — prototype

An interactive page for choosing ChaosBey's sound. It proposes **three coherent sound directions** for the whole game and lets the owner decide, **event by event**, between A, B, C or **SEM SOM** (no sound). Every option can be heard alone, back to back (A→B→C), inside short scripted scenes, and over a **real AI fight from the game's own simulation**.

Status: **decision tool, nothing approved.**
- No direction is official, and every event starts *pending*. The Lab never picks for the owner.
- Nothing is integrated into the game. `src/` is untouched: the Lab only **reads** the simulation's results.
- Music and announcer are out of scope (GDD 61 defers music; no announcer).

Open it with `npm run dev` and go to `/prototypes/sfx-concepts/`. The production build serves it under `/ChaosBey/prototypes/sfx-concepts/`, as on GitHub Pages. All sound is synthesized at play time with the Web Audio API: no audio files, no network, no external service.

## What the GDD already fixes

- **GDD 61:** separate volume categories; hit variations; spin audio tied to RPM; wall and floor scrape. Music is deferred and there is no announcer.
- **GDD 32:** each archetype may have its own spin audio.
- **GDD 51:** a stronger impact sounds stronger.
- **GDD 158:** presentation observes, it never decides.

The Lab follows all of these. Everything else is open, and is what the Lab is for.

## The three directions (`src/directions.ts`)

A, B and C are identities for the whole game, not three random sounds per event. Every recipe is built from the same few families (impact, whoosh, sting, UI, loops) and takes its timbre from the direction's palette. B's hit, Dash, Clash and KO therefore all sound like the same game.

| | A — Mecânico | B — Anime / Arcade | C — Chaos / Overdrive |
|---|---|---|---|
| **Idea** | A real metal-and-plastic toy | Stylized, energetic, readable, satisfying | Aggressive, exaggerated, strange, powerful |
| **Impacts** | Inharmonic metal clanks, dry snaps, body | Synth punch with a bright "shing" | Distorted thumps, sub drops, FM clangs that bend down |
| **Movement** | Dry air, band-passed | Resonant, tonal swooshes | Reversed, falling sweeps |
| **Big moments** | Metal resonating, almost no musical notes | Short melodic stingers in major | Dissonant stingers (tritones) |
| **UI** | Mechanical clicks | Square-wave blips | Gritty, low blips |
| **Saturation** | Almost none | Almost none | Heavy (tanh drive) |

Every number (frequencies, decays, gains) sits at the top of `directions.ts` and can be tweaked with a reload.

## Events (`src/catalog.ts`)

The audit of the game found **35 events in 8 categories**: 30 one-shots and 5 continuous loops. Each has its trigger in plain Portuguese, the exact source in the code, a mix rule and, where honest, a note on when SEM SOM may be the better choice.

| Category | Events |
|---|---|
| Continuous | spin (per archetype), floor scrape/drift, wall grind |
| Impact | Bey×Bey contact, wall bounce, landing |
| Attack | Circular start, Dash charging (loop), Dash full charge, Dash release, hit, Counter |
| Defense | Dodge, dodged hit, Perfect Dodge, jump/hop |
| Resource | Stability Break, recovery, Stamina critical, Attack Energy empty |
| Clash | start, tension (loop), mash, resolution, tie |
| Round | round start, Ring-Out, KO, victory, defeat, draw |
| UI | focus, confirm, back, error |

**Grouping and parameters.** Equivalent phenomena share one event driven by a real 0..1 magnitude, instead of many near-duplicate sounds:
- a hit uses the game's knockback force, through the same `ImpactMagnitude` curve the camera and VFX use;
- contact and wall bounces use the impact speed;
- landings use the landing intensity;
- the Dash uses its charge, and the Clash mash its progress;
- the spin follows the real RPM, wobbles when Broken, and gets a pitch/roughness offset per archetype.

Knockback and Stability damage are part of the hit, not separate sounds.

## Silence and priority (`src/engine/MixPolicy.ts`)

A fight must not turn into a wall of audio, and a big moment must cut through. Every request goes through a pure, unit-tested policy:
- **Gate:** a light graze below the event's threshold stays silent.
- **Cooldown per side:** the same sound can't machine-gun.
- **Voices per event:** too many copies means the oldest is cut.
- **Global budget (10 one-shots):** when it's full, the least important sound playing is cut, but only if the new one matters more. Otherwise the new one is dropped. Priority runs from 1 (ambient beds) to 10 (KO, Ring-Out, Clash resolution).
- **Ducking:** big moments (Counter, Perfect Dodge, Break, Clash start/end, KO, Ring-Out) pull the loops and the routine gameplay sounds down for a moment. The deepest duck wins.
- **Loops:** during a Clash the spin drops to 35% and the scrapes stop, and the loser's loops go silent at the end of the round.
- **Distance (live fight):** the listener rides with the player's Bey, as the game's camera does. The opponent's sounds and loops get quieter with distance, down to −8 dB across the arena. The **Distância** button turns this off to compare.
- **Variation (`src/engine/variation.ts`):** frequent sounds get a small, deterministic nudge of pitch, level and length, plus a layer that never repeats back to back. Signals (UI, round result) never vary.

The log on the right shows every request: played, dropped (and why), cut, or SEM SOM. The "Teste de poluição" scene is a dense fight that exercises all of this.

## Fair comparison: levels (`src/engine/levels.ts`)

Louder always sounds better, so A, B and C are loudness-matched per event:
- **`TARGET_LOUDNESS`** holds the design intent, i.e. how loud each event sits relative to the others.
- **`LEVEL_TRIM_DB`** holds the measured correction per direction.

`src/engine/measure.ts` renders every event × direction offline, through the same master limiter the player hears, with K-weighted loudness (ITU-R BS.1770, the filter behind LUFS). Current result: the three directions sit within **1 LU** of each other on every event, and no peak goes above 0.9. After changing a palette or a recipe, re-measure (`window.__sfxLab.measureAll()`) and regenerate the trims.

## The page

- **Left panel:**
  - the three directions, with the one used for *pré-escuta* (pending events in scenes and fights);
  - master and per-category volumes (loops, gameplay, moments, UI);
  - context scenes;
  - the summary of choices, with copy/download as JSON;
  - keyboard shortcuts.
- **Centre:** every event by category.
  - Choose A / B / C / SEM SOM; the pressed button is the current choice, and clicking it again makes the event pending.
  - Play each option (▶ A, ▶ B, ▶ C) or all three back to back (A→B→C).
  - For events that scale, pick weak / medium / strong.
- **Right panel:**
  - the live fight, a top-down view of the real match with flashes where sounds happen;
  - the mix state;
  - the log.

Choices and volumes persist in the browser (`localStorage`, key `chaosbey.sfxLab.v1`). The Lab works the same when storage is blocked.

**Keys:**

| Key | Action |
|---|---|
| `1` / `2` / `3` | Choose A / B / C for the focused event |
| `0` | SEM SOM |
| `Enter` | Play the current choice |
| `Q` | Play A→B→C |
| `↑` / `↓` | Move between events |
| `L` | Start or stop the live fight |
| `Esc` | Silence everything |

## Context scenes (`src/sequences.ts`)

Twelve short scripted scenes play the current choices in context:
- **exchange:** contact → Circular → hit → wall; then a full Dash (charge → full → release → heavy hit → wall);
- **Counter** and landing;
- **Perfect Dodge;**
- **Clash** won, and Clash tied;
- **Break** and recovery;
- endings by **Ring-Out** and by **KO**, each with its result stinger;
- **jumps** and empty Attack Energy;
- **round start,** with the three archetype spins;
- **Main Menu;**
- the **pollution test.**

These are choreography for listening, not gameplay.

## The live fight (`src/live/`)

- **`LiveMatch.ts`:** runs the game's own headless match. It uses `SelfTestMatchWorld` (Rapier, arena, `tickMatch`, Clash, hitstop), two real `AIController`s, seeded RNG streams and every archetype pairing, exactly like the M8 Self Test.
- **`deriveSfx.ts`:** a pure function that turns each 60 Hz tick's results into sound requests and loop levels. It only reads:
  - hit and combat events;
  - impact deltas;
  - state edges (attack, dodge, drift, Broken);
  - Stamina and Attack Energy;
  - the Clash state and mash counts;
  - the round outcome.

The unit tests prove that listening changes nothing: the same seed ends with the same result on the same tick as the Self Test runner with no one listening.

Three mapping choices are listed for approval:
- **Contact vs. wall:** an impact is a Bey×Bey contact when the two colliders are within 0.35 m, a wall bounce near the wall, and silent anywhere else.
- **Perfect Dodge:** the game reports a perfect dodge as both "dodged" and "perfectDodge" on the same tick. The Lab plays only the Perfect Dodge.
- **Result stinger:** victory, defeat and draw wait 0.75 s after the KO or Ring-Out sound.

## Tests

- **`tests/unit/sfxLab.test.ts`:**
  - catalog integrity and mix hierarchy;
  - choices (defaults, persistence, corrupt data, export);
  - variation bounds and determinism;
  - the mix policy;
  - `deriveSfx` on hand-built ticks;
  - real AI fights (valid requests, determinism, observe-only);
  - the scenes.
- **`tests/smoke/sfxConcepts.spec.ts`** (Chromium):
  - the production page under the Pages base path, with no console errors;
  - per-event choices, and persistence across a reload;
  - playback of single options and of A→B→C;
  - SEM SOM staying silent inside a scene, and the mix dropping sounds in the dense scene;
  - a live fight;
  - an offline render of every event × direction: audible, not clipping, and A/B/C within 3 LU.

## Limitations

- **Synthesized, not recorded.** Procedural synthesis is enough to compare three *directions*, and it is fully tunable. A final sound would likely be designed or recorded to match the chosen direction.
- **Headphones or decent speakers.** Laptop speakers lose C's sub drops and part of A's low body.
- **No 3D audio.** Position is stereo pan from the fight's midpoint plus a simple distance cue. The game's camera directions (A/B/C in Settings) are not simulated here.
- **Loudness is matched on a single render per event** (the strongest audition magnitude). Weaker magnitudes are quieter by design.
- **Clash tie:** the tie's visual style is still open, and its sound depends on that decision.
- **`BeyAudioProfile` (`src/bey/archetype/`)** already holds per-archetype hit/Dash cue ids as a data hook. The Lab doesn't use it yet; integration would.
