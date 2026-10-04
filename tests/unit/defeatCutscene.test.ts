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

  /** The lowest point of the Bey's model / pieces each frame, against a floor at 0. */
  function run(launchVelocity: { x: number; y: number; z: number }, knockedOut: boolean) {
    const { scene, group, spinGroup } = fourPieceBey();
    const cut = new DefeatCutscene({ visual: { group, spinGroup }, launchVelocity, knockedOut, gravityScale: 3.6, floorHeightAt: () => 0, onDone: () => undefined });
    let lowest = Infinity;
    let highest = -Infinity;
    let maxRadius = 0;
    const box = new THREE.Box3();
    for (let i = 0; i < 60 * 8; i++) {
      cut.update(1 / 60);
      scene.updateMatrixWorld(true);
      for (const name of PIECE_ORDER) {
        box.setFromObject(scene.getObjectByName(name)!);
        lowest = Math.min(lowest, box.min.y);
        highest = Math.max(highest, box.min.y);
        maxRadius = Math.max(maxRadius, Math.hypot(box.max.x, box.max.z), Math.hypot(box.min.x, box.min.z));
      }
    }
    return { lowest, highest, maxRadius };
  }

  it('owner, 2026-10-04: a knock-out that is not thrown far still pops up and bounces — never through the floor', () => {
    const r = run({ x: 0.5, y: 0, z: 0 }, true);
    expect(r.lowest).toBeGreaterThan(-0.02);
    expect(r.highest).toBeGreaterThan(0.3); // it really bounced
  });

  it('a spin-out keels over ONTO the floor (its rim never sinks in), and the pieces rest on it', () => {
    const r = run({ x: 0, y: 0, z: 0 }, false);
    expect(r.lowest).toBeGreaterThan(-0.02);
  });

  it('a hard knock-out toward the wall bounces off it: nothing leaves the arena', () => {
    const r = run({ x: 40, y: 2, z: 0 }, true);
    expect(r.lowest).toBeGreaterThan(-0.02);
    expect(r.maxRadius).toBeLessThan(36);
  });
});
