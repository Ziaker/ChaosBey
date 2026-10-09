# ChaosBey — Launch System Approval

**Status:** OWNER APPROVED · INTEGRATED in 0.61.0 (first integration; the tuning numbers and the AI policy are provisional, §12)  
**Decision date:** 2026-10-07  
**Approved prototype:** `prototypes/launch-system-concepts/index.html`

---

## 1. Final owner choice

The final launch-system direction is:

**A — Timing Snap.**

The earlier alternatives are not final directions:

- **B — Power Pull:** rejected as the final launch interaction;
- **C — Vector Draw:** rejected as the final launch interaction.

They may remain mentioned as historical exploration, but future implementation must not reopen A/B/C selection unless the owner explicitly asks.

---

## 2. Required launch flow

The approved round-start sequence is:

`ROUND START -> Beys visibly mounted in physical launchers -> player chooses entry point -> Timing Snap input -> physical launcher release -> both Beys travel into the stage -> first arena contact/bounce -> COMBAT immediately`

There is **no post-landing countdown**.

Specifically forbidden after the two Beys reach the arena:

- no 3 / 2 / 1 timer;
- no GO delay;
- no extra lockout before player input;
- no extra lockout before AI/gameplay starts.

The landing/impact VFX may continue visually while Combat has already started; presentation must never delay the gameplay start.

If the two Beys reach the floor a few frames apart, Combat starts as soon as **both have completed their first arena contact/bounce**. Do not add a fixed delay afterward.

---

## 3. Physical launcher — approved

The Bey must not simply appear flying into the arena.

Before release:

- both Beys are visibly attached to physical 3D launchers;
- launcher body, socket/attachment and release motion must read as the source of the launch;
- the Bey remains visually coupled to its launcher until the release;
- the launcher may recoil/open as demonstrated in the approved prototype.

This is an immersion requirement, not optional decoration.

---

## 4. Player-selected entry point — approved

Before launching, the player can choose **where their Bey will enter/land inside the valid arena area**.

The approved prototype communicates this with a visible ground target and supports direct spatial selection.

Production input mapping may be adapted to the real keyboard/gamepad/UI layer, but the semantic control is fixed:

**the player chooses the launch destination before Timing Snap resolves the release.**

The final implementation must clamp/reject invalid targets rather than allowing impossible/out-of-arena positions.

The exact policy used by the AI to choose its own entry point is not decided by this approval.

---

## 5. Timing Snap interaction — approved

After choosing the entry point:

1. the Bey remains mounted in the launcher;
2. a timing marker moves through the launch meter;
3. the player presses **LAUNCH once**;
4. the launcher releases immediately;
5. timing quality influences the launch result.

Do not replace this with hold-to-charge, repeated mash, or the directional charge behavior explored in B/C.

---

## 6. Dual-arrival animation — locked

The owner explicitly approved the prototype animation of **both Beys arriving at the stage after launcher release**.

This animation is part of the final direction and must be preserved when integrating the system.

Do not replace it with:

- teleporting/spawning directly on the floor;
- a cut that skips the travel;
- one Bey already waiting in the arena;
- a generic fade;
- a post-launch countdown that interrupts the landing-to-combat continuity.

The launchers, travel arcs, landing moment and immediate transition to Combat must read as one continuous event.

---

## 7. Reuse of approved ChaosBey visual language

The approved prototype was intentionally grounded in the existing labs/current game:

- approved four-piece Bey anatomy and nine-Bey visual roster;
- Foundry Pit / Rift Crater / Tournament Stadium visual language;
- current 36 m stage scale and current funnel reference;
- Motion Lab spin / tilt / wobble language;
- Camera Lab / current camera composition as reference rather than a second gameplay authority;
- VFX Language Lab landing / trail / impact language;
- Condition visual instability language for poor entry readability;
- Clash presentation rhythm for release emphasis.

Integration must reuse the real production systems where they already exist rather than duplicating prototype-only renderers.

---

## 8. Prototype instrumentation vs. production rules

The prototype displays comparison readouts such as:

- Power;
- Spin;
- Control;
- Entry speed;
- quality grade.

Those readouts are useful for tuning/feedback, but their exact numeric mapping is **not automatically a final gameplay balance contract**.

Implementation must centralize any timing-quality-to-gameplay mapping, keep it deterministic, and expose provisional numbers for playtest rather than scattering magic numbers.

This does not reopen the approved interaction or presentation direction.

---

## 9. Integration requirements

The production implementation must integrate the approved launch before normal round control without creating a second authority for existing systems.

At minimum it must preserve:

- deterministic player target selection;
- deterministic timing result;
- replayability of target + timing result;
- AI-compatible launch flow;
- launch lifecycle reset every round;
- camera -> gameplay separation;
- current arena/floor geometry when validating target points;
- current Bey visual/physics separation;
- first-bounce -> Combat transition with **zero fixed post-landing delay**.

The production state machine may use different internal names, but semantically it must not include a post-landing Countdown phase.

---

## 10. Acceptance criteria

Implementation is conformant only if all of the following are true:

1. A — Timing Snap is the player launch mechanic.
2. A physical launcher is visible for each Bey before release.
3. Each Bey is visibly attached to its launcher before release.
4. The player can choose their own valid arena entry point.
5. Timing Snap is a one-press timing interaction.
6. Launcher release visibly causes the Bey to leave the launcher.
7. Both Beys perform the approved travel/arrival animation.
8. Both landing contacts produce the expected landing presentation.
9. Combat becomes active immediately when both Beys complete their first contact/bounce.
10. No 3 / 2 / 1 / GO countdown appears after landing.
11. No hidden post-landing input lock reproduces that countdown.
12. B and C are not exposed as alternative final launch modes.
13. Prototype instrumentation is not silently treated as final balance.
14. Existing camera, arena, Motion, VFX, Condition and Bey systems remain the production authorities for their own domains.

---

## 11. Still open without reopening the approved direction

The following implementation details may still need tuning/engineering:

- exact timing-window width/speed;
- exact gameplay consequences of timing quality;
- AI target-selection strategy;
- AI timing-quality policy;
- final input mapping for gamepad;
- telemetry fields and replay schema details;
- reduced-motion/accessibility treatment if needed.

None of these open items permit reintroducing a post-landing countdown, removing the launcher, removing target selection, replacing the dual-arrival animation, or replacing Timing Snap with B/C.

---

## 12. Integration (0.61.0) — how the approved direction was built

This section records the implementation; it changes nothing above. Everything in §1–§10 is honoured as written.

**Flow.** Every round of the player flow (Character Select → Pregame → round, and every next round / restart) starts with the
launch. `MatchRunner` runs it before the match's first tick, on the same fixed tick as the match (`GameState.Launch`, then
`Combat`): both Beys sit in physical launchers (`src/presentation/launchRig.ts`, the prototype's launcher) → the player moves the
entry point and the Timing Snap marker sweeps (`src/launch/LaunchSequence.ts`) → one press of LAUNCH releases both launchers →
both Beys fly the prototype's arcs (the first leaves 0.07 s before the second) → on the tick the last Bey touches down the
match's first tick follows. There is **no phase after landing**: the sequence is `done` on the arrival tick, and a test pins
that its phases are `mounted → armed → release → flight → landed` and nothing else (§2, §10).

**Input** (design doc §4: "production input mapping may be adapted"). The entry point moves with the arrows / D-pad / stick
(screen-relative: up = toward the opponent), or is placed by clicking or dragging on the arena; "Center" puts it back. LAUNCH is
Z or X on the keyboard, A or X on the pad, or the on-screen button. The point is clamped inside the valid landing area
(29/36 of the floor radius, on the match's real floor profile), and two landings are kept apart. The player has as long as
they need; a launch nobody presses releases itself after 15 s with the marker where it stands (no free perfect launch).

**Determinism and replay** (§9). The interactive part is real time, so what the fight takes from it is a `LaunchResult` — each
side's entry point and timing quality — and the arrival (position, speed, heading) is a pure function of it
(`src/launch/LaunchResult.ts`, `applyLaunchArrival.ts`). The session, the headless Self Test world and a replay all start from
the same arrival; the result is recorded in the replay's config (`config.launch`) and in telemetry (`Launch` event). A replay
recorded before the Launch System has no `launch` and still plays back unchanged.

**AI** (§11, open item): provisional policy in `src/launch/LaunchAiPolicy.ts` — the AI picks a point on its own half (nearer the
centre the more aggressive its personality) and its release misses the sweet spot by a human-like error that grows with the
difficulty tier's reaction delay and error rate (a Rookie launches worse than an Ace; nobody is perfect every time). It draws
from a random stream of its own, so adding the launch moved no other draw.

**What a grade is worth** (§8, open item): everything is in `src/launch/LaunchTuning.ts` — `launchOutcomeFor(quality)`. For now a
better timing gives a faster entry (from 35 % to 100 % of the Bey's intended top speed) and a shorter flight; nothing else in the
fight changes. PROVISIONAL, for playtest: the owner decides what the grade should really change.

**Presentation.** The launch camera (behind the launcher → chase of the flight → a duel frame, handing over to the combat
camera over 0.7 s), the target ring and dashed arc, the wind rings and trails, the speed lines and flash, and the grade word
(PERFECT / STRONG / CLEAN / WEAK) follow the approved prototype. The prototype's Power / Spin / Control / Entry-speed readouts
are not in the HUD (§8). The landing itself is the game's own: the Beys touch down as a small bounce and the existing landing
VFX, dust and camera react as for any landing.

**Still open** (§11): the exact timing window and speed, what a grade should change in the fight, the AI's real policy, a
gamepad mapping beyond the one above, reduced-motion treatment. No Pregame switch turns the launch off: it is the approved way a
round starts (quick play, the Debug Lab, the Self Test and the unit tests build matches without a launch HUD and start at once).
