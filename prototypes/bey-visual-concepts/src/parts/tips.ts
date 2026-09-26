// ============================================================
// BEY VISUAL CONCEPTS — TIPS (driver point + shaft)
// Each builder returns a part whose contact point sits at y = 0 and whose
// top (mount interface for the lower body) sits at y = `length`.
// `length` is the main knob for "how long/visible is the tip".
// ============================================================

import * as THREE from 'three';
import { DEG, atY, boltHead, cylinderUp, extrudeSide, facet, flatTorus, group, lathe, mesh, polygonShape, radial } from '../model/geometry';
import type { PartBuilder } from '../model/types';

/** Wide flat rubber contact disc on a flared metal stem — aggressive, grippy. */
export function flatStriker({ length = 1.15, contactRadius = 0.42, shaftRadius = 0.17 } = {}): PartBuilder {
  return ({ mats }) => {
    const L = length;
    const contact = mesh(lathe([[0, 0], [contactRadius, 0], [contactRadius + 0.02, 0.05], [contactRadius * 0.92, 0.14], [0, 0.14]], 48), mats.rubber);
    const stem = mesh(lathe([[contactRadius * 0.85, 0.13], [shaftRadius * 1.5, 0.34], [shaftRadius, 0.46], [shaftRadius, L - 0.2], [shaftRadius * 1.9, L - 0.12], [shaftRadius * 1.9, L]], 48), mats.metal);
    const collar = atY(flatTorus(shaftRadius + 0.07, 0.05, mats.accent), L * 0.58);
    const nut = atY(mesh(facet(new THREE.CylinderGeometry(shaftRadius * 1.45, shaftRadius * 1.45, 0.14, 6)), mats.darkMetal), L - 0.3);
    return { object: group(contact, stem, collar, nut), height: L };
  };
}

/** Sharp hexagonal faceted spike with an off-axis collar and three angled claws. */
export function hexSpike({ length = 1.35, topRadius = 0.3 } = {}): PartBuilder {
  return ({ mats }) => {
    const L = length;
    const spike = mesh(facet(lathe([[0, 0], [0.09, 0.22], [0.14, 0.5], [0.16, L - 0.25], [topRadius, L - 0.1], [topRadius, L]], 6)), mats.darkMetal);
    const point = mesh(facet(lathe([[0, 0], [0.095, 0.24], [0, 0.24]], 6)), mats.metal);
    // Collar deliberately tilted: controlled asymmetry reads as "directional".
    const collar = flatTorus(0.2, 0.035, mats.accent);
    collar.position.y = L * 0.48;
    collar.rotation.z = 9 * DEG;
    const claw = (): THREE.Object3D => {
      const shape = polygonShape([[0.12, 0], [0.3, 0.28], [0.26, 0.34], [0.1, 0.16]]);
      const m = mesh(extrudeSide(shape, 0.06), mats.paint);
      m.position.y = L * 0.55;
      m.rotation.x = 18 * DEG;
      return m;
    };
    return { object: group(spike, point, collar, radial(3, claw, 10 * DEG)), height: L };
  };
}

/** Robust rubber dome on a thick segmented metal ram with bolted collars. */
export function domeRam({ length = 1.25, radius = 0.4 } = {}): PartBuilder {
  return ({ mats }) => {
    const L = length;
    const dome = mesh(lathe(Array.from({ length: 13 }, (_, i) => {
      const a = (i / 12) * (Math.PI / 2);
      return [Math.sin(a) * radius, radius - Math.cos(a) * radius] as const;
    }), 48), mats.rubber);
    const seat = atY(cylinderUp(radius * 0.95, radius * 1.05, 0.12, mats.darkMetal), radius - 0.02);
    const segA = atY(cylinderUp(0.27, 0.32, 0.26, mats.metal), radius + 0.1);
    const segB = atY(cylinderUp(0.33, 0.27, 0.22, mats.darkMetal), radius + 0.4);
    const top = atY(cylinderUp(0.5, 0.36, L - (radius + 0.64), mats.metal, 8), radius + 0.64);
    const bolts = atY(radial(4, () => {
      const bolt = boltHead(0.06, 0.05, mats.accent);
      bolt.rotation.z = -Math.PI / 2; // hex head faces outward
      bolt.position.x = 0.3;
      return bolt;
    }, 45 * DEG), radius + 0.24);
    return { object: group(dome, seat, segA, segB, top, bolts), height: L };
  };
}

/** Metal ball seated in a cup, with a guard ring held by three struts. */
export function guardedBall({ length = 1.3, ball = 0.3 } = {}): PartBuilder {
  return ({ mats }) => {
    const L = length;
    const sphere = atY(mesh(new THREE.SphereGeometry(ball, 40, 24), mats.metal), ball);
    const cup = atY(mesh(lathe([[ball * 0.9, 0], [ball * 1.12, 0.12], [0.24, 0.42], [0.22, L - ball - 0.3], [0.42, L - ball - 0.1], [0.42, L - ball]], 48), mats.darkMetal), ball);
    const guard = atY(flatTorus(ball + 0.2, 0.045, mats.paintAlt), ball * 1.3);
    const strut = (): THREE.Object3D => {
      const m = mesh(new THREE.BoxGeometry(0.2, 0.05, 0.05), mats.paintAlt);
      m.position.set(ball + 0.1, ball * 1.3 + 0.1, 0);
      m.rotation.z = 35 * DEG;
      return m;
    };
    return { object: group(sphere, cup, guard, radial(3, strut)), height: L };
  };
}

/** Hollow "crown" contact ring (semi-flat) under a wide ribbed cone. */
export function crown({ length = 1.15, crownRadius = 0.36 } = {}): PartBuilder {
  return ({ mats }) => {
    const L = length;
    const tube = 0.075;
    const ring = atY(flatTorus(crownRadius, tube, mats.rubber, 14, 64), tube);
    const recess = atY(cylinderUp(crownRadius - 0.02, crownRadius - 0.02, 0.05, mats.darkPlastic, 48), tube * 1.2);
    const cone = mesh(lathe([[crownRadius + 0.05, tube * 1.6], [crownRadius + 0.02, 0.3], [0.28, 0.6], [0.24, L - 0.18], [0.52, L - 0.08], [0.52, L]], 64), mats.paintAlt);
    const rib = (): THREE.Object3D => {
      const m = mesh(extrudeSide(polygonShape([[0.22, 0.25], [crownRadius + 0.1, 0.18], [0.3, 0.62], [0.22, 0.62]]), 0.05), mats.metal);
      return m;
    };
    return { object: group(ring, recess, cone, radial(6, rib)), height: L };
  };
}

/** Stacked graduated segments separated by dark gaskets, ending in a blunt point. */
export function stacked({ length = 1.45, segments = 4, topRadius = 0.58 } = {}): PartBuilder {
  return ({ mats }) => {
    const L = length;
    const parts: THREE.Object3D[] = [mesh(facet(lathe([[0, 0], [0.13, 0.05], [0.2, 0.26], [0, 0.26]], 8)), mats.metal)];
    let y = 0.26;
    const segH = (L - y) / segments;
    for (let i = 0; i < segments; i++) {
      const r0 = 0.2 + ((topRadius - 0.2) * i) / segments;
      const r1 = 0.2 + ((topRadius - 0.2) * (i + 1)) / segments;
      parts.push(atY(mesh(facet(new THREE.CylinderGeometry(r1, r0, segH * 0.78, 8).translate(0, segH * 0.39, 0)), i % 2 === 0 ? mats.paintAlt : mats.metal), y));
      parts.push(atY(cylinderUp(r1 * 0.88, r1 * 0.88, segH * 0.22, mats.rubber, 8), y + segH * 0.78));
      y += segH;
    }
    return { object: group(...parts), height: L };
  };
}

/** Very thin long needle with a small ring around it near the point. */
export function needle({ length = 1.75 } = {}): PartBuilder {
  return ({ mats }) => {
    const L = length;
    const shaft = mesh(lathe([[0, 0], [0.035, 0.06], [0.06, 0.4], [0.09, L * 0.7], [0.14, L - 0.12], [0.3, L - 0.06], [0.3, L]], 48), mats.metal);
    const ring = atY(flatTorus(0.12, 0.022, mats.accent, 10, 48), 0.36);
    const sleeve = atY(mesh(lathe([[0.15, 0], [0.19, 0.08], [0.19, 0.42], [0.15, 0.5]], 48), mats.translucent), L * 0.52);
    const glowBand = atY(cylinderUp(0.1, 0.1, 0.03, mats.glow, 32), L * 0.72);
    return { object: group(shaft, ring, sleeve, glowBand), height: L };
  };
}

/** Fine point below an exposed ball-bearing race (two rings + visible balls). */
export function bearing({ length = 1.5, balls = 10 } = {}): PartBuilder {
  return ({ mats }) => {
    const L = length;
    const point = mesh(lathe([[0, 0], [0.05, 0.1], [0.1, 0.34], [0.12, 0.42], [0, 0.42]], 48), mats.metal);
    const raceY = 0.52;
    const lowerRace = atY(flatTorus(0.26, 0.035, mats.darkMetal), raceY);
    const upperRace = atY(flatTorus(0.26, 0.035, mats.darkMetal), raceY + 0.14);
    const ballRing = atY(radial(balls, () => new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12), mats.metal).translateX(0.26)), raceY + 0.07);
    const axle = atY(cylinderUp(0.12, 0.12, 0.3, mats.darkMetal, 24), 0.4);
    const shaft = atY(mesh(lathe([[0.12, 0], [0.14, 0.2], [0.14, L - raceY - 0.4], [0.32, L - raceY - 0.26], [0.32, L - raceY - 0.14]], 48), mats.paintAlt), raceY + 0.14);
    const ticks = atY(radial(12, () => mesh(new THREE.BoxGeometry(0.03, 0.12, 0.03), mats.accent).translateX(0.15)), raceY + 0.45);
    return { object: group(point, lowerRace, upperRace, ballRing, axle, shaft, ticks), height: L };
  };
}

/** Long ogive cone with twin collars and a thin glowing seam — slender and refined. */
export function longCone({ length = 2.0, topRadius = 0.34 } = {}): PartBuilder {
  return ({ mats }) => {
    const L = length;
    const profile: Array<[number, number]> = [];
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      // Concave ogive: stays thin for a long way, then flares near the top.
      profile.push([0.02 + topRadius * Math.pow(t, 2.2), t * (L - 0.08)]);
    }
    profile.push([topRadius, L]);
    const cone = mesh(lathe(profile, 64), mats.metal);
    const collarA = atY(flatTorus(0.07, 0.02, mats.accent, 10, 48), L * 0.3);
    const collarB = atY(flatTorus(0.13, 0.024, mats.accent, 10, 48), L * 0.62);
    const seam = atY(cylinderUp(topRadius * 0.62, topRadius * 0.52, 0.025, mats.glow, 48), L * 0.8);
    const vane = (): THREE.Object3D => mesh(extrudeSide(polygonShape([[0.02, L * 0.4], [0.2, L * 0.72], [topRadius * 0.9, L * 0.95], [0.05, L * 0.92]]), 0.035), mats.paint);
    return { object: group(cone, collarA, collarB, seam, radial(3, vane, 60 * DEG)), height: L };
  };
}
