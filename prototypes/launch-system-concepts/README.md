# Launch System Lab — approved direction

**Status:** OWNER APPROVED · INTEGRATED in the game (0.61.0)  
**Owner approval:** 2026-10-07  
**Canonical decision:** `docs/design-decisions/launch-system-approval.md`

This folder preserves the owner-approved launch prototype as **one standalone HTML file**.

## Final direction

**A — Timing Snap** is the final approved launch interaction.

Required behavior:

- both Beys begin visibly attached to physical 3D launchers;
- the player chooses where their Bey will enter/land in the arena before launch;
- after choosing the point, the player uses the Timing Snap marker and presses **LAUNCH** once;
- the physical launcher releases the Bey;
- preserve the approved simultaneous animation of both Beys travelling from their launchers into the stage;
- **the instant both Beys make their first arena contact/bounce, Combat begins**;
- there is **no post-landing 3 / 2 / 1 / GO countdown**.

B — Power Pull and C — Vector Draw remain historical exploration only and are not final directions.

## Prototype

Open:

`prototypes/launch-system-concepts/index.html`

The lab reuses the visual language of the existing Bey, Arena, Motion, Camera, VFX, Condition and Clash prototypes. Its Power / Spin / Control / Entry speed readouts are prototype instrumentation, not final production balance values.
