import * as THREE from 'three';
import { afterAll, describe, expect, it } from 'vitest';
import { CONCEPTS } from '../../prototypes/bey-visual-concepts/src/concepts/conceptDefinitions';
import { FxLayer } from '../../src/vfx/hybrid/fx/FxLayer';
import { AnimeWind, type WindFlags } from '../../prototypes/bey-flow-fx-concepts/src/fx/AnimeWind';
import { CLOUD_VARIANTS, CRESCENT, cloudBlobs, crescentPoints } from '../../prototypes/bey-flow-fx-concepts/src/fx/animeTextures';
import { ARENA_RADIUS_M, BEY_DIAMETER_M, CALLOUT_CYCLE, FlowSim, floorHeight, floorSlope, type FlowEvent } from '../../prototypes/bey-flow-fx-concepts/src/sim/FlowSim';
import { FlowRig, type FxFlags } from '../../prototypes/bey-flow-fx-concepts/src/stage/FlowRig';
import { PROPOSED, TUNING, TUNING_SPEC, applyTuning, resetTuning } from '../../prototypes/bey-flow-fx-concepts/src/tuning';
import { CALLOUT_MEANING, CALLOUT_STYLES, CALLOUT_WORDS } from '../../prototypes/bey-flow-fx-concepts/src/ui/callouts';

// Visual-prototype checks (not gameplay): the Bey Flow FX lab's tuning is
// consistent, its choreographed motion stays finite and inside the bowl,
// the cartoon cloud and wind-blade shapes are well formed, and the rig and the
// anime wind emitter react to that motion.

const DT = 1 / 60;
const ALL_ON: FxFlags = { blur: true, lean: true, dust: true, wind: true, swoosh: true, crown: true };
const WIND_ON: WindFlags = { dust: true, wind: true, crown: true };

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
    applyTuning({ windWidthM: 99, swooshCount: Number.NaN, dustRate: -5 });
    const widthSpec = TUNING_SPEC.find((s) => s.key === 'windWidthM')!;
    const dustSpec = TUNING_SPEC.find((s) => s.key === 'dustRate')!;
    expect(TUNING.windWidthM).toBe(widthSpec.max);
    expect(TUNING.dustRate).toBe(dustSpec.min);
    expect(TUNING.swooshCount).toBe(PROPOSED.swooshCount);
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

describe('flow lab — owner tuning', () => {
  it("starts from the owner's own numbers for the effects they kept", () => {
    expect(PROPOSED.blurStrength).toBe(1.35);
    expect(PROPOSED.blurFadeSpin).toBe(0.2);
    expect(PROPOSED.leanMaxDeg).toBe(26);
    expect(PROPOSED.leanAccelRefMps2).toBe(13);
    expect(PROPOSED.calloutScale).toBe(0.55);
    expect(PROPOSED.calloutLifeS).toBe(0.55);
  });
});

describe('flow lab — cartoon shapes', () => {
  it('every cloud variant is deterministic, finite, inside the tile and sits on a flat base', () => {
    expect(CLOUD_VARIANTS).toBeGreaterThanOrEqual(3);
    for (let v = 0; v < CLOUD_VARIANTS; v++) {
      const a = cloudBlobs(v);
      expect(cloudBlobs(v)).toEqual(a);
      expect(a.length).toBeGreaterThanOrEqual(8);
      for (const b of a) {
        for (const n of [b.x, b.y, b.r]) expect(Number.isFinite(n)).toBe(true);
        expect(b.x - b.r).toBeGreaterThan(-0.05);
        expect(b.x + b.r).toBeLessThan(1.05);
        expect(b.y + b.r).toBeLessThan(1);
        expect(b.r).toBeGreaterThan(0.08);
      }
      // The bottom row is the widest: the cloud is wider at the base than on top.
      const lows = a.filter((b) => b.y > 0.6);
      const highs = a.filter((b) => b.y < 0.4);
      const span = (bs: typeof a): number => Math.max(...bs.map((b) => b.x + b.r)) - Math.min(...bs.map((b) => b.x - b.r));
      expect(span(lows)).toBeGreaterThan(span(highs));
    }
  });

  it('the variants differ from each other', () => {
    expect(cloudBlobs(0)).not.toEqual(cloudBlobs(1));
    expect(cloudBlobs(1)).not.toEqual(cloudBlobs(2));
  });

  it('the wind blade is a closed crescent: pointed at both tips, bulging past its inner edge', () => {
    const { outer, inner } = crescentPoints(24);
    expect(outer.length).toBe(25);
    expect(inner.length).toBe(25);
    // The two edges meet at the tips...
    expect(outer[0]).toEqual(CRESCENT.tipA);
    expect(inner[inner.length - 1]).toEqual(CRESCENT.tipA);
    expect(outer[outer.length - 1]).toEqual(CRESCENT.tipB);
    expect(inner[0]).toEqual(CRESCENT.tipB);
    // ...and between them the outer edge is higher (smaller y) than the inner edge: it has thickness.
    const mid = 12;
    const outerMid = outer[mid]!;
    const innerMid = inner[inner.length - 1 - mid]!;
    expect(innerMid[1] - outerMid[1]).toBeGreaterThan(0.15);
    for (const [x, y] of [...outer, ...inner]) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1);
      expect(Number.isFinite(y)).toBe(true);
    }
  });
});

describe('flow lab — anime wind', () => {
  function setup(): { layer: FxLayer; wind: AnimeWind } {
    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(40, 1.6, 0.1, 300);
    cam.position.set(0, 15, 11);
    const layer = new FxLayer(scene, cam);
    return { layer, wind: new AnimeWind(layer) };
  }
  const tip = new THREE.Vector3(2, 0.3, 1);

  function fastBey(): ReturnType<typeof runSim>['sim']['beys'][0] {
    const sim = new FlowSim();
    const b = sim.beys[0];
    b.vx = 8;
    b.vz = 2;
    b.speed = Math.hypot(8, 2);
    return b;
  }

  it('a fast Bey leaves clouds and wind streaks; a slow one leaves none', () => {
    const { layer, wind } = setup();
    const b = fastBey();
    for (let i = 0; i < 60; i++) wind.trail(0, b, tip, DT, TUNING, WIND_ON);
    expect(wind.emittedClouds).toBeGreaterThan(3);
    expect(layer.count()).toBeGreaterThan(8); // clouds + streaks

    const slow = setup();
    const s = fastBey();
    s.vx = 0.5;
    s.vz = 0;
    s.speed = 0.5;
    for (let i = 0; i < 60; i++) slow.wind.trail(0, s, tip, DT, TUNING, WIND_ON);
    expect(slow.layer.count()).toBe(0);
  });

  it('a Dash leaves more clouds than plain running', () => {
    const run = setup();
    const dash = setup();
    const a = fastBey();
    const b = fastBey();
    b.dashing = true;
    for (let i = 0; i < 120; i++) {
      run.wind.trail(0, a, tip, DT, TUNING, WIND_ON);
      dash.wind.trail(0, b, tip, DT, TUNING, WIND_ON);
    }
    expect(dash.wind.emittedClouds).toBeGreaterThan(run.wind.emittedClouds);
  });

  it('every effect can be turned off on its own', () => {
    const { layer, wind } = setup();
    const b = fastBey();
    for (let i = 0; i < 60; i++) wind.trail(0, b, tip, DT, TUNING, { dust: false, wind: false, crown: true });
    expect(layer.count()).toBe(0);
    wind.impact(1, 1, 0.8, TUNING, { dust: true, wind: true, crown: false });
    wind.dashStart(0, b, tip, TUNING, { dust: true, wind: true, crown: false });
    expect(layer.count()).toBe(0);
  });

  it('a hit raises the crown, a cloud burst and a star; a harder hit raises more clouds', () => {
    const light = setup();
    const heavy = setup();
    light.wind.impact(1, 1, 0.1, TUNING, WIND_ON);
    heavy.wind.impact(1, 1, 1, TUNING, WIND_ON);
    expect(light.layer.count()).toBeGreaterThanOrEqual(2 + 6 + 1);
    expect(heavy.wind.emittedClouds).toBeGreaterThan(light.wind.emittedClouds);
  });

  it('a Dash release raises the configured number of shock rings plus a puff of clouds', () => {
    const { layer, wind } = setup();
    wind.dashStart(0, fastBey(), tip, TUNING, WIND_ON);
    expect(layer.count()).toBe(Math.round(TUNING.crownCount) + 6);
    expect(wind.emittedClouds).toBe(6);
  });

  it('is deterministic for a given seed', () => {
    const a = setup();
    const b = setup();
    const bey = fastBey();
    for (let i = 0; i < 90; i++) {
      a.wind.trail(0, bey, tip, DT, TUNING, WIND_ON);
      b.wind.trail(0, bey, tip, DT, TUNING, WIND_ON);
    }
    expect(a.layer.count()).toBe(b.layer.count());
    expect(a.wind.emittedClouds).toBe(b.wind.emittedClouds);
  });

  it('the live effect count stays inside the layer budget however long it runs', () => {
    const { layer, wind } = setup();
    const b = fastBey();
    b.dashing = true;
    for (let i = 0; i < 60 * 30; i++) {
      wind.trail(0, b, tip, DT, { ...TUNING, intensity: 2 }, WIND_ON);
      layer.tick(DT);
    }
    expect(layer.count()).toBeLessThan(700);
  });
});

describe('flow lab — rig', () => {
  const scene = new THREE.Scene();
  const rigs: FlowRig[] = [];
  afterAll(() => rigs.forEach((r) => r.dispose()));

  function makeRig(): FlowRig {
    const def = CONCEPTS.find((c) => c.id === 'attack-a')!;
    const rig = new FlowRig(def, scene);
    rigs.push(rig);
    return rig;
  }

  it('leans into curves and shows wind blades, all finite and bounded', () => {
    const sim = new FlowSim();
    const rig = makeRig();
    let maxLean = 0;
    let maxBlades = 0;
    for (let i = 0; i < 8 / DT; i++) {
      sim.step(DT);
      rig.update(sim.beys[0], DT, TUNING, ALL_ON);
      expect(Number.isFinite(rig.leanDegrees)).toBe(true);
      maxLean = Math.max(maxLean, Math.abs(rig.leanDegrees));
      maxBlades = Math.max(maxBlades, rig.visibleSwooshes);
    }
    expect(maxLean).toBeGreaterThan(2);
    expect(maxLean).toBeLessThanOrEqual(TUNING.leanMaxDeg + 1e-6);
    expect(maxBlades).toBeGreaterThan(0);
    expect(maxBlades).toBeLessThanOrEqual(Math.round(TUNING.swooshCount));
  });

  it('the wind blades fade with the spin and are gone when it is nearly dead', () => {
    const sim = new FlowSim();
    const rig = makeRig();
    sim.spinTarget = 0.02;
    for (let i = 0; i < 3 / DT; i++) {
      sim.step(DT);
      rig.update(sim.beys[0], DT, TUNING, ALL_ON);
    }
    expect(rig.visibleSwooshes).toBe(0);
  });

  it('turns every effect off cleanly', () => {
    const sim = new FlowSim();
    const rig = makeRig();
    const off: FxFlags = { blur: false, lean: false, dust: false, wind: false, swoosh: false, crown: false };
    for (let i = 0; i < 3 / DT; i++) {
      sim.step(DT);
      rig.update(sim.beys[0], DT, TUNING, off);
    }
    expect(rig.visibleSwooshes).toBe(0);
    expect(rig.leanDegrees).toBe(0);
  });

  it('puts the tip on the floor under the Bey', () => {
    const sim = new FlowSim();
    const rig = makeRig();
    sim.step(DT);
    rig.update(sim.beys[0], DT, TUNING, ALL_ON);
    const t = rig.tip(new THREE.Vector3());
    expect(t.x).toBeCloseTo(sim.beys[0].x);
    expect(t.z).toBeCloseTo(sim.beys[0].z);
    expect(t.y).toBeCloseTo(floorHeight(Math.hypot(t.x, t.z)));
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
