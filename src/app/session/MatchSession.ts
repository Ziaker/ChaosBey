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
import { createMatchScene, REST_VISUAL_POSE, type BeyVisualPose, type MatchBeys, type MatchScene } from '../bootstrap/createMatchScene';
import { GameState, type GameStateMachine } from '../lifecycle/GameState';
import type { MatchTickResult } from '../simulation/tickMatch';
import { MatchStepper, type MatchStepWorld } from '../simulation/MatchStepper';
import { buildCanonicalMatchState } from '../../replay/state/CanonicalMatchState';
import type { CanonicalRecord } from '../../replay/state/CanonicalValue';
import { stateHash } from '../../replay/state/stateHash';
import type { StateHash } from '../../replay/contracts';
import { ClashOrchestration } from '../simulation/ClashOrchestration';
import { ClashPresentationTracker } from '../simulation/ClashPresentationTracker';
import { RoundState } from '../../combat/round-rules/RoundState';
import { ClashOutcome, ClashState } from '../../combat/clash/ClashController';
import { NullAiMashSource } from '../../combat/clash/ClashMash';
import { CLASH_PROGRESSIVE_VFX_INTERVAL_TICKS, CLASH_TARGET_DURATION_S } from '../../combat/clash/ClashTuning';
import { CameraRig } from '../../camera/director/CameraRig';
import { buildFightFrame, speedLinesScreenDirection, type FightFrameBey, type SessionCameraOutput } from '../../camera/director/sessionCamera';
import type { PresetId } from '../../camera/director/CameraParams';
import { buildImpactEventsForTick, type ImpactEvent, type WorldPositionM } from '../../camera/ImpactEvents';
import { CLASH_RESOLVED_MAGNITUDE } from '../../camera/ImpactMagnitude';
import { arenaGeometryOf, type MatchConfig } from '../../config/match/MatchConfig';
import { FOUNDRY_PIT, type ArenaTheme } from '../../arena/presets/ArenaPresets';
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
import { presentationFeaturesFromLocation, type PresentationFeatures } from '../../presentation/features';
import { PresentationHub, type PresentationHubStats } from '../../presentation/hub';
import { selectClashPresentationSnapshot } from '../../presentation/clash';
import { selectBeyPresentationState, type CameraPresentationSnapshot, type RecentImpact } from '../../presentation/state';
import type { PresentationSide } from '../../presentation/events';
import { collectSceneStats, type SceneStats } from '../../presentation/sceneStats';
import { ConditionVisualsSystem, normalizeConditionLayers } from '../../vfx/condition/ConditionVisualsSystem';
import type { LanguageId } from '../../vfx/condition/types';
import { HeadingArrow } from '../../vfx/HeadingArrow';
import { DriftVfx } from '../../vfx/DriftVfx';
import { VfxManager } from '../../vfx/VfxManager';
import { ForcedInputController } from '../../automation/scripted-scenarios/ForcedInputController';
import { AIController } from '../../ai/controllers/AIController';
import { DEFAULT_ANOMALY_THRESHOLDS, MatchAnomalyDetector, type DetectedAnomaly } from '../../self-test/anomalies/MatchAnomalyDetector';
import type { ScriptedFrame } from '../../automation/scripted-scenarios/ScriptedController';
import { matchSpawnsFor } from '../bootstrap/matchSpawns';
import { floorHeightAt, floorRimHeight } from '../../arena/floor/ArenaFloorProfile';
import type { ChaosBeyReplayV1 } from '../../replay/format/ChaosBeyReplayV1';
import { captureDeterministicConfig } from '../../replay/format/configSnapshot';
import { ReplayCapture, type ReplayCaptureOptions } from '../../replay/recording/ReplayCapture';
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
  /** Which Bey each side plays. Omit for DEFAULT_MATCH_BEYS (Attack vs Defense). */
  readonly beys?: MatchBeys;
  /** How the arena looks (render only; its gameplay values come from matchConfig). Omit for Foundry Pit's. */
  readonly arenaTheme?: ArenaTheme;
  /** M11: the player's camera preset (Settings). Render only; default B. */
  readonly cameraPreset?: PresetId;
  /** Presentation feature flags (src/presentation/features.ts). Omit for the page's `?pfx=` flags (all off when there are none): the game as it was. Render only. */
  readonly presentationFeatures?: PresentationFeatures;
  /** Which condition languages (A, B, C) show when the `conditionVisuals` flag is on; at least one. Default A. Render only. */
  readonly conditionLayers?: readonly LanguageId[];
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
  /** M11: the floor arrow showing the player's Bey's physical heading (default on). */
  readonly headingArrow?: boolean;
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
  /** Presentation foundation: derives events and state after each tick and runs attached presentation systems (none by default). Render only. */
  private readonly presentation: PresentationHub;
  /** The approved Stamina / Stability / Broken languages, attached only with the `conditionVisuals` flag (render only). */
  private conditionVisuals: ConditionVisualsSystem | null = null;
  /** Owner playtest (after M11): skid marks, sparks and grip-regain ring while a Bey drifts. Render only. */
  private readonly driftVfx: { readonly first: DriftVfx; readonly second: DriftVfx };
  /** M11: the approved camera director running the three presets; the Clash forces B without orbit. Render only. */
  private readonly cameraRig: CameraRig;
  /** The render camera, read only for its aspect ratio (the director's off-screen check). */
  private readonly camera: THREE.PerspectiveCamera;
  private readonly stepper = new MatchStepper();

  /** CanonicalMatchStateV1 after the ticks run so far (M9: the official state-hash input). */
  getCanonicalState(): CanonicalRecord {
    // this.tickIndex is the next TickIndex to run, which equals the ticks completed.
    return buildCanonicalMatchState({ ticksCompleted: this.tickIndex, world: this.stepWorld(), hitstop: this.stepper.hitstop });
  }

  /** stateHash(getCanonicalState()). */
  getStateHash(): StateHash {
    return stateHash(this.getCanonicalState());
  }

  /**
   * Starts recording this match as a ChaosBeyReplayV1 (M9). Only before
   * the first tick: a replay always starts from the initial state. The
   * config recorded is the one this session was built with.
   */
  startReplayCapture(options: ReplayCaptureOptions): void {
    if (this.tickIndex !== 0) throw new Error(`MatchSession.startReplayCapture(): must start before the first tick (already at TickIndex ${this.tickIndex}).`);
    if (this.replayCapture) throw new Error('MatchSession.startReplayCapture(): already recording.');
    const config = captureDeterministicConfig({
      seedText: this.seedText,
      matchConfig: this.matchConfig,
      attackProfileSettings: this.attackProfileSettings,
      spawns: matchSpawnsFor(this.matchConfig.arenaFloor ?? 'flat'),
      beys: { first: this.match.first.definition, second: this.match.second.definition },
    });
    // Called inside tick() before this.tickIndex advances, so the count comes from the capture, not from this.tickIndex.
    const capture = new ReplayCapture(config, options, (ticksCompleted) =>
      stateHash(buildCanonicalMatchState({ ticksCompleted, world: this.stepWorld(), hitstop: this.stepper.hitstop })),
    );
    this.replayCapture = { capture, stateEdits: [] };
  }

  isCapturingReplay(): boolean {
    return this.replayCapture !== null;
  }

  /**
   * Cancels any pending jump-input-buffer press on both Beys. Call on
   * window blur/focus loss (KeyboardController's onInputDisrupted, GDD
   * 131) — the same disruption that already forgets every held/pending
   * key must also forget a press DriftController is still privately
   * buffering, or it could fire as a ghost hop after the disruption.
   */
  cancelBufferedJumps(): void {
    this.match.first.drift.cancelBufferedJump();
    this.match.second.drift.cancelBufferedJump();
  }

  /**
   * Ends the recording. `debugMutations` lists the Debug Lab state edits
   * made while recording: they aren't inputs, so a replay with any of them
   * can't reproduce the match and playback will diverge where they happened.
   * Forced inputs aren't listed: they reach the match through the
   * controllers, so the recorded frames already contain them.
   */
  finishReplayCapture(): { readonly replay: ChaosBeyReplayV1; readonly debugMutations: readonly { tickIndex: number; description: string }[] } {
    const recording = this.replayCapture;
    if (!recording) throw new Error('MatchSession.finishReplayCapture(): not recording.');
    this.replayCapture = null;
    return { replay: recording.capture.finish(), debugMutations: recording.stateEdits };
  }

  private stepWorld(): MatchStepWorld {
    return { physics: this.physics, first: this.match.first, second: this.match.second, roundState: this.roundState, clash: this.clash };
  }

  private hitstopView(): { isFreezing: boolean; remainingS: number } {
    return { isFreezing: this.stepper.hitstop.isFreezing(), remainingS: this.stepper.hitstop.getRemainingS() };
  }
  private readonly clashPresentationTracker = new ClashPresentationTracker();
  private readonly stateMachine: GameStateMachine;
  private readonly keyboard: CombatController;

  private readonly controllerSpecs: Record<Side, SideControllerSpec>;
  private readonly headingArrow: HeadingArrow;
  /** Each side's driver, wrapped so the Debug Lab can force short input bursts. */
  private readonly drivers: Record<Side, ForcedInputController>;
  private readonly debugMutations: { tickIndex: number; description: string }[] = [];
  private readonly attackProfileSettings: BeyAttackProfileSettings;
  /** M9 recording, when started (startReplayCapture). */
  private replayCapture: { readonly capture: ReplayCapture; readonly stateEdits: { tickIndex: number; description: string }[] } | null = null;
  /** GDD 67 checks on the live match, the same detector the Self-Test batches use. */
  private readonly anomalyDetector: MatchAnomalyDetector;
  private readonly detectedAnomalies: DetectedAnomaly[] = [];

  private tickIndex = 0;
  private lastMatchResult: MatchTickResult | null = null;
  private lastCameraOutput: SessionCameraOutput | null = null;
  /** Which Bey left the ring, once the round ended by ring-out (camera only). */
  private ringOutIsFirst: boolean | null = null;
  private lastPhysicsStepTimeMs = 0;
  private lastImpulses: Record<Side, SideTickImpulses> = { first: emptyImpulses(), second: emptyImpulses() };
  private lastKnockback: Record<Side, LastKnockback | null> = { first: null, second: null };
  private lastActions: Record<Side, ControllerActions | null> = { first: null, second: null };
  private lastVelocity: Record<Side, { x: number; y: number; z: number }>;
  private lastAcceleration: Record<Side, { x: number; y: number; z: number }> = { first: zero3(), second: zero3() };
  private lastVisual: Record<Side, BeyVisualPose> = { first: REST_VISUAL_POSE, second: REST_VISUAL_POSE };
  private disposed = false;

  private constructor(options: MatchSessionOptions, physics: PhysicsWorld) {
    this.matchId = createMatchId();
    this.seedText = options.seedText;
    this.rngStreams = createRngStreams(options.seedText);
    this.physics = physics;
    this.matchConfig = options.matchConfig;
    this.attackProfileSettings = options.attackProfileSettings;
    this.telemetry = options.telemetry;
    this.stateMachine = options.stateMachine;
    this.keyboard = options.keyboard;

    // The Clash placeholder AI mash source stays disabled: a real
    // AIController mashes with its own Z/X/C presses (see ClashMash.ts's
    // NullAiMashSource doc), and a keyboard/idle side mashes by itself.
    this.clash = new ClashOrchestration(options.matchConfig, new NullAiMashSource());

    options.scene.add(this.root);
    const presentationFeatures = options.presentationFeatures ?? presentationFeaturesFromLocation();
    this.match = createMatchScene(this.root, physics, options.attackProfileSettings, options.beys, {
      geometry: arenaGeometryOf(options.matchConfig),
      theme: options.arenaTheme ?? FOUNDRY_PIT.theme,
    }, options.matchConfig.motion ?? 'B', presentationFeatures);
    this.presentation = new PresentationHub({
      features: presentationFeatures,
      beys: [
        { side: 'first', definitionId: this.match.first.definition.id },
        { side: 'second', definitionId: this.match.second.definition.id },
      ],
      getVfxAnchor: (side, name, out) => this.match.visuals[side].anchors.getWorld(name, out),
    });
    this.headingArrow = new HeadingArrow(this.root);
    this.camera = options.camera;
    const arenaFloor = options.matchConfig.arenaFloor ?? 'flat';
    this.cameraRig = new CameraRig(options.cameraPreset ?? 'B', options.camera.aspect, arenaFloor === 'flat' ? undefined : (x, z) => floorHeightAt(arenaFloor, x, z));
    this.vfxManager = new VfxManager(this.root, options.camera, this.match.first.definition.particle, this.match.second.definition.particle);
    const theme = options.arenaTheme ?? FOUNDRY_PIT.theme;
    const floorAt = (x: number, z: number): number => floorHeightAt(arenaFloor, x, z);
    this.driftVfx = { first: new DriftVfx(theme.sparkHotHex, theme.sparkCoolHex, floorAt), second: new DriftVfx(theme.sparkHotHex, theme.sparkCoolHex, floorAt) };
    this.root.add(this.driftVfx.first.object3D, this.driftVfx.second.object3D);
    if (presentationFeatures.conditionVisuals) {
      this.conditionVisuals = new ConditionVisualsSystem({
        scene: this.root,
        camera: options.camera,
        beys: {
          first: { visual: this.match.visuals.first.visual, gameplay: this.match.first.definition },
          second: { visual: this.match.visuals.second.visual, gameplay: this.match.second.definition },
        },
        floorHeightAt: floorAt,
        layers: normalizeConditionLayers(options.conditionLayers ?? ['A']),
      });
      this.presentation.attach(this.conditionVisuals);
    }

    this.lastVelocity = { first: copy3(this.match.first.body.linvel()), second: copy3(this.match.second.body.linvel()) };
    this.anomalyDetector = new MatchAnomalyDetector({ ...DEFAULT_ANOMALY_THRESHOLDS, wallHeightM: floorRimHeight(options.matchConfig.arenaFloor ?? 'flat') + options.matchConfig.arenaWallHeightM });

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

  /** M11: the player's camera preset (A/B/C). Render only; a change mid-match crossfades. */
  setCameraPreset(preset: PresetId): void {
    this.cameraRig.setPreset(preset);
  }

  getCameraPreset(): PresetId {
    return this.cameraRig.getPreset();
  }

  getLastCameraOutput(): SessionCameraOutput | null {
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
    this.logDebugMutation(`${side}: forced input "${label}" for ${durationTicks} ticks`, false);
  }

  /**
   * Records an explicit Debug Lab mutation (GDD section 160: mutation tools
   * are explicit actions). From the first one on, the run is no longer a
   * pure replay of its seed; reports say so.
   */
  recordDebugMutation(description: string): void {
    this.logDebugMutation(description, true);
  }

  private logDebugMutation(description: string, editsState: boolean): void {
    if (editsState) this.replayCapture?.stateEdits.push({ tickIndex: this.tickIndex, description });
    this.debugMutations.push({ tickIndex: this.tickIndex, description });
    this.telemetry.setCurrentTick(this.tickIndex);
    this.telemetry.record({ kind: TelemetryEventKind.DebugMutation, description });
  }

  getDebugMutations(): readonly { tickIndex: number; description: string }[] {
    return this.debugMutations;
  }

  /** Every GDD 67 detection on this match so far (one per episode). */
  getDetectedAnomalies(): readonly DetectedAnomaly[] {
    return this.detectedAnomalies;
  }

  getControllerSpec(side: Side): SideControllerSpec {
    return this.controllerSpecs[side];
  }

  describeController(side: Side): string {
    return describeControllerSpec(this.controllerSpecs[side]);
  }

  /** Swaps who drives one side (GDD section 70: toggle AI / automated controller, change AI profile). Takes effect on the next tick. */
  setController(side: Side, spec: SideControllerSpec): void {
    if (spec.kind === 'keyboard') {
      const opposite: Side = side === 'first' ? 'second' : 'first';
      // Only one side may ever be wired to the shared keyboard device (see
      // MatchSessionOptions.keyboard's doc comment — "only used by a side",
      // singular). The Debug Lab panel has one independent dropdown per
      // side with no cross-validation, so without this a developer could
      // switch both sides to Keyboard and have them silently share the same
      // ActionSampleBuffer: presses lost to whichever side samples second,
      // and its hold-duration clock advancing twice per tick.
      if (this.controllerSpecs[opposite].kind === 'keyboard') this.applyController(opposite, { kind: 'idle' });
    }
    this.applyController(side, spec);
  }

  private applyController(side: Side, spec: SideControllerSpec): void {
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

    // One fixed tick of the real match (app/simulation/MatchStepper.ts,
    // shared with the headless Self Test): hitstop check, controller
    // sampling, tickMatch() unless frozen, hitstop update. Hitstop is
    // simulation state (M9): a strong-enough impact freezes gameplay for a
    // brief, magnitude-scaled window. Controllers are told a tick is
    // frozen, so a press made during the freeze is buffered (not lost) and
    // delivered once on the first unfrozen sample afterward — see
    // ActionSampleBuffer. Camera/VFX timers below still tick regardless.
    const stepStart = performance.now();
    const step = this.stepper.step(this.stepWorld(), this.drivers, fixedDeltaSeconds);
    const { firstActions, secondActions, result } = step;
    const isFrozenByHitstop = !step.advanced;
    this.lastActions = { first: firstActions, second: secondActions };
    // Right after the step, before anything else reads or changes the state.
    this.replayCapture?.capture.afterTick(tickIndex, firstActions, secondActions);

    if (step.advanced) {
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
      first: { spin: result.first.spin.visualSpinAngleRad, wobble: result.first.spin.wobbleOffsetRad, lean: result.first.spin.lean },
      second: { spin: result.second.spin.visualSpinAngleRad, wobble: result.second.spin.wobbleOffsetRad, lean: result.second.spin.lean },
    };

    this.tickCameraAndVfx(tickIndex, result, isFrozenByHitstop, clashResolvedThisTick, currentClashState, presentationEvents.clashStarted);
    this.tickPresentation(tickIndex, result, isFrozenByHitstop, clashResolvedThisTick, currentClashState, presentationEvents);

    for (const detection of this.anomalyDetector.check({
      tick: tickIndex,
      first: match.first,
      second: match.second,
      result,
      roundState,
      clash: clash.controller,
      firstActions,
      secondActions,
      aiSides: { first: this.getController('first') instanceof AIController, second: this.getController('second') instanceof AIController },
      hitstopActive: isFrozenByHitstop,
    })) {
      this.detectedAnomalies.push(detection);
      telemetry.record({
        kind: TelemetryEventKind.PhysicsAnomaly,
        anomalyKind: detection.kind,
        detail: `[${detection.severity}${detection.knownIssue ? `, known ${detection.knownIssue}` : ''}] ${detection.side}: ${detection.detail}`,
      });
    }

    this.tickIndex++;
    return { tickIndex, firstActions, secondActions, result, simulationAdvanced: !isFrozenByHitstop };
  }

  /** Syncs visuals, camera and frame-rate VFX to the current state. Call once per rendered frame, before renderer.render(). */
  renderFrame(frameDeltaSeconds: number, camera: THREE.PerspectiveCamera, view: SessionRenderView = DEFAULT_RENDER_VIEW): void {
    const match = this.match;
    match.syncVisualsToPhysics(this.lastVisual.first, this.lastVisual.second);

    // The player's Bey (the keyboard/pad side) gets the heading arrow.
    const playerSide: Side | null = this.controllerSpecs.first.kind === 'keyboard' ? 'first' : this.controllerSpecs.second.kind === 'keyboard' ? 'second' : null;
    if (playerSide && view.headingArrow !== false) {
      const bey = this.getBey(playerSide);
      this.headingArrow.update(bey.body.translation(), bey.movement.getHeadingRad(), bey.definition.physical.colliderRadiusM, bey.definition.physical.colliderHalfHeightM);
    } else {
      this.headingArrow.hide();
    }

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
      // Camera effects off: no shake and no impact FOV punch; the framing itself (speed FOV, contexts) is the preset's.
      camera.fov = view.cameraEffects ? cameraOutput.fovDeg : cameraOutput.fovDeg - cameraOutput.fovPunchDeg;
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
    const last = this.lastMatchResult;
    if (last) {
      for (const side of ['first', 'second'] as const) {
        const bey = match[side];
        this.driftVfx[side].update(frameDeltaSeconds, {
          position: bey.body.translation(),
          velocity: bey.body.linvel(),
          headingRad: bey.movement.getHeadingRad(),
          driftState: last[side].driftState,
          grounded: last[side].grounded,
        });
      }
    }
    this.presentation.update(frameDeltaSeconds);
  }

  /** Drift effect counts per side (render only), for tests and the smoke. */
  getDriftVfxCounts(side: Side): ReturnType<DriftVfx['getCounts']> {
    return this.driftVfx[side].getCounts();
  }

  /** Scene subtree owned by this session — debug visualization layers attach here so they go away with it. */
  getSceneRoot(): THREE.Object3D {
    return this.root;
  }

  getVfxManager(): VfxManager {
    return this.vfxManager;
  }

  /** The presentation hub: future visual systems attach here. Nothing is attached by default. */
  getPresentation(): PresentationHub {
    return this.presentation;
  }

  /** Which condition languages show, live (the Settings screen). No effect unless the `conditionVisuals` flag is on. */
  setConditionLayers(layers: readonly LanguageId[]): void {
    this.conditionVisuals?.setLayers(layers);
  }

  /** The condition languages showing now, or null while the `conditionVisuals` flag is off. */
  getConditionLayers(): readonly LanguageId[] | null {
    return this.conditionVisuals?.getLayers() ?? null;
  }

  /** World position of a named VFX anchor on a Bey (presentation only). False if the name is not an anchor. */
  getVfxAnchor(side: Side, name: string, out: { x: number; y: number; z: number }): boolean {
    return this.match.visuals[side].anchors.getWorld(name, out);
  }

  /** Observability for the visual passes: what the hub runs and a census of this session's scene subtree. */
  getPresentationStats(): { readonly hub: PresentationHubStats; readonly scene: SceneStats } {
    return { hub: this.presentation.getStats(), scene: collectSceneStats(this.root) };
  }

  /** Frees the physics world and removes/disposes everything this session drew. The session is unusable afterwards. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.presentation.dispose();
    this.vfxManager.dispose();
    this.driftVfx.first.dispose();
    this.driftVfx.second.dispose();
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
      aiRng: side === 'first' ? this.rngStreams.aiFirst : this.rngStreams.aiSecond,
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
    clashStarted: boolean,
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

    let impactEvents: ImpactEvent[];
    if (clashResolvedThisTick) {
      // Resolution beat (owner decision): a strong, dedicated impact event
      // at the clash point drives the hitstop/shake/FOV-punch pipeline like
      // any other big moment. Follow biases toward whichever side actually
      // got launched; a Tie has no loser, so null keeps the framing
      // central/symmetric as approved.
      const loserIsFirst =
        clashResolvedThisTick.outcome === ClashOutcome.FirstWins ? false : clashResolvedThisTick.outcome === ClashOutcome.SecondWins ? true : null;
      impactEvents = [
        {
          kind: 'clashResolved',
          magnitude: CLASH_RESOLVED_MAGNITUDE,
          worldPositionM: midpointM,
          isFirst: loserIsFirst ?? true,
          followTargetIsFirst: loserIsFirst,
        },
      ];
      this.vfxManager.onImpactEvents(impactEvents);
    } else if (currentClashState === ClashState.Active) {
      impactEvents = [];
      const progressFraction = this.clash.controller.getElapsedS() / CLASH_TARGET_DURATION_S;
      if (tickIndex % CLASH_PROGRESSIVE_VFX_INTERVAL_TICKS === 0) {
        this.vfxManager.onImpactEvents([{ kind: 'hit', magnitude: 0.1 + progressFraction * 0.3, worldPositionM: midpointM, isFirst: true }]);
      }
    } else {
      impactEvents = isFrozenByHitstop ? [] : buildImpactEventsForTick(result, firstPositionM, secondPositionM);
      this.vfxManager.onImpactEvents(impactEvents);
    }

    if (!isFrozenByHitstop) {
      if (result.ringOutFirst) this.ringOutIsFirst = true;
      else if (result.ringOutSecond) this.ringOutIsFirst = false;
    }
    const snapshot = this.lastMatchResult;
    const bey = (side: Side): FightFrameBey => {
      const b = this.getBey(side);
      const s = snapshot ? snapshot[side] : null;
      return { position: copy3(b.body.translation()), velocity: copy3(b.body.linvel()), grounded: s ? s.grounded : null, attackState: s ? s.attackState : null, isBroken: s ? s.isBroken : false };
    };
    // The camera runs every tick, hitstop included (shake and FOV punch keep decaying in real time; camera-approval.md 10.6).
    this.cameraRig.setAspect(this.camera.aspect);
    const frame = buildFightFrame({
      tick: tickIndex,
      first: bey('first'),
      second: bey('second'),
      impactEvents,
      clashStarted,
      clashActive: currentClashState === ClashState.Active,
      clashProgress: this.clash.controller.getElapsedS() / CLASH_TARGET_DURATION_S,
      roundOver: this.roundState.isOver,
      ringOutIsFirst: this.ringOutIsFirst,
    });
    const out = this.cameraRig.tick(frame, fixedDeltaSeconds);
    const hitstop = this.hitstopView();
    this.lastCameraOutput = {
      cameraPositionM: out.eye,
      focusPositionM: out.focus,
      shakeOffsetM: out.shake,
      fovDeg: out.fov,
      fovPunchDeg: out.fovPunch,
      isHitstopActive: hitstop.isFreezing,
      hitstopRemainingS: hitstop.remainingS,
      highSpeedBlend: out.player.weights.HighSpeed,
      speedLinesScreenDirection: speedLinesScreenDirection(out.eye, out.focus, frame.first.velocity),
      mode: out.mode,
      preset: out.preset,
      clashBlend: out.clashBlend,
      presetSwitch: out.presetSwitch,
      distanceM: out.player.debug.distance,
      yawDeg: out.player.debug.yawDeg,
      side: out.player.debug.side,
      modifiers: [...out.player.debug.modifiers],
    };
  }

  private cameraSnapshot(): CameraPresentationSnapshot | null {
    const c = this.lastCameraOutput;
    if (!c) return null;
    return {
      mode: c.mode,
      preset: c.preset,
      fovDeg: c.fovDeg,
      distanceM: c.distanceM,
      yawDeg: c.yawDeg,
      clashBlend: c.clashBlend,
      highSpeedBlend: c.highSpeedBlend,
      hitstopActive: c.isHitstopActive,
      hitstopRemainingS: c.hitstopRemainingS,
    };
  }

  /**
   * Presentation foundation: hands the finished tick to the hub, which derives
   * PresentationEvents and the presentation state and delivers them to any
   * attached systems. Read-only: it reads what the tick already produced and
   * writes nothing the simulation, the replay or the state hash can see.
   */
  private tickPresentation(
    tickIndex: number,
    result: MatchTickResult,
    isFrozenByHitstop: boolean,
    clashResolvedThisTick: MatchTickResult['clashResolvedThisTick'],
    currentClashState: ClashState,
    clashEdges: ReturnType<ClashPresentationTracker['update']>,
  ): void {
    const snapshot = this.lastMatchResult;
    if (!snapshot) return;
    const clash = this.clash.controller;
    // The same pure mapping the camera and the legacy VFX use, evaluated here so the
    // camera/VFX block above stays untouched. A Clash tick contributes no impact
    // events of its own: its presentation events come from the Clash edges.
    const impactEvents: readonly ImpactEvent[] =
      clashResolvedThisTick || currentClashState === ClashState.Active || isFrozenByHitstop
        ? []
        : buildImpactEventsForTick(result, this.match.first.body.translation(), this.match.second.body.translation());
    this.presentation.onTick(
      {
        tick: tickIndex,
        result: isFrozenByHitstop ? null : result,
        impactEvents,
        clash: {
          started: clashEdges.clashStarted,
          result: clashEdges.clashResult,
          mashEdges: clashEdges.mashInputEvents,
          progress: Math.min(1, Math.max(0, clash.getElapsedS() / CLASH_TARGET_DURATION_S)),
        },
        roundOver: this.roundState.isOver,
        roundOutcome: this.roundState.result,
      },
      (recentImpact: Readonly<Record<PresentationSide, RecentImpact | null>>) => ({
        tick: tickIndex,
        round: { over: this.roundState.isOver, outcome: this.roundState.result },
        first: selectBeyPresentationState(snapshot.first, { side: 'first', definitionId: this.match.first.definition.id, maxSpeedMps: this.match.first.definition.handling.maxSpeedMps }),
        second: selectBeyPresentationState(snapshot.second, { side: 'second', definitionId: this.match.second.definition.id, maxSpeedMps: this.match.second.definition.handling.maxSpeedMps }),
        clash: selectClashPresentationSnapshot(clash),
        camera: this.cameraSnapshot(),
        recentImpact,
      }),
    );
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
