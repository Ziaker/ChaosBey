// ============================================================
// BEY VISUAL CONCEPTS — PIECE 2: RING (widest piece)
// Sits on top of the Disc (local y = 0 = disc seam). It is the widest
// piece and defines most of the top-view silhouette, so each variant is
// structurally different (element count, symmetry, openness, thickness).
// Every ring has an inner floor at `seatY` where the Top Layer sits,
// nested inside the ring like the Defense C reference.
//
// Spin direction for "leading edge" purposes: counter-clockwise seen from
// above (increasing angle), same as the presentation turntable.
// ============================================================

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import {
  DEG, TAU, annularSector, annulus, atY, cylinderUp, extrudeUp, flatTorus, group, mesh, polarPath, polarShape, polygonShape,
  radial, radialBar, repeatPhase, roundedRectShape, smoothstep,
} from '../model/geometry';
import type { MaterialKit, PieceBuilder } from '../model/types';

/** Solid floor filling the ring's center up to the seat height. */
function ringFloor(radius: number, seatY: number, mats: MaterialKit): THREE.Object3D {
  return cylinderUp(radius, radius, seatY, mats.darkPlastic, 64);
}

/** 3–4 big ramped impact lobes, each ending in a steep metal-faced leading edge. */
export function impactLobes({ baseRadius = 2.1, innerRadius = 1.15, lobes = 4, reach = 0.8, height = 0.45 } = {}): PieceBuilder {
  return ({ mats }) => {
    const radiusAt = (t: number): number => {
      const u = repeatPhase(t, lobes);
      if (u < 0.06) return baseRadius;
      if (u < 0.47) return baseRadius + reach * (0.2 + 0.8 * Math.pow((u - 0.06) / 0.41, 1.5));
      if (u < 0.5) return baseRadius + reach * (1 - (u - 0.47) / 0.03);
      return baseRadius - 0.1 * Math.sin((Math.PI * (u - 0.5)) / 0.5);
    };
    const under = annulus(innerRadius, baseRadius - 0.05, height * 0.3, mats.paintAlt);
    const body = atY(mesh(extrudeUp(polarShape(radiusAt, lobes * 200, innerRadius), height * 0.75, 0.04), mats.paint), height * 0.25);
    const inlay = atY(flatTorus(baseRadius - 0.3, 0.035, mats.accent), height);
    const plate = (): THREE.Object3D => {
      const len = reach * 0.9 + 0.15;
      const m = mesh(new RoundedBoxGeometry(len, height * 0.95, 0.16, 2, 0.03), mats.metal);
      m.position.set(baseRadius - 0.1 + len / 2, height * 0.55, 0);
      return m;
    };
    const seatY = height * 0.45;
    return {
      object: group(under, body, inlay, ringFloor(innerRadius, seatY, mats), radial(lobes, plate, (0.46 / lobes) * TAU)),
      height, bottomRadius: baseRadius, topRadius: baseRadius, seatY,
    };
  };
}

export interface SweptBladeSpec {
  /** Angle (degrees) of the blade's trailing end. */
  at: number;
  /** Angular span (degrees). */
  span: number;
  /** How far the blade tip projects past the hub radius. */
  reach: number;
}

/** Asymmetric swept blades of unequal size, pitched like propeller blades, on a solid hub ring. */
export function sweptBlades({
  hubRadius = 1.6,
  innerRadius = 1.0,
  height = 0.42,
  pitchDeg = 12,
  sweepDeg = 14,
  blades = [
    { at: 0, span: 150, reach: 1.3 },
    { at: 170, span: 85, reach: 0.8 },
    { at: 268, span: 70, reach: 0.62 },
  ] as SweptBladeSpec[],
} = {}): PieceBuilder {
  return ({ mats }) => {
    const innerR = hubRadius - 0.3;
    const bladeShape = (spanRad: number, reach: number, t0: number, extra: number): THREE.Shape => {
      const pts: Array<[number, number]> = [];
      const sweep = sweepDeg * DEG;
      for (let i = 0; i <= 40; i++) {
        const t = t0 + ((1 - t0) * i) / 40;
        const a = -spanRad / 2 + spanRad * t + sweep * Math.pow(t, 3);
        const r = hubRadius + extra + reach * Math.pow(t, 1.25);
        pts.push([Math.cos(a) * r, Math.sin(a) * r]);
      }
      for (let i = 40; i >= 0; i--) {
        const t = t0 + ((1 - t0) * i) / 40;
        const a = -spanRad / 2 + spanRad * t;
        pts.push([Math.cos(a) * innerR, Math.sin(a) * innerR]);
      }
      return polygonShape(pts);
    };
    const bladeH = height * 0.7;
    const bladeObjects = blades.map((spec, index) => {
      const span = spec.span * DEG;
      const body = mesh(extrudeUp(bladeShape(span, spec.reach, 0, 0), bladeH, 0.03), mats.paint);
      const edge = mesh(extrudeUp(bladeShape(span, spec.reach, 0.6, 0.05), bladeH * 0.55, 0.02), mats.metal);
      edge.position.y = bladeH * 0.2;
      const pitched = group(body, edge);
      pitched.rotation.x = pitchDeg * DEG; // leading end up: reads as moving even at rest
      if (index === 0) {
        const slit = mesh(extrudeUp(bladeShape(span * 0.5, spec.reach * 0.35, 0.2, -0.05), 0.04, 0), mats.glow);
        slit.position.y = bladeH + 0.005;
        pitched.add(slit);
      }
      const holder = group(pitched);
      holder.rotation.y = spec.at * DEG + span / 2;
      holder.position.y = height * 0.2;
      return holder;
    });
    const hub = annulus(innerRadius, hubRadius + 0.08, height * 0.75, mats.paintAlt);
    const seatY = height * 0.4;
    return { object: group(hub, ringFloor(innerRadius, seatY, mats), ...bladeObjects), height, bottomRadius: hubRadius, topRadius: hubRadius, seatY };
  };
}

/** Thick band carrying a few huge chamfered hammer blocks with metal striking faces. */
export function hammerHeads({
  bandInner = 1.2, bandOuter = 1.9, height = 0.6, heads = 2, headRadial = 1.1, headTangential = 1.55, headHeight = 0.85,
} = {}): PieceBuilder {
  return ({ mats }) => {
    const band = annulus(bandInner, bandOuter, height, mats.paintAlt);
    const head = (): THREE.Object3D => {
      // Top-view outline widens toward the outer striking face.
      const x0 = bandOuter - 0.25;
      const x1 = bandOuter + headRadial;
      const w0 = headTangential * 0.34;
      const w1 = headTangential * 0.5;
      const c = 0.14;
      const outline = polygonShape([[x0, -w0], [x1 - c, -w1], [x1, -w1 + c], [x1, w1 - c], [x1 - c, w1], [x0, w0]]);
      const y0 = (height - headHeight) / 2;
      const block = atY(mesh(extrudeUp(outline, headHeight, 0.06), mats.paint), y0);
      const face = mesh(new RoundedBoxGeometry(0.16, headHeight * 0.78, headTangential * 0.88, 2, 0.04), mats.metal);
      face.position.set(x1 + 0.02, y0 + headHeight / 2, 0);
      const ridge = mesh(new RoundedBoxGeometry(headRadial * 0.9, 0.12, 0.2, 2, 0.04), mats.metal);
      ridge.position.set((x0 + x1) / 2 + 0.1, y0 + headHeight + 0.04, 0);
      return group(block, face, ridge);
    };
    const lug = (): THREE.Object3D => {
      const m = mesh(new RoundedBoxGeometry(0.34, height * 0.8, 0.5, 2, 0.06), mats.metal);
      m.position.set(bandOuter + 0.08, height * 0.5, 0);
      return m;
    };
    const seatY = height * 0.35;
    return {
      object: group(band, ringFloor(bandInner, seatY, mats), radial(heads, head), radial(heads, lug, TAU / heads / 2)),
      height, bottomRadius: bandOuter, topRadius: bandOuter, seatY,
    };
  };
}

/** Wide near-circular shield made of overlapping tilted plates, like armor scales. */
export function overlappingPlates({ outerRadius = 2.8, innerRadius = 1.35, plates = 8, plateHeight = 0.16, overlap = 1.4, tiltDeg = 6 } = {}): PieceBuilder {
  return ({ mats }) => {
    const span = (TAU / plates) * overlap;
    const plateShape = (): THREE.Shape => {
      const pts: Array<[number, number]> = [];
      for (let i = 0; i <= 48; i++) {
        const t = i / 48;
        const a = -span / 2 + span * t;
        const r = outerRadius * (1 - 0.035 * Math.pow(2 * t - 1, 2));
        pts.push([Math.cos(a) * r, Math.sin(a) * r]);
      }
      for (let i = 48; i >= 0; i--) {
        const a = -span / 2 + (span * i) / 48;
        pts.push([Math.cos(a) * innerRadius * 1.1, Math.sin(a) * innerRadius * 1.1]);
      }
      return polygonShape(pts);
    };
    const base = annulus(innerRadius, outerRadius - 0.35, 0.18, mats.paintAlt);
    const plate = (i: number): THREE.Object3D => {
      const m = mesh(extrudeUp(plateShape(), plateHeight, 0.03), i % 2 === 0 ? mats.paint : mats.paintAlt);
      m.rotation.x = tiltDeg * DEG; // leading end up -> each plate laps over the next one
      m.position.y = 0.26;
      return m;
    };
    const rim = atY(flatTorus(outerRadius - 0.16, 0.09, mats.metal), 0.12);
    const window = atY(annulus(innerRadius, innerRadius + 0.35, 0.05, mats.translucent, 0.01), 0.52);
    const seatY = 0.3;
    return {
      object: group(base, radial(plates, plate), rim, window, ringFloor(innerRadius, seatY, mats)),
      height: 0.58, bottomRadius: outerRadius - 0.35, topRadius: outerRadius - 0.35, seatY,
    };
  };
}

/** Independent thick bumper pods on a solid inner band, each joined by a coil-spring arm. */
export function bumperPods({ pods = 6, radius = 2.3, innerRadius = 1.0, bandRadius = 1.55, podRadial = 0.78, podTangential = 1.25, podHeight = 0.7 } = {}): PieceBuilder {
  return ({ mats }) => {
    const bandH = podHeight * 0.55;
    const band = atY(annulus(innerRadius, bandRadius, bandH, mats.darkMetal), (podHeight - bandH) / 2);
    const pod = (): THREE.Object3D => {
      const body = mesh(extrudeUp(roundedRectShape(podRadial, podTangential, 0.36), podHeight, 0.08), mats.paint);
      const strip = atY(mesh(extrudeUp(roundedRectShape(podRadial + 0.12, podTangential + 0.12, 0.42), 0.2, 0.04), mats.rubber), podHeight * 0.36);
      const window = atY(mesh(extrudeUp(roundedRectShape(podRadial * 0.45, podTangential * 0.55, 0.15), 0.06, 0.02), mats.translucent), podHeight);
      const p = group(body, strip, window);
      p.position.x = radius;
      const armLen = radius - podRadial / 2 - bandRadius + 0.1;
      const piston = mesh(new THREE.CylinderGeometry(0.06, 0.06, armLen, 16).rotateZ(Math.PI / 2).translate(bandRadius - 0.05 + armLen / 2, podHeight * 0.5, 0), mats.metal);
      const coils = group(...Array.from({ length: 4 }, (_, k) => {
        const coil = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.024, 8, 24).rotateY(Math.PI / 2), mats.accent);
        coil.position.set(bandRadius + 0.05 + (k * (armLen - 0.2)) / 3, podHeight * 0.5, 0);
        return coil;
      }));
      return group(p, piston, coils);
    };
    const seatY = podHeight * 0.4;
    return {
      object: group(band, ringFloor(innerRadius, seatY, mats), radial(pods, pod)),
      height: podHeight, bottomRadius: bandRadius, topRadius: bandRadius, seatY,
    };
  };
}

/** Crenellated ring (battlements) with metal facing on each merlon — the Defense C reference ring. */
export function crenellated({ outerRadius = 2.3, innerRadius = 1.45, merlons = 8, notchDepth = 0.32, height = 0.5 } = {}): PieceBuilder {
  return ({ mats }) => {
    const radiusAt = (t: number): number => {
      const u = repeatPhase(t, merlons);
      const up = smoothstep(0.1, 0.16, u) * (1 - smoothstep(0.84, 0.9, u));
      return outerRadius - notchDepth * (1 - up);
    };
    const ring = mesh(extrudeUp(polarShape(radiusAt, merlons * 60, innerRadius), height, 0.03), mats.paint);
    const facingSpan = (TAU / merlons) * 0.58;
    const facing = (): THREE.Object3D =>
      atY(mesh(extrudeUp(annularSector(outerRadius - 0.03, outerRadius + 0.07, -facingSpan / 2, facingSpan / 2, 16), height * 0.72, 0.015), mats.metal), height * 0.14);
    const glowLine = atY(flatTorus(innerRadius + 0.12, 0.02, mats.glow, 8, 96), height + 0.01);
    const seatY = height * 0.3;
    return {
      object: group(ring, radial(merlons, facing, TAU / merlons / 2), glowLine, ringFloor(innerRadius, seatY, mats)),
      height, bottomRadius: outerRadius - notchDepth, topRadius: outerRadius - notchDepth, seatY,
    };
  };
}

/** Thin large flywheel rim with clamped weights, joined to a small hub by long curved spokes. */
export function flywheel({ radius = 3.0, tube = 0.13, bandInner = 2.68, hubRadius = 0.95, spokes = 5, curve = 0.55, weights = 5 } = {}): PieceBuilder {
  return ({ mats }) => {
    const y = 0.2;
    const torus = atY(flatTorus(radius, tube, mats.metal, 20, 160), y);
    const band = atY(annulus(bandInner, radius - 0.02, 0.16, mats.paint, 0.02), y - 0.08);
    const spokeShape = (): THREE.Shape => {
      const left: Array<[number, number]> = [];
      const right: Array<[number, number]> = [];
      for (let i = 0; i <= 24; i++) {
        const s = i / 24;
        const r = hubRadius * 0.9 + (bandInner + 0.05 - hubRadius * 0.9) * s;
        const a = curve * Math.pow(s, 1.5);
        const half = 0.075 / r;
        left.push([Math.cos(a + half) * r, Math.sin(a + half) * r]);
        right.push([Math.cos(a - half) * r, Math.sin(a - half) * r]);
      }
      return polygonShape([...left, ...right.reverse()]);
    };
    const spokeRing = atY(radial(spokes, () => mesh(extrudeUp(spokeShape(), 0.12, 0.02), mats.metal)), y - 0.06);
    const hub = cylinderUp(hubRadius, hubRadius * 0.95, 0.3, mats.paintAlt, 48);
    const weight = (): THREE.Object3D => {
      const block = mesh(new RoundedBoxGeometry(0.36, 0.26, 0.62, 2, 0.08), mats.metal);
      block.position.set((bandInner + radius) / 2, y + 0.06, 0);
      const clips = group(...[-1, 1].map((s) => {
        const c = mesh(new THREE.BoxGeometry(0.44, 0.08, 0.07), mats.accent);
        c.position.set((bandInner + radius) / 2, y + 0.14, s * 0.34);
        return c;
      }));
      return group(block, clips);
    };
    return {
      object: group(torus, band, spokeRing, hub, radial(weights, weight, curve)),
      height: 0.34, bottomRadius: hubRadius, topRadius: hubRadius, seatY: 0.3,
    };
  };
}

/** Three concentric rings at stepped heights joined by thin pins; outer ring finely toothed. */
export function concentricRings({ outer = 2.7, middle = 2.05, inner = 1.45, floorRadius = 1.3, teeth = 48, pins = 6 } = {}): PieceBuilder {
  return ({ mats }) => {
    const toothed = mesh(extrudeUp(polarShape((t) => outer + (repeatPhase(t, teeth) < 0.4 ? 0.1 : 0), teeth * 10, outer - 0.22), 0.14, 0.015), mats.metal);
    const yMid = 0.3;
    const yIn = 0.52;
    const midRing = atY(flatTorus(middle, 0.09, mats.paint, 16, 128), yMid);
    const innerRing = atY(annulus(inner - 0.2, inner + 0.08, 0.12, mats.paint), yIn - 0.06);
    const outerPins = radial(pins, () => group(
      radialBar(middle + 0.06, yMid, outer - 0.22, 0.08, 0.05, mats.metal),
      atY(new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), mats.accent), yMid).translateX(middle),
    ));
    const innerPins = radial(pins, () => radialBar(inner + 0.06, yIn, middle - 0.06, yMid, 0.045, mats.metal), TAU / pins / 2);
    const ticks = atY(radial(24, () => mesh(new THREE.BoxGeometry(0.16, 0.02, 0.03), mats.accent).translateX(outer - 0.11)), 0.145);
    const floor = cylinderUp(floorRadius, floorRadius, yIn, mats.darkPlastic, 64);
    return {
      object: group(toothed, midRing, innerRing, outerPins, innerPins, ticks, floor),
      height: yIn + 0.08, bottomRadius: floorRadius, topRadius: floorRadius, seatY: yIn,
    };
  };
}

/** Smooth tri-lobed ring of medium diameter with a translucent inner lip and small edge weights. */
export function triLobeAero({ radius = 2.15, lobes = 3, lobeAmp = 0.2, width = 0.5, innerRadius = 1.2, height = 0.3 } = {}): PieceBuilder {
  return ({ mats }) => {
    const outerAt = (t: number): number => radius + lobeAmp * Math.cos(lobes * t);
    const shape = polarShape(outerAt, 360);
    shape.holes.push(polarPath((t) => outerAt(t) - width));
    const ring = atY(mesh(extrudeUp(shape, height, 0.06), mats.paint), 0.08);
    const lipShape = polarShape((t) => outerAt(t) - width + 0.02, 360);
    lipShape.holes.push(polarPath(() => innerRadius));
    const lip = mesh(extrudeUp(lipShape, 0.2, 0.01), mats.translucent);
    const weight = (): THREE.Object3D => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.16, 24, 16).scale(1.3, 0.55, 1), mats.metal);
      m.castShadow = true;
      m.position.set(radius + lobeAmp - width * 0.45, height + 0.08, 0);
      return m;
    };
    const seatY = 0.2;
    return {
      object: group(ring, lip, ringFloor(innerRadius, seatY, mats), radial(lobes, weight)),
      height: height + 0.08, bottomRadius: radius - lobeAmp - width, topRadius: radius - lobeAmp - width, seatY,
    };
  };
}
