import { afterAll, describe, expect, it } from 'vitest';
import { ATTACK_ARCHETYPE, DEFENSE_ARCHETYPE, STAMINA_ARCHETYPE } from '../../src/bey/archetype/BeyArchetypes';
import type { BeySnapshot, MatchTickResult } from '../../src/app/simulation/tickMatch';
import { AttackState } from '../../src/combat/attacks/AttackController';
import { ClashOutcome, ClashState } from '../../src/combat/clash/ClashController';
import { RoundOutcome } from '../../src/combat/round-rules/RoundState';
import { DodgeState } from '../../src/dodge/DodgeController';
import { DriftState } from '../../src/drift/DriftController';
import { simulateAiMatch } from '../../src/self-test/AiMatchSimulation';
import { BUSES, CATEGORIES, EVENTS, eventById } from '../../prototypes/sfx-concepts/src/catalog';
import { DIRECTIONS, DIRECTION_IDS } from '../../prototypes/sfx-concepts/src/directions';
import { DuckTracker, MixPolicy } from '../../prototypes/sfx-concepts/src/engine/MixPolicy';
import { LEVEL_TRIM_DB, TARGET_LOUDNESS } from '../../prototypes/sfx-concepts/src/engine/levels';
import { LOOP_EVENT_IDS } from '../../prototypes/sfx-concepts/src/engine/loops';
import { NOMINAL_LENGTH_S, RECIPES } from '../../prototypes/sfx-concepts/src/engine/recipes';
import { VARIATION_BY_EVENT, VariationSource, makeVariation, variationRangeFor } from '../../prototypes/sfx-concepts/src/engine/variation';
import { LiveMatch } from '../../prototypes/sfx-concepts/src/live/LiveMatch';
import { CONTACT_MARGIN_M, DISTANCE_FAR_M, DISTANCE_FLOOR_DB, DISTANCE_NEAR_M, RESULT_STINGER_DELAY_S, deriveSfx, distanceGain, initialMemory, type DeriveInput, type SfxTrigger } from '../../prototypes/sfx-concepts/src/live/deriveSfx';
import { SEQUENCES, loopStateAt } from '../../prototypes/sfx-concepts/src/sequences';
import { STORAGE_KEY, defaultSettings, effectiveChoice, exportDecisions, loadSettings, parseSettings, saveSettings, serializeSettings, summarize, withChoice, type LabSettings } from '../../prototypes/sfx-concepts/src/selection';

// SFX Lab checks (a decision tool, not the game's audio). Everything here
// is the Lab's pure logic: the event catalog, the owner's saved choices,
// the deterministic variation, the mix policy that keeps frequent sounds
// from becoming a wall of audio, and the observe-only mapping from the
// game's real simulation to sounds. The Web Audio side is covered by the
// Chromium smoke (tests/smoke/sfxConcepts.spec.ts).

const ONE_SHOTS = EVENTS.filter((e) => e.kind === 'oneShot');
const LOOPS = EVENTS.filter((e) => e.kind === 'loop');

describe('SFX Lab catalog', () => {
  it('has unique ids and valid categories, buses and mix rules', () => {
    const ids = EVENTS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    const categories = new Set(CATEGORIES.map((c) => c.id));
    const buses = new Set(BUSES.map((b) => b.id));
    for (const event of EVENTS) {
      expect(categories.has(event.category), event.id).toBe(true);
      expect(buses.has(event.mix.bus), event.id).toBe(true);
      expect(event.mix.priority, event.id).toBeGreaterThanOrEqual(0);
      expect(event.mix.priority, event.id).toBeLessThanOrEqual(10);
      expect(event.mix.gate, event.id).toBeGreaterThanOrEqual(0);
      expect(event.mix.gate, event.id).toBeLessThan(1);
      expect(event.mix.maxVoices, event.id).toBeGreaterThanOrEqual(1);
      expect(event.auditionMagnitudes.length, event.id).toBeGreaterThan(0);
      for (const m of event.auditionMagnitudes) {
        // One-shots audition above their gate; a loop's audition value is its parameter (e.g. charge 0 → 1).
        if (event.kind === 'oneShot') expect(m, event.id).toBeGreaterThan(event.mix.gate);
        expect(m, event.id).toBeGreaterThanOrEqual(0);
        expect(m, event.id).toBeLessThanOrEqual(1);
      }
      expect(event.trigger.length, event.id).toBeGreaterThan(10);
      expect(event.source.length, event.id).toBeGreaterThan(3);
    }
    for (const category of CATEGORIES) expect(EVENTS.some((e) => e.category === category.id), category.id).toBe(true);
    expect(() => eventById('nope')).toThrow();
  });

  it('can play every event: a recipe per one-shot, a builder per loop, and every table covers it', () => {
    expect([...LOOP_EVENT_IDS].sort()).toEqual(LOOPS.map((e) => e.id).sort());
    for (const event of ONE_SHOTS) {
      expect(RECIPES[event.id], event.id).toBeTypeOf('function');
      expect(NOMINAL_LENGTH_S[event.id], event.id).toBeGreaterThan(0);
      expect(VARIATION_BY_EVENT[event.id], event.id).toBeDefined();
    }
    for (const id of Object.keys(RECIPES)) expect(eventById(id).kind, id).toBe('oneShot');
    for (const event of EVENTS) {
      expect(TARGET_LOUDNESS[event.id], event.id).toBeTypeOf('number');
      for (const direction of DIRECTION_IDS) {
        const trim = LEVEL_TRIM_DB[direction][event.id];
        expect(trim, `${direction} ${event.id}`).toBeTypeOf('number');
        expect(Math.abs(trim!), `${direction} ${event.id}`).toBeLessThanOrEqual(15);
      }
    }
  });

  it('keeps the mix hierarchy: ambient beds at the bottom, the end of a round on top, big moments duck', () => {
    const ambient = ['spinHum', 'floorScrape', 'wallGrind'];
    const maxAmbient = Math.max(...ambient.map((id) => eventById(id).mix.priority));
    for (const event of EVENTS.filter((e) => !ambient.includes(e.id) && e.category !== 'ui')) expect(event.mix.priority, event.id).toBeGreaterThan(maxAmbient);
    for (const event of LOOPS) expect(event.mix.bus).toBe('loops');
    for (const event of EVENTS) expect(event.mix.bus === 'ui', event.id).toBe(event.category === 'ui');
    const top = Math.max(...EVENTS.map((e) => e.mix.priority));
    for (const id of ['ko', 'ringOut']) expect(eventById(id).mix.priority).toBe(top);
    for (const id of ['ko', 'ringOut', 'clashStart', 'clashResolve', 'stabilityBreak']) {
      const duck = eventById(id).mix.duck;
      expect(duck, id).toBeDefined();
      expect(duck!.db, id).toBeLessThan(0);
      expect(duck!.ms, id).toBeGreaterThan(0);
    }
    // Routine sounds never duck the others.
    for (const id of ['beyContact', 'hit', 'clashMash', 'uiFocus', 'landing']) expect(eventById(id).mix.duck, id).toBeUndefined();
    // The most frequent sounds are rate-limited; light physical grazes stay silent.
    for (const id of ['beyContact', 'wallImpact', 'landing', 'clashMash']) expect(eventById(id).mix.cooldownMs, id).toBeGreaterThan(0);
    for (const id of ['beyContact', 'wallImpact', 'landing']) expect(eventById(id).mix.gate, id).toBeGreaterThan(0);
  });

  it('defines three distinct directions', () => {
    expect(DIRECTION_IDS).toEqual(['A', 'B', 'C']);
    const styles = new Set(DIRECTION_IDS.map((id) => DIRECTIONS[id].sting.style));
    expect(styles.size).toBe(3);
    for (const id of DIRECTION_IDS) {
      expect(DIRECTIONS[id].id).toBe(id);
      expect(DIRECTIONS[id].name.length).toBeGreaterThan(2);
      expect(DIRECTIONS[id].description.length).toBeGreaterThan(20);
    }
  });
});

describe('SFX Lab selections', () => {
  it('starts with every event pending (the Lab never picks for the owner)', () => {
    const settings = defaultSettings();
    expect(Object.keys(settings.choices).sort()).toEqual(EVENTS.map((e) => e.id).sort());
    expect(Object.values(settings.choices).every((c) => c === null)).toBe(true);
    const summary = summarize(settings);
    expect(summary.counts).toEqual({ A: 0, B: 0, C: 0, none: 0, pending: EVENTS.length });
  });

  it('round-trips A/B/C/SEM SOM choices, preview and volumes', () => {
    let settings = defaultSettings();
    settings = withChoice(settings, 'hit', 'B');
    settings = withChoice(settings, 'spinHum', 'none');
    settings = withChoice(settings, 'ko', 'C');
    settings = { ...settings, preview: 'C', masterVolume: 0.4, busVolumes: { ...settings.busVolumes, loops: 0.25 } };
    const parsed = parseSettings(serializeSettings(settings));
    expect(parsed.choices.hit).toBe('B');
    expect(parsed.choices.spinHum).toBe('none');
    expect(parsed.choices.ko).toBe('C');
    expect(parsed.choices.dodge).toBeNull();
    expect(parsed.preview).toBe('C');
    expect(parsed.masterVolume).toBe(0.4);
    expect(parsed.busVolumes.loops).toBe(0.25);
    // Clicking the active choice again puts the event back to pending.
    expect(withChoice(parsed, 'hit', null).choices.hit).toBeNull();
    expect(settings.choices.dodge).toBeNull(); // withChoice never mutates
  });

  it('ignores corrupt or foreign saved data', () => {
    for (const raw of [null, '', '{', '42', 'null', '[]']) expect(parseSettings(raw)).toEqual(defaultSettings());
    const parsed = parseSettings(JSON.stringify({ choices: { hit: 'D', ko: 'A', madeUp: 'B' }, preview: 'Z', masterVolume: 7, busVolumes: { loops: -1, ui: 'x' } }));
    expect(parsed.choices.hit).toBeNull();
    expect(parsed.choices.ko).toBe('A');
    expect('madeUp' in parsed.choices).toBe(false);
    expect(parsed.preview).toBe('A');
    expect(parsed.masterVolume).toBe(1);
    expect(parsed.busVolumes.loops).toBe(0);
    expect(parsed.busVolumes.ui).toBe(1);
  });

  it('lets the preview stand in for pending events, but never for decided ones', () => {
    let settings: LabSettings = { ...defaultSettings(), preview: 'B' };
    expect(effectiveChoice(settings, 'hit')).toBe('B');
    settings = withChoice(settings, 'hit', 'none');
    expect(effectiveChoice(settings, 'hit')).toBe('none');
  });

  it('exports decisions without inventing any (pending stays pending)', () => {
    let settings: LabSettings = { ...defaultSettings(), preview: 'C' };
    settings = withChoice(settings, 'hit', 'A');
    settings = withChoice(settings, 'uiFocus', 'none');
    const exported = JSON.parse(exportDecisions(settings, new Date('2026-09-29T12:00:00Z')));
    expect(exported.exportedAt).toBe('2026-09-29T12:00:00.000Z');
    expect(exported.counts).toEqual({ A: 1, B: 0, C: 0, none: 1, pending: EVENTS.length - 2 });
    expect(exported.decisions).toHaveLength(EVENTS.length);
    expect(exported.decisions.find((d: { id: string }) => d.id === 'ko').choice).toBe('pending');
    expect(JSON.stringify(exported)).not.toContain('"preview"');
  });

  it('survives missing or throwing browser storage', () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadSettings(null)).toEqual(defaultSettings());
    expect(loadSettings(throwing)).toEqual(defaultSettings());
    expect(saveSettings(null, defaultSettings())).toBe(false);
    expect(saveSettings(throwing, defaultSettings())).toBe(false);
    const memory = new Map<string, string>();
    const storage = { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => void memory.set(k, v) };
    expect(saveSettings(storage, withChoice(defaultSettings(), 'dodge', 'C'))).toBe(true);
    expect(memory.has(STORAGE_KEY)).toBe(true);
    expect(loadSettings(storage).choices.dodge).toBe('C');
  });
});

describe('SFX Lab variation', () => {
  it('is deterministic per (event, side, play count)', () => {
    const a = new VariationSource();
    const b = new VariationSource();
    const playsA = Array.from({ length: 20 }, (_, i) => a.next('hit', i % 2 ? 'first' : 'second'));
    const playsB = Array.from({ length: 20 }, (_, i) => b.next('hit', i % 2 ? 'first' : 'second'));
    expect(playsA).toEqual(playsB);
    a.reset();
    expect(a.next('hit', 'second')).toEqual(playsA[0]);
  });

  it('stays inside its ranges, never repeats a layer back to back, and still varies', () => {
    for (const id of ['beyContact', 'hit', 'clashMash', 'landing']) {
      const range = variationRangeFor(id);
      const source = new VariationSource(1234);
      let previous: number | null = null;
      const pitches = new Set<number>();
      for (let i = 0; i < 300; i++) {
        const v = source.next(id, 'first');
        expect(Math.abs(1200 * Math.log2(v.pitch)), id).toBeLessThanOrEqual(range.pitchCents + 1e-9);
        expect(Math.abs(20 * Math.log10(v.gain)), id).toBeLessThanOrEqual(range.gainDb + 1e-9);
        expect(Math.abs(v.length - 1), id).toBeLessThanOrEqual(range.lengthPct + 1e-9);
        expect(v.layer, id).toBeGreaterThanOrEqual(0);
        expect(v.layer, id).toBeLessThan(range.layers);
        if (range.layers > 1 && previous !== null) expect(v.layer, id).not.toBe(previous);
        previous = v.layer;
        pitches.add(Math.round(v.pitch * 1e6));
      }
      expect(pitches.size, id).toBeGreaterThan(100);
    }
  });

  it('keeps signals (UI, round result) fixed', () => {
    for (const id of ['uiConfirm', 'uiBack', 'uiError', 'victory', 'defeat', 'draw', 'roundStart']) {
      const v = makeVariation(variationRangeFor(id), 987654, 0);
      expect([v.pitch, v.gain, v.length, v.layer], id).toEqual([1, 1, 1, 0]);
    }
  });
});

describe('SFX Lab mix policy', () => {
  const rule = (over: Partial<Parameters<MixPolicy['request']>[0]['rule']> = {}) => ({ bus: 'gameplay' as const, priority: 5, cooldownMs: 100, maxVoices: 2, gate: 0.1, ...over });

  it('drops sounds below the gate and inside the cooldown, per side', () => {
    const policy = new MixPolicy();
    expect(policy.request({ eventId: 'e', rule: rule(), magnitude: 0.05, nowMs: 0, durationMs: 50 })).toEqual({ accepted: false, reason: 'gate' });
    expect(policy.request({ eventId: 'e', rule: rule(), key: 'first', magnitude: 0.5, nowMs: 0, durationMs: 50 }).accepted).toBe(true);
    expect(policy.request({ eventId: 'e', rule: rule(), key: 'first', magnitude: 0.5, nowMs: 60, durationMs: 50 })).toEqual({ accepted: false, reason: 'cooldown' });
    expect(policy.request({ eventId: 'e', rule: rule(), key: 'second', magnitude: 0.5, nowMs: 60, durationMs: 50 }).accepted).toBe(true);
    expect(policy.request({ eventId: 'e', rule: rule(), key: 'first', magnitude: 0.5, nowMs: 120, durationMs: 50 }).accepted).toBe(true);
    // Auditioning skips gate and cooldown.
    expect(policy.request({ eventId: 'e', rule: rule(), key: 'first', magnitude: 0, nowMs: 121, durationMs: 50, force: true }).accepted).toBe(true);
  });

  it('cuts the oldest copy when an event exceeds its voices', () => {
    const policy = new MixPolicy();
    const r = rule({ cooldownMs: 0, maxVoices: 2 });
    const first = policy.request({ eventId: 'e', rule: r, magnitude: 1, nowMs: 0, durationMs: 1000 });
    policy.request({ eventId: 'e', rule: r, magnitude: 1, nowMs: 10, durationMs: 1000 });
    const third = policy.request({ eventId: 'e', rule: r, magnitude: 1, nowMs: 20, durationMs: 1000 });
    expect(first.accepted && third.accepted).toBe(true);
    if (first.accepted && third.accepted) expect(third.stolen).toEqual([first.voiceId]);
    expect(policy.activeVoices(30)).toHaveLength(2);
    expect(policy.activeVoices(2000)).toHaveLength(0);
  });

  it('lets an important sound cut through a full budget, and drops a routine one without touching anything', () => {
    const policy = new MixPolicy(3);
    const low = rule({ priority: 2, cooldownMs: 0, maxVoices: 10 });
    for (let i = 0; i < 3; i++) policy.request({ eventId: `low${i}`, rule: low, magnitude: 1, nowMs: i, durationMs: 1000 });
    // Same priority as everything playing: nothing is cut, the newcomer is dropped.
    expect(policy.request({ eventId: 'other', rule: low, magnitude: 1, nowMs: 5, durationMs: 1000 })).toEqual({ accepted: false, reason: 'budget' });
    expect(policy.activeVoices(6).map((v) => v.eventId)).toEqual(['low0', 'low1', 'low2']);
    // A KO-class sound steals the oldest least important voice.
    const ko = policy.request({ eventId: 'ko', rule: rule({ priority: 10, duck: { db: -12, ms: 1100 } }), magnitude: 1, nowMs: 7, durationMs: 1000 });
    expect(ko.accepted).toBe(true);
    if (ko.accepted) {
      expect(ko.stolen).toHaveLength(1);
      expect(ko.duck).toEqual({ db: -12, ms: 1100 });
    }
    expect(policy.activeVoices(8).map((v) => v.eventId)).toEqual(['low1', 'low2', 'ko']);
  });

  it('ducks by the deepest active moment, each for its own time', () => {
    const ducks = new DuckTracker();
    expect(ducks.levelDb(0)).toBe(0);
    ducks.add({ db: -6, ms: 500 }, 0);
    ducks.add({ db: -12, ms: 200 }, 100);
    expect(ducks.levelDb(150)).toBe(-12);
    expect(ducks.levelDb(350)).toBe(-6);
    expect(ducks.levelDb(600)).toBe(0);
  });
});

// ---------------------------------------------------------------- deriveSfx ----

function side(over: Omit<Partial<BeySnapshot>, 'movement' | 'spin'> & { movement?: Partial<BeySnapshot['movement']>; spin?: Partial<BeySnapshot['spin']> } = {}): BeySnapshot {
  const base = {
    grounded: true,
    driftState: DriftState.Idle,
    dodgeState: DodgeState.Idle,
    attackState: AttackState.Neutral,
    dashChargeFraction: 0,
    staminaFraction: 1,
    stabilityFraction: 1,
    isBroken: false,
    attackEnergyFraction: 1,
    justLanded: false,
    landingDescentSpeedMps: 0,
    landingIntensity: 0,
    landingJumpAssistElapsedS: 0,
  };
  const { movement, spin, ...rest } = over;
  return {
    ...base,
    ...rest,
    movement: { speedMps: 3, slipAngleRad: 0, impactDeltaSpeedMps: 0, ...movement },
    spin: { spinRateRadPerSec: 20, wobbleEnergy: 0, ...spin },
  } as BeySnapshot;
}

function input(over: Partial<DeriveInput> & { first?: BeySnapshot; second?: BeySnapshot; hitEvents?: MatchTickResult['hitEvents']; combatEvents?: MatchTickResult['combatEvents'] } = {}): DeriveInput {
  const { first, second, hitEvents, combatEvents, ...rest } = over;
  return {
    result: { first: first ?? side(), second: second ?? side(), hitEvents: hitEvents ?? [], combatEvents: combatEvents ?? [] },
    advanced: true,
    clashResolvedThisTick: null,
    positions: { first: { x: -3, y: 0, z: 0 }, second: { x: 3, y: 0, z: 0 } },
    radii: { first: 0.65, second: 0.62 },
    clash: { state: ClashState.Idle, elapsedS: 0, mashFirst: 0, mashSecond: 0 },
    outcome: RoundOutcome.Ongoing,
    ...rest,
  };
}

const ids = (triggers: readonly SfxTrigger[]) => triggers.map((t) => t.eventId);
const started = () => deriveSfx(initialMemory(), input()).memory;

describe('SFX Lab deriveSfx (observe-only mapping)', () => {
  it('opens the round once, then stays quiet on a calm tick', () => {
    const first = deriveSfx(initialMemory(), input());
    expect(ids(first.triggers)).toEqual(['roundStart']);
    expect(ids(deriveSfx(first.memory, input()).triggers)).toEqual([]);
  });

  it('tells a hit from a counter and scales the hit with the real knockback', () => {
    const hit = (force: number, caught = false) => ({ attackerIsFirst: true, hitbox: { kind: 'circular' as const, radiusM: 1, knockbackForce: force, stabilityDamage: 1 }, caughtOpponentDashing: caught });
    const weak = deriveSfx(started(), input({ hitEvents: [hit(2)] })).triggers;
    const strong = deriveSfx(started(), input({ hitEvents: [hit(40)] })).triggers;
    expect(ids(weak)).toEqual(['hit']);
    expect(strong[0]!.magnitude).toBeGreaterThan(weak[0]!.magnitude);
    expect(strong[0]!.side).toBe('second'); // heard at the defender
    expect(ids(deriveSfx(started(), input({ hitEvents: [hit(40, true)] })).triggers)).toEqual(['counter']);
  });

  it('classifies an impact as Bey contact, wall bounce, or nothing (mid-arena bump)', () => {
    const bump = side({ movement: { impactDeltaSpeedMps: 4 } });
    const close = { first: { x: 0, y: 0, z: 0 }, second: { x: 0.65 + 0.62 + CONTACT_MARGIN_M - 0.01, y: 0, z: 0 } };
    expect(ids(deriveSfx(started(), input({ first: bump, second: bump, positions: close })).triggers)).toEqual(['beyContact']);
    const atWall = { first: { x: 11.5, y: 0, z: 0 }, second: { x: -2, y: 0, z: 0 } };
    expect(ids(deriveSfx(started(), input({ first: bump, positions: atWall })).triggers)).toEqual(['wallImpact']);
    const midArena = { first: { x: 2, y: 0, z: 0 }, second: { x: -4, y: 0, z: 0 } };
    expect(ids(deriveSfx(started(), input({ first: bump, positions: midArena })).triggers)).toEqual([]);
  });

  it('plays a perfect dodge instead of, not on top of, the regular dodged sound', () => {
    const both = deriveSfx(started(), input({ combatEvents: [{ kind: 'dodged', targetIsFirst: true }, { kind: 'perfectDodge', targetIsFirst: true }] })).triggers;
    expect(ids(both)).toEqual(['perfectDodge']);
    const plain = deriveSfx(started(), input({ combatEvents: [{ kind: 'dodged', targetIsFirst: true }, { kind: 'perfectDodge', targetIsFirst: false }, { kind: 'dodged', targetIsFirst: false }] })).triggers;
    expect(ids(plain)).toEqual(['dodged', 'perfectDodge']);
    expect(plain[0]!.side).toBe('first');
  });

  it('hears the opponent quieter the farther it is from the player, never below the floor', () => {
    const at = (x: number) => ({ x, y: 0, z: 0 });
    const origin = at(0);
    expect(distanceGain(at(DISTANCE_NEAR_M), origin)).toBe(1);
    expect(20 * Math.log10(distanceGain(at(DISTANCE_FAR_M), origin))).toBeCloseTo(DISTANCE_FLOOR_DB, 6);
    expect(distanceGain(at(40), origin)).toBeCloseTo(distanceGain(at(DISTANCE_FAR_M), origin), 9);
    let previous = 1;
    for (let x = 0; x <= 24; x += 1) {
      const g = distanceGain(at(x), origin);
      expect(g).toBeLessThanOrEqual(previous);
      previous = g;
    }
    // The player's own Dash is always close; the opponent's across the arena is not.
    const far = { first: at(-9), second: at(9) };
    const out = deriveSfx(started(), input({ positions: far, first: side({ dodgeState: DodgeState.Dodging }), second: side({ dodgeState: DodgeState.Dodging }) }));
    const [mine, theirs] = [out.triggers.find((t) => t.side === 'first')!, out.triggers.find((t) => t.side === 'second')!];
    expect(mine.gain).toBe(1);
    expect(theirs.gain).toBeLessThan(0.5);
    expect(out.loops.find((l) => l.key === 'spinHum:first')!.gain).toBe(1);
    expect(out.loops.find((l) => l.key === 'spinHum:second')!.gain).toBeCloseTo(theirs.gain, 9);
    expect(out.loops.find((l) => l.key === 'clashTension')!.gain).toBe(1);
  });

  it('hears nothing new on a hitstop-frozen tick', () => {
    const hit = { attackerIsFirst: true, hitbox: { kind: 'dash' as const, radiusM: 1, knockbackForce: 30, stabilityDamage: 1 }, caughtOpponentDashing: false };
    expect(ids(deriveSfx(started(), input({ advanced: false, hitEvents: [hit], combatEvents: [{ kind: 'ko', targetIsFirst: false }] })).triggers)).toEqual([]);
  });

  it('fires state edges once: Dash charge full, release, energy out, dodge, jump, stamina warning, recovery', () => {
    let memory = started();
    const step = (first: BeySnapshot) => {
      const out = deriveSfx(memory, input({ first }));
      memory = out.memory;
      return ids(out.triggers);
    };
    expect(step(side({ attackState: AttackState.ChargingDash, dashChargeFraction: 0.5 }))).toEqual([]);
    expect(step(side({ attackState: AttackState.ChargingDash, dashChargeFraction: 1 }))).toEqual(['dashFull']);
    expect(step(side({ attackState: AttackState.ChargingDash, dashChargeFraction: 1 }))).toEqual([]);
    expect(step(side({ attackState: AttackState.DashActive, dashChargeFraction: 1, attackEnergyFraction: 0 }))).toEqual(['dashRelease', 'energyEmpty']);
    expect(step(side({ dodgeState: DodgeState.Dodging }))).toEqual(['dodge']);
    expect(step(side({ driftState: DriftState.Hopping }))).toEqual(['jump']);
    expect(step(side({ staminaFraction: 0.3 }))).toEqual(['staminaLow']);
    expect(step(side({ staminaFraction: 0.2 }))).toEqual([]);
    expect(step(side({ isBroken: true }))).toEqual([]);
    expect(step(side({ isBroken: false }))).toEqual(['stabilityRecover']);
  });

  it('follows a Clash: start, mash from each side with rising intensity, resolution', () => {
    let memory = started();
    const step = (over: Partial<DeriveInput>) => {
      const out = deriveSfx(memory, input(over));
      memory = out.memory;
      return out;
    };
    expect(ids(step({ clash: { state: ClashState.Active, elapsedS: 0, mashFirst: 0, mashSecond: 0 } }).triggers)).toEqual(['clashStart']);
    const early = step({ clash: { state: ClashState.Active, elapsedS: 0.5, mashFirst: 1, mashSecond: 0 } });
    expect(ids(early.triggers)).toEqual(['clashMash']);
    const late = step({ clash: { state: ClashState.Active, elapsedS: 3.5, mashFirst: 1, mashSecond: 1 } });
    expect(late.triggers[0]!.side).toBe('second');
    expect(late.triggers[0]!.magnitude).toBeGreaterThan(early.triggers[0]!.magnitude);
    expect(late.loops.find((l) => l.key === 'clashTension')!.level).toBe(1);
    const tie = { outcome: ClashOutcome.Tie, firstClashPower: 1, secondClashPower: 1, firstMashEventCount: 1, secondMashEventCount: 1 };
    const end = step({ clash: { state: ClashState.Cooldown, elapsedS: 0, mashFirst: 0, mashSecond: 0 }, clashResolvedThisTick: tie });
    expect(ids(end.triggers)).toEqual(['clashTie']);
    expect(end.loops.find((l) => l.key === 'clashTension')!.level).toBe(0);
  });

  it('plays the round-result stinger once, after the KO lands', () => {
    const ko = deriveSfx(started(), input({ combatEvents: [{ kind: 'ko', targetIsFirst: false }], outcome: RoundOutcome.FirstWinsByKo }));
    expect(ids(ko.triggers)).toEqual(['ko', 'victory']);
    expect(ko.triggers[1]!.delayS).toBe(RESULT_STINGER_DELAY_S);
    expect(ids(deriveSfx(ko.memory, input({ outcome: RoundOutcome.FirstWinsByKo })).triggers)).toEqual([]);
    expect(ids(deriveSfx(started(), input({ outcome: RoundOutcome.SecondWinsByRingOut })).triggers)).toEqual(['defeat']);
    expect(ids(deriveSfx(started(), input({ outcome: RoundOutcome.Draw })).triggers)).toEqual(['draw']);
    // The loser's loops go silent.
    const loops = deriveSfx(started(), input({ outcome: RoundOutcome.FirstWinsByKo })).loops;
    expect(loops.find((l) => l.key === 'spinHum:second')!.level).toBe(0);
    expect(loops.find((l) => l.key === 'spinHum:first')!.level).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------- live ----

describe('SFX Lab live match (the real simulation, only listened to)', () => {
  const matches: LiveMatch[] = [];
  afterAll(() => matches.forEach((m) => m.dispose()));
  const MAX_TICKS = 6000;

  async function listen(seed: string, first = ATTACK_ARCHETYPE, second = DEFENSE_ARCHETYPE) {
    const match = await LiveMatch.create(seed, first, second);
    matches.push(match);
    const log: { tick: number; trigger: SfxTrigger }[] = [];
    let loopsOk = true;
    while (match.outcome === RoundOutcome.Ongoing && match.ticks < MAX_TICKS) {
      const frame = match.step();
      for (const trigger of frame.output.triggers) log.push({ tick: frame.tick, trigger });
      for (const loop of frame.output.loops) {
        if (!(loop.level >= 0 && loop.level <= 1 && loop.param >= 0 && loop.param <= 1 && Math.abs(loop.pan) <= 0.8 && loop.gain > 0 && loop.gain <= 1)) loopsOk = false;
        if (eventById(loop.eventId).kind !== 'loop') loopsOk = false;
      }
    }
    return { match, log, loopsOk };
  }

  it('turns a real AI fight into valid, bounded sound requests and ends with one result stinger', async () => {
    // Seed chosen because this fight has a bit of everything (contact, hits,
    // dodges, a full Clash, a Break and a KO): see the heard-set check below.
    const { match, log, loopsOk } = await listen('sfx-lab-15');
    expect(loopsOk).toBe(true);
    expect(log.filter((e) => e.trigger.eventId === 'roundStart').map((e) => e.tick)).toEqual([1]);
    for (const { trigger } of log) {
      expect(eventById(trigger.eventId).kind, trigger.eventId).toBe('oneShot');
      expect(trigger.magnitude, trigger.eventId).toBeGreaterThanOrEqual(0);
      expect(trigger.magnitude, trigger.eventId).toBeLessThanOrEqual(1);
      expect(Math.abs(trigger.pan), trigger.eventId).toBeLessThanOrEqual(0.8);
      expect(trigger.gain, trigger.eventId).toBeGreaterThan(0);
      expect(trigger.gain, trigger.eventId).toBeLessThanOrEqual(1);
    }
    const heard = new Set(log.map((e) => e.trigger.eventId));
    for (const id of ['hit', 'beyContact', 'landing', 'circularStart', 'dashRelease', 'perfectDodge', 'clashStart', 'clashMash', 'clashResolve', 'stabilityBreak']) expect(heard.has(id), id).toBe(true);
    expect(heard.has('dodged')).toBe(false); // every dodge in this fight was perfect
    expect(match.outcome).not.toBe(RoundOutcome.Ongoing);
    const results = log.filter((e) => ['victory', 'defeat', 'draw'].includes(e.trigger.eventId));
    expect(results).toHaveLength(1);
    expect(results[0]!.trigger.delayS).toBe(RESULT_STINGER_DELAY_S);
    const end = log.find((e) => e.trigger.eventId === 'ko' || e.trigger.eventId === 'ringOut');
    expect(end?.tick).toBe(results[0]!.tick);
  }, 120_000);

  it('is deterministic and never changes the match it listens to', async () => {
    const seed = 'sfx-lab-20'; // includes a Clash
    const a = await listen(seed, STAMINA_ARCHETYPE, ATTACK_ARCHETYPE);
    const b = await listen(seed, STAMINA_ARCHETYPE, ATTACK_ARCHETYPE);
    expect(b.log).toEqual(a.log);
    // Same seed through the M8 Self Test runner, with nobody listening:
    // same ending on the same tick.
    const plain = await simulateAiMatch({ seed, firstDefinition: STAMINA_ARCHETYPE, secondDefinition: ATTACK_ARCHETYPE, maxTicks: MAX_TICKS });
    expect(a.match.outcome).toBe(plain.stats.outcome);
    expect(a.match.ticks).toBe(plain.stats.ticks);
  }, 180_000);
});

describe('SFX Lab context sequences', () => {
  it('only uses known events, in time order, inside the scene', () => {
    const seen = new Set<string>();
    for (const sequence of SEQUENCES) {
      expect(seen.has(sequence.id), sequence.id).toBe(false);
      seen.add(sequence.id);
      let last = -Infinity;
      for (const step of sequence.steps) {
        expect(eventById(step.eventId).kind, `${sequence.id} ${step.eventId}`).toBe('oneShot');
        expect(step.atS, sequence.id).toBeGreaterThanOrEqual(last);
        expect(step.atS, sequence.id).toBeLessThan(sequence.durationS);
        last = step.atS;
      }
      for (const ramp of sequence.loops) {
        expect(eventById(ramp.eventId).kind, `${sequence.id} ${ramp.key}`).toBe('loop');
        expect(ramp.toS, sequence.id).toBeGreaterThanOrEqual(ramp.fromS);
      }
    }
    // Together the scenes cover most of the catalog.
    const covered = new Set(SEQUENCES.flatMap((s) => [...s.steps.map((x) => x.eventId), ...s.loops.map((l) => l.eventId)]));
    expect(covered.size).toBeGreaterThanOrEqual(EVENTS.length - 2);
  });

  it('glides loops between ramps and silences them when the scene ends', () => {
    const clash = SEQUENCES.find((s) => s.id === 'clash')!;
    const mid = loopStateAt(clash, 2.1).get('clashTension')!;
    expect(mid.level).toBe(1);
    expect(mid.param).toBeGreaterThan(0.4);
    expect(mid.param).toBeLessThan(0.6);
    expect(loopStateAt(clash, 4.3).get('clashTension')!.level).toBe(0);
    expect(loopStateAt(clash, clash.durationS + 0.1).get('spinHum:first')!.level).toBe(0);
    expect(loopStateAt(clash, 0).has('clashTension')).toBe(false);
  });
});
