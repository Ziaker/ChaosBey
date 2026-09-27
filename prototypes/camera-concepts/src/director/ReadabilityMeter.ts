// ============================================================
// CAMERA LAB — READABILITY METER
// Measures, per run, the things GDD 49 forbids a spectacular camera from
// breaking: is the opponent (and the player) in frame, does the camera go
// under the floor, how fast does it turn, how often does it change side,
// does the FOV stay under 120°. Shown live in the lab and asserted in the
// unit tests for every preset × scenario.
// ============================================================

import type { FightFrame } from '../fight/FightFrame';
import type { DirectorOutput } from './CameraDirector';
import { angleDelta, inFrame } from './frameMath';

const FRAME_MARGIN = 0.02;

export interface ReadabilitySummary {
  /** Seconds of play measured (round-over time excluded). */
  seconds: number;
  /** Fraction of play time each Bey was inside the frame. */
  playerInFrame: number;
  opponentInFrame: number;
  /** Longest continuous stretch with the opponent out of frame (s). */
  longestOpponentGapS: number;
  minEyeHeight: number;
  maxFov: number;
  /** Highest yaw speed over any 0.25 s window (°/s). */
  maxYawRateDegS: number;
  /** Highest FOV change speed over any 0.25 s window (°/s). */
  maxFovRateDegS: number;
  sideSwitches: number;
  maxSideSwitchesIn5s: number;
}

export class ReadabilityMeter {
  private seconds = 0;
  private playerIn = 0;
  private opponentIn = 0;
  private gap = 0;
  private longestGap = 0;
  private minEye = Infinity;
  private maxFov = 0;
  private maxYawRate = 0;
  private maxFovRate = 0;
  private readonly yawHistory: number[] = [];
  private readonly fovHistory: number[] = [];
  private readonly switchTimes: number[] = [];
  private lastSwitches = 0;
  private maxIn5 = 0;
  private time = 0;

  constructor(private readonly aspect = 16 / 9) {}

  add(frame: FightFrame, out: DirectorOutput, dt: number): void {
    this.time += dt;
    const eye = out.eye;
    this.minEye = Math.min(this.minEye, eye.y);
    this.maxFov = Math.max(this.maxFov, out.fov);
    const window = Math.round(0.25 / dt);
    this.yawHistory.push(out.debug.yawDeg);
    this.fovHistory.push(out.fov);
    if (this.yawHistory.length > window) {
      const oldYaw = this.yawHistory.shift()!;
      const oldFov = this.fovHistory.shift()!;
      const dYaw = Math.abs(angleDelta(oldYaw * (Math.PI / 180), out.debug.yawDeg * (Math.PI / 180))) * (180 / Math.PI);
      this.maxYawRate = Math.max(this.maxYawRate, dYaw / (window * dt));
      this.maxFovRate = Math.max(this.maxFovRate, Math.abs(out.fov - oldFov) / (window * dt));
    }
    if (out.debug.sideSwitches > this.lastSwitches) {
      this.switchTimes.push(this.time);
      this.lastSwitches = out.debug.sideSwitches;
    }
    while (this.switchTimes.length > 0 && this.time - this.switchTimes[0]! > 5) this.switchTimes.shift();
    this.maxIn5 = Math.max(this.maxIn5, this.switchTimes.length);
    if (frame.roundOver) return;
    this.seconds += dt;
    if (inFrame(frame.first.position, eye, out.focus, out.fov, this.aspect, FRAME_MARGIN)) this.playerIn += dt;
    if (inFrame(frame.second.position, eye, out.focus, out.fov, this.aspect, FRAME_MARGIN)) {
      this.opponentIn += dt;
      this.gap = 0;
    } else {
      this.gap += dt;
      this.longestGap = Math.max(this.longestGap, this.gap);
    }
  }

  get summary(): ReadabilitySummary {
    const s = Math.max(1e-6, this.seconds);
    return {
      seconds: this.seconds,
      playerInFrame: this.playerIn / s,
      opponentInFrame: this.opponentIn / s,
      longestOpponentGapS: this.longestGap,
      minEyeHeight: this.minEye,
      maxFov: this.maxFov,
      maxYawRateDegS: this.maxYawRate,
      maxFovRateDegS: this.maxFovRate,
      sideSwitches: this.lastSwitches,
      maxSideSwitchesIn5s: this.maxIn5,
    };
  }
}
