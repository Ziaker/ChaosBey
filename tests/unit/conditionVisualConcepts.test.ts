import * as THREE from 'three';
import { afterAll, describe, expect, it } from 'vitest';
import { CONCEPTS } from '../../prototypes/bey-visual-concepts/src/concepts/conceptDefinitions';
import type { InstrumentLayer } from '../../prototypes/condition-visual-concepts/src/languages/instrument';
import type { SpiritLayer } from '../../prototypes/condition-visual-concepts/src/languages/spirit';
import { BeyMotion } from '../../prototypes/condition-visual-concepts/src/sim/BeyMotion';
import { AUTO_HITS, BROKEN_CLEAR_AT, ConditionSim, type ConditionEvent } from '../../prototypes/condition-visual-concepts/src/sim/ConditionSim';
import { World } from '../../prototypes/condition-visual-concepts/src/stage/World';
import { PROPOSAL, TUNING, TUNING_SPEC } from '../../prototypes/condition-visual-concepts/src/tuning';

// Visual-prototype checks (not gameplay): the Stamina & Stability lab's
// scripted fight must show every state in order, the shared motion must
// stay finite and bounded, the three views that share one sim must move
// identically, and each language must track the condition it shows.

const DT = 1 / 60;
const worlds: World[] = [];
afterAll(() => worlds.forEach((w) => w.dispose()));

function runAuto(seconds: number): Array<ConditionEvent & { t: number }> {
  const sim = new ConditionSim('auto', 7, () => TUNING.spinOutSeconds);
  const log: Array<ConditionEvent & { t: number }> = [];
  for (let i = 0; i < seconds / DT; i++) {
    for (const e of sim.step(DT)) log.push({ ...e, t: sim.state.time });
    const s = sim.state;
    expect(s.stamina).toBeGreaterThanOrEqual(0);
    expect(s.stamina).toBeLessThanOrEqual(1);
    expect(s.stability).toBeGreaterThanOrEqual(0);
    expect(s.stability).toBeLessThanOrEqual(1);
  }
  return log;
}

describe('condition lab — tuning', () => {
  it('has one slider per value and the proposal sits inside every range', () => {
    const keys = TUNING_SPEC.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(keys)).toEqual(new Set(Object.keys(PROPOSAL)));
    for (const spec of TUNING_SPEC) {
      const v = PROPOSAL[spec.key];
      expect(v, spec.key).toBeGreaterThanOrEqual(spec.min);
      expect(v, spec.key).toBeLessThanOrEqual(spec.max);
    }
  });
});

describe('condition lab — scripted fight', () => {
  const log = runAuto(45);
  const kinds = log.map((e) => e.kind);

  it('lands every scripted hit, breaks twice, recovers twice, spins out and loops', () => {
    const firstLoop = log.filter((e) => e.kind !== 'reset' || e.t > 0);
    expect(firstLoop.filter((e) => e.kind === 'hit').length).toBeGreaterThanOrEqual(AUTO_HITS.length);
    const order = kinds.filter((k) => k !== 'hit');
    expect(order.slice(0, 7)).toEqual(['break', 'recover', 'break', 'recover', 'spinOut', 'down', 'reset']);
  });

  it('breaks on the heavy hit at 10 s and re-seats only after climbing back to the threshold', () => {
    const firstBreak = log.find((e) => e.kind === 'break')!;
    expect(firstBreak.t).toBeCloseTo(10, 1);
    const firstRecover = log.find((e) => e.kind === 'recover')!;
    expect(firstRecover.t).toBeGreaterThan(firstBreak.t + 3.5);
  });

  it('runs out of Stamina in the last part of the loop', () => {
    const spinOut = log.find((e) => e.kind === 'spinOut')!;
    expect(spinOut.t).toBeGreaterThan(32);
    expect(spinOut.t).toBeLessThan(38);
  });
});

describe('condition lab — ladder presets (hold mode)', () => {
  it('a broken preset stays broken, and a weak preset re-seats after a breaking hit', () => {
    const broken = new ConditionSim('hold', 1);
    broken.setHold(0.8, 0, true);
    broken.reset();
    for (let i = 0; i < 600; i++) broken.step(DT);
    expect(broken.state.broken).toBe(true);

    const weak = new ConditionSim('hold', 2);
    weak.setHold(0.8, 0.15, false);
    weak.reset();
    weak.scheduleHit('heavy');
    const seen: string[] = [];
    for (let i = 0; i < 60 * 8; i++) seen.push(...weak.step(DT).map((e) => e.kind));
    expect(seen).toContain('break');
    expect(seen).toContain('recover');
    expect(weak.state.broken).toBe(false);
    expect(weak.state.stability).toBeCloseTo(0.15, 2);
    expect(BROKEN_CLEAR_AT).toBeGreaterThan(0.15);
  });
});

describe('condition lab — shared motion', () => {
  it('two motions fed by one sim stay identical (compare view), finite and within 80° of lean', () => {
    const sim = new ConditionSim('auto', 7, () => TUNING.spinOutSeconds);
    const dims = { ringRadius: 0.65, ringBottomY: 0.45 };
    const floor = (x: number, z: number): number => 3.2 * (Math.min(12, Math.hypot(x, z)) / 12) ** 2;
    const a = new BeyMotion(TUNING, dims, { kind: 'path' }, floor);
    const b = new BeyMotion(TUNING, dims, { kind: 'path' }, floor);
    for (let i = 0; i < 45 / DT; i++) {
      const evs = sim.step(DT);
      evs.forEach((e) => { a.onEvent(e); b.onEvent(e); });
      const fa = a.update(sim.state, DT);
      const fb = b.update(sim.state, DT);
      expect(fa.position.equals(fb.position)).toBe(true);
      expect(fa.quaternion.equals(fb.quaternion)).toBe(true);
      expect(Number.isFinite(fa.position.x + fa.position.y + fa.position.z + fa.lean + fa.rps)).toBe(true);
      expect(fa.lean).toBeLessThanOrEqual((80 * Math.PI) / 180 + 1e-9);
      expect(fa.position.y).toBeGreaterThanOrEqual(floor(fa.position.x, fa.position.z) - 1e-9);
    }
  });
});

describe('condition lab — languages track the condition', () => {
  for (const concept of [CONCEPTS[0]!, CONCEPTS[5]!, CONCEPTS[7]!]) {
    it(`${concept.id}: all three layers run the whole fight; shards and segments follow Stability`, () => {
      const camera = new THREE.PerspectiveCamera(55, 1.6, 0.05, 200);
      camera.position.set(0, 8, 14);
      const world = new World('bowl', camera, TUNING, null);
      worlds.push(world);
      const sim = new ConditionSim('auto', 7, () => TUNING.spinOutSeconds);
      const entry = world.addBey(concept, sim, { kind: 'path' });
      world.setOpponent(CONCEPTS[1]!);
      world.setLayers({ A: true, B: true, C: true });
      const spirit = entry.layers.B as SpiritLayer;
      const gauge = entry.layers.C as InstrumentLayer;
      const events = new Map<ConditionSim, ConditionEvent[]>();
      let checkedBroken = false;
      let checkedHealthy = false;
      for (let i = 0; i < 34 / DT; i++) {
        events.set(sim, sim.step(DT));
        world.update(DT, events);
        const s = sim.state;
        const p = entry.rig.root.position;
        expect(Number.isFinite(p.x + p.y + p.z)).toBe(true);
        if (s.broken && s.sinceHit > 0.6) {
          expect(spirit.intactShards).toBe(0);
          expect(gauge.litSegments).toBe(0);
          checkedBroken = true;
        }
        if (!s.broken && s.sinceHit > 1.5 && s.time > 1 && s.time < 2.4) {
          expect(spirit.intactShards).toBe(Math.ceil(s.stability * TUNING.bShards - 1e-4));
          expect(gauge.litSegments).toBe(Math.ceil(s.stability * TUNING.cSegments - 1e-4));
          checkedHealthy = true;
        }
        expect(gauge.staminaShown).toBeCloseTo(s.stamina, 6);
      }
      expect(checkedBroken).toBe(true);
      expect(checkedHealthy).toBe(true);
    });
  }
});
