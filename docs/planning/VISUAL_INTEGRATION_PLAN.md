# ChaosBey — Visual Integration Readiness Plan

**Status:** INTEGRATION READINESS AUDIT — no visual behavior changed by this document.
**Date:** 2026-09-30
**Scope:** map every approved-but-not-integrated visual system to production code, find conflicts before they happen, sequence the incorporation into safe PR batches, and establish what "done" looks like for each.
**Explicitly NOT done by this document:** no prototype code was ported, no `src/` visual/rendering behavior changed, camera behavior untouched, PR #65 untouched, no merge performed.

**Precedence:** `docs/design-decisions/VISUAL_APPROVALS_MASTER.md` is canonical over everything in this document if they ever disagree. This plan is a sequencing/engineering document built on top of that master and the per-area approval docs; it does not reopen any decision they've closed.

**A note on scope:** the request that produced this document also asked me to consult "CHAOSBEY_MASTER_DESIGN_AND_CLAU…" (a GDD/master design document). No such file exists anywhere in this repository (checked `docs/`, root, and a repo-wide filename search). Everything below is built from what *is* in the repo: `docs/design-decisions/*.md`, `prototypes/*`, `src/*`, and git history. If that external document contains decisions not reflected in the repo's own docs, they aren't captured here.

---

## 1. Approval → implementation mapping table

| System | Approved status | Canonical source | Prototype | Current production code | Final values? | Still tuning | Dependencies | Conflict risk | Tests needed |
|---|---|---|---|---|---|---|---|---|---|
| **Camera** | APPROVED, 43 values × 3 presets, **INTEGRATED** (M11 lane 2 + fix 8/8-followup, PR #65 pending owner sign-off) | `camera-approval.md` | `prototypes/camera-concepts/` | `src/camera/director/*` | Yes (all 43 params/preset) | Preset default for new players; FOV setting × preset interaction; Perfect Dodge/Intro camera modes; slow-mo for decisive moments; AI-vs-AI spectator framing | none — already live | none (already reconciled in this session's own work) | already covered; PR #65's `cameraTwoFighterFraming.test.ts` etc. |
| **Motion** | APPROVED as directions + physical language; **INTEGRATED** at M11 by explicit owner override ("AJEITA TUDO LOGO") — exact 33 values per preset ARE live | `motion-approval.md` §16 | `prototypes/bey-motion-concepts/` | `src/bey/motion/MotionPresets.ts`, `MovementController`, `SpinController` | Yes, in practice (owner ordered exact values ported) | Which preset (if any) becomes *the* default; per-Bey tuning (Attack/Defense/Stamina inherit same base or diverge); `ext-0` knockback distance; spin readability ambiguity (Defense A/B/C, Stamina B) | none — already live | Camera measurements (`camera-approval.md` §7) need re-validation against the real integrated motion per `motion-approval.md` §12 — **not yet done**, flagged as a real risk below | camera/motion re-validation suite (new) |
| **Bey visuals (4-piece anatomy + 9 concepts)** | APPROVED (anatomy + all 9 concepts selectable, owner override 2026-09-27) | `visual-prototypes-approval.md` §1, `VISUAL_APPROVALS_MASTER.md` §3 | `prototypes/bey-visual-concepts/` (+ round1 archived) | `src/bey/procedural-model/createBeyMesh.ts` (explicit placeholder, self-documented), `src/bey/archetype/BeyArchetypes.ts` (explicit "PROTOTYPE ONLY"), `BeyAppearance.ts` (placeholder) | Geometry/material rules yes; final names and palettes no | Final names; final palettes; remix rules for hybrid concepts | None on other systems (leaf-level mesh swap) | Low — swap is geometry/material only, must not touch collider/mass/stats (explicitly required by the approval doc) | new: 9-concept render smoke, silhouette/size-ratio regression, collider-unchanged regression |
| **Arena visuals + concave bowl** | APPROVED (3.2 m depth, 12 m radius, 3 floor profiles, 3 visual directions) | `visual-prototypes-approval.md` §2–3 | `prototypes/arena-visual-concepts/` | `src/arena/colliders/createArenaColliders.ts` (explicit placeholder, flat floor) | Geometry/profile formulas yes; visual direction choice per-arena/initial-arena: no | Which arena is "the" initial one (or all 3 as pregame presets); how much the bowl slope should pull Beys toward center (gameplay, needs playtest); ring-out volume placement on a concave floor; whether the wall gets openings | **Real gameplay dependency**: slope affects accel/drift/ring-out/AI edge-perception — approval doc explicitly calls this a playtest-gated decision, not a pure visual swap | **High** — this is the one "visual" integration that is also a physics/gameplay change; must not be batched with anything else | self-test physics suite re-run with rampa scenarios (already recommended by the approval doc itself, §5.1.4), AI edge-perception batches |
| **Condition visuals (Stamina/Stability/Broken A/B/C)** | APPROVED, 49 final values, selectable 1/2/3 combo in Settings | `condition-visual-approval.md` | `prototypes/condition-visual-concepts/` | none — greenfield (`src/bey/stamina/`, `src/bey/stability/` have no visual hook yet, confirmed clean) | Yes (49 values) | Default combo for new players; same choice for both fighters or separate; what shows at zero-Stamina if the Stamina-loss rule is off; contrast check against final arena choice; final settings-label names | Depends on Bey 4-piece model landing first for the "joints loosen" (Direction A) reading — not a hard blocker, but sequencing-sensible | Low-medium — genuinely greenfield, but must not fight the VFX Hybrid's own Stability-Break burst (already approved as shared: the point explosion is VFX's, the continuous state is Condition's) | unit (`hudSide`-style per-layer state test), self-test "Stability Break" + "Zero/Low Stamina" per layer combo, Low-preset perf check |
| **VFX Language (Hybrid + Cel Cyclone)** | APPROVED, direction C — Híbrida, 36 final tuning values | `visual-prototypes-approval.md` §3b/3c, `visual-prototype-inventory.md` §8 | `prototypes/vfx-visual-concepts/` | `src/vfx/VfxManager.ts`, `VfxRouting.ts`, `VfxTuning.ts`, `SpeedTrailVfx.ts`, `SparkBurstVfx.ts`, `LandingBurstVfx.ts` — **already the live "placeholder M4" VFX**, i.e. this batch REPLACES an existing working system, not greenfield | Yes (36 values, as multipliers over lab base — need conversion to absolutes) | Jump/aerial/air-recovery VFX package (explicitly not covered yet); per-Bey particle/trail identity | Camera shake conflict (below); hitstop conflict (below); trail system already correct in production, only needs visual-language restyling, not a new system | **Medium-high** — two concrete conflicts confirmed (see §2) | VFX-event-has-no-real-trigger / real-event-has-no-VFX matrix, NaN-in-transform-or-material check, particle pool leak check (round-boundary cleanup) |
| **Clash Presentation (Overdrive + camera B)** | APPROVED, direction C — Overdrive, camera always forces B, no orbit | `clash-presentation-approval.md` | `prototypes/clash-presentation-concepts/` — **exists only on unmerged branch, not on `main`** (see §3) | Camera-forcing-B-during-Clash **is already integrated** (`CameraRig.CLASH_FORCED_PRESET`, `clashOrbit:false`, confirmed live and tested in this session's own camera work). The presentation layer itself (contact pose, speedlines, dust, force HUD bar) is NOT in `src/` | Yes for the C-direction values (entry slow-mo, contact tilt, speedlines, dust, HUD bar style, mash pulse, resolution) | Tie-style (3 options, none chosen); on-screen overlap between the two Beys during Clash; reduced-intensity/accessibility variant; whether `pulse.shakeMeters` should add its own shake on top of CameraDirector's | Depends on VFX Hybrid landing first (dust/spark colors, shake/hitstop ownership) since Clash presentation reuses that language | Medium — mostly self-contained (`ClashController`/`ClashOrchestration` untouched, presentation only observes) | port the lab's own tests (contact, no-pause, HUD-follows-ClashPower) |
| **Combat HUD** | **CONTESTED — see §4.** Canonical repo docs (`VISUAL_APPROVALS_MASTER.md` §10, `visual-prototype-inventory.md` §10.2) say NOT approved / no dedicated Lab. Owner states in this conversation that it's "already defined/approved through another system." No such system was found in the repo. | none found in repo for a *final* HUD; only Clash-bar-specific approval in `clash-presentation-approval.md` §3.5 | none (`prototypes/` has no HUD lab) | `src/app/frontend/CombatHud.ts` + `hudModel.ts`, wired via `PlayFlow.ts` — functional, its own header says "no approved final visual yet" | No | Everything visual (colors, layout, iconography, safe areas); functionally it already shows Stamina/Stability/Attack Energy/Dash-charge/round-score/banners | Dash lock-on has NO production HUD feedback at all (only a debug-only overlay); no cooldown UI beyond Dash charge | none yet, pending owner clarification | existing: `tests/unit/combatHud.test.ts`, `tests/smoke/hudAndRounds.spec.ts` — already decent functional coverage, just not visual-approval-gated |
| **SFX** | Deliberately deferred by owner | — | none | none | — | everything | none | none | — |
| **UI/menus/pregame/pause/results/settings visual package** | NOT approved, out of this plan's scope per owner's "don't wait on it" list is NOT explicit for this one — it's listed as a real gap in `VISUAL_APPROVALS_MASTER.md` §11.1 but owner didn't explicitly defer it in this conversation | `VISUAL_APPROVALS_MASTER.md` §11.1 | none | functional, no visual-approval gate | No | everything | none | none | — |
| **Intro/Countdown/Launch** | NOT approved | `VISUAL_APPROVALS_MASTER.md` §11.2 | none | minimal/placeholder | No | everything | Camera Intro mode also open (`camera-approval.md` §7.4) | none | — |
| **Post-FX (bloom/chromatic aberration)** | Explicitly NOT decided, owner's own "don't block on it" list | `VISUAL_APPROVALS_MASTER.md` §11.3 | none | none | — | everything | — | none | — |

---

## 2. Conflicts found (concrete, with recommendation)

All four items below were verified by reading the actual current `src/` files, not inferred.

### 2.1 Camera shake — two independent systems, must merge into one authority
- **Already flagged in the docs**: `VISUAL_APPROVALS_MASTER.md` §5.4 — "O multiplicador de shake do VFX Lab não deve ser somado cegamente ao shake do Camera Lab."
- **Production authority today**: `src/camera/director/CameraDirector.ts` computes `shakeAmp`/`shakeVec` from real impact magnitude (`impactShake` param) and exposes it; `src/app/session/MatchSession.ts` applies it once, at the single point the render camera's position is set.
- **VFX Lab's own independent shake**: `prototypes/vfx-visual-concepts/src/stage/World.ts` maintains its own `this.shake` driven by `TUNING.shake` (the approved `1.35` multiplier), entirely separate from `CameraDirector`.
- **Ruling**: `CameraDirector` wins (it's the approved, already-integrated, impact-magnitude-driven authority). The VFX Lab's `1.35` multiplier must be folded into `CameraParams`' `impactShake`/`shakeIntensity` per preset at port time — it is a *tuning input* to the existing system, not a second shake source.

### 2.2 Hitstop — two independent timers, must merge into one authority
- **Production authority**: `src/app/simulation/Hitstop.ts` (`HitstopClock`) is simulation state — its own header says "camera and VFX only read it (they used to own the timer)". It gates whether `tickMatch()` runs.
- **VFX Lab's own independent timer**: `prototypes/vfx-visual-concepts/src/stage/World.ts` keeps its own `hitstopT` clock (with a `HITSTOP_FX_RATE` for slow-motion effects during freeze), unaware of `HitstopClock`.
- **Ruling**: `HitstopClock` wins as sole timer owner. Port only the *presentation reaction* (the approved `1.2×` duration multiplier, and the slow-motion effect-rate behavior during a freeze) to read `HitstopClock.isFreezing()`/`getRemainingS()` — discard the lab's own clock entirely.

### 2.3 Speed trails — no conflict, but don't create a second system
- Production already has a complete, working trail system: `src/vfx/SpeedTrailVfx.ts` + `VfxManager`/`VfxTuning`. `prototypes/bey-motion-concepts` only has trail *tuning values*, not an independent trail class.
- **Ruling**: keep `SpeedTrailVfx.ts` as the mechanism; port only the approved visual language (shader/color/shape) into it. No new trail class.

### 2.4 Placeholder art confirmed live in production (expected replacement targets, not bugs)
- `src/bey/procedural-model/createBeyMesh.ts`, `src/bey/archetype/BeyArchetypes.ts`, `BeyAppearance.ts`, `src/arena/colliders/createArenaColliders.ts` all explicitly self-document as placeholder/prototype-only in their own comments.
- **Ruling**: these are exactly the intended swap targets. The integration must touch geometry/material only and leave collider/mass/physical-profile code untouched — confirmed nothing here currently derives gameplay from the placeholder visuals (checked `BeyPhysicalProfile.ts`-style separation holds).

### 2.5 Items checked and found clean (no conflict)
- Impact/VFX magnitude derivation (`tickMatch.ts`, `ImpactEvents.ts`, `ImpactMagnitude.ts`) is driven by real physics values end to end — no fake/hardcoded trigger values found.
- Condition visuals (Stamina/Stability) have no existing production hook to collide with — genuinely greenfield.
- No debug-only visual found leaking into a production code path (debug lock-on overlay is correctly gated behind the debug layer toggle, just not *also* exposed to players — see §4).

---

## 3. Clash Overdrive — exact origin (for porting, not recreating)

**The prototype code was never merged to `main`.** Only the approval document made it into the canonical tree.

- Lives entirely on unmerged branch **`origin/claude/clash-presentation-lab`**.
- `git merge-base --is-ancestor origin/claude/clash-presentation-lab main` → not an ancestor (confirmed not merged).
- Commits to port, in order (all present only on that branch):
  ```
  621110a Clash Presentation Lab: harness + physical stage (mechanics core)
  9e4c0e4 Clash Presentation Lab: three presentation directions + stage view + UI
  31470ae Clash Presentation Lab: build wiring, smoke test and README
  27aec6b Clash Presentation Lab: use the approved detailed Bey models
  cdee375 Clash Presentation Lab: make restart and FX replay shot for shot
  b8475b1 Clash Presentation Lab: revision 2 (contact, speedlines, dust, bowl, force HUD, no result pause)
  ```
  (The doc-only commits `61ec9cb`/`b0ec1a4`/`e889de0` are already on `main` — don't re-port those, just the six above.)
- Files at that branch's tip (full interactive prototype, not doc-only vaporware): `prototypes/clash-presentation-concepts/{README.md,index.html,src/fx/{ClashFx,Speedlines,rng}.ts,src/harness/{ClashHarness,mash,scenarios}.ts,src/main.ts,src/presentation/{ClashHud,ClashPresenter,contactPose,directions,tieStyles,types}.ts,src/sim/{ClashStageSim,DetailedBeyVisual}.ts,src/stage/ClashStageView.ts}`, plus `tests/unit/clashPresentationLab.test.ts` on that branch.
- The lab reuses the real, unmodified `src/combat/clash/` package (`ClashStageSim` wraps it, doesn't replace it) — consistent with "VFX observes, never decides."
- A separate, unrelated `ClashPresentationTracker` class already exists in production combat code (commits `358451d`, `78444b5`) — this is NOT the visual lab, don't confuse the two when searching.

**Action when porting**: `git fetch origin claude/clash-presentation-lab` (or check it's already fetchable) and cherry-pick/diff the six commits above onto whatever branch does the Clash integration. Do not reimplement from the approval doc's prose alone — the working reference code exists.

---

## 4. Combat HUD — origin/implementation, and the real disagreement

**What exists in production** (`src/app/frontend/CombatHud.ts` + `hudModel.ts`, wired in `PlayFlow.ts`):
- Per-side card: Stamina bar (green→orange <25%), Stability bar (blue, card glows red when broken), Attack Energy bar, Dash-charge bar (player only), a priority-ordered status tag (BROKEN > CHARGING > DASH > SPIN).
- Center: round number, first-to-N score pips.
- Round-start/round-end banners (never during Clash resolution, per the approved rule).
- A camera-aware Clash tug-of-war bar (3D→screen projected, follows live `ClashPower`, per `clash-presentation-approval.md` §3.5 — this one specific piece *is* approved).
- A "DRIFT/GRIP" tag explicitly marked in its own code comment as temporary, non-final.
- Control hints (keyboard/gamepad, auto-detected).
- Covered by `tests/unit/combatHud.test.ts` and `tests/smoke/hudAndRounds.spec.ts` (functional correctness — resource values track state, banners fire correctly, score persists across rounds).
- Only a basic `@media (max-width: 640px)` breakpoint — no explicit safe-area/notch handling.

**Confirmed gaps against typical GDD combat-HUD asks**:
- **No Dash lock-on feedback in the real HUD.** The only lock-on visualization is in the debug overlay (`src/debug/visualization/DebugVisualLayers.ts`), gated behind debug mode — players never see it.
- **No generic cooldown UI** beyond the Dash charge meter (e.g. nothing for the Clash 10 s cooldown).
- No reduced-intensity/accessibility variant, no comeback-specific HUD reading.

**The disagreement, stated plainly**: the file's own header comment says *"The combat HUD has no approved final visual yet."* `VISUAL_APPROVALS_MASTER.md` §10 and `visual-prototype-inventory.md` §10.2 both independently, currently, say Combat HUD is a real unclosed gap. I found no document anywhere in the repo recording an owner override that closes this. This is not the same claim as "the code is the reference" — the code explicitly disclaims being final.

**What I did, per your instruction not to invent anything**: registered this as-is, made no visual HUD changes, and did not touch `VISUAL_APPROVALS_MASTER.md`. Per your own sequencing (task #16, tracked separately), the doc-only PR that marks this `SUPERSEDED/OWNER OVERRIDE` needs you to supply or point to the actual override/spec — otherwise the doc-only PR would just be asserting the same unverified claim the master doc already contradicts.

---

## 5. Recommended integration order — and where it differs from the suggested one

Two corrections to the originally suggested order, both load-bearing:

1. **Motion is not a pending integration step.** It's already fully integrated (M11, exact values, live, tested, owner-ordered). Listing it as step 4 would imply work that doesn't exist. It only owes one follow-up: **re-validating the Camera Lab's own scenario measurements against the real integrated motion**, which `motion-approval.md` §12 explicitly requires and which — as far as this audit found — has not been done since M11 shipped. This is real, non-optional work, just not "integrate Motion."
2. **Camera is not a pending integration step either.** It's the system this whole session has been working on; it's live, and its only open item is your own playtest sign-off on PR #65 (untouched by this plan).

Real dependency order for what's actually left:

| # | Batch | Why here |
|---|---|---|
| 1 | **Shared visual infrastructure** (behavior-neutral only — §7) | Every later batch needs material registries, VFX anchors, presentation-state selectors, and quality-scaling hooks. Building this once avoids each subsequent PR reinventing its own plumbing or, worse, wiring straight into `tickMatch()` internals out of convenience. |
| 2 | **Camera↔Motion re-validation** (no code change — a measurement pass) | Cheap, fast, and it's the one piece of already-shipped work with an explicitly open validation debt. Doing it before new visual batches land means any camera-framing regression it finds isn't confused with a new visual system's side effect. |
| 3 | **Bey 4-piece visual models** | Purely additive/leaf-level: swaps mesh+material, touches nothing else (confirmed no other system reads the placeholder mesh for gameplay). Zero dependency on arena, VFX, or condition. Safest possible first "real" visual batch — good fire drill for the new infra from step 1. |
| 4 | **Arena — physics-first, then visual** | **Moved later than the originally suggested position (was #3), and split into two gates.** Unlike Bey models, the concave floor is a real physics change (collider shape, wall/ring-out math, AI edge-perception) that the approval doc itself calls playtest-gated, not a pure skin swap. Sequencing it after the shared infra and Bey models (rather than second) means the riskiest non-camera/motion change in this whole plan doesn't also have to absorb "and the new VFX/material pipeline is unproven" at the same time. Two sub-gates: 4a (collider/physics + self-test regression, no visual change) must be green and separately reviewable before 4b (the visual skin) lands. |
| 5 | **Condition visuals (Stamina/Stability/Broken)** | Fully greenfield (§2.5), no conflicts, but reads best once the Bey model it decorates (step 3) is in place. |
| 6 | **VFX Hybrid + Cel Cyclone** | Replaces a *working* placeholder system, so it's riskier than a greenfield addition — do it after the lower-risk batches so regressions are easier to isolate. Resolves the shake/hitstop conflicts (§2.1, §2.2) as part of this batch, not before. |
| 7 | **Clash Presentation (Overdrive)** | Depends on VFX Hybrid's dust/spark language and shake/hitstop authority being settled (it reuses them). Ports from the exact commits in §3. |
| 8 | **Combat HUD** | Blocked on your clarification (§4) — not a code dependency, a decision dependency. Can technically run in parallel with 3–7 once unblocked, since it doesn't touch 3D rendering. |
| 9 | **Compatibility / cross-system pass** | Runs the full smoke matrix (§9) with everything landed together — this is where "VFX Lab's colors on Rift Crater's violet floor" or "Condition C's white arc on Tournament Stadium's white floor" (both flagged as open contrast questions in the docs) get an actual visual check. |
| 10 | **Performance / final tuning** | Compare against the baseline in §10, only after everything above is in, and only then consider Low/Medium/High quality-preset tuning. |

Everything explicitly excluded from this order per your list (§11 below) and per the docs' own "don't wait for this" items.

---

## 6. PR batch plan

Each batch: keeps `main` playable at every commit, has its own tests, is independently revertable, and does not bundle unrelated gameplay tuning.

1. **Integration 0 — Shared visual infrastructure** (behavior-neutral, see §7 for exactly what qualifies)
2. **Integration 1 — Camera/Motion re-validation** (measurement + doc update only, no production code change expected unless it finds a real regression)
3. **Integration 2 — Bey roster visuals** (4-piece models, 9 concepts, materials)
4. **Integration 3a — Arena physics** (concave collider, wall/ring-out recompute, AI edge perception, self-test rerun) — gated on its own playtest sign-off before 3b
5. **Integration 3b — Arena visuals** (3 directions' materials/lighting/Clash light reaction, quality presets)
6. **Integration 4 — Condition visuals** (Stamina/Stability/Broken, A/B/C toggles in Settings)
7. **Integration 5 — VFX Hybrid + Cel Cyclone** (replaces placeholder VFX, resolves shake/hitstop authority)
8. **Integration 6 — Clash Presentation Overdrive** (ported from `origin/claude/clash-presentation-lab`)
9. **Integration 7 — Combat HUD** (blocked on owner clarification, sequenced independently)
10. **Integration 8 — Compatibility/cross-system polish pass**
11. **Integration 9 — Performance/final tuning against the baseline (§10)**

---

## 7. Behavior-neutral prep that's safe to build now (Integration 0 candidates)

Per your rule — only if it doesn't change gameplay, doesn't change current appearance perceptibly, and doesn't depend on the camera playtest outcome:

- **Material registry** — a lookup from Bey/arena/VFX-language identifiers to Three.js materials, so later batches register materials in one place instead of scattering `new MeshStandardMaterial(...)` calls. Structural only; today's placeholder materials register themselves unchanged.
- **VFX anchor points** — named attachment points on the Bey mesh (ring edge, tip, top) that the *current* placeholder mesh already exposes implicitly; making them explicit doesn't change what's rendered.
- **Presentation-state selectors** — pure functions that read real gameplay state (Stamina fraction, Stability fraction, broken flag, ClashPower, etc.) into a plain data shape, decoupled from whatever renders it. `hudModel.ts`'s `hudSide()` is already exactly this pattern for the HUD; the same pattern can be pre-built (but left unused) for Condition/VFX without wiring anything new into the render loop yet.
- **Effect pooling scaffolding** — a generic object pool utility, added but not yet used by any new effect type (the existing `SpeedTrailVfx`/`SparkBurstVfx` can stay exactly as they are).
- **Quality-scaling hooks** — a `QualityLevel` enum/context threaded through to where particle counts will eventually read it, defaulting to a no-op today.
- **Debug counters** — extending the existing Debug Lab performance panel (§10) to also show active-effect counts *per future system* (condition layers, Clash presentation) as `0`/`not yet wired`, so the panel doesn't need reshaping when each batch lands.

**Explicitly NOT in Integration 0** (would violate "behavior-neutral"): the material *registry* is fine, but populating it with the *approved* Bey materials is not (that's Integration 2's job and would be a perceptible appearance change). Same logic for every other item above — scaffold only, no content.

If there's any doubt whether a specific piece of prep changes appearance, it stays in this document as "planned" rather than being built — per your explicit instruction.

---

## 8. Gameplay/visual separation — standing rules for every future integration PR

Restating your own rules as the checklist every batch above must pass before merging:

- Never change combat results, collider shape (except Integration 3a's *approved, playtest-gated* arena collider, which is a deliberate, isolated exception — not a precedent for anything else), or AI decisions to make a visual look better.
- Never let VFX/HUD/condition-visual code *decide* anything — they observe `tickMatch()`/`ClashController` output, never write back to it.
2 gates any batch must clear: (a) does the replay hash change with this batch's PR? It must not, for any of Integration 0–9 except Integration 3a, which is the one deliberate, already-approved, playtest-gated physics change in this whole plan. (b) does turning the new visual feature off (quality Low, or a Settings toggle where one exists) still leave the game fully playable and readable?

---

## 9. Test matrix to build before integrating

**Structural/regression tests** (apply across every batch):
1. VFX-triggered-with-no-real-event — assert every visual effect call site traces back to a real `tickMatch()`/`ClashController` event, never a hardcoded/demo value.
2. Real-event-with-no-visual-response — the inverse: an event fires and nothing renders (silent gap).
3. Leaking particle systems — object counts return to baseline after a round ends.
4. NaN/Infinity in any transform or material property, sampled every tick for a full match.
5. Objects not destroyed after round end (memory-growth-over-many-rounds, extending `repeatedMatchStability.spec.ts`'s existing 3-reload heap check into a longer in-match sampling).
6. Duplicate effects (the same logical event producing two renders — the exact shape of the shake/hitstop conflicts in §2.1/§2.2 before they're fixed).
7. Camera losing fighter visibility — already built this session (`cameraTwoFighterFraming.test.ts`'s visibility-percentage assertions); extend the same pattern to any new visual batch that could occlude a fighter (e.g. Clash presentation's dust).
8. HUD covering a critical element — visual regression check once Combat HUD's layout is touched (currently N/A, HUD is blocked per §4).
9. FPS/performance degrading — needs new instrumentation (§10 lists exactly what's missing).
10. Low/Medium/High changing gameplay — assert quality preset only affects particle/shadow counts, never physics or timing.
11. Replay divergence from presentation — assert `getStateHash()` sequences are identical with a visual batch on vs. off (this session's `cameraRig.test.ts` "presentation only" test is the existing template to copy).
12. Fixed-simulation code touched by visual code — a lint-level check (or a code-review checklist item) that nothing under `src/vfx`, `src/bey/procedural-model`, `src/arena/colliders` (visual parts only) imports and mutates anything under `src/app/simulation`, `src/combat`, `src/bey/movement`, `src/bey/stamina`, `src/bey/stability`.

**Smoke scenarios to cover per batch** (reuse the project's existing scenario-preset infrastructure, `src/self-test/scenarios/ScenarioPresets.ts`, which already has most of these): normal hit, heavy hit, Dash, Circular/counter, Perfect Dodge, drift, jump, landing, wall scrape, Stability Break, low Stamina, Clash, ring-out, a long fight (for leak/perf checks), all 9 Beys (once Integration 2 lands), all 3 arena directions where applicable (once Integration 3b lands).

---

## 10. Performance baseline — what exists today, and what to capture before Integration 0 lands

**Already exists** (confirmed by reading the actual code):
- `renderer.info` (draw calls, triangles) is already read live in the Debug Lab panel (`src/debug/lab/DebugLabMode.ts`, `src/debug/inspectors/buildInspection.ts` — `InspectionFrameStats`), plus FPS, frame time, physics-step time, render time, and active-VFX-burst counts. This is a manual-play overlay, not captured by any automated test today.
- `tests/smoke/repeatedMatchStability.spec.ts` samples `performance.memory.usedJSHeapSize` across 3 fresh page loads and asserts no runaway growth — a coarse cross-navigation leak check, not steady-state-during-one-match.
- `src/self-test/AiBatchRunner.ts` tracks simulation-tick throughput and per-tick slowness (`performanceAnomalies`), exercised by `tests/smoke/selfTest.spec.ts` — but this runs with the canvas hidden, so it measures physics/tick performance only, never rendering FPS or draw calls.

**Gaps to close before treating "baseline" as captured**:
- No automated (Playwright) test currently reads the Debug Lab's own Performance panel — draw calls/triangles/FPS are computed live but never asserted on or logged to a file.
- No sustained-fight FPS-over-time or steady-state memory sampling exists (today's heap check is 3 discrete reloads, not one long running match).
- No dedicated perf/benchmark npm script.

**Action before Integration 0**: add one new Playwright smoke test that runs one full AI-vs-AI match at real time, samples the Debug Lab's Performance panel every N seconds (FPS, frame time, draw calls, triangles, active particle/effect counts, heap), and writes the series to `test-results/performance-baseline.json`. This becomes the file every later Integration PR's own perf test diffs against. This is new test infrastructure, not a gameplay change, so it can be built in Integration 0.

---

## 11. Explicitly out of scope / not blocking

Per your list — none of these block starting Integration 0–9:
- SFX (deliberately deferred).
- Optional Post-FX (bloom/chromatic aberration) — no decision made, not needed to start.
- Intro/Countdown/Launch final presentation.
- Per-Bey individual particle/trail identity (beyond the already-approved generic trail).
- Any VFX not already covered by the approved Hybrid package (e.g. jump/aerial/air-recovery — explicitly flagged as its own future gap, not this plan's job).
- Final Bey names.
- GDD-deferred features not covered by any current approval doc.

---

## 12. Risks

1. **Camera/Motion re-validation debt (real, not hypothetical).** `motion-approval.md` §12 requires re-running the Camera Lab's own scenario measurements against the real integrated motion after M11 shipped; nothing in this repo's history shows that happened. This could surface a real camera-framing regression unrelated to anything in this plan — it should run before or alongside Integration 0, not be discovered mid-way through a later batch.
2. **Arena concave floor is gameplay, not just visual**, and is explicitly flagged in its own approval doc as needing playtest before the slope's gameplay pull is finalized. Treating Integration 3a as "just another visual PR" would violate your own rule 7 (no camera-independent-movement changes, no physics-for-animation's-sake) — it needs its own sign-off gate, separate from 3b.
3. **Combat HUD is a live disagreement, not a documentation nit.** If the owner's asserted override is never supplied, the risk is a future agent (or this one) eventually just building a new visual HUD "since nothing else exists" — exactly the outcome the owner is trying to prevent. This needs resolving before Integration 7, not glossed over.
4. **Clash Presentation's source branch could drift.** `origin/claude/clash-presentation-lab` is an unmerged branch on a shared remote; if it's ever deleted or force-pushed, the six commits in §3 are the only record of the approved implementation. Fetching and preserving those commits (e.g. as a tag, or cherry-picked into a holding branch) before Integration 6 starts removes that single point of failure.
5. **No performance baseline exists yet** (§10) — starting Integration 2+ without one means any regression discovered later has no "before" number to compare against.

**No blocker found that prevents starting Integration 0 (shared infrastructure) or Integration 1 (camera/motion re-validation) immediately** — both are independent of the camera playtest outcome and of every other open item above.

---

## 13. Bottom line

**READY FOR VISUAL INTEGRATION AFTER CAMERA OWNER SIGN-OFF.**

Two items should happen alongside — not after — that sign-off, since they don't touch camera behavior and aren't blocked by it:
- Integration 0 (shared visual infrastructure, behavior-neutral, §7).
- Integration 1 (Camera/Motion re-validation measurement pass, §5 row 2) — this is overdue regardless of PR #65's outcome, and running it now means any finding is attributed correctly instead of getting tangled up with whatever PR #65's camera changes turn out to need.

Everything else (Integrations 2 through 9) should wait for the actual sign-off, per your explicit instruction, since several of them (Bey models sitting in-frame, Arena's floor interacting with camera bowl-following, Clash Presentation's own camera-forced-B behavior) are more legible to evaluate once the camera behavior they'll be judged inside of is finalized.
