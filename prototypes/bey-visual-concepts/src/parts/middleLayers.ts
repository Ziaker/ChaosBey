// ============================================================
// BEY VISUAL CONCEPTS — MIDDLE LAYERS (chassis / weight layer)
// Stacked on the lower body (local y = 0). The upper ring is mounted at
// this layer's base and the core at its top, so this layer is the
// structural connection between center and ring.
// ============================================================

import * as THREE from 'three';
import { DEG, TAU, annulus, atY, boltHead, circlePath, cylinderUp, extrudeUp, facet, flatTorus, group, mesh, polarShape, polygonShape, radial } from '../model/geometry';
import type { PartBuilder } from '../model/types';

/** Solid metal weight disc with round cutouts. Mass pushed outward. */
export function cutoutWeightDisc({ radius = 2.0, height = 0.28, cutouts = 4, cutoutRadius = 0.28, cutoutDistance = 1.35 } = {}): PartBuilder {
  return ({ mats }) => {
    const shape = polarShape(() => radius, 160);
    for (let i = 0; i < cutouts; i++) {
      const a = (i / cutouts) * TAU + TAU / (cutouts * 2);
      const shifted = new THREE.Path();
      circlePath(cutoutRadius, 32).getPoints().forEach((p, k) => {
        const x = p.x + Math.cos(a) * cutoutDistance;
        const y = p.y + Math.sin(a) * cutoutDistance;
        if (k === 0) shifted.moveTo(x, y);
        else shifted.lineTo(x, y);
      });
      shape.holes.push(shifted);
    }
    const disc = mesh(extrudeUp(shape, height, 0.03), mats.metal);
    const hub = cylinderUp(0.75, 0.8, height + 0.04, mats.darkMetal, 48);
    return { object: group(disc, hub), height };
  };
}

/** Exposed gear-tooth frame on a translucent under-plate — visible internal layers. */
export function gearFrame({ radius = 1.75, height = 0.3, teeth = 28, spokes = 3 } = {}): PartBuilder {
  return ({ mats }) => {
    const underPlate = annulus(0.5, radius * 0.95, 0.08, mats.translucent, 0.01);
    const gear = atY(mesh(extrudeUp(polarShape((t) => {
      const u = ((t / TAU) * teeth) % 1;
      return radius - (u < 0.5 ? 0 : 0.12);
    }, teeth * 8, radius - 0.32), 0.14, 0.01), mats.darkMetal), 0.08);
    const spoke = (): THREE.Object3D => atY(mesh(new THREE.BoxGeometry(radius - 0.55, 0.12, 0.16).translate((radius - 0.55) / 2 + 0.45, 0.06, 0), mats.metal), 0.08);
    const hub = cylinderUp(0.55, 0.6, height, mats.darkMetal, 7);
    return { object: group(underPlate, gear, radial(spokes, spoke, 25 * DEG), hub), height };
  };
}

/** Thick armored drum with vertical panel seams. Heavy center. */
export function armoredDrum({ radius = 1.55, height = 0.55, panels = 10 } = {}): PartBuilder {
  return ({ mats }) => {
    const drum = mesh(facet(new THREE.CylinderGeometry(radius, radius * 1.04, height, panels).translate(0, height / 2, 0)), mats.darkMetal);
    const seam = (): THREE.Object3D => mesh(new THREE.BoxGeometry(0.06, height * 0.8, 0.12).translate(radius * 0.99, height / 2, 0), mats.metal);
    const cap = atY(annulus(radius * 0.55, radius * 0.98, 0.06, mats.paintAlt), height - 0.02);
    return { object: group(drum, radial(panels, seam, TAU / panels / 2), cap), height };
  };
}

/** Two offset steel plates, the upper one slightly smaller — layered armor. */
export function layeredPlates({ radius = 2.25, height = 0.3 } = {}): PartBuilder {
  return ({ mats }) => {
    const lower = annulus(0.3, radius, height * 0.5, mats.metal);
    const upper = atY(annulus(0.3, radius * 0.86, height * 0.5, mats.darkMetal), height * 0.5);
    const rivets = atY(radial(16, () => boltHead(0.05, 0.03, mats.metal).translateX(radius * 0.93)), height * 0.5);
    return { object: group(lower, upper, rivets), height };
  };
}

/** Central hub with horizontal arms carrying coil-spring pistons out to each bumper pod. */
export function hubArms({ hubRadius = 1.15, height = 0.5, arms = 6, armLength = 1.95 } = {}): PartBuilder {
  return ({ mats }) => {
    const hub = mesh(facet(new THREE.CylinderGeometry(hubRadius, hubRadius * 1.05, height, 12).translate(0, height / 2, 0)), mats.darkMetal);
    const arm = (): THREE.Object3D => {
      const bar = mesh(new THREE.BoxGeometry(armLength - hubRadius + 0.1, 0.16, 0.3).translate((armLength + hubRadius) / 2 - 0.05, height * 0.35, 0), mats.darkPlastic);
      const pistonLen = armLength - hubRadius;
      const piston = mesh(new THREE.CylinderGeometry(0.06, 0.06, pistonLen, 16).rotateZ(Math.PI / 2).translate((armLength + hubRadius) / 2, height * 0.72, 0), mats.metal);
      const coils = group(...Array.from({ length: 6 }, (_, k) => {
        const coil = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.022, 8, 24).rotateY(Math.PI / 2), mats.accent);
        coil.position.set(hubRadius + 0.1 + (k * (pistonLen - 0.2)) / 5, height * 0.72, 0);
        return coil;
      }));
      return group(bar, piston, coils);
    };
    return { object: group(hub, radial(arms, arm)), height };
  };
}

/** Octagonal fortress base with corner buttresses. */
export function fortressBase({ radius = 1.85, height = 0.45, sides = 8 } = {}): PartBuilder {
  return ({ mats }) => {
    const base = mesh(facet(new THREE.CylinderGeometry(radius, radius, height, sides).translate(0, height / 2, 0)), mats.paintAlt);
    base.rotation.y = Math.PI / sides;
    const buttress = (): THREE.Object3D => mesh(new THREE.BoxGeometry(0.28, height * 1.1, 0.34).translate(radius * 0.95, height * 0.55, 0), mats.metal);
    return { object: group(base, radial(sides, buttress)), height };
  };
}

/** Tiny hub with long thin curved spokes reaching the rim — most of the area is empty. */
export function curvedSpokes({ hubRadius = 0.8, rimRadius = 2.9, spokes = 5, height = 0.14, curve = 0.55, width = 0.13 } = {}): PartBuilder {
  return ({ mats }) => {
    const spokeShape = (): THREE.Shape => {
      const left: Array<[number, number]> = [];
      const right: Array<[number, number]> = [];
      for (let i = 0; i <= 24; i++) {
        const s = i / 24;
        const r = hubRadius * 0.8 + (rimRadius - hubRadius * 0.8) * s;
        const a = curve * Math.pow(s, 1.5);
        const half = width / 2 / r;
        left.push([Math.cos(a + half) * r, Math.sin(a + half) * r]);
        right.push([Math.cos(a - half) * r, Math.sin(a - half) * r]);
      }
      return polygonShape([...left, ...right.reverse()]);
    };
    const spoke = (): THREE.Object3D => mesh(extrudeUp(spokeShape(), height, 0.02), mats.metal);
    const hub = cylinderUp(hubRadius, hubRadius * 0.9, height + 0.06, mats.paintAlt, 48);
    return { object: group(hub, radial(spokes, spoke)), height };
  };
}

/** Thin metal plate with an inner ring and a circle of alignment pins. */
export function precisionPlate({ radius = 1.4, height = 0.12, pins = 12 } = {}): PartBuilder {
  return ({ mats }) => {
    const plate = annulus(0.2, radius, height, mats.darkMetal, 0.015);
    const ring = atY(flatTorus(radius * 0.7, 0.03, mats.metal, 10, 64), height);
    const pinRing = atY(radial(pins, () => cylinderUp(0.035, 0.035, 0.12, mats.metal, 12).translateX(radius * 0.88)), height);
    return { object: group(plate, ring, pinRing), height };
  };
}

/** Smooth convex aero shell connecting a tall fairing to the ring. */
export function aeroShell({ radius = 1.9, height = 0.3, innerRadius = 1.5 } = {}): PartBuilder {
  return ({ mats }) => {
    const shell = mesh(new THREE.LatheGeometry([
      new THREE.Vector2(innerRadius, 0),
      new THREE.Vector2(radius, height * 0.35),
      new THREE.Vector2(radius * 0.96, height * 0.8),
      new THREE.Vector2(radius * 0.7, height),
      new THREE.Vector2(0, height),
    ], 96), mats.paintAlt);
    const trim = atY(flatTorus(radius * 0.98, 0.025, mats.metal, 8, 96), height * 0.55);
    const vanes = atY(radial(3, () => mesh(extrudeUp(polygonShape([[innerRadius * 0.5, -0.06], [radius * 0.92, -0.14], [radius * 0.92, 0.02], [innerRadius * 0.5, 0.06]]), 0.04, 0.01), mats.accent), 60 * DEG), height);
    return { object: group(shell, trim, vanes), height };
  };
}
