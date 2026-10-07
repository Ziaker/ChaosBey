// ============================================================
// HYBRID VFX (batch 3): the approved Hybrid language with the Cel Cyclone wind
// The lab's own checks keep passing in vfxVisualConcepts tests. These prove the
// port: the 36 approved values are intact and frozen, the camera/time values are
// metadata only, real match events and states drive the lab's handlers, effects
// scale with the real magnitude, screen effects stay off the camera, and the
// system cleans up after itself.
// ============================================================

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { APPROVED } from '../../prototypes/vfx-visual-concepts/src/tuning';
import { ATTACK_ARCHETYPE, DEFENSE_ARCHETYPE } from '../../src/bey/archetype/BeyArchetypes';
import { createConceptBeyVisual } from '../../src/bey/visual/conceptBeyVisual';
import { CONCEPTS } from '../../src/bey/visual/concepts/conceptDefinitions';
import { AttackState } from '../../src/combat/attacks/AttackController';
import { DodgeState } from '../../src/dodge/DodgeController';
import { PresentationHub, selectBeyPresentationState, type MatchPresentationState, type PresentationEvent } from '../../src/presentation';
import { HybridVfxSystem } from '../../src/vfx/hybrid/HybridVfxSystem';
import { HYBRID_VFX_APPROVED, PENDING_CAMERA_AND_TIME_VALUES, TUNING } from '../../src/vfx/hybrid/tuning';

describe('the 36 approved values', () => {
  it('are exactly the owner-approved configuration, all 36, and cannot be changed at run time', () => {
    expect(Object.keys(HYBRID_VFX_APPROVED)).toHaveLength(36);
    expect(HYBRID_VFX_APPROVED).toEqual(APPROVED);
    expect(TUNING).toEqual(APPROVED);
    expect(Object.isFrozen(TUNING)).toBe(true);
    expect(() => {
      (TUNING as { shockwave: number }).shockwave = 5;
    }).toThrow();
    expect(TUNING.shockwave).toBe(1.95);
    // Spot checks against docs/design-decisions/visual-prototypes-approval.md section 3c.
    expect(TUNING).toMatchObject({ windRings: 1, windRingSize: 0.65, windStreakLength: 3, windDebris: 2.6, impactFrameMin: 0.65, impactFrameLength: 0.6 });
  });

  it('keeps the camera and time values as metadata only, with the owner-freeze marker on shake', () => {
    expect(PENDING_CAMERA_AND_TIME_VALUES.shake.value).toBe(1.35);
    expect(PENDING_CAMERA_AND_TIME_VALUES.shake.status).toBe('PENDING — CAMERA/VFX SHAKE INTEGRATION · OWNER FROZE CAMERA FOR THIS PASS');
    expect(Object.keys(PENDING_CAMERA_AND_TIME_VALUES).sort()).toEqual(['dodgeSlowFactor', 'dodgeSlowSeconds', 'hitstop', 'shake']);
    expect(PENDING_CAMERA_AND_TIME_VALUES.hitstop.status).toMatch(/^NOT APPLIED/);
  });
});

interface Harness {
  readonly scene: THREE.Group;
  readonly camera: THREE.PerspectiveCamera;
  readonly hub: PresentationHub;
  readonly system: HybridVfxSystem;
  readonly beys: { first: ReturnType<typeof createConceptBeyVisual>; second: ReturnType<typeof createConceptBeyVisual> };
  setState(overrides?: { first?: Partial<Facts>; second?: Partial<Facts> }, camera?: Partial<{ hitstopActive: boolean }>): void;
  emit(events: readonly PresentationEvent[]): void;
  frame(dt?: number): void;
}
interface Facts { attackState: AttackState; dodgeState: DodgeState; dashChargeFraction: number; isBroken: boolean; speedMps: number; stabilityFraction: number }

function harness(): Harness {
  const scene = new THREE.Group();
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 100);
  camera.position.set(0, 3, 6);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  const beys = { first: createConceptBeyVisual(CONCEPTS[0]!, ATTACK_ARCHETYPE), second: createConceptBeyVisual(CONCEPTS[3]!, DEFENSE_ARCHETYPE) };
  beys.first.group.position.set(-1, 0.18, 0);
  beys.second.group.position.set(1, 0.27, 0);
  scene.add(beys.first.group, beys.second.group);
  const system = new HybridVfxSystem({
    scene,
    camera,
    beys: { first: { visual: beys.first, gameplay: ATTACK_ARCHETYPE }, second: { visual: beys.second, gameplay: DEFENSE_ARCHETYPE } },
    floorHeightAtR: () => 0,
    arenaSparks: [0xffe28a, 0xff7a1f],
    arenaRadiusM: 3.2,
    overlayParent: null,
  });
  const hub = new PresentationHub({ features: { newBeyVisuals: true, conditionVisuals: false, hybridVfx: true, clashPresentation: false, newHud: false, arenaVisuals: false }, beys: [{ side: 'first', definitionId: 'a' }, { side: 'second', definitionId: 'd' }], getVfxAnchor: () => false });
  hub.attach(system);
  let tick = 0;
  let latest: MatchPresentationState | null = null;
  const facts = (o: Partial<Facts>) => ({
    grounded: true,
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
    setState(overrides = {}, cam = {}) {
      tick++;
      const first = selectBeyPresentationState(facts(overrides.first ?? {}) as never, { side: 'first', definitionId: 'a', maxSpeedMps: 10 });
      const second = selectBeyPresentationState(facts(overrides.second ?? {}) as never, { side: 'second', definitionId: 'd', maxSpeedMps: 10 });
      const cameraSnapshot = { mode: 'CombatFollow', preset: 'B', fovDeg: 60, distanceM: 8, yawDeg: 0, clashBlend: 0, highSpeedBlend: 0, hitstopActive: cam.hitstopActive ?? false, hitstopRemainingS: 0 };
      latest = { tick, round: { over: false, outcome: '' }, first, second, clash: {} as never, camera: cameraSnapshot, recentImpact: { first: null, second: null } };
    },
    emit(events) {
      system.onEvents(events, latest!);
    },
    frame(dt = 1 / 60) {
      system.update({ dtSeconds: dt, state: latest });
    },
  };
}

const POS = { x: 0, y: 0.3, z: 0 };
const hit = (magnitude: number): PresentationEvent => ({ kind: 'hitResolved', tick: 1, defenderSide: 'second', attackerSide: 'first', magnitude, position: POS, hitboxKind: 'circular', caughtOpponentDashing: false });

describe('HybridVfxSystem', () => {
  it('turns a real hit into the lab effects, and scales them with the real magnitude', () => {
    const sparksFor = (m: number): number => {
      const h = harness();
      h.setState();
      h.frame();
      h.emit([hit(m)]);
      const sparks = h.system.getStats().sparks!;
      h.hub.dispose();
      return sparks;
    };
    expect(sparksFor(1)).toBeGreaterThan(sparksFor(0.1));
    const h = harness();
    h.setState();
    h.frame();
    h.emit([hit(0.9)]);
    expect(h.system.getStats().fx).toBeGreaterThan(5);
    h.hub.dispose();
  });

  it('shows the impact frame only on heavy hits (the approved 0.65 threshold)', () => {
    const impactFor = (m: number): number => {
      const h = harness();
      h.setState();
      h.frame();
      h.emit([hit(m)]);
      const impact = h.system.getStats().impactFrame!;
      h.hub.dispose();
      return impact;
    };
    expect(impactFor(0.4)).toBe(0);
    expect(impactFor(0.9)).toBe(1);
  });

  it('a dodge and a Perfect Dodge show their wind / Perfect Dodge effect but never a contact spark (the attack was avoided)', () => {
    const fxFor = (kind: 'dodged' | 'perfectDodge'): { fx: number; sparks: number; focusLines: number; droppedSlowMotion: number } => {
      const h = harness();
      h.setState();
      h.frame();
      h.emit([{ kind, tick: 1, side: 'second', magnitude: 0.9, position: POS }]);
      h.setState();
      h.frame();
      const stats = h.system.getStats();
      h.hub.dispose();
      return { fx: stats.fx!, sparks: stats.sparks!, focusLines: stats.focusLines!, droppedSlowMotion: stats.droppedSlowMotion! };
    };
    const dodged = fxFor('dodged');
    const perfect = fxFor('perfectDodge');
    expect(dodged.sparks).toBe(0);
    expect(perfect.sparks).toBe(0);
    expect(dodged.fx).toBeGreaterThan(0);
    expect(perfect.fx).toBeGreaterThan(0);
    // The Perfect Dodge adds its own feedback on top of the dodge's wind: focus lines on screen
    // (and a slow-motion request, which the system drops: it never scales gameplay or camera time).
    expect(dodged.focusLines).toBe(0);
    expect(perfect.focusLines).toBeGreaterThan(0);
    expect(dodged.droppedSlowMotion).toBe(0);
    expect(perfect.droppedSlowMotion).toBeGreaterThan(0);
  });

  it('asks for camera shake, hitstop and slow motion but applies none of them', () => {
    const h = harness();
    h.setState();
    h.frame();
    const cameraBefore = JSON.stringify([h.camera.position.toArray(), h.camera.quaternion.toArray(), h.camera.fov, Array.from(h.camera.projectionMatrix.elements), h.camera.children.length]);
    h.emit([hit(1), { kind: 'perfectDodge', tick: 1, side: 'first', magnitude: 0.9, position: POS }, { kind: 'stabilityBroken', tick: 1, side: 'second', magnitude: 0.9, position: POS }]);
    for (let i = 0; i < 60; i++) {
      h.setState();
      h.frame();
    }
    const stats = h.system.getStats();
    expect(stats.droppedShake).toBeGreaterThan(0);
    expect(stats.droppedHitstop).toBeGreaterThan(0);
    expect(stats.droppedSlowMotion).toBeGreaterThan(0);
    // Nothing reached the camera: pose, lens, projection and children are exactly as before.
    expect(JSON.stringify([h.camera.position.toArray(), h.camera.quaternion.toArray(), h.camera.fov, Array.from(h.camera.projectionMatrix.elements), h.camera.children.length])).toBe(cameraBefore);
    h.hub.dispose();
  });

  it('releases the Dash with the Cel Cyclone wind when the charge becomes the dash, and not before', () => {
    const h = harness();
    for (let i = 0; i < 30; i++) {
      h.setState({ first: { attackState: AttackState.ChargingDash, dashChargeFraction: i / 30 } });
      h.frame();
    }
    const charging = h.system.getStats().fx!;
    h.beys.first.group.position.x += 0.4;
    h.setState({ first: { attackState: AttackState.DashActive, speedMps: 8 } });
    h.frame();
    expect(h.system.getStats().fx!).toBeGreaterThan(charging + 20); // rings, wake, spiral, dust, debris
    h.hub.dispose();
  });

  it('every Dash raises visible dust, a zero-charge one at the lab\'s Light intensity at least (owner, 2026-10-02)', () => {
    const h = harness();
    const runtime = (h.system as unknown as { runtime: { windBurst(e: { m: number }): void } }).runtime;
    const seen: number[] = [];
    const original = runtime.windBurst.bind(runtime);
    runtime.windBurst = (e) => {
      seen.push(e.m);
      original(e);
    };
    // A minimum Dash: no charge at all, and a slow frame that never showed the charge (Neutral straight to DashActive).
    h.setState({ first: { attackState: AttackState.Neutral } });
    h.frame();
    const before = h.system.getStats().dust!;
    h.beys.first.group.position.x += 0.4;
    h.setState({ first: { attackState: AttackState.DashActive, dashChargeFraction: 0, speedMps: 8 } });
    h.frame();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeGreaterThanOrEqual(0.3);
    expect(h.system.getStats().dust! - before).toBeGreaterThan(0);
    h.hub.dispose();
  });

  it('every dodge raises the wind and dust as it starts, Perfect or not (owner, 2026-10-02)', () => {
    const h = harness();
    const runtime = (h.system as unknown as { runtime: { windBurst(e: { m: number }): void } }).runtime;
    const seen: number[] = [];
    const original = runtime.windBurst.bind(runtime);
    runtime.windBurst = (e) => {
      seen.push(e.m);
      original(e);
    };
    h.setState({ first: { dodgeState: DodgeState.Idle } });
    h.frame();
    const before = h.system.getStats().dust!;
    h.setState({ first: { dodgeState: DodgeState.Dodging, speedMps: 12 } });
    h.frame();
    h.setState({ first: { dodgeState: DodgeState.Dodging, speedMps: 12 } });
    h.frame(); // still dodging: no second burst
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeGreaterThanOrEqual(0.3);
    expect(h.system.getStats().dust! - before).toBeGreaterThan(0);
    h.hub.dispose();
  });

  it('wobbles and grinds while broken, drives the circular sweep, and shows dodge afterimages', () => {
    const fxAfter = (first: Partial<Facts>, frames = 90): number => {
      const h = harness();
      for (let i = 0; i < frames; i++) {
        h.setState({ first });
        h.frame();
      }
      const stats = h.system.getStats();
      h.hub.dispose();
      return stats.fx! + stats.sparks! + stats.vortices!;
    };
    const idle = fxAfter({});
    expect(fxAfter({ isBroken: true, stabilityFraction: 0 })).toBeGreaterThan(idle);
    // The Circular's vortex (rebuilt 2026-10-04) is its own ~0.9 s animation, counted while it plays.
    expect(fxAfter({ attackState: AttackState.CircularActive }, 20)).toBeGreaterThan(fxAfter({}, 20));
    expect(fxAfter({ dodgeState: DodgeState.Dodging })).toBeGreaterThan(idle);
  });

  it('plays a wall scrape only when the collision is at the wall, not in the middle', () => {
    const scrapeFor = (x: number): number => {
      const h = harness();
      h.beys.second.group.position.set(x, 0.27, 0);
      h.setState();
      h.frame();
      h.emit([{ kind: 'collisionResolved', tick: 1, side: 'second', magnitude: 0.8, position: POS }]);
      const total = h.system.getStats().sparks! + h.system.getStats().fx!;
      h.hub.dispose();
      return total;
    };
    expect(scrapeFor(2.9)).toBeGreaterThan(0);
    expect(scrapeFor(0.5)).toBe(0);
  });

  it('slows the effects while the game is in hitstop, without touching the hitstop itself', () => {
    const ageAfter = (hitstop: boolean): number => {
      const h = harness();
      h.setState({}, { hitstopActive: hitstop });
      h.frame();
      h.emit([hit(0.5)]);
      for (let i = 0; i < 20; i++) {
        h.setState({}, { hitstopActive: hitstop });
        h.frame();
      }
      const alive = h.system.getStats().sparks!;
      h.hub.dispose();
      return alive;
    };
    // Same real time: with hitstop the sparks live longer (more still alive).
    expect(ageAfter(true)).toBeGreaterThan(ageAfter(false));
  });

  it('clears on reset and removes everything it added on dispose', () => {
    const h = harness();
    const childrenBefore = h.scene.children.length;
    h.setState();
    h.frame();
    h.emit([hit(1), { kind: 'landed', tick: 1, side: 'first', magnitude: 0.8, position: POS }, { kind: 'ringOut', tick: 1, side: 'second', magnitude: 1, position: POS }]);
    expect(h.system.getStats().fx! + h.system.getStats().sparks!).toBeGreaterThan(10);
    h.system.reset();
    expect(h.system.getStats()).toMatchObject({ fx: 0, sparks: 0 });
    h.emit([hit(1)]);
    h.hub.dispose();
    expect(h.scene.children).toEqual([h.beys.first.group, h.beys.second.group]);
    // Two Beys, plus the spark buffer and the flash light this system adds while attached.
    expect(childrenBefore).toBe(6); // + the two Circular vortices (owner, 2026-10-04)
  });

  it('never moves a Bey: position and attitude are untouched through a long fight', () => {
    const h = harness();
    const positions = [h.beys.first.group, h.beys.second.group].map((g) => g.position.toArray());
    const attitudes = [h.beys.first.group, h.beys.second.group].map((g) => g.quaternion.clone());
    for (let i = 0; i < 300; i++) {
      h.setState({ first: { isBroken: i > 100, speedMps: 8, attackState: i % 90 < 30 ? AttackState.ChargingDash : AttackState.Neutral, dashChargeFraction: (i % 90) / 30 } });
      h.frame();
      if (i % 40 === 0) h.emit([hit(0.8)]);
    }
    expect([h.beys.first.group, h.beys.second.group].map((g) => g.position.toArray())).toEqual(positions);
    [h.beys.first.group, h.beys.second.group].forEach((g, i) => expect(g.quaternion.equals(attitudes[i]!)).toBe(true));
    expect(h.hub.getStats().systemErrors).toBe(0);
    h.hub.dispose();
  });
});


describe('Lote 7 (owner, 2026-10-02; audit J2/J3) — landings and floor scars', () => {
  it('Heavy hits and hard launched landings leave a floor scar, capped at 10 at once, faded after their life', () => {
    const h = harness();
    h.setState();
    h.frame();
    h.emit([hit(0.5)]); // Medium-ish: no scar
    expect(h.system.getStats().floorScars).toBe(0);
    h.emit([hit(1)]);
    expect(h.system.getStats().floorScars).toBe(1);
    h.emit([{ kind: 'landed', tick: 1, side: 'first', magnitude: 0.8, position: POS, launched: true }]);
    expect(h.system.getStats().floorScars).toBe(2);
    h.emit([{ kind: 'landed', tick: 1, side: 'first', magnitude: 0.9, position: POS }]); // own/plain landing: no scar
    expect(h.system.getStats().floorScars).toBe(2);
    for (let i = 0; i < 15; i++) h.emit([hit(1)]);
    expect(h.system.getStats().floorScarsMade).toBe(17);
    expect(h.system.getStats().floorScars).toBeLessThanOrEqual(10);
    for (let i = 0; i < 16 * 30; i++) h.frame(1 / 30);
    expect(h.system.getStats().floorScars).toBe(0);
    h.hub.dispose();
  });
});
