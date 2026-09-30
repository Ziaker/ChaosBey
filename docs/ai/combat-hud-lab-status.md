# Combat HUD Lab — implementation report

**Branch:** `chatgpt/combat-hud-lab`  
**PR:** #64  
**Status:** visual-approval prototype; **not** the final integrated combat HUD. Do not merge/finalize a direction without owner approval.

## 1. The three directions

### A — Clean Competitive / Broadcast Combat
- Stable upper-corner fighter cards.
- Stamina / Stability / Attack Energy / Dodge cooldown stay in predictable screen anchors.
- Restrained temporary event banner and movement-state feedback.
- Priority: fastest competitive reading and the lowest action-core obstruction.

### B — Aggressive Anime Arena / Fighter Spectacle
- Angled lower-screen cards and stronger motion-graphic language.
- Temporary events become large, central, expressive callouts.
- Edge danger and critical events escalate more visibly.
- Priority: spectacle and hit/event salience while preserving the same underlying resource data.

### C — Tactical Core / Mechanical System HUD
- Side-mounted, compact instrument panels.
- Segmented resource tracks, cooldown visibility and technical readouts.
- Temporary event labels are compact/system-like instead of cinematic.
- Priority: condition/resource diagnosis and mechanical state.

The directions share the same live state; only presentation changes.

## 2. Existing systems actually incorporated

The Lab is routed through the production app and creates a real `MatchSession`.
It therefore reuses the current implementation of:

- Rapier physics and the current arena collider/floor profile.
- Current Motion direction and Bey physical response.
- Current combat and hit detection.
- Stamina, Stability/Broken and Attack Energy systems.
- Current Player-vs-AI controller pipeline.
- Current approved camera preset selected by the player; Clash continues to use the current Clash camera override.
- Current impact/speed/trail VFX routed by `MatchSession`.
- Current Clash rules and approved live force-bar math (`hudModel.ts`).
- Current floor profiles: Flat, Bowl A, Bowl B, Bowl C.
- Existing Debug Lab mutation API for deterministic approval scenarios. Harness mutations are explicitly logged by `MatchSession` and do not become gameplay rules.
- Existing global build/version badge from normal bootstrap.

The approved diegetic Stamina/Stability condition language remains separate; the Lab does **not** reinterpret the floor/physical condition visuals as a HUD replacement.

## 3. Comparison and evaluation harness

Implemented controls:

- single A / B / C;
- compare `A | B | C`;
- timed sequence `A → B → C`;
- pause;
- quarter-speed observation;
- restart;
- Flat / Bowl A / Bowl B / Bowl C;
- action-core obstruction overlay with a live overlap percentage.

Implemented scenario catalogue, in the owner-requested order:

1. balanced combat;
2. close combat;
3. high-speed chase;
4. edge danger;
5. ring-out;
6. strong knockback;
7. drift + recovery;
8. jump + landing;
9. Perfect Dodge setup;
10. Clash;
11. low Stamina;
12. Stability pressure / Broken setup;
13. round end;
14. match end / Match Point presentation context;
15. Flat + Bowl A/B/C sweep.

## 4. Current behavior by stress case

### Normal combat
All three show the same real Stamina, Stability, Attack Energy, attack state, Dodge cooldown and speed. A keeps the strongest fixed hierarchy; B spends more screen area on presentation; C uses denser segmented instrumentation.

### High speed
The HUD is screen-anchored, so it does not chase the rapidly moving Beys. The live camera/FOV still comes from the current camera director. The dedicated high-speed scenario gives the player Bey an actual high linear velocity rather than changing only a displayed number.

### Clash
The general HUD yields to the live Clash force bar. Its two shares are calculated from the real Clash controller inputs/power and follow the same smoothing/caps as the existing approved functional HUD. The bar is projected around the midpoint of the real Beys.

### Edge / ring-out
A continuous presentation-only edge-danger signal is derived from player radius versus the actual ring-out radius. The ring-out scenario still ends through the real ring-out/round rules.

### Stamina / Stability pressure
Low-resource styling follows the already-approved condition thresholds. Broken state comes from the real Stability system. Diegetic condition visuals remain independent of this HUD layer.

### Round / match result
The Lab can show round/result hierarchy and a Match Point presentation context. A full best-of-three match shell is **not duplicated inside the Lab**; the current `MatchSession` is one round, so match-score metadata used only to evaluate presentation remains a Lab harness until/if this HUD direction is integrated into the real match flow.

## 5. What remains temporary / intentionally not final

- The words `YOU`, `CPU`, `ATTACK`, `DEFENSE` are temporary labels, not final fighter naming.
- Match Point score metadata in the Lab is presentation harness data, not a second match-rules implementation.
- Exact typography, animation timing, colors, spacing and shapes of A/B/C remain approval material.
- Perfect Dodge and Stability Break scenarios use real inputs/resources but still need browser smoke confirmation that the intended event fires reliably under CI timing.
- No final lock-on widget has been selected yet.
- Hit-confirm/state-confirm treatment is currently represented mainly through temporary event labels; it still needs the owner-facing visual comparison pass.
- Result auto-continue countdown and a harmonized pause/results shell are not yet finalized in the Lab.
- Obstruction percentage is an evaluation aid only and must never ship as player HUD.

## 6. Verification gates

Required before treating the Lab as ready for owner approval:

- `npm run typecheck`;
- full `npm test`;
- `npm run build`;
- Playwright smoke for Lab boot and A/B/C swapping;
- Playwright smoke for real Clash and round-end through the Lab harness;
- Playwright smoke for high speed;
- Playwright sweep of Flat + Bowl A/B/C;
- no browser console/page errors.

The PR remains draft until these gates pass. Even with green CI, this document does not authorize integration of A, B or C as the final game HUD.
