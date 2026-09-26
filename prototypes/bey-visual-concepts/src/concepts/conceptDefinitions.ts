// ============================================================
// BEY VISUAL CONCEPTS — ROUND 2: THE NINE EXPLORATION DIRECTIONS
// TEMPORARY codes only (Attack A … Stamina C). These are NOT names, NOT
// approved designs and NOT used by the game (GDD section 32 / 96 / 171).
// Round 1 is archived in prototypes/bey-visual-concepts-round1/.
//
// Every concept uses the same four-piece anatomy (see model/types.ts):
//   1 TOP LAYER · 2 RING (widest) · 3 DISC (smaller than ring) · 4 DRIVER
// Size rule kept by every concept: ring > disc > driver top.
//
// To remix, e.g. "Attack B with the tip of Attack C and a 10% smaller ring":
//
//   parts: {
//     ...ATTACK_B.parts,
//     tip: ATTACK_C.parts.tip,
//     ring: rings.sweptBlades({ hubRadius: 1.6 * 0.9 }),
//   }
// ============================================================

import * as discs from '../parts/discs';
import * as driver from '../parts/driverBodies';
import * as rings from '../parts/rings';
import * as tips from '../parts/tips';
import * as top from '../parts/topLayers';
import type { ConceptDefinition } from '../model/types';

// ---------------- ATTACK ----------------

export const ATTACK_A: ConceptDefinition = {
  id: 'attack-a',
  archetype: 'attack',
  letter: 'A',
  headline: 'Low radial striker',
  description: 'Low and wide. Four ramped impact lobes with metal-faced leading edges over a notched metal disc; flat rubber driver for aggressive movement.',
  pieces: {
    topLayer: 'Bolted gem crown',
    ring: '4 impact lobes, metal leading faces',
    disc: 'Thick notched metal disc (4 notches)',
    driver: 'Flared housing + flat rubber tip',
  },
  palette: { primary: 0xc4202b, secondary: 0x2a2d35, accent: 0xff7a1a, metal: 0xb9bdc6, darkMetal: 0x3a3e47, translucent: 0xff5a3c, glow: 0xff6a2a },
  parts: {
    topLayer: top.gemCrown({ radius: 1.05, height: 0.6 }),
    ring: rings.impactLobes({ baseRadius: 2.1, innerRadius: 1.1, lobes: 4, reach: 0.8, height: 0.45 }),
    disc: discs.notchedDisc({ radius: 1.65, height: 0.4, notches: 4 }),
    driverBody: driver.flared({ height: 0.65, bottomRadius: 0.6, topRadius: 1.3 }),
    tip: tips.flatStriker({ topRadius: 0.6, height: 1.05 }),
  },
};

export const ATTACK_B: ConceptDefinition = {
  id: 'attack-b',
  archetype: 'attack',
  letter: 'B',
  headline: 'Asymmetric directional slicer',
  description: 'Three pitched blades of unequal size, one dominant, over a toothed gear disc with a translucent layer. Reads as moving even at rest.',
  pieces: {
    topLayer: 'Faceted hub, off-center chevron',
    ring: '3 unequal swept blades (asymmetric)',
    disc: 'Toothed gear disc + translucent layer',
    driver: 'Faceted 7-sided housing + hex spike',
  },
  palette: { primary: 0xd21a6e, secondary: 0x5a1027, accent: 0xff8f3a, metal: 0xc3c7cf, darkMetal: 0x2c2f37, translucent: 0xff4fa0, glow: 0xff3d8b },
  parts: {
    topLayer: top.sigilHub({ radius: 0.95, height: 0.6 }),
    ring: rings.sweptBlades({ hubRadius: 1.6, innerRadius: 0.95, height: 0.45 }),
    disc: discs.gearDisc({ radius: 1.45, height: 0.42 }),
    driverBody: driver.faceted({ height: 0.85, bottomRadius: 0.56, topRadius: 1.15 }),
    tip: tips.hexSpike({ topRadius: 0.56, height: 1.25 }),
  },
};

export const ATTACK_C: ConceptDefinition = {
  id: 'attack-c',
  archetype: 'attack',
  letter: 'C',
  headline: 'Twin-hammer mass impactor',
  description: 'Two huge chamfered hammer blocks on a thick band — impact by mass, not sharpness — over a heavy faceted drum disc and a rubber dome ram.',
  pieces: {
    topLayer: 'Heavy bolted dome',
    ring: '2 hammer blocks on a thick band',
    disc: 'Heavy 10-panel metal drum',
    driver: 'Bolted drum housing + rubber dome',
  },
  palette: { primary: 0x8f1822, secondary: 0x33363d, accent: 0xf26a21, metal: 0xa9adb5, darkMetal: 0x25272c, translucent: 0xff6d3a, glow: 0xff5a1e },
  parts: {
    topLayer: top.boltedDome({ radius: 1.1, height: 0.7 }),
    ring: rings.hammerHeads({ bandInner: 1.15, bandOuter: 1.9, height: 0.6, heads: 2 }),
    disc: discs.heavyDrum({ radius: 1.55, height: 0.5 }),
    driverBody: driver.drum({ height: 0.75, bottomRadius: 0.68, topRadius: 1.25 }),
    tip: tips.domeRam({ topRadius: 0.68, height: 1.1 }),
  },
};

// ---------------- DEFENSE ----------------

export const DEFENSE_A: ConceptDefinition = {
  id: 'defense-a',
  archetype: 'defense',
  letter: 'A',
  headline: 'Overlapping scale shield',
  description: 'Eight tilted plates lap over each other into a wide, nearly circular shield over a layered round steel disc. Heavy dome center, guarded ball tip.',
  pieces: {
    topLayer: 'Wide steel dome with lens',
    ring: '8 overlapping tilted plates',
    disc: 'Two-layer round steel disc, rivets',
    driver: 'Convex bowl housing + guarded ball',
  },
  palette: { primary: 0x2358c4, secondary: 0x16307a, accent: 0x3fd2ff, metal: 0xc8ced8, darkMetal: 0x39404d, translucent: 0x5fdcff, glow: 0x49d6ff },
  parts: {
    topLayer: top.shieldDome({ radius: 1.3, height: 0.6 }),
    ring: rings.overlappingPlates({ outerRadius: 2.8, innerRadius: 1.3, plates: 8, tiltDeg: 6 }),
    disc: discs.layeredDisc({ radius: 1.95, height: 0.42 }),
    driverBody: driver.bowl({ height: 0.8, bottomRadius: 0.6, topRadius: 1.5 }),
    tip: tips.guardedBall({ topRadius: 0.6, height: 1.15 }),
  },
};

export const DEFENSE_B: ConceptDefinition = {
  id: 'defense-b',
  archetype: 'defense',
  letter: 'B',
  headline: 'Segmented bumper array',
  description: 'Six independent bumper pods on coil-spring arms around a solid band, over a metal disc wrapped in a rubber tire. Everything built to absorb contact.',
  pieces: {
    topLayer: 'Raised hex hub with pistons',
    ring: '6 separate pods on spring arms',
    disc: 'Metal disc with rubber bumper tire',
    driver: 'Sprung skirt housing + crown ring tip',
  },
  palette: { primary: 0x1c9bd8, secondary: 0x123a66, accent: 0x9eeaff, metal: 0xb7bfca, darkMetal: 0x2d3440, translucent: 0x7fe5ff, glow: 0x6fe0ff },
  parts: {
    topLayer: top.hexHub({ radius: 0.95, height: 0.6 }),
    ring: rings.bumperPods({ pods: 6, radius: 2.3, innerRadius: 0.95, bandRadius: 1.55 }),
    disc: discs.tireDisc({ radius: 1.7, height: 0.45 }),
    driverBody: driver.sprungSkirt({ height: 0.9, bottomRadius: 0.64, bandRadius: 1.35, topRadius: 1.2 }),
    tip: tips.crown({ topRadius: 0.64, height: 1.0 }),
  },
};

export const DEFENSE_C: ConceptDefinition = {
  id: 'defense-c',
  archetype: 'defense',
  letter: 'C',
  headline: 'Compact stepped fortress',
  description: 'The round-1 reference, now with its disc exposed: tall octagonal tower, crenellated ring, buttressed octagonal disc and a stepped driver with stacked tip.',
  pieces: {
    topLayer: 'Tall 3-tier octagonal tower',
    ring: '8 merlons (crenellated), metal facings',
    disc: 'Octagonal disc with buttresses',
    driver: 'Stepped octagonal housing + stacked tip',
  },
  palette: { primary: 0x1b3290, secondary: 0x4a5566, accent: 0x55b2ff, metal: 0xc2c8d2, darkMetal: 0x262c38, translucent: 0x68c4ff, glow: 0x3fb8ff },
  parts: {
    topLayer: top.tower({ tiers: 3, baseRadius: 1.25, tierHeight: 0.42 }),
    ring: rings.crenellated({ outerRadius: 2.3, innerRadius: 1.4, merlons: 8 }),
    disc: discs.octagonDisc({ radius: 1.7, height: 0.45 }),
    driverBody: driver.stepped({ height: 0.95, bottomRadius: 0.62, topRadius: 1.35 }),
    tip: tips.stacked({ topRadius: 0.62, height: 1.45 }),
  },
};

// ---------------- STAMINA ----------------

export const STAMINA_A: ConceptDefinition = {
  id: 'stamina-a',
  archetype: 'stamina',
  letter: 'A',
  headline: 'Open flywheel rim',
  description: 'Largest diameter: a thin metal rim with five clamped weights on long curved spokes, over a windowed bead disc. Small center, long needle driver.',
  pieces: {
    topLayer: 'Small low cap (minimal center)',
    ring: 'Flywheel rim, 5 curved spokes, 5 weights',
    disc: 'Windowed disc with rim beads',
    driver: 'Waisted slim housing + needle tip',
  },
  palette: { primary: 0x12a08c, secondary: 0x0f4d45, accent: 0xe4b83c, metal: 0xd3d7de, darkMetal: 0x3a4146, translucent: 0x6fe8d0, glow: 0x5ff0d0 },
  parts: {
    topLayer: top.smallCap({ radius: 0.8, height: 0.45 }),
    ring: rings.flywheel({ radius: 3.0, hubRadius: 0.95, spokes: 5, weights: 5 }),
    disc: discs.beadDisc({ radius: 1.6, height: 0.32 }),
    driverBody: driver.waisted({ height: 0.85, bottomRadius: 0.48, topRadius: 1.05 }),
    tip: tips.needle({ topRadius: 0.48, height: 1.45 }),
  },
};

export const STAMINA_B: ConceptDefinition = {
  id: 'stamina-b',
  archetype: 'stamina',
  letter: 'B',
  headline: 'Concentric precision gyro',
  description: 'Three concentric rings at stepped heights joined by thin pins, over a three-step precision disc. Open cage driver with an exposed bearing; mostly metal.',
  pieces: {
    topLayer: 'Precision lens with tick bezel',
    ring: '3 concentric rings, toothed outer ring',
    disc: '3-step precision disc with pins',
    driver: 'Open cage housing + bearing tip',
  },
  palette: { primary: 0x1f8f86, secondary: 0x2f3a3c, accent: 0xd8b04a, metal: 0xd7dbe2, darkMetal: 0x4a5257, translucent: 0x8ff5e0, glow: 0x3fe0c0 },
  parts: {
    topLayer: top.precisionLens({ radius: 0.95, height: 0.55 }),
    ring: rings.concentricRings({ outer: 2.7, middle: 2.05, inner: 1.45, floorRadius: 1.25 }),
    disc: discs.steppedPrecision({ radius: 1.55, height: 0.42 }),
    driverBody: driver.cage({ height: 1.0, bottomRadius: 0.52, topRadius: 1.15 }),
    tip: tips.bearing({ topRadius: 0.52, height: 1.3 }),
  },
};

export const STAMINA_C: ConceptDefinition = {
  id: 'stamina-c',
  archetype: 'stamina',
  letter: 'C',
  headline: 'Vertical aero glider',
  description: 'Tallest profile: slender spire over a tri-lobed ring and a smooth lens disc, then a long finned fairing and ogive tip. Detail concentrated underneath.',
  pieces: {
    topLayer: 'Tall teardrop spire',
    ring: 'Smooth tri-lobed ring, 3 edge weights',
    disc: 'Lens-shaped aero metal disc',
    driver: 'Finned fairing + long ogive tip',
  },
  palette: { primary: 0xe3c24a, secondary: 0x1f6b45, accent: 0x3cbf6e, metal: 0xd0d4db, darkMetal: 0x3b4240, translucent: 0xb8f5a0, glow: 0x9dff7a },
  parts: {
    topLayer: top.spire({ radius: 1.15, height: 1.0 }),
    ring: rings.triLobeAero({ radius: 2.15, width: 0.5, innerRadius: 1.15 }),
    disc: discs.lensDisc({ radius: 1.7, height: 0.4 }),
    driverBody: driver.finnedFairing({ height: 1.3, bottomRadius: 0.55, topRadius: 1.3 }),
    tip: tips.longOgive({ topRadius: 0.55, height: 1.6 }),
  },
};

/** Display / keyboard order: keys 1–9 map to this list. */
export const CONCEPTS: readonly ConceptDefinition[] = [
  ATTACK_A, ATTACK_B, ATTACK_C,
  DEFENSE_A, DEFENSE_B, DEFENSE_C,
  STAMINA_A, STAMINA_B, STAMINA_C,
];
