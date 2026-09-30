// ============================================================
// DEBUG LAB INSPECTION — RAW STATE, GDD SECTION 69
// Reads a MatchSession (never mutates it — GDD section 160) into labeled
// sections matching GDD section 69's list: Match, Transform, Linear,
// Angular, Surface, Resources, Combat, Dodge, Jump, Clash, AI, Camera,
// Performance and Replay/telemetry. A value the game cannot measure yet is
// shown as UNSUPPORTED with the reason, never as a made-up 0.
// Pure data: the panel renders it, tests assert on it.
// ============================================================

import { Action } from '../../input/actions/Action';
import { AIController } from '../../ai/controllers/AIController';
import type { MatchSession, Side } from '../../app/session/MatchSession';
import { ARENA_FLOORS, type ArenaFloorId } from '../../arena/floor/ArenaFloorProfile';
import { floorReadout } from '../../arena/floor/floorReadout';
import { ARENA_CAMERA_RIGS, CAMERA_PRESET_NAMES } from '../../camera/director/CameraRig';
import { PRESETS, PRESET_IDS } from '../../camera/director/CameraParams';
import { AIRBORNE_ACCELERATION_FACTOR } from '../../bey/movement/MovementTuning';
import { MOTION_DIRECTIONS, MOTION_DIRECTION_IDS } from '../../bey/motion/MotionPresets';
import { inputLockReasonFor } from '../inputLockReason';

const MOTION_NAME_BY_PARAMS = new Map(MOTION_DIRECTION_IDS.map((id) => [MOTION_DIRECTIONS[id].params, MOTION_DIRECTIONS[id].name] as const));
import { ClashState } from '../../combat/clash/ClashController';
import { computeClashPower, computeMashPerformance, computeStaminaFactor, computeVelocityFactor } from '../../combat/clash/ClashFormula';
import { DODGE_PERFECT_WINDOW_S } from '../../dodge/DodgeTuning';
import { DodgeState } from '../../dodge/DodgeController';
import { DriftState } from '../../drift/DriftController';
import { probeGround } from '../../physics/collision/GroundProbe';
import { FIXED_DELTA_SECONDS } from '../../physics/fixed-step/FixedTimestepLoop';

export interface InspectorRow {
  readonly label: string;
  readonly value: string;
  /** True when the value is a documented gap (feature not built yet), not a measurement. */
  readonly unsupported?: boolean;
}

export interface InspectorSection {
  readonly id: string;
  readonly title: string;
  readonly side?: Side;
  readonly rows: readonly InspectorRow[];
}

/** Frame-level numbers only the render loop knows. */
export interface InspectionFrameStats {
  readonly gameState: string;
  readonly fps: number;
  readonly frameTimeMs: number;
  /** Null when the caller did not measure it (e.g. a headless test). */
  readonly renderTimeMs: number | null;
  readonly drawCalls: number | null;
  readonly triangles: number | null;
  readonly paused: boolean;
  readonly ticksPerFixedStep: number;
  /** M9: replay recording/playback status for the Divergence row (omitted = not replaying). */
  readonly replayState?: string;
}

const RAD_TO_DEG = 180 / Math.PI;

export function buildInspection(session: MatchSession, frame: InspectionFrameStats): InspectorSection[] {
  const sections: InspectorSection[] = [buildMatchSection(session, frame)];
  for (const side of ['first', 'second'] as const) {
    sections.push(...buildSideSections(session, side));
  }
  sections.push(buildClashSection(session), buildCameraSection(session), buildPerformanceSection(session, frame), buildTelemetrySection(session, frame));
  return sections;
}

function buildMatchSection(session: MatchSession, frame: InspectionFrameStats): InspectorSection {
  const tick = session.getTickIndex();
  const config = session.matchConfig as unknown as Record<string, unknown>;
  return {
    id: 'match',
    title: 'Match',
    rows: [
      row('Match ID', session.matchId),
      row('Seed', session.rngStreams.rootSeedText),
      row('Tick', String(tick)),
      row('Elapsed sim time', `${(tick * FIXED_DELTA_SECONDS).toFixed(3)} s`),
      row('Game state', frame.gameState),
      row('Simulation', frame.paused ? 'PAUSED' : `running, ${frame.ticksPerFixedStep}× ticks per fixed step`),
      row('Round', `1 — ${session.roundState.result}`),
      gap('Match score', 'best-of-3 series scoring is not implemented yet (single round per match)'),
      ...Object.keys(config).map((key) => row(`Rule: ${key}`, String(config[key]))),
      row('First controller', session.describeController('first')),
      row('Second controller', session.describeController('second')),
      row('Input lock (first)', inputLockReasonFor(session, session.getLastCameraOutput()?.isHitstopActive ?? false)),
      row('Anomalies (GDD 67)', anomalySummary(session)),
      row(
        'Debug mutations',
        session.getDebugMutations().length === 0 ? 'none (pure seed replay)' : `${session.getDebugMutations().length} — run no longer reproducible from the seed alone`,
      ),
    ],
  };
}

function buildSideSections(session: MatchSession, side: Side): InspectorSection[] {
  const bey = session.getBey(side);
  const opponent = session.getBey(side === 'first' ? 'second' : 'first');
  const snapshot = session.getLastResult()?.[side] ?? null;
  const label = side === 'first' ? 'First' : 'Second';
  const body = bey.body;
  const t = body.translation();
  const q = body.rotation();
  const v = body.linvel();
  const w = body.angvel();
  const axes = localAxes(q);
  const accel = session.getLastAcceleration(side);
  const impulses = session.getLastImpulses(side);
  const knockback = session.getLastKnockback(side);
  const ground = probeGround(session.physics, bey.collider);
  const movementDebug = bey.movement.getDebugState();
  const dodge = bey.dodge.getDebugTimers();
  const dodgeState = bey.dodge.getState();
  const drift = bey.drift.getDebugTimers();
  const attack = bey.attack.getDebugState();
  const condition = bey.stamina.getPhysicalCondition();
  const actions = session.getLastActions(side);
  const cameraOutput = session.getLastCameraOutput();
  const opponentPos = opponent.body.translation();
  const distance = Math.hypot(opponentPos.x - t.x, opponentPos.z - t.z);
  const id = (suffix: string): string => `${side}-${suffix}`;
  const title = (name: string): string => `${label} · ${name} (${bey.definition.id})`;

  const sections: InspectorSection[] = [
    {
      id: id('transform'),
      side,
      title: title('Transform'),
      rows: [
        row('Position', vec3(t)),
        row('Orientation (quat)', `${f(q.x)}, ${f(q.y)}, ${f(q.z)}, ${f(q.w)}`),
        row('Local right', vec3(axes.right)),
        row('Local up (spin axis)', vec3(axes.up)),
        row('Local forward', vec3(axes.forward)),
        gap('Scale', 'rigid body has no scale (collider radius is fixed by the Bey definition)'),
      ],
    },
    {
      id: id('linear'),
      side,
      title: title('Linear motion'),
      rows: [
        row('Velocity', vec3(v)),
        row('Speed (XZ)', snapshot ? `${f(snapshot.movement.speedMps)} m/s` : '—'),
        row('Acceleration (last tick)', vec3(accel)),
        row('External impulse: knockback force', f(impulses.knockbackForce)),
        row('External impulse: impact Δv', `${f(impulses.impactDeltaSpeedMps)} m/s`),
        row('Intended steering vector', snapshot ? vec2(snapshot.movement.intendedSteeringVector) : '—'),
        row('Heading (physical)', snapshot ? `${f(snapshot.movement.headingRad * RAD_TO_DEG)}°` : '—'),
        ...floorRows(bey.arenaFloor, bey.body.translation()),
        row('Desired input (world)', desiredInput(session.getLastActions(side)?.moveIntent)),
        row('Camera yaw (diagnostic only — must never move Desired input above)', cameraYawDiagnostic(session)),
        row('Turn rate', `${f(movementDebug.turnRateRadPerS * RAD_TO_DEG)}°/s`),
      ],
    },
    {
      id: id('angular'),
      side,
      title: title('Angular motion'),
      rows: [
        row('Angular velocity', vec3(w)),
        row('Spin rate', snapshot ? `${f(snapshot.spin.spinRateRadPerSec)} rad/s` : '—'),
        row('Spin axis', vec3(axes.up)),
        row('Tilt', snapshot ? `${f(snapshot.spin.tiltRad * RAD_TO_DEG)}°` : '—'),
        row('Wobble energy', snapshot ? f(snapshot.spin.wobbleEnergy) : '—'),
        row('Wobble offset', snapshot ? `${f(snapshot.spin.wobbleOffsetRad * RAD_TO_DEG)}°` : '—'),
        row('Attitude (Motion Lab, visual)', snapshot ? `${f(Math.hypot(snapshot.spin.lean.x, snapshot.spin.lean.z) * RAD_TO_DEG)}°${snapshot.spin.isTumbling ? ' · TUMBLE' : ''} · upright spring ${f(snapshot.spin.recoveryFraction * 100)}%` : '—'),
        row('Angular impulse source: impact Δv', `${f(impulses.impactDeltaSpeedMps)} m/s`),
      ],
    },
    {
      id: id('surface'),
      side,
      title: title('Surface interaction'),
      rows: [
        row('Grounded', String(ground.grounded)),
        row('Touching contacts', String(ground.touchingContactCount)),
        row('Ground normal', ground.groundNormal ? vec3(ground.groundNormal) : '— (airborne)'),
        row('Collider friction', f(bey.collider.friction())),
        row('Collider restitution', f(bey.collider.restitution())),
        row('Movement direction', MOTION_NAME_BY_PARAMS.get(bey.motion) ?? 'custom'),
        row('Lateral grip', snapshot ? `${f(snapshot.movement.lateralGripPerS)} /s` : '—'),
        row('Grip (Motion Lab)', snapshot ? `×${f(snapshot.movement.gripFactor)}${snapshot.movement.isSlipping ? ' · SLIP' : ''}` : '—'),
        row('Whirl (rodopio)', snapshot ? `${f(snapshot.movement.whirlRadPerS)} rad/s` : '—'),
        row('Longitudinal drag', snapshot ? `${f(snapshot.movement.longitudinalDragPerS)} /s` : '—'),
        row('Slip angle', snapshot ? `${f(snapshot.movement.slipAngleRad * RAD_TO_DEG)}°` : '—'),
      ],
    },
    {
      id: id('resources'),
      side,
      title: title('Resources'),
      rows: [
        row('Stamina', resource(bey.stamina.resource)),
        row('Stability', `${resource(bey.stability.resource)}${bey.stability.isBroken ? ' — BROKEN' : ''}`),
        row('Stability: since last damage', seconds(bey.stability.getTimeSinceLastDamageS())),
        row('Attack Energy', resource(bey.attackEnergy.resource)),
        row('Attack Energy: since last use', seconds(bey.attackEnergy.getTimeSinceLastConsumptionS())),
        row('Cooldown: dodge', `${f(dodge.cooldownRemainingS)} s`),
        row('Cooldown: post-impact steering', `${f(movementDebug.postImpactCooldownRemainingS)} s`),
        row('Cooldown: Clash (shared)', `${f(session.clash.controller.getCooldownRemainingS())} s`),
        row(
          'Modifier: low-Stamina condition',
          `accel ×${f(condition.accelFactor)}, recovery ×${f(condition.recoveryTorqueFactor)}, spin decay ×${f(condition.spinDecayMultiplier)}, wobble floor ${f(condition.ambientWobbleFloor)}`,
        ),
      ],
    },
    {
      id: id('combat'),
      side,
      title: title('Combat'),
      rows: [
        row('Attack state', bey.attack.getState()),
        row('Phase timers', `buffer ${f(attack.bufferTimerS)} · charge ${f(attack.chargeTimerS)} · active ${f(attack.activeTimerS)} · recovery ${f(attack.recoveryTimerS)} s`),
        row('Dash charge', `${f(bey.attack.getChargeFraction() * 100)}%`),
        row(
          'Hitbox active',
          attack.activeHitbox
            ? `${attack.activeHitbox.kind}, r=${f(attack.activeHitbox.radiusM)} m, force ${f(attack.activeHitbox.knockbackForce)}, Stability dmg ${f(attack.activeHitbox.stabilityDamage)}`
            : 'none',
        ),
        row('Target', `opponent at ${vec3(opponentPos)}, ${f(distance)} m`),
        row('Hitstop (global)', cameraOutput?.isHitstopActive ? `active, ${f(cameraOutput.hitstopRemainingS)} s left` : 'inactive'),
        row('Last knockback received', knockback ? `tick ${knockback.tickIndex}, force ${f(knockback.force)}` : 'none yet'),
        knockback?.components
          ? row(
              'Knockback components',
              `base ${f(knockback.components.baseForce)} × stat ${f(knockback.components.statRatio)} × atk speed ${f(knockback.components.attackerSpeedFactor)} × def vuln ${f(knockback.components.defenderVulnerability)} × stab ${f(knockback.components.stabilityReduction)} × stam ${f(knockback.components.staminaVulnerability)} × angle ${f(knockback.components.angleFactor)}`,
            )
          : row('Knockback components', knockback ? 'Clash resolution knockback (built by ClashOrchestration, no per-factor breakdown)' : '—'),
      ],
    },
    {
      id: id('dodge'),
      side,
      title: title('Dodge'),
      rows: [
        row('Dodge phase', dodgeState),
        row('I-frames', String(dodgeState === DodgeState.Dodging && ground.grounded)),
        row('Active timer', `${f(dodge.activeTimerS)} s`),
        row('Cooldown remaining', `${f(dodge.cooldownRemainingS)} s`),
        row('Perfect-dodge window', dodgeState === DodgeState.Dodging && dodge.activeTimerS <= DODGE_PERFECT_WINDOW_S ? `OPEN (≤ ${DODGE_PERFECT_WINDOW_S} s)` : 'closed'),
        row('Air recovery', dodge.airRecoveryAvailable ? 'available' : dodge.launchPending ? 'launch pending' : 'unavailable'),
      ],
    },
    {
      id: id('jump'),
      side,
      title: title('Jump'),
      rows: [
        row('Hold time (JumpDrift)', actions ? `${f(actions.jumpDriftHoldDurationSeconds)} s` : '—'),
        row('Jump/drift state', bey.drift.getState()),
        row('X (JumpDrift) held', actions ? String(actions.held.has(Action.JumpDrift)) : '—'),
        row('Drift armed (landed holding X, waiting for a turn)', String(drift.driftArmed)),
        row('Slip angle', snapshot ? `${f((snapshot.movement.slipAngleRad * 180) / Math.PI)}°` : '—'),
        row('Lateral grip now', snapshot ? `${f(snapshot.movement.lateralGripPerS)} /s` : '—'),
        row('Heading', `${f((bey.movement.getHeadingRad() * 180) / Math.PI)}°`),
        row('Velocity direction', velocityDirectionText(bey.body.linvel())),
        row('Heading − velocity', headingMinusVelocityText(bey.movement.getHeadingRad(), bey.body.linvel())),
        row('Jump force (vertical speed added)', drift.jumpVerticalSpeedAddedMps > 0 ? `${f(drift.jumpVerticalSpeedAddedMps)} m/s` : '— (not in a hop)'),
        row('Airborne', String(!ground.grounded)),
        row('Air control', `accel ×${f(AIRBORNE_ACCELERATION_FACTOR)}, lateral grip ${f(bey.motion.airGrip)} /s`),
        row('Hop timer', `${f(drift.hopTimerS)} s`),
        row('Drift recovery timer', bey.drift.getState() === DriftState.Recovering ? `${f(drift.recoveryTimerS)} s` : '—'),
        row(
          'Landing',
          snapshot?.justLanded ? `landed this tick: descent ${f(snapshot.landingDescentSpeedMps)} m/s, intensity ${f(snapshot.landingIntensity)}` : 'no landing this tick',
        ),
      ],
    },
    buildAiSection(session, side, title('AI')),
  ];
  return sections;
}

function buildAiSection(session: MatchSession, side: Side, title: string): InspectorSection {
  const controller = session.getController(side);
  if (!(controller instanceof AIController)) {
    return { id: `${side}-ai`, side, title, rows: [row('Controller', `${session.describeController(side)} — no AI state`)] };
  }
  const ai = controller.getDebugState();
  const difficulty = controller.getDifficultyProfile();
  return {
    id: `${side}-ai`,
    side,
    title,
    rows: [
      row('Personality', ai.personalityId),
      row(
        'Difficulty profile',
        `${difficulty.id}: reaction ×${f(difficulty.reactionDelayMultiplier)}, error ×${f(difficulty.errorRateMultiplier)}, prediction ${f(difficulty.predictionStrength)}, adaptation ×${f(difficulty.adaptationMultiplier)}, Clash mash ×${f(difficulty.clashMashRateMultiplier)}`,
      ),
      row('Perception: opponent observed', vec2(ai.observedOpponentXZ)),
      row('Perception: opponent predicted', ai.predictedOpponentXZ ? vec2(ai.predictedOpponentXZ) : '—'),
      row('Perception: distance', `${f(ai.distanceToOpponentM)} m`),
      row('Target (aim point)', vec2(ai.aimPositionXZ)),
      row('Intent (active)', `${ai.activeIntent} — ${ai.activeIntentReason}`),
      row('Intent (ideal)', `${ai.idealIntent} — ${ai.idealIntentReason}`),
      row('Considered scores', ai.consideredScoresSummary),
      row('Selected action', ai.chosenActionSummary),
      row('Timers', `reaction ${f(ai.reactionTimerS)} s · pending ${ai.pendingIntent ?? '—'} in ${f(ai.pendingDelayRemainingS)} s`),
      row(
        'Risk values',
        `edge ${f(ai.edgeRiskFraction)} · threat ${f(ai.opponentThreatFraction)} · self-vuln ${f(ai.selfVulnerabilityFraction)} · opportunity ${f(ai.opportunityFraction)}`,
      ),
      row('Clash willingness', f(ai.clashWillingness)),
      row('Deliberate error this decision', String(ai.deliberateErrorApplied)),
      row('Dodge roll succeeds', String(ai.dodgeAttemptSucceeds)),
      row(
        'Adaptation',
        `aggression ${f(ai.observedOpponentAggressionFraction)} · dodge rate ${f(ai.observedOpponentDodgeRate)} · Dash pref ${f(ai.observedOpponentDashPreference)}`,
      ),
    ],
  };
}

function buildClashSection(session: MatchSession): InspectorSection {
  const clash = session.clash.controller;
  const state = clash.getState();
  const firstMash = clash.getFirstMashEventCount();
  const secondMash = clash.getSecondMashEventCount();
  const last = clash.getLastResult();
  const factors = (mash: number, stamina: number, speed: number): string =>
    `mash ${mash} → ${f(computeMashPerformance(mash))} · Stamina ×${f(computeStaminaFactor(stamina))} · velocity ×${f(computeVelocityFactor(speed))} · score ${f(computeClashPower(mash, stamina, speed))}`;
  return {
    id: 'clash',
    title: 'Clash',
    rows: [
      row('State', state),
      row('Availability', state === ClashState.Idle ? 'available' : state === ClashState.Active ? 'in progress' : 'on cooldown'),
      row('Active elapsed', `${f(clash.getElapsedS())} s`),
      row('Cooldown remaining', `${f(clash.getCooldownRemainingS())} s`),
      row('First', factors(firstMash, clash.getFirstStaminaFractionAtStart(), clash.getFirstSpeedMpsAtStart())),
      row('Second', factors(secondMash, clash.getSecondStaminaFractionAtStart(), clash.getSecondSpeedMpsAtStart())),
      row('Last result', last ? `${last.outcome}: ${f(last.firstClashPower)} vs ${f(last.secondClashPower)}` : 'none yet'),
      row('Impact multiplier (rule)', f(session.matchConfig.clashImpactMultiplier)),
    ],
  };
}

function buildCameraSection(session: MatchSession): InspectorSection {
  const camera = session.getLastCameraOutput();
  if (!camera) return { id: 'camera', title: 'Camera', rows: [row('Camera', 'no tick yet')] };
  const distance = Math.hypot(
    camera.cameraPositionM.x - camera.focusPositionM.x,
    camera.cameraPositionM.y - camera.focusPositionM.y,
    camera.cameraPositionM.z - camera.focusPositionM.z,
  );
  return {
    id: 'camera',
    title: 'Camera',
    rows: [
      row('Preset (player)', `${camera.preset} — ${CAMERA_PRESET_NAMES[camera.preset]}${camera.presetSwitch < 1 ? ` (switching ${f(camera.presetSwitch * 100)}%)` : ''}`),
      row('Active mode', `${camera.mode}${camera.isHitstopActive ? ' (hitstop)' : ''}`),
      row('Clash camera (forced B, no orbit)', camera.clashBlend > 0.001 ? `${f(camera.clashBlend * 100)}% on screen` : 'off'),
      row('FOV', `${f(camera.fovDeg)}° (impact punch ${f(camera.fovPunchDeg)}°)`),
      row('Target (focus)', vec3(camera.focusPositionM)),
      row('Distance (eye → focus)', `${f(distance)} m (director ${f(camera.distanceM)} m)`),
      row('Yaw / shoulder', `${f(camera.yawDeg)}° / ${camera.side > 0 ? 'right' : 'left'}`),
      row('Eye above player / behind player', eyeVsPlayerText(camera.cameraPositionM, session.getBey('first').body.translation())),
      row('Pitch (looking down)', `${f((Math.atan2(camera.cameraPositionM.y - camera.focusPositionM.y, Math.hypot(camera.cameraPositionM.x - camera.focusPositionM.x, camera.cameraPositionM.z - camera.focusPositionM.z)) * 180) / Math.PI)}°`),
      ...PRESET_IDS.map((id) => {
        const r = ARENA_CAMERA_RIGS[id];
        const p = PRESETS[id];
        return row(
          `Rig ${id}${id === camera.preset ? ' (active)' : ''}`,
          `distance ${f(r.minDistance)}–${f(r.maxDistance)} m (+${f(p.separationResponse)}/m past 3 m), up ${f(r.cameraHeight)} m, framing bias ${f(p.framingBias * 100)}%, opponent weight ${f(p.opponentWeight * 100)}%, FOV ${p.baseFov}–${p.maxFov}°, orbit ≤ ${p.orbitSpeed}°/s`,
        );
      }),
      row('Shake offset', vec3(camera.shakeOffsetM)),
      row('High-speed context', f(camera.highSpeedBlend)),
      row('Modifiers', camera.modifiers.length > 0 ? camera.modifiers.join(', ') : '—'),
    ],
  };
}

function buildPerformanceSection(session: MatchSession, frame: InspectionFrameStats): InspectorSection {
  const effects = session.getVfxManager().getActiveEffectCounts();
  return {
    id: 'performance',
    title: 'Performance',
    rows: [
      row('FPS', f(frame.fps)),
      row('Frame time', `${f(frame.frameTimeMs)} ms`),
      row('Physics step time (last tick)', `${f(session.getLastPhysicsStepTimeMs())} ms`),
      frame.renderTimeMs === null ? gap('Render time', 'not measured in this context') : row('Render time', `${f(frame.renderTimeMs)} ms`),
      row('Active particle bursts', `${effects.sparkBursts} spark, ${effects.landingBursts} landing`),
      frame.drawCalls === null ? gap('Draw calls', 'not measured in this context') : row('Draw calls / triangles', `${frame.drawCalls} / ${frame.triangles ?? 0}`),
    ],
  };
}

function buildTelemetrySection(session: MatchSession, frame: InspectionFrameStats): InspectorSection {
  const events = session.telemetry.getEvents();
  const last = session.telemetry.getLastEvent();
  return {
    id: 'telemetry',
    title: 'Replay / telemetry',
    rows: [
      row('Recorder state', `recording (ring buffer, ${events.length} retained)`),
      row('Last event', last ? `${last.kind} @ tick ${last.tick}` : 'none'),
      row('Event count', String(events.length)),
      row('Replay capture', session.isCapturingReplay() ? 'recording (ChaosBeyReplayV1)' : 'not recording'),
      row('Last state hash', `${session.getStateHash()} @ TicksCompleted ${session.getTickIndex()}`),
      row('Divergence state', frame.replayState ?? 'not replaying'),
    ],
  };
}

function anomalySummary(session: MatchSession): string {
  const found = session.getDetectedAnomalies();
  if (found.length === 0) return 'none';
  const last = found[found.length - 1]!;
  const invalid = found.filter((d) => d.severity === 'invalid-state').length;
  return `${found.length} (${invalid} invalid) — last: t${last.tick} ${last.side} ${last.kind}${last.knownIssue ? ` [known ${last.knownIssue}]` : ''}`;
}

function row(label: string, value: string): InspectorRow {
  return { label, value };
}

function gap(label: string, reason: string): InspectorRow {
  return { label, value: `UNSUPPORTED — ${reason}`, unsupported: true };
}

function f(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  return value.toFixed(Math.abs(value) >= 100 ? 1 : 3);
}

function seconds(value: number): string {
  return Number.isFinite(value) ? `${f(value)} s` : 'never';
}

function vec2(v: { x: number; z: number }): string {
  return `(${f(v.x)}, ${f(v.z)})`;
}

function vec3(v: { x: number; y: number; z: number }): string {
  return `(${f(v.x)}, ${f(v.y)}, ${f(v.z)})`;
}

function resource(r: { value: number; max: number }): string {
  return `${f(r.value)} / ${f(r.max)}`;
}

function localAxes(q: { x: number; y: number; z: number; w: number }): {
  right: { x: number; y: number; z: number };
  up: { x: number; y: number; z: number };
  forward: { x: number; y: number; z: number };
} {
  const { x, y, z, w } = q;
  return {
    right: { x: 1 - 2 * (y * y + z * z), y: 2 * (x * y + w * z), z: 2 * (x * z - w * y) },
    up: { x: 2 * (x * y - w * z), y: 1 - 2 * (x * x + z * z), z: 2 * (y * z + w * x) },
    forward: { x: 2 * (x * z + w * y), y: 2 * (y * z - w * x), z: 1 - 2 * (x * x + y * y) },
  };
}

/** M11 directional control: the desired world direction and its yaw, or "classic" for a steer/throttle frame. */
function desiredInput(intent: { x: number; z: number } | undefined): string {
  if (!intent) return 'classic (steer/throttle)';
  const len = Math.hypot(intent.x, intent.z);
  return len < 1e-3 ? 'none (0)' : `(${f(intent.x)}, ${f(intent.z)}) → ${f(Math.atan2(intent.x, intent.z) * RAD_TO_DEG)}°, |${f(len)}|`;
}

/**
 * Shown purely so the reader can confirm Desired input above never tracks
 * it — screenToWorld() takes no camera parameter at all, and src/input/
 * has no camera dependency to read here even if it wanted to (see
 * DirectionalController.ts's header). Read directly from CameraDirector's
 * own output, never through any controller.
 */
function cameraYawDiagnostic(session: MatchSession): string {
  const camera = session.getLastCameraOutput();
  return camera ? `${f(camera.yawDeg)}°` : '—';
}

/** M11 lane 4: the floor under this Bey (profile, height, slope, downhill pull). */
function floorRows(floor: ArenaFloorId, position: { x: number; y: number; z: number }): ReturnType<typeof row>[] {
  const r = floorReadout(floor, position);
  return [
    row('Floor profile', ARENA_FLOORS[floor].label),
    row('Floor height under / above it', `${f(r.floorHeightM)} m / ${f(r.heightAboveFloorM)} m`),
    row('Floor slope / normal', `${f(r.slopeDeg)}° / (${f(r.normal.x)}, ${f(r.normal.y)}, ${f(r.normal.z)})`),
    row('Downhill pull (g·sin slope)', `${f(r.downhillPullMps2)} m/s² toward the centre`),
  ];
}

function velocityDirectionText(v: { x: number; z: number }): string {
  return Math.hypot(v.x, v.z) < 0.05 ? '— (at rest)' : `${((Math.atan2(v.x, v.z) * 180) / Math.PI).toFixed(1)}°`;
}

function headingMinusVelocityText(headingRad: number, v: { x: number; z: number }): string {
  if (Math.hypot(v.x, v.z) < 0.05) return '— (at rest)';
  const d = headingRad - Math.atan2(v.x, v.z);
  return `${((Math.atan2(Math.sin(d), Math.cos(d)) * 180) / Math.PI).toFixed(1)}°`;
}

function eyeVsPlayerText(eye: { x: number; y: number; z: number }, player: { x: number; y: number; z: number }): string {
  return `${(eye.y - player.y).toFixed(2)} m / ${Math.hypot(eye.x - player.x, eye.z - player.z).toFixed(2)} m`;
}
