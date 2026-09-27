import { afterAll, describe, expect, it } from 'vitest';
import { CameraDirector, type CameraMode } from '../../prototypes/camera-concepts/src/director/CameraDirector';
import { PARAM_SPEC, PRESETS, PRESET_IDS, cloneParams } from '../../prototypes/camera-concepts/src/director/CameraParams';
import { ReadabilityMeter, type ReadabilitySummary } from '../../prototypes/camera-concepts/src/director/ReadabilityMeter';
import { finite3 } from '../../prototypes/camera-concepts/src/director/frameMath';
import { horizontalDistance, type FightFrame } from '../../prototypes/camera-concepts/src/fight/FightFrame';
import { RealSimSource } from '../../prototypes/camera-concepts/src/fight/RealSimSource';
import { SCENARIOS, scenarioById, type Scenario } from '../../prototypes/camera-concepts/src/fight/scenarios';

// Camera Lab checks (a prototype, not the game's camera). Every scenario
// runs in the game's REAL simulation (tickMatch + Rapier + real AI or
// scripted input) and must produce the situation it is named after; then
// each preset's director must keep the GDD's readability promises on it:
// both Beys in frame, never under the floor, FOV <= 120°, turning no faster
// than its own cap, no side-switch storms, deterministic and finite.

const DT = 1 / 60;
const sources: RealSimSource[] = [];
afterAll(() => sources.forEach((s) => s.dispose()));

interface RunResult {
  readonly frames: FightFrame[];
  readonly summaries: Record<string, ReadabilitySummary>;
  readonly modes: Record<string, Set<CameraMode>>;
  readonly finite: boolean;
  readonly lastEye: Record<string, { x: number; y: number; z: number }>;
}

async function run(scenario: Scenario): Promise<RunResult> {
  const src = await RealSimSource.create(scenario);
  sources.push(src);
  const directors = Object.fromEntries(PRESET_IDS.map((id) => [id, new CameraDirector(cloneParams(PRESETS[id]))]));
  const meters = Object.fromEntries(PRESET_IDS.map((id) => [id, new ReadabilityMeter()]));
  const modes = Object.fromEntries(PRESET_IDS.map((id) => [id, new Set<CameraMode>()]));
  const lastEye: RunResult['lastEye'] = {};
  const frames: FightFrame[] = [];
  let finite = true;
  for (let i = 0; i < Math.round(scenario.durationS / DT); i++) {
    const f = src.step();
    frames.push(f);
    for (const id of PRESET_IDS) {
      const out = directors[id]!.tick(f, DT);
      meters[id]!.add(f, out, DT);
      modes[id]!.add(out.mode);
      finite &&= finite3(out.eye) && finite3(out.focus) && Number.isFinite(out.fov) && finite3(out.shake);
      lastEye[id] = { ...out.eye };
    }
  }
  return { frames, summaries: Object.fromEntries(PRESET_IDS.map((id) => [id, meters[id]!.summary])), modes, finite, lastEye };
}

const results = new Map<string, RunResult>();
async function result(id: string): Promise<RunResult> {
  if (!results.has(id)) results.set(id, await run(scenarioById(id)));
  return results.get(id)!;
}

describe('camera lab — parameters', () => {
  it('has one documented slider per parameter and every preset sits inside its ranges, under the 120° ceiling', () => {
    const keys = PARAM_SPEC.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const id of PRESET_IDS) {
      expect(new Set(Object.keys(PRESETS[id]))).toEqual(new Set(keys));
      for (const spec of PARAM_SPEC) {
        const v = PRESETS[id][spec.key];
        expect(v, `${id}.${spec.key}`).toBeGreaterThanOrEqual(spec.min);
        expect(v, `${id}.${spec.key}`).toBeLessThanOrEqual(spec.max);
        expect(spec.doc.length, spec.key).toBeGreaterThan(10);
      }
      expect(PRESETS[id].maxFov).toBeLessThanOrEqual(120);
    }
  });

  it('the three presets are clearly different directions, not small variations', () => {
    const { A, B, C } = PRESETS;
    expect(A.orbitStrength).toBeLessThan(B.orbitStrength);
    expect(B.orbitStrength).toBeLessThan(C.orbitStrength);
    expect(A.maxFov).toBeLessThan(B.maxFov);
    expect(B.maxFov).toBeLessThan(C.maxFov);
    expect(A.positionDamping).toBeLessThan(C.positionDamping);
    expect(A.sideSwitchCooldown).toBeGreaterThanOrEqual(60); // A never changes side
    expect(C.lookAheadStrength).toBeGreaterThan(A.lookAheadStrength * 2);
  });
});

describe('camera lab — scenarios run in the real simulation and produce their situation', () => {
  for (const scenario of SCENARIOS) {
    it(`${scenario.id}: ${scenario.expects.join(', ')}`, async () => {
      const r = await result(scenario.id);
      const kinds = new Set(r.frames.flatMap((f) => f.intents.map((e) => e.kind)));
      for (const want of scenario.expects) {
        if (want === 'clashActive') expect(r.frames.some((f) => f.clashActive), want).toBe(true);
        else if (want === 'roundOver') expect(r.frames.some((f) => f.roundOver), want).toBe(true);
        else if (want === 'closeRange') expect(r.frames.filter((f) => horizontalDistance(f.first.position, f.second.position) < 3.5).length / r.frames.length, want).toBeGreaterThan(0.3);
        else if (want === 'farRange') expect(Math.min(...r.frames.map((f) => horizontalDistance(f.first.position, f.second.position))), want).toBeGreaterThan(12);
        // ~75% of the game's intended top speed (11 m/s); a Dash goes well past it.
        else if (want === 'highSpeed') expect(Math.max(...r.frames.map((f) => Math.max(f.first.speed, f.second.speed))), want).toBeGreaterThan(8);
        else expect(kinds.has(want), want).toBe(true);
      }
    });
  }

  it('is reproducible: the same scenario gives the same fight and the same camera, tick for tick', async () => {
    const a = await run(scenarioById('dash-approach'));
    const b = await run(scenarioById('dash-approach'));
    expect(b.frames.length).toBe(a.frames.length);
    for (let i = 0; i < a.frames.length; i += 30) expect(b.frames[i]!.first.position).toEqual(a.frames[i]!.first.position);
    for (const id of PRESET_IDS) expect(b.lastEye[id]).toEqual(a.lastEye[id]);
  });
});

describe('camera lab — readability guards hold for every preset on every scenario', () => {
  for (const scenario of SCENARIOS) {
    it(scenario.id, async () => {
      const r = await result(scenario.id);
      expect(r.finite).toBe(true);
      for (const id of PRESET_IDS) {
        const s = r.summaries[id]!;
        const P = PRESETS[id];
        expect(s.opponentInFrame, `${id} opponent in frame`).toBeGreaterThanOrEqual(0.9);
        expect(s.playerInFrame, `${id} player in frame`).toBeGreaterThanOrEqual(0.85);
        expect(s.longestOpponentGapS, `${id} longest opponent gap`).toBeLessThan(0.75);
        expect(s.minEyeHeight, `${id} floor`).toBeGreaterThanOrEqual(P.floorClearance - 1e-6);
        expect(s.maxFov, `${id} fov`).toBeLessThanOrEqual(120);
        expect(s.maxYawRateDegS, `${id} yaw rate`).toBeLessThanOrEqual(P.orbitSpeed + 1);
        expect(s.maxSideSwitchesIn5s, `${id} side switches`).toBeLessThanOrEqual(2);
      }
    });
  }
});

describe('camera lab — context modes switch with the gameplay context', () => {
  it('Clash, Ring-Out, Finisher and High Speed show up where the fight produces them', async () => {
    for (const id of PRESET_IDS) {
      expect((await result('clash-setup')).modes[id]!.has('Clash'), `${id} Clash`).toBe(true);
      expect((await result('ring-out-chase')).modes[id]!.has('RingOut'), `${id} RingOut`).toBe(true);
      expect((await result('final-hit')).modes[id]!.has('Finisher'), `${id} Finisher`).toBe(true);
      expect((await result('close-combat')).modes[id]!.has('CloseCombat'), `${id} CloseCombat`).toBe(true);
    }
    expect((await result('dash-approach')).modes.C!.has('HighSpeed')).toBe(true);
  });
});
