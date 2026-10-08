// ============================================================
// RAIL VISUAL — temporary placeholder for the rails of a stage (Rail Grinding 0.51.0)
// A thin glowing tube along each rail's route. Presentation only: it reads the RailDefinition and never touches physics. The final
// rail art is an owner decision still to come (docs/planning/RAIL_GRINDING_FUTURE_UPDATE.md); this just makes the route visible.
// ============================================================

import * as THREE from 'three';
import type { RailDefinition } from '../arena/rails/RailBlueprint';

export const RAIL_VISUAL_RADIUS_M = 0.07;
export const RAIL_VISUAL_COLOR_HEX = 0x7fe8ff;

/** One group holding a tube per rail. The caller owns the group (disposal is the scene traversal's). */
export function createRailVisuals(rails: readonly RailDefinition[]): THREE.Group {
  const group = new THREE.Group();
  group.name = 'rails';
  for (const rail of rails) {
    if (!rail.enabled) continue;
    const points = rail.path.points.map((p) => new THREE.Vector3(p.x, p.y, p.z));
    const curve = new THREE.CatmullRomCurve3(points, rail.path.closed, 'catmullrom', 0.2);
    const geometry = new THREE.TubeGeometry(curve, Math.max(8, points.length * 2), RAIL_VISUAL_RADIUS_M, 8, rail.path.closed);
    const material = new THREE.MeshBasicMaterial({ color: RAIL_VISUAL_COLOR_HEX });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `rail:${rail.id}`;
    group.add(mesh);
  }
  return group;
}
