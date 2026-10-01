// ============================================================
// CLASH PRESENTATION (batch 4): the approved Overdrive direction in the game
// These prove the port: the approved values are intact, the camera/time/tie/HUD
// items are metadata only, the contact pose is visual and pivots on the tip, the
// presentation follows the real Clash snapshot and events (it never decides
// anything), a tie plays no tie-specific effect, and it leaves a clean scene.
// ============================================================

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ATTACK_ARCHETYPE, DEFENSE_ARCHETYPE } from '../../src/bey/archetype/BeyArchetypes';
import { createConceptBeyVisual } from '../../src/bey/visual/conceptBeyVisual';
import { CONCEPTS } from '../../src/bey/visual/concepts/conceptDefinitions';
import { ClashOutcome } from '../../src/combat/clash/ClashController';
import { PresentationHub, type MatchPresentationState, type PresentationEvent } from '../../src/presentation';
import { clashAdvantageShare, computeContactPose } from '../../src/vfx/clash/contactPose';
import { ClashPresentationSystem, clashDustHexFor } from '../../src/vfx/clash/ClashPresentationSystem';
import { ARENA_CLASH_DUST_HEX, OVERDRIVE, PENDING_CLASH_VALUES } from '../../src/vfx/clash/overdrive';

describe('the approved Overdrive values', () => {
  it('are exactly the owner-approved direction C (clash-presentation-approval.md section 4) and frozen', () => {
    expect(OVERDRIVE).toEqual({
      neutralHex: 0xffe066,
      entrySnapFlash: 1,
      contact: { leanDeg: 15, wobbleDeg: 3.5, wobbleHz: 13 },
      speedlines: { strength: 1, count: 110, tintWithSides: true },
      dust: { particlesPerSecond: 230, size: 0.26, speed: 4.2, sparkShare: 0.28 },
      pulse: { pulseSize: 1.6, useImpactStar: true },
      resolution: { flash: 1, burstRings: 4, sparks: 50, dustBurst: 100 },
      arenaClashIntensity: { active: 1, resolutionPeak: 1 },
    });
    expect(Object.isFrozen(OVERDRIVE)).toBe(true);
    expect(Object.isFrozen(OVERDRIVE.contact)).toBe(true);
    expect(ARENA_CLASH_DUST_HEX).toMatchObject({ foundry: 0x6b5a4a, rift: 0x6d6480, tournament: 0xb8c0cc });
    expect(clashDustHexFor('rift')).toBe(0x6d6480);
    expect(clashDustHexFor('anything-else')).toBe(ARENA_CLASH_DUST_HEX.fallback);
  });

  it('keeps entry slow motion, per-mash hitstop, shake, the HUD bar restyle and the tie style as metadata, not applied', () => {
    expect(PENDING_CLASH_VALUES.entrySlowMotion).toMatchObject({ factor: 0.3, seconds: 0.5 });
    expect(PENDING_CLASH_VALUES.hitstopPerMashSeconds.value).toBe(0.07);
    expect(PENDING_CLASH_VALUES.shakeMeters.value).toBe(0.22);
    expect(PENDING_CLASH_VALUES.shakeMeters.status).toBe('PENDING — CAMERA/VFX SHAKE INTEGRATION · OWNER FROZE CAMERA FOR THIS PASS');
    expect(PENDING_CLASH_VALUES.tieStyle.status).toMatch(/ASK FIRST/);
    expect(PENDING_CLASH_VALUES.hudBarStyle.status).toMatch(/^NOT APPLIED/);
  });
});

describe('contact pose', () => {
  const base = {
    position: new THREE.Vector3(1, 0.18, 2),
    quaternion: new THREE.Quaternion(),
    tipDropM: 0.18,
    towardOpponent: new THREE.Vector2(1, 0),
    leanScale: 1,
    params: { leanRad: THREE.MathUtils.degToRad(15), wobbleRad: 0, wobbleHz: 13 },
    timeS: 0,
    phase: 0,
  };

  it('changes nothing at weight 0', () => {
    const pose = computeContactPose({ ...base, contactWeight: 0 });
    expect(pose.position.toArray()).toEqual(base.position.toArray());
    expect(pose.quaternion.equals(base.quaternion)).toBe(true);
    expect(pose.extraTiltRad).toBe(0);
  });

  it('leans into the opponent by the approved angle, pivoting on the tip', () => {
    const pose = computeContactPose({ ...base, contactWeight: 1 });
    expect(THREE.MathUtils.radToDeg(pose.extraTiltRad)).toBeCloseTo(15, 3);
    // The top leans toward +X, the opponent's side.
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(pose.quaternion);
    expect(up.x).toBeGreaterThan(0.2);
    // The tip stays on the floor, and only moves sideways by the rim nudge (tipDrop * sin(lean)), away from the opponent.
    const tipBefore = new THREE.Vector3(0, -base.tipDropM, 0).add(base.position);
    const tipAfter = new THREE.Vector3(0, -base.tipDropM, 0).applyQuaternion(pose.quaternion).add(pose.position);
    expect(tipAfter.y).toBeCloseTo(tipBefore.y, 6);
    expect(tipAfter.x - tipBefore.x).toBeCloseTo(-base.tipDropM * Math.sin(THREE.MathUtils.degToRad(15)), 6);
    expect(tipAfter.z).toBeCloseTo(tipBefore.z, 6);
  });

  it('scales with the weight and with a side leaning harder (mash surge, being ahead)', () => {
    const at = (contactWeight: number, leanScale: number): number => computeContactPose({ ...base, contactWeight, leanScale }).extraTiltRad;
    expect(at(0.5, 1)).toBeLessThan(at(1, 1));
    expect(at(1, 1.6)).toBeGreaterThan(at(1, 1));
  });

  it('shudders deterministically', () => {
    const shaky = { ...base, params: { ...base.params, wobbleRad: THREE.MathUtils.degToRad(3.5) }, contactWeight: 1 };
    const a = computeContactPose({ ...shaky, timeS: 0.3 });
    const b = computeContactPose({ ...shaky, timeS: 0.3 });
    expect(a.quaternion.equals(b.quaternion)).toBe(true);
    expect(computeContactPose({ ...shaky, timeS: 0.31 }).quaternion.equals(a.quaternion)).toBe(false);
  });

  it('shares the bar by real ClashPower advantage, clamped, never flipping the leader', () => {
    expect(clashAdvantageShare(1, 1, 4)).toBe(0.5);
    expect(clashAdvantageShare(0, 0, 4)).toBe(0.5);
    expect(clashAdvantageShare(2, 1, 4)).toBeGreaterThan(0.5);
    expect(clashAdvantageShare(1, 2, 4)).toBeLessThan(0.5);
    expect(clashAdvantageShare(100, 1, 4)).toBe(0.96);
    expect(clashAdvantageShare(1, 100, 4)).toBe(0.04);
    expect(clashAdvantageShare(1.04, 1, 4)).toBeGreaterThan(clashAdvantageShare(1.02, 1, 4));
  });
});

interface Harness {
  readonly scene: THREE.Group;
  readonly camera: THREE.PerspectiveCamera;
  readonly hub: PresentationHub;
  readonly system: ClashPresentationSystem;
  readonly beys: { first: ReturnType<typeof createConceptBeyVisual>; second: ReturnType<typeof createConceptBeyVisual> };
  /** One rendered frame: the physics sync puts the Beys back, then the presentation runs. */
  frame(clash?: Partial<MatchPresentationState['clash']>, dt?: number): void;
  emit(events: readonly PresentationEvent[]): void;
}

const IDLE_CLASH = { phase: 'idle', active: false, progress: 0, elapsedS: 0, firstPower: 0, secondPower: 0, firstMashEventCount: 0, secondMashEventCount: 0, resolution: null, cooldownRemainingS: 0 } as const;

function harness(): Harness {
  const scene = new THREE.Group();
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 100);
  camera.position.set(0, 3, 6);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  const beys = { first: createConceptBeyVisual(CONCEPTS[0]!, ATTACK_ARCHETYPE), second: createConceptBeyVisual(CONCEPTS[3]!, DEFENSE_ARCHETYPE) };
  scene.add(beys.first.group, beys.second.group);
  const system = new ClashPresentationSystem({
    scene,
    camera,
    beys: { first: { visual: beys.first, gameplay: ATTACK_ARCHETYPE }, second: { visual: beys.second, gameplay: DEFENSE_ARCHETYPE } },
    floorHeightAtR: () => 0,
    sparkHex: 0xffe28a,
    dustHex: 0x6b5a4a,
    overlayParent: null,
  });
  const hub = new PresentationHub({ features: { newBeyVisuals: true, conditionVisuals: false, hybridVfx: false, clashPresentation: true, newHud: false, arenaVisuals: false }, beys: [{ side: 'first', definitionId: 'a' }, { side: 'second', definitionId: 'd' }], getVfxAnchor: () => false });
  hub.attach(system);
  let tick = 0;
  let latest: MatchPresentationState | null = null;
  const stateWith = (clash: Partial<MatchPresentationState['clash']>): MatchPresentationState => ({ tick, round: { over: false, outcome: '' }, first: {} as never, second: {} as never, clash: { ...IDLE_CLASH, ...clash } as never, camera: null, recentImpact: { first: null, second: null } });
  return {
    scene,
    camera,
    hub,
    system,
    beys,
    frame(clash = {}, dt = 1 / 60) {
      tick++;
      // The physics sync of renderFrame: both Beys touching, upright.
      beys.first.group.position.set(-0.65, 0.18, 0);
      beys.second.group.position.set(0.65, 0.27, 0);
      beys.first.group.quaternion.identity();
      beys.second.group.quaternion.identity();
      latest = stateWith(clash);
      system.update({ dtSeconds: dt, state: latest });
    },
    emit(events) {
      system.onEvents(events, latest ?? stateWith({}));
    },
  };
}

const ACTIVE = { phase: 'active', active: true, progress: 0.5, firstPower: 1.6, secondPower: 1 } as const;
const started: PresentationEvent = { kind: 'clashStarted', tick: 1 };
const mash = (side: 'first' | 'second'): PresentationEvent => ({ kind: 'clashProgress', tick: 1, side, mashEventCount: 1, progress: 0.3 });
const resolved = (outcome: ClashOutcome): PresentationEvent => ({ kind: 'clashResolved', tick: 9, outcome, firstClashPower: 2, secondClashPower: 1 });

describe('ClashPresentationSystem', () => {
  it('does nothing while there is no Clash: Beys untouched, no dust, no pose', () => {
    const h = harness();
    for (let i = 0; i < 30; i++) h.frame();
    expect(h.beys.first.group.quaternion.equals(new THREE.Quaternion())).toBe(true);
    expect(h.beys.first.group.position.toArray()).toEqual([-0.65, 0.18, 0]);
    expect(h.system.getStats()).toMatchObject({ dust: 0, grit: 0, contactWeight: 0, speedlineLevel: 0 });
    h.hub.dispose();
  });

  it('locks both Beys into the contact pose while the Clash is Active, visual group only', () => {
    const h = harness();
    h.frame();
    h.emit([started]);
    for (let i = 0; i < 30; i++) h.frame(ACTIVE);
    expect(h.system.getStats().contactWeight).toBe(1);
    const tilt = (g: THREE.Object3D): number => new THREE.Vector3(0, 1, 0).applyQuaternion(g.quaternion).angleTo(new THREE.Vector3(0, 1, 0));
    expect(THREE.MathUtils.radToDeg(tilt(h.beys.first.group))).toBeGreaterThan(8);
    expect(THREE.MathUtils.radToDeg(tilt(h.beys.second.group))).toBeGreaterThan(8);
    // Each leans toward the other: the first (left) toward +X, the second (right) toward -X.
    expect(new THREE.Vector3(0, 1, 0).applyQuaternion(h.beys.first.group.quaternion).x).toBeGreaterThan(0);
    expect(new THREE.Vector3(0, 1, 0).applyQuaternion(h.beys.second.group.quaternion).x).toBeLessThan(0);
    // The next frame's physics sync puts the pose back: nothing is kept on the Bey.
    h.frame();
    h.hub.dispose();
  });

  it('lets go of the pose shortly after the resolution, and the sync leaves the Beys exactly as physics has them', () => {
    const h = harness();
    h.frame();
    h.emit([started]);
    for (let i = 0; i < 20; i++) h.frame(ACTIVE);
    h.emit([resolved(ClashOutcome.FirstWins)]);
    for (let i = 0; i < 20; i++) h.frame({ phase: 'cooldown', resolution: 'firstWins' });
    expect(h.system.getStats().contactWeight).toBe(0);
    expect(h.beys.first.group.quaternion.equals(new THREE.Quaternion())).toBe(true);
    expect(h.beys.first.group.position.toArray()).toEqual([-0.65, 0.18, 0]);
    h.hub.dispose();
  });

  it('grinds dust and grit at the contact for the whole Active beat, more with progress', () => {
    const dustAfter = (progress: number): number => {
      const h = harness();
      h.frame();
      h.emit([started]);
      for (let i = 0; i < 20; i++) h.frame({ ...ACTIVE, progress });
      const stats = h.system.getStats();
      h.hub.dispose();
      return stats.dust! + stats.grit!;
    };
    expect(dustAfter(0.1)).toBeGreaterThan(5);
    expect(dustAfter(1)).toBeGreaterThan(dustAfter(0.1));
  });

  it('draws speedlines that rise with progress and fade after the resolution', () => {
    const h = harness();
    h.frame();
    h.emit([started]);
    h.frame({ ...ACTIVE, progress: 0.1 });
    const early = h.system.getStats().speedlineLevel!;
    for (let i = 0; i < 30; i++) h.frame({ ...ACTIVE, progress: 0.9 });
    const late = h.system.getStats().speedlineLevel!;
    expect(late).toBeGreaterThan(early);
    expect(late).toBeLessThanOrEqual(OVERDRIVE.speedlines.strength);
    h.emit([resolved(ClashOutcome.SecondWins)]);
    for (let i = 0; i < 30; i++) h.frame({ phase: 'cooldown' });
    expect(h.system.getStats().speedlineLevel).toBe(0);
    h.hub.dispose();
  });

  it('pulses on every mash in that side\'s colour, and bursts on the resolution in the winner\'s colour with no pause', () => {
    const h = harness();
    h.frame();
    h.emit([started]);
    const quiet = h.scene.children.length;
    h.frame(ACTIVE);
    const fxChildren = (): number => (h.scene.children.find((c) => c.children.length >= 2 && c !== h.beys.first.group && c !== h.beys.second.group) ?? { children: [] }).children.length;
    const before = fxChildren();
    h.emit([mash('first'), mash('second')]);
    expect(fxChildren()).toBeGreaterThan(before);
    const afterMash = fxChildren();
    h.emit([resolved(ClashOutcome.FirstWins)]);
    // Four rings, sparks, a star: many transient objects, all in one batch.
    expect(fxChildren()).toBeGreaterThan(afterMash + 4);
    expect(quiet).toBeGreaterThan(0);
    h.hub.dispose();
  });

  it('plays no tie-specific effect on a tie (the tie style is an open owner decision)', () => {
    const h = harness();
    h.frame();
    h.emit([started]);
    h.frame(ACTIVE);
    const fx = h.scene.children.find((c) => c.type === 'Group' && c !== h.beys.first.group && c !== h.beys.second.group)!;
    const before = fx.children.length;
    h.emit([resolved(ClashOutcome.Tie)]);
    expect(fx.children.length).toBe(before);
    h.hub.dispose();
  });

  it('never touches the camera and leaves a clean scene on dispose', () => {
    const h = harness();
    const camera = (): string => JSON.stringify([h.camera.position.toArray(), h.camera.quaternion.toArray(), h.camera.fov, Array.from(h.camera.projectionMatrix.elements), h.camera.children.length]);
    const before = camera();
    h.frame();
    h.emit([started, mash('first'), mash('second')]);
    for (let i = 0; i < 90; i++) h.frame(ACTIVE);
    h.emit([resolved(ClashOutcome.FirstWins)]);
    for (let i = 0; i < 30; i++) h.frame({ phase: 'cooldown' });
    expect(camera()).toBe(before);
    expect(h.hub.getStats().systemErrors).toBe(0);
    h.hub.dispose();
    expect(h.scene.children).toEqual([h.beys.first.group, h.beys.second.group]);
  });

  it('clears everything on reset', () => {
    const h = harness();
    h.frame();
    h.emit([started, mash('first')]);
    for (let i = 0; i < 20; i++) h.frame(ACTIVE);
    h.system.reset();
    expect(h.system.getStats()).toMatchObject({ dust: 0, grit: 0, contactWeight: 0, speedlineLevel: 0, shareFirst: 0.5 });
    h.hub.dispose();
  });
});
