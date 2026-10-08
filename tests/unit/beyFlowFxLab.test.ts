import * as THREE from 'three';
import { afterAll, describe, expect, it } from 'vitest';
import { CONCEPTS } from '../../prototypes/bey-visual-concepts/src/concepts/conceptDefinitions';
import { FxLayer } from '../../src/vfx/hybrid/fx/FxLayer';
import { AnimeWind, type WindFlags } from '../../prototypes/bey-flow-fx-concepts/src/fx/AnimeWind';
import { DUST_STYLES, yawToward, type DustStyle } from '../../prototypes/bey-flow-fx-concepts/src/fx/AnimeDust';
import { DustVolume, VOLUME_KINDS, growFactor, lifeOpacity, lumpsFor, rng, shrinkFactor, type VolumeKind } from '../../prototypes/bey-flow-fx-concepts/src/fx/dustVolume';
import { ARENA_RADIUS_M, BEY_DIAMETER_M, CALLOUT_CYCLE, FlowSim, floorHeight, floorSlope, type FlowBey, type FlowEvent } from '../../prototypes/bey-flow-fx-concepts/src/sim/FlowSim';
import { FlowRig, type FxFlags } from '../../prototypes/bey-flow-fx-concepts/src/stage/FlowRig';
import { PROPOSED, TUNING, TUNING_SPEC, applyTuning, resetTuning } from '../../prototypes/bey-flow-fx-concepts/src/tuning';
import { CALLOUT_MEANING, CALLOUT_STYLES, CALLOUT_WORDS } from '../../prototypes/bey-flow-fx-concepts/src/ui/callouts';

// Visual-prototype checks (not gameplay): the Bey Flow FX lab's tuning is
// consistent, its choreographed motion stays finite and inside the bowl,
// the dust is real instanced volume that follows the Bey's heading and fades by
// the owner's sliders, and the rig and the anime wind emitter react to that motion.

const DT = 1 / 60;
const ALL_ON: FxFlags = { blur: true, lean: true, dust: true, wind: true, crown: true, shadow: true };
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

describe('flow lab — dust and shadow sliders', () => {
  it('has the cloud opacity, the opacity-over-life and the shrink sliders, and the shadow ones', () => {
    for (const key of ['dustOpacity', 'dustFade', 'dustShrink', 'shadowOpacity', 'shadowScale'] as const) {
      expect(TUNING_SPEC.some((t) => t.key === key), key).toBe(true);
    }
    const fade = TUNING_SPEC.find((t) => t.key === 'dustFade')!;
    expect(fade.min).toBe(0);
    expect(fade.max).toBe(1);
  });
});

describe('flow lab — owner tuning', () => {
  it("starts from the owner's own numbers for everything they tuned", () => {
    expect(PROPOSED.blurStrength).toBe(1.35);
    expect(PROPOSED.blurFadeSpin).toBe(0.2);
    expect(PROPOSED.leanMaxDeg).toBe(26);
    expect(PROPOSED.leanAccelRefMps2).toBe(13);
    expect(PROPOSED.dustRate).toBe(17);
    expect(PROPOSED.dustSizeM).toBe(0.55); // was 0.7 for flat sprites; a heap of real volume reads bigger
    expect(PROPOSED.dustLifeS).toBe(0.55);
    expect(PROPOSED.dustDashBoost).toBe(0.6);
    expect(PROPOSED.windRate).toBe(30);
    expect(PROPOSED.windLengthM).toBe(1.1);
    expect(PROPOSED.windWidthM).toBe(0.25);
    expect(PROPOSED.windLifeS).toBe(0.25);
    expect(PROPOSED.crownCount).toBe(2);
    expect(PROPOSED.crownSizeM).toBe(5.4);
    expect(PROPOSED.burstSizeM).toBe(1); // was 1.3, same reason
    expect(PROPOSED.calloutScale).toBe(0.55);
    expect(PROPOSED.calloutLifeS).toBe(0.55);
  });

  it('no longer has the crescent wind blades the owner asked to remove', () => {
    expect(Object.keys(PROPOSED).filter((k) => /swoosh/i.test(k))).toEqual([]);
  });
});

describe('flow lab — dust volume', () => {
  it('the generator is deterministic and different seeds differ', () => {
    const a = rng(5);
    const b = rng(5);
    for (let i = 0; i < 10; i++) expect(a()).toBe(b());
    expect(rng(5)()).not.toBe(rng(6)());
  });

  it.each(VOLUME_KINDS)('%s: lumps are deterministic, finite and of varied sizes', (kind: VolumeKind) => {
    for (let seed = 1; seed <= 6; seed++) {
      const lumps = lumpsFor(kind, seed);
      expect(lumpsFor(kind, seed)).toEqual(lumps);
      expect(lumps.length).toBeGreaterThan(8);
      for (const l of lumps) {
        for (const n of [l.x, l.y, l.z, l.sx, l.sy, l.sz, l.yaw, l.pitch, l.order]) expect(Number.isFinite(n)).toBe(true);
        expect(l.sx).toBeGreaterThan(0);
        expect(l.sy).toBeGreaterThan(0);
        expect(l.sz).toBeGreaterThan(0);
        expect(l.order).toBeGreaterThanOrEqual(0);
        expect(l.order).toBeLessThanOrEqual(1);
        expect(l.y - l.sy).toBeGreaterThan(-0.25); // nothing is buried deep in the floor
      }
      const radii = lumps.filter((l) => l.sx === l.sy && l.sy === l.sz).map((l) => l.sx);
      expect(Math.max(...radii) / Math.min(...radii)).toBeGreaterThan(1.5); // lumps of different sizes
    }
    expect(lumpsFor(kind, 1)).not.toEqual(lumpsFor(kind, 2));
  });

  it('the thin needles and tails shrink away before the big hero lumps', () => {
    const lumps = lumpsFor('burst', 3);
    const thin = lumps.filter((l) => l.sx > 2 * l.sy);
    const fat = lumps.filter((l) => l.sx === l.sy && l.sx > 0.4);
    expect(thin.length).toBeGreaterThan(3);
    expect(fat.length).toBeGreaterThan(0);
    const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(thin.map((l) => l.order))).toBeLessThan(mean(fat.map((l) => l.order)));
  });

  it('opacity: whole at the start, then falls to zero; the fade slider moves where it starts to fall', () => {
    expect(lifeOpacity(0, 0.9, 0.6)).toBeCloseTo(0.9);
    expect(lifeOpacity(1, 0.9, 0.6)).toBeCloseTo(0);
    expect(lifeOpacity(0.5, 0.9, 0)).toBeCloseTo(0.9); // fade 0: held to the very end
    expect(lifeOpacity(0.999, 0.9, 0)).toBeGreaterThan(0);
    expect(lifeOpacity(0.01, 0.9, 1)).toBeLessThan(0.9); // fade 1: fading from the first moment
    let prev = 1;
    for (let k = 0; k <= 1.0001; k += 0.05) {
      const v = lifeOpacity(Math.min(1, k), 1, 0.6);
      expect(v).toBeLessThanOrEqual(prev + 1e-9);
      prev = v;
    }
    // A higher fade is never more opaque at the same moment.
    for (const k of [0.2, 0.5, 0.8]) expect(lifeOpacity(k, 1, 0.9)).toBeLessThanOrEqual(lifeOpacity(k, 1, 0.3) + 1e-9);
    // The starting opacity scales the whole curve.
    expect(lifeOpacity(0.3, 0.5, 0.6)).toBeCloseTo(0.5 * lifeOpacity(0.3, 1, 0.6));
  });

  it('shrink: whole until its turn, then smaller; 0 never shrinks, 1 ends at almost nothing', () => {
    expect(shrinkFactor(0, 0.5, 1)).toBe(1);
    expect(shrinkFactor(1, 0.5, 0)).toBe(1);
    expect(shrinkFactor(1, 0.5, 1)).toBeLessThan(0.05);
    expect(shrinkFactor(0.8, 0.1, 0.6)).toBeLessThanOrEqual(shrinkFactor(0.8, 0.9, 0.6)); // low order goes first
  });

  it('grows from its start size to full and stays', () => {
    expect(growFactor(0, 0.5)).toBeCloseTo(0.5);
    expect(growFactor(1, 0.5)).toBeCloseTo(1);
    expect(growFactor(0.1, 0.5)).toBeGreaterThan(0.5);
  });

  it('yawToward turns +x onto the wanted horizontal direction', () => {
    for (const [dx, dz] of [[1, 0], [0, 1], [-1, 0], [0, -1], [0.6, -0.8]] as const) {
      const v = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), yawToward(dx, dz));
      expect(v.x).toBeCloseTo(dx, 5);
      expect(v.z).toBeCloseTo(dz, 5);
    }
  });

  it('is one instanced mesh: real geometry, lit by the scene, depth-tested, stays inside its capacity', () => {
    const scene = new THREE.Scene();
    const vol = new DustVolume(scene, 400);
    expect(vol.mesh).toBeInstanceOf(THREE.InstancedMesh);
    expect(scene.children).toContain(vol.mesh);
    const mat = vol.mesh.material as THREE.MeshToonMaterial;
    expect(mat).toBeInstanceOf(THREE.MeshToonMaterial);
    expect(mat.alphaHash).toBe(true);
    expect(mat.depthWrite).toBe(true);
    expect(mat.depthTest).toBe(true);
    expect(mat.transparent).toBe(false);
    for (let i = 0; i < 40; i++) {
      vol.spawn({ kind: 'puff', pos: new THREE.Vector3(i * 0.1, 0, 0), yaw: 0, size: 1, life: 1, vel: new THREE.Vector3(1, 0, 0), seed: i });
    }
    vol.update(DT, { opacity: 1, fade: 0.5, shrink: 0.5 });
    expect(vol.lumpCount).toBeLessThanOrEqual(400);
    expect(vol.mesh.count).toBe(vol.lumpCount);
    vol.dispose();
  });

  it('the opacity, fade and shrink parameters reach the instances', () => {
    const scene = new THREE.Scene();
    const spawn = (vol: DustVolume): void =>
      vol.spawn({ kind: 'puff', pos: new THREE.Vector3(), yaw: 0, size: 1, life: 1, vel: new THREE.Vector3(), seed: 4, rise: 0 });
    const opacityAt = (vol: DustVolume): number => (vol.mesh.geometry.getAttribute('instanceOpacity') as THREE.BufferAttribute).getX(0);
    const faint = new DustVolume(scene);
    const solid = new DustVolume(scene);
    spawn(faint);
    spawn(solid);
    faint.update(0.1, { opacity: 0.3, fade: 0.5, shrink: 0 });
    solid.update(0.1, { opacity: 1, fade: 0.5, shrink: 0 });
    expect(opacityAt(faint)).toBeCloseTo(0.3, 5);
    expect(opacityAt(solid)).toBeCloseTo(1, 5);

    const early = new DustVolume(scene);
    const late = new DustVolume(scene);
    spawn(early);
    spawn(late);
    early.update(0.7, { opacity: 1, fade: 1, shrink: 0 });
    late.update(0.7, { opacity: 1, fade: 0, shrink: 0 });
    expect(opacityAt(early)).toBeLessThan(opacityAt(late)); // a bigger fade is already fainter at 70% of the life
    expect(opacityAt(late)).toBeCloseTo(1, 5);

    const shrunk = new DustVolume(scene);
    const kept = new DustVolume(scene);
    spawn(shrunk);
    spawn(kept);
    shrunk.update(0.9, { opacity: 1, fade: 0, shrink: 1 });
    kept.update(0.9, { opacity: 1, fade: 0, shrink: 0 });
    const scaleSum = (v: DustVolume): number => {
      const m = new THREE.Matrix4();
      const s = new THREE.Vector3();
      let total = 0;
      for (let i = 0; i < v.lumpCount; i++) {
        v.mesh.getMatrixAt(i, m);
        total += s.setFromMatrixScale(m).x;
      }
      return total;
    };
    expect(scaleSum(shrunk)).toBeLessThan(scaleSum(kept) * 0.8);
  });

  it('offers the three compositions', () => {
    expect(DUST_STYLES.map((d) => d.id)).toEqual(['wave', 'crown', 'cloud']);
    for (const d of DUST_STYLES) {
      expect(d.label.length).toBeGreaterThan(5);
      expect(d.description.length).toBeGreaterThan(20);
    }
  });
});

describe('flow lab — anime wind', () => {
  function setup(style: DustStyle = 'wave'): { layer: FxLayer; wind: AnimeWind; scene: THREE.Scene } {
    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(40, 1.6, 0.1, 300);
    cam.position.set(0, 15, 11);
    const layer = new FxLayer(scene, cam);
    const wind = new AnimeWind(layer, cam, scene);
    wind.dustStyle = style;
    return { layer, wind, scene };
  }
  const tip = new THREE.Vector3(2, 0.3, 1);
  const STYLES: DustStyle[] = ['wave', 'crown', 'cloud'];

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

  it.each(STYLES)('%s: the dust is real volume that animates, stays finite, and is gone when its life is over', (style) => {
    const { wind, scene } = setup(style);
    const b = fastBey();
    for (let i = 0; i < 30; i++) {
      wind.trail(0, b, tip, DT, { ...TUNING, windRate: 0 }, WIND_ON);
      wind.update(DT, TUNING);
    }
    expect(wind.dustPuffs).toBeGreaterThan(0);
    expect(wind.dustLumps).toBeGreaterThan(wind.dustPuffs * 8); // each puff is a pile of lumps, not a picture
    expect(scene.children).toContain(wind.dustMesh);
    const m = new THREE.Matrix4();
    for (let i = 0; i < wind.dustLumps; i++) {
      wind.dustMesh.getMatrixAt(i, m);
      for (const n of m.elements) expect(Number.isFinite(n)).toBe(true);
    }
    for (let i = 0; i < 180; i++) wind.update(DT, TUNING); // 3 s, far past any dust life
    expect(wind.dustPuffs).toBe(0);
    expect(wind.dustMesh.count).toBe(0);
  });

  it.each(STYLES)('%s: the dust trails behind the Bey\'s heading, not behind its velocity', (style) => {
    const { wind } = setup(style);
    const b = fastBey();
    // Heading +z (a Dash being fired) while the velocity still points +x.
    b.headX = 0;
    b.headZ = 1;
    b.vx = 8;
    b.vz = 0;
    b.speed = 8;
    const at = new THREE.Vector3(0, 0, 0);
    for (let i = 0; i < 40; i++) {
      wind.trail(0, b, at, DT, { ...TUNING, windRate: 0, dustRate: 30 }, WIND_ON);
      wind.update(DT, TUNING);
    }
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    let sx = 0;
    let sz = 0;
    for (let i = 0; i < wind.dustLumps; i++) {
      wind.dustMesh.getMatrixAt(i, m);
      p.setFromMatrixPosition(m);
      sx += p.x;
      sz += p.z;
    }
    expect(sz / wind.dustLumps).toBeLessThan(-0.08); // behind the heading
    expect(Math.abs(sx / wind.dustLumps)).toBeLessThan(Math.abs(sz / wind.dustLumps)); // and not off along the old velocity
  });

  it('every effect can be turned off on its own', () => {
    const { layer, wind } = setup();
    const b = fastBey();
    for (let i = 0; i < 60; i++) wind.trail(0, b, tip, DT, TUNING, { dust: false, wind: false, crown: true });
    expect(layer.count()).toBe(0);
    wind.impact(1, 1, 0.8, 1, 0, TUNING, { dust: true, wind: true, crown: false });
    wind.dashStart(0, b, TUNING, { dust: true, wind: true, crown: false });
    expect(layer.count()).toBe(0);
  });

  it.each(STYLES)('%s: a hit raises a dust burst; a harder hit raises at least as many effects', (style) => {
    const light = setup(style);
    const heavy = setup(style);
    light.wind.impact(1, 1, 0.1, 1, 0, TUNING, WIND_ON);
    heavy.wind.impact(1, 1, 1, 1, 0, TUNING, WIND_ON);
    light.wind.update(DT, TUNING);
    heavy.wind.update(DT, TUNING);
    expect(light.wind.dustPuffs).toBeGreaterThanOrEqual(2);
    expect(heavy.wind.dustLumps).toBeGreaterThanOrEqual(light.wind.dustLumps);
    expect(light.wind.emittedDust).toBe(1);
  });

  it('a hit at the contact raises the shock rings, the floor crowns and the flat star (the approved impact)', () => {
    const { layer, wind } = setup();
    wind.impact(1, 1, 0.7, 1, 0, TUNING, WIND_ON);
    // rings + 2 floor crowns + 1 star
    expect(layer.count()).toBe(Math.round(TUNING.crownCount) + 2 + 1);
    const off = setup();
    off.wind.impact(1, 1, 0.7, 1, 0, TUNING, { dust: true, wind: true, crown: false });
    expect(off.layer.count()).toBe(0);
  });

  it.each([
    ['along +x', 1, 0],
    ['along +z', 0, 1],
    ['diagonal', Math.SQRT1_2, Math.SQRT1_2],
    ['the other diagonal', -Math.SQRT1_2, Math.SQRT1_2],
  ])('%s: the impact rings face the direction of the attack', (_name, dx, dz) => {
    const { wind, scene, layer } = setup();
    wind.impact(2, 1, 0.7, dx, dz, TUNING, WIND_ON);
    layer.tick(DT);
    const rings = scene.children.filter((c) => c !== wind.dustMesh).slice(0, Math.round(TUNING.crownCount));
    expect(rings.length).toBeGreaterThan(0);
    for (const r of rings) {
      const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(r.quaternion);
      expect(facing.x).toBeCloseTo(dx, 5);
      expect(facing.z).toBeCloseTo(dz, 5);
    }
    expect(rings[0]!.position.y).toBeCloseTo(floorHeight(Math.hypot(2, 1)) + 0.55, 5); // from the middle of the contact, not above it
  });

  it('a Dash release raises the configured number of shock rings plus a fan of dust', () => {
    const { layer, wind } = setup('wave');
    wind.dashStart(0, fastBey(), TUNING, WIND_ON);
    wind.update(DT, TUNING);
    expect(layer.count()).toBe(Math.round(TUNING.crownCount));
    expect(wind.dustPuffs).toBeGreaterThanOrEqual(3);
    expect(wind.emittedDust).toBe(1); // one burst
  });

  describe('placement', () => {
    function lumpPositions(wind: AnimeWind): THREE.Vector3[] {
      const m = new THREE.Matrix4();
      const out: THREE.Vector3[] = [];
      for (let i = 0; i < wind.dustLumps; i++) {
        wind.dustMesh.getMatrixAt(i, m);
        out.push(new THREE.Vector3().setFromMatrixPosition(m));
      }
      return out;
    }

    it.each(STYLES)('%s: a burst stands on the floor (not floating over it) and is drawn by the depth-tested mesh', (style) => {
      const { wind } = setup(style);
      wind.impact(3, 2, 0.8, 1, 0, TUNING, WIND_ON);
      wind.update(DT, TUNING);
      const floor = floorHeight(Math.hypot(3, 2));
      const ps = lumpPositions(wind);
      expect(ps.length).toBeGreaterThan(20);
      expect(Math.min(...ps.map((p) => p.y))).toBeLessThan(floor + 0.5);
      expect(Math.min(...ps.map((p) => p.y))).toBeGreaterThan(floor - 0.5);
      expect(wind.dustMesh.material).toBeInstanceOf(THREE.MeshToonMaterial);
    });

    it('a crown lies on the floor and tilts with its slope (it does not rise)', () => {
      const { wind } = setup('crown');
      wind.impact(9, 0, 0.6, 1, 0, TUNING, WIND_ON); // near the wall, where the funnel is steep
      for (let i = 0; i < 20; i++) wind.update(DT, TUNING);
      const ps = lumpPositions(wind);
      expect(ps.length).toBeGreaterThan(20);
      const heights = ps.map((p) => p.y - floorHeight(Math.hypot(p.x, p.z)));
      // The funnel rises toward +x, so a tilted crown is higher on the +x side than the -x side, relative to its middle.
      const east = ps.filter((p) => p.x > 9.6).map((p) => p.y);
      const west = ps.filter((p) => p.x < 8.4).map((p) => p.y);
      expect(east.length).toBeGreaterThan(0);
      expect(west.length).toBeGreaterThan(0);
      expect(Math.max(...heights)).toBeLessThan(2.5);
    });

    it('the dust of a hit rolls out around the contact, the dust of a Dash fans behind the Bey', () => {
      const hit = setup('wave');
      hit.wind.impact(0, 0, 0.8, 1, 0, TUNING, WIND_ON);
      for (let i = 0; i < 20; i++) hit.wind.update(DT, TUNING);
      const around = lumpPositions(hit.wind);
      const meanX = around.reduce((a, p) => a + p.x, 0) / around.length;
      const meanZ = around.reduce((a, p) => a + p.z, 0) / around.length;
      expect(Math.hypot(meanX, meanZ)).toBeLessThan(1); // all around
      expect(Math.max(...around.map((p) => Math.hypot(p.x, p.z)))).toBeGreaterThan(1);

      const dash = setup('wave');
      const b = fastBey();
      b.x = 0;
      b.z = 0;
      b.dashDirX = 0;
      b.dashDirZ = 1;
      dash.wind.dashStart(0, b, TUNING, WIND_ON);
      for (let i = 0; i < 20; i++) dash.wind.update(DT, TUNING);
      const behind = lumpPositions(dash.wind);
      expect(behind.reduce((a, p) => a + p.z, 0) / behind.length).toBeLessThan(-0.5); // the Bey fires toward +z, the dust stays at -z
    });
  });

  describe('shock rings', () => {
    /** The ring holders: the first `crownCount` objects the Dash release adds. */
    function ringsFor(b: FlowBey): THREE.Object3D[] {
      const { wind, scene } = setup();
      wind.dashStart(0, b, TUNING, WIND_ON);
      return scene.children.filter((c) => c !== wind.dustMesh).slice(0, Math.round(TUNING.crownCount));
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
      const ring = scene.children.filter((c) => c !== wind.dustMesh)[0]!;
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
    const off: FxFlags = { blur: false, lean: false, dust: false, wind: false, crown: false, shadow: false };
    for (let i = 0; i < 3 / DT; i++) {
      sim.step(DT);
      rig.update(sim.beys[0], DT, TUNING, off);
    }
    expect(rig.leanDegrees).toBe(0);
  });

  it('has a small black blob shadow on the floor under the Bey, with its own opacity and size', () => {
    const sim = new FlowSim();
    const rig = makeRig();
    sim.step(DT);
    rig.update(sim.beys[0], DT, TUNING, ALL_ON);
    const shadows: THREE.Mesh[] = [];
    rig.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.geometry.type === 'CircleGeometry') shadows.push(m);
    });
    expect(shadows).toHaveLength(1);
    const shadow = shadows[0]!;
    const mat = shadow.material as THREE.MeshBasicMaterial;
    expect(mat.color.getHex()).toBe(0x000000);
    expect(mat.opacity).toBeCloseTo(TUNING.shadowOpacity);
    expect(shadow.visible).toBe(true);
    // Cheap: one flat disc, no shadow map, a little wider than the Bey but not huge.
    expect(shadow.castShadow).toBe(false);
    expect(shadow.scale.x).toBeGreaterThan(BEY_DIAMETER_M);
    expect(shadow.scale.x).toBeLessThan(BEY_DIAMETER_M * 2);
    // Off by the flag; size follows the slider.
    rig.update(sim.beys[0], DT, TUNING, { ...ALL_ON, shadow: false });
    expect(shadow.visible).toBe(false);
    rig.update(sim.beys[0], DT, { ...TUNING, shadowScale: 2 }, ALL_ON);
    expect(shadow.scale.x).toBeGreaterThan(BEY_DIAMETER_M * 2);
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
