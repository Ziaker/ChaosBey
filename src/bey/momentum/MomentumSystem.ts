// ============================================================
// MOMENTUM SYSTEM (owner, 2026-10-02, Lote 3) — see MomentumTuning.ts.
// Pure per-Bey gameplay state, ticked by tickMatch after the physics step.
// ============================================================

import type { CanonicalRecord } from '../../replay/state/CanonicalValue';
import { MOMENTUM_BUILD_MIN_SPEED_FRACTION, MOMENTUM_SHARP_TURN_RAD_PER_S } from './MomentumTuning';

export interface MomentumRules {
  readonly momentumGain: number;
  readonly momentumFillS: number;
  readonly momentumDecayS: number;
  readonly momentumLossOnCollision: number;
}

export class MomentumSystem {
  private momentum = 0;
  private lastHeadingRad: number | null = null;
  /** Seconds before another body collision may resolve (the pair's cooldown, kept on both Beys). */
  private bodyCollisionCooldownS = 0;
  /** Audit B5: a body collision happened and the Beys have not separated since (one collision per contact). */
  private bodyContactLatched = false;

  constructor(private readonly rules: MomentumRules) {}

  /** 0..1. */
  get value(): number {
    return this.momentum;
  }

  /** Top speed multiplier: 1 + momentum × gain. */
  get topSpeedMultiplier(): number {
    return 1 + this.momentum * this.rules.momentumGain;
  }

  get collisionCooldownRemainingS(): number {
    return this.bodyCollisionCooldownS;
  }

  /**
   * speedMps: the Bey's horizontal speed this tick; topSpeedMps: its current top speed (momentum included);
   * headingRad: its velocity direction (null when nearly still). Builds over momentumFillS of sustained fast,
   * straight-ish movement on the ground; drains over momentumDecayS otherwise.
   */
  tick(speedMps: number, topSpeedMps: number, headingRad: number | null, grounded: boolean, fixedDeltaSeconds: number): void {
    this.bodyCollisionCooldownS = Math.max(0, this.bodyCollisionCooldownS - fixedDeltaSeconds);
    let turnRate = 0;
    if (headingRad !== null && this.lastHeadingRad !== null) {
      let d = headingRad - this.lastHeadingRad;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      turnRate = Math.abs(d) / fixedDeltaSeconds;
    }
    this.lastHeadingRad = headingRad;
    const fastEnough = speedMps >= MOMENTUM_BUILD_MIN_SPEED_FRACTION * topSpeedMps;
    const straightEnough = turnRate <= MOMENTUM_SHARP_TURN_RAD_PER_S;
    // In the air momentum holds: a hop is not a brake.
    if (!grounded) return;
    if (fastEnough && straightEnough) this.momentum = Math.min(1, this.momentum + fixedDeltaSeconds / Math.max(1e-6, this.rules.momentumFillS));
    else this.momentum = Math.max(0, this.momentum - fixedDeltaSeconds / Math.max(1e-6, this.rules.momentumDecayS));
    // A whole number of ticks reaches full / empty exactly, not one float step short.
    if (this.momentum > 1 - 1e-9) this.momentum = 1;
    else if (this.momentum < 1e-9) this.momentum = 0;
  }

  /** A hit taken, a wall impact, or being the faster Bey in a body collision: lose momentumLossOnCollision of it. */
  loseOnCollision(): void {
    this.momentum *= 1 - this.rules.momentumLossOnCollision;
  }

  startCollisionCooldown(seconds: number): void {
    this.bodyCollisionCooldownS = seconds;
    this.bodyContactLatched = true;
  }

  /** The Beys have really separated: the next contact can be a collision again (after the cooldown). */
  releaseBodyContact(): void {
    this.bodyContactLatched = false;
  }

  get isBodyContactLatched(): boolean {
    return this.bodyContactLatched;
  }

  /** Debug Lab only. */
  debugSet(value: number): void {
    this.momentum = Math.max(0, Math.min(1, value));
  }

  /** Read-only: this system's part of CanonicalMatchStateV1 (M9 state hash). */
  getDeterministicState(): CanonicalRecord {
    return { momentum: this.momentum, lastHeadingRad: this.lastHeadingRad, bodyCollisionCooldownS: this.bodyCollisionCooldownS, bodyContactLatched: this.bodyContactLatched };
  }
}
