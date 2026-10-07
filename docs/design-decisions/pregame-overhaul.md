# ChaosBey — Pregame Visual Overhaul + Official Advanced Presets

**Status:** OWNER APPROVED · READY FOR IMPLEMENTATION · NOT YET INTEGRATED  
**Decision date:** 2026-10-07  
**Scope:** Pregame Setup presentation/UX and official presets for the existing Advanced settings.  
**Source of truth for implementation:** this document, `OWNER_DECISIONS_MASTER.md`, `VISUAL_APPROVALS_MASTER.md`, current `PregameScreen.ts` / `matchSetup.ts`, and the current tuning ranges/defaults in code.

---

## 1. Goal

Overhaul the post-character-selection Pregame so it is:

- objective;
- fast to read;
- easy to change;
- easy to restore;
- useful for both casual play and simulator-style tuning;
- visually cleaner than the current long configuration form.

This is **not** a cinematic redesign.

Do not add a VS presentation, large animated 3D previews, elaborate background scenes, decorative particles, or complex transitions just to make the screen look more dramatic.

The owner explicitly rejected that direction in favor of a simpler configuration UI.

---

## 2. Approved high-level layout

Use a simple **two-column layout**:

### Left — configuration

The left side contains the controls.

Top-level sections:

1. **Preset**
2. **Opponent**
3. **AI**
4. **Arena**
5. **Match**
6. **Advanced**

The sections should be compact and immediately understandable.

### Right — match summary

Keep a short live summary showing only useful information:

- Player Bey;
- Opponent Bey;
- AI difficulty;
- AI style;
- Arena;
- match length;
- enabled win conditions;
- number of Advanced settings different from Normal Original.

Do not turn this area into a long prose report.

The existing deeper AI capability information may remain available, but it must not dominate the default view.

---

## 3. Advanced section

The current Advanced configuration remains available, but the giant continuous list must be reorganized into these categories:

1. **Movement**
2. **Jump**
3. **Combat**
4. **Arena**
5. **Round**
6. **Visual**

Tabs, compact sub-panels, or another equally direct category switcher are acceptable.

The important invariant is that the user does not need to scroll through every Advanced parameter to reach a different category.

### Control presentation

For existing settings:

- choices: segmented control or compact select;
- numeric values: slider + visible formatted value;
- booleans: clear On/Off toggle;
- show the default discreetly;
- if the current value differs from Normal Original, show a small **MODIFIED** state;
- provide reset for the current category;
- provide **Reset all** for all Advanced settings.

Do not expose new raw developer-only values.

Do not remove any currently authorized Advanced setting.

---

## 4. Official presets

The Pregame must have five owner-approved official presets plus the derived **Custom** state.

Display order:

1. **Normal Original**
2. **Realistic**
3. **Epic**
4. **Smooth**
5. **Strategic**
6. **Custom** — derived state only; not an authored preset the player applies directly.

Each official preset must show its brief description directly in the Pregame.

### 4.1 Normal Original

**Description:**  
> The original ChaosBey experience using the game's current recommended/default Advanced settings.

Behavior:

- exactly the current canonical defaults;
- must use the same source of defaults as the game;
- must not maintain a second manually duplicated set of "normal" numbers;
- **Reset all** must return to this preset;
- when defaults change through a later approved owner decision, Normal Original follows them automatically.

### 4.2 Realistic

**Description:**  
> Heavier, more physical movement with more inertia and less exaggerated behavior.

Tuning direction:

- less extreme acceleration and speed;
- less steering authority at very high speed;
- lower air-control freedom;
- momentum/inertia should matter more;
- collisions and loss of control should feel weightier;
- reduce exaggerated knockback/lift behavior compared with Epic;
- VFX should be more restrained.

### 4.3 Epic

**Description:**  
> Faster, harder-hitting and more spectacular battles with frequent explosive moments.

Tuning direction:

- higher speed and acceleration;
- stronger momentum payoff;
- more intense Dash / knockback / lift / Clash behavior where existing sliders allow it;
- larger or more dramatic jumps where existing sliders allow it;
- stronger VFX presentation;
- cooldown/resource values may be more permissive to keep action frequent.

### 4.4 Smooth

**Description:**  
> Easier, more fluid and predictable control with fewer harsh interruptions.

Tuning direction:

- responsive acceleration;
- high speed retention through turns;
- strong control at speed;
- more forgiving air control;
- reduced loss of control from body contact;
- moderate knockback;
- forgiving recovery/mobility values where current sliders allow it.

### 4.5 Strategic

**Description:**  
> More deliberate battles where positioning, momentum, stamina, cooldowns and timing matter more.

Tuning direction:

- less extreme top speed than Epic;
- momentum takes more commitment to build and is valuable to preserve;
- stamina and cooldown management matter more;
- Dodge / Jump / Dash should require more commitment using existing settings;
- body contact and ring-out pressure remain relevant;
- lower overall control permissiveness than Smooth;
- emphasize preparation, positioning and timing rather than constant action.

---

## 5. Preset semantics — mandatory

Official presets change **only the configuration represented by Advanced**.

They must **not** change:

- selected Player Bey;
- selected Opponent Bey;
- AI difficulty;
- AI style;
- main Arena preset selection;
- main Floor selection;
- movement direction preset A/B/C;
- match opponent identity.

If a setting already belongs to Advanced — including Advanced arena/round/visual values — it may be part of an official preset.

### Applying a preset

Selecting an official preset applies its full Advanced configuration in one action.

Do not implement presets as vague labels that only change two or three values.

Each non-Normal preset must resolve to a deterministic configuration for the full Advanced surface.

A clean implementation is either:

- a complete typed Advanced snapshot; or
- the canonical defaults plus an explicit, centralized override table that deterministically resolves every Advanced value.

Do not scatter preset numbers through UI event handlers.

### Custom detection

The active preset label is derived from the current Advanced configuration:

- exact match with Normal Original -> **Normal Original**;
- exact match with Realistic -> **Realistic**;
- exact match with Epic -> **Epic**;
- exact match with Smooth -> **Smooth**;
- exact match with Strategic -> **Strategic**;
- otherwise -> **Custom**.

Therefore:

- changing one Advanced value manually normally turns the preset into Custom;
- manually returning every value to an official preset should allow the UI to recognize that preset again;
- loading a saved user configuration should also be recognized as an official preset if it exactly matches one.

Use stable numeric values/normalization so floating-point representation does not make matching fragile.

---

## 6. Numeric tuning status for Realistic / Epic / Smooth / Strategic

The owner approved the **preset identities and tuning directions**, not a final table of numeric values.

Therefore the first implementation may choose numeric values from the **existing legal slider/toggle ranges**, but:

- every such number is **PROVISIONAL IMPLEMENTATION TUNING**;
- do not describe those numbers as owner-final;
- keep all official preset data centralized;
- use existing settings only;
- do not add mechanics or new gameplay variables to make a preset work;
- do not exceed current legal ranges;
- do not silently change the canonical default values;
- Normal Original is always the canonical default configuration, never provisional.

The implementation PR must make the chosen provisional table easy to review in one place.

---

## 7. Official presets vs saved user configurations

The current saved Advanced rule configurations remain supported.

Keep two concepts distinct:

### Official

- Normal Original
- Realistic
- Epic
- Smooth
- Strategic

These ship with the game and cannot be deleted or renamed by the player.

### Saved

User-created configurations stored by the existing save/load system.

Recommended compact presentation:

- official presets first;
- saved presets in a separate **Saved** area;
- **Save current** action remains available.

Do not replace or break the existing saved-rule functionality.

---

## 8. Modified-state UX

The reference for "modified" is **Normal Original**.

Required behavior:

- individual Advanced controls that differ from Normal Original receive a subtle **MODIFIED** indicator;
- each Advanced category may show its number of modified controls;
- the top-level summary shows the total number of modified Advanced settings;
- **Reset category** restores that category to Normal Original;
- **Reset all** restores all Advanced values to Normal Original and makes the active preset Normal Original.

The indicator should be informative, not visually noisy.

---

## 9. Visual direction

Preserve the existing dark ChaosBey frontend language, but clean it up.

Approved direction:

- dark background;
- clear hierarchy;
- compact panels;
- consistent accent color;
- improved spacing;
- improved contrast;
- fewer unnecessary borders/boxes;
- obvious selected states;
- readable values;
- minimal motion.

Avoid:

- cinematic VS screen;
- large 3D Bey presentation in Pregame;
- 3D arena showcase as the main UI;
- heavy animation;
- decorative effects that make settings harder to read;
- turning Pregame into a Debug Lab.

This approval applies to **Pregame only**. It does not approve the final visual treatment of Main Menu, Character Select, Pause, Results, or Settings.

---

## 10. Existing behavior that must survive

The overhaul is presentation/UX plus official preset application.

Do not change the underlying meaning of existing gameplay settings.

Preserve:

- existing Player -> Character Select -> Pregame -> Match flow;
- all current authorized Pregame choices;
- current Advanced sliders/toggles and their legal ranges;
- AI explanation data derived from real AI configuration;
- last-setup persistence;
- saved rule configurations;
- keyboard navigation;
- mouse interaction;
- accessible labels/roles;
- Start Match and Back behavior;
- default values and owner-approved gameplay rules.

No physics, AI logic, combat logic, arena simulation, camera behavior, VFX rules, or match rules should change merely because this screen is redesigned.

The only gameplay-affecting action introduced by this feature is the intentional application of existing Advanced settings through the new official presets.

---

## 11. Recommended implementation structure

Before coding, inspect current `main`; filenames below describe the current architecture and may have moved.

Likely touch points:

- `src/app/frontend/PregameScreen.ts`
- `src/app/frontend/frontendStyle.ts`
- `src/app/frontend/matchSetup.ts`
- a new focused preset module, e.g. `src/app/frontend/pregamePresets.ts`
- unit/smoke tests covering the Pregame

Prefer a dedicated typed preset module over embedding configuration tables inside `PregameScreen.ts`.

Suggested responsibilities:

### `pregamePresets.ts`

- official preset ids;
- labels;
- descriptions;
- provisional tuning tables for the four non-Normal presets;
- resolver/apply function;
- official-preset matching function;
- helpers for modified counts if useful.

### `matchSetup.ts`

Remain the authority for:

- canonical defaults;
- sanitization;
- saved user rule configurations;
- existing setup persistence.

Do not fork those responsibilities into the preset module.

### `PregameScreen.ts`

Own:

- layout;
- section navigation;
- preset picker;
- description display;
- Modified / Custom presentation;
- reset actions;
- summary.

---

## 12. Acceptance criteria

The implementation is ready only when all of these are true:

1. Pregame is still between Character Select and Match.
2. The default view is materially easier to scan than the current giant-form presentation.
3. The layout is two-column on normal desktop widths and remains usable on narrow widths.
4. Advanced is organized into Movement / Jump / Combat / Arena / Round / Visual.
5. All existing authorized Advanced controls remain reachable.
6. Five official presets are visible in the approved order.
7. Every official preset displays its approved brief description.
8. Normal Original is exactly the game's current Advanced defaults.
9. Reset all produces exactly Normal Original.
10. Realistic / Epic / Smooth / Strategic each apply deterministic Advanced configurations.
11. Their first numeric tables are clearly marked provisional.
12. Applying an official preset does not change Player Bey, Opponent, AI difficulty/style, main Arena/Floor selection, or movement A/B/C.
13. Editing an Advanced value causes correct official-preset/Custom recognition.
14. Returning values to an exact official configuration restores that official preset label.
15. Saved user configurations continue to work.
16. Modified indicators/counts are computed against Normal Original.
17. Keyboard navigation remains functional.
18. Start Match and Back remain functional.
19. No new gameplay mechanic is introduced.
20. Existing typecheck/tests/build policy in `CLAUDE.md` is followed.

---

## 13. Out of scope

Do not use this task to:

- redesign Character Select;
- redesign Main Menu;
- redesign Pause;
- redesign Results;
- redesign Settings;
- redesign Combat HUD;
- add a new arena;
- change Bey stats;
- rebalance canonical defaults;
- change AI behavior directly;
- change physics;
- change camera;
- add new VFX systems;
- implement rail grinding;
- add audio;
- add new Advanced mechanics.

---

## 14. Owner decision summary

**Approved 2026-10-07:**

- Pregame visual overhaul should be objective and easy to manipulate;
- simple two-column layout;
- compact top-level sections;
- Advanced reorganized into categories;
- visible modified/default states and reset actions;
- short match summary;
- official preset system with:
  - Normal Original;
  - Realistic;
  - Epic;
  - Smooth;
  - Strategic;
  - derived Custom state;
- each official preset has its own Advanced configuration and a brief description;
- non-Normal preset numbers may start as provisional implementation tuning inside existing ranges;
- no cinematic Pregame treatment.

This decision is ready for implementation without reopening the visual direction above.
