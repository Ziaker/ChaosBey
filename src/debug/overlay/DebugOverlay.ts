// ============================================================
// DEBUG OVERLAY
// First-class debug tooling per GDD section 1.2. Milestone 1 adds the
// translational/rotational physics inspectors GDD section 122/150 calls
// for while the movement prototype is being tuned. Combat/AI inspectors
// (GDD section 69) are added milestone by milestone.
// Rendering-only: must never mutate simulation state by being visible
// (GDD section 160).
// ============================================================

import type { Vec2 } from '../../physics/Vec2';
import type { InputLockReason } from '../inputLockReason';

export interface DebugOverlayState {
  fps: number;
  frameTimeMs: number;
  physicsStepTimeMs: number;
  tickIndex: number;
  seedText: string;
  gameState: string;

  // Translational (GDD section 17/122).
  intendedSteeringVector: Vec2;
  actualVelocityVector: Vec2;
  speedMps: number;
  headingRad: number;
  /** M11: the player's desired world direction (directional control), null under classic control. Debug only — never drawn in the game view. */
  desiredMoveIntent: Vec2 | null;
  /** "Directional" or "Classic" (PlayerSettings.controlScheme as actually wired, not just the saved setting). */
  controlSchemeLabel: string;
  /** The camera's current yaw in degrees, shown ONLY as a display-only diagnostic next to desiredMoveIntent — the camera is downstream presentation and the two must never move together. Null when the player's side isn't running DirectionalController (e.g. Classic, or an AI/scripted side). */
  cameraYawDeg: number | null;
  /** Owner of the 'first' (player) side's controller this tick: 'HUMAN' or 'AI' (Debug Lab can assign either side to AI). */
  firstControllerOwner: 'HUMAN' | 'AI';
  /** Why player input is (or isn't) restricted right now — never a bare "0" with no reason. 'none' means input is fully authoritative. */
  inputLockReason: InputLockReason;
  /** M11 lane 4: e.g. "Bowl A — Parabolic dish · h 1.20 m · slope 12.3° · pull 2.10 m/s²". */
  floorLine: string;
  slipAngleRad: number;
  lateralGripPerS: number;
  longitudinalDragPerS: number;
  grounded: boolean;
  driftState: string;
  /** JumpDrift (X) held this tick. */
  jumpDriftHeld: boolean;
  dodgeState: string;

  // Rotational (GDD section 17/122).
  angularVelocity: { x: number; y: number; z: number };
  spinRateRadPerSec: number;
  tiltRad: number;
  wobbleEnergy: number;

  // Combat (GDD section 69/122) — first Bey (player) in full, second
  // (opponent) summarized. Milestone 2 foundation only.
  firstAttackState: string;
  firstDashChargeFraction: number;
  firstStaminaFraction: number;
  firstStabilityFraction: number;
  firstIsBroken: boolean;
  firstAttackEnergyFraction: number;
  secondAttackState: string;
  secondStaminaFraction: number;
  secondStabilityFraction: number;
  secondIsBroken: boolean;
  roundResult: string;

  // Camera/game-feel (Milestone 4, GDD section 50+; director M11).
  /** e.g. "B Cinematic Hybrid · CloseCombat". */
  cameraPresetMode: string;
  /** 0..1 share of the forced Clash camera (B, no orbit) on screen. */
  cameraClashBlend: number;
  cameraFovDeg: number;
  cameraShakeOffsetM: { x: number; y: number; z: number };
  isHitstopActive: boolean;
  hitstopRemainingS: number;
  cameraHighSpeedBlend: number;

  // Clash (Milestone 5, GDD section 152).
  clashState: string;
  clashElapsedS: number;
  clashCooldownRemainingS: number;
  clashOutcome: string;
  firstClashMashEventCount: number;
  secondClashMashEventCount: number;
  firstClashMashPerformance: number;
  firstClashStaminaFactor: number;
  firstClashVelocityFactor: number;
  firstClashPower: number;
  secondClashMashPerformance: number;
  secondClashStaminaFactor: number;
  secondClashVelocityFactor: number;
  secondClashPower: number;
  /** MatchConfig's resolved value (default, or a pre-match override) — never ClashTuning's default constant directly, so this always reflects what orchestration is actually using. */
  clashImpactMultiplier: number;

  // AI (Milestone 7, GDD section 65/69) — the "second" combatant's
  // AIController, when one is driving it. Null fields mean no AI is
  // currently attached (e.g. self-tests driving both sides by hand).
  aiDebug: {
    personalityId: string;
    difficultyProfileId: string;
    idealIntent: string;
    idealIntentReason: string;
    consideredScoresSummary: string;
    activeIntent: string;
    activeIntentReason: string;
    deliberateErrorApplied: boolean;
    dodgeAttemptSucceeds: boolean;
    distanceToOpponentM: number;
    observedOpponentXZ: { x: number; z: number };
    predictedOpponentXZ: { x: number; z: number } | null;
    aimPositionXZ: { x: number; z: number };
    predictionHorizonS: number;
    predictionStrength: number;
    edgeRiskFraction: number;
    opponentThreatFraction: number;
    selfVulnerabilityFraction: number;
    opportunityFraction: number;
    reactionTimerS: number;
    pendingIntent: string | null;
    pendingDelayRemainingS: number;
    chosenActionSummary: string;
    observedOpponentAggressionFraction: number;
    observedOpponentDodgeRate: number;
    observedOpponentDashPreference: number;
  } | null;
}

const RAD_TO_DEG = 180 / Math.PI;

function fmtVec2(v: Vec2): string {
  return `(${v.x.toFixed(2)}, ${v.z.toFixed(2)})`;
}

function fmtVec3(v: { x: number; y: number; z: number }): string {
  return `(${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)})`;
}

/** Signed angle (rad) from the velocity's direction to the heading, −π..π (fromYaw convention: forward = (sin, cos)). */
function headingVsVelocityRad(headingRad: number, velocity: Vec2): number {
  const d = headingRad - Math.atan2(velocity.x, velocity.z);
  return Math.atan2(Math.sin(d), Math.cos(d));
}

export class DebugOverlay {
  private readonly root: HTMLElement;
  private visible: boolean;

  constructor(mountPoint: HTMLElement, initiallyVisible: boolean) {
    this.root = document.createElement('pre');
    this.root.style.cssText = [
      'margin:0',
      'padding:8px 12px',
      'font:12px/1.5 ui-monospace, "SF Mono", Consolas, monospace',
      'color:#8fffb0',
      'background:rgba(0,0,0,0.55)',
      'white-space:pre',
    ].join(';');
    mountPoint.appendChild(this.root);
    this.visible = initiallyVisible;
    this.applyVisibility();
  }

  toggle(): void {
    this.visible = !this.visible;
    this.applyVisibility();
  }

  update(state: DebugOverlayState): void {
    if (!this.visible) return;
    this.root.textContent =
      `ChaosBey — DEBUG (F3 to toggle)\n` +
      `state            ${state.gameState}\n` +
      `tick             ${state.tickIndex}\n` +
      `seed             ${state.seedText}\n` +
      `fps              ${state.fps.toFixed(0)}\n` +
      `frame ms         ${state.frameTimeMs.toFixed(2)}\n` +
      `physics ms       ${state.physicsStepTimeMs.toFixed(2)}\n` +
      `-- translational --\n` +
      `intended steer   ${fmtVec2(state.intendedSteeringVector)}\n` +
      `actual velocity  ${fmtVec2(state.actualVelocityVector)}\n` +
      `speed            ${state.speedMps.toFixed(2)} m/s\n` +
      `heading          ${(state.headingRad * RAD_TO_DEG).toFixed(1)} deg\n` +
      `control scheme   ${state.controlSchemeLabel} · owner ${state.firstControllerOwner}\n` +
      `desired input    ${state.desiredMoveIntent ? `${fmtVec2(state.desiredMoveIntent)} ${fmtIntentAngle(state.desiredMoveIntent)}` : 'classic (steer/throttle)'}\n` +
      `camera yaw       ${state.cameraYawDeg === null ? '—' : `${state.cameraYawDeg.toFixed(1)} deg (must never move with desired input above)`}\n` +
      `input lock       ${state.inputLockReason}\n` +
      `slip angle       ${(state.slipAngleRad * RAD_TO_DEG).toFixed(1)} deg\n` +
      `floor            ${state.floorLine}\n` +
      `lateral grip     ${state.lateralGripPerS.toFixed(2)} /s\n` +
      `longitudinal drag ${state.longitudinalDragPerS.toFixed(2)} /s\n` +
      `grounded         ${state.grounded}\n` +
      `-- drift --\n` +
      `drift state      ${state.driftState}${state.driftState === 'Drifting' ? '  <<< DRIFT' : ''}\n` +
      `X held           ${state.jumpDriftHeld}\n` +
      `velocity dir     ${state.speedMps > 0.05 ? `${(Math.atan2(state.actualVelocityVector.x, state.actualVelocityVector.z) * RAD_TO_DEG).toFixed(1)} deg` : '—'}\n` +
      `heading - vel    ${state.speedMps > 0.05 ? `${(headingVsVelocityRad(state.headingRad, state.actualVelocityVector) * RAD_TO_DEG).toFixed(1)} deg` : '—'}\n` +
      `dodge state      ${state.dodgeState}\n` +
      `-- rotational --\n` +
      `angular velocity ${fmtVec3(state.angularVelocity)}\n` +
      `spin rate        ${state.spinRateRadPerSec.toFixed(2)} rad/s\n` +
      `tilt             ${(state.tiltRad * RAD_TO_DEG).toFixed(1)} deg\n` +
      `wobble energy    ${state.wobbleEnergy.toFixed(2)}\n` +
      `-- combat: first (player) --\n` +
      `attack state     ${state.firstAttackState}\n` +
      `dash charge      ${(state.firstDashChargeFraction * 100).toFixed(0)}%\n` +
      `stamina          ${(state.firstStaminaFraction * 100).toFixed(0)}%\n` +
      `stability        ${(state.firstStabilityFraction * 100).toFixed(0)}%${state.firstIsBroken ? ' BROKEN' : ''}\n` +
      `attack energy    ${(state.firstAttackEnergyFraction * 100).toFixed(0)}%\n` +
      `-- combat: second (opponent) --\n` +
      `attack state     ${state.secondAttackState}\n` +
      `stamina          ${(state.secondStaminaFraction * 100).toFixed(0)}%\n` +
      `stability        ${(state.secondStabilityFraction * 100).toFixed(0)}%${state.secondIsBroken ? ' BROKEN' : ''}\n` +
      `round            ${state.roundResult}\n` +
      `-- camera --\n` +
      `preset · mode    ${state.cameraPresetMode}\n` +
      `clash camera B   ${state.cameraClashBlend > 0.001 ? `${(state.cameraClashBlend * 100).toFixed(0)}% (no orbit)` : 'off'}\n` +
      `fov              ${state.cameraFovDeg.toFixed(1)} deg\n` +
      `shake offset     ${fmtVec3(state.cameraShakeOffsetM)}\n` +
      `hitstop          ${state.isHitstopActive ? `ACTIVE (${state.hitstopRemainingS.toFixed(3)}s left)` : 'idle'}\n` +
      `high-speed blend ${(state.cameraHighSpeedBlend * 100).toFixed(0)}%\n` +
      `-- clash (M5) --\n` +
      `state            ${state.clashState}` +
      `${state.clashState === 'Active' ? ` (${state.clashElapsedS.toFixed(2)}s)` : ''}` +
      `${state.clashState === 'Cooldown' ? ` (${state.clashCooldownRemainingS.toFixed(1)}s left)` : ''}\n` +
      `last outcome     ${state.clashOutcome}\n` +
      `mash counts      first ${state.firstClashMashEventCount} / second ${state.secondClashMashEventCount}\n` +
      `first factors    mash ${state.firstClashMashPerformance.toFixed(2)} stamina ${state.firstClashStaminaFactor.toFixed(2)} velocity ${state.firstClashVelocityFactor.toFixed(2)} -> power ${state.firstClashPower.toFixed(3)}\n` +
      `second factors   mash ${state.secondClashMashPerformance.toFixed(2)} stamina ${state.secondClashStaminaFactor.toFixed(2)} velocity ${state.secondClashVelocityFactor.toFixed(2)} -> power ${state.secondClashPower.toFixed(3)}\n` +
      `impact multiplier ${state.clashImpactMultiplier.toFixed(2)}\n` +
      (state.aiDebug
        ? `-- ai (second, M7) --\n` +
          `personality      ${state.aiDebug.personalityId} / difficulty ${state.aiDebug.difficultyProfileId}\n` +
          `ideal intent     ${state.aiDebug.idealIntent} (${state.aiDebug.idealIntentReason})\n` +
          `scores           ${state.aiDebug.consideredScoresSummary}\n` +
          `active intent    ${state.aiDebug.activeIntent}${state.aiDebug.deliberateErrorApplied ? ' [DELIBERATE ERROR]' : ''} (${state.aiDebug.activeIntentReason})\n` +
          `dodge roll       ${state.aiDebug.activeIntent === 'DodgeThreat' ? (state.aiDebug.dodgeAttemptSucceeds ? 'succeeds' : 'fails') : '-'}\n` +
          `distance         ${state.aiDebug.distanceToOpponentM.toFixed(2)} m\n` +
          `target / aim     observed (${state.aiDebug.observedOpponentXZ.x.toFixed(1)}, ${state.aiDebug.observedOpponentXZ.z.toFixed(1)}) -> aim (${state.aiDebug.aimPositionXZ.x.toFixed(1)}, ${state.aiDebug.aimPositionXZ.z.toFixed(1)})\n` +
          `prediction       ${state.aiDebug.predictedOpponentXZ ? `(${state.aiDebug.predictedOpponentXZ.x.toFixed(1)}, ${state.aiDebug.predictedOpponentXZ.z.toFixed(1)}) in ${state.aiDebug.predictionHorizonS.toFixed(2)} s, trusted x${state.aiDebug.predictionStrength.toFixed(2)}` : 'off (aims at the observed position)'}\n` +
          `risk             edge ${state.aiDebug.edgeRiskFraction.toFixed(2)} opponentThreat ${state.aiDebug.opponentThreatFraction.toFixed(2)} selfVuln ${state.aiDebug.selfVulnerabilityFraction.toFixed(2)} opportunity ${state.aiDebug.opportunityFraction.toFixed(2)}\n` +
          `reaction timer   ${state.aiDebug.reactionTimerS.toFixed(2)} s\n` +
          `late reaction    ${state.aiDebug.pendingIntent ? `${state.aiDebug.pendingIntent} in ${state.aiDebug.pendingDelayRemainingS.toFixed(2)} s` : '-'}\n` +
          `action           ${state.aiDebug.chosenActionSummary}\n` +
          `adaptation       aggression~${state.aiDebug.observedOpponentAggressionFraction.toFixed(2)} dodge~${state.aiDebug.observedOpponentDodgeRate.toFixed(2)} dashPref~${state.aiDebug.observedOpponentDashPreference.toFixed(2)}`
        : `-- ai (second, M7) --\n(no AIController attached)`);
  }

  /**
   * A fatal error halted the simulation (GDD section 117: errors must be
   * visible in the debug overlay, not only the console). Forces the
   * overlay visible — the loop that would refresh it has stopped — and
   * keeps the last rendered state below the message for context.
   */
  showFatalError(message: string): void {
    this.visible = true;
    this.applyVisibility();
    this.root.textContent = `!! ${message}\n!! (stack in the browser console and telemetry)\n\n${this.root.textContent ?? ''}`;
  }

  private applyVisibility(): void {
    this.root.style.display = this.visible ? 'block' : 'none';
  }
}

/** A desired direction's length and yaw (same convention as heading), e.g. "|1.00| 90.0 deg". */
function fmtIntentAngle(v: Vec2): string {
  const len = Math.hypot(v.x, v.z);
  return len < 1e-3 ? '|0.00|' : `|${len.toFixed(2)}| ${(Math.atan2(v.x, v.z) * RAD_TO_DEG).toFixed(1)} deg`;
}
