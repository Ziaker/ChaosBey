# Bey Visual Concepts — prototype

Interactive Three.js page for comparing **nine temporary visual directions** for the three initial ChaosBeys (3 Attack, 3 Defense, 3 Stamina) before the final design is approved. Covered by GDD sections 1.6, 33, 96 and 97.

This is **visual exploration only**. It imports nothing from `src/` and changes no gameplay, physics, colliders, stats or balance. Codes such as "Attack B" are placeholders, not names. Palettes, materials and emblems are temporary.

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
| Black silhouette check | SILHOUETTE | `K` |

The faint floor ring is Ø 6 in model units. Camera framing only partially adapts to each model (`FRAMING_BLEND` in `ConceptViewer.ts`), so size differences between concepts stay visible.

## Files

```
index.html                     page shell + CSS
src/main.ts                    wiring + automation hook (window.__beyConceptLab)
src/concepts/conceptDefinitions.ts   THE NINE CONCEPTS: palette + five part slots each
src/model/types.ts             ConceptDefinition / part-slot types
src/model/assembleConcept.ts   stacks the parts bottom-up, measures the result
src/model/materials.ts         temporary PBR material kit (tuning at top)
src/model/geometry.ts          procedural helpers (extrudeUp, lathe, radial, polarShape…)
src/parts/tips.ts              tip / driver point builders
src/parts/lowerBodies.ts       driver housing builders
src/parts/middleLayers.ts      chassis / weight layer builders
src/parts/upperRings.ts        main silhouette ring builders
src/parts/cores.ts             center / emblem builders
src/viewer/ConceptViewer.ts    scene, lights, views, OrbitControls (tuning at top)
src/ui/ConceptLabUi.ts         picker, info card, toolbar, keyboard
scripts/capture.mjs            screenshot all concepts from the preview build
```

## Remixing

Each concept has five swappable slots, stacked in this order: `tip` → `lowerBody` → `middleLayer`, with `upperRing` mounted at the middle layer's base and `core` on its top. Every part builder takes named parameters. For example, "Attack B, with the tip of Attack C and a ring 10% smaller":

```ts
export const ATTACK_B2: ConceptDefinition = {
  ...ATTACK_B,
  id: 'attack-b2',
  parts: {
    ...ATTACK_B.parts,
    tip: ATTACK_C.parts.tip,
    upperRing: rings.sweptBlades({ hubRadius: 1.55 * 0.9, height: 0.34, lift: 0.18, pitchDeg: 12 }),
    core: DEFENSE_A.parts.core,
  },
};
```

Add it to `CONCEPTS` to show it in the picker. Keys `1`–`9` cover the first nine entries.

## Checks

- `tests/unit/beyVisualConcepts.test.ts` builds all nine concepts in Node. It checks finite geometry, that each model stands on its tip, that the tip is at least 25% of the height, and that there are at least 10 meshes. It also rasterizes top and side silhouettes and requires every pair to differ.
- `tests/smoke/beyVisualConcepts.spec.ts` loads the production page in Chromium and runs through selection, views, drag-to-orbit, zoom, below view and silhouette mode. It fails on any console error.
