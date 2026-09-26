# Bey Visual Concepts — prototype

Interactive Three.js page for comparing **nine temporary visual directions** for the three initial ChaosBeys (3 Attack, 3 Defense, 3 Stamina) before the final design is approved. Covered by GDD sections 1.6, 33, 96 and 97.

This is **visual exploration only**. It imports nothing from `src/` and changes no gameplay, physics, colliders, stats or balance. Codes such as "Attack B" are placeholders, not names. Palettes, materials and emblems are temporary.

## Anatomy — four pieces (round 2)

Every concept is built from the same four pieces. The layout follows round-1 Defense C, which the owner picked as the reference, with the disc now exposed. The Beyblade equivalents below are **category references only**, not names to copy.

| # | Piece | Role | Beyblade equivalent |
|---|---|---|---|
| 1 | **Top Layer** | Raised center with the emblem, nested in the ring | Face Bolt + Energy Ring (Metal Fight) / Chip (Burst) |
| 2 | **Ring** | Widest piece, impact identity, main silhouette | Fusion / Metal Wheel (Metal Fight) / Layer (Burst) |
| 3 | **Disc** | Weight disc, **smaller than the ring**, visible below it | Spin Track (Metal Fight) / Forge Disc (Burst) |
| 4 | **Driver** | Housing + long tip | Performance Tip (Metal Fight) / Driver (Burst) / Bit (X) |

Size rule: ring > disc > driver top. Dark recessed grooves mark the Ring/Disc and Disc/Driver seams. Press **`E` (Explode)** to pull the four pieces apart.

Round 1 is archived, still viewable, in [`../bey-visual-concepts-round1/`](../bey-visual-concepts-round1/).

## Open it

```bash
npm run dev       # http://localhost:5173/prototypes/bey-visual-concepts/
# or, production build:
npm run build && npm run preview
                  # http://localhost:4173/ChaosBey/prototypes/bey-visual-concepts/
```

Once `main` deploys, it is also served on GitHub Pages at `/ChaosBey/prototypes/bey-visual-concepts/`. A `#attack-b` style hash selects a concept directly.

## Controls

| Action | Mouse / UI | Key |
|---|---|---|
| Select a concept | panel buttons | `1`–`9` |
| Top view | TOP | `T` |
| Front 3/4 diagonal (default) | DIAGONAL | `D` |
| Free orbit | FREE, or just drag | `F` |
| Side profile | SIDE | `S` |
| Underside | BELOW | `B` |
| Orbit / zoom / pan | drag / wheel or pinch / right-drag | — |
| Turntable on/off | AUTO ROTATE | `R` |
| Separate the 4 pieces | EXPLODE | `E` |
| Black silhouette check | SILHOUETTE | `K` |

The faint floor ring is Ø 6 in model units. Camera framing only partially adapts to each model (`FRAMING_BLEND` in `ConceptViewer.ts`), so size differences between concepts stay visible.

## Files

```
index.html                           page shell + CSS
src/main.ts                          wiring + automation hook (window.__beyConceptLab)
src/concepts/conceptDefinitions.ts   THE NINE CONCEPTS: palette + piece builders each
src/model/types.ts                   anatomy / ConceptDefinition types
src/model/assembleConcept.ts         stacks the 4 pieces, seam grooves, explode, measurements
src/model/materials.ts               temporary PBR material kit (tuning at top)
src/model/geometry.ts                procedural helpers (extrudeUp, lathe, radial, taperBody…)
src/parts/topLayers.ts               piece 1 — Top Layer builders
src/parts/rings.ts                   piece 2 — Ring builders
src/parts/discs.ts                   piece 3 — Disc builders
src/parts/driverBodies.ts            piece 4a — Driver housing builders
src/parts/tips.ts                    piece 4b — Driver tip builders
src/viewer/ConceptViewer.ts          scene, lights, views, explode, OrbitControls (tuning at top)
src/ui/ConceptLabUi.ts               picker, info card, toolbar, keyboard
scripts/capture.mjs                  screenshot all concepts from the preview build
```

## Remixing

Each concept has five builder slots: `topLayer`, `ring`, `disc`, `driverBody` and `tip`. `driverBody` + `tip` together make the Driver. Every builder takes named parameters. For example, "Attack B, with the tip of Attack C, a ring 10% smaller and the Defense A disc":

```ts
export const ATTACK_B2: ConceptDefinition = {
  ...ATTACK_B,
  id: 'attack-b2',
  parts: {
    ...ATTACK_B.parts,
    tip: ATTACK_C.parts.tip,
    ring: rings.sweptBlades({ hubRadius: 1.6 * 0.9, innerRadius: 0.95, height: 0.45 }),
    disc: DEFENSE_A.parts.disc,
  },
};
```

Add it to `CONCEPTS` to show it in the picker. Keys `1`–`9` cover the first nine entries.

## Checks

- `tests/unit/beyVisualConcepts.test.ts` builds all nine concepts in Node. It checks finite geometry, that each model stands on its tip, that the tip is at least 25% of the height, and that there are at least 10 meshes. It also enforces the four-piece rule: the ring is widest, the disc is visibly smaller than the ring with a real side face, and the Top Layer is smaller than the ring. It also rasterizes top and side silhouettes and requires every pair to differ.
- `tests/smoke/beyVisualConcepts.spec.ts` loads the production page in Chromium and runs through selection, views, drag-to-orbit, zoom, below view and silhouette mode. It also covers explode and checks that the archived round-1 page still loads. It fails on any console error.
