// Owner, 2026-10-05: "implemente tudo exceto som e vibração" — counter burst + "COUNTER!", hit flash, hit shake during
// the impact freeze, ring-out warning, refused-press feedback. Presentation only: each part is checked to do what it
// says, and the match is checked to be the same with all of it on or off.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GameStateMachine } from '../../src/app/lifecycle/GameState';
import { MatchSession, type HudFeedbackEvent } from '../../src/app/session/MatchSession';
import { ringOutDanger } from '../../src/app/frontend/CombatHud';
import { ScriptedController, type ScriptedFrame } from '../../src/automation/scripted-scenarios/ScriptedController';
import { createDefaultAttackProfileSettings } from '../../src/config/attack-profile/AttackProfileSettings';
import { resolveMatchConfig } from '../../src/config/match/MatchConfig';
import { Action, type ControllerActions } from '../../src/input/actions/Action';
import { TelemetryRecorder } from '../../src/telemetry/recording/TelemetryRecorder';
import { COUNTER_BURST_S, HIT_FLASH_S, ImpactFeedback } from '../../src/vfx/ImpactFeedback';
import { arenaFloorRadius } from '../../src/arena/colliders/ArenaTuning';

const NONE: ControllerActions = { held: new Set(), pressedThisFrame: new Set(), attackHoldDurationSeconds: 0, jumpDriftHoldDurationSeconds: 0 };

async function session(playerFrames: ScriptedFrame[], opponentFrames: ControllerActions[], seed = 'feel'): Promise<MatchSession> {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  scene.add(camera);
  return MatchSession.create({
    scene,
    camera,
    seedText: seed,
    matchConfig: resolveMatchConfig({ arenaFloor: 'flat' }),
    attackProfileSettings: createDefaultAttackProfileSettings(),
    telemetry: new TelemetryRecorder(),
    stateMachine: new GameStateMachine(),
    controllers: { first: { kind: 'keyboard' }, second: { kind: 'replay', label: 'opponent', frames: opponentFrames } },
    keyboard: new ScriptedController(playerFrames),
  });
}

function models(): Record<'first' | 'second', { group: THREE.Object3D; radiusM: number }> {
  return { first: { group: new THREE.Group(), radiusM: 0.5 }, second: { group: new THREE.Group(), radiusM: 0.5 } };
}

describe('impact feedback (render only)', () => {
  it('hit flash: the struck Bey glows, then fades out within its time', () => {
    const fx = new ImpactFeedback(new THREE.Group(), { hitFlash: true, hitShake: true, counterFeedback: true });
    const m = models();
    fx.onHit('second');
    fx.update(1 / 60, false, m);
    expect(fx.isFlashing('second')).toBe(true);
    expect(fx.isFlashing('first')).toBe(false);
    fx.update(HIT_FLASH_S, false, m);
    expect(fx.isFlashing('second')).toBe(false);
  });

  it('hit shake: only the struck Bey\'s drawn model moves, only during the freeze', () => {
    const fx = new ImpactFeedback(new THREE.Group(), { hitFlash: true, hitShake: true, counterFeedback: true });
    const m = models();
    fx.onHit('first');
    let moved = 0;
    for (let i = 0; i < 6; i++) {
      m.first.group.position.set(0, 0, 0); // the session re-places the model on its body every frame
      m.second.group.position.set(0, 0, 0);
      fx.update(1 / 60, true, m);
      moved = Math.max(moved, m.first.group.position.length());
      expect(m.second.group.position.length()).toBe(0);
    }
    expect(moved).toBeGreaterThan(0.02);
    m.first.group.position.set(0, 0, 0);
    fx.update(1 / 60, false, m); // the freeze ended
    expect(m.first.group.position.length()).toBe(0);
  });

  it('counter burst: rings at the contact that grow and go; every part off = nothing at all', () => {
    const root = new THREE.Group();
    const fx = new ImpactFeedback(root, { hitFlash: true, hitShake: true, counterFeedback: true });
    fx.onCounter({ x: 1, y: 0.2, z: 2 });
    fx.update(0.1, false, models());
    expect(fx.counterRingCount).toBe(2);
    fx.update(COUNTER_BURST_S, false, models());
    expect(fx.counterRingCount).toBe(0);

    const off = new ImpactFeedback(new THREE.Group(), { hitFlash: false, hitShake: false, counterFeedback: false });
    const m = models();
    off.onHit('first');
    off.onCounter({ x: 0, y: 0, z: 0 });
    off.update(1 / 60, true, m);
    expect(off.isFlashing('first')).toBe(false);
    expect(off.counterRingCount).toBe(0);
    expect(m.first.group.position.length()).toBe(0);
  });
});

describe('ring-out warning', () => {
  const R = (): number => arenaFloorRadius();
  it('off in the middle, faint at the wall on the ground, strong flying out, full outside the line', () => {
    expect(ringOutDanger({ x: 0, z: 0 }, { x: 0, z: 0 }, true, false)).toBe(0);
    expect(ringOutDanger({ x: R() * 0.5, z: 0 }, { x: 20, z: 0 }, false, false)).toBe(0);
    const wall = ringOutDanger({ x: R() * 0.99, z: 0 }, { x: 0, z: 0 }, true, false);
    expect(wall).toBeGreaterThan(0.1);
    expect(wall).toBeLessThanOrEqual(0.25);
    expect(ringOutDanger({ x: R() * 0.9, z: 0 }, { x: 12, z: 0 }, false, false)).toBeGreaterThan(0.8);
    expect(ringOutDanger({ x: R() * 0.9, z: 0 }, { x: -12, z: 0 }, false, false), 'flying back in').toBeLessThan(0.1);
    expect(ringOutDanger({ x: R() * 1.1, z: 0 }, { x: 0, z: 0 }, false, true)).toBe(1);
  });
});

describe('refused presses and counter hits reach the HUD (real MatchSession)', () => {
  it('a Dodge pressed while the dodge recharges is reported refused; the dodge that starts is not', async () => {
    // Dodge on tick 30 (starts), again on tick 50 (still dodging / recharging: refused).
    const s = await session([{ fromTick: 0, held: [] }, { fromTick: 30, held: [Action.Dodge] }, { fromTick: 31, held: [] }, { fromTick: 50, held: [Action.Dodge] }, { fromTick: 51, held: [] }], Array.from({ length: 200 }, () => NONE));
    const seen: { tick: number; event: HudFeedbackEvent }[] = [];
    for (let t = 0; t < 70; t++) {
      s.tick();
      for (const event of s.drainHudFeedback()) seen.push({ tick: t, event });
    }
    expect(seen.map((e) => e.event)).toEqual([{ kind: 'refused', action: 'dodge' }]);
    expect(seen[0]!.tick).toBe(50);
    s.dispose();
  });

  it('a Circular catching a Dash is a counter beat for the HUD', async () => {
    // The opponent charges a short Dash at the player; the player taps the Circular as it arrives.
    const opponent = Array.from({ length: 200 }, (_, i) => (i >= 40 && i < 58 ? { ...NONE, held: new Set([Action.Attack]), pressedThisFrame: new Set(i === 40 ? [Action.Attack] : []) } : NONE));
    let counter = 0;
    for (let tap = 58; tap <= 74 && counter === 0; tap += 2) {
      const s = await session([{ fromTick: 0, held: [] }, { fromTick: tap, held: [Action.Attack] }, { fromTick: tap + 2, held: [] }], opponent, `feel-${tap}`);
      s.getBey('first').body.setTranslation({ x: 0, y: s.getBey('first').body.translation().y, z: 0 }, true);
      s.getBey('second').body.setTranslation({ x: 0, y: s.getBey('second').body.translation().y, z: -4 }, true);
      for (let t = 0; t < 140; t++) {
        s.tick();
        counter += s.drainHudFeedback().filter((e) => e.kind === 'counter').length;
      }
      s.dispose();
    }
    expect(counter).toBeGreaterThan(0);
  });
});

describe('presentation only', () => {
  it('the match is identical with every game-feel switch on or off', async () => {
    const opponent = Array.from({ length: 400 }, (_, i) => (i >= 40 && i < 60 ? { ...NONE, held: new Set([Action.Attack]), pressedThisFrame: new Set(i === 40 ? [Action.Attack] : []) } : NONE));
    const player: ScriptedFrame[] = [{ fromTick: 0, held: [Action.MoveForward] }, { fromTick: 50, held: [Action.Dodge] }, { fromTick: 51, held: [Action.Attack] }, { fromTick: 53, held: [] }];
    const hashes = async (on: boolean): Promise<string[]> => {
      const s = await session(player, opponent);
      s.setGameFeel({ hitFlash: on, hitShake: on, counterFeedback: on });
      const camera = new THREE.PerspectiveCamera();
      const out: string[] = [];
      for (let t = 0; t < 300; t++) {
        s.tick();
        s.renderFrame(1 / 60, camera);
        s.drainHudFeedback();
        out.push(s.getStateHash());
      }
      s.dispose();
      return out;
    };
    expect(await hashes(true)).toEqual(await hashes(false));
  });
});
