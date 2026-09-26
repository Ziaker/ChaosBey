// ============================================================
// BEY VISUAL CONCEPTS — PIECE 4: TIP (driver)
// Contact point at y = 0, top seam at y = `height` with radius `topRadius`
// (should match the lower body's bottom radius). Each driver has a real
// housing that converges to its contact point, not a bare stick.
// ============================================================

import * as THREE from 'three';
import { DEG, atY, boltHead, cylinderUp, extrudeSide, facet, flatTorus, group, lathe, mesh, polygonShape, radial } from '../model/geometry';
import type { PieceBuilder } from '../model/types';

/** Concave housing flaring down to a wide flat rubber contact disc — grippy, aggressive. */
export function flatStriker({ topRadius = 0.62, height = 1.05, contactRadius = 0.38 } = {}): PieceBuilder {
  return ({ mats }) => {
    const h = height;
    const housing = mesh(lathe([[0, h * 0.3], [0.2, h * 0.3], [0.24, h * 0.45], [topRadius * 0.62, h * 0.72], [topRadius, h], [0, h]], 48), mats.darkMetal);
    const shaft = atY(cylinderUp(0.19, 0.24, h * 0.2, mats.metal, 32), h * 0.12);
    const contact = mesh(lathe([[0, 0], [contactRadius, 0], [contactRadius + 0.02, 0.05], [contactRadius * 0.8, 0.14], [0.2, 0.16], [0, 0.16]], 48), mats.rubber);
    const collar = atY(flatTorus(0.26, 0.045, mats.accent, 12, 48), h * 0.36);
    const gusset = (): THREE.Object3D => mesh(extrudeSide(polygonShape([[0.22, h * 0.34], [topRadius * 0.9, h * 0.92], [topRadius * 0.55, h * 0.92]]), 0.06), mats.metal);
    return { object: group(housing, shaft, contact, collar, radial(4, gusset, 45 * DEG)), height: h, topRadius, bottomRadius: contactRadius };
  };
}

/** Faceted hexagonal spike converging to a sharp point, with an off-axis collar and claws. */
export function hexSpike({ topRadius = 0.58, height = 1.25 } = {}): PieceBuilder {
  return ({ mats }) => {
    const h = height;
    const body = mesh(facet(lathe([[0, 0], [0.07, 0.12], [0.14, h * 0.35], [0.3, h * 0.62], [topRadius, h], [0, h]], 6)), mats.darkMetal);
    const point = mesh(facet(lathe([[0, 0], [0.085, 0.2], [0, 0.2]], 6)), mats.metal);
    const collar = flatTorus(0.26, 0.035, mats.accent, 10, 48);
    collar.position.y = h * 0.5;
    collar.rotation.z = 10 * DEG; // tilted on purpose: controlled asymmetry
    const claw = (): THREE.Object3D => {
      const m = mesh(extrudeSide(polygonShape([[0.18, h * 0.42], [0.42, h * 0.7], [0.36, h * 0.78], [0.2, h * 0.6]]), 0.06), mats.paint);
      m.rotation.x = 20 * DEG;
      return m;
    };
    return { object: group(body, point, collar, radial(3, claw, 10 * DEG)), height: h, topRadius, bottomRadius: 0.05 };
  };
}

/** Heavy segmented ram ending in a big rubber dome. */
export function domeRam({ topRadius = 0.7, height = 1.1, domeRadius = 0.42 } = {}): PieceBuilder {
  return ({ mats }) => {
    const h = height;
    const dome = mesh(lathe(Array.from({ length: 13 }, (_, i) => {
      const a = (i / 12) * (Math.PI / 2);
      return [Math.sin(a) * domeRadius, domeRadius - Math.cos(a) * domeRadius] as const;
    }), 48), mats.rubber);
    const seat = atY(cylinderUp(domeRadius * 1.02, domeRadius * 1.08, 0.12, mats.metal, 48), domeRadius - 0.04);
    const housing = atY(mesh(lathe([[0, 0], [domeRadius * 0.95, 0], [domeRadius * 1.05, 0.14], [topRadius * 0.8, (h - domeRadius) * 0.7], [topRadius, h - domeRadius - 0.08], [0, h - domeRadius - 0.08]], 8), mats.darkMetal), domeRadius + 0.08);
    const bolts = atY(radial(4, () => {
      const b = boltHead(0.07, 0.05, mats.accent);
      b.rotation.z = -Math.PI / 2;
      b.position.x = topRadius * 0.72;
      return b;
    }, 22.5 * DEG), domeRadius + (h - domeRadius) * 0.5);
    return { object: group(dome, seat, housing, bolts), height: h, topRadius, bottomRadius: domeRadius };
  };
}

/** Housing converging to a cup that holds a metal ball, with a guard ring. */
export function guardedBall({ topRadius = 0.62, height = 1.15, ball = 0.26 } = {}): PieceBuilder {
  return ({ mats }) => {
    const h = height;
    const sphere = atY(mesh(new THREE.SphereGeometry(ball, 40, 24), mats.metal), ball);
    const housing = mesh(lathe([[ball * 0.85, ball * 1.1], [ball * 1.15, ball * 1.35], [0.3, h * 0.55], [topRadius * 0.85, h * 0.85], [topRadius, h], [0, h]], 64), mats.paintAlt);
    const guard = atY(flatTorus(ball + 0.2, 0.045, mats.metal, 12, 48), ball * 1.45);
    const strut = (): THREE.Object3D => {
      const m = mesh(new THREE.BoxGeometry(0.22, 0.05, 0.05), mats.metal);
      m.position.set(ball + 0.12, ball * 1.45 + 0.08, 0);
      m.rotation.z = 35 * DEG;
      return m;
    };
    const band = atY(flatTorus(topRadius * 0.78, 0.035, mats.accent, 10, 64), h * 0.78);
    return { object: group(sphere, housing, guard, radial(3, strut), band), height: h, topRadius, bottomRadius: ball };
  };
}

/** Wide ribbed cone ending in a hollow "crown" contact ring. */
export function crown({ topRadius = 0.66, height = 1.0, crownRadius = 0.34 } = {}): PieceBuilder {
  return ({ mats }) => {
    const h = height;
    const tube = 0.075;
    const ring = atY(flatTorus(crownRadius, tube, mats.rubber, 14, 64), tube);
    const recess = atY(cylinderUp(crownRadius - 0.04, crownRadius - 0.04, 0.05, mats.darkPlastic, 48), tube * 1.3);
    const cone = mesh(lathe([[crownRadius + 0.05, tube * 1.6], [crownRadius + 0.02, h * 0.3], [0.32, h * 0.55], [topRadius, h], [0, h]], 64), mats.paintAlt);
    const rib = (): THREE.Object3D => mesh(extrudeSide(polygonShape([[0.25, h * 0.3], [crownRadius + 0.12, h * 0.2], [topRadius * 0.95, h * 0.9], [topRadius * 0.7, h * 0.9]]), 0.06), mats.metal);
    return { object: group(ring, recess, cone, radial(6, rib)), height: h, topRadius, bottomRadius: crownRadius };
  };
}

/** Stacked graduated octagonal segments separated by dark gaskets, ending in a blunt point. */
export function stacked({ topRadius = 0.7, height = 1.3, segments = 4 } = {}): PieceBuilder {
  return ({ mats }) => {
    const h = height;
    const parts: THREE.Object3D[] = [mesh(facet(lathe([[0, 0], [0.12, 0.05], [0.2, 0.24], [0, 0.24]], 8)), mats.metal)];
    let y = 0.24;
    const segH = (h - y) / segments;
    for (let i = 0; i < segments; i++) {
      const r0 = 0.2 + ((topRadius - 0.2) * i) / segments;
      const r1 = 0.2 + ((topRadius - 0.2) * (i + 1)) / segments;
      parts.push(atY(mesh(facet(new THREE.CylinderGeometry(r1, r0, segH * 0.78, 8).translate(0, segH * 0.39, 0)), i % 2 === 0 ? mats.paintAlt : mats.metal), y));
      parts.push(atY(cylinderUp(r1 * 0.88, r1 * 0.88, segH * 0.22, mats.rubber, 8), y + segH * 0.78));
      y += segH;
    }
    return { object: group(...parts), height: h, topRadius, bottomRadius: 0.12 };
  };
}

/** Long concave housing narrowing to a fine needle with a small ring near the point. */
export function needle({ topRadius = 0.5, height = 1.4 } = {}): PieceBuilder {
  return ({ mats }) => {
    const h = height;
    const profile: Array<[number, number]> = [[0, 0], [0.03, 0.05]];
    for (let i = 1; i <= 16; i++) {
      const t = i / 16;
      profile.push([0.05 + (topRadius - 0.05) * Math.pow(t, 2.6), t * h]);
    }
    profile.push([0, h]);
    const body = mesh(lathe(profile, 48), mats.metal);
    const ring = atY(flatTorus(0.12, 0.022, mats.accent, 10, 48), 0.3);
    const sleeve = atY(mesh(lathe([[0.2, 0], [0.24, 0.06], [0.28, 0.28], [0.26, 0.34]], 48), mats.translucent), h * 0.6);
    const glowBand = atY(cylinderUp(0.13, 0.13, 0.025, mats.glow, 32), h * 0.5);
    return { object: group(body, ring, sleeve, glowBand), height: h, topRadius, bottomRadius: 0.03 };
  };
}

/** Housing with an exposed ball-bearing race above a fine point. */
export function bearing({ topRadius = 0.55, height = 1.3, balls = 10 } = {}): PieceBuilder {
  return ({ mats }) => {
    const h = height;
    const point = mesh(lathe([[0, 0], [0.05, 0.1], [0.11, 0.32], [0.13, 0.4], [0, 0.4]], 48), mats.metal);
    const raceY = 0.5;
    const lowerRace = atY(flatTorus(0.27, 0.035, mats.darkMetal), raceY);
    const upperRace = atY(flatTorus(0.27, 0.035, mats.darkMetal), raceY + 0.14);
    const ballRing = atY(radial(balls, () => new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12), mats.metal).translateX(0.27)), raceY + 0.07);
    const axle = atY(cylinderUp(0.13, 0.13, 0.3, mats.darkMetal, 24), 0.38);
    const housing = atY(mesh(lathe([[0.14, 0], [0.3, 0.1], [0.34, (h - raceY) * 0.45], [topRadius, h - raceY - 0.14], [0, h - raceY - 0.14]], 48), mats.paintAlt), raceY + 0.14);
    const ticks = atY(radial(12, () => mesh(new THREE.BoxGeometry(0.03, 0.14, 0.03), mats.accent).translateX(0.345)), raceY + 0.3);
    return { object: group(point, lowerRace, upperRace, ballRing, axle, housing, ticks), height: h, topRadius, bottomRadius: 0.05 };
  };
}

/** Long ogive cone with twin collars, a thin glowing seam and three small vanes. */
export function longOgive({ topRadius = 0.6, height = 1.6 } = {}): PieceBuilder {
  return ({ mats }) => {
    const h = height;
    const profile: Array<[number, number]> = [];
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      profile.push([0.02 + (topRadius - 0.02) * Math.pow(t, 2.0), t * h]);
    }
    profile.push([0, h]);
    const cone = mesh(lathe(profile, 64), mats.metal);
    const collarA = atY(flatTorus(0.06, 0.02, mats.accent, 10, 48), h * 0.22);
    const collarB = atY(flatTorus(0.16, 0.024, mats.accent, 10, 48), h * 0.55);
    const seam = atY(cylinderUp(topRadius * 0.62, topRadius * 0.58, 0.025, mats.glow, 48), h * 0.78);
    const vane = (): THREE.Object3D => mesh(extrudeSide(polygonShape([[0.05, h * 0.42], [0.28, h * 0.72], [topRadius * 0.95, h * 0.97], [0.12, h * 0.9]]), 0.035), mats.paint);
    return { object: group(cone, collarA, collarB, seam, radial(3, vane, 60 * DEG)), height: h, topRadius, bottomRadius: 0.02 };
  };
}
