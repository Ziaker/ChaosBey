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

  // Rotational (GDD section 17/122).
  angularVelocity: { x: number; y: number; z: number };
  spinRateRadPerSec: number;
  tiltRad: number;
  wobbleEnergy: number;
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
      `-- rotational --\n` +
      `angular velocity ${fmtVec3(state.angularVelocity)}\n` +
      `spin rate        ${state.spinRateRadPerSec.toFixed(2)} rad/s\n` +
      `tilt             ${(state.tiltRad * RAD_TO_DEG).toFixed(1)} deg\n` +
      `wobble energy    ${state.wobbleEnergy.toFixed(2)}`;
  }

  private applyVisibility(): void {
    this.root.style.display = this.visible ? 'block' : 'none';
  }
}
