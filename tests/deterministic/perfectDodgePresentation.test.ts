// ============================================================
// PERFECT DODGE, END TO END, IN THE NORMAL GAME (0.16.0)
// With the normal-game presentation defaults, a Perfect Dodge on a real
// session goes all the way through: Perfect window -> the attack would have
// connected -> the i-frames avoid the hit -> `perfectDodge` combat event ->
// presentation event -> the Hybrid VFX system receives it. No contact spark
// (no hit happened), and the simulation is identical with the presentation
// packages off: presentation adds no mechanical reward and never feeds back.
// The Dodge / Perfect Dodge rules themselves are covered in
// jumpDriftDodge.test.ts (window shorter than the i-frames, perfect only
// inside it, hit nullified); nothing here changes them.
// ============================================================

import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameStateMachine } from '../../src/app/lifecycle/GameState';
import { MatchSession } from '../../src/app/session/MatchSession';
import { IdleController } from '../../src/automation/scripted-scenarios/IdleController';
import { createDefaultAttackProfileSettings } from '../../src/config/attack-profile/AttackProfileSettings';
import { resolveMatchConfig } from '../../src/config/match/MatchConfig';
import { teleportBey } from '../../src/debug/cheats/DebugMutations';
import { Action } from '../../src/input/actions/Action';
import { DODGE_ACTIVE_DURATION_S, DODGE_PERFECT_WINDOW_S } from '../../src/dodge/DodgeTuning';
import { TelemetryRecorder } from '../../src/telemetry/recording/TelemetryRecorder';
import { HybridVfxSystem } from '../../src/vfx/hybrid/HybridVfxSystem';
import { PRESENTATION_FEATURES_DEFAULT, PRESENTATION_FEATURES_OFF, type PresentationEvent, type PresentationFeatures } from '../../src/presentation';

interface Run {
  readonly hashes: readonly string[];
  readonly events: readonly PresentationEvent[];
  readonly hybridPerfectDodges: number;
  readonly systemErrors: number;
}

async function perfectDodgeRun(features: PresentationFeatures): Promise<Run> {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1000);
  scene.add(camera);
  const session = await MatchSession.create({
    scene,
    camera,
    seedText: 'perfect-dodge-presentation',
    matchConfig: resolveMatchConfig(),
    attackProfileSettings: createDefaultAttackProfileSettings(),
    telemetry: new TelemetryRecorder(),
    stateMachine: new GameStateMachine(),
    controllers: { first: { kind: 'idle' }, second: { kind: 'idle' } },
    keyboard: new IdleController(),
    presentationFeatures: features,
  });
  const events: PresentationEvent[] = [];
  session.getPresentation().attach({
    id: 'perfect-dodge-recorder',
    create: () => undefined,
    onEvents: (batch) => {
      events.push(...batch);
    },
    update: () => undefined,
    reset: () => undefined,
    dispose: () => undefined,
  });
  // Close range, as the gameplay tests do: the Circular Attack would reach.
  teleportBey(session, 'first', 0, -0.75, { headingRad: 0 });
  teleportBey(session, 'second', 0, 0.75, { headingRad: Math.PI });
  const hashes: string[] = [];
  for (let i = 0; i < 40; i++) {
    session.tick();
    session.renderFrame(1 / 60, camera);
  }
  // Same tick: the dodge starts, the attack becomes active ~2 ticks later, inside the Perfect window.
  session.forceInput('second', 'sideways dodge', [{ fromTick: 0, held: [Action.Dodge, Action.SteerRight] }, { fromTick: 1, held: [] }], 3);
  session.forceInput('first', 'circular attack', [{ fromTick: 0, held: [Action.Attack] }, { fromTick: 2, held: [] }], 3);
  for (let i = 0; i < 60; i++) {
    session.tick();
    session.renderFrame(1 / 60, camera);
    hashes.push(session.getStateHash());
  }
  const hybridPerfectDodges = hybridCalls.filter((batch) => batch.some((event) => event.kind === 'perfectDodge')).length;
  hybridCalls.length = 0;
  const systemErrors = session.getPresentationStats().hub.systemErrors;
  session.dispose();
  return { hashes, events, hybridPerfectDodges, systemErrors };
}

const hybridCalls: (readonly PresentationEvent[])[] = [];
const originalOnEvents = HybridVfxSystem.prototype.onEvents;

describe('Perfect Dodge reaches the player as presentation, and only as presentation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    hybridCalls.length = 0;
  });

  it('the Perfect window is shorter than the i-frames (the rule this rides on, unchanged)', () => {
    expect(DODGE_PERFECT_WINDOW_S).toBeGreaterThan(0);
    expect(DODGE_PERFECT_WINDOW_S).toBeLessThan(DODGE_ACTIVE_DURATION_S);
  });

  it('with the normal-game defaults: avoided hit -> perfectDodge -> presentation event -> Hybrid VFX, no contact hit, same simulation as all-off', async () => {
    vi.spyOn(HybridVfxSystem.prototype, 'onEvents').mockImplementation(function (this: HybridVfxSystem, events, state) {
      hybridCalls.push(events);
      return originalOnEvents.call(this, events, state);
    });
    const normal = await perfectDodgeRun(PRESENTATION_FEATURES_DEFAULT);
    const perfect = normal.events.filter((event) => event.kind === 'perfectDodge');
    // Exactly one Perfect Dodge for one dodge against one attack (owner, 2026-10-02: it used to fire on every overlapping tick).
    expect(perfect).toHaveLength(1);
    expect(perfect[0]).toMatchObject({ kind: 'perfectDodge', side: 'second' });
    expect(normal.events.filter((event) => event.kind === 'dodged')).toHaveLength(1);
    // The attack was avoided: no hit landed on the dodger, so nothing makes a contact spark.
    expect(normal.events.filter((event) => event.kind === 'hitResolved' && event.defenderSide === 'second')).toEqual([]);
    // The Hybrid VFX system got the Perfect Dodge exactly once.
    expect(normal.hybridPerfectDodges).toBe(1);
    expect(normal.systemErrors).toBe(0);

    // Presentation never feeds back: with every package off the same inputs give the same state on every tick.
    const off = await perfectDodgeRun(PRESENTATION_FEATURES_OFF);
    expect(off.events.filter((event) => event.kind === 'perfectDodge')).toHaveLength(perfect.length);
    expect(off.hybridPerfectDodges).toBe(0);
    expect(normal.hashes).toEqual(off.hashes);
  }, 60_000);
});
