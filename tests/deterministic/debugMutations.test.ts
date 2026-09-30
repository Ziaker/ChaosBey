// Debug Lab mutation tools (GDD section 70) and the debug report.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GameStateMachine } from '../../src/app/lifecycle/GameState';
import { MatchSession, type Side } from '../../src/app/session/MatchSession';
import type { SideControllerSpec } from '../../src/app/session/SideControllers';
import { IdleController } from '../../src/automation/scripted-scenarios/IdleController';
import { AttackState } from '../../src/combat/attacks/AttackController';
import { ClashState } from '../../src/combat/clash/ClashController';
import { createDefaultAttackProfileSettings } from '../../src/config/attack-profile/AttackProfileSettings';
import { resolveMatchConfig } from '../../src/config/match/MatchConfig';
import {
  forceAction,
  prepareClash,
  resetCooldowns,
  setAngularVelocity,
  setLinearVelocity,
  setResourceFraction,
  teleportBey,
} from '../../src/debug/cheats/DebugMutations';
import type { InspectionFrameStats } from '../../src/debug/inspectors/buildInspection';
import { DEBUG_REPORT_FORMAT, buildDebugReport, debugReportFileName } from '../../src/debug/report/buildDebugReport';
import { DodgeState } from '../../src/dodge/DodgeController';
import { DriftState } from '../../src/drift/DriftController';
import { TelemetryEventKind } from '../../src/telemetry/events/TelemetryEvent';
import { TelemetryRecorder } from '../../src/telemetry/recording/TelemetryRecorder';

const IDLE: { first: SideControllerSpec; second: SideControllerSpec } = { first: { kind: 'idle' }, second: { kind: 'idle' } };
const FRAME: InspectionFrameStats = { gameState: 'test', fps: 60, frameTimeMs: 16, renderTimeMs: null, drawCalls: null, triangles: null, paused: true, ticksPerFixedStep: 1 };

async function createSession(seedText: string, controllers = IDLE): Promise<MatchSession> {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  scene.add(camera);
  return MatchSession.create({
    scene,
    camera,
    seedText,
    matchConfig: resolveMatchConfig(),
    attackProfileSettings: createDefaultAttackProfileSettings(),
    telemetry: new TelemetryRecorder(),
    stateMachine: new GameStateMachine(),
    controllers,
    keyboard: new IdleController(),
  });
}

function runUntil(session: MatchSession, maxTicks: number, condition: () => boolean): boolean {
  for (let i = 0; i < maxTicks; i++) {
    session.tick();
    if (condition()) return true;
  }
  return false;
}

describe('Debug Lab mutations', () => {
  it('teleport, velocity and angular velocity apply, and every mutation is logged and telemetered', async () => {
    const session = await createSession('mut-basic');
    for (let i = 0; i < 30; i++) session.tick();
    teleportBey(session, 'first', 5, -2, { headingRad: 1 });
    const t = session.getBey('first').body.translation();
    expect(t.x).toBeCloseTo(5, 6);
    expect(t.z).toBeCloseTo(-2, 6);
    expect(session.getBey('first').movement.getHeadingRad()).toBe(1);
    setLinearVelocity(session, 'second', { x: 3, y: 0, z: 0 });
    expect(session.getBey('second').body.linvel().x).toBeCloseTo(3, 6);
    setAngularVelocity(session, 'second', { x: 0, y: 20, z: 0 });
    expect(session.getBey('second').body.angvel().y).toBeCloseTo(20, 6);

    const log = session.getDebugMutations();
    expect(log).toHaveLength(3);
    expect(log[0]).toMatchObject({ tickIndex: 30 });
    expect(log[0]!.description).toMatch(/first: teleport to \(5\.00, -2\.00\)/);
    const telemetryMutations = session.telemetry.getEvents().filter((e) => e.kind === TelemetryEventKind.DebugMutation);
    expect(telemetryMutations).toHaveLength(3);
    session.dispose();
  });

  it('setting Stability keeps Broken consistent with the real rules', async () => {
    const session = await createSession('mut-stability');
    const stability = session.getBey('second').stability;
    setResourceFraction(session, 'second', 'stability', 0);
    expect(stability.isBroken).toBe(true);
    setResourceFraction(session, 'second', 'stability', 1);
    expect(stability.isBroken).toBe(false);
    expect(stability.resource.fraction).toBe(1);
    setResourceFraction(session, 'first', 'stamina', 0.25);
    expect(session.getBey('first').stamina.resource.fraction).toBeCloseTo(0.25, 9);
    setResourceFraction(session, 'first', 'attackEnergy', 0.5);
    expect(session.getBey('first').attackEnergy.resource.fraction).toBeCloseTo(0.5, 9);
    session.dispose();
  });

  it('forced inputs drive the real attack, jump and dodge systems', async () => {
    const session = await createSession('mut-forced');
    for (let i = 0; i < 20; i++) session.tick();
    const bey = (side: Side) => session.getBey(side);

    forceAction(session, 'first', 'circular');
    expect(runUntil(session, 20, () => bey('first').attack.getState() === AttackState.CircularActive)).toBe(true);
    expect(runUntil(session, 120, () => bey('first').attack.getState() === AttackState.Neutral)).toBe(true);

    forceAction(session, 'first', 'dash');
    expect(runUntil(session, 30, () => bey('first').attack.getState() === AttackState.ChargingDash)).toBe(true);
    expect(runUntil(session, 120, () => bey('first').attack.getState() === AttackState.DashActive)).toBe(true);
    expect(bey('first').attack.getChargeFraction()).toBeGreaterThan(0.95);

    forceAction(session, 'second', 'jump');
    expect(runUntil(session, 10, () => bey('second').drift.getState() === DriftState.Hopping)).toBe(true);

    // The 2.9 m forced jump lands at ~7 m/s and, since the Motion Lab
    // integration (M11), bounces off the floor (B: ×0.35, then once more):
    // wait until it has settled, as a ground Dodge needs the floor.
    runUntil(session, 200, () => false);
    forceAction(session, 'second', 'dodge');
    expect(runUntil(session, 10, () => bey('second').dodge.getState() === DodgeState.Dodging)).toBe(true);
    expect(runUntil(session, 60, () => bey('second').dodge.getState() === DodgeState.Cooldown)).toBe(true);
    resetCooldowns(session);
    expect(bey('second').dodge.getState()).toBe(DodgeState.Idle);
    expect(bey('second').dodge.getDebugTimers().cooldownRemainingS).toBe(0);
    session.dispose();
  });

  it('forced input on an AI side returns control to the AI afterwards', async () => {
    const session = await createSession('mut-forced-ai', { first: { kind: 'idle' }, second: { kind: 'ai', personality: 'archetype' } });
    forceAction(session, 'second', 'hop');
    expect(session.isForcingInput('second')).toBe(true);
    runUntil(session, 10, () => false);
    expect(session.isForcingInput('second')).toBe(false);
    expect(session.describeController('second')).toBe('AI (archetype)');
    session.dispose();
  });

  it('Prepare Clash starts a real Clash through the real window rules', async () => {
    const session = await createSession('mut-clash');
    for (let i = 0; i < 10; i++) session.tick();
    prepareClash(session);
    expect(runUntil(session, 240, () => session.clash.controller.getState() === ClashState.Active)).toBe(true);
    expect(session.getDebugMutations().length).toBeGreaterThanOrEqual(6);
    session.dispose();
  });
});

describe('debug report', () => {
  it('captures build, seed, controllers, the inspection and the mutation log, and round-trips through JSON', async () => {
    const session = await createSession('report-seed');
    for (let i = 0; i < 60; i++) session.tick();
    const clean = buildDebugReport(session, FRAME, new Date('2026-09-28T00:00:00Z'));
    expect(clean.format).toBe(DEBUG_REPORT_FORMAT);
    expect(clean.mutated).toBe(false);
    expect(clean.match.seed).toBe('report-seed');
    expect(clean.match.tick).toBe(60);
    expect(clean.match.controllers).toEqual({ first: 'Idle', second: 'Idle' });
    // M9: the report carries the real state hash; not recording or replaying here.
    expect(clean.replay).toEqual({ status: 'idle', stateHash: session.getStateHash(), ticksCompleted: 60, detail: expect.stringContaining('not recording or replaying') });
    expect(clean.inspection.some((s) => s.id === 'first-transform')).toBe(true);

    teleportBey(session, 'first', 1, 1);
    const mutated = buildDebugReport(session, FRAME);
    expect(mutated.mutated).toBe(true);
    expect(mutated.mutations).toHaveLength(1);
    const parsed = JSON.parse(JSON.stringify(mutated));
    expect(parsed.match.matchId).toBe(session.matchId);
    expect(JSON.stringify(mutated)).not.toMatch(/NaN|Infinity/);
    expect(debugReportFileName(mutated)).toMatch(/^chaosbey-debug-report-seed-t60\.json$/);
    session.dispose();
  });
});
