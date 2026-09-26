// ============================================================
// BEY VISUAL CONCEPTS — PIECE 1: TOP LAYER (raised center + emblem)
// Sits nested in the Ring's center (local y = 0 = ring seat). Clearly
// smaller than the Ring but with real height, so it reads as its own
// piece rising out of the ring (the Defense C tower is the reference).
// Emblems are abstract geometry only — no creatures, mascots or lore.
// ============================================================

import * as THREE from 'three';
import { DEG, annulus, atY, boltHead, cylinderUp, extrudeUp, facet, flatTorus, group, lathe, mesh, polygonShape, radial } from '../model/geometry';
import type { PieceBuilder } from '../model/types';

/** Stepped bolted collar holding a large faceted translucent gem. */
export function gemCrown({ radius = 1.1, height = 0.6, bolts = 6 } = {}): PieceBuilder {
  return ({ mats }) => {
    const base = mesh(lathe([[0, 0], [radius, 0], [radius, height * 0.3], [radius * 0.82, height * 0.45], [0, height * 0.45]], 48), mats.paint);
    const collar = atY(annulus(radius * 0.42, radius * 0.8, height * 0.15, mats.accent), height * 0.45);
    const boltRing = atY(radial(bolts, () => boltHead(0.08, 0.07, mats.metal).translateX(radius * 0.9)), height * 0.3);
    const gem = atY(mesh(facet(new THREE.OctahedronGeometry(radius * 0.45, 0).scale(1, 0.75, 1)), mats.translucent), height * 0.6);
    const heart = atY(mesh(new THREE.OctahedronGeometry(radius * 0.17, 0), mats.glow), height * 0.6);
    return { object: group(base, collar, boltRing, gem, heart), height, bottomRadius: radius, topRadius: radius * 0.4 };
  };
}

/** Faceted 7-sided raised hub carrying an off-center slanted chevron emblem. */
export function sigilHub({ radius = 1.0, height = 0.6 } = {}): PieceBuilder {
  return ({ mats }) => {
    const hub = mesh(facet(lathe([[0, 0], [radius, 0], [radius * 0.96, height * 0.55], [radius * 0.72, height * 0.85], [0, height * 0.85]], 7)), mats.paint);
    const clear = mesh(facet(lathe([[radius * 1.02, 0], [radius * 1.02, height * 0.3], [radius * 0.9, height * 0.4]], 7)), mats.translucent);
    const chevron = atY(mesh(extrudeUp(polygonShape([
      [-0.55, -0.35], [0.1, -0.08], [0.55, -0.42], [0.4, 0.05], [0.05, 0.3], [-0.35, 0.02],
    ]), 0.1, 0.015), mats.accent), height * 0.84);
    chevron.rotation.y = 25 * DEG;
    chevron.scale.setScalar(radius * 0.95);
    const slash = atY(mesh(new THREE.BoxGeometry(radius * 0.9, 0.03, 0.06), mats.glow), height * 0.84 + 0.1);
    slash.rotation.y = -35 * DEG;
    return { object: group(hub, clear, chevron, slash), height, bottomRadius: radius, topRadius: radius * 0.72 };
  };
}

/** Heavy dark dome ringed with large bolts and a raised square emblem. */
export function boltedDome({ radius = 1.15, height = 0.7, bolts = 8 } = {}): PieceBuilder {
  return ({ mats }) => {
    const cap = mesh(lathe([[0, 0], [radius, 0], [radius, height * 0.3], [radius * 0.85, height * 0.7], [radius * 0.5, height * 0.88], [0, height * 0.88]], 64), mats.darkMetal);
    const boltRing = atY(radial(bolts, () => boltHead(0.1, 0.08, mats.metal).translateX(radius * 0.82)), height * 0.48);
    const plate = atY(mesh(new THREE.BoxGeometry(radius * 0.8, 0.12, radius * 0.8), mats.accent), height * 0.9);
    plate.rotation.y = 45 * DEG;
    const cross = group(
      atY(mesh(new THREE.BoxGeometry(radius * 0.55, 0.03, 0.06), mats.glow), height * 0.97),
      atY(mesh(new THREE.BoxGeometry(0.06, 0.03, radius * 0.55), mats.glow), height * 0.97),
    );
    return { object: group(cap, boltRing, plate, cross), height, bottomRadius: radius, topRadius: radius * 0.5 };
  };
}

/** Wide steel dome with concentric grooves and a small lens. */
export function shieldDome({ radius = 1.35, height = 0.6 } = {}): PieceBuilder {
  return ({ mats }) => {
    const collar = cylinderUp(radius, radius, height * 0.2, mats.paint, 96);
    const profile: Array<[number, number]> = [];
    for (let i = 0; i <= 16; i++) {
      const a = (i / 16) * (Math.PI / 2);
      profile.push([Math.cos(a) * radius * 0.92, height * 0.2 + Math.sin(a) * height * 0.7]);
    }
    const dome = mesh(lathe(profile, 96), mats.metal);
    const grooves = group(
      atY(flatTorus(radius * 0.8, 0.03, mats.darkMetal), height * 0.52),
      atY(flatTorus(radius * 0.55, 0.03, mats.darkMetal), height * 0.76),
    );
    const lens = atY(mesh(new THREE.SphereGeometry(radius * 0.26, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.6, 1), mats.translucent), height * 0.86);
    const dot = atY(mesh(new THREE.CylinderGeometry(radius * 0.09, radius * 0.09, 0.04, 24), mats.glow), height * 0.9);
    return { object: group(collar, dome, grooves, lens, dot), height, bottomRadius: radius, topRadius: radius * 0.3 };
  };
}

/** Raised hexagonal hub with six small pistons and a translucent hex window. */
export function hexHub({ radius = 1.05, height = 0.6 } = {}): PieceBuilder {
  return ({ mats }) => {
    const h = height * 0.78;
    const hub = mesh(facet(new THREE.CylinderGeometry(radius * 0.9, radius, h, 6).translate(0, h / 2, 0)), mats.paintAlt);
    const pistons = atY(radial(6, () => cylinderUp(0.09, 0.09, 0.14, mats.metal, 16).translateX(radius * 0.6), 30 * DEG), h);
    const window = atY(mesh(facet(new THREE.CylinderGeometry(radius * 0.38, radius * 0.44, 0.12, 6).translate(0, 0.06, 0)), mats.translucent), h);
    const heart = atY(mesh(facet(new THREE.CylinderGeometry(radius * 0.15, radius * 0.15, 0.04, 6)), mats.glow), h + 0.07);
    return { object: group(hub, pistons, window, heart), height, bottomRadius: radius, topRadius: radius * 0.45 };
  };
}

/** Tall stepped octagonal tower with metal bands and a crowning gem (Defense C reference). */
export function tower({ tiers = 3, baseRadius = 1.3, tierHeight = 0.42, sides = 8 } = {}): PieceBuilder {
  return ({ mats }) => {
    const parts: THREE.Object3D[] = [];
    let y = 0;
    for (let i = 0; i < tiers; i++) {
      const r = baseRadius * (1 - i * 0.24);
      const tier = mesh(facet(new THREE.CylinderGeometry(r * 0.92, r, tierHeight, sides).translate(0, tierHeight / 2, 0)), i % 2 === 0 ? mats.paint : mats.darkMetal);
      tier.rotation.y = Math.PI / sides;
      parts.push(atY(tier, y));
      parts.push(atY(flatTorus(r * 0.95, 0.035, mats.metal, 8, sides), y + tierHeight));
      y += tierHeight;
    }
    const gemR = baseRadius * 0.22;
    parts.push(atY(mesh(facet(new THREE.OctahedronGeometry(gemR, 0).scale(1, 1.4, 1)), mats.translucent), y + gemR * 1.2));
    parts.push(atY(mesh(new THREE.OctahedronGeometry(gemR * 0.4, 0), mats.glow), y + gemR * 1.2));
    return { object: group(...parts), height: y + gemR * 2.6, bottomRadius: baseRadius, topRadius: gemR };
  };
}

/** Deliberately small low center — the Stamina A "mass at the rim" idea. */
export function smallCap({ radius = 0.8, height = 0.45 } = {}): PieceBuilder {
  return ({ mats }) => {
    const hub = mesh(lathe([[0, 0], [radius, 0], [radius * 0.95, height * 0.45], [radius * 0.45, height * 0.8], [0, height * 0.8]], 48), mats.paint);
    const clear = atY(flatTorus(radius * 0.8, 0.05, mats.translucent, 12, 64), height * 0.4);
    const cap = atY(cylinderUp(radius * 0.3, radius * 0.34, 0.1, mats.metal, 32), height * 0.75);
    const dot = atY(cylinderUp(radius * 0.1, radius * 0.1, 0.03, mats.glow, 16), height * 0.85);
    return { object: group(hub, clear, cap, dot), height, bottomRadius: radius, topRadius: radius * 0.3 };
  };
}

/** Precision lens: raised metal bezel with tick marks around a translucent dome. */
export function precisionLens({ radius = 0.95, height = 0.55, ticks = 24 } = {}): PieceBuilder {
  return ({ mats }) => {
    const bezel = mesh(lathe([[radius * 0.62, 0], [radius, 0], [radius, height * 0.5], [radius * 0.62, height * 0.55]], 64), mats.metal);
    const tickRing = atY(radial(ticks, (i) => mesh(new THREE.BoxGeometry(i % 6 === 0 ? 0.14 : 0.08, 0.02, 0.025), mats.darkMetal).translateX(radius * 0.8)), height * 0.53);
    const lens = atY(mesh(new THREE.SphereGeometry(radius * 0.62, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.75, 1), mats.translucent), height * 0.2);
    const heart = atY(flatTorus(radius * 0.25, 0.02, mats.glow, 8, 48), height * 0.45);
    const needle = atY(mesh(new THREE.BoxGeometry(radius * 0.5, 0.02, 0.03).translate(radius * 0.25, 0, 0), mats.accent), height * 0.46);
    return { object: group(bezel, tickRing, lens, heart, needle), height, bottomRadius: radius, topRadius: radius * 0.4 };
  };
}

/** Elegant tall teardrop spire with a thin glowing seam and metal finial. */
export function spire({ radius = 1.2, height = 1.0 } = {}): PieceBuilder {
  return ({ mats }) => {
    const profile: Array<[number, number]> = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      profile.push([radius * Math.pow(1 - t, 0.7) * (1 - 0.15 * t), t * height * 0.8]);
    }
    const body = mesh(lathe(profile, 96), mats.accent);
    const seam = atY(flatTorus(radius * Math.pow(0.55, 0.7) * 0.93, 0.02, mats.glow, 8, 96), height * 0.36);
    const band = atY(flatTorus(radius * 0.96, 0.035, mats.metal, 10, 96), height * 0.05);
    const finial = atY(mesh(lathe([[0.06, 0], [0.1, 0.05], [0.02, 0.26], [0, 0.28]], 32), mats.metal), height * 0.76);
    return { object: group(body, seam, band, finial), height, bottomRadius: radius, topRadius: 0.05 };
  };
}
