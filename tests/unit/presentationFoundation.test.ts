// ============================================================
// PRESENTATION FOUNDATION (docs/planning/PROTOTYPE_INTEGRATION_MAP.md)
// Proves the neutral layer that future visual systems plug into:
//   - flags are off by default and parse predictably;
//   - events are derived deterministically from finished ticks, with no
//     gameplay-derived event on a hitstop-frozen tick;
//   - selectors are pure;
//   - the hub's lifecycle never leaks, duplicates or breaks the match;
//   - a visual definition never touches a gameplay definition;
//   - the dependency direction holds: gameplay never imports presentation,
//     presentation never reaches Rapier, the AI or the camera director.
// ============================================================

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { ATTACK_ARCHETYPE, DEFENSE_ARCHETYPE, STAMINA_ARCHETYPE } from '../../src/bey/archetype/BeyArchetypes';
import type { BeyDefinition } from '../../src/bey/archetype/BeyDefinition';
import { createBeyMesh } from '../../src/bey/procedural-model/createBeyMesh';
import { AttackState } from '../../src/combat/attacks/AttackController';
import { ClashOutcome, ClashState } from '../../src/combat/clash/ClashController';
import { DodgeState } from '../../src/dodge/DodgeController';
import { DriftState } from '../../src/drift/DriftController';
import { FOUNDRY_PIT, RIFT_CRATER } from '../../src/arena/presets/ArenaPresets';
import {
  BeyVisualAnchors,
  BeyVisualRegistry,
  IDLE_CLASH_SNAPSHOT,
  PRESENTATION_FEATURES_OFF,
  PRESENTATION_FEATURE_IDS,
  PresentationEventDeriver,
  PresentationHub,
  PresentationMaterialRegistry,
  VFX_ANCHOR_NAMES,
  VfxDirector,
  arenaPhysicsDefinition,
  arenaVisualDefinition,
  collectSceneStats,
  composeArena,
  isAnyPresentationFeatureOn,
  foldRecentImpact,
  legacyPlaceholderVisual,
  parsePresentationFeatures,
  presentationFeaturesFromLocation,
  resolveBeyVisualDefinition,
  resolvePresentationFeatures,
  selectBeyPresentationState,
  selectClashPresentationSnapshot,
  selectHudPresentationState,
  type BeyPresentationFacts,
  type BeyVisualDefinition,
  type ClashSource,
  type MatchPresentationState,
  type PresentationContext,
  type PresentationEvent,
  type PresentationSystem,
  type PresentationTickInput,
  type PresentationTickResult,
  type VfxEffect,
} from '../../src/presentation';
import type { ImpactEvent } from '../../src/app/simulation/impact/ImpactEvents';
import type { HitEvent } from '../../src/combat/hit-detection/HitDetection';

const POS = { x: 1, y: 0.5, z: -2 };

function tickResult(overrides: Partial<PresentationTickResult> = {}): PresentationTickResult {
  return { hitEvents: [], combatEvents: [], first: { driftState: DriftState.Idle }, second: { driftState: DriftState.Idle }, ...overrides };
}

function tickInput(tick: number, overrides: Partial<PresentationTickInput> = {}): PresentationTickInput {
  return {
    tick,
    result: tickResult(),
    impactEvents: [],
    clash: { started: false, result: null, mashEdges: [], progress: 0 },
    roundOver: false,
    roundOutcome: 'Ongoing',
    ...overrides,
  };
}

const impact = (kind: ImpactEvent['kind'], isFirst: boolean, magnitude = 0.5): ImpactEvent => ({ kind, magnitude, worldPositionM: POS, isFirst });

const dashHit = (attackerIsFirst: boolean): HitEvent => ({ attackerIsFirst, hitbox: { kind: 'dash', radiusM: 1, knockbackForce: 10, stabilityDamage: 4 }, caughtOpponentDashing: false });

const kinds = (events: readonly PresentationEvent[]): string[] => events.map((event) => event.kind);

describe('presentation feature flags', () => {
  it('are all off by default and the default is frozen', () => {
    for (const id of PRESENTATION_FEATURE_IDS) expect(PRESENTATION_FEATURES_OFF[id]).toBe(false);
    expect(Object.isFrozen(PRESENTATION_FEATURES_OFF)).toBe(true);
    expect(parsePresentationFeatures('').features).toEqual(PRESENTATION_FEATURES_OFF);
    expect(parsePresentationFeatures('?mode=play').features).toEqual(PRESENTATION_FEATURES_OFF);
  });

  it('turn on exactly what ?pfx names, report unknown names, and support all', () => {
    const parsed = parsePresentationFeatures('?mode=play&pfx=hybridVfx, newHud ,typo');
    expect(parsed.features.hybridVfx).toBe(true);
    expect(parsed.features.newHud).toBe(true);
    expect(parsed.features.newBeyVisuals).toBe(false);
    expect(parsed.unknown).toEqual(['typo']);
    expect(PRESENTATION_FEATURE_IDS.every((id) => parsePresentationFeatures('pfx=all').features[id])).toBe(true);
    expect(resolvePresentationFeatures({ arenaVisuals: true }).arenaVisuals).toBe(true);
    expect(isAnyPresentationFeatureOn(PRESENTATION_FEATURES_OFF)).toBe(false);
    expect(isAnyPresentationFeatureOn(resolvePresentationFeatures({ hybridVfx: true }))).toBe(true);
  });
});

describe('presentation flags from the page location', () => {
  it('are all off without a page (tests, headless) and follow ?pfx in a browser page', () => {
    expect(presentationFeaturesFromLocation()).toEqual(PRESENTATION_FEATURES_OFF);
    vi.stubGlobal('location', { search: '?mode=play&pfx=newHud' });
    try {
      expect(presentationFeaturesFromLocation()).toMatchObject({ newHud: true, hybridVfx: false });
    } finally {
      vi.unstubAllGlobals();
    }
    vi.stubGlobal('location', { search: '?mode=play' });
    try {
      expect(presentationFeaturesFromLocation()).toEqual(PRESENTATION_FEATURES_OFF);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('PresentationEventDeriver', () => {
  it('derives movement edges: jump, drift start, drift end', () => {
    const d = new PresentationEventDeriver();
    expect(kinds(d.derive(tickInput(0, { result: tickResult({ first: { driftState: DriftState.Hopping } }) })))).toEqual(['jumpStarted']);
    expect(kinds(d.derive(tickInput(1, { result: tickResult({ first: { driftState: DriftState.Hopping } }) })))).toEqual([]);
    expect(kinds(d.derive(tickInput(2, { result: tickResult({ first: { driftState: DriftState.Drifting } }) })))).toEqual(['driftStarted']);
    const end = d.derive(tickInput(3, { result: tickResult({ first: { driftState: DriftState.Recovering } }) }));
    expect(kinds(end)).toEqual(['driftEnded']);
    expect(end[0]).toMatchObject({ side: 'first', tick: 3 });
  });

  it('pairs each hit impact with its hit event and keeps attacker and defender straight', () => {
    const d = new PresentationEventDeriver();
    const events = d.derive(tickInput(5, { result: tickResult({ hitEvents: [dashHit(true)] }), impactEvents: [impact('hit', false, 0.8)] }));
    expect(events).toEqual([
      { kind: 'hitResolved', tick: 5, defenderSide: 'second', attackerSide: 'first', magnitude: 0.8, position: POS, hitboxKind: 'dash', caughtOpponentDashing: false },
    ]);
  });

  it('maps the rest of the impact list and combat knockback to their presentation events', () => {
    const d = new PresentationEventDeriver();
    const events = d.derive(
      tickInput(7, {
        result: tickResult({ combatEvents: [{ kind: 'knockback', targetIsFirst: true, force: 12, directionXZ: { x: 1, z: 0 } }] }),
        impactEvents: [impact('wallImpact', true), impact('landing', false), impact('stabilityBreak', true), impact('perfectDodge', false), impact('dodged', true), impact('ko', false), impact('ringOut', true)],
      }),
    );
    expect(kinds(events)).toEqual(['collisionResolved', 'landed', 'stabilityBroken', 'perfectDodge', 'dodged', 'ko', 'ringOut', 'knockbackStarted']);
    expect(events.at(-1)).toMatchObject({ kind: 'knockbackStarted', side: 'first', force: 12, directionXZ: { x: 1, z: 0 } });
  });

  it('emits no gameplay-derived event on a hitstop-frozen tick, but still reports Clash and round edges', () => {
    const d = new PresentationEventDeriver();
    const events = d.derive(
      tickInput(9, {
        result: null,
        impactEvents: [impact('hit', true)],
        clash: { started: true, result: null, mashEdges: [{ isFirst: false, mashEventCount: 3 }], progress: 0.25 },
        roundOver: true,
        roundOutcome: 'Draw',
      }),
    );
    expect(kinds(events)).toEqual(['clashStarted', 'clashProgress', 'roundEnded']);
    expect(events[1]).toMatchObject({ side: 'second', mashEventCount: 3, progress: 0.25 });
  });

  it('reports a Clash resolution with the real powers and outcome', () => {
    const d = new PresentationEventDeriver();
    const result = { outcome: ClashOutcome.SecondWins, firstClashPower: 0.2, secondClashPower: 0.7, firstMashEventCount: 4, secondMashEventCount: 9 };
    expect(d.derive(tickInput(11, { clash: { started: false, result, mashEdges: [], progress: 1 } }))).toEqual([
      { kind: 'clashResolved', tick: 11, outcome: ClashOutcome.SecondWins, firstClashPower: 0.2, secondClashPower: 0.7 },
    ]);
  });

  it('announces the round ending once, and reset re-arms the edge', () => {
    const d = new PresentationEventDeriver();
    const over = tickInput(20, { roundOver: true, roundOutcome: 'FirstWinsByKo' });
    expect(kinds(d.derive(over))).toEqual(['roundEnded']);
    expect(kinds(d.derive({ ...over, tick: 21 }))).toEqual([]);
    d.reset();
    expect(kinds(d.derive({ ...over, tick: 0 }))).toEqual(['roundEnded']);
  });

  it('reset forgets drift edge state: a restarted round sees no stale driftEnded', () => {
    const d = new PresentationEventDeriver();
    d.derive(tickInput(0, { result: tickResult({ second: { driftState: DriftState.Drifting } }) }));
    d.reset();
    expect(kinds(d.derive(tickInput(0, { result: tickResult() })))).toEqual([]);
  });

  it('is deterministic: the same inputs in the same order give the same events', () => {
    const run = (): PresentationEvent[] => {
      const d = new PresentationEventDeriver();
      const out: PresentationEvent[] = [];
      out.push(...d.derive(tickInput(0, { result: tickResult({ first: { driftState: DriftState.Hopping } }) })));
      out.push(...d.derive(tickInput(1, { result: tickResult({ hitEvents: [dashHit(false)] }), impactEvents: [impact('hit', true)] })));
      return out;
    };
    expect(run()).toEqual(run());
  });
});

function facts(overrides: Partial<BeyPresentationFacts> = {}): BeyPresentationFacts {
  return {
    grounded: true,
    driftState: DriftState.Idle,
    dodgeState: DodgeState.Idle,
    attackState: AttackState.Neutral,
    dashChargeFraction: 0.6,
    staminaFraction: 0.75,
    stabilityFraction: 0.4,
    isBroken: false,
    attackEnergyFraction: 1,
    movement: { speedMps: 5.5 },
    spin: { spinRateRadPerSec: 22, wobbleEnergy: 0.3, tiltRad: 0.1, isTumbling: false },
    ...overrides,
  };
}

describe('presentation selectors are pure', () => {
  it('normalize a Bey and never mutate or depend on anything but their arguments', () => {
    const input = Object.freeze(facts());
    const meta = { side: 'first', definitionId: 'attack-prototype', maxSpeedMps: 11 } as const;
    const a = selectBeyPresentationState(input, meta);
    const b = selectBeyPresentationState(input, meta);
    expect(a).toEqual(b);
    expect(a).toMatchObject({ stamina: 0.75, stability: 0.4, speedFraction: 0.5, airborne: false, staminaDeficit: 0.25, stabilityDeficit: 0.6, lowResourceSeverity: 0.6, wobbleSeverity: 0.3, dashCharge: 0 });
  });

  it('report the Dash charge only while charging, clamp, and survive NaN', () => {
    const meta = { side: 'second', definitionId: 'x', maxSpeedMps: 0 } as const;
    expect(selectBeyPresentationState(facts({ attackState: AttackState.ChargingDash, dashChargeFraction: 1.7 }), meta).dashCharge).toBe(1);
    const odd = selectBeyPresentationState(facts({ staminaFraction: Number.NaN, stabilityFraction: 3, grounded: false }), meta);
    expect(odd).toMatchObject({ stamina: 0, stability: 1, airborne: true, speedFraction: 0 });
  });

  it('fold recent impacts into a new record and keep the old one when nothing matches', () => {
    const none = { first: null, second: null } as const;
    expect(foldRecentImpact(none, [])).toBe(none);
    const folded = foldRecentImpact(none, [
      { kind: 'hitResolved', tick: 4, defenderSide: 'second', attackerSide: 'first', magnitude: 0.7, position: POS, hitboxKind: 'dash', caughtOpponentDashing: false },
      { kind: 'knockbackStarted', tick: 4, side: 'second', force: 9, directionXZ: null },
    ]);
    expect(folded.second).toEqual({ kind: 'knockbackStarted', magnitude: 9, tick: 4 });
    expect(folded.first).toBeNull();
    expect(none.second).toBeNull();
  });
});

function clashSource(overrides: Partial<ClashSource> = {}): ClashSource {
  return {
    getState: () => ClashState.Idle,
    getElapsedS: () => 0,
    getCooldownRemainingS: () => 0,
    getFirstMashEventCount: () => 0,
    getSecondMashEventCount: () => 0,
    getFirstStaminaFractionAtStart: () => 1,
    getSecondStaminaFractionAtStart: () => 1,
    getFirstSpeedMpsAtStart: () => 8,
    getSecondSpeedMpsAtStart: () => 8,
    getLastResult: () => null,
    ...overrides,
  };
}

describe('Clash presentation adapter', () => {
  it('is the shared idle snapshot while idle', () => {
    expect(selectClashPresentationSnapshot(clashSource())).toBe(IDLE_CLASH_SNAPSHOT);
  });

  it('exposes live progress and power while active, using the real power formula', () => {
    const snap = selectClashPresentationSnapshot(clashSource({ getState: () => ClashState.Active, getElapsedS: () => 2, getFirstMashEventCount: () => 10, getSecondMashEventCount: () => 2 }));
    expect(snap).toMatchObject({ phase: 'active', active: true, firstMashEventCount: 10, secondMashEventCount: 2, resolution: null });
    expect(snap.progress).toBeGreaterThan(0);
    expect(snap.progress).toBeLessThanOrEqual(1);
    expect(snap.firstPower).toBeGreaterThan(snap.secondPower);
  });

  it('reports the winner or tie only while in cooldown', () => {
    const last = { outcome: ClashOutcome.Tie, firstClashPower: 0.4, secondClashPower: 0.4 };
    const cooling = selectClashPresentationSnapshot(clashSource({ getState: () => ClashState.Cooldown, getLastResult: () => last, getCooldownRemainingS: () => 6 }));
    expect(cooling).toMatchObject({ phase: 'cooldown', resolution: 'tie', firstPower: 0.4, cooldownRemainingS: 6 });
    expect(selectClashPresentationSnapshot(clashSource({ getLastResult: () => last })).resolution).toBeNull();
  });
});

function matchState(overrides: Partial<MatchPresentationState> = {}): MatchPresentationState {
  const meta = (side: 'first' | 'second') => ({ side, definitionId: `bey-${side}`, maxSpeedMps: 11 }) as const;
  return {
    tick: 3,
    round: { over: false, outcome: 'Ongoing' },
    first: selectBeyPresentationState(facts(), meta('first')),
    second: selectBeyPresentationState(facts({ isBroken: true }), meta('second')),
    clash: IDLE_CLASH_SNAPSHOT,
    camera: null,
    recentImpact: { first: null, second: null },
    ...overrides,
  };
}

describe('HUD presentation contract', () => {
  it('hands a HUD plain data: normalized resources, clash, world positions and the optional flow', () => {
    const state = matchState();
    const positions = { first: { x: 0, y: 0, z: 0 }, second: { x: 3, y: 0, z: 1 } };
    const hud = selectHudPresentationState(state, positions, { roundNumber: 2, roundsToWin: 2, score: { first: 1, second: 0 } });
    expect(hud.first).toMatchObject({ stamina: 0.75, stability: 0.4, broken: false });
    expect(hud.second.broken).toBe(true);
    expect(hud.flow).toEqual({ roundNumber: 2, roundsToWin: 2, score: { first: 1, second: 0 } });
    expect(hud.worldPositions).toBe(positions);
    expect(selectHudPresentationState(state, positions).flow).toBeNull();
    // Only data: nothing a HUD could use to reach into the simulation.
    expect(JSON.parse(JSON.stringify(hud))).toMatchObject({ tick: 3 });
  });
});

function probe(id: string, log: string[] = []): PresentationSystem & { log: string[] } {
  return {
    id,
    log,
    create: () => void log.push(`${id}:create`),
    onEvents: (events) => void log.push(`${id}:events:${events.length}`),
    update: (frame) => void log.push(`${id}:update:${frame.dtSeconds}`),
    reset: () => void log.push(`${id}:reset`),
    dispose: () => void log.push(`${id}:dispose`),
    getStats: () => ({ alive: 1 }),
  };
}

function makeHub(onSystemError?: (id: string, error: unknown) => void): PresentationHub {
  const context: PresentationContext = {
    features: PRESENTATION_FEATURES_OFF,
    beys: [
      { side: 'first', definitionId: 'a' },
      { side: 'second', definitionId: 'b' },
    ],
    getVfxAnchor: () => false,
  };
  return new PresentationHub(context, onSystemError ? { onSystemError } : {});
}

describe('PresentationHub lifecycle', () => {
  it('creates on attach, delivers per tick and per frame, resets, and disposes newest first', () => {
    const log: string[] = [];
    const hub = makeHub();
    hub.attach(probe('a', log));
    hub.attach(probe('b', log));
    hub.onTick(tickInput(0, { roundOver: true }), () => matchState());
    hub.update(1 / 60);
    hub.reset();
    hub.dispose();
    expect(log).toEqual(['a:create', 'b:create', 'a:events:1', 'b:events:1', 'a:update:0.016666666666666666', 'b:update:0.016666666666666666', 'a:reset', 'b:reset', 'b:dispose', 'a:dispose']);
    expect(hub.getStats().systems).toBe(0);
  });

  it('refuses a second system with the same id, so a system cannot subscribe twice', () => {
    const hub = makeHub();
    const log: string[] = [];
    hub.attach(probe('dup', log));
    expect(() => hub.attach(probe('dup', log))).toThrow(/already attached/);
    hub.onTick(tickInput(0, { roundOver: true }), () => matchState());
    expect(log.filter((line) => line === 'dup:events:1')).toHaveLength(1);
  });

  it('detaches and disposes exactly once, and stops delivering', () => {
    const log: string[] = [];
    const hub = makeHub();
    const detach = hub.attach(probe('x', log));
    detach();
    detach();
    hub.detach('x');
    hub.onTick(tickInput(0, { roundOver: true }), () => matchState());
    expect(log).toEqual(['x:create', 'x:dispose']);
    expect(hub.has('x')).toBe(false);
  });

  it('is inert after dispose: no delivery, no attach, dispose is idempotent', () => {
    const log: string[] = [];
    const hub = makeHub();
    hub.attach(probe('x', log));
    hub.dispose();
    hub.dispose();
    expect(hub.onTick(tickInput(0, { roundOver: true }), () => matchState())).toEqual([]);
    hub.update(1);
    hub.reset();
    expect(() => hub.attach(probe('late'))).toThrow(/disposed/);
    expect(log).toEqual(['x:create', 'x:dispose']);
    expect(hub.isDisposed()).toBe(true);
  });

  it('isolates a throwing system: counted, reported, and the others keep running', () => {
    const errors: string[] = [];
    const hub = makeHub((id) => errors.push(id));
    const log: string[] = [];
    hub.attach({ id: 'bad', onEvents: () => { throw new Error('boom'); }, dispose: () => { throw new Error('boom on dispose'); } });
    hub.attach(probe('good', log));
    expect(() => hub.onTick(tickInput(0, { roundOver: true }), () => matchState())).not.toThrow();
    hub.dispose();
    expect(errors).toEqual(['bad', 'bad']);
    expect(log).toContain('good:events:1');
    expect(log).toContain('good:dispose');
    expect(hub.getStats().systemErrors).toBe(2);
  });

  it('survives its own derivation failing: counted, nothing delivered, and the next tick works', () => {
    const errors: string[] = [];
    const hub = makeHub((id) => errors.push(id));
    const log: string[] = [];
    hub.attach(probe('s', log));
    expect(() => hub.onTick(tickInput(0, { roundOver: true }), () => { throw new Error('bad selector'); })).not.toThrow();
    expect(errors).toEqual(['presentation-hub']);
    expect(log).toEqual(['s:create']);
    expect(hub.getState()).toBeNull();
    hub.onTick(tickInput(1), () => matchState());
    expect(log).toContain('s:events:0');
  });

  it('reports a thrown error to the console once per system when no handler is given', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const hub = makeHub();
      hub.attach({ id: 'noisy', onEvents: () => { throw new Error('boom'); }, dispose: () => undefined });
      hub.onTick(tickInput(0, { roundOver: true }), () => matchState());
      hub.onTick(tickInput(1), () => matchState());
      hub.dispose();
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('counts ticks and events and collects per-system stats', () => {
    const hub = makeHub();
    hub.attach(probe('s'));
    hub.onTick(tickInput(0, { roundOver: true }), () => matchState());
    hub.onTick(tickInput(1), () => matchState());
    expect(hub.getStats()).toMatchObject({ systems: 1, ticksDispatched: 2, eventsDispatched: 1, perSystem: { s: { alive: 1 } } });
  });

  it('carries recent impacts into the state it builds, and reset forgets them', () => {
    const hub = makeHub();
    const seen: MatchPresentationState['recentImpact'][] = [];
    const build = (recent: MatchPresentationState['recentImpact']): MatchPresentationState => {
      seen.push(recent);
      return matchState({ recentImpact: recent });
    };
    hub.onTick(tickInput(2, { result: tickResult({ hitEvents: [dashHit(true)] }), impactEvents: [impact('hit', false, 0.6)] }), build);
    expect(seen.at(-1)?.second).toMatchObject({ kind: 'hitResolved', tick: 2, magnitude: 0.6 });
    hub.reset();
    expect(hub.getState()).toBeNull();
    hub.onTick(tickInput(0), build);
    expect(seen.at(-1)?.second).toBeNull();
  });
});

function fakeEffect(id: string, handled: PresentationEvent[], kindsHandled: VfxEffect['kinds'], log: string[] = []): VfxEffect {
  return {
    id,
    kinds: kindsHandled,
    create: () => void log.push(`${id}:create`),
    handle: (event) => void handled.push(event),
    reset: () => void log.push(`${id}:reset`),
    dispose: () => void log.push(`${id}:dispose`),
    getCounts: () => ({ alive: handled.length }),
  };
}

describe('VfxDirector', () => {
  it('routes only the event kinds an effect asks for, and asks the hub for anchors', () => {
    const handled: PresentationEvent[] = [];
    const director = new VfxDirector();
    director.register(fakeEffect('hits', handled, ['hitResolved']));
    const hub = makeHub();
    hub.attach(director);
    hub.onTick(
      tickInput(1, { result: tickResult({ hitEvents: [dashHit(true)] }), impactEvents: [impact('hit', false), impact('landing', true)] }),
      () => matchState(),
    );
    expect(kinds(handled)).toEqual(['hitResolved']);
    expect(director.getStats()).toEqual({ effects: 1, 'hits.alive': 1 });
  });

  it('rejects a duplicate effect id, creates late-registered effects, and disposes effects newest first with the hub', () => {
    const log: string[] = [];
    const director = new VfxDirector();
    const hub = makeHub();
    hub.attach(director);
    director.register(fakeEffect('a', [], ['ringOut'], log));
    expect(() => director.register(fakeEffect('a', [], [], log))).toThrow(/already registered/);
    director.register(fakeEffect('b', [], ['ringOut'], log));
    hub.reset();
    hub.dispose();
    expect(log).toEqual(['a:create', 'b:create', 'a:reset', 'b:reset', 'b:dispose', 'a:dispose']);
    expect(() => director.register(fakeEffect('c', [], []))).toThrow(/disposed/);
  });
});

describe('Bey visual definitions are separate from gameplay definitions', () => {
  const ALL: readonly BeyDefinition[] = [ATTACK_ARCHETYPE, DEFENSE_ARCHETYPE, STAMINA_ARCHETYPE];
  const gameplayJson = (definition: BeyDefinition): string => JSON.stringify({ id: definition.id, physical: definition.physical, ratings: definition.ratings, handling: definition.handling, attack: definition.attack });

  const conceptVisual: BeyVisualDefinition = {
    id: 'concept:test',
    label: 'Test concept',
    status: 'concept',
    pieces: { topLayer: { builder: 'crown', materials: ['paint'] }, ring: { builder: 'lobes', materials: ['metal'], emissive: ['glow'] } },
    create: () => createBeyMesh(),
  };

  it('returns the legacy placeholder with every flag off, even when a visual is registered and assigned', () => {
    const registry = new BeyVisualRegistry();
    registry.register(conceptVisual);
    registry.assign(ATTACK_ARCHETYPE.id, conceptVisual.id);
    for (const definition of ALL) {
      const resolved = resolveBeyVisualDefinition(definition, PRESENTATION_FEATURES_OFF, registry);
      expect(resolved.id).toBe(`placeholder:${definition.id}`);
      expect(resolved.status).toBe('placeholder');
    }
  });

  it('uses an assigned visual only with newBeyVisuals on, and falls back for an unassigned definition', () => {
    const registry = new BeyVisualRegistry();
    registry.register(conceptVisual);
    registry.assign(ATTACK_ARCHETYPE.id, conceptVisual.id);
    const on = resolvePresentationFeatures({ newBeyVisuals: true });
    expect(resolveBeyVisualDefinition(ATTACK_ARCHETYPE, on, registry).id).toBe('concept:test');
    expect(resolveBeyVisualDefinition(DEFENSE_ARCHETYPE, on, registry).id).toBe(`placeholder:${DEFENSE_ARCHETYPE.id}`);
  });

  it('builds the same mesh through the legacy path as the definition always built', () => {
    const viaRegistry = legacyPlaceholderVisual(ATTACK_ARCHETYPE).create(ATTACK_ARCHETYPE);
    const direct = ATTACK_ARCHETYPE.appearance.createVisual();
    expect(collectSceneStats(viaRegistry.group)).toEqual(collectSceneStats(direct.group));
  });

  it('never changes a gameplay definition: registering, assigning and building leave it byte-identical', () => {
    const before = ALL.map(gameplayJson);
    const registry = new BeyVisualRegistry();
    registry.register(conceptVisual);
    for (const definition of ALL) {
      registry.assign(definition.id, conceptVisual.id);
      resolveBeyVisualDefinition(definition, resolvePresentationFeatures({ newBeyVisuals: true }), registry).create(definition);
    }
    expect(ALL.map(gameplayJson)).toEqual(before);
  });

  it('allows a visual with no gameplay definition behind it, and rejects bad registry use', () => {
    const registry = new BeyVisualRegistry();
    registry.register(conceptVisual);
    expect(registry.list().map((v) => v.id)).toEqual(['concept:test']);
    expect(() => registry.register(conceptVisual)).toThrow(/already registered/);
    expect(() => registry.assign('anything', 'missing')).toThrow(/not registered/);
    expect(registry.assignedVisualId('unassigned-gameplay-id')).toBeUndefined();
  });

  it('answers VFX anchors by name, follows the Bey group, and honours declared anchors', () => {
    const halfHeight = ATTACK_ARCHETYPE.physical.colliderHalfHeightM;
    const visual = ATTACK_ARCHETYPE.appearance.createVisual();
    const anchors = new BeyVisualAnchors(visual);
    const out = { x: 0, y: 0, z: 0 };
    expect(VFX_ANCHOR_NAMES.every((name) => anchors.getWorld(name, out))).toBe(true);
    expect(anchors.getWorld('nope', out)).toBe(false);
    anchors.getWorld('tip', out);
    expect(out.y).toBeCloseTo(-halfHeight, 5);
    anchors.getWorld('topLayer', out);
    expect(out.y).toBeGreaterThan(-halfHeight);
    visual.group.position.set(4, 1, -3);
    anchors.getWorld('center', out);
    expect(out).toEqual({ x: 4, y: 1, z: -3 });
    anchors.getWorld('tip', out);
    expect(out.y).toBeCloseTo(1 - halfHeight, 5);
    expect(new BeyVisualAnchors(visual, { tip: { x: 0, y: -9, z: 0 } }).getLocal('tip')).toEqual({ x: 0, y: -9, z: 0 });
  });
});

describe('material and palette registry', () => {
  it('creates once, shares, queries by tag, and disposes what it created', () => {
    const registry = new PresentationMaterialRegistry();
    let built = 0;
    registry.register('paint', { factory: () => (built++, new THREE.MeshStandardMaterial()), tags: ['opaque'] });
    registry.register('glow', { factory: () => new THREE.MeshBasicMaterial(), tags: ['emissive'] });
    registry.registerPalette('bey-a', { body: 0xff0000 });
    expect(registry.get('paint')).toBe(registry.get('paint'));
    expect(built).toBe(1);
    expect(registry.createdCount()).toBe(1);
    expect(registry.keysWithTag('emissive')).toEqual(['glow']);
    expect(registry.palette('bey-a')).toEqual({ body: 0xff0000 });
    const dispose = vi.spyOn(registry.get('paint'), 'dispose');
    registry.disposeCreated();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(registry.createdCount()).toBe(0);
    expect(registry.get('paint')).toBeDefined();
    expect(built).toBe(2);
    expect(() => registry.get('missing')).toThrow(/not registered/);
    expect(() => registry.register('paint', { factory: () => new THREE.Material() })).toThrow(/already/);
  });
});

describe('arena physics and visual definitions', () => {
  it('splits a preset: the physics view has no theme and the visual view has no geometry', () => {
    const physics = arenaPhysicsDefinition(RIFT_CRATER);
    const visual = arenaVisualDefinition(RIFT_CRATER);
    expect(Object.keys(physics)).toEqual(['geometry']);
    expect(physics.geometry).toBe(RIFT_CRATER.geometry);
    expect(Object.keys(visual).sort()).toEqual(['description', 'id', 'label', 'theme']);
    expect(visual.theme).toBe(RIFT_CRATER.theme);
  });

  it('composes halves from different presets without the theme touching the geometry', () => {
    const composed = composeArena(arenaPhysicsDefinition(RIFT_CRATER), arenaVisualDefinition(FOUNDRY_PIT));
    expect(composed.geometry).toBe(RIFT_CRATER.geometry);
    expect(composed.theme).toBe(FOUNDRY_PIT.theme);
  });
});

describe('scene stats', () => {
  it('counts a subtree and ignores hidden meshes in triangles and particles', () => {
    const root = new THREE.Group();
    const material = new THREE.MeshBasicMaterial();
    const box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
    const hidden = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
    hidden.visible = false;
    const points = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Array(30).fill(0), 3)), new THREE.PointsMaterial());
    root.add(box, hidden, points);
    const stats = collectSceneStats(root);
    expect(stats).toMatchObject({ objects: 4, visibleObjects: 3, meshes: 2, points: 1, materials: 2, geometries: 3, triangles: 12, particles: 10 });
    expect(collectSceneStats(new THREE.Group()).objects).toBe(1);
  });
});

// ------------------------------------------------------------
// Dependency direction
// ------------------------------------------------------------
const SRC = join(__dirname, '..', '..', 'src');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (path.endsWith('.ts')) out.push(path);
  }
  return out;
}

function importsOf(file: string): string[] {
  const text = readFileSync(file, 'utf-8');
  const fromImports = [...text.matchAll(/(?:^|\n)\s*(?:import|export)\b[^'"]*?from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]!);
  const bareImports = [...text.matchAll(/(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g)].map((m) => m[1]!);
  const dynamicImports = [...text.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]!);
  return [...fromImports, ...bareImports, ...dynamicImports];
}

describe('dependency direction', () => {
  const GAMEPLAY_DIRS = ['combat', 'physics', 'ai', 'dodge', 'drift', 'input', 'replay', 'rng', 'self-test', 'app/simulation', 'bey/movement', 'bey/spin', 'bey/stamina', 'bey/stability', 'bey/attack-energy', 'bey/motion'];

  it('scans real files and sees their imports (so a clean result means something)', () => {
    expect(sourceFiles(join(SRC, 'presentation')).length).toBeGreaterThanOrEqual(10);
    expect(importsOf(join(SRC, 'presentation', 'hub.ts')).length).toBeGreaterThanOrEqual(3);
    expect(GAMEPLAY_DIRS.every((dir) => sourceFiles(join(SRC, dir)).length > 0)).toBe(true);
  });

  it('keeps gameplay from importing presentation or VFX implementations', () => {
    const offenders: string[] = [];
    for (const dir of GAMEPLAY_DIRS) {
      for (const file of sourceFiles(join(SRC, dir))) {
        for (const spec of importsOf(file)) {
          if (/(^|\/)(presentation|vfx)(\/|$)/.test(spec)) offenders.push(`${relative(SRC, file)} → ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps presentation away from Rapier, physics bodies, the AI, the camera director, sessions and UI', () => {
    const forbidden = [/rapier/i, /(^|\/)physics\//, /(^|\/)ai\//, /camera\/director/, /app\/session/, /app\/frontend/, /app\/lifecycle/, /(^|\/)debug\//];
    const offenders: string[] = [];
    for (const file of sourceFiles(join(SRC, 'presentation'))) {
      for (const spec of importsOf(file)) {
        if (forbidden.some((pattern) => pattern.test(spec))) offenders.push(`${relative(SRC, file)} → ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the ported visual batches (Bey models, condition languages, hybrid VFX, Clash presentation, arena art) away from the camera, Rapier, the AI, sessions and UI', () => {
    // Impact vocabulary lives upstream in app/simulation; visual batches do not import camera code.
    const forbidden = [/rapier/i, /(^|\/)physics\//, /(^|\/)ai\//, /camera\//, /app\/session/, /app\/frontend/, /app\/lifecycle/, /(^|\/)debug\//];
    const dirs = ['bey/visual', 'vfx/condition', 'vfx/hybrid', 'vfx/clash', 'arena/visual'];
    expect(dirs.every((dir) => sourceFiles(join(SRC, dir)).length >= 6)).toBe(true);
    const offenders: string[] = [];
    for (const dir of dirs) {
      for (const file of sourceFiles(join(SRC, dir))) {
        for (const spec of importsOf(file)) {
          if (forbidden.some((pattern) => pattern.test(spec))) offenders.push(`${relative(SRC, file)} → ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the HUD contract free of Three.js and the DOM', () => {
    for (const file of ['hud.ts', 'events.ts', 'state.ts', 'clash.ts']) {
      const specs = importsOf(join(SRC, 'presentation', file));
      expect(specs.filter((spec) => spec === 'three' || spec.startsWith('three/')), file).toEqual([]);
      expect(readFileSync(join(SRC, 'presentation', file), 'utf-8')).not.toMatch(/\b(document|window)\./);
    }
  });
});
