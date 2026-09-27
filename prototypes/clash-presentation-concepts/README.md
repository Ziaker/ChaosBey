# Clash Presentation Lab — prototype

**Status: APPROVED (revision 2): direction C, Overdrive, with camera B, Cinematic Hybrid.** See `docs/design-decisions/clash-presentation-approval.md`. The tie style is still open. Nothing is integrated into the game yet. Round 1 was not approved; revision 2 implements the six requirements from that review (see "Revision 2" below). Three complete, clearly different presentation directions for the Clash beat (GDD sections 39–45), for the owner to pick or mix. Nothing here is a decision — see `docs/design-decisions/` for that step, which only happens *after* the owner reviews the artifact (the same order the Camera Lab, Bey Motion Lab and Stamina & Stability Lab followed).

An interactive Three.js page that shows the **full presentation of a Clash** — entry, the two Beys locked in contact, the force HUD between them, speedlines and contact dust, mash pulses, the resolution, and the fight carrying straight on — running on top of the real, GDD-approved `src/combat/clash/` mechanics package. Nothing in `src/` is changed, no gameplay/physics/AI/balance value moves, and M8 is not started.

## Revision 2 — the owner's six requirements

Watch a Clash with no text on screen and you should read: they collided → they are locked against each other → both are pushing → huge speed/energy → who is taking the advantage (HUD) → it can swing → one wins → the physical consequence happens at once → the fight goes on.

1. **Locked contact.** Every scenario places the two Beys exactly in collider contact (`CONTACT_SEPARATION_M` = 1.3 m, 2 × the 0.65 m collider radius), so the rims meet. During the Active beat both lean into the contact point (A 7°, B 11°, C 15°), pivoting on their tips. Each mash adds a short push surge to that side's lean, and the side that is ahead leans a little further in. Both also shudder under the effort. The lean is visual only (`presentation/contactPose.ts`, applied on top of the physics pose); the bodies, the rules and the knockback are untouched.
2. **Speedlines** (`fx/Speedlines.ts`): screen-space anime focus lines converging on the contact, with a clear zone around the Beys so the contact stays readable. They build with Clash progress and fade out within 0.35 s of the resolution. B and C tint each half of the screen with that side's color, and the side that is ahead reaches further in. They are deterministic (seeded per tick).
3. **Contact dust** (`ClashFx.emitContactDust`): dust and hot grit scraped off the floor at the contact point, thrown out mostly sideways because both Beys spin against each other. It keeps coming for the whole Active beat, harder as the Clash builds and on every mash surge. It uses the arena's own spark colors, plus a dust tint per arena.
4. **No result pause, no result text.** There is no banner anywhere (win, loss, tie or ring-out), and the resolution requests no hitstop and no slow motion. The impact plays (flash, rings, sparks, a dust burst in the winner's color) while physics carries on. After the resolution burst, physics keeps running instead of freezing the Beys. The entry slow-mo and the short per-mash hitstop are unchanged. They happen during the Clash, not on the result.
5. **The Stadium (and every arena) uses its approved bowl.** The lab used to call `build(0)` on purpose to match the game's flat physics floor. It now calls `build()`, which uses each arena's approved 3.2 m default and its own `h(r)` profile (`visual-prototypes-approval.md` §2). The physics floor is still flat, so each Bey's visual is lifted onto `h(r)` and tilted to the local slope, pivoting on its tip, so it sits on the surface.
6. **Force HUD instead of the rotating geometry.** The helix/vortex/arc cylinder is gone. `presentation/ClashHud.ts` draws a two-color tug-of-war bar, positioned by projecting the two Beys to screen space and placing it just above their midpoint (clamped inside the frame). Each half uses that side's color: the chosen model's approved glow color, so the colors always match the Bey. Each half sits on the same side of the screen as its Bey. The seam follows the real live ClashPower (`hudShare()`, with a ×4 gain on the advantage so small real differences are visible) and animates smoothly. It lands on the real result at the moment of impact. There is no text and there are no numbers. **Camera:** `CameraDirector` gained an opt-in `{ clashOrbit: false }`, used only by this lab. The camera holds its angle through the Clash, and distance/height/FOV framing is unchanged. The Camera Lab keeps its orbit.

**Harness fixes this revision needed (lab-only, documented):**
- **The Beys used to hover 0.33–0.42 m above the floor through the whole Clash.** Approach/Active placed them at the 0.6 m spawn height, and they only dropped at the resolution. They now rest at the height each collider actually settles at, measured once per stage. The Defense model also floated about 7 cm even at rest, because its visual anchor assumed the Attack collider's height. Each model is now anchored at its own rest height.
- **The ring-out scenario stopped ringing out once the launch started from the floor.** The old 3× launch only cleared the 2 m wall because it began 0.4 m in the air. A sweep of force 3×–8× against loser position 4–8 m shows a loser at 4–5 m clears the wall cleanly for every force from 3.5× up. From 6 m or further out it hits the wall first, and it can then sink through the wall collider (the M7 ext-32 wedge), which is not a real ring-out. The scenario now uses loser at 4 m and 4× the maximum Dash force, a synthetic harness stand-in as before. A unit test asserts the loser is airborne above the wall height as it crosses the wall radius.

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
- how the two Beys read as physically locked together (lean, shudder, contact dust), and how the force HUD reads a shifting or swinging advantage;
- the pulse on every valid mash event;
- how hard the speedlines, dust, flashes and shake push the moment;
- the resolution/impact beat and the winner/loser read (shown physically, never written, never paused);
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
                         tick's events into FX/arena calls and per-tick levels: contact lean,
                         HUD share, speedline strength) and the three Tie styles.
    contactPose.ts    — pure math (Node-tested): the visual pose layer (bowl lift + slope,
                         locked-contact lean + shudder, tip-pivoted) and hudShare().
    ClashHud.ts       — the screen-space force HUD (DOM), placed by projecting the two Beys.
  fx/Speedlines.ts    — screen-space speedlines (2D canvas over the WebGL view).
  fx/ClashFx.ts       — Clash-specific VFX primitives (pooled contact dust + grit, mash pulse,
                         shockwave, impact star, sparks) in the spirit of the approved Híbrida VFX language
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

**Camera:** reuses `CameraDirector` and the three exact approved presets from `prototypes/camera-concepts/src/director/`, including its `Clash` mode's push-in/height/FOV, with the Clash orbit switched off through the director's opt-in `{ clashOrbit: false }` (revision 2, requirement 6). The Camera Lab itself is unchanged. Pick any of the three (A Arena Fighter / B Cinematic Hybrid / C Hyper Dynamic) independently of the presentation direction.

**VFX:** builds on the approved Híbrida language's aesthetic (additive glow, cel-flavored shapes, sparks in the arena's own palette) for the parts Híbrida already covers; the Clash-specific pieces (contact dust, speedlines, force HUD, mash pulse, resolution burst) are new, because the Clash beat itself was never prototyped before.

**Arena:** reuses the three approved arenas (`prototypes/arena-visual-concepts/src/arenas/`) with their approved 3.2 m bowl and `h(r)` profiles, plus their already-approved per-arena Clash light reaction (`arena.update({ time, dt, clash })`). The game's physics floor is still flat (the bowl isn't integrated into physics yet), so the Beys' visuals are seated on the bowl by the pose layer.

## The three directions

| | A — Impacto Mecânico | B — Confronto Anime | C — Overdrive |
|---|---|---|---|
| **Feel** | Mechanical, tactile, minimal | The dramatic-but-legible middle ground | The spectacle ceiling |
| **Entry** | Hard snap, no slow-mo | Gentle slow-mo pull-in + flash | Hard slow-mo zoom + full-screen flash |
| **Contact lean / shudder** | 7° / light | 11° / clear | 15° / violent |
| **Speedlines** | Thin, sparse, white | Strong, in the two sides' colors | Dense and bright, only the center left clear |
| **Contact dust** | Dry, light, short metal sparks | Cloud of dust + sparks | Heavy dust + lots of sparks |
| **Force HUD** | Thin technical bar | Colored, glowing bar | Thick, skewed, glowing bar |
| **Mash pulse** | Small spark ring, 0.02s hitstop | Impact star + shock ring, proportional hitstop/shake | Big star + shockwave, strong hitstop/shake every event |
| **Resolution** | Short flash + knockback | Flash + burst in the winner's color | Multi-ring explosion — still no pause |
| **Arena reaction** | Low (≤50%) | Medium-high | Full (100%) |
| **Default Tie style** | Sobrecarga Estática | Espelho Partido | Nocaute Duplo |
| **Suggested camera** | A Arena Fighter | B Cinematic Hybrid | C Hyper Dynamic |

None is marked as the pick. The owner chooses or mixes after reviewing the artifact.

## Tie presentation — genuinely open (2–3 options, GDD-explicit)

The Tie **rule** is closed (symmetric physical repulsion, no winner, no Stability damage — `ClashOrchestration.applyTieRepulsion()`), but its presentation is not. Three independent options, selectable regardless of which A/B/C direction is active:

1. **Espelho Partido (Mirror Break)** — a symmetric white shockwave, both colors flash together. Neither side reads as "losing the screen".
2. **Sobrecarga Estática (Static Overload)** — a red electrical snap at the contact with sparks flying everywhere, like a fault.
3. **Nocaute Duplo (Double Knockdown)** — a big shared shockwave ring at the Clash point and a dust cloud as the symmetric repulsion throws both back.

None of the three uses a banner or pauses the fight (revision 2). The HUD bar stays even through a Tie.

## The 10 scenarios (reproducible: fixed 60Hz tick + scripted mash rates, seeded FX scatter, fresh Rapier stage on every restart)

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
| Resolução: ring-out natural após o knockback | Same decisive win with a much stronger launch toward the wall; physics alone carries the loser over it and past `RINGOUT_RADIUS_M` — Clash never declares it |
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
- **Contact placement:** every scenario puts the two Beys in exact collider contact on the clash axis, resting at their measured floor height (a Clash only ever starts from contact).
- **After the resolution burst** physics keeps running (the lab has no fight AI to resume, so the Beys coast on from wherever the knockback left them).

None of this simplifies the **rules** — only the inputs this lab has no other way to produce.

## Checks

- `tests/unit/clashPresentationLab.test.ts`:
  - the harness phase state machine never skips a phase, and never starts a second Approach while a Clash is in flight;
  - a tick with any mash contribution (keyboard or scripted) counts as exactly one event, never more — including when both sides mash the same tick;
  - the formula never exceeds its caps under extreme inputs, and the lab's live score is proven equal to `computeClashPower()` with the exact captured start inputs — never a re-derived copy;
  - the `tie` scenario really produces `ClashOutcome.Tie`;
  - running the same scenario twice is byte-identical (determinism), including the physical continuation on a freshly built Rapier stage (what `R`/loop does), and the FX spark scatter comes from a seeded RNG, not `Math.random()`;
  - the Cooldown really counts down `CLASH_COOLDOWN_S` and refuses a new Clash before it reaches zero;
  - `ClashStageSim` integration: a normal-knockback scenario never crosses the ring-out radius, a strong knockback crosses it on its own (physics decides, Clash never declares it) and is airborne above the wall as it crosses, and a Tie visibly separates both Beys;
  - every scenario holds both Beys in exact contact, resting on the floor, for the whole Active beat;
  - the pose layer leans each Bey into the contact by the configured angle pivoting on the tip (tip stays on the floor, rims keep meeting), shudders only in contact, and seats a Bey on the approved bowl at `h(r)` tilted to the slope;
  - `hudShare()` is even when even, grows toward the leader and flips exactly when the lead flips;
  - A/B/C × every Tie style: no hitstop or slow-mo request from the resolution on; contact/HUD/speedlines let go within 0.12/0.25/0.35 s; during Active contact=1, HUD=1, speedlines on; the bar lands on the real winner; the comeback scenario's bar surges from <10% to >35% in the last second.
- `tests/smoke/clashPresentationConcepts.spec.ts`: loads the production page, exercises all three directions to a full resolution and checks the Clash result and physical continuation are identical across A/B/C (the direction only changes presentation), checks `R` mid-resolution replays the same run at normal speed (no hitstop/slow-mo carried over), the Tie scenario, the ring-out scenario, and the Cooldown scenario, with no console errors. A second test measures the 15-point revision checklist in the real page for A, B and C: rims in contact, both leaning, speedlines drawn, dust alive, bowl depth 3.2 m with the tips on the surface, no cylinder geometry, the HUD over the Beys' projected midpoint and following the lead, camera yaw still after it settles, no result text and no hitstop/slow-mo requests after the result, physics moving straight after it, Tie, physical ring-out, and live model swaps staying seated and in contact.

Run with `CHAOSBEY_PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npx playwright test -c tests/smoke/playwright.config.ts tests/smoke/clashPresentationConcepts.spec.ts` if the container's pre-installed Chromium needs pointing to explicitly.

Open with `npm run dev` → `/prototypes/clash-presentation-concepts/`, or the production preview at `/ChaosBey/prototypes/clash-presentation-concepts/`. Link directly to a scenario with `#tie`, `#resolution-ring-out`, etc.

## Known limits

- No real attack/hit-detection, Stamina/Stability system, or `AIController` — see "Presentation-harness simplifications" above.
- The approved 3.2 m bowl is **visual only** here: the game's physics floor is still flat, so the Beys move on a flat plane and their visuals are lifted onto the bowl. Slope-driven motion (sliding toward the center) is not simulated. The ring-out flight is computed on the flat floor/2 m wall of the real colliders.
- With the approved cameras sitting behind the player on the fight axis, the two Beys partly overlap on screen during the Clash. The camera framing is the approved Camera Lab's; this lab doesn't change it.
- The Beys render the approved round-2 concepts (`assembleConcept()` from `prototypes/bey-visual-concepts`, the same models the Stamina & Stability Lab's `BeyRig` uses) instead of the game's current crude placeholder mesh, scaled and anchored to match the real Bey collider — but no specific concept is treated as final; the picker exists so the owner isn't stuck reviewing the Clash presentation on a stand-in that doesn't look like a Bey at all.
- Single active view (no A|B|C side-by-side compare like the Camera Lab) — switching direction is instant since the underlying sim keeps running regardless.
