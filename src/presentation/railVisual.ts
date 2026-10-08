// ============================================================
// RAIL VISUAL — temporary placeholder for the rails of a stage (Rail Grinding 0.52.0)
// A thin glowing tube along each rail's route. Presentation only: it reads the RailDefinition and never touches physics. The final
// rail art is an owner decision still to come (docs/planning/RAIL_GRINDING_FUTURE_UPDATE.md); this just makes the route visible.
// ============================================================

import * as THREE from 'three';
import type { RailDefinition } from '../arena/rails/RailBlueprint';

export const RAIL_VISUAL_RADIUS_M = 0.07;
export const RAIL_VISUAL_COLOR_HEX = 0x7fe8ff;

/** One group holding a tube per rail. The caller owns the group (disposal is the scene traversal's). */
export function createRailVisuals(rails: readonly RailDefinition[], radiusM: number = RAIL_VISUAL_RADIUS_M): THREE.Group {
  const group = new THREE.Group();
  group.name = 'rails';
  for (const rail of rails) {
    if (!rail.enabled) continue;
    const points = rail.path.points.map((p) => new THREE.Vector3(p.x, p.y, p.z));
    const curve = new THREE.CatmullRomCurve3(points, rail.path.closed, 'catmullrom', 0.2);
    // One segment per ~1.5 m is as smooth as the eye can tell at this thickness (the 240-point route used to be drawn with 480
    // segments × 8 sides = 7,700 triangles a rail; this is ~1,200).
    const tubular = Math.max(16, Math.min(240, Math.round(rail.path.lengthM / 1.5)));
    const geometry = new THREE.TubeGeometry(curve, tubular, radiusM, 6, rail.path.closed);
    const material = new THREE.MeshBasicMaterial({ color: RAIL_VISUAL_COLOR_HEX, fog: false });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `rail:${rail.id}`;
    group.add(mesh);
  }
  return group;
}

export const RAIL_GATE_COLOR_HEX = 0xffd166;

/**
 * A ring at each end of every rail, facing along the route: the entrance a Bey jumps through (Rail Course Lab, 0.54.0).
 * `reachM` is the size of the ring — the rail's capture reach, so the ring shows what the Bey has to hit.
 */
export function createRailGateMarkers(rails: readonly RailDefinition[], reachM: number, floorYAt?: (x: number, z: number) => number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'rail-gates';
  const geometry = new THREE.TorusGeometry(reachM, Math.max(0.05, reachM * 0.05), 8, 40);
  const material = new THREE.MeshBasicMaterial({ color: RAIL_GATE_COLOR_HEX, transparent: true, opacity: 0.85, fog: false });
  for (const rail of rails) {
    if (!rail.enabled) continue;
    for (const end of [0, rail.path.lengthM]) {
      const sample = rail.path.sampleAt(end);
      const ring = new THREE.Mesh(geometry, material);
      ring.position.set(sample.position.x, sample.position.y, sample.position.z);
      ring.lookAt(sample.position.x + sample.tangent.x, sample.position.y + sample.tangent.y, sample.position.z + sample.tangent.z);
      ring.name = `rail-gate:${rail.id}:${end === 0 ? 'start' : 'end'}`;
      group.add(ring);
      if (floorYAt) {
        // A post from the floor up to the ring, so the entrance can be found from above and from afar.
        const floorY = floorYAt(sample.position.x, sample.position.z);
        const height = Math.max(0.1, sample.position.y - floorY);
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, height, 6), material);
        post.position.set(sample.position.x, floorY + height / 2, sample.position.z);
        group.add(post);
      }
    }
  }
  return group;
}
