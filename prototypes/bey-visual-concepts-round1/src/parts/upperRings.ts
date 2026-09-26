// ============================================================
// BEY VISUAL CONCEPTS — UPPER RINGS (main silhouette element)
// Mounted at the middle layer's BASE (local y = 0); each builder has its
// own `lift` to sit higher/lower. This slot defines most of the top-view
// silhouette, so each variant here is structurally different (element
// count, symmetry, openness, thickness) rather than a recolor.
//
// Spin direction for "leading edge" purposes: counter-clockwise seen from
// above (increasing angle), same as the presentation auto-rotate.
// ============================================================

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import {
  DEG, TAU, annularSector, annulus, atY, extrudeUp, flatTorus, group, mesh, polarPath, polarShape, polygonShape,
  radial, radialBar, repeatPhase, roundedRectShape, smoothstep,
} from '../model/geometry';
import type { PartBuilder } from '../model/types';

/** 3–4 big ramped impact lobes, each ending in a steep leading face capped by a metal plate. */
export function impactLobes({ baseRadius = 2.15, innerRadius = 1.2, lobes = 4, reach = 0.85, height = 0.42, lift = 0.1 } = {}): PartBuilder {
  return ({ mats }) => {
    const radiusAt = (t: number): number => {
      const u = repeatPhase(t, lobes);
      if (u < 0.06) return baseRadius;
      if (u < 0.47) return baseRadius + reach * (0.2 + 0.8 * Math.pow((u - 0.06) / 0.41, 1.5));
      if (u < 0.5) return baseRadius + reach * (1 - (u - 0.47) / 0.03);
      return baseRadius - 0.1 * Math.sin((Math.PI * (u - 0.5)) / 0.5);
    };
    const ring = atY(mesh(extrudeUp(polarShape(radiusAt, lobes * 200, innerRadius), height, 0.04), mats.paint), lift);
    const underLayer = atY(annulus(innerRadius + 0.1, baseRadius - 0.05, 0.12, mats.darkPlastic), lift - 0.1);
    const inlay = atY(flatTorus(baseRadius - 0.32, 0.035, mats.accent), lift + height);
    const plate = (): THREE.Object3D => {
      const len = reach * 0.9 + 0.15;
      const m = mesh(new RoundedBoxGeometry(len, height + 0.08, 0.16, 2, 0.03), mats.metal);
      m.position.set(baseRadius - 0.1 + len / 2, lift + height / 2, 0);
      return m;
    };
    // Plates sit just behind each lobe's leading face (u ≈ 0.46).
    return { object: group(ring, underLayer, inlay, radial(lobes, plate, (0.46 / lobes) * TAU)), height: height + lift };
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

/** Asymmetric swept blades of unequal size, pitched like propeller blades. */
export function sweptBlades({
  hubRadius = 1.55,
  height = 0.34,
  lift = 0.18,
  pitchDeg = 12,
  sweepDeg = 14,
  blades = [
    { at: 0, span: 150, reach: 1.35 },
    { at: 170, span: 85, reach: 0.8 },
    { at: 268, span: 70, reach: 0.62 },
  ] as SweptBladeSpec[],
} = {}): PartBuilder {
  return ({ mats }) => {
    const innerR = hubRadius - 0.3;
    const bladeShape = (spanRad: number, reach: number, t0: number, extra: number): THREE.Shape => {
      const pts: Array<[number, number]> = [];
      const sweep = sweepDeg * DEG;
      for (let i = 0; i <= 40; i++) {
        const t = t0 + ((1 - t0) * i) / 40;
        const a = -spanRad / 2 + spanRad * t + sweep * Math.pow(t, 3);
        const r = hubRadius + extra + (reach * Math.pow(t, 1.25));
        pts.push([Math.cos(a) * r, Math.sin(a) * r]);
      }
      for (let i = 40; i >= 0; i--) {
        const t = t0 + ((1 - t0) * i) / 40;
        const a = -spanRad / 2 + spanRad * t;
        pts.push([Math.cos(a) * innerR, Math.sin(a) * innerR]);
      }
      return polygonShape(pts);
    };
    const bladeObjects = blades.map((spec, index) => {
      const span = spec.span * DEG;
      const body = mesh(extrudeUp(bladeShape(span, spec.reach, 0, 0), height, 0.03), mats.paint);
      const edge = mesh(extrudeUp(bladeShape(span, spec.reach, 0.6, 0.05), height * 0.55, 0.02), mats.metal);
      edge.position.y = height * 0.2;
      const pitched = group(body, edge);
      pitched.rotation.x = pitchDeg * DEG; // leading end up: reads as moving even at rest
      if (index === 0) {
        const slit = mesh(extrudeUp(bladeShape(span * 0.5, spec.reach * 0.35, 0.2, -0.05), 0.04, 0), mats.glow);
        slit.position.y = height + 0.005;
        pitched.add(slit);
      }
      const holder = group(pitched);
      holder.rotation.y = (spec.at * DEG) + span / 2;
      return holder;
    });
    const hub = atY(annulus(innerR, hubRadius + 0.08, height * 0.8, mats.paintAlt), lift);
    const blade = group(...bladeObjects);
    blade.position.y = lift;
    return { object: group(hub, blade), height: height + lift };
  };
}

/** Thick band carrying a few huge blocky hammer heads with metal striking faces. */
export function hammerHeads({
  bandInner = 1.45, bandOuter = 1.95, height = 0.6, heads = 2, headRadial = 0.95, headTangential = 1.25, headHeight = 0.85, lift = 0,
} = {}): PartBuilder {
  return ({ mats }) => {
    const band = atY(annulus(bandInner, bandOuter, height, mats.paintAlt), lift);
    const head = (): THREE.Object3D => {
      // Top-view outline: a chamfered block that widens toward its outer
      // striking face (mass concentrated at the edge).
      const x0 = bandOuter - 0.25;
      const x1 = bandOuter + headRadial;
      const w0 = headTangential * 0.34;
      const w1 = headTangential * 0.5;
      const c = 0.14;
      const outline = polygonShape([
        [x0, -w0], [x1 - c, -w1], [x1, -w1 + c], [x1, w1 - c], [x1 - c, w1], [x0, w0],
      ]);
      const y0 = lift - 0.12;
      const block = atY(mesh(extrudeUp(outline, headHeight, 0.06), mats.paint), y0);
      const face = mesh(new RoundedBoxGeometry(0.16, headHeight * 0.78, headTangential * 0.88, 2, 0.04), mats.metal);
      face.position.set(x1 + 0.02, y0 + headHeight / 2, 0);
      const ridge = mesh(new RoundedBoxGeometry(headRadial * 0.9, 0.12, 0.2, 2, 0.04), mats.metal);
      ridge.position.set((x0 + x1) / 2 + 0.1, y0 + headHeight + 0.04, 0);
      const clamp = mesh(new THREE.BoxGeometry(0.5, height * 0.6, headTangential * 0.55), mats.darkMetal);
      clamp.position.set(bandOuter - 0.1, lift + height * 0.5, 0);
      return group(block, face, ridge, clamp);
    };
    const lug = (): THREE.Object3D => {
      const m = mesh(new RoundedBoxGeometry(0.34, height * 0.8, 0.5, 2, 0.06), mats.metal);
      m.position.set(bandOuter + 0.08, lift + height * 0.4, 0);
      return m;
    };
    return { object: group(band, radial(heads, head), radial(heads, lug, TAU / heads / 2)), height: headHeight + lift };
  };
}

/** Wide near-circular shield made of overlapping tilted plates, like armor scales. */
export function overlappingPlates({ outerRadius = 2.85, innerRadius = 1.6, plates = 8, height = 0.14, overlap = 1.4, tiltDeg = 6, lift = 0.2 } = {}): PartBuilder {
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
        pts.push([Math.cos(a) * innerRadius, Math.sin(a) * innerRadius]);
      }
      return polygonShape(pts);
    };
    const plate = (i: number): THREE.Object3D => {
      const m = mesh(extrudeUp(plateShape(), height, 0.03), i % 2 === 0 ? mats.paint : mats.paintAlt);
      m.rotation.x = tiltDeg * DEG; // leading end up -> each plate laps over the next one
      m.position.y = lift + 0.14;
      return m;
    };
    const rim = atY(flatTorus(outerRadius - 0.14, 0.09, mats.metal), lift + 0.02);
    const window = atY(annulus(innerRadius - 0.05, innerRadius + 0.35, 0.05, mats.translucent, 0.01), lift + 0.34);
    return { object: group(radial(plates, plate), rim, window), height: height + lift + 0.3 };
  };
}

/** Independent thick rounded bumper pods with rubber strips and small translucent windows. */
export function bumperPods({ pods = 6, radius = 2.35, podRadial = 0.8, podTangential = 1.3, podHeight = 0.7, lift = 0 } = {}): PartBuilder {
  return ({ mats }) => {
    const pod = (): THREE.Object3D => {
      const body = mesh(extrudeUp(roundedRectShape(podRadial, podTangential, 0.36), podHeight, 0.08), mats.paint);
      const strip = atY(mesh(extrudeUp(roundedRectShape(podRadial + 0.12, podTangential + 0.12, 0.42), 0.2, 0.04), mats.rubber), podHeight * 0.34);
      const window = atY(mesh(extrudeUp(roundedRectShape(podRadial * 0.45, podTangential * 0.55, 0.15), 0.06, 0.02), mats.translucent), podHeight);
      const p = group(body, strip, window);
      p.position.set(radius, lift, 0);
      return p;
    };
    return { object: radial(pods, pod), height: podHeight + lift };
  };
}

/** Narrow crenellated ring (battlements) with metal facing on each merlon. */
export function crenellated({ outerRadius = 2.3, innerRadius = 1.55, merlons = 8, notchDepth = 0.32, height = 0.5, lift = 0.05 } = {}): PartBuilder {
  return ({ mats }) => {
    const radiusAt = (t: number): number => {
      const u = repeatPhase(t, merlons);
      const up = smoothstep(0.1, 0.16, u) * (1 - smoothstep(0.84, 0.9, u));
      return outerRadius - notchDepth * (1 - up);
    };
    const ring = atY(mesh(extrudeUp(polarShape(radiusAt, merlons * 60, innerRadius), height, 0.03), mats.paint), lift);
    const facingSpan = (TAU / merlons) * 0.58;
    const facing = (): THREE.Object3D =>
      atY(mesh(extrudeUp(annularSector(outerRadius - 0.03, outerRadius + 0.07, -facingSpan / 2, facingSpan / 2, 16), height * 0.72, 0.015), mats.metal), lift + height * 0.14);
    const glowLine = atY(flatTorus(innerRadius + 0.12, 0.02, mats.glow, 8, 96), lift + height + 0.01);
    return { object: group(ring, radial(merlons, facing, TAU / merlons / 2), glowLine), height: height + lift };
  };
}

/** Thin large-diameter flywheel rim with clamped metal weights — mass at the edge. */
export function flywheelRim({ radius = 3.05, tube = 0.13, bandInner = 2.72, bandHeight = 0.16, weights = 5, phase = 0.55, lift = 0 } = {}): PartBuilder {
  return ({ mats }) => {
    const y = lift + tube;
    const torus = atY(flatTorus(radius, tube, mats.metal, 20, 160), y);
    const band = atY(annulus(bandInner, radius - 0.02, bandHeight, mats.paint, 0.02), y - bandHeight / 2);
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
    return { object: group(torus, band, radial(weights, weight, phase)), height: tube * 2 + lift };
  };
}

/** Three concentric rings at stepped heights, joined by thin pins; outer ring carries fine teeth. */
export function concentricRings({ outer = 2.7, middle = 2.05, inner = 1.5, teeth = 48, pins = 6, lift = 0.05 } = {}): PartBuilder {
  return ({ mats }) => {
    const toothed = atY(mesh(extrudeUp(polarShape((t) => outer + (repeatPhase(t, teeth) < 0.4 ? 0.1 : 0), teeth * 10, outer - 0.2), 0.12, 0.015), mats.metal), lift);
    const yMid = lift + 0.32;
    const yIn = lift + 0.56;
    const midRing = atY(flatTorus(middle, 0.085, mats.paint, 16, 128), yMid);
    const innerRing = atY(annulus(inner - 0.18, inner + 0.08, 0.1, mats.paint), yIn - 0.05);
    const outerPins = radial(pins, () => group(
      radialBar(middle + 0.06, yMid, outer - 0.2, lift + 0.08, 0.05, mats.metal),
      atY(new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), mats.accent), yMid).translateX(middle),
    ));
    const innerPins = radial(pins, () => radialBar(inner + 0.06, yIn, middle - 0.06, yMid, 0.045, mats.metal), TAU / pins / 2);
    const ticks = atY(radial(24, () => mesh(new THREE.BoxGeometry(0.16, 0.02, 0.03), mats.accent).translateX(outer - 0.1)), lift + 0.125);
    return { object: group(toothed, midRing, innerRing, outerPins, innerPins, ticks), height: yIn + 0.1 };
  };
}

/** Smooth tri-lobed ring of medium diameter with a translucent inner lip and small edge weights. */
export function triLobeAero({ radius = 2.2, lobes = 3, lobeAmp = 0.2, width = 0.42, height = 0.2, lift = 0.14 } = {}): PartBuilder {
  return ({ mats }) => {
    const outerAt = (t: number): number => radius + lobeAmp * Math.cos(lobes * t);
    const shape = polarShape(outerAt, 360);
    shape.holes.push(polarPath((t) => outerAt(t) - width));
    const ring = atY(mesh(extrudeUp(shape, height, 0.05), mats.paint), lift);
    const lipShape = polarShape((t) => outerAt(t) - width + 0.02, 360);
    lipShape.holes.push(polarPath((t) => outerAt(t) - width - 0.2));
    const lip = atY(mesh(extrudeUp(lipShape, height * 0.5, 0.01), mats.translucent), lift + height * 0.4);
    const weight = (): THREE.Object3D => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.16, 24, 16).scale(1.3, 0.55, 1), mats.metal);
      m.castShadow = true;
      m.position.set(radius + lobeAmp - width * 0.45, lift + height, 0);
      return m;
    };
    return { object: group(ring, lip, radial(lobes, weight)), height: height + lift };
  };
}
