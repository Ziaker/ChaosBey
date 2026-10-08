// ============================================================
// FLOW FX (Fluxo do Bey, in the game): the owner's numbers are the defaults, every effect
// is a Settings slider, the saved settings migrate forgivingly, and the presentation system
// is driven by what the match really did (events and state), stays presentation-only (it writes
// nothing the simulation reads) and cleans up after itself.
// ============================================================

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ATTACK_ARCHETYPE, DEFENSE_ARCHETYPE } from '../../src/bey/archetype/BeyArchetypes';
import { createConceptBeyVisual } from '../../src/bey/visual/conceptBeyVisual';
import { CONCEPTS } from '../../src/bey/visual/concepts/conceptDefinitions';
import { AttackState } from '../../src/combat/attacks/AttackController';
import { DEFAULT_PLAYER_SETTINGS, sanitizePlayerSettings } from '../../src/config/settings/PlayerSettings';
import { DodgeState } from '../../src/dodge/DodgeController';
import { PresentationHub, selectBeyPresentationState, type MatchPresentationState, type PresentationEvent } from '../../src/presentation';
import { COMIC_WORDS, ComicWords } from '../../src/vfx/flow/ComicWords';
import { FlowFxSystem } from '../../src/vfx/flow/FlowFxSystem';
import {
  DEFAULT_FLOW_FX_SETTINGS,
  DUST_STYLE_IDS,
  FLOW_FX_DEFAULT_VALUES,
  FLOW_FX_GROUP_ORDER,
  FLOW_FX_GROUP_TITLES,
  FLOW_FX_SPEC,
  sanitizeFlowFxSettings,
  withFlowFxValue,
  type FlowFxValues,
} from '../../src/vfx/flow/flowFxTuning';

const OWNER_NUMBERS: FlowFxValues = {
  intensity: 1,
  blurStrength: 1.35,
  leanMaxDeg: 26,
  leanAccelRefMps2: 13,
  leanSmooth: 9,
  shadowOpacity: 0.5,
  shadowScale: 0.9,
  dustOpacity: 1,
  dustFade: 0.95,
  dustShrink: 0.5,
  dustRate: 4,
  dustSizeM: 0.4,
  dustLifeS: 0.3,
  dustDashBoost: 2.5,
  windRate: 30,
  windLengthM: 1.1,
  windWidthM: 0.25,
  windLifeS: 0.25,
  crownCount: 2,
  crownSizeM: 6.1,
  burstSizeM: 1.4,
  calloutScale: 0.55,
  calloutLifeS: 0.55,
};

describe('flow fx — the values', () => {
  it("the defaults are the owner's own numbers from the lab's tuning panel (2026-10-08), frozen", () => {
    expect(FLOW_FX_DEFAULT_VALUES).toEqual(OWNER_NUMBERS);
    expect(Object.isFrozen(FLOW_FX_DEFAULT_VALUES)).toBe(true);
    expect(DEFAULT_FLOW_FX_SETTINGS.dustStyle).toBe('wave'); // Q, the composition the owner called acceptable
    expect(DEFAULT_FLOW_FX_SETTINGS.comicWords).toBe(true);
  });

  it('has one slider per value, inside a known group, with the default inside its range', () => {
    const keys = FLOW_FX_SPEC.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(keys)).toEqual(new Set(Object.keys(FLOW_FX_DEFAULT_VALUES)));
    for (const spec of FLOW_FX_SPEC) {
      expect(FLOW_FX_GROUP_ORDER, spec.key).toContain(spec.group);
      const v = FLOW_FX_DEFAULT_VALUES[spec.key];
      expect(v, spec.key).toBeGreaterThanOrEqual(spec.min);
      expect(v, spec.key).toBeLessThanOrEqual(spec.max);
      expect(spec.step, spec.key).toBeGreaterThan(0);
      expect(spec.label.length, spec.key).toBeGreaterThan(5);
    }
    for (const g of FLOW_FX_GROUP_ORDER) {
      expect(FLOW_FX_GROUP_TITLES[g].length).toBeGreaterThan(3);
      expect(FLOW_FX_SPEC.some((s) => s.group === g), g).toBe(true);
    }
  });

  it('every cloud setting the owner asked for is there: opacity, opacity over the life, and the shrink', () => {
    for (const key of ['dustOpacity', 'dustFade', 'dustShrink'] as const) expect(FLOW_FX_SPEC.some((s) => s.key === key)).toBe(true);
    const fade = FLOW_FX_SPEC.find((s) => s.key === 'dustFade')!;
    expect([fade.min, fade.max]).toEqual([0, 1]);
  });

  it('sanitize clamps to the range, ignores junk, and falls back field by field', () => {
    const s = sanitizeFlowFxSettings({ dustStyle: 'nope', comicWords: 'yes', values: { dustRate: -9, windWidthM: 99, leanMaxDeg: Number.NaN, blurStrength: '1' } });
    expect(s.dustStyle).toBe('wave');
    expect(s.comicWords).toBe(true);
    expect(s.values.dustRate).toBe(FLOW_FX_SPEC.find((x) => x.key === 'dustRate')!.min);
    expect(s.values.windWidthM).toBe(FLOW_FX_SPEC.find((x) => x.key === 'windWidthM')!.max);
    expect(s.values.leanMaxDeg).toBe(OWNER_NUMBERS.leanMaxDeg);
    expect(s.values.blurStrength).toBe(OWNER_NUMBERS.blurStrength);
    expect(sanitizeFlowFxSettings(undefined)).toEqual(DEFAULT_FLOW_FX_SETTINGS);
    expect(sanitizeFlowFxSettings('garbage')).toEqual(DEFAULT_FLOW_FX_SETTINGS);
    for (const id of DUST_STYLE_IDS) expect(sanitizeFlowFxSettings({ dustStyle: id }).dustStyle).toBe(id);
    expect(sanitizeFlowFxSettings({ comicWords: false }).comicWords).toBe(false);
  });

  it('withFlowFxValue changes one slider, clamped, and leaves the rest and the input alone', () => {
    const next = withFlowFxValue(DEFAULT_FLOW_FX_SETTINGS, 'dustFade', 5);
    expect(next.values.dustFade).toBe(1);
    expect(next.values.dustRate).toBe(OWNER_NUMBERS.dustRate);
    expect(DEFAULT_FLOW_FX_SETTINGS.values.dustFade).toBe(OWNER_NUMBERS.dustFade);
    expect(withFlowFxValue(DEFAULT_FLOW_FX_SETTINGS, 'shadowOpacity', -1).values.shadowOpacity).toBe(0);
  });
});

describe('flow fx — player settings', () => {
  it('a new install and an old save (no flowFx) both start on the owner defaults', () => {
    expect(DEFAULT_PLAYER_SETTINGS.flowFx).toEqual(DEFAULT_FLOW_FX_SETTINGS);
    expect(sanitizePlayerSettings({}).flowFx).toEqual(DEFAULT_FLOW_FX_SETTINGS);
    expect(sanitizePlayerSettings({ quality: 'Low', hitFlash: false }).flowFx).toEqual(DEFAULT_FLOW_FX_SETTINGS);
  });

  it('keeps what the player saved and survives a JSON round trip', () => {
    const saved = { ...DEFAULT_PLAYER_SETTINGS, flowFx: { dustStyle: 'cloud', comicWords: false, values: { ...OWNER_NUMBERS, dustRate: 12, shadowOpacity: 0.2 } } };
    const back = sanitizePlayerSettings(JSON.parse(JSON.stringify(saved)));
    expect(back.flowFx.dustStyle).toBe('cloud');
    expect(back.flowFx.comicWords).toBe(false);
    expect(back.flowFx.values.dustRate).toBe(12);
    expect(back.flowFx.values.shadowOpacity).toBe(0.2);
    expect(back.flowFx.values.leanMaxDeg).toBe(26);
  });
});

describe('flow fx — comic words', () => {
  it('has the two words the game can raise; BLOCK has no rule yet', () => {
    expect(COMIC_WORDS).toEqual({ hit: 'HIT', counter: 'COUNTER!' });
  });

  it('counts a word even without a DOM, and draws nothing there', () => {
    const cam = new THREE.PerspectiveCamera(60, 1.6, 0.1, 100);
    cam.position.set(0, 3, 6);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    const words = new ComicWords(cam, null);
    words.spawn('hit', { x: 0, y: 0, z: 0 }, 0.55, 0.55, 0.7);
    expect(words.spawned).toBe(1);
    expect(words.liveCount).toBe(0);
    words.dispose();
  });
});

interface Facts {
  attackState: AttackState;
  dodgeState: DodgeState;
  speedMps: number;
  airborne: boolean;
  isBroken: boolean;
}

function harness(settings = DEFAULT_FLOW_FX_SETTINGS) {
  const scene = new THREE.Group();
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 100);
  camera.position.set(0, 3, 6);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  const beys = { first: createConceptBeyVisual(CONCEPTS[0]!, ATTACK_ARCHETYPE), second: createConceptBeyVisual(CONCEPTS[3]!, DEFENSE_ARCHETYPE) };
  const half1 = ATTACK_ARCHETYPE.physical.colliderHalfHeightM;
  const half2 = DEFENSE_ARCHETYPE.physical.colliderHalfHeightM;
  beys.first.group.position.set(-1, half1, 0);
  beys.second.group.position.set(1, half2, 0);
  scene.add(beys.first.group, beys.second.group);
  const system = new FlowFxSystem({
    scene,
    camera,
    beys: { first: { visual: beys.first, gameplay: ATTACK_ARCHETYPE }, second: { visual: beys.second, gameplay: DEFENSE_ARCHETYPE } },
    floorHeightAtR: () => 0,
    overlayParent: null,
    settings,
  });
  const hub = new PresentationHub({ features: { newBeyVisuals: true, conditionVisuals: false, hybridVfx: true, clashPresentation: false, newHud: false, arenaVisuals: false }, beys: [{ side: 'first', definitionId: 'a' }, { side: 'second', definitionId: 'd' }], getVfxAnchor: () => false });
  hub.attach(system);
  let tick = 0;
  let latest: MatchPresentationState | null = null;
  const facts = (o: Partial<Facts>) => ({
    grounded: !(o.airborne ?? false),
    driftState: 0,
    dodgeState: DodgeState.Idle,
    attackState: AttackState.Neutral,
    dashChargeFraction: 0,
    staminaFraction: 1,
    stabilityFraction: 1,
    isBroken: false,
    dashReadiness: 1,
    movement: { speedMps: o.speedMps ?? 0 },
    spin: { spinRateRadPerSec: 22, wobbleEnergy: 0, tiltRad: 0, isTumbling: false },
    ...o,
  });
  return {
    scene,
    camera,
    hub,
    system,
    beys,
    setState(overrides: { first?: Partial<Facts>; second?: Partial<Facts> } = {}, hitstopActive = false) {
      tick++;
      const first = selectBeyPresentationState(facts(overrides.first ?? {}) as never, { side: 'first', definitionId: 'a', maxSpeedMps: 10 });
      const second = selectBeyPresentationState(facts(overrides.second ?? {}) as never, { side: 'second', definitionId: 'd', maxSpeedMps: 10 });
      latest = { tick, round: { over: false, outcome: '' }, first, second, clash: {} as never, camera: { mode: 'CombatFollow', preset: 'B', fovDeg: 60, distanceM: 8, yawDeg: 0, clashBlend: 0, highSpeedBlend: 0, hitstopActive, hitstopRemainingS: 0 }, recentImpact: { first: null, second: null } };
    },
    emit(events: readonly PresentationEvent[]) {
      system.onEvents(events, latest!);
    },
    frame(dt = 1 / 60) {
      system.update({ dtSeconds: dt, state: latest });
    },
  };
}

const hit = (magnitude: number, counter = false): PresentationEvent => ({ kind: 'hitResolved', tick: 1, defenderSide: 'second', attackerSide: 'first', magnitude, position: { x: 0, y: 0.3, z: 0 }, hitboxKind: counter ? 'circular' : 'dash', caughtOpponentDashing: counter });

/**
 * Runs the first Bey at `speed` for `seconds`, one physics-like step per frame. Each frame it does what the session's sync does
 * before the presentation hub runs: the visual's pose is rewritten from the physics pose (so a lean never accumulates).
 * Returns the physics position of the tip (x, z) at the end.
 */
function runFirst(h: ReturnType<typeof harness>, seconds: number, speed: number, curve = 0): { x: number; z: number } {
  const group = h.beys.first.group;
  const y0 = group.position.y;
  let heading = 0;
  let px = group.position.x;
  let pz = group.position.z;
  for (let i = 0; i < seconds * 60; i++) {
    heading += curve / 60;
    px += (Math.cos(heading) * speed) / 60;
    pz += (Math.sin(heading) * speed) / 60;
    group.quaternion.identity();
    group.position.set(px, y0, pz);
    h.setState({ first: { speedMps: speed } });
    h.frame();
  }
  return { x: px, z: pz };
}

describe('FlowFxSystem', () => {
  it('a real hit raises the impact: shock rings, floor crowns, the star, a dust burst, and the comic word', () => {
    const h = harness();
    h.setState();
    h.frame();
    h.emit([hit(0.8)]);
    h.frame();
    const stats = h.system.getStats();
    expect(stats.fx).toBe(Math.round(OWNER_NUMBERS.crownCount) + 2 + 1); // rings + crowns + star
    expect(stats.dustPuffs).toBeGreaterThan(1);
    expect(stats.words).toBe(1);
    expect(stats.hits).toBe(1);
    h.hub.dispose();
  });

  it('every effect scales to nothing with its slider, and the intensity slider turns the whole layer off', () => {
    const off = { ...DEFAULT_FLOW_FX_SETTINGS, comicWords: false, values: { ...OWNER_NUMBERS, intensity: 0 } };
    const h = harness(off);
    h.setState();
    h.frame();
    h.emit([hit(1)]);
    runFirst(h, 1, 8);
    const stats = h.system.getStats();
    expect(stats.fx).toBe(0);
    expect(stats.dustPuffs).toBe(0);
    expect(stats.words).toBe(0);
    expect(h.system.getShadow('first').visible).toBe(false);
    h.hub.dispose();

    const noRings = harness({ ...DEFAULT_FLOW_FX_SETTINGS, values: { ...OWNER_NUMBERS, crownCount: 0 } });
    noRings.setState();
    noRings.frame();
    noRings.emit([hit(0.8)]);
    expect(noRings.system.getStats().fx).toBe(3); // the crowns and the star stay; only the rings are off
    noRings.hub.dispose();
  });

  it('the comic words can be switched off, and a counter hit says COUNTER only while that game-feel option is on', () => {
    const h = harness({ ...DEFAULT_FLOW_FX_SETTINGS, comicWords: false });
    h.setState();
    h.frame();
    h.emit([hit(0.8)]);
    expect(h.system.getStats().words).toBe(0);
    h.system.setSettings({ ...DEFAULT_FLOW_FX_SETTINGS, comicWords: true });
    h.emit([hit(0.8, true)]);
    expect(h.system.getStats().words).toBe(1);
    h.hub.dispose();
  });

  it('a Dash release fires the shock rings toward the opponent', () => {
    const h = harness();
    h.setState();
    h.frame();
    h.setState({ first: { attackState: AttackState.DashActive, speedMps: 0 } });
    h.frame();
    const stats = h.system.getStats();
    expect(stats.dashes).toBe(1);
    expect(stats.fx).toBe(Math.round(OWNER_NUMBERS.crownCount));
    const rings = h.scene.children.filter((c) => c.type === 'Group' && c !== h.beys.first.group && c !== h.beys.second.group);
    expect(rings.length).toBeGreaterThan(0);
    const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(rings[0]!.quaternion);
    expect(facing.x).toBeGreaterThan(0.99); // the opponent is at +x of the first Bey
    h.setState({ first: { attackState: AttackState.DashActive } });
    h.frame();
    expect(h.system.getStats().dashes).toBe(1); // one release per Dash, not one per frame
    h.hub.dispose();
  });

  it('a fast Bey leaves dust and wind behind its heading; a stopped one leaves none', () => {
    const h = harness({ ...DEFAULT_FLOW_FX_SETTINGS, values: { ...OWNER_NUMBERS, dustRate: 30 } });
    runFirst(h, 1.5, 9);
    expect(h.system.getStats().dustEmitted).toBeGreaterThan(5);
    expect(h.system.getStats().fx).toBeGreaterThan(5); // wind streaks
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const mesh = h.system.getDustMesh();
    let behind = 0;
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m);
      p.setFromMatrixPosition(m);
      if (p.x < h.beys.first.group.position.x) behind++;
    }
    expect(mesh.count).toBeGreaterThan(0);
    expect(behind / mesh.count).toBeGreaterThan(0.8); // travelling toward +x, the dust is at lower x
    h.hub.dispose();

    const still = harness();
    still.setState();
    for (let i = 0; i < 120; i++) still.frame();
    expect(still.system.getStats().dustEmitted).toBe(0);
    still.hub.dispose();
  });

  it('puts a small black shadow on the floor under each Bey, fading as it jumps', () => {
    const h = harness();
    h.setState();
    h.frame();
    const shadow = h.system.getShadow('first');
    const mat = shadow.material as THREE.MeshBasicMaterial;
    expect(shadow.visible).toBe(true);
    expect(mat.color.getHex()).toBe(0x000000);
    expect(shadow.position.y).toBeGreaterThan(0);
    expect(shadow.position.y).toBeLessThan(0.1); // on the floor
    expect(shadow.position.x).toBeCloseTo(h.beys.first.group.position.x);
    expect(shadow.castShadow).toBe(false);
    const grounded = mat.opacity;
    expect(grounded).toBeCloseTo(OWNER_NUMBERS.shadowOpacity);
    h.beys.first.group.position.y += 2;
    h.setState({ first: { airborne: true } });
    h.frame();
    expect(mat.opacity).toBeLessThan(grounded);
    expect(shadow.position.y).toBeLessThan(0.1); // still on the floor while the Bey is in the air
    h.system.setSettings({ ...DEFAULT_FLOW_FX_SETTINGS, values: { ...OWNER_NUMBERS, shadowOpacity: 0 } });
    h.frame();
    expect(shadow.visible).toBe(false);
    h.hub.dispose();
  });

  it('leans into a curve, bounded by the slider, and not at all when it is 0, in the air or going straight', () => {
    const lean = (settings = DEFAULT_FLOW_FX_SETTINGS, curve = 2.5): number => {
      const h = harness(settings);
      runFirst(h, 2, 9, curve);
      const deg = Math.abs(h.system.getLeanDegrees('first'));
      h.hub.dispose();
      return deg;
    };
    const curved = lean();
    expect(curved).toBeGreaterThan(3);
    expect(curved).toBeLessThanOrEqual(OWNER_NUMBERS.leanMaxDeg + 1e-6);
    expect(lean(DEFAULT_FLOW_FX_SETTINGS, 0)).toBeLessThan(2);
    expect(lean({ ...DEFAULT_FLOW_FX_SETTINGS, values: { ...OWNER_NUMBERS, leanMaxDeg: 0 } })).toBe(0);
    const big = lean({ ...DEFAULT_FLOW_FX_SETTINGS, values: { ...OWNER_NUMBERS, leanMaxDeg: 40 } });
    expect(big).toBeGreaterThan(curved * 0.9);
  });

  it('the lean pivots on the tip and only tilts the visual: the tip stays where physics put it, and the next sync restores the pose', () => {
    const h = harness();
    const group = h.beys.first.group;
    const physics = runFirst(h, 1.5, 9, 3);
    const half = ATTACK_ARCHETYPE.physical.colliderHalfHeightM;
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(group.quaternion);
    expect(up.y).toBeLessThan(0.99); // tilted
    // The point half a collider height below the origin along the Bey's own up is the tip: it is exactly where physics put it.
    const tip = group.position.clone().addScaledVector(up, -half);
    expect(tip.x).toBeCloseTo(physics.x, 5);
    expect(tip.y).toBeCloseTo(0, 5);
    expect(tip.z).toBeCloseTo(physics.z, 5);
    // The sync from physics is all it takes to undo the lean: nothing is stored on the Bey.
    group.quaternion.identity();
    group.position.set(physics.x, half, physics.z);
    expect(new THREE.Vector3(0, 1, 0).applyQuaternion(group.quaternion).y).toBe(1);
    h.hub.dispose();
  });

  it('moves slowly in hitstop, resets clean and disposes everything it added', () => {
    const h = harness();
    h.setState();
    h.frame();
    h.emit([hit(0.9)]);
    h.setState({}, true);
    h.frame();
    h.hub.dispose();

    const g = harness();
    g.setState();
    g.frame();
    g.emit([hit(0.9)]);
    g.system.reset();
    expect(g.system.getStats().fx).toBe(0);
    expect(g.system.getStats().dustPuffs).toBe(0);
    const before = g.scene.children.length;
    g.hub.dispose();
    expect(g.scene.children.length).toBeLessThan(before);
    expect(g.scene.getObjectByName('flow-fx-shadow-first')).toBeUndefined();
    expect(g.scene.getObjectByName('bey-flow-dust')).toBeUndefined();
  });

  it('a defeated Bey loses its shadow and raises no more effects', () => {
    const h = harness();
    h.setState();
    h.frame();
    h.system.setDefeated('first');
    runFirst(h, 1, 9);
    expect(h.system.getStats().dustEmitted).toBe(0);
    expect(h.system.getShadow('first').visible).toBe(false);
    expect(h.system.getShadow('second').visible).toBe(true);
    h.hub.dispose();
  });
});
