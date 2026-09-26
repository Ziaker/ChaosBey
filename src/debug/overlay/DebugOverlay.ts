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
  slipAngleRad: number;
  lateralGripPerS: number;
  longitudinalDragPerS: number;
  grounded: boolean;
  driftState: string;
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

  // Camera/game-feel (Milestone 4, GDD section 50+).
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
}

const RAD_TO_DEG = 180 / Math.PI;

function fmtVec2(v: Vec2): string {
  return `(${v.x.toFixed(2)}, ${v.z.toFixed(2)})`;
}

function fmtVec3(v: { x: number; y: number; z: number }): string {
  return `(${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)})`;
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
      `slip angle       ${(state.slipAngleRad * RAD_TO_DEG).toFixed(1)} deg\n` +
      `lateral grip     ${state.lateralGripPerS.toFixed(2)} /s\n` +
      `longitudinal drag ${state.longitudinalDragPerS.toFixed(2)} /s\n` +
      `grounded         ${state.grounded}\n` +
      `drift state      ${state.driftState}\n` +
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
      `-- camera (M4) --\n` +
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
      `impact multiplier ${state.clashImpactMultiplier.toFixed(2)}`;
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
