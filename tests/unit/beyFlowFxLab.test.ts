import * as THREE from 'three';
import { afterAll, describe, expect, it } from 'vitest';
import { CONCEPTS } from '../../prototypes/bey-visual-concepts/src/concepts/conceptDefinitions';
import { PointPool } from '../../prototypes/bey-flow-fx-concepts/src/fx/PointPool';
import { WindRibbon, type RibbonShape } from '../../prototypes/bey-flow-fx-concepts/src/fx/WindRibbon';
import { ARENA_RADIUS_M, BEY_DIAMETER_M, CALLOUT_CYCLE, FlowSim, floorHeight, floorSlope, type FlowEvent } from '../../prototypes/bey-flow-fx-concepts/src/sim/FlowSim';
import { FlowRig, type FxFlags } from '../../prototypes/bey-flow-fx-concepts/src/stage/FlowRig';
import { PROPOSED, TUNING, TUNING_SPEC, applyTuning, resetTuning } from '../../prototypes/bey-flow-fx-concepts/src/tuning';
import { CALLOUT_MEANING, CALLOUT_STYLES, CALLOUT_WORDS } from '../../prototypes/bey-flow-fx-concepts/src/ui/callouts';

// Visual-prototype checks (not gameplay): the Bey Flow FX lab's tuning is
// consistent, its choreographed motion stays finite and inside the bowl,
// the wind ribbon builds a sane tapered strip, and the rig drives every
// effect from that motion.

const DT = 1 / 60;
const ALL_ON: FxFlags = { ribbon: true, helix: true, blur: true, ghost: true, dust: true, lean: true };

function runSim(seconds: number, setup?: (s: FlowSim) => void): { sim: FlowSim; events: Array<FlowEvent & { t: number }> } {
  const sim = new FlowSim();
  setup?.(sim);
  const events: Array<FlowEvent & { t: number }> = [];
  for (let i = 0; i < seconds / DT; i++) {
    sim.step(DT);
    for (const e of sim.events) events.push({ ...e, t: sim.time });
  }
  return { sim, events };
}

describe('flow lab — tuning', () => {
  it('has one slider per value and the proposed values sit inside every range', () => {
    const keys = TUNING_SPEC.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(keys)).toEqual(new Set(Object.keys(PROPOSED)));
    for (const spec of TUNING_SPEC) {
      const v = PROPOSED[spec.key];
      expect(v, spec.key).toBeGreaterThanOrEqual(spec.min);
      expect(v, spec.key).toBeLessThanOrEqual(spec.max);
    }
  });

  it('applyTuning clamps to the range, ignores junk, and resetTuning restores the proposal', () => {
    applyTuning({ ribbonWidthM: 99, ghostCount: Number.NaN, dustRate: -5 });
    const widthSpec = TUNING_SPEC.find((s) => s.key === 'ribbonWidthM')!;
    const dustSpec = TUNING_SPEC.find((s) => s.key === 'dustRate')!;
    expect(TUNING.ribbonWidthM).toBe(widthSpec.max);
    expect(TUNING.dustRate).toBe(dustSpec.min);
    expect(TUNING.ghostCount).toBe(PROPOSED.ghostCount);
    resetTuning();
    expect({ ...TUNING }).toEqual({ ...PROPOSED });
  });
});

describe('flow lab — choreographed motion', () => {
  it('stays finite, inside the bowl and at sane speeds for a minute', () => {
    const sim = new FlowSim();
    let maxSpeed = 0;
    for (let i = 0; i < 60 / DT; i++) {
      sim.step(DT);
      for (const b of sim.beys) {
        for (const v of [b.x, b.z, b.vx, b.vz, b.ax, b.az]) expect(Number.isFinite(v)).toBe(true);
        expect(Math.hypot(b.x, b.z)).toBeLessThanOrEqual(ARENA_RADIUS_M + 1e-6);
        maxSpeed = Math.max(maxSpeed, b.speed);
      }
    }
    expect(maxSpeed).toBeGreaterThan(8); // they really move
    expect(maxSpeed).toBeLessThan(45);
  });

  it('is deterministic', () => {
    const a = runSim(20);
    const b = runSim(20);
    expect(a.sim.beys[0].x).toBe(b.sim.beys[0].x);
    expect(a.sim.beys[1].z).toBe(b.sim.beys[1].z);
    expect(a.events).toEqual(b.events);
  });

  it('charges, dashes and collides, and the callouts cycle hit -> block -> counter', () => {
    const sim = new FlowSim();
    let charged = false;
    let dashed = false;
    const kinds: string[] = [];
    for (let i = 0; i < 40 / DT; i++) {
      sim.step(DT);
      charged ||= sim.beys.some((b) => b.charging);
      dashed ||= sim.beys.some((b) => b.dashing);
      for (const e of sim.events) kinds.push(e.kind);
    }
    expect(charged).toBe(true);
    expect(dashed).toBe(true);
    expect(kinds.length).toBeGreaterThanOrEqual(3);
    kinds.forEach((k, i) => expect(k).toBe(CALLOUT_CYCLE[i % CALLOUT_CYCLE.length]));
  });

  it('never lets the two Beys sit inside each other for long', () => {
    const sim = new FlowSim();
    let overlapTicks = 0;
    for (let i = 0; i < 40 / DT; i++) {
      sim.step(DT);
      const [a, b] = sim.beys;
      if (Math.hypot(a.x - b.x, a.z - b.z) < BEY_DIAMETER_M * 0.9) overlapTicks++;
    }
    expect(overlapTicks).toBeLessThan(40);
  });

  it('without dashes there is no charge, dash or collision-driven callout from a dash', () => {
    const { sim } = runSim(15, (s) => (s.dashesEnabled = false));
    expect(sim.beys.some((b) => b.dashing || b.charging)).toBe(false);
  });

  it('forceCallout produces an event at the pair midpoint', () => {
    const sim = new FlowSim();
    const e = sim.forceCallout('counter');
    const [a, b] = sim.beys;
    expect(e.x).toBeCloseTo((a.x + b.x) / 2);
    expect(e.z).toBeCloseTo((a.z + b.z) / 2);
    expect(sim.events).toContain(e);
  });

  it('the bowl is lowest at the centre and rises to the rim', () => {
    expect(floorHeight(0)).toBe(0);
    expect(floorHeight(ARENA_RADIUS_M)).toBeGreaterThan(floorHeight(ARENA_RADIUS_M / 2));
    expect(floorSlope(0)).toBe(0);
    expect(floorSlope(ARENA_RADIUS_M)).toBeGreaterThan(0);
  });
});

describe('flow lab — wind ribbon', () => {
  const shape = (over: Partial<RibbonShape> = {}): RibbonShape => ({
    lifeS: 0.5,
    opacity: 1,
    waveM: 0,
    waveHz: 0,
    helixRadiusM: 0,
    helixTurnsPerS: 0,
    helixPhase: 0,
    widthScale: 1,
    headColor: new THREE.Color(1, 1, 1),
    tailColor: new THREE.Color(0, 0.5, 1),
    ...over,
  });
  const camera = new THREE.Vector3(0, 20, 15);

  function straightRibbon(): { ribbon: WindRibbon; now: number } {
    const ribbon = new WindRibbon();
    let now = 0;
    for (let i = 0; i < 30; i++) {
      now = i * DT;
      ribbon.push(now, new THREE.Vector3(i * 0.2, 0.5, 0), 1, 0.4);
    }
    return { ribbon, now };
  }

  it('builds a finite triangle strip that tapers and fades toward the tail', () => {
    const { ribbon, now } = straightRibbon();
    ribbon.update(now, camera, shape());
    const geo = ribbon.mesh.geometry;
    const pos = geo.attributes.position!.array as Float32Array;
    const col = geo.attributes.color!.array as Float32Array;
    const live = ribbon.sampleCount;
    expect(live).toBeGreaterThan(10);
    expect(geo.drawRange.count).toBe((live - 1) * 6);
    for (let i = 0; i < live * 6; i++) expect(Number.isFinite(pos[i]!)).toBe(true);
    const width = (k: number): number => {
      const o = k * 6;
      return Math.hypot(pos[o]! - pos[o + 3]!, pos[o + 1]! - pos[o + 4]!, pos[o + 2]! - pos[o + 5]!);
    };
    const mid = Math.floor(live / 2);
    expect(width(mid)).toBeGreaterThan(width(live - 1)); // the tail is thinner than the middle
    const alpha = (k: number): number => col[k * 8 + 3]!;
    expect(alpha(1)).toBeGreaterThan(alpha(live - 1));
    expect(alpha(live - 1)).toBeLessThan(0.15);
    expect(alpha(live - 1)).toBeLessThan(alpha(1) * 0.2); // the tail is nearly gone next to the head
  });

  it('drops samples older than its life and draws nothing with fewer than two', () => {
    const { ribbon, now } = straightRibbon();
    ribbon.update(now + 10, camera, shape());
    expect(ribbon.sampleCount).toBe(0);
    expect(ribbon.mesh.geometry.drawRange.count).toBe(0);
  });

  it('a helix strand leaves the straight path, a plain ribbon does not', () => {
    const { ribbon, now } = straightRibbon();
    const plain = new WindRibbon();
    const helix = new WindRibbon();
    for (let i = 0; i < 30; i++) {
      plain.push(i * DT, new THREE.Vector3(i * 0.2, 0.5, 0), 1, 0.2);
      helix.push(i * DT, new THREE.Vector3(i * 0.2, 0.5, 0), 1, 0.2);
    }
    plain.update(now, camera, shape());
    helix.update(now, camera, shape({ helixRadiusM: 0.6, helixTurnsPerS: 3 }));
    const maxOffAxis = (r: WindRibbon): number => {
      const p = r.mesh.geometry.attributes.position!.array as Float32Array;
      let m = 0;
      for (let k = 0; k < r.sampleCount; k++) m = Math.max(m, Math.hypot(p[k * 6 + 1]! - 0.5, p[k * 6 + 2]!));
      return m;
    };
    expect(maxOffAxis(helix)).toBeGreaterThan(maxOffAxis(plain) + 0.2);
  });

  it('clear() empties it', () => {
    const { ribbon } = straightRibbon();
    ribbon.clear();
    expect(ribbon.sampleCount).toBe(0);
  });
});

describe('flow lab — point pool', () => {
  it('particles live for their life and then go away', () => {
    const pool = new PointPool(20, false);
    pool.emit(new THREE.Vector3(), new THREE.Vector3(1, 1, 0), 0.2, 0.5, new THREE.Color(1, 1, 1), 1);
    expect(pool.liveCount).toBe(1);
    pool.update(0.25);
    expect(pool.liveCount).toBe(1);
    pool.update(0.4);
    expect(pool.liveCount).toBe(0);
    pool.dispose();
  });

  it('wraps around instead of overflowing', () => {
    const pool = new PointPool(4, true);
    for (let i = 0; i < 10; i++) pool.emit(new THREE.Vector3(), new THREE.Vector3(), 0.1, 1, new THREE.Color(), 1);
    expect(pool.liveCount).toBe(4);
    pool.dispose();
  });
});

describe('flow lab — rig', () => {
  const dust = new PointPool(400, false);
  const sparks = new PointPool(300, true);
  const scene = new THREE.Scene();
  const rigs: FlowRig[] = [];
  afterAll(() => {
    rigs.forEach((r) => r.dispose());
    dust.dispose();
    sparks.dispose();
  });

  function makeRig(): FlowRig {
    const def = CONCEPTS.find((c) => c.id === 'attack-a')!;
    const rig = new FlowRig(def, scene, dust, sparks, 0, 3);
    rigs.push(rig);
    return rig;
  }
  const camera = new THREE.PerspectiveCamera(40, 1.6, 0.1, 300);
  camera.position.set(0, 22, 17);
  camera.lookAt(0, 0.4, 0);

  it('drives ribbon, ghosts, dust and lean from the motion, all finite and bounded', () => {
    const sim = new FlowSim();
    const rig = makeRig();
    let maxLean = 0;
    let maxGhosts = 0;
    for (let i = 0; i < 8 / DT; i++) {
      sim.step(DT);
      rig.record(sim.beys[0], sim.time, DT, TUNING, ALL_ON);
      rig.update(sim.beys[0], sim.time, DT, camera, TUNING, ALL_ON);
      dust.update(DT);
      expect(Number.isFinite(rig.leanDegrees)).toBe(true);
      maxLean = Math.max(maxLean, Math.abs(rig.leanDegrees));
      maxGhosts = Math.max(maxGhosts, rig.visibleGhosts);
    }
    expect(rig.ribbonSampleCount).toBeGreaterThan(5);
    expect(maxLean).toBeGreaterThan(2);
    expect(maxLean).toBeLessThanOrEqual(TUNING.leanMaxDeg + 1e-6);
    expect(maxGhosts).toBeGreaterThan(0);
    expect(maxGhosts).toBeLessThanOrEqual(Math.round(TUNING.ghostCount));
    expect(dust.liveCount).toBeGreaterThan(0);
  });

  it('turns every effect off cleanly', () => {
    const sim = new FlowSim();
    const rig = makeRig();
    const off: FxFlags = { ribbon: false, helix: false, blur: false, ghost: false, dust: false, lean: false };
    for (let i = 0; i < 3 / DT; i++) {
      sim.step(DT);
      rig.record(sim.beys[0], sim.time, DT, TUNING, off);
      rig.update(sim.beys[0], sim.time, DT, camera, TUNING, off);
    }
    expect(rig.ribbonSampleCount).toBe(0);
    expect(rig.visibleGhosts).toBe(0);
    expect(rig.leanDegrees).toBe(0);
  });

  it('samples the path per sim step, not per rendered frame', () => {
    const sim = new FlowSim();
    const rig = makeRig();
    // 30 sim steps but only ONE rendered frame: the ribbon still has every step's sample.
    for (let i = 0; i < 30; i++) {
      sim.step(DT);
      rig.record(sim.beys[0], sim.time, DT, TUNING, ALL_ON);
    }
    rig.update(sim.beys[0], sim.time, 30 * DT, camera, TUNING, ALL_ON);
    expect(rig.ribbonSampleCount).toBe(30);
  });

  it('resetTrails forgets the path', () => {
    const sim = new FlowSim();
    const rig = makeRig();
    for (let i = 0; i < 2 / DT; i++) {
      sim.step(DT);
      rig.record(sim.beys[0], sim.time, DT, TUNING, ALL_ON);
      rig.update(sim.beys[0], sim.time, DT, camera, TUNING, ALL_ON);
    }
    expect(rig.ribbonSampleCount).toBeGreaterThan(0);
    rig.resetTrails();
    expect(rig.ribbonSampleCount).toBe(0);
  });
});

describe('flow lab — callout styles', () => {
  it('offers three styles and a word and meaning for each kind', () => {
    expect(CALLOUT_STYLES.map((s) => s.id)).toEqual(['A', 'B', 'C']);
    for (const kind of CALLOUT_CYCLE) {
      expect(CALLOUT_WORDS[kind].length).toBeGreaterThan(2);
      expect(CALLOUT_MEANING[kind].length).toBeGreaterThan(5);
    }
    expect(CALLOUT_WORDS.hit).toBe('HIT');
    expect(CALLOUT_WORDS.block).toBe('BLOCK');
    expect(CALLOUT_WORDS.counter).toBe('COUNTER!');
  });
});
