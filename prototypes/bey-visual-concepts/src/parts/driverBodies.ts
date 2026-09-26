// ============================================================
// BEY VISUAL CONCEPTS — PIECE 4a: DRIVER BODY (housing above the tip)
// Together with the tip it forms the Driver. Local y = 0 at the tip seam
// (radius `bottomRadius`, should match the tip's topRadius); top seam at
// `height` with radius `topRadius`, which must be SMALLER than the disc so
// the disc stays visible as its own piece.
// ============================================================

import * as THREE from 'three';
import { DEG, annulus, atY, boltHead, cylinderUp, extrudeSide, facet, flatTorus, group, lathe, mesh, polygonShape, radial } from '../model/geometry';
import type { PieceBuilder } from '../model/types';

/** Concave flare with triangular gussets. */
export function flared({ height = 0.7, bottomRadius = 0.6, topRadius = 1.35, ribs = 8 } = {}): PieceBuilder {
  return ({ mats }) => {
    const h = height;
    const profile: Array<[number, number]> = [[0, 0], [bottomRadius, 0]];
    for (let i = 1; i <= 12; i++) {
      const t = i / 12;
      profile.push([bottomRadius + (topRadius - bottomRadius) * Math.pow(t, 2.2), h * t]);
    }
    profile.push([0, h]);
    const shell = mesh(lathe(profile, 72), mats.darkMetal);
    const gusset = (): THREE.Object3D =>
      mesh(extrudeSide(polygonShape([[bottomRadius * 0.95, 0.03], [topRadius * 0.96, h * 0.92], [topRadius * 0.6, h * 0.92]]), 0.08), mats.paintAlt);
    const lip = atY(flatTorus(topRadius - 0.05, 0.05, mats.accent), h - 0.06);
    return { object: group(shell, radial(ribs, gusset, 22.5 * DEG), lip), height: h, bottomRadius, topRadius };
  };
}

/** Low-segment faceted cone with leaning strakes — angular, directional. */
export function faceted({ height = 0.85, bottomRadius = 0.56, topRadius = 1.2, facets = 7 } = {}): PieceBuilder {
  return ({ mats }) => {
    const h = height;
    const shell = mesh(facet(lathe([[0, 0], [bottomRadius, 0], [bottomRadius * 1.25, h * 0.4], [topRadius * 0.9, h * 0.82], [topRadius, h], [0, h]], facets)), mats.paintAlt);
    const strake = (): THREE.Object3D => {
      const m = mesh(extrudeSide(polygonShape([[bottomRadius * 1.0, h * 0.1], [topRadius * 1.0, h * 0.88], [topRadius * 0.86, h * 0.98], [bottomRadius * 1.08, h * 0.32]]), 0.07), mats.paint);
      m.rotation.x = 26 * DEG;
      return m;
    };
    const vent = atY(mesh(facet(lathe([[bottomRadius * 1.12, 0], [topRadius * 0.82, h * 0.42]], facets)), mats.translucent), h * 0.3);
    return { object: group(shell, vent, radial(3, strake, 15 * DEG)), height: h, bottomRadius, topRadius };
  };
}

/** Short cone into a heavy drum wrapped by a bolt ring. */
export function drum({ height = 0.75, bottomRadius = 0.68, topRadius = 1.3, bolts = 8 } = {}): PieceBuilder {
  return ({ mats }) => {
    const h = height;
    const coneH = h * 0.45;
    const cone = mesh(lathe([[0, 0], [bottomRadius, 0], [topRadius * 0.97, coneH], [0, coneH]], 64), mats.darkMetal);
    const body = atY(cylinderUp(topRadius, topRadius, h - coneH, mats.paintAlt, 64), coneH);
    const band = atY(cylinderUp(topRadius + 0.03, topRadius + 0.03, 0.1, mats.metal, 64), coneH + 0.05);
    const boltRing = atY(radial(bolts, () => {
      const b = boltHead(0.075, 0.06, mats.metal);
      b.rotation.z = -Math.PI / 2;
      b.position.x = topRadius;
      return b;
    }), coneH + (h - coneH) * 0.62);
    return { object: group(cone, body, band, boltRing), height: h, bottomRadius, topRadius };
  };
}

/** Smooth convex bowl with a metal band and vents — calm and heavy. */
export function bowl({ height = 0.8, bottomRadius = 0.6, topRadius = 1.6 } = {}): PieceBuilder {
  return ({ mats }) => {
    const h = height;
    const profile: Array<[number, number]> = [[0, 0], [bottomRadius, 0]];
    for (let i = 1; i <= 16; i++) {
      const a = (i / 16) * (Math.PI / 2);
      profile.push([bottomRadius + (topRadius - bottomRadius) * Math.sin(a), h * (1 - Math.cos(a))]);
    }
    profile.push([0, h]);
    const shell = mesh(lathe(profile, 96), mats.paintAlt);
    const band = atY(flatTorus(bottomRadius + (topRadius - bottomRadius) * 0.72, 0.055, mats.metal), h * 0.3);
    const vents = atY(radial(12, () => mesh(new THREE.BoxGeometry(0.22, 0.05, 0.09), mats.darkPlastic).translateX(topRadius * 0.95)), h * 0.72);
    return { object: group(shell, band, vents), height: h, bottomRadius, topRadius };
  };
}

/** Cone with a thick rubber bumper band and coil-spring absorbers above it. */
export function sprungSkirt({ height = 0.9, bottomRadius = 0.64, bandRadius = 1.4, topRadius = 1.25, absorbers = 6 } = {}): PieceBuilder {
  return ({ mats }) => {
    const h = height;
    const bandY = h * 0.38;
    const cone = mesh(lathe([[0, 0], [bottomRadius, 0], [bandRadius * 0.9, bandY], [topRadius * 0.92, h], [0, h]], 64), mats.paintAlt);
    const band = atY(mesh(lathe([[bandRadius * 0.85, 0], [bandRadius, 0.05], [bandRadius + 0.04, 0.14], [bandRadius, 0.23], [bandRadius * 0.85, 0.28]], 96), mats.rubber), bandY - 0.14);
    const absorber = (): THREE.Object3D => {
      const x = (bandRadius + topRadius) / 2 - 0.12;
      const rod = atY(cylinderUp(0.05, 0.05, h - bandY - 0.1, mats.metal, 16), bandY + 0.1);
      rod.position.x = x;
      const coils = group(...Array.from({ length: 4 }, (_, k) => atY(flatTorus(0.1, 0.022, mats.accent, 8, 24), bandY + 0.2 + k * 0.08)));
      coils.position.x = x;
      return group(rod, coils);
    };
    return { object: group(cone, band, radial(absorbers, absorber, 30 * DEG)), height: h, bottomRadius, topRadius };
  };
}

/** Octagonal stepped tiers — a stacked foundation (the Defense C reference). */
export function stepped({ height = 0.95, bottomRadius = 0.62, topRadius = 1.4, steps = 3, sides = 8 } = {}): PieceBuilder {
  return ({ mats }) => {
    const h = height;
    const parts: THREE.Object3D[] = [];
    const stepH = h / steps;
    for (let i = 0; i < steps; i++) {
      const r0 = bottomRadius + ((topRadius - bottomRadius) * i) / steps;
      const r1 = bottomRadius + ((topRadius - bottomRadius) * (i + 1)) / steps;
      const tier = mesh(facet(new THREE.CylinderGeometry(r1, r0 * 1.02, stepH * 0.82, sides).translate(0, stepH * 0.41, 0)), i === steps - 1 ? mats.paint : mats.darkMetal);
      tier.rotation.y = Math.PI / sides;
      parts.push(atY(tier, i * stepH));
      parts.push(atY(cylinderUp(r1 * 0.94, r1 * 0.94, stepH * 0.18, mats.metal, sides), i * stepH + stepH * 0.82));
    }
    return { object: group(...parts), height: h, bottomRadius, topRadius };
  };
}

/** Slim waisted housing with thin rings — minimal mass low down. */
export function waisted({ height = 0.9, bottomRadius = 0.48, waist = 0.42, topRadius = 1.1 } = {}): PieceBuilder {
  return ({ mats }) => {
    const h = height;
    const shell = mesh(lathe([[0, 0], [bottomRadius, 0], [waist, h * 0.35], [waist * 1.1, h * 0.55], [topRadius * 0.8, h * 0.85], [topRadius, h], [0, h]], 64), mats.paintAlt);
    const ring = atY(flatTorus(waist + 0.06, 0.03, mats.metal, 10, 48), h * 0.42);
    const lip = atY(flatTorus(topRadius * 0.86, 0.03, mats.accent, 10, 64), h * 0.9);
    return { object: group(shell, ring, lip), height: h, bottomRadius, topRadius };
  };
}

/** Open cage: slanted struts between a bottom collar and top plate, exposing an inner core. */
export function cage({ height = 1.0, bottomRadius = 0.52, topRadius = 1.15, struts = 6 } = {}): PieceBuilder {
  return ({ mats }) => {
    const h = height;
    const collar = cylinderUp(bottomRadius, bottomRadius * 0.95, 0.16, mats.darkMetal, 32);
    const inner = atY(cylinderUp(0.26, 0.26, h - 0.2, mats.translucent, 24), 0.12);
    const innerGlow = atY(cylinderUp(0.09, 0.09, h - 0.3, mats.glow, 12), 0.16);
    const plate = atY(annulus(0.2, topRadius, 0.1, mats.metal), h - 0.1);
    const midRing = atY(flatTorus((bottomRadius + topRadius) / 2, 0.035, mats.metal, 10, 64), h * 0.55);
    const strut = (): THREE.Object3D => {
      const len = Math.hypot(topRadius - bottomRadius, h);
      const bar = mesh(new THREE.BoxGeometry(0.08, len, 0.08), mats.paintAlt);
      bar.position.set((topRadius + bottomRadius) / 2 - 0.05, h / 2, 0);
      bar.rotation.z = -Math.atan2(topRadius - bottomRadius, h);
      return bar;
    };
    return { object: group(collar, inner, innerGlow, plate, midRing, radial(struts, strut)), height: h, bottomRadius, topRadius };
  };
}

/** Tall ogive fairing with long swept fins. */
export function finnedFairing({ height = 1.3, bottomRadius = 0.55, topRadius = 1.35, fins = 3, finReach = 0.45 } = {}): PieceBuilder {
  return ({ mats }) => {
    const h = height;
    const radiusAt = (t: number): number => bottomRadius + (topRadius - bottomRadius) * Math.pow(t, 1.6);
    const profile: Array<[number, number]> = [[0, 0]];
    for (let i = 0; i <= 20; i++) profile.push([radiusAt(i / 20), (i / 20) * h]);
    profile.push([0, h]);
    const shell = mesh(lathe(profile, 96), mats.paint);
    const fin = (): THREE.Object3D => {
      const pts: Array<[number, number]> = [];
      for (let i = 0; i <= 10; i++) {
        const t = 0.05 + (i / 10) * 0.9;
        pts.push([radiusAt(t) + finReach * Math.sin(Math.PI * Math.pow(t, 0.8)) * (0.4 + 0.6 * t), t * h]);
      }
      for (let i = 10; i >= 0; i--) {
        const t = 0.05 + (i / 10) * 0.9;
        pts.push([radiusAt(t) * 0.85, t * h]);
      }
      const m = mesh(extrudeSide(polygonShape(pts), 0.08), mats.accent);
      m.rotation.x = 24 * DEG;
      return m;
    };
    const seam = atY(flatTorus(radiusAt(0.55) + 0.01, 0.022, mats.glow, 8, 96), h * 0.55);
    const band = atY(flatTorus(radiusAt(0.25) + 0.02, 0.035, mats.metal, 10, 64), h * 0.25);
    return { object: group(shell, radial(fins, fin), seam, band), height: h, bottomRadius, topRadius };
  };
}
