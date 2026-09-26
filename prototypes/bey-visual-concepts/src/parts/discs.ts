// ============================================================
// BEY VISUAL CONCEPTS — PIECE 3: DISC (weight disc)
// Sits between the Driver and the Ring. Its radius must be SMALLER than
// the Ring's and LARGER than the Driver's top, with a real side face
// (height ~0.3–0.5) so it is clearly visible as its own piece from the
// side and in the diagonal view. Mostly bare metal, like a weight disc.
// Local y = 0 at the bottom seam.
// ============================================================

import * as THREE from 'three';
import { DEG, TAU, annulus, atY, boltHead, circlePath, cylinderUp, extrudeUp, facet, flatTorus, group, lathe, mesh, polarShape, radial, repeatPhase, smoothstep, taperBody } from '../model/geometry';
import type { PieceBuilder } from '../model/types';

/** Chamfered underside so the disc visibly steps in toward the driver. */
function underside(radius: number, height: number, mat: THREE.Material, inset = 0.82): THREE.Mesh {
  return mesh(taperBody({ bottomRadius: radius * inset, topRadius: radius * 0.98, height, chamfer: 0.02 }), mat);
}

/** Thick metal disc with 4 deep notches and lugs — mass pushed to the edge. */
export function notchedDisc({ radius = 1.65, height = 0.4, notches = 4 } = {}): PieceBuilder {
  return ({ mats }) => {
    const radiusAt = (t: number): number => {
      const u = repeatPhase(t, notches);
      const notch = smoothstep(0.42, 0.46, u) * (1 - smoothstep(0.58, 0.62, u));
      return radius - 0.28 * notch;
    };
    const base = underside(radius, height * 0.35, mats.darkMetal);
    const body = atY(mesh(extrudeUp(polarShape(radiusAt, notches * 90), height * 0.65, 0.03), mats.metal), height * 0.35);
    const hub = atY(cylinderUp(radius * 0.55, radius * 0.6, 0.05, mats.darkMetal, 48), height - 0.02);
    return { object: group(base, body, hub), height, bottomRadius: radius * 0.82, topRadius: radius };
  };
}

/** Toothed metal gear rim over a translucent layer — visible internal layering. */
export function gearDisc({ radius = 1.5, height = 0.42, teeth = 30 } = {}): PieceBuilder {
  return ({ mats }) => {
    const plate = underside(radius * 0.95, height * 0.4, mats.translucent, 0.86);
    const gear = atY(mesh(extrudeUp(polarShape((t) => radius - (repeatPhase(t, teeth) < 0.5 ? 0 : 0.1), teeth * 8, radius * 0.45), height * 0.45, 0.012), mats.metal), height * 0.4);
    const core = cylinderUp(radius * 0.5, radius * 0.55, height, mats.darkMetal, 7);
    const pins = atY(radial(3, () => cylinderUp(0.07, 0.07, 0.1, mats.accent, 12).translateX(radius * 0.7), 20 * DEG), height * 0.85);
    return { object: group(plate, gear, core, pins), height, bottomRadius: radius * 0.82, topRadius: radius };
  };
}

/** Heavy faceted drum with vertical panel seams. */
export function heavyDrum({ radius = 1.55, height = 0.5, panels = 10 } = {}): PieceBuilder {
  return ({ mats }) => {
    const base = underside(radius, height * 0.25, mats.darkMetal, 0.85);
    const drum = atY(mesh(facet(new THREE.CylinderGeometry(radius, radius, height * 0.75, panels).translate(0, height * 0.375, 0)), mats.metal), height * 0.25);
    const seam = (): THREE.Object3D => mesh(new THREE.BoxGeometry(0.07, height * 0.6, 0.12).translate(radius * 0.985, height * 0.6, 0), mats.darkMetal);
    return { object: group(base, drum, radial(panels, seam, TAU / panels / 2)), height, bottomRadius: radius * 0.85, topRadius: radius };
  };
}

/** Two stacked round steel plates with rivets — smooth, protective. */
export function layeredDisc({ radius = 1.95, height = 0.4 } = {}): PieceBuilder {
  return ({ mats }) => {
    const lower = underside(radius * 0.9, height * 0.5, mats.darkMetal, 0.85);
    const upper = atY(mesh(taperBody({ bottomRadius: radius * 0.97, topRadius: radius, height: height * 0.5, chamfer: 0.04 }), mats.metal), height * 0.5);
    const rivets = atY(radial(16, () => {
      const b = boltHead(0.05, 0.035, mats.metal);
      b.rotation.z = -Math.PI / 2;
      b.position.x = radius * 0.88;
      return b;
    }), height * 0.25);
    return { object: group(lower, upper, rivets), height, bottomRadius: radius * 0.76, topRadius: radius };
  };
}

/** Metal disc wrapped in a thick rubber bumper tire. */
export function tireDisc({ radius = 1.7, height = 0.45 } = {}): PieceBuilder {
  return ({ mats }) => {
    const tube = height * 0.42;
    const core = mesh(taperBody({ bottomRadius: radius * 0.72, topRadius: radius - tube, height, chamfer: 0.03 }), mats.metal);
    const tire = atY(flatTorus(radius - tube, tube, mats.rubber, 20, 96), height / 2);
    const treads = atY(radial(18, () => mesh(new THREE.BoxGeometry(0.06, height * 0.5, 0.12), mats.darkPlastic).translateX(radius - 0.02)), height / 2);
    return { object: group(core, tire, treads), height, bottomRadius: radius * 0.72, topRadius: radius };
  };
}

/** Octagonal disc with buttresses at each corner (the Defense C fortress base, now exposed). */
export function octagonDisc({ radius = 1.75, height = 0.45, sides = 8 } = {}): PieceBuilder {
  return ({ mats }) => {
    const body = mesh(facet(new THREE.CylinderGeometry(radius, radius * 0.86, height, sides).translate(0, height / 2, 0)), mats.metal);
    body.rotation.y = Math.PI / sides;
    const buttress = (): THREE.Object3D => mesh(new THREE.BoxGeometry(0.22, height * 0.92, 0.3).translate(radius * 0.96, height * 0.5, 0), mats.darkMetal);
    const band = atY(flatTorus(radius * 0.93, 0.035, mats.accent, 8, 64), height * 0.5);
    return { object: group(body, radial(sides, buttress), band), height, bottomRadius: radius * 0.86, topRadius: radius };
  };
}

/** Thinner disc with large windows and metal beads around the rim — mass at the edge. */
export function beadDisc({ radius = 1.6, height = 0.32, windows = 5, beads = 10 } = {}): PieceBuilder {
  return ({ mats }) => {
    const shape = polarShape(() => radius, 160);
    for (let i = 0; i < windows; i++) {
      const a = (i / windows) * TAU;
      const hole = new THREE.Path();
      circlePath(radius * 0.2, 32).getPoints().forEach((p, k) => {
        const x = p.x + Math.cos(a) * radius * 0.58;
        const y = p.y + Math.sin(a) * radius * 0.58;
        if (k === 0) hole.moveTo(x, y);
        else hole.lineTo(x, y);
      });
      shape.holes.push(hole);
    }
    const base = underside(radius * 0.6, height * 0.4, mats.darkMetal, 0.8);
    const plate = atY(mesh(extrudeUp(shape, height * 0.6, 0.025), mats.metal), height * 0.4);
    const beadRing = atY(radial(beads, () => new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 12), mats.accent).translateX(radius * 0.88)), height);
    return { object: group(base, plate, beadRing), height, bottomRadius: radius * 0.48, topRadius: radius };
  };
}

/** Three stepped precision plates with alignment pins. */
export function steppedPrecision({ radius = 1.5, height = 0.42, pins = 12 } = {}): PieceBuilder {
  return ({ mats }) => {
    const step = height / 3;
    const plates = group(
      mesh(taperBody({ bottomRadius: radius * 0.72, topRadius: radius * 0.76, height: step, chamfer: 0.015 }), mats.darkMetal),
      atY(mesh(taperBody({ bottomRadius: radius * 0.88, topRadius: radius * 0.88, height: step, chamfer: 0.015 }), mats.metal), step),
      atY(annulus(radius * 0.3, radius, step, mats.metal, 0.015), step * 2),
    );
    const grooves = group(atY(flatTorus(radius * 0.7, 0.02, mats.darkMetal, 8, 96), height), atY(flatTorus(radius * 0.5, 0.02, mats.darkMetal, 8, 96), height));
    const pinRing = atY(radial(pins, () => cylinderUp(0.035, 0.035, 0.1, mats.accent, 12).translateX(radius * 0.94)), height);
    return { object: group(plates, grooves, pinRing), height, bottomRadius: radius * 0.72, topRadius: radius };
  };
}

/** Smooth lens-shaped metal disc — aerodynamic. */
export function lensDisc({ radius = 1.7, height = 0.4 } = {}): PieceBuilder {
  return ({ mats }) => {
    const lens = mesh(lathe([[0, 0], [radius * 0.78, 0], [radius * 0.97, height * 0.35], [radius, height * 0.55], [radius * 0.9, height * 0.85], [radius * 0.7, height], [0, height]], 96), mats.metal);
    const trim = atY(flatTorus(radius * 0.995, 0.025, mats.accent, 8, 96), height * 0.52);
    return { object: group(lens, trim), height, bottomRadius: radius * 0.78, topRadius: radius * 0.7 };
  };
}
