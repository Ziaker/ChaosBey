# Milestone 10 — Pregame / Presentation

Base: `main@aba0edc59b32a5c6fc926578ab4d9a734bfff19c` (M9 closed).

## Scope

M10 covers the player-facing path around the existing deterministic combat sandbox:

- clean Character Select for the three existing Bey definitions;
- Pregame Simulator rules and human-readable explanations;
- AI selection, difficulty profiles and capability explanation;
- arena presets plus selected sliders (not a full editor);
- Settings and quality presets;
- HUD refinement;
- fullscreen and focus-loss safety;
- gamepad polish through action mapping;
- end-to-end browser/GitHub Pages hardening.

SFX/audio prototyping is explicitly excluded from M10 and must not be integrated here.

## Owner authorization for this milestone

For this M10 pass, visual/UX decisions that would normally wait at the visual approval gate are pre-approved when they are consistent with the GDD and existing approved prototype language. Use reversible/data-driven choices and do not expand scope into unrelated gameplay systems.

Provisional player-facing AI tiers are approved for this pass as **Rookie / Rival / Ace**. They must map onto data-driven capability profiles rather than hard-coded behavior forks, and the UI must explain meaningful differences (reaction/prediction/error/evasion/arena awareness/resource use/Clash performance).

## Implementation order

| Lane | Deliverable | Dependency | Status |
|---|---|---|---|
| A | App flow + Character Select | main | TODO |
| B | Pregame Simulator + AI explanation + match-rule config | A | TODO |
| C | Arena presets + selected sliders | B | TODO |
| D | Settings + Low/Medium/High quality + fullscreen/focus safety + gamepad polish | A | TODO |
| E | HUD refinement + integration/hardening | B/C/D | TODO |
| F | M10 closure: browser smoke, GitHub Pages/base path, docs | E | TODO |

Prefer small reviewable PRs. Parallelize lanes only when their file ownership is clearly separate. Merge `main` into dependent branches; do not rebase integration branches.

## Visual / UX direction

Reuse the visual vocabulary already established by the repository's approved prototypes: dark simulator/industrial surfaces, restrained emissive accents, strong hierarchy, readable stats, and effects that do not obscure gameplay. Character Select should foreground the rotating 3D Bey and Attack/Defense/Stamina differences. Pregame should use progressive disclosure: common decisions first, advanced/experimental rules behind an expandable section. Avoid raw developer-value dumps.

## Quality gates

Every mergeable lane must keep:

- typecheck green;
- unit/deterministic tests green;
- production build green;
- relevant Chromium smoke green;
- no new console errors;
- GitHub Pages/base-path compatibility;
- Debug Lab, Self Test and replay behavior intact.

Add Firefox smoke when practical for final M10 closure; Safari remains deferred by the GDD.

## Non-goals

- SFX/audio integration;
- music/announcer;
- progression/shop/story;
- a full arena editor;
- changing combat/physics/AI semantics merely to fit UI;
- unrelated M11+ work.
