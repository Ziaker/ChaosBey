// ============================================================
// BEY VISUAL CONCEPTS — CORES (center / emblem)
// Mounted on top of the middle layer (local y = 0). Emblems are abstract
// procedural geometry only — no creatures, mascots or lore (GDD 171.2/3).
// ============================================================

import * as THREE from 'three';
import { DEG, annulus, atY, boltHead, cylinderUp, extrudeUp, facet, flatTorus, group, lathe, mesh, polygonShape, radial } from '../model/geometry';
import type { PartBuilder } from '../model/types';

/** Compact bolted collar holding a faceted translucent gem. */
export function gemBolts({ radius = 1.0, height = 0.4, bolts = 6 } = {}): PartBuilder {
  return ({ mats }) => {
    const base = cylinderUp(radius, radius * 1.05, height * 0.55, mats.darkMetal, 48);
    const collar = atY(annulus(radius * 0.45, radius * 0.9, height * 0.2, mats.accent), height * 0.55);
    const boltRing = atY(radial(bolts, () => boltHead(0.08, 0.07, mats.metal).translateX(radius * 0.68)), height * 0.75);
    const gem = atY(mesh(facet(new THREE.OctahedronGeometry(radius * 0.42, 0).scale(1, 0.7, 1)), mats.translucent), height * 0.75);
    const heart = atY(mesh(new THREE.OctahedronGeometry(radius * 0.16, 0), mats.glow), height * 0.75);
    return { object: group(base, collar, boltRing, gem, heart), height: height + radius * 0.3 };
  };
}

/** Faceted 7-sided hub carrying an off-center slanted chevron emblem. */
export function offsetSigil({ radius = 0.85, height = 0.45 } = {}): PartBuilder {
  return ({ mats }) => {
    const hub = mesh(facet(lathe([[0, 0], [radius, 0], [radius * 0.95, height * 0.7], [radius * 0.7, height], [0, height]], 7)), mats.darkMetal);
    const chevron = atY(mesh(extrudeUp(polygonShape([
      [-0.55, -0.35], [0.1, -0.08], [0.55, -0.42], [0.4, 0.05], [0.05, 0.3], [-0.35, 0.02],
    ]), 0.08, 0.015), mats.accent), height - 0.01);
    chevron.rotation.y = 25 * DEG;
    chevron.scale.setScalar(radius * 0.9);
    const slash = atY(mesh(new THREE.BoxGeometry(radius * 0.9, 0.03, 0.06), mats.glow), height + 0.075);
    slash.rotation.y = -35 * DEG;
    const dome = atY(mesh(new THREE.SphereGeometry(0.18, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), mats.translucent), height);
    dome.position.x = radius * 0.45;
    dome.position.z = radius * 0.2;
    return { object: group(hub, chevron, slash, dome), height: height + 0.1 };
  };
}

/** Heavy domed cap ringed with large bolts and a raised square emblem. */
export function boltedCap({ radius = 1.15, height = 0.6, bolts = 8 } = {}): PartBuilder {
  return ({ mats }) => {
    const cap = mesh(lathe([[0, 0], [radius, 0], [radius, height * 0.3], [radius * 0.85, height * 0.75], [radius * 0.5, height], [0, height]], 64), mats.darkMetal);
    const boltRing = atY(radial(bolts, () => boltHead(0.1, 0.08, mats.metal).translateX(radius * 0.82)), height * 0.52);
    const plate = atY(mesh(new THREE.BoxGeometry(radius * 0.8, 0.12, radius * 0.8), mats.accent), height + 0.02);
    plate.rotation.y = 45 * DEG;
    const cross = group(
      atY(mesh(new THREE.BoxGeometry(radius * 0.55, 0.03, 0.06), mats.glow), height + 0.09),
      atY(mesh(new THREE.BoxGeometry(0.06, 0.03, radius * 0.55), mats.glow), height + 0.09),
    );
    return { object: group(cap, boltRing, plate, cross), height: height + 0.1 };
  };
}

/** Wide low steel dome with concentric grooves and a small lens. */
export function shieldDome({ radius = 1.35, height = 0.55 } = {}): PartBuilder {
  return ({ mats }) => {
    const profile: Array<[number, number]> = [];
    for (let i = 0; i <= 16; i++) {
      const a = (i / 16) * (Math.PI / 2);
      profile.push([Math.cos(a) * radius, Math.sin(a) * height]);
    }
    const dome = mesh(lathe(profile, 96), mats.metal);
    const grooves = group(
      atY(flatTorus(radius * 0.86, 0.03, mats.darkMetal), height * 0.5),
      atY(flatTorus(radius * 0.6, 0.03, mats.darkMetal), height * 0.8),
    );
    const lens = atY(mesh(new THREE.SphereGeometry(radius * 0.28, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.6, 1), mats.translucent), height * 0.93);
    const dot = atY(mesh(new THREE.CylinderGeometry(radius * 0.1, radius * 0.1, 0.04, 24), mats.glow), height * 0.97);
    return { object: group(dome, grooves, lens, dot), height: height + 0.1 };
  };
}

/** Hexagonal hub with six small pistons and a translucent hex window. */
export function hexHub({ radius = 0.95, height = 0.5 } = {}): PartBuilder {
  return ({ mats }) => {
    const hub = mesh(facet(new THREE.CylinderGeometry(radius, radius, height, 6).translate(0, height / 2, 0)), mats.paintAlt);
    const pistons = atY(radial(6, () => cylinderUp(0.09, 0.09, 0.14, mats.metal, 16).translateX(radius * 0.66), 30 * DEG), height);
    const window = atY(mesh(facet(new THREE.CylinderGeometry(radius * 0.42, radius * 0.48, 0.1, 6).translate(0, 0.05, 0)), mats.translucent), height);
    const heart = atY(mesh(facet(new THREE.CylinderGeometry(radius * 0.16, radius * 0.16, 0.04, 6)), mats.glow), height + 0.05);
    return { object: group(hub, pistons, window, heart), height: height + 0.14 };
  };
}

/** Tall stepped octagonal tower with metal bands and a crowning gem. */
export function tower({ tiers = 3, baseRadius = 1.3, tierHeight = 0.42, sides = 8 } = {}): PartBuilder {
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
    return { object: group(...parts), height: y + gemR * 2.6 };
  };
}

/** Very small low hub — the center is visually minimal on purpose. */
export function smallPin({ radius = 0.55, height = 0.3 } = {}): PartBuilder {
  return ({ mats }) => {
    const hub = mesh(lathe([[0, 0], [radius, 0], [radius * 0.9, height * 0.6], [radius * 0.4, height], [0, height]], 48), mats.paint);
    const cap = atY(cylinderUp(radius * 0.32, radius * 0.36, 0.08, mats.metal, 32), height - 0.03);
    const dot = atY(cylinderUp(radius * 0.12, radius * 0.12, 0.03, mats.glow, 16), height + 0.05);
    return { object: group(hub, cap, dot), height: height + 0.08 };
  };
}

/** Precision lens: metal bezel with tick marks around a translucent dome. */
export function precisionLens({ radius = 0.7, height = 0.35, ticks = 24 } = {}): PartBuilder {
  return ({ mats }) => {
    const bezel = annulus(radius * 0.62, radius, height * 0.6, mats.metal, 0.02);
    const tickRing = atY(radial(ticks, (i) => mesh(new THREE.BoxGeometry(i % 6 === 0 ? 0.14 : 0.08, 0.02, 0.025), mats.darkMetal).translateX(radius * 0.8)), height * 0.6);
    const lens = atY(mesh(new THREE.SphereGeometry(radius * 0.62, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.55, 1), mats.translucent), height * 0.2);
    const heart = atY(flatTorus(radius * 0.25, 0.02, mats.glow, 8, 48), height * 0.35);
    const needle = atY(mesh(new THREE.BoxGeometry(radius * 0.5, 0.02, 0.03).translate(radius * 0.25, 0, 0), mats.accent), height * 0.36);
    return { object: group(bezel, tickRing, lens, heart, needle), height: height + 0.1 };
  };
}

/** Elegant tall teardrop spire with a thin glowing seam and metal finial. */
export function spire({ radius = 1.1, height = 1.0 } = {}): PartBuilder {
  return ({ mats }) => {
    const profile: Array<[number, number]> = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      profile.push([radius * Math.pow(1 - t, 0.7) * (1 - 0.15 * t), t * height]);
    }
    const body = mesh(lathe(profile, 96), mats.accent);
    const seam = atY(flatTorus(radius * Math.pow(0.55, 0.7) * 0.93, 0.02, mats.glow, 8, 96), height * 0.45);
    const band = atY(flatTorus(radius * 0.96, 0.035, mats.metal, 10, 96), height * 0.06);
    const finial = atY(mesh(lathe([[0.06, 0], [0.1, 0.05], [0.02, 0.28], [0, 0.3]], 32), mats.metal), height - 0.05);
    return { object: group(body, seam, band, finial), height: height + 0.25 };
  };
}
