// ============================================================
// MATCH SESSION — ONE LIVE, RENDERED MATCH
// The per-tick pipeline that used to live inline in main.ts, moved here
// unchanged so the normal game and the Debug Lab (GDD sections 69-70, 144)
// run the exact same match code: tickMatch(), hitstop freeze, Clash
// presentation edges, telemetry, camera and VFX. A session owns one
// physics world and one scene subtree, so the Debug Lab can throw it away
// and build a fresh one for "restart same seed / new seed".
//
// The session never reads wall-clock time for simulation: it advances
// exactly one fixed tick per tick() call (GDD section 80). Whoever drives
// it (FixedTimestepLoop, a pause/step button, stepManyTicks for
// acceleration — GDD section 164) decides how many ticks run.
// ============================================================

import * as THREE from 'three';
import { createMatchScene, type MatchScene } from '../bootstrap/createMatchScene';
import { GameState, type GameStateMachine } from '../lifecycle/GameState';
import { tickMatch, type MatchTickResult } from '../simulation/tickMatch';
import { ClashOrchestration } from '../simulation/ClashOrchestration';
import { ClashPresentationTracker } from '../simulation/ClashPresentationTracker';
import { RoundState } from '../../combat/round-rules/RoundState';
import { ClashOutcome, ClashState } from '../../combat/clash/ClashController';
import { NullAiMashSource } from '../../combat/clash/ClashMash';
import { CLASH_PROGRESSIVE_VFX_INTERVAL_TICKS, CLASH_TARGET_DURATION_S } from '../../combat/clash/ClashTuning';
import { CombatCameraController, type CombatCameraOutput } from '../../camera/CombatCameraController';
import { ClashCameraDirector } from '../../camera/ClashCameraDirector';
import { buildImpactEventsForTick, type ImpactEvent, type WorldPositionM } from '../../camera/ImpactEvents';
import { CLASH_RESOLVED_MAGNITUDE } from '../../camera/ImpactMagnitude';
import { CAMERA_FOV_BASE_DEG } from '../../camera/CameraTuning';
import type { MatchConfig } from '../../config/match/MatchConfig';
import type { BeyAttackProfileSettings } from '../../config/attack-profile/AttackProfileSettings';
import type { Bey } from '../../bey/core/Bey';
import type { KnockbackComponents } from '../../combat/knockback/Knockback';
import type { CombatController, ControllerActions } from '../../input/actions/Action';
import { FIXED_DELTA_SECONDS } from '../../physics/fixed-step/FixedTimestepLoop';
import { checkAngularVelocity, checkLinearVelocity } from '../../physics/diagnostics/physicsSafety';
import { PhysicsWorld } from '../../physics/world/PhysicsWorld';
import { createRngStreams, type RngStreams } from '../../rng/SeededRng';
import { TelemetryEventKind } from '../../telemetry/events/TelemetryEvent';
import type { TelemetryRecorder } from '../../telemetry/recording/TelemetryRecorder';
import { VfxManager } from '../../vfx/VfxManager';
import { ForcedInputController } from '../../automation/scripted-scenarios/ForcedInputController';
import type { ScriptedFrame } from '../../automation/scripted-scenarios/ScriptedController';
import { createSideController, describeControllerSpec, type SideControllerSpec, type SideControllerDeps } from './SideControllers';

export type Side = 'first' | 'second';

export interface MatchSessionOptions {
  /** Parent for everything this session draws; the session adds and later removes its own subtree. */
  readonly scene: THREE.Scene;
  /** The render camera — VFX speed lines attach to it, and the camera directors drive it. */
  readonly camera: THREE.PerspectiveCamera;
  readonly seedText: string;
  readonly matchConfig: MatchConfig;
  readonly attackProfileSettings: BeyAttackProfileSettings;
  readonly telemetry: TelemetryRecorder;
  readonly stateMachine: GameStateMachine;
  readonly controllers: { readonly first: SideControllerSpec; readonly second: SideControllerSpec };
  /** Shared, already-attached keyboard device; only used by a side whose spec is `keyboard`. */
  readonly keyboard: CombatController;
}

export interface SessionTickOutput {
  readonly tickIndex: number;
  readonly firstActions: ControllerActions;
  readonly secondActions: ControllerActions;
  readonly result: MatchTickResult;
  /** False when hitstop froze gameplay this tick (result is the previous tick's, reused). */
  readonly simulationAdvanced: boolean;
}

/** Per-side knockback/impulse facts from the most recent advancing tick, for inspection and force visualization. */
export interface SideTickImpulses {
  knockbackForce: number;
  stabilityDamage: number;
  impactDeltaSpeedMps: number;
}

/** The most recent knockback this side received (kept across ticks until the next one). */
export interface LastKnockback {
  readonly tickIndex: number;
  readonly force: number;
  readonly components: KnockbackComponents | null;
  readonly directionXZ: { x: number; z: number } | null;
}

/** How renderFrame() presents the match. Render-only: never changes what a tick computes. */
export interface SessionRenderView {
  /** `game` = the combat camera directors; `overview` = a fixed high debug view of the whole arena. */
  readonly cameraView: 'game' | 'overview';
  /** Shake plus speed/impact FOV changes. */
  readonly cameraEffects: boolean;
}

const DEFAULT_RENDER_VIEW: SessionRenderView = { cameraView: 'game', cameraEffects: true };
/** Debug overview camera: high over the arena's near edge, whole bowl in frame. */
const OVERVIEW_CAMERA_POSITION_M = { x: 0, y: 30, z: 20 } as const;
const OVERVIEW_CAMERA_FOV_DEG = 55;

export class MatchSession {
  readonly matchId: string;
  readonly seedText: string;
  readonly rngStreams: RngStreams;
  readonly physics: PhysicsWorld;
  readonly match: MatchScene;
  readonly roundState = new RoundState();
  readonly clash: ClashOrchestration;
  readonly matchConfig: MatchConfig;
  readonly telemetry: TelemetryRecorder;

  private readonly root = new THREE.Group();
  private readonly vfxManager: VfxManager;
  private readonly cameraDirector = new CombatCameraController();
  private readonly clashCameraDirector = new ClashCameraDirector();
  private readonly clashPresentationTracker = new ClashPresentationTracker();
  private readonly stateMachine: GameStateMachine;
  private readonly keyboard: CombatController;

  private readonly controllerSpecs: Record<Side, SideControllerSpec>;
  /** Each side's driver, wrapped so the Debug Lab can force short input bursts. */
  private readonly drivers: Record<Side, ForcedInputController>;
  private readonly debugMutations: { tickIndex: number; description: string }[] = [];

  private tickIndex = 0;
  private lastMatchResult: MatchTickResult | null = null;
  private lastCameraOutput: CombatCameraOutput | null = null;
  private lastPhysicsStepTimeMs = 0;
  private lastImpulses: Record<Side, SideTickImpulses> = { first: emptyImpulses(), second: emptyImpulses() };
  private lastKnockback: Record<Side, LastKnockback | null> = { first: null, second: null };
  private lastActions: Record<Side, ControllerActions | null> = { first: null, second: null };
  private lastVelocity: Record<Side, { x: number; y: number; z: number }>;
  private lastAcceleration: Record<Side, { x: number; y: number; z: number }> = { first: zero3(), second: zero3() };
  private lastVisual: Record<Side, { spin: number; wobble: number }> = { first: { spin: 0, wobble: 0 }, second: { spin: 0, wobble: 0 } };
  private disposed = false;

  private constructor(options: MatchSessionOptions, physics: PhysicsWorld) {
    this.matchId = createMatchId();
    this.seedText = options.seedText;
    this.rngStreams = createRngStreams(options.seedText);
    this.physics = physics;
    this.matchConfig = options.matchConfig;
    this.telemetry = options.telemetry;
    this.stateMachine = options.stateMachine;
    this.keyboard = options.keyboard;

    // The Clash placeholder AI mash source stays disabled: a real
    // AIController mashes with its own Z/X/C presses (see ClashMash.ts's
    // NullAiMashSource doc), and a keyboard/idle side mashes by itself.
    this.clash = new ClashOrchestration(options.matchConfig, new NullAiMashSource());

    options.scene.add(this.root);
    this.match = createMatchScene(this.root, physics, options.attackProfileSettings);
    this.vfxManager = new VfxManager(this.root, options.camera, this.match.first.definition.particle, this.match.second.definition.particle);

    this.lastVelocity = { first: copy3(this.match.first.body.linvel()), second: copy3(this.match.second.body.linvel()) };

    this.controllerSpecs = { first: options.controllers.first, second: options.controllers.second };
    this.drivers = {
      first: new ForcedInputController(createSideController(options.controllers.first, this.controllerDeps('first'))),
      second: new ForcedInputController(createSideController(options.controllers.second, this.controllerDeps('second'))),
    };
  }

  static async create(options: MatchSessionOptions): Promise<MatchSession> {
    const physics = await PhysicsWorld.create();
    return new MatchSession(options, physics);
  }

  getTickIndex(): number {
    return this.tickIndex;
  }

  getBey(side: Side): Bey {
    return side === 'first' ? this.match.first : this.match.second;
  }

  getLastResult(): MatchTickResult | null {
    return this.lastMatchResult;
  }

  getLastCameraOutput(): CombatCameraOutput | null {
    return this.lastCameraOutput;
  }

  getLastPhysicsStepTimeMs(): number {
    return this.lastPhysicsStepTimeMs;
  }

  getLastImpulses(side: Side): SideTickImpulses {
    return this.lastImpulses[side];
  }

  getLastKnockback(side: Side): LastKnockback | null {
    return this.lastKnockback[side];
  }

  /** What this side's controller sampled on the most recent tick (null before the first tick). */
  getLastActions(side: Side): ControllerActions | null {
    return this.lastActions[side];
  }

  /** Finite-difference acceleration over the last advancing tick (m/s²). */
  getLastAcceleration(side: Side): { x: number; y: number; z: number } {
    return this.lastAcceleration[side];
  }

  /** The controller the side was given (keyboard / AI / idle / script) — never the forced-input wrapper. */
  getController(side: Side): CombatController {
    return this.drivers[side].getInner();
  }

  isForcingInput(side: Side): boolean {
    return this.drivers[side].isForcing();
  }

  /**
   * Debug Lab "force attack state" (GDD section 70): overrides this side's
   * input with `frames` for `durationTicks`, through the real systems.
   * Logged as a debug mutation.
   */
  forceInput(side: Side, label: string, frames: readonly ScriptedFrame[], durationTicks: number): void {
    this.drivers[side].force(frames, durationTicks);
    this.recordDebugMutation(`${side}: forced input "${label}" for ${durationTicks} ticks`);
  }

  /**
   * Records an explicit Debug Lab mutation (GDD section 160: mutation tools
   * are explicit actions). From the first one on, the run is no longer a
   * pure replay of its seed; reports say so.
   */
  recordDebugMutation(description: string): void {
    this.debugMutations.push({ tickIndex: this.tickIndex, description });
    this.telemetry.setCurrentTick(this.tickIndex);
    this.telemetry.record({ kind: TelemetryEventKind.DebugMutation, description });
  }

  getDebugMutations(): readonly { tickIndex: number; description: string }[] {
    return this.debugMutations;
  }

  getControllerSpec(side: Side): SideControllerSpec {
    return this.controllerSpecs[side];
  }

  describeController(side: Side): string {
    return describeControllerSpec(this.controllerSpecs[side]);
  }

  /** Swaps who drives one side (GDD section 70: toggle AI / automated controller, change AI profile). Takes effect on the next tick. */
  setController(side: Side, spec: SideControllerSpec): void {
    this.controllerSpecs[side] = spec;
    this.drivers[side].setInner(createSideController(spec, this.controllerDeps(side)));
  }

  /** Advances the match by exactly one fixed tick. */
  tick(): SessionTickOutput {
    if (this.disposed) throw new Error('MatchSession.tick(): session already disposed.');
    const tickIndex = this.tickIndex;
    const fixedDeltaSeconds = FIXED_DELTA_SECONDS;
    const telemetry = this.telemetry;
    const match = this.match;
    const clash = this.clash;
    const roundState = this.roundState;
    telemetry.setCurrentTick(tickIndex);

    // Hitstop (Milestone 4): a strong-enough impact freezes gameplay
    // simulation itself for a brief, magnitude-scaled window — tickMatch()
    // doesn't run, so physics/resources/round state don't advance.
    // Computed before sampling so both controllers know this tick is
    // frozen: a gameplay press made during the freeze is buffered (not
    // lost) and delivered exactly once on the first unfrozen sample
    // afterward, and hold-duration/charge clocks don't advance while
    // frozen — see ActionSampleBuffer. Camera/VFX timers below still tick
    // regardless, so the freeze actually ends.
    const isFrozenByHitstop = this.lastCameraOutput?.isHitstopActive ?? false;

    const firstActions = this.drivers.first.sampleActions({ fixedDeltaSeconds, simulationFrozen: isFrozenByHitstop });
    const secondActions = this.drivers.second.sampleActions({ fixedDeltaSeconds, simulationFrozen: isFrozenByHitstop });
    this.lastActions = { first: firstActions, second: secondActions };

    let result: MatchTickResult;
    if (isFrozenByHitstop && this.lastMatchResult) {
      result = this.lastMatchResult;
    } else {
      const stepStart = performance.now();
      result = tickMatch(this.physics, match.first, match.second, firstActions, secondActions, fixedDeltaSeconds, roundState, clash);
      this.lastPhysicsStepTimeMs = performance.now() - stepStart;
      this.lastMatchResult = result;
      this.recordTickDerivedState(tickIndex, result, fixedDeltaSeconds);

      for (const hit of result.hitEvents) {
        telemetry.record({
          kind: TelemetryEventKind.Hit,
          attackerIsFirst: hit.attackerIsFirst,
          hitboxKind: hit.hitbox.kind,
          caughtOpponentDashing: hit.caughtOpponentDashing,
        });
      }
      for (const combatEvent of result.combatEvents) {
        switch (combatEvent.kind) {
          case 'stabilityDamage':
            telemetry.record({ kind: TelemetryEventKind.StabilityDamage, targetIsFirst: combatEvent.targetIsFirst, amount: combatEvent.amount });
            break;
          case 'stabilityBreak':
            telemetry.record({ kind: TelemetryEventKind.StabilityBreak, targetIsFirst: combatEvent.targetIsFirst });
            break;
          case 'knockback':
            telemetry.record({ kind: TelemetryEventKind.Knockback, targetIsFirst: combatEvent.targetIsFirst, force: combatEvent.force });
            break;
          case 'ko':
            telemetry.record({ kind: TelemetryEventKind.Ko, targetIsFirst: combatEvent.targetIsFirst });
            break;
          case 'ringOut':
            telemetry.record({ kind: TelemetryEventKind.RingOut, targetIsFirst: combatEvent.targetIsFirst });
            break;
          case 'dodged':
            telemetry.record({ kind: TelemetryEventKind.Dodged, targetIsFirst: combatEvent.targetIsFirst });
            break;
          case 'perfectDodge':
            telemetry.record({ kind: TelemetryEventKind.PerfectDodge, targetIsFirst: combatEvent.targetIsFirst });
            break;
        }
      }
      // A genuine unmodeled physics impact (wall/floor bounce) — distinct
      // from a combat Hit/Knockback event above, which already carries its
      // own force field rather than borrowing this one.
      if (result.first.movement.impactDeltaSpeedMps > 0 || result.second.movement.impactDeltaSpeedMps > 0) {
        const speedDelta = Math.max(result.first.movement.impactDeltaSpeedMps, result.second.movement.impactDeltaSpeedMps);
        telemetry.record({ kind: TelemetryEventKind.MovementImpact, speedDeltaMps: speedDelta });
      }

      for (const [bey, snapshot] of [
        [match.first, result.first],
        [match.second, result.second],
      ] as const) {
        const linvel = bey.body.linvel();
        const linearAnomaly = checkLinearVelocity(linvel.x, linvel.y, linvel.z);
        if (linearAnomaly) {
          telemetry.record({ kind: TelemetryEventKind.PhysicsAnomaly, anomalyKind: linearAnomaly.kind, detail: linearAnomaly.detail });
        }
        const angularAnomaly = checkAngularVelocity(snapshot.spin.angularVelocity.x, snapshot.spin.angularVelocity.y, snapshot.spin.angularVelocity.z);
        if (angularAnomaly) {
          telemetry.record({ kind: TelemetryEventKind.PhysicsAnomaly, anomalyKind: angularAnomaly.kind, detail: angularAnomaly.detail });
        }
      }

      if (roundState.isOver && this.stateMachine.getCurrentState() !== GameState.RoundEnd) {
        telemetry.record({ kind: TelemetryEventKind.RoundEnd, outcome: roundState.result });
        this.stateMachine.transitionTo(GameState.RoundEnd);
      }
    }

    // Clash (Milestone 5) state-edge telemetry + GameState transitions —
    // ClashPresentationTracker owns the edge detection itself; safe to
    // call every tick, including a hitstop-frozen one where nothing
    // changed. clashResolvedThisTick must NOT be read directly off a
    // reused, hitstop-frozen `result` — that's the exact same cached
    // object the resolution tick itself returned, so it would otherwise
    // still read non-null on every later frozen tick, re-triggering the
    // resolution beat (and thus hitstop) forever.
    const currentClashState = clash.controller.getState();
    const clashResolvedThisTick = isFrozenByHitstop ? null : result.clashResolvedThisTick;
    const presentationEvents = this.clashPresentationTracker.update(
      currentClashState,
      clashResolvedThisTick,
      clash.controller.getFirstMashEventCount(),
      clash.controller.getSecondMashEventCount(),
    );

    if (presentationEvents.clashStarted) {
      telemetry.record({
        kind: TelemetryEventKind.ClashStart,
        firstStaminaFraction: result.first.staminaFraction,
        secondStaminaFraction: result.second.staminaFraction,
        firstSpeedMps: result.first.movement.speedMps,
        secondSpeedMps: result.second.movement.speedMps,
      });
      this.stateMachine.transitionTo(GameState.Clash);
      this.clashCameraDirector.reset();
    }
    if (presentationEvents.clashResult) {
      const clashResult = presentationEvents.clashResult;
      telemetry.record({
        kind: TelemetryEventKind.ClashResult,
        outcome: clashResult.outcome,
        firstClashPower: clashResult.firstClashPower,
        secondClashPower: clashResult.secondClashPower,
        firstMashEventCount: clashResult.firstMashEventCount,
        secondMashEventCount: clashResult.secondMashEventCount,
      });
    }
    if (presentationEvents.clashEnded) {
      // Resolution -> knockback -> normal game state resumes immediately.
      // GameState.Clash covers only the Active presentation; the Cooldown
      // that follows is an internal restriction, not a presentation state.
      telemetry.record({ kind: TelemetryEventKind.ClashEnd });
      // The round may have ended this same tick via the resolution's own
      // KO — don't clobber that with Combat.
      if (this.stateMachine.getCurrentState() === GameState.Clash) this.stateMachine.transitionTo(GameState.Combat);
    }
    for (const mashEvent of presentationEvents.mashInputEvents) {
      telemetry.record({ kind: TelemetryEventKind.ClashMashInput, isFirst: mashEvent.isFirst, mashEventCount: mashEvent.mashEventCount });
    }

    this.lastVisual = {
      first: { spin: result.first.spin.visualSpinAngleRad, wobble: result.first.spin.wobbleOffsetRad },
      second: { spin: result.second.spin.visualSpinAngleRad, wobble: result.second.spin.wobbleOffsetRad },
    };

    this.tickCameraAndVfx(tickIndex, result, isFrozenByHitstop, clashResolvedThisTick, currentClashState);

    this.tickIndex++;
    return { tickIndex, firstActions, secondActions, result, simulationAdvanced: !isFrozenByHitstop };
  }

  /** Syncs visuals, camera and frame-rate VFX to the current state. Call once per rendered frame, before renderer.render(). */
  renderFrame(frameDeltaSeconds: number, camera: THREE.PerspectiveCamera, view: SessionRenderView = DEFAULT_RENDER_VIEW): void {
    const match = this.match;
    match.syncVisualsToPhysics(this.lastVisual.first.spin, this.lastVisual.first.wobble, this.lastVisual.second.spin, this.lastVisual.second.wobble);

    const cameraOutput = this.lastCameraOutput;
    if (view.cameraView === 'overview') {
      camera.position.set(OVERVIEW_CAMERA_POSITION_M.x, OVERVIEW_CAMERA_POSITION_M.y, OVERVIEW_CAMERA_POSITION_M.z);
      camera.lookAt(0, 0, 0);
      camera.fov = OVERVIEW_CAMERA_FOV_DEG;
      camera.updateProjectionMatrix();
    } else if (cameraOutput) {
      // Camera effects off (Debug Lab, GDD section 70): no shake and the
      // base FOV, so the director's framing can be judged on its own.
      const shake = view.cameraEffects ? cameraOutput.shakeOffsetM : { x: 0, y: 0, z: 0 };
      camera.position.set(cameraOutput.cameraPositionM.x + shake.x, cameraOutput.cameraPositionM.y + shake.y, cameraOutput.cameraPositionM.z + shake.z);
      camera.lookAt(cameraOutput.focusPositionM.x, cameraOutput.focusPositionM.y, cameraOutput.focusPositionM.z);
      camera.fov = view.cameraEffects ? cameraOutput.fovDeg : CAMERA_FOV_BASE_DEG;
      camera.updateProjectionMatrix();
    }

    this.vfxManager.onRenderFrame(
      frameDeltaSeconds,
      match.first.body.translation(),
      this.lastMatchResult?.first.movement.speedMps ?? 0,
      match.second.body.translation(),
      this.lastMatchResult?.second.movement.speedMps ?? 0,
      cameraOutput?.speedLinesScreenDirection ?? { x: 0, y: 0 },
    );
  }

  /** Scene subtree owned by this session — debug visualization layers attach here so they go away with it. */
  getSceneRoot(): THREE.Object3D {
    return this.root;
  }

  getVfxManager(): VfxManager {
    return this.vfxManager;
  }

  /** Frees the physics world and removes/disposes everything this session drew. The session is unusable afterwards. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.vfxManager.dispose();
    this.root.removeFromParent();
    this.root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      mesh.geometry?.dispose();
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else material?.dispose();
    });
    this.physics.rapierWorld.free();
  }

  private controllerDeps(side: Side): SideControllerDeps {
    const own = this.getBey(side);
    const opponent = this.getBey(side === 'first' ? 'second' : 'first');
    return {
      physics: this.physics,
      ownBey: own,
      opponentBey: opponent,
      clashController: this.clash.controller,
      aiRng: this.rngStreams.ai,
      telemetry: this.telemetry,
      keyboard: this.keyboard,
    };
  }

  private recordTickDerivedState(tickIndex: number, result: MatchTickResult, fixedDeltaSeconds: number): void {
    const impulses: Record<Side, SideTickImpulses> = { first: emptyImpulses(), second: emptyImpulses() };
    for (const event of result.combatEvents) {
      const side: Side = event.targetIsFirst ? 'first' : 'second';
      if (event.kind === 'knockback') {
        impulses[side].knockbackForce += event.force;
        this.lastKnockback[side] = {
          tickIndex,
          force: event.force,
          components: event.components ?? null,
          directionXZ: event.directionXZ ?? null,
        };
      }
      if (event.kind === 'stabilityDamage') impulses[side].stabilityDamage += event.amount;
    }
    impulses.first.impactDeltaSpeedMps = result.first.movement.impactDeltaSpeedMps;
    impulses.second.impactDeltaSpeedMps = result.second.movement.impactDeltaSpeedMps;
    this.lastImpulses = impulses;

    for (const side of ['first', 'second'] as const) {
      const v = copy3(this.getBey(side).body.linvel());
      const prev = this.lastVelocity[side];
      this.lastAcceleration[side] = {
        x: (v.x - prev.x) / fixedDeltaSeconds,
        y: (v.y - prev.y) / fixedDeltaSeconds,
        z: (v.z - prev.z) / fixedDeltaSeconds,
      };
      this.lastVelocity[side] = v;
    }
  }

  private tickCameraAndVfx(
    tickIndex: number,
    result: MatchTickResult,
    isFrozenByHitstop: boolean,
    clashResolvedThisTick: MatchTickResult['clashResolvedThisTick'],
    currentClashState: ClashState,
  ): void {
    const match = this.match;
    const fixedDeltaSeconds = FIXED_DELTA_SECONDS;
    const firstPositionM = match.first.body.translation();
    const secondPositionM = match.second.body.translation();
    const midpointM: WorldPositionM = {
      x: (firstPositionM.x + secondPositionM.x) / 2,
      y: (firstPositionM.y + secondPositionM.y) / 2,
      z: (firstPositionM.z + secondPositionM.z) / 2,
    };

    if (clashResolvedThisTick) {
      // Resolution beat (owner decision): a strong, dedicated impact event
      // at the clash point drives Milestone 4's hitstop/shake/FOV-punch
      // pipeline like any other big moment. Follow biases toward whichever
      // side actually got launched; a Tie has no loser, so null keeps the
      // framing central/symmetric as approved.
      const loserIsFirst =
        clashResolvedThisTick.outcome === ClashOutcome.FirstWins ? false : clashResolvedThisTick.outcome === ClashOutcome.SecondWins ? true : null;
      const resolutionEvent: ImpactEvent = {
        kind: 'clashResolved',
        magnitude: CLASH_RESOLVED_MAGNITUDE,
        worldPositionM: midpointM,
        isFirst: loserIsFirst ?? true,
        followTargetIsFirst: loserIsFirst,
      };
      this.vfxManager.onImpactEvents([resolutionEvent]);
      this.lastCameraOutput = this.cameraDirector.tick({
        firstPositionM,
        secondPositionM,
        firstSpeedMps: result.first.movement.speedMps,
        secondSpeedMps: result.second.movement.speedMps,
        firstVelocityXZ: result.first.movement.actualVelocityVector,
        impactEvents: [resolutionEvent],
        fixedDeltaSeconds,
      });
    } else if (currentClashState === ClashState.Active) {
      // Dedicated Clash camera: a controlled cinematic orbit near the
      // confrontation point, while the normal camera's smoothing keeps
      // settling toward the (frozen) midpoint so resuming it isn't a snap.
      this.cameraDirector.tick({
        firstPositionM,
        secondPositionM,
        firstSpeedMps: 0,
        secondSpeedMps: 0,
        firstVelocityXZ: { x: 0, z: 0 },
        impactEvents: [],
        fixedDeltaSeconds,
      });
      const progressFraction = this.clash.controller.getElapsedS() / CLASH_TARGET_DURATION_S;
      const clashCameraOutput = this.clashCameraDirector.tick({ midpointM, progressFraction, fixedDeltaSeconds });
      this.lastCameraOutput = {
        cameraPositionM: clashCameraOutput.cameraPositionM,
        focusPositionM: clashCameraOutput.focusPositionM,
        shakeOffsetM: clashCameraOutput.shakeOffsetM,
        fovDeg: clashCameraOutput.fovDeg,
        isHitstopActive: false,
        hitstopRemainingS: 0,
        highSpeedBlend: 0,
        speedLinesScreenDirection: { x: 0, y: 0 },
      };
      if (tickIndex % CLASH_PROGRESSIVE_VFX_INTERVAL_TICKS === 0) {
        this.vfxManager.onImpactEvents([{ kind: 'hit', magnitude: 0.1 + progressFraction * 0.3, worldPositionM: midpointM, isFirst: true }]);
      }
    } else {
      const impactEvents = isFrozenByHitstop ? [] : buildImpactEventsForTick(result, firstPositionM, secondPositionM);
      this.vfxManager.onImpactEvents(impactEvents);
      this.lastCameraOutput = this.cameraDirector.tick({
        firstPositionM,
        secondPositionM,
        firstSpeedMps: result.first.movement.speedMps,
        secondSpeedMps: result.second.movement.speedMps,
        firstVelocityXZ: result.first.movement.actualVelocityVector,
        impactEvents,
        fixedDeltaSeconds,
      });
    }
  }
}

function emptyImpulses(): SideTickImpulses {
  return { knockbackForce: 0, stabilityDamage: 0, impactDeltaSpeedMps: 0 };
}

function zero3(): { x: number; y: number; z: number } {
  return { x: 0, y: 0, z: 0 };
}

function copy3(v: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  return { x: v.x, y: v.y, z: v.z };
}

/** Telemetry/debug identifier only (GDD section 72) — never feeds simulation, so it may use the platform's randomness. */
function createMatchId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID();
  return `match-${Date.now().toString(36)}`;
}
