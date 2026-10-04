// Owner, 2026-10-04: a knock-out sends the defeated Bey flying, then destroys it into its four pieces, which scatter
// in slow motion; only then is the winner announced.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DEFEAT_PRE_BREAK_TICKS, DEFEAT_SLOW_MOTION_S, DefeatCutscene } from '../../src/app/frontend/DefeatCutscene';
import { PIECE_ORDER } from '../../src/bey/visual/model/assembleConcept';
import { FIXED_DELTA_SECONDS } from '../../src/physics/fixed-step/FixedTimestepLoop';

function fourPieceBey(): { scene: THREE.Scene; group: THREE.Group; spinGroup: THREE.Group } {
  const scene = new THREE.Scene();
  const group = new THREE.Group();
  const spinGroup = new THREE.Group();
  const model = new THREE.Group();
  for (const name of PIECE_ORDER) {
    const piece = new THREE.Group();
    piece.name = name;
    piece.add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.3)));
    model.add(piece);
  }
  spinGroup.add(model);
  group.add(spinGroup);
  group.position.set(0, 0.3, 0);
  scene.add(group);
  return { scene, group, spinGroup };
}

describe('defeat cutscene', () => {
  it('flies off with the knock-out velocity, breaks into the four pieces, then announces after 1 s + 1.5 s', () => {
    const { scene, group, spinGroup } = fourPieceBey();
    let broke = -1;
    let done = -1;
    const cut = new DefeatCutscene({ visual: { group, spinGroup }, launchVelocity: { x: 12, y: 3, z: 0 }, floorHeightAt: () => 0, onBreak: () => (broke = t), onDone: () => (done = t) });
    let t = 0;
    let farthest = 0;
    while (!cut.isDone && t < 10) {
      cut.update(1 / 60);
      t += 1 / 60;
      if (broke < 0) {
        const p = new THREE.Vector3();
        spinGroup.children[0]!.getWorldPosition(p);
        farthest = Math.max(farthest, p.x);
      }
    }
    expect(farthest).toBeGreaterThan(3); // it flew
    expect(broke).toBeCloseTo(DEFEAT_PRE_BREAK_TICKS * FIXED_DELTA_SECONDS, 1);
    expect(done).toBeCloseTo(DEFEAT_PRE_BREAK_TICKS * FIXED_DELTA_SECONDS + DEFEAT_SLOW_MOTION_S, 1);
    // The four pieces now live in the scene, apart from each other.
    const pieces = PIECE_ORDER.map((n) => scene.getObjectByName(n)!);
    expect(pieces.every((p) => p.parent === scene)).toBe(true);
    const spread = pieces.map((p) => p.position.clone());
    expect(spread[0]!.distanceTo(spread[2]!)).toBeGreaterThan(0.5);
  });
});
