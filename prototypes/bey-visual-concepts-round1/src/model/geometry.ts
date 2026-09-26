// ============================================================
// BEY VISUAL CONCEPTS — GEOMETRY HELPERS
// Small procedural building blocks shared by every part builder.
//
// Angle convention (used everywhere in this prototype):
//   angle 0 = +X, increasing angle = counter-clockwise seen from above
//   (the same direction as the presentation spin). A 2D Shape point at
//   polar angle θ ends up at world angle θ after extrudeUp(), and an
//   object built at +X then wrapped by radial()/atAngle() also ends up at
//   world angle θ — so outlines and radial pieces always line up.
// ============================================================

import * as THREE from 'three';

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

/** Mesh with shadows on. */
export function mesh(geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function group(...children: THREE.Object3D[]): THREE.Group {
  const g = new THREE.Group();
  for (const child of children) g.add(child);
  return g;
}

/** Set position.y and return the object (for terse stacking). */
export function atY<T extends THREE.Object3D>(object: T, y: number): T {
  object.position.y = y;
  return object;
}

/** Wrap an object authored at +X so it sits at a world angle around the Y axis. */
export function atAngle(object: THREE.Object3D, angle: number): THREE.Group {
  const wrapper = new THREE.Group();
  wrapper.rotation.y = angle;
  wrapper.add(object);
  return wrapper;
}

/** Repeat an object authored at +X `count` times around the Y axis. */
export function radial(count: number, factory: (index: number, angle: number) => THREE.Object3D, phase = 0): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < count; i++) {
    const angle = phase + (i / count) * TAU;
    g.add(atAngle(factory(i, angle), angle));
  }
  return g;
}

/** Revolve a [radius, y] profile around Y. Radii must be >= 0. */
export function lathe(profile: ReadonlyArray<readonly [number, number]>, segments = 72): THREE.LatheGeometry {
  return new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y)),
    segments,
  );
}

/** Per-face normals — gives low-segment lathes / primitives a machined, faceted look. */
export function facet(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  g.computeVertexNormals();
  return g;
}

export function circlePath(radius: number, samples = 96): THREE.Path {
  const path = new THREE.Path();
  for (let i = 0; i <= samples; i++) {
    const t = (i / samples) * TAU;
    const x = Math.cos(t) * radius;
    const y = Math.sin(t) * radius;
    if (i === 0) path.moveTo(x, y);
    else path.lineTo(x, y);
  }
  return path;
}

/** Closed outline from a polar radius function r(θ), optionally with a circular hole. */
export function polarShape(radiusAt: (theta: number) => number, samples = 360, holeRadius?: number): THREE.Shape {
  const shape = new THREE.Shape();
  for (let i = 0; i < samples; i++) {
    const t = (i / samples) * TAU;
    const r = radiusAt(t);
    const x = Math.cos(t) * r;
    const y = Math.sin(t) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  if (holeRadius !== undefined && holeRadius > 0) shape.holes.push(circlePath(holeRadius));
  return shape;
}

/** Closed path from a polar radius function — use as a non-circular hole. */
export function polarPath(radiusAt: (theta: number) => number, samples = 360): THREE.Path {
  const path = new THREE.Path();
  for (let i = 0; i <= samples; i++) {
    const t = (i / samples) * TAU;
    const r = radiusAt(t);
    if (i === 0) path.moveTo(Math.cos(t) * r, Math.sin(t) * r);
    else path.lineTo(Math.cos(t) * r, Math.sin(t) * r);
  }
  return path;
}

/**
 * Straight bar running radially from (r0, y0) to (r1, y1) along +X —
 * used for pins/struts that connect rings at different heights.
 */
export function radialBar(r0: number, y0: number, r1: number, y1: number, thickness: number, material: THREE.Material): THREE.Mesh {
  const len = Math.hypot(r1 - r0, y1 - y0);
  const bar = mesh(new THREE.CylinderGeometry(thickness / 2, thickness / 2, len, 10), material);
  bar.position.set((r0 + r1) / 2, (y0 + y1) / 2, 0);
  bar.rotation.z = -Math.atan2(r1 - r0, y1 - y0);
  return bar;
}

/** Fraction [0, 1) of the way through the current repeat when `count` repeats fill a full turn. */
export function repeatPhase(theta: number, count: number): number {
  const u = (theta / TAU) * count;
  return u - Math.floor(u);
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Annular sector between two radii over [a0, a1] (radians). */
export function annularSector(innerRadius: number, outerRadius: number, a0: number, a1: number, samples = 48): THREE.Shape {
  const shape = new THREE.Shape();
  for (let i = 0; i <= samples; i++) {
    const t = a0 + ((a1 - a0) * i) / samples;
    const x = Math.cos(t) * outerRadius;
    const y = Math.sin(t) * outerRadius;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  for (let i = samples; i >= 0; i--) {
    const t = a0 + ((a1 - a0) * i) / samples;
    shape.lineTo(Math.cos(t) * innerRadius, Math.sin(t) * innerRadius);
  }
  shape.closePath();
  return shape;
}

/** Shape from a list of [x, y] points (closed automatically). */
export function polygonShape(points: ReadonlyArray<readonly [number, number]>): THREE.Shape {
  const shape = new THREE.Shape();
  points.forEach(([x, y], i) => (i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y)));
  shape.closePath();
  return shape;
}

/** Rounded rectangle centered on the origin (x = width, y = depth). */
export function roundedRectShape(width: number, depth: number, radius: number): THREE.Shape {
  const w = width / 2;
  const d = depth / 2;
  const r = Math.min(radius, w, d);
  const s = new THREE.Shape();
  s.moveTo(-w + r, -d);
  s.lineTo(w - r, -d);
  s.quadraticCurveTo(w, -d, w, -d + r);
  s.lineTo(w, d - r);
  s.quadraticCurveTo(w, d, w - r, d);
  s.lineTo(-w + r, d);
  s.quadraticCurveTo(-w, d, -w, d - r);
  s.lineTo(-w, -d + r);
  s.quadraticCurveTo(-w, -d, -w + r, -d);
  return s;
}

/**
 * Extrude a 2D outline (drawn in the XY plane as seen from ABOVE) upward
 * along +Y, occupying y ∈ [0, height] including the bevel.
 */
export function extrudeUp(shape: THREE.Shape, height: number, bevel = 0.03, curveSegments = 24): THREE.ExtrudeGeometry {
  const b = Math.min(bevel, height * 0.45);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.001, height - 2 * b),
    bevelEnabled: b > 0,
    bevelThickness: b,
    bevelSize: b,
    bevelSegments: 2,
    curveSegments,
  });
  // Extrusion runs along +Z. rotateX(-90°) maps (x, y, z) -> (x, z, -y):
  // depth goes to +Y and a shape point at polar angle θ lands at world
  // angle θ (see the convention at the top of this file).
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, b, 0);
  return geometry;
}

/**
 * Extrude a 2D outline drawn in a VERTICAL plane (x = radial distance,
 * y = height) with a small thickness along Z, centered on z = 0. Used for
 * fins, claws and other side-profile parts.
 */
export function extrudeSide(shape: THREE.Shape, thickness: number, bevel = 0.015): THREE.ExtrudeGeometry {
  const b = Math.min(bevel, thickness * 0.45);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.001, thickness - 2 * b),
    bevelEnabled: b > 0,
    bevelThickness: b,
    bevelSize: b,
    bevelSegments: 1,
    curveSegments: 16,
  });
  geometry.translate(0, 0, -thickness / 2 + b);
  return geometry;
}

/** Small hex bolt head standing on y = 0. */
export function boltHead(radius: number, height: number, material: THREE.Material): THREE.Mesh {
  return mesh(facet(new THREE.CylinderGeometry(radius, radius, height, 6)).translate(0, height / 2, 0), material);
}

/** Horizontal torus (ring lying flat) centered at y = 0. */
export function flatTorus(radius: number, tube: number, material: THREE.Material, radialSegments = 16, tubularSegments = 96): THREE.Mesh {
  const geometry = new THREE.TorusGeometry(radius, tube, radialSegments, tubularSegments);
  geometry.rotateX(Math.PI / 2);
  return mesh(geometry, material);
}

/** Cylinder standing on y = 0. */
export function cylinderUp(radiusTop: number, radiusBottom: number, height: number, material: THREE.Material, segments = 64): THREE.Mesh {
  return mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments).translate(0, height / 2, 0), material);
}

/** Flat annulus (washer) standing on y = 0. */
export function annulus(innerRadius: number, outerRadius: number, height: number, material: THREE.Material, bevel = 0.02): THREE.Mesh {
  return mesh(extrudeUp(polarShape(() => outerRadius, 128, innerRadius), height, bevel), material);
}
