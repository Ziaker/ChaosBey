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
| A | App flow + Character Select | main | IN PROGRESS |
| B | Pregame Simulator + AI explanation + match-rule config | A | IN PROGRESS |
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

## Lane A notes — app flow + Character Select

- **Flow.** `?mode=play` (Main Menu → PLAY) is now the player flow
  (`app/frontend/PlayFlow.ts`): Character Select → match → Results →
  Rematch / Change Bey / Main Menu, in one page. Each step is a `GameState`
  (`CharacterSelect`, `MatchLoading`, `Combat`/`RoundEnd`, `MatchEnd`).
  `window.__chaosBeyPlay` exposes the screen, setup and session read-only.
- **Quick play.** `?mode=play&quick` starts the default match directly with
  the F3 overlay up: the developer/smoke route `?mode=play` used to be.
  The match smokes that drive a raw round use it.
- **Character Select** (`CharacterSelectScreen.ts`, `BeyPreviewStage.ts`):
  the three playable Bey definitions; the focused one spins in 3D on a lit
  pedestal (its own `createVisual()`, render-only), with Attack/Defense/
  Stamina ratings and handling traits relative to a standard Bey, all read
  from the definition data (`beyRoster.ts`). Mouse or ↑/↓ + Enter/Z, Esc
  back to the menu. On a narrow screen the panel sits under the Bey.
- **Roster size.** The owner approved nine Bey concepts as the selectable
  roster (`VISUAL_APPROVALS_MASTER.md` 3.2). Only three exist as gameplay
  definitions; creating six new ones would be new balance/gameplay content,
  outside M10. The roster is data-driven, so they become entries when they
  exist. Names stay the archetype names (final names are still open).
- **Match Beys.** `MatchSession`/`createMatchScene` take the Beys to play
  (`MatchBeys`); the default stays Attack vs Defense, so the Debug Lab,
  quick play and every deterministic test are unchanged. The replay config
  already records the definitions the match used.
- **Keyboard ownership.** The match's keyboard is attached only while the
  match runs, so the Enter/Z that confirmed a menu never reaches the match
  as a held input.
- **Debug overlay.** Hidden on boot in the player flow (F3 still shows it);
  shown in quick play, as before.
- **Opponent.** Chosen on the Pregame screen (lane B); the default is the
  next roster Bey, so the first match is never a mirror.

## Lane B notes — Pregame Simulator, AI tiers, match rules

- **Flow.** Character Select → **Pregame** → rounds → Results. Results
  offers Rematch, Change setup, Change Bey and Main Menu; between rounds of
  a longer match, a round result with Next round / Leave match.
- **Pregame screen** (`PregameScreen.ts`), progressive disclosure:
  - common choices: opponent Bey, AI level, AI style, match length;
  - "Advanced rules" (collapsed): Clash impact multiplier (0.5–2.0, the
    existing GDD 152 `MatchConfig` value) and a fixed seed (blank = random);
  - "What to expect": the matchup rating by rating, the AI's capabilities
    and style, and the rules in force. Keyboard ↑/↓ row, ←/→ change, Enter
    start, Esc back; mouse too.
- **AI tiers Rookie / Rival / Ace** (`ai/difficulty/AiDifficultyTiers.ts`)
  are `AiDifficultyProfile` data only. Rival is the internal default the AI
  has played since M7 (same multipliers), so existing AI tests describe it.
  Two axes were added to the profile so the tiers cover the owner's list:
  **evasion** (scales `dodgeSkill`, capped at 0.95: never a guaranteed
  dodge) and **arena awareness** (scales `edgeCautionMultiplier`, never
  below 1). Both are 1 in the default profile, where the personality is
  returned unchanged. The Debug Lab and Self Test still use the default.
- **AI explanation** (`aiExplanation.ts`): seven capabilities — reaction,
  prediction, consistency, evasion, arena awareness, Clash power,
  adaptation — each the effective value the AI plays with (personality ×
  tier), as a bar and a readout ("0.12 s", "dodges 74% of threats in
  time"). Style lines come from the personality, including resource use.
- **Evidence the tiers matter** (`tests/deterministic/aiDifficultyTiers.test.ts`):
  24 Ace-vs-Rookie mirror matches (all archetypes, both sides): deliberate
  errors 49 vs 106, hits dodged 51 vs 8, dodges 23 vs 7, wins 15 vs 9. In
  the Defense mirror alone the result is near coin-flip whatever the tier
  (Rival vs Rookie 10–10 over 20 matches): Defense-vs-Defense outcomes are
  dominated by collisions, not decisions. That is M7 AI territory, noted
  for playtest, not tuned here.
- **Match length.** 1 round, first to 2 (default) or first to 3. A draw
  scores nobody. Each round is its own deterministic match: round 1 plays
  the match seed, round n plays `<seed>/round-n` (`matchScore.ts`).
