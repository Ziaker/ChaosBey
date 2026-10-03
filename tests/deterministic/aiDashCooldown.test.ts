// Owner, 2026-10-02 (Lote 2): the AI plays by the same Dash cooldown as the
// player — it never starts a Dash before the cooldown runs out, never gets
// stuck holding Attack waiting for it, and still Dashes again and again
// (no Attack Energy limit any more).

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GameStateMachine } from '../../src/app/lifecycle/GameState';
import { MatchSession } from '../../src/app/session/MatchSession';
import { IdleController } from '../../src/automation/scripted-scenarios/IdleController';
import { AttackState } from '../../src/combat/attacks/AttackController';
import { createDefaultAttackProfileSettings } from '../../src/config/attack-profile/AttackProfileSettings';
import { resolveMatchConfig } from '../../src/config/match/MatchConfig';
import { TelemetryRecorder } from '../../src/telemetry/recording/TelemetryRecorder';

async function aiMatch(seedText: string, dashCooldownS: number): Promise<MatchSession> {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  scene.add(camera);
  return MatchSession.create({
    scene,
    camera,
    seedText,
    matchConfig: resolveMatchConfig({ dashCooldownS }),
    attackProfileSettings: createDefaultAttackProfileSettings(),
    telemetry: new TelemetryRecorder(),
    stateMachine: new GameStateMachine(),
    controllers: { first: { kind: 'ai', personality: 'archetype' }, second: { kind: 'ai', personality: 'archetype' } },
    keyboard: new IdleController(),
  });
}

describe('AI and the Dash cooldown', () => {
  it.each([1.5, 3])('never charges a Dash before the %s s cooldown runs out, and keeps Dashing', async (cooldownS) => {
    let dashes = 0;
    for (const seed of ['ai-dash-cd-1', 'ai-dash-cd-2', 'ai-dash-cd-3']) {
      const session = await aiMatch(seed, cooldownS);
      const previous = { first: AttackState.Neutral, second: AttackState.Neutral };
      const cooldownBefore = { first: 0, second: 0 };
      const lastDashEndTick = { first: -Infinity, second: -Infinity };
      for (let i = 0; i < 3600 && !session.roundState.isOver; i++) {
        for (const side of ['first', 'second'] as const) cooldownBefore[side] = session.getBey(side).attack.getDashCooldownRemainingS();
        session.tick();
        for (const side of ['first', 'second'] as const) {
          const attack = session.getBey(side).attack;
          const state = attack.getState();
          if (state === AttackState.ChargingDash && previous[side] !== AttackState.ChargingDash) {
            // Charging only ever starts with the cooldown done (it may run out on this very tick).
            expect(cooldownBefore[side], `${seed} ${side} tick ${i}`).toBeLessThanOrEqual(1 / 60 + 1e-9);
            expect(i - lastDashEndTick[side], `${seed} ${side} tick ${i}`).toBeGreaterThanOrEqual(Math.floor(cooldownS * 60) - 1);
          }
          if (previous[side] === AttackState.DashActive && state !== AttackState.DashActive) {
            lastDashEndTick[side] = i;
            dashes++;
          }
          previous[side] = state;
        }
      }
      session.dispose();
    }
    // Far more than the old "two Dashes per full Attack Energy bar" pace allowed per side.
    expect(dashes).toBeGreaterThan(6);
  }, 120_000);
});
