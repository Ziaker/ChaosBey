import * as THREE from 'three';
import { afterAll, describe, expect, it } from 'vitest';
import { CONCEPTS } from '../../prototypes/bey-visual-concepts/src/concepts/conceptDefinitions';
import { FxLayer } from '../../src/vfx/hybrid/fx/FxLayer';
import { AnimeWind, type WindFlags } from '../../prototypes/bey-flow-fx-concepts/src/fx/AnimeWind';
import { DUST_STYLES, type DustStyle } from '../../prototypes/bey-flow-fx-concepts/src/fx/AnimeDust';
import { ROLL_BASE_Y, ROLL_VARIANTS, SHARD, bubbleCluster, rollLumps, rollTail, shardPoints } from '../../prototypes/bey-flow-fx-concepts/src/fx/animeTextures';
import { ARENA_RADIUS_M, BEY_DIAMETER_M, CALLOUT_CYCLE, FlowSim, floorHeight, floorSlope, type FlowBey, type FlowEvent } from '../../prototypes/bey-flow-fx-concepts/src/sim/FlowSim';
import { FlowRig, type FxFlags } from '../../prototypes/bey-flow-fx-concepts/src/stage/FlowRig';
import { PROPOSED, TUNING, TUNING_SPEC, applyTuning, resetTuning } from '../../prototypes/bey-flow-fx-concepts/src/tuning';
import { CALLOUT_MEANING, CALLOUT_STYLES, CALLOUT_WORDS } from '../../prototypes/bey-flow-fx-concepts/src/ui/callouts';

// Visual-prototype checks (not gameplay): the Bey Flow FX lab's tuning is
// consistent, its choreographed motion stays finite and inside the bowl,
// the cartoon cloud and wind-blade shapes are well formed, and the rig and the
// anime wind emitter react to that motion.

const DT = 1 / 60;
const ALL_ON: FxFlags = { blur: true, lean: true, dust: true, wind: true, crown: true };
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
    applyTuning({ windWidthM: 99, crownCount: Number.NaN, dustRate: -5 });
    const widthSpec = TUNING_SPEC.find((s) => s.key === 'windWidthM')!;
    const dustSpec = TUNING_SPEC.find((s) => s.key === 'dustRate')!;
    expect(TUNING.windWidthM).toBe(widthSpec.max);
    expect(TUNING.dustRate).toBe(dustSpec.min);
    expect(TUNING.crownCount).toBe(PROPOSED.crownCount);
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
  it("starts from the owner's own numbers for everything they tuned", () => {
    expect(PROPOSED.blurStrength).toBe(1.35);
    expect(PROPOSED.blurFadeSpin).toBe(0.2);
    expect(PROPOSED.leanMaxDeg).toBe(26);
    expect(PROPOSED.leanAccelRefMps2).toBe(13);
    expect(PROPOSED.dustRate).toBe(17);
    expect(PROPOSED.dustSizeM).toBe(0.7);
    expect(PROPOSED.dustLifeS).toBe(0.55);
    expect(PROPOSED.dustDashBoost).toBe(0.6);
    expect(PROPOSED.windRate).toBe(30);
    expect(PROPOSED.windLengthM).toBe(1.1);
    expect(PROPOSED.windWidthM).toBe(0.25);
    expect(PROPOSED.windLifeS).toBe(0.25);
    expect(PROPOSED.crownCount).toBe(2);
    expect(PROPOSED.crownSizeM).toBe(5.4);
    expect(PROPOSED.burstSizeM).toBe(1.3);
    expect(PROPOSED.calloutScale).toBe(0.55);
    expect(PROPOSED.calloutLifeS).toBe(0.55);
  });

  it('no longer has the crescent wind blades the owner asked to remove', () => {
    expect(Object.keys(PROPOSED).filter((k) => /swoosh/i.test(k))).toEqual([]);
  });
});

describe('flow lab — dust shapes', () => {
  it('the rolling wave: lumps sit on the flat base, shrink toward the tail, and differ by variant', () => {
    expect(ROLL_VARIANTS).toBeGreaterThanOrEqual(3);
    for (let v = 0; v < ROLL_VARIANTS; v++) {
      const lumps = rollLumps(v);
      expect(rollLumps(v)).toEqual(lumps); // deterministic
      for (const b of lumps) {
        for (const n of [b.x, b.y, b.r]) expect(Number.isFinite(n)).toBe(true);
        expect(b.x).toBeGreaterThan(0);
        expect(b.x).toBeLessThan(1);
        expect(b.y + b.r).toBeLessThanOrEqual(ROLL_BASE_Y + 0.03); // sits on the base (the texture cuts anything below it)
        expect(b.y - b.r).toBeGreaterThanOrEqual(0); // and stays inside the tile
        expect(b.r).toBeGreaterThan(0.03);
      }
      const row = lumps.slice(0, -1); // the row along the base (the last lump is the curled head)
      expect(row[0]!.r).toBeGreaterThan(row[row.length - 1]!.r); // the crest tapers
      const head = lumps[lumps.length - 1]!;
      expect(head.x).toBeLessThan(row[0]!.x); // the curl is at the head end
      expect(head.y).toBeLessThan(row[0]!.y); // …and taller
    }
    expect(rollLumps(0)).not.toEqual(rollLumps(1));
  });

  it('the tail is a thin tapered strip that ends at the right edge on the base line', () => {
    const tail = rollTail();
    const xs = tail.map(([x]) => x);
    expect(Math.max(...xs)).toBeGreaterThan(0.95);
    expect(Math.max(...xs)).toBeLessThanOrEqual(1);
    for (const [, y] of tail) expect(y).toBeLessThanOrEqual(ROLL_BASE_Y + 1e-9);
  });

  it('a bubble cluster has the requested number of bubbles, a big one first, all small and finite', () => {
    for (const count of [3, 4, 5]) {
      const c = bubbleCluster(1, count);
      expect(c.length).toBe(count);
      expect(c[0]!.r).toBe(1);
      for (const b of c) {
        for (const n of [b.x, b.y, b.r]) expect(Number.isFinite(n)).toBe(true);
        expect(b.r).toBeGreaterThan(0.2);
        expect(b.r).toBeLessThanOrEqual(1);
        expect(Math.hypot(b.x, b.y)).toBeLessThan(1);
      }
    }
    expect(bubbleCluster(0, 4)).not.toEqual(bubbleCluster(1, 4));
  });

  it('the shard is a closed blade: pointed at both ends and with thickness between them', () => {
    const { upper, lower } = shardPoints(20);
    expect(upper[0]).toEqual(SHARD.tipA);
    expect(lower[lower.length - 1]).toEqual(SHARD.tipA);
    expect(upper[upper.length - 1]).toEqual(SHARD.tipB);
    expect(lower[0]).toEqual(SHARD.tipB);
    const mid = 10;
    expect(lower[lower.length - 1 - mid]![1] - upper[mid]![1]).toBeGreaterThan(0.2);
    for (const [x, y] of [...upper, ...lower]) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1);
    }
  });

  it('offers the three dust ideas', () => {
    expect(DUST_STYLES.map((d) => d.id)).toEqual(['roll', 'bubbles', 'shards']);
    for (const d of DUST_STYLES) {
      expect(d.label.length).toBeGreaterThan(5);
      expect(d.description.length).toBeGreaterThan(20);
    }
  });
});

describe('flow lab — anime wind', () => {
  function setup(style: DustStyle = 'roll'): { layer: FxLayer; wind: AnimeWind; scene: THREE.Scene } {
    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(40, 1.6, 0.1, 300);
    cam.position.set(0, 15, 11);
    const layer = new FxLayer(scene, cam);
    const wind = new AnimeWind(layer);
    wind.dustStyle = style;
    return { layer, wind, scene };
  }
  const tip = new THREE.Vector3(2, 0.3, 1);
  const STYLES: DustStyle[] = ['roll', 'bubbles', 'shards'];

  function fastBey(): FlowBey {
    const sim = new FlowSim();
    const b = sim.beys[0];
    b.vx = 8;
    b.vz = 2;
    b.speed = Math.hypot(8, 2);
    return b;
  }

  it.each(STYLES)('%s: a fast Bey leaves dust and wind streaks; a slow one leaves none', (style) => {
    const { layer, wind } = setup(style);
    const b = fastBey();
    for (let i = 0; i < 60; i++) wind.trail(0, b, tip, DT, TUNING, WIND_ON);
    expect(wind.emittedDust).toBeGreaterThan(3);
    expect(layer.count()).toBeGreaterThan(8);

    const slow = setup(style);
    const s = fastBey();
    s.vx = 0.5;
    s.vz = 0;
    s.speed = 0.5;
    for (let i = 0; i < 60; i++) slow.wind.trail(0, s, tip, DT, TUNING, WIND_ON);
    expect(slow.layer.count()).toBe(0);
  });

  it.each(STYLES)('%s: a Dash leaves more dust than plain running', (style) => {
    const run = setup(style);
    const dash = setup(style);
    const a = fastBey();
    const b = fastBey();
    b.dashing = true;
    for (let i = 0; i < 120; i++) {
      run.wind.trail(0, a, tip, DT, TUNING, WIND_ON);
      dash.wind.trail(0, b, tip, DT, TUNING, WIND_ON);
    }
    expect(dash.wind.emittedDust).toBeGreaterThan(run.wind.emittedDust);
  });

  it.each(STYLES)('%s: animates, stays finite, and is gone when its life is over', (style) => {
    const { layer, wind, scene } = setup(style);
    const b = fastBey();
    for (let i = 0; i < 30; i++) wind.trail(0, b, tip, DT, { ...TUNING, windRate: 0 }, WIND_ON);
    const before = layer.count();
    expect(before).toBeGreaterThan(0);
    for (let i = 0; i < 20; i++) layer.tick(DT);
    scene.traverse((o) => {
      for (const n of [o.position.x, o.position.y, o.position.z, o.scale.x, o.scale.y]) expect(Number.isFinite(n)).toBe(true);
    });
    for (let i = 0; i < 180; i++) layer.tick(DT); // 3 s, far past any dust life
    expect(layer.count()).toBe(0);
  });

  it('every effect can be turned off on its own', () => {
    const { layer, wind } = setup();
    const b = fastBey();
    for (let i = 0; i < 60; i++) wind.trail(0, b, tip, DT, TUNING, { dust: false, wind: false, crown: true });
    expect(layer.count()).toBe(0);
    wind.impact(1, 1, 0.8, TUNING, { dust: true, wind: true, crown: false });
    wind.dashStart(0, b, TUNING, { dust: true, wind: true, crown: false });
    expect(layer.count()).toBe(0);
  });

  it.each(STYLES)('%s: a hit raises the crown, a dust burst and a star; a harder hit raises more dust', (style) => {
    const light = setup(style);
    const heavy = setup(style);
    light.wind.impact(1, 1, 0.1, TUNING, WIND_ON);
    heavy.wind.impact(1, 1, 1, TUNING, WIND_ON);
    expect(light.layer.count()).toBeGreaterThanOrEqual(2 + 3 + 1); // crown rings + some dust + star
    expect(heavy.wind.emittedDust).toBeGreaterThan(light.wind.emittedDust);
  });

  it('a Dash release raises the configured number of shock rings plus a fan of dust', () => {
    const { layer, wind } = setup('roll');
    wind.dashStart(0, fastBey(), TUNING, WIND_ON);
    expect(layer.count()).toBe(Math.round(TUNING.crownCount) + 6);
    expect(wind.emittedDust).toBe(6);
  });

  describe('shock rings', () => {
    /** The ring holders: the first `crownCount` objects the Dash release adds. */
    function ringsFor(b: FlowBey): THREE.Object3D[] {
      const { wind, scene } = setup();
      wind.dashStart(0, b, TUNING, WIND_ON);
      return scene.children.slice(0, Math.round(TUNING.crownCount));
    }
    function dashing(x: number, z: number, dirX: number, dirZ: number): FlowBey {
      const b = fastBey();
      b.x = x;
      b.z = z;
      // The orbit velocity points somewhere else entirely: the rings must follow the dash direction, not this.
      b.vx = 0;
      b.vz = 8;
      b.speed = 8;
      b.dashDirX = dirX;
      b.dashDirZ = dirZ;
      return b;
    }

    it.each([
      ['along +x', 1, 0],
      ['along +z', 0, 1],
      ['diagonal', Math.SQRT1_2, Math.SQRT1_2],
      ['the other diagonal', -Math.SQRT1_2, Math.SQRT1_2],
      ['backward diagonal', -Math.SQRT1_2, -Math.SQRT1_2],
    ])('%s: the rings face the way the Bey is fired, not its old velocity', (_name, dx, dz) => {
      const rings = ringsFor(dashing(1.5, 1, dx, dz));
      expect(rings.length).toBeGreaterThan(0);
      for (const r of rings) {
        const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(r.quaternion);
        expect(facing.x).toBeCloseTo(dx, 5);
        expect(facing.z).toBeCloseTo(dz, 5);
        expect(facing.y).toBeCloseTo(0, 5); // upright, never tipped
      }
    });

    it('the first ring is born in the middle of the Bey, at its body height, not above it', () => {
      const b = dashing(1.5, 1, 1, 0);
      const [ring] = ringsFor(b);
      expect(ring!.position.x).toBeCloseTo(b.x, 5);
      expect(ring!.position.z).toBeCloseTo(b.z, 5);
      expect(ring!.position.y).toBeCloseTo(floorHeight(Math.hypot(b.x, b.z)) + 0.55, 5);
    });

    it('the rings then fly backward along the dash direction', () => {
      const { wind, scene, layer } = setup();
      const b = dashing(1.5, 1, Math.SQRT1_2, Math.SQRT1_2);
      wind.dashStart(0, b, TUNING, WIND_ON);
      const ring = scene.children[0]!;
      const x0 = ring.position.x;
      const z0 = ring.position.z;
      for (let i = 0; i < 20; i++) layer.tick(DT);
      const dx = ring.position.x - x0;
      const dz = ring.position.z - z0;
      expect(dx).toBeLessThan(0);
      expect(dz).toBeLessThan(0);
      expect(dx).toBeCloseTo(dz, 3); // straight along the diagonal
    });
  });

  it('the sim reports the dash direction toward the other Bey', () => {
    const sim = new FlowSim();
    let checked = false;
    const prev = [false, false];
    for (let i = 0; i < 20 / DT && !checked; i++) {
      sim.step(DT);
      sim.beys.forEach((b, k) => {
        if (b.dashing && !prev[k]) {
          const o = sim.beys[1 - k]!;
          const d = Math.hypot(o.x - b.x, o.z - b.z);
          // Set at the start of the tick, so the Beys have moved a little since: within a few degrees of the target.
          const dot = b.dashDirX * ((o.x - b.x) / d) + b.dashDirZ * ((o.z - b.z) / d);
          expect(dot).toBeGreaterThan(Math.cos((10 * Math.PI) / 180));
          expect(Math.hypot(b.dashDirX, b.dashDirZ)).toBeCloseTo(1, 5);
          checked = true;
        }
        prev[k] = b.dashing;
      });
    }
    expect(checked).toBe(true);
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
    expect(a.wind.emittedDust).toBe(b.wind.emittedDust);
  });

  it.each(STYLES)('%s: the live effect count stays inside the layer budget however long it runs', (style) => {
    const { layer, wind } = setup(style);
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

  it('leans into curves, all finite and bounded', () => {
    const sim = new FlowSim();
    const rig = makeRig();
    let maxLean = 0;
    for (let i = 0; i < 8 / DT; i++) {
      sim.step(DT);
      rig.update(sim.beys[0], DT, TUNING, ALL_ON);
      expect(Number.isFinite(rig.leanDegrees)).toBe(true);
      maxLean = Math.max(maxLean, Math.abs(rig.leanDegrees));
    }
    expect(maxLean).toBeGreaterThan(2);
    expect(maxLean).toBeLessThanOrEqual(TUNING.leanMaxDeg + 1e-6);
  });

  it('does not lean when the lean is off', () => {
    const sim = new FlowSim();
    const rig = makeRig();
    const off: FxFlags = { blur: false, lean: false, dust: false, wind: false, crown: false };
    for (let i = 0; i < 3 / DT; i++) {
      sim.step(DT);
      rig.update(sim.beys[0], DT, TUNING, off);
    }
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
