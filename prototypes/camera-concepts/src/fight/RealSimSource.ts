// ============================================================
// CAMERA LAB — REAL SIMULATION SOURCE
// Runs the game's own fight: Rapier physics, createBey, and the exact
// tickMatch() orchestration main.ts and the deterministic test harness
// use, driven by the same CombatController interface (ScriptedController
// for authored scenarios, the real AIController for duels). Nothing here
// changes gameplay: it only READS the game's modules and describes each
// tick as a FightFrame for the camera.
//
// Two deliberate differences from main.ts, both presentation-only:
//   1. No hitstop. In the game, hitstop length comes from the camera
//      tuning; here A, B and C must watch the exact same fight, so the
//      simulation never pauses for a camera reason.
//   2. After the round ends (KO / ring-out) the game freezes the whole
//      simulation. The lab keeps stepping raw physics (no controllers, no
//      rules) so the Ring-Out and Finisher cameras have a trajectory to
//      follow. Marked "continuação de apresentação" in the HUD.
// ============================================================

import * as THREE from 'three';
import { AIController } from '../../../../src/ai/controllers/AIController';
import { DEFAULT_AI_DIFFICULTY_PROFILE } from '../../../../src/ai/difficulty/AiDifficultyProfile';
import { personalityForBeyDefinitionId } from '../../../../src/ai/personalities/AiArchetypePersonalities';
import { ClashOrchestration } from '../../../../src/app/simulation/ClashOrchestration';
import { tickMatch, type BeySnapshot, type MatchTickResult } from '../../../../src/app/simulation/tickMatch';
import { createArenaColliders } from '../../../../src/arena/colliders/createArenaColliders';
import { ATTACK_ARCHETYPE, DEFENSE_ARCHETYPE } from '../../../../src/bey/archetype/BeyArchetypes';
import { createBey, type Bey } from '../../../../src/bey/core/Bey';
import { BEY_SPAWN_HEIGHT_M } from '../../../../src/bey/core/BeyTuning';
import type { BeyVisual } from '../../../../src/bey/procedural-model/createBeyMesh';
import { buildImpactEventsForTick } from '../../../../src/app/simulation/impact/ImpactEvents';
import { CLASH_RESOLVED_MAGNITUDE } from '../../../../src/app/simulation/impact/ImpactMagnitude';
import { AttackState } from '../../../../src/combat/attacks/AttackController';
import { ClashOutcome, ClashState } from '../../../../src/combat/clash/ClashController';
import { NullAiMashSource } from '../../../../src/combat/clash/ClashMash';
import { CLASH_TARGET_DURATION_S } from '../../../../src/combat/clash/ClashTuning';
import { RoundState } from '../../../../src/combat/round-rules/RoundState';
import { resolveMatchConfig } from '../../../../src/config/match/MatchConfig';
import { ScriptedController, type ScriptedFrame } from '../../../../src/automation/scripted-scenarios/ScriptedController';
import { IdleController } from '../../../../src/automation/scripted-scenarios/IdleController';
import type { Action, CombatController } from '../../../../src/input/actions/Action';
import { FIXED_DELTA_SECONDS } from '../../../../src/physics/fixed-step/FixedTimestepLoop';
import { PhysicsWorld } from '../../../../src/physics/world/PhysicsWorld';
import { createRngStreams } from '../../../../src/rng/SeededRng';
import type { CameraIntent, FighterAttack, FighterFrame, FightFrame, FightSource, Vec3 } from './FightFrame';
import type { ControlSpec, Scenario } from './scenarios';

const TICK_RATE = 1 / FIXED_DELTA_SECONDS;
/** After the round ends, raw physics keeps running this long so the Ring-Out/Finisher cameras have a trajectory; then everything holds still (outside the arena there is no floor). */
const PRESENTATION_CONTINUATION_S = 2.5;

function attackOf(state: AttackState): FighterAttack {
  switch (state) {
    case AttackState.ChargingDash:
      return 'charging';
    case AttackState.DashActive:
      return 'dash';
    case AttackState.CircularActive:
      return 'circular';
    case AttackState.DashRecovery:
    case AttackState.CircularRecovery:
      return 'recovery';
    default:
      return 'none';
  }
}

/** Turn a "held actions as a function of time" script into the ScriptedController's frame list. */
export function framesFromScript(held: (t: number) => readonly Action[], durationS: number): ScriptedFrame[] {
  const frames: ScriptedFrame[] = [];
  let lastKey = '';
  const ticks = Math.ceil(durationS * TICK_RATE) + 1;
  for (let tick = 0; tick < ticks; tick++) {
    const set = [...held(tick / TICK_RATE)].sort();
    const key = set.join('|');
    if (key !== lastKey || tick === 0) {
      frames.push({ fromTick: tick, held: set as Action[] });
      lastKey = key;
    }
  }
  return frames;
}

/** Keeps the game's visual spin/wobble convention (see createMatchScene.ts), read-only. */
function syncVisual(bey: Bey, visual: BeyVisual, snapshot: BeySnapshot | null, tmp: { tilt: THREE.Quaternion; wobble: THREE.Quaternion; axis: THREE.Vector3 }): void {
  const t = bey.body.translation();
  const r = bey.body.rotation();
  visual.group.position.set(t.x, t.y, t.z);
  tmp.tilt.set(r.x, r.y, r.z, r.w);
  tmp.wobble.setFromAxisAngle(tmp.axis, snapshot?.spin.wobbleOffsetRad ?? 0);
  visual.group.quaternion.copy(tmp.tilt).multiply(tmp.wobble);
  visual.spinGroup.rotation.y = snapshot?.spin.visualSpinAngleRad ?? 0;
}

export class RealSimSource implements FightSource {
  readonly label: string;
  readonly temporary = false;
  /** Arena + both Beys, using the game's own current (placeholder) visuals. */
  readonly visuals = new THREE.Group();
  private tickIndex = 0;
  private roundOverAt = -1;
  private ringOutIsFirst: boolean | null = null;
  private lastResult: MatchTickResult | null = null;
  private wasClashActive = false;
  readonly firstVisual: BeyVisual;
  readonly secondVisual: BeyVisual;
  private readonly tmp = { tilt: new THREE.Quaternion(), wobble: new THREE.Quaternion(), axis: new THREE.Vector3(1, 0, 0) };
  private current: FightFrame;

  private constructor(
    readonly scenario: Scenario,
    private readonly physics: PhysicsWorld,
    readonly first: Bey,
    readonly second: Bey,
    private readonly firstController: CombatController,
    private readonly secondController: CombatController,
    private readonly roundState: RoundState,
    private readonly clash: ClashOrchestration,
    arenaScene: THREE.Scene,
  ) {
    this.label = scenario.label;
    // The arena builder adds its meshes AND the game's lights to the scene it is given; keep all of them.
    for (const child of [...arenaScene.children]) this.visuals.add(child);
    this.firstVisual = first.definition.appearance.createVisual();
    this.secondVisual = second.definition.appearance.createVisual();
    this.visuals.add(this.firstVisual.group, this.secondVisual.group);
    this.current = this.describe([], null);
    this.syncVisuals();
  }

  static async create(scenario: Scenario): Promise<RealSimSource> {
    const physics = await PhysicsWorld.create();
    const holder = new THREE.Scene();
    createArenaColliders(holder, physics);
    const first = createBey(physics, { x: scenario.firstSpawn.x, y: BEY_SPAWN_HEIGHT_M, z: scenario.firstSpawn.z }, ATTACK_ARCHETYPE);
    const second = createBey(physics, { x: scenario.secondSpawn.x, y: BEY_SPAWN_HEIGHT_M, z: scenario.secondSpawn.z }, DEFENSE_ARCHETYPE);
    const secondIsAi = scenario.second.kind === 'ai';
    const clash = secondIsAi ? new ClashOrchestration(resolveMatchConfig(), new NullAiMashSource()) : new ClashOrchestration(resolveMatchConfig());
    const control = (spec: ControlSpec, own: Bey, opponent: Bey): CombatController => {
      if (spec.kind === 'script') return new ScriptedController(framesFromScript(spec.held, scenario.durationS));
      if (spec.kind === 'ai') {
        // Each AI spec has its own seed here, so one stream per spec is
        // already independent; aiFirst keeps the pre-M9 `ai` salt, so the
        // approved lab's fights are unchanged.
        const rng = createRngStreams(spec.seed).aiFirst;
        return new AIController(physics, own, opponent, clash.controller, personalityForBeyDefinitionId(own.definition.id), DEFAULT_AI_DIFFICULTY_PROFILE, rng, null);
      }
      return new IdleController();
    };
    scenario.setup?.({ first, second });
    return new RealSimSource(scenario, physics, first, second, control(scenario.first, first, second), control(scenario.second, second, first), new RoundState(), clash, holder);
  }

  get frame(): FightFrame {
    return this.current;
  }

  get finished(): boolean {
    return this.tickIndex / TICK_RATE >= this.scenario.durationS;
  }

  step(): FightFrame {
    const ctx = { fixedDeltaSeconds: FIXED_DELTA_SECONDS };
    const intents: CameraIntent[] = [];
    let result: MatchTickResult | null = null;
    if (!this.roundState.isOver) {
      const a = this.firstController.sampleActions(ctx);
      const b = this.secondController.sampleActions(ctx);
      result = tickMatch(this.physics, this.first, this.second, a, b, FIXED_DELTA_SECONDS, this.roundState, this.clash);
      this.lastResult = result;
      const p1 = this.first.body.translation();
      const p2 = this.second.body.translation();
      for (const e of buildImpactEventsForTick(result, p1, p2)) {
        intents.push({ kind: e.kind, magnitude: e.magnitude, targetIsFirst: e.isFirst, position: { ...e.worldPositionM } });
      }
      const clashActive = this.clash.controller.getState() === ClashState.Active;
      const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2, z: (p1.z + p2.z) / 2 };
      if (clashActive && !this.wasClashActive) intents.push({ kind: 'clashStart', magnitude: 0.6, targetIsFirst: null, position: mid });
      if (result.clashResolvedThisTick) {
        const outcome = result.clashResolvedThisTick.outcome;
        const loserIsFirst = outcome === ClashOutcome.FirstWins ? false : outcome === ClashOutcome.SecondWins ? true : null;
        intents.push({ kind: 'clashResolved', magnitude: CLASH_RESOLVED_MAGNITUDE, targetIsFirst: loserIsFirst, position: mid });
      }
      this.wasClashActive = clashActive;
      if (result.ringOutFirst) this.ringOutIsFirst = true;
      else if (result.ringOutSecond) this.ringOutIsFirst = false;
      if (this.roundState.isOver) this.roundOverAt = this.tickIndex;
    } else if (this.roundOverSeconds < PRESENTATION_CONTINUATION_S) {
      // Presentation continuation (lab only): keep the bodies flying for a moment after the round ends.
      this.physics.step();
    }
    this.tickIndex++;
    this.current = this.describe(intents, result);
    return this.current;
  }

  private describe(intents: CameraIntent[], result: MatchTickResult | null): FightFrame {
    const snap = result ?? this.lastResult;
    return {
      tick: this.tickIndex,
      time: this.tickIndex / TICK_RATE,
      first: this.fighter(this.first, snap?.first ?? null),
      second: this.fighter(this.second, snap?.second ?? null),
      intents,
      clashActive: this.clash.controller.getState() === ClashState.Active && !this.roundState.isOver,
      clashProgress: Math.min(1, this.clash.controller.getElapsedS() / CLASH_TARGET_DURATION_S),
      roundOver: this.roundState.isOver,
      ringOutIsFirst: this.ringOutIsFirst,
    };
  }

  private fighter(bey: Bey, snapshot: BeySnapshot | null): FighterFrame {
    const t = bey.body.translation();
    const v = bey.body.linvel();
    const position: Vec3 = { x: t.x, y: t.y, z: t.z };
    const velocity: Vec3 = { x: v.x, y: v.y, z: v.z };
    return {
      position,
      velocity,
      speed: Math.hypot(v.x, v.z),
      airborne: snapshot ? !snapshot.grounded : false,
      attack: snapshot ? attackOf(snapshot.attackState) : 'none',
      broken: snapshot?.isBroken ?? false,
    };
  }

  /** Seconds since the round ended, or -1. */
  get roundOverSeconds(): number {
    return this.roundOverAt < 0 ? -1 : (this.tickIndex - this.roundOverAt) / TICK_RATE;
  }

  syncVisuals(): void {
    const snap = this.lastResult;
    syncVisual(this.first, this.firstVisual, snap?.first ?? null, this.tmp);
    syncVisual(this.second, this.secondVisual, snap?.second ?? null, this.tmp);
  }

  dispose(): void {
    this.visuals.removeFromParent();
    this.visuals.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m: THREE.Material) => m.dispose());
      }
    });
    this.physics.rapierWorld.free();
  }
}
