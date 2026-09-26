// ============================================================
// BEY VISUAL CONCEPTS — THE NINE EXPLORATION DIRECTIONS
// TEMPORARY codes only (Attack A … Stamina C). These are NOT names, NOT
// approved designs and NOT used by the game (GDD section 32 / 96 / 171).
//
// Each concept = palette + five swappable part slots. To remix, e.g.
// "Attack B with the tip of Attack C and a 10% smaller ring":
//
//   parts: {
//     ...ATTACK_B.parts,
//     tip: ATTACK_C.parts.tip,
//     upperRing: rings.sweptBlades({ hubRadius: 1.55 * 0.9, ... }),
//   }
//
// Part builders live in ../parts/*.ts; every numeric knob is a named param.
// ============================================================

import * as cores from '../parts/cores';
import * as lower from '../parts/lowerBodies';
import * as middle from '../parts/middleLayers';
import * as tips from '../parts/tips';
import * as rings from '../parts/upperRings';
import type { ConceptDefinition } from '../model/types';

// ---------------- ATTACK ----------------

export const ATTACK_A: ConceptDefinition = {
  id: 'attack-a',
  archetype: 'attack',
  letter: 'A',
  headline: 'Low radial striker',
  description: 'Four ramped impact lobes end in steep metal-faced leading edges. Low, wide profile with mass pushed to the rim over a compact bolted center.',
  traits: ['4 impact lobes', 'low profile', 'metal impact faces', 'flat rubber tip'],
  palette: { primary: 0xc4202b, secondary: 0x2a2d35, accent: 0xff7a1a, metal: 0xb9bdc6, darkMetal: 0x3a3e47, translucent: 0xff5a3c, glow: 0xff6a2a },
  parts: {
    tip: tips.flatStriker({ length: 1.5, contactRadius: 0.42 }),
    lowerBody: lower.flared({ height: 0.8, bottomRadius: 0.4, topRadius: 1.8, ribs: 8 }),
    middleLayer: middle.cutoutWeightDisc({ radius: 2.0, height: 0.34, cutouts: 4 }),
    upperRing: rings.impactLobes({ baseRadius: 2.15, innerRadius: 1.2, lobes: 4, reach: 0.85, height: 0.42, lift: 0.1 }),
    core: cores.gemBolts({ radius: 1.0, height: 0.4, bolts: 6 }),
  },
};

export const ATTACK_B: ConceptDefinition = {
  id: 'attack-b',
  archetype: 'attack',
  letter: 'B',
  headline: 'Asymmetric directional slicer',
  description: 'Three swept, pitched blades of unequal size — one dominant — over an exposed gear frame and translucent under-plate. Reads as moving even at rest.',
  traits: ['3 unequal blades', 'asymmetric', 'exposed gear layer', 'hex spike tip'],
  palette: { primary: 0xd21a6e, secondary: 0x5a1027, accent: 0xff8f3a, metal: 0xc3c7cf, darkMetal: 0x2c2f37, translucent: 0xff4fa0, glow: 0xff3d8b },
  parts: {
    tip: tips.hexSpike({ length: 1.7 }),
    lowerBody: lower.faceted({ height: 0.8, bottomRadius: 0.3, topRadius: 1.45, facets: 7 }),
    middleLayer: middle.gearFrame({ radius: 1.75, height: 0.3, teeth: 28, spokes: 3 }),
    upperRing: rings.sweptBlades({ hubRadius: 1.55, height: 0.34, lift: 0.18, pitchDeg: 12 }),
    core: cores.offsetSigil({ radius: 0.85, height: 0.45 }),
  },
};

export const ATTACK_C: ConceptDefinition = {
  id: 'attack-c',
  archetype: 'attack',
  letter: 'C',
  headline: 'Twin-hammer mass impactor',
  description: 'Two huge bolted hammer blocks on a thick band — impact by mass, not sharpness. Tall armored drum center and a robust rubber dome tip.',
  traits: ['2 hammer heads', 'bar silhouette', 'heavy drum center', 'dome ram tip'],
  palette: { primary: 0x8f1822, secondary: 0x33363d, accent: 0xf26a21, metal: 0xa9adb5, darkMetal: 0x25272c, translucent: 0xff6d3a, glow: 0xff5a1e },
  parts: {
    tip: tips.domeRam({ length: 1.6, radius: 0.4 }),
    lowerBody: lower.drum({ height: 0.75, radius: 1.25, bottomRadius: 0.42, bolts: 8 }),
    middleLayer: middle.armoredDrum({ radius: 1.55, height: 0.55, panels: 10 }),
    upperRing: rings.hammerHeads({ bandInner: 1.45, bandOuter: 1.95, height: 0.6, heads: 2, headRadial: 1.1, headTangential: 1.55, headHeight: 0.9 }),
    core: cores.boltedCap({ radius: 1.15, height: 0.6, bolts: 8 }),
  },
};

// ---------------- DEFENSE ----------------

export const DEFENSE_A: ConceptDefinition = {
  id: 'defense-a',
  archetype: 'defense',
  letter: 'A',
  headline: 'Overlapping scale shield',
  description: 'Eight tilted plates lap over each other into a wide, nearly circular shield. Few protrusions, heavy steel dome center, guarded ball tip.',
  traits: ['8 overlapping plates', 'near-circular', 'steel dome center', 'guarded ball tip'],
  palette: { primary: 0x2358c4, secondary: 0x16307a, accent: 0x3fd2ff, metal: 0xc8ced8, darkMetal: 0x39404d, translucent: 0x5fdcff, glow: 0x49d6ff },
  parts: {
    tip: tips.guardedBall({ length: 1.6, ball: 0.3 }),
    lowerBody: lower.bowl({ height: 0.75, bottomRadius: 0.36, topRadius: 2.0 }),
    middleLayer: middle.layeredPlates({ radius: 2.25, height: 0.3 }),
    upperRing: rings.overlappingPlates({ outerRadius: 2.85, innerRadius: 1.6, plates: 8, tiltDeg: 6 }),
    core: cores.shieldDome({ radius: 1.35, height: 0.55 }),
  },
};

export const DEFENSE_B: ConceptDefinition = {
  id: 'defense-b',
  archetype: 'defense',
  letter: 'B',
  headline: 'Segmented bumper array',
  description: 'Six independent thick bumper pods with rubber strips, each on a coil-spring arm, over a wide rubber skirt. Gaps between pods; strong lateral presence.',
  traits: ['6 separate pods', 'spring arms', 'rubber skirt', 'crown ring tip'],
  palette: { primary: 0x1c9bd8, secondary: 0x123a66, accent: 0x9eeaff, metal: 0xb7bfca, darkMetal: 0x2d3440, translucent: 0x7fe5ff, glow: 0x6fe0ff },
  parts: {
    tip: tips.crown({ length: 1.5, crownRadius: 0.36 }),
    lowerBody: lower.skirt({ height: 1.1, bottomRadius: 0.5, skirtRadius: 2.0, topRadius: 1.3, absorbers: 6 }),
    middleLayer: middle.hubArms({ hubRadius: 1.15, height: 0.5, arms: 6, armLength: 1.95 }),
    upperRing: rings.bumperPods({ pods: 6, radius: 2.35, podHeight: 0.7 }),
    core: cores.hexHub({ radius: 0.95, height: 0.5 }),
  },
};

export const DEFENSE_C: ConceptDefinition = {
  id: 'defense-c',
  archetype: 'defense',
  letter: 'C',
  headline: 'Compact stepped fortress',
  description: 'Tall three-tier octagonal tower over a narrow crenellated ring and stepped octagonal base. Highest center, smallest outer ring of the defense set.',
  traits: ['tall tower center', '8 merlons', 'narrow ring', 'stacked segment tip'],
  palette: { primary: 0x1b3290, secondary: 0x4a5566, accent: 0x55b2ff, metal: 0xc2c8d2, darkMetal: 0x262c38, translucent: 0x68c4ff, glow: 0x3fb8ff },
  parts: {
    tip: tips.stacked({ length: 1.75, segments: 4, topRadius: 0.58 }),
    lowerBody: lower.stepped({ height: 0.95, bottomRadius: 0.58, topRadius: 1.6, steps: 3, sides: 8 }),
    middleLayer: middle.fortressBase({ radius: 1.85, height: 0.45, sides: 8 }),
    upperRing: rings.crenellated({ outerRadius: 2.3, innerRadius: 1.55, merlons: 8 }),
    core: cores.tower({ tiers: 3, baseRadius: 1.3, tierHeight: 0.42 }),
  },
};

// ---------------- STAMINA ----------------

export const STAMINA_A: ConceptDefinition = {
  id: 'stamina-a',
  archetype: 'stamina',
  letter: 'A',
  headline: 'Open flywheel rim',
  description: 'Largest diameter: a thin metal rim with five clamped weights, joined to a tiny hub by five long curved spokes. Mostly empty space; long needle tip.',
  traits: ['largest diameter', '5 curved spokes', 'mass at rim', 'needle tip'],
  palette: { primary: 0x12a08c, secondary: 0x0f4d45, accent: 0xe4b83c, metal: 0xd3d7de, darkMetal: 0x3a4146, translucent: 0x6fe8d0, glow: 0x5ff0d0 },
  parts: {
    tip: tips.needle({ length: 2.15 }),
    lowerBody: lower.slender({ height: 0.9, bottomRadius: 0.22, waist: 0.26, topRadius: 0.95 }),
    middleLayer: middle.curvedSpokes({ hubRadius: 0.8, rimRadius: 2.9, spokes: 5, curve: 0.55 }),
    upperRing: rings.flywheelRim({ radius: 3.05, weights: 5, phase: 0.55 }),
    core: cores.smallPin({ radius: 0.55, height: 0.3 }),
  },
};

export const STAMINA_B: ConceptDefinition = {
  id: 'stamina-b',
  archetype: 'stamina',
  letter: 'B',
  headline: 'Concentric precision gyro',
  description: 'Three concentric rings at stepped heights joined by thin pins, outer ring finely toothed. Open cage housing and exposed ball-bearing tip; mostly metal.',
  traits: ['3 concentric rings', 'open gaps', 'open cage housing', 'bearing tip'],
  palette: { primary: 0x1f8f86, secondary: 0x2f3a3c, accent: 0xd8b04a, metal: 0xd7dbe2, darkMetal: 0x4a5257, translucent: 0x8ff5e0, glow: 0x3fe0c0 },
  parts: {
    tip: tips.bearing({ length: 1.85, balls: 10 }),
    lowerBody: lower.cage({ height: 1.0, bottomRadius: 0.36, topRadius: 1.25, struts: 6 }),
    middleLayer: middle.precisionPlate({ radius: 1.4, height: 0.12, pins: 12 }),
    upperRing: rings.concentricRings({ outer: 2.7, middle: 2.05, inner: 1.5, teeth: 48, pins: 6 }),
    core: cores.precisionLens({ radius: 0.7, height: 0.35 }),
  },
};

export const STAMINA_C: ConceptDefinition = {
  id: 'stamina-c',
  archetype: 'stamina',
  letter: 'C',
  headline: 'Vertical aero glider',
  description: 'Tallest profile: a long finned fairing and ogive cone tip below a medium tri-lobed ring, crowned by a slender spire. Detail concentrated underneath.',
  traits: ['tallest', 'tri-lobe ring', '3 swept fins below', 'long ogive tip'],
  palette: { primary: 0xe3c24a, secondary: 0x1f6b45, accent: 0x3cbf6e, metal: 0xd0d4db, darkMetal: 0x3b4240, translucent: 0xb8f5a0, glow: 0x9dff7a },
  parts: {
    tip: tips.longCone({ length: 2.3, topRadius: 0.34 }),
    lowerBody: lower.finnedFairing({ height: 1.5, bottomRadius: 0.3, topRadius: 1.5, fins: 3, finReach: 0.5 }),
    middleLayer: middle.aeroShell({ radius: 1.9, height: 0.3, innerRadius: 1.5 }),
    upperRing: rings.triLobeAero({ radius: 2.2, lobes: 3, lobeAmp: 0.2, width: 0.42 }),
    core: cores.spire({ radius: 1.1, height: 1.0 }),
  },
};

/** Display / keyboard order: keys 1–9 map to this list. */
export const CONCEPTS: readonly ConceptDefinition[] = [
  ATTACK_A, ATTACK_B, ATTACK_C,
  DEFENSE_A, DEFENSE_B, DEFENSE_C,
  STAMINA_A, STAMINA_B, STAMINA_C,
];
