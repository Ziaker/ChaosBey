# Clash Presentation Lab — prototype

**Status: NOT reviewed yet.** Three complete, clearly different presentation directions for the Clash beat (GDD sections 39–45), for the owner to pick or mix. Nothing here is a decision — see `docs/design-decisions/` for that step, which only happens *after* the owner reviews the artifact (the same order the Camera Lab, Bey Motion Lab and Stamina & Stability Lab followed).

An interactive Three.js page that shows the **full presentation of a Clash** — entry, the energy between the two Beys, mash pulses, the resolution, and the return to combat — running on top of the real, GDD-approved `src/combat/clash/` mechanics package. Nothing in `src/` is changed, no gameplay/physics/AI/balance value moves, and M8 is not started.

## What this lab reuses vs. what it explores

The Clash **rules** are already closed (GDD 39–45) and this lab never touches them — it only imports and runs the real package:

| Fixed rule | Source of truth this lab imports unchanged |
|---|---|
| 150ms compatible-hit window | `src/combat/clash/ClashWindow.ts` |
| ~4s Active duration | `src/combat/clash/ClashTuning.ts` (`CLASH_TARGET_DURATION_S`) |
| Z/X/C mash, simultaneous presses = one event | `src/combat/clash/ClashMash.ts` (`nextMashEventCount`) |
| `ClashPower = MashPerformance × StaminaFactor × VelocityFactor`, each factor capped | `src/combat/clash/ClashFormula.ts` |
| No Attack stat, no collision angle in the score | same file — the formula's signature can't silently grow those in |
| 10s cooldown | `src/combat/clash/ClashTuning.ts` (`CLASH_COOLDOWN_S`) |
| Idle → Active → Cooldown state machine | `src/combat/clash/ClashController.ts`, wrapped (not reimplemented) by `src/harness/ClashHarness.ts` |
| Physical knockback, no declared ring-out | `src/combat/knockback/Knockback.ts` + `src/arena/ringout/RingOut.ts`, applied the instant `ClashController` resolves, exactly like the real `ClashOrchestration.applyResolution()` does |

The **presentation** is this lab's actual subject, and it is real exploration space, not a foregone conclusion:
- the entry into the Clash state;
- what the energy between the two Beys looks like, and how it reads a shifting or swinging advantage;
- the pulse on every valid mash event;
- how much the arena, the camera and hitstop lean into the moment;
- the resolution/explosion beat and the winner/loser read;
- the Tie presentation, which the GDD leaves genuinely open (three options here, none marked official);
- the internal pacing of the ~4 seconds;
- how "anime" vs. "mechanical" each direction feels.

## Architecture

```
src/
  harness/
    ClashHarness.ts   — presentation-facing state machine wrapping the real ClashController.
                         Idle → [Approach] → Active → [resolutionBurst] → [cooldownWait] → Idle.
                         Approach and resolutionBurst are the only lab-only beats; everything
                         else is the real Idle/Active/Cooldown state machine, untouched.
    mash.ts           — Z/X/C keyboard capture (dedup via a Set, exactly like the real
                         `pressedThisFrame` semantics) + scripted mash sources reusing the real
                         `ClashAiMashSource` interface (GDD: "the AI participates in the mash",
                         simulated here via harness — no real AIController is run).
    scenarios.ts      — the 10 reproducible scenarios (see below).
  sim/
    ClashStageSim.ts  — the ONLY file that touches physics: real Rapier, real
                         `createArenaColliders`, real `createBey`/archetypes, positions the two
                         Beys for the presentation-only Approach beat, holds them still through
                         Active (mirroring `tickMatch()`'s own "no physics step while Active"
                         rule), and applies the exact same physical-consequence formulas
                         `ClashOrchestration` uses the instant the real controller resolves.
                         Node-testable (no DOM/canvas dependency) — see the unit tests.
    DetailedBeyVisual.ts — wraps one of the 9 approved round-2 Bey concepts
                         (`assembleConcept()` from `prototypes/bey-visual-concepts`) in the same
                         `{ group, spinGroup }` shape the game's placeholder `BeyVisual` uses, so
                         the physics-driven position/quaternion sync above never needs to know
                         which visual is plugged in. Also Node-testable — `assembleConcept()` has
                         no DOM dependency, unlike the arena art below.
  presentation/
    types.ts, directions.ts, tieStyles.ts, ClashPresenter.ts
                      — the three presentation directions (data + the director that turns a
                         tick's events into concrete FX/camera/arena/banner calls) and the three
                         Tie styles.
  fx/ClashFx.ts       — Clash-specific VFX primitives (energy beam, mash pulse, shockwave,
                         impact star, sparks) in the spirit of the approved Híbrida VFX language
                         — this lab doesn't invent a fourth visual language, it fills a gap
                         Híbrida never covered (see visual-prototype-inventory.md: "Clash
                         completo... NÃO PROTOTIPADO").
  stage/ClashStageView.ts — the only browser/canvas-dependent file: renderer, the approved
                         arena-visual-concepts art (with its own already-approved per-arena
                         Clash light reaction), camera application.
  ui/ (none needed — the panel is built directly in main.ts, like the smaller labs)
  main.ts             — page wiring: the fixed 60Hz loop with render interpolation, all UI,
                         the CameraDirector (all three approved presets always ticking, so
                         switching is instant), keyboard shortcuts, and the smoke-test hook
                         (`window.__clashLab`).
```

**Camera:** reuses `CameraDirector` and the three exact approved presets from `prototypes/camera-concepts/src/director/` unchanged, including its existing `Clash` mode. Pick any of the three (A Arena Fighter / B Cinematic Hybrid / C Hyper Dynamic) independently of the presentation direction.

**VFX:** builds on the approved Híbrida language's aesthetic (additive glow, cel-flavored shapes, sparks in the arena's own palette) for the parts Híbrida already covers; the Clash-specific shapes (energy beam, mash pulse, resolution burst) are new, because the Clash beat itself was never prototyped before.

**Arena:** reuses the three approved arenas (`prototypes/arena-visual-concepts/src/arenas/`) and their already-approved per-arena Clash light reaction (`arena.update({ time, dt, clash })`), flattened to the lab's flat physics floor (the approved 3.2m bowl isn't integrated into the game's physics yet — same limitation the Camera Lab and Bey Motion Lab already carry).

## The three directions

| | A — Impacto Mecânico | B — Confronto Anime | C — Overdrive |
|---|---|---|---|
| **Feel** | Mechanical, tactile, minimal | The dramatic-but-legible middle ground | The spectacle ceiling |
| **Entry** | Hard snap, no slow-mo | Gentle slow-mo pull-in + flash | Hard slow-mo zoom + full-screen flash |
| **Energy between Beys** | Thin electric arc | Colored double-helix | Cel-Cyclone-style vortex, swings hard on lead changes |
| **Mash pulse** | Small spark ring, 0.02s hitstop | Impact star + shock ring, proportional hitstop/shake | Big star + shockwave, strong hitstop/shake every event |
| **Resolution** | One directional burst, quiet banner | Double explosion in the winner's color, bold banner | Multi-ring explosion, long hitstop + slow-mo, dramatic banner |
| **Arena reaction** | Low (≤50%) | Medium-high | Full (100%) |
| **Default Tie style** | Sobrecarga Estática | Espelho Partido | Nocaute Duplo |
| **Suggested camera** | A Arena Fighter | B Cinematic Hybrid | C Hyper Dynamic |

None is marked as the pick. The owner chooses or mixes after reviewing the artifact.

## Tie presentation — genuinely open (2–3 options, GDD-explicit)

The Tie **rule** is closed (symmetric physical repulsion, no winner, no Stability damage — `ClashOrchestration.applyTieRepulsion()`), but its presentation is not. Three independent options, selectable regardless of which A/B/C direction is active:

1. **Espelho Partido (Mirror Break)** — a single symmetric white shockwave, both colors flash together, fades to neutral. Neither side reads as "losing the screen".
2. **Sobrecarga Estática (Static Overload)** — both Beys flicker red like an electrical fault; no big banner, the read stays in the instrumentation HUD.
3. **Nocaute Duplo (Double Knockdown)** — both Beys are thrown back symmetrically in slow motion, with a shared shockwave ring and two "EMPATE" banners meeting in the middle.

## The 10 scenarios (reproducible: fixed 60Hz tick + scripted mash rates, no unseeded randomness)

| Scenario | What it shows |
|---|---|
| Clash equilibrado | Close mash rates/Stamina/speed — a narrow, mash-rate-decided win |
| Jogador domina desde o início | Player mashes hard, high Stamina/speed, from tick one |
| IA domina desde o início | The mirror case — the harness-simulated side dominates |
| Comeback no último segundo | Player mashes little for ~3s, then surges in the final second and overtakes |
| Mash alto com Stamina baixa | MashPerformance saturates at 1.0, but near-zero Stamina caps StaminaFactor near its 0.5 floor |
| Mash baixo com velocidade alta | Low MashPerformance, but VelocityFactor caps at 1.0 from a reference-speed connect |
| Empate | Identical inputs on both sides — exact `ClashOutcome.Tie` |
| Resolução: knockback normal (sem ring-out) | Decisive win near the arena center; physical knockback stays inside the ring-out radius |
| Resolução: ring-out natural após o knockback | Same decisive win near the wall; physics alone carries the loser past `RINGOUT_RADIUS_M` — Clash never declares it |
| Cooldown (10s) em detalhe | A quick resolution, then the real 10s cooldown countdown at high speed |

## Controls

- **Direction:** `1` `2` `3` (or the left panel).
- **Scenario:** `[` `]` (or the scenario list) — 10 scenarios, always reproducible.
- **Tie style:** pick any of the three regardless of direction.
- **Camera:** pick any of the three approved presets independently.
- **Bey model** (right panel): pick any of the 3 approved Attack concepts for the player and any of the 3 approved Defense concepts for the opponent (`prototypes/bey-visual-concepts`, catalog approved in `visual-prototypes-approval.md` §1) — swaps live, no reload. This is a richer stand-in for the game's current placeholder mesh, not a "final Bey" pick; which 3 of the 9 concepts ship is still explicitly open (§4.1).
- **Mash mode (player/first side):** `M` toggles between the scenario's scripted rate and real `Z` `X` `C` keyboard input — press them together to see the debug log confirm a simultaneous press still counts as **one** event.
- **Stamina / speed / mash rate sliders** (right panel): live-edit either side's Clash inputs; takes effect on the next Approach (matches the real game capturing these once, at `tryStart()`).
- **Transport:** `Espaço` pause, `R` restart (repeats the exact same Clash), `S` cycles 1×/½×/¼×/2×/4×, `L` toggles auto-loop.
- **Live score panel:** MashPerformance / StaminaFactor / VelocityFactor bars and the resulting ClashPower, per side, updated every tick — reading straight from `ClashHarness.liveScore()`, which calls the real `ClashFormula` functions.
- **Mash debug log:** every tick where the player side contributed an event, with the exact keys seen that tick and the resulting running count — the confirmation that `Z+X+C` pressed together is one event.
- **Phase HUD:** current phase/beat, Active progress, Cooldown countdown, the 150ms-window fact for the current Approach, and the arena's live Clash-light intensity.

The on-screen panel is explicitly **prototype instrumentation**, not the game's final HUD — that is a separate, later lab (HUD Combat Lab).

## Presentation-harness simplifications (explicit, not silent)

This lab has no real attack/hit-detection pipeline, no `AttackController`, no real Stamina/Stability systems, and doesn't run the real `AIController`. Per the task's own allowance ("simulate only the minimum input needed, inside an isolated harness, and mark it clearly"):

- **Approach** is authored position interpolation (a lerp, not physics) — the "two attacks connecting" moment is represented only as two configurable timestamps (`connectDeltaS`), checked against the real `isWithinClashWindow()` and shown in the HUD.
- **Stamina fraction and speed at connect** are lab inputs (sliders/scenario data) fed straight into `ClashController.tryStart()`, rather than derived from a full running match simulation — exactly how the Camera Lab's Final Hit scenario sets Stability directly through the real `StabilitySystem.applyDamage()`.
- **The AI's mash** is a scripted/deterministic rate (`ScriptedMashDriver`, reusing the real `ClashAiMashSource` interface), never the real `AIController`.
- **The physical resolution's `baseForce`** is a scenario constant bracketed by the real Dash Attack's own knockback-force range (`AttackTuning.ts`), standing in for "whichever real attack connected" — this lab has no way to know that.
- **Defender Stability fraction** is assumed full (1.0) for the knockback formula, since this lab has no Stability system of its own.

None of this simplifies the **rules** — only the inputs this lab has no other way to produce.

## Checks

- `tests/unit/clashPresentationLab.test.ts`:
  - the harness phase state machine never skips a phase, and never starts a second Approach while a Clash is in flight;
  - a tick with any mash contribution (keyboard or scripted) counts as exactly one event, never more — including when both sides mash the same tick;
  - the formula never exceeds its caps under extreme inputs, and the lab's live score is proven equal to `computeClashPower()` with the exact captured start inputs — never a re-derived copy;
  - the `tie` scenario really produces `ClashOutcome.Tie`;
  - running the same scenario twice is byte-identical (determinism);
  - the Cooldown really counts down `CLASH_COOLDOWN_S` and refuses a new Clash before it reaches zero;
  - `ClashStageSim` integration: a normal-knockback scenario never crosses the ring-out radius, a wall-adjacent strong knockback crosses it on its own (physics decides, Clash never declares it), and a Tie visibly separates both Beys.
- `tests/smoke/clashPresentationConcepts.spec.ts`: loads the production page, exercises all three directions to a full resolution, the Tie scenario, the ring-out scenario, and the Cooldown scenario, with no console errors.

Run with `CHAOSBEY_PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npx playwright test -c tests/smoke/playwright.config.ts tests/smoke/clashPresentationConcepts.spec.ts` if the container's pre-installed Chromium needs pointing to explicitly.

Open with `npm run dev` → `/prototypes/clash-presentation-concepts/`, or the production preview at `/ChaosBey/prototypes/clash-presentation-concepts/`. Link directly to a scenario with `#tie`, `#resolution-ring-out`, etc.

## Known limits

- No real attack/hit-detection, Stamina/Stability system, or `AIController` — see "Presentation-harness simplifications" above.
- The arena is flattened to match the game's current flat physics floor; the approved 3.2m bowl isn't integrated into physics yet.
- The Beys render the approved round-2 concepts (`assembleConcept()` from `prototypes/bey-visual-concepts`, the same models the Stamina & Stability Lab's `BeyRig` uses) instead of the game's current crude placeholder mesh, scaled and anchored to match the real Bey collider — but no specific concept is treated as final; the picker exists so the owner isn't stuck reviewing the Clash presentation on a stand-in that doesn't look like a Bey at all.
- Single active view (no A|B|C side-by-side compare like the Camera Lab) — switching direction is instant since the underlying sim keeps running regardless.
