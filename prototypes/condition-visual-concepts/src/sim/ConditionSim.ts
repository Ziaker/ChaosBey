// ============================================================
// STAMINA & STABILITY LAB — CONDITION SIMULATION
// The single source of truth every visual reads: Stamina, Stability, the
// Broken state and the spin-out, plus the discrete events that change them
// (hit, break, recover, spin-out, reset).
//
// This is CHOREOGRAPHY for a visual prototype, not the game's rules. The
// damage numbers, recovery delay and the scripted fight below exist only so
// every visual state shows up in a repeatable order. Stability/Stamina
// rules in the game live in src/bey/stability and src/bey/stamina.
//
// Three modes:
//   auto   — a scripted ~40 s fight that loops: hits, a break, recovery,
//            a second break, recovery, stamina runs out, spin-out.
//   manual — the owner drives Stamina/Stability with sliders and buttons.
//   hold   — values sit at a fixed preset (the ladder views); hits still
//            react and then the values ease back to the preset.
// ============================================================

// ---------------- DEMO CHOREOGRAPHY TUNING ----------------
/** Stability lost per hit (0–1 scale). */
export const HIT_STABILITY_LOSS: Readonly<Record<HitStrength, number>> = { light: 0.15, medium: 0.27, heavy: 0.45 };
/** Stamina lost per hit (0–1 scale). Small: Stamina is the long-term resource. */
const HIT_STAMINA_LOSS: Readonly<Record<HitStrength, number>> = { light: 0.01, medium: 0.02, heavy: 0.03 };
/** Impact magnitude (0–1) handed to the visuals for each hit strength. */
export const HIT_MAGNITUDE: Readonly<Record<HitStrength, number>> = { light: 0.35, medium: 0.62, heavy: 1 };
/** Seconds between a hit being scheduled and landing, so the opponent can dash in. */
export const HIT_LEAD_SECONDS = 0.45;
/** Seconds without a hit before Stability starts coming back (auto/hold). */
const RECOVERY_DELAY_S = 3.5;
/** Stability regained per second once recovery runs (auto). */
const RECOVERY_RATE_PER_S = 0.08;
/** A broken Bey is re-seated (no longer broken) once Stability climbs back to this. */
export const BROKEN_CLEAR_AT = 0.3;
/** Auto mode: Stamina drained per second (tuned so it runs out around t ≈ 35 s). */
const AUTO_STAMINA_DRAIN_PER_S = 0.0245;
/** Seconds the Bey lies still after a spin-out before the auto fight restarts. */
const DOWN_HOLD_S = 2.2;
/** Hold mode: how fast values return to the preset after a hit (per second). */
const HOLD_RETURN_PER_S = 0.35;

/** Auto fight script: when each hit lands (seconds) and how hard. */
export const AUTO_HITS: ReadonlyArray<{ readonly t: number; readonly strength: HitStrength }> = [
  { t: 2.5, strength: 'light' },
  { t: 5, strength: 'medium' },
  { t: 7.5, strength: 'medium' },
  { t: 10, strength: 'heavy' },
  { t: 19, strength: 'medium' },
  { t: 22, strength: 'light' },
  { t: 26, strength: 'medium' },
];
// -----------------------------------------------------------

export type HitStrength = 'light' | 'medium' | 'heavy';
export type SimMode = 'auto' | 'manual' | 'hold';

export type ConditionEvent =
  | { readonly kind: 'hit'; readonly strength: HitStrength; readonly magnitude: number; readonly dirAngle: number; readonly stabilityBefore: number }
  | { readonly kind: 'break' }
  | { readonly kind: 'recover' }
  | { readonly kind: 'spinOut' }
  | { readonly kind: 'down' }
  | { readonly kind: 'reset' };

export interface PendingHit {
  readonly at: number;
  readonly strength: HitStrength;
  /** World angle (radians, XZ plane) from the target toward the attacker. */
  readonly dirAngle: number;
}

export interface ConditionState {
  /** Sim clock (seconds). Restarts at 0 on reset. */
  readonly time: number;
  readonly stamina: number;
  readonly stability: number;
  readonly broken: boolean;
  /** Seconds since the last landed hit (large when none). */
  readonly sinceHit: number;
  /** 0 = spinning normally; 0..1 = collapsing; 1 = down. */
  readonly spinOut: number;
  readonly down: boolean;
  /** The next scheduled hit, if any (the opponent dashes toward it). */
  readonly pendingHit: PendingHit | null;
  /** The hit that landed most recently, if any. */
  readonly lastHit: PendingHit | null;
}

/** Small deterministic PRNG so every view that shares a sim sees the same hits. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

export class ConditionSim {
  private t = 0;
  private stamina = 1;
  private stability = 1;
  private broken = false;
  private sinceHit = 99;
  private spinOutProgress = 0;
  private spinningOut = false;
  private downFor = 0;
  private pending: PendingHit[] = [];
  private lastHit: PendingHit | null = null;
  private autoHitIndex = 0;
  private readonly rng: () => number;
  private events: ConditionEvent[] = [];

  /** Hold-mode targets. */
  private holdStamina = 1;
  private holdStability = 1;
  private holdBroken = false;

  constructor(
    public mode: SimMode,
    seed = 7,
    /** Returns the current spin-out duration (seconds) — read live from tuning. */
    private readonly spinOutSeconds: () => number = () => 3,
  ) {
    this.rng = mulberry32(seed);
  }

  get state(): ConditionState {
    return {
      time: this.t,
      stamina: this.stamina,
      stability: this.stability,
      broken: this.broken,
      sinceHit: this.sinceHit,
      spinOut: this.spinOutProgress,
      down: this.spinOutProgress >= 1,
      pendingHit: this.pending[0] ?? null,
      lastHit: this.lastHit,
    };
  }

  /** Ladder presets: fix the values this sim returns to. */
  setHold(stamina: number, stability: number, broken: boolean): void {
    this.mode = 'hold';
    this.holdStamina = clamp01(stamina);
    this.holdStability = broken ? 0 : clamp01(stability);
    this.holdBroken = broken;
    this.stamina = this.holdStamina;
    this.stability = this.holdStability;
    this.broken = broken;
  }

  setMode(mode: SimMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    if (mode === 'auto') this.reset();
  }

  /** Manual slider: Stamina 0..1. Reaching 0 starts the spin-out. */
  setStamina(v: number): void {
    this.stamina = clamp01(v);
    if (this.stamina > 0 && (this.spinningOut || this.spinOutProgress > 0)) {
      // Pulling the slider back up revives a spun-out Bey (manual only).
      this.spinningOut = false;
      this.spinOutProgress = 0;
      this.downFor = 0;
      this.events.push({ kind: 'reset' });
    }
  }

  /** Manual slider: Stability 0..1. 0 breaks; climbing back past BROKEN_CLEAR_AT re-seats. */
  setStability(v: number): void {
    this.stability = clamp01(v);
    if (this.stability <= 0 && !this.broken) this.doBreak();
    else if (this.broken && this.stability >= BROKEN_CLEAR_AT) this.doRecover();
  }

  /** Schedule a hit; it lands HIT_LEAD_SECONDS later. */
  scheduleHit(strength: HitStrength): void {
    if (this.spinningOut || this.spinOutProgress > 0) return;
    const at = this.t + HIT_LEAD_SECONDS;
    this.pending.push({ at, strength, dirAngle: this.rng() * Math.PI * 2 });
  }

  forceBreak(): void {
    if (this.spinOutProgress > 0) return;
    this.stability = 0;
    if (!this.broken) this.doBreak();
  }

  forceRecover(): void {
    if (!this.broken) {
      this.stability = Math.max(this.stability, 0.6);
      return;
    }
    this.stability = Math.max(this.stability, BROKEN_CLEAR_AT + 0.05);
    this.doRecover();
  }

  forceSpinOut(): void {
    this.stamina = 0;
    this.startSpinOut();
  }

  reset(): void {
    this.t = 0;
    this.autoHitIndex = 0;
    this.pending = [];
    this.lastHit = null;
    this.sinceHit = 99;
    this.spinningOut = false;
    this.spinOutProgress = 0;
    this.downFor = 0;
    if (this.mode === 'hold') {
      this.stamina = this.holdStamina;
      this.stability = this.holdStability;
      this.broken = this.holdBroken;
    } else {
      this.stamina = 1;
      this.stability = 1;
      this.broken = false;
    }
    this.events.push({ kind: 'reset' });
  }

  /** Advance the sim. Returns the events that happened during this step. */
  step(dt: number): ConditionEvent[] {
    if (dt > 0) this.advance(dt);
    const result = this.events;
    this.events = [];
    return result;
  }

  private advance(dt: number): void {
    this.t += dt;
    this.sinceHit += dt;

    if (this.mode === 'auto') this.stepAutoScript();
    this.landDueHits();

    if (this.spinningOut) {
      this.spinOutProgress = Math.min(1, this.spinOutProgress + dt / Math.max(0.2, this.spinOutSeconds()));
      if (this.spinOutProgress >= 1) {
        if (this.downFor === 0) this.events.push({ kind: 'down' });
        this.downFor += dt;
        if (this.mode === 'auto' && this.downFor >= DOWN_HOLD_S) this.reset();
      }
    } else {
      if (this.mode === 'auto') {
        this.stamina = clamp01(this.stamina - AUTO_STAMINA_DRAIN_PER_S * dt);
        this.recoverStability(dt, RECOVERY_RATE_PER_S);
      } else if (this.mode === 'hold') {
        this.stamina += (this.holdStamina - this.stamina) * Math.min(1, dt * 4);
        if (this.sinceHit > 2.5 && !this.holdBroken) this.recoverStability(dt, HOLD_RETURN_PER_S, this.holdStability);
      }
      if (this.stamina <= 0 && this.mode !== 'hold') this.startSpinOut();
    }
  }

  private stepAutoScript(): void {
    while (this.autoHitIndex < AUTO_HITS.length) {
      const next = AUTO_HITS[this.autoHitIndex]!;
      if (this.t < next.t - HIT_LEAD_SECONDS) break;
      this.pending.push({ at: next.t, strength: next.strength, dirAngle: this.rng() * Math.PI * 2 });
      this.autoHitIndex++;
    }
  }

  private landDueHits(): void {
    while (this.pending.length > 0 && this.pending[0]!.at <= this.t) {
      const hit = this.pending.shift()!;
      if (this.spinningOut) continue;
      const before = this.stability;
      this.stability = clamp01(this.stability - HIT_STABILITY_LOSS[hit.strength]);
      this.stamina = clamp01(this.stamina - HIT_STAMINA_LOSS[hit.strength]);
      this.sinceHit = 0;
      this.lastHit = hit;
      this.events.push({ kind: 'hit', strength: hit.strength, magnitude: HIT_MAGNITUDE[hit.strength], dirAngle: hit.dirAngle, stabilityBefore: before });
      if (this.stability <= 0 && !this.broken) this.doBreak();
    }
  }

  private recoverStability(dt: number, rate: number, target = 1): void {
    if (this.sinceHit < RECOVERY_DELAY_S && this.mode === 'auto') return;
    if (this.stability < target) this.stability = Math.min(target, this.stability + rate * dt);
    // A ladder preset below BROKEN_CLEAR_AT still re-seats once it is back at its preset.
    const reseated = this.stability >= BROKEN_CLEAR_AT || (this.mode === 'hold' && this.stability >= target - 1e-6 && target > 0);
    if (this.broken && reseated) this.doRecover();
  }

  private doBreak(): void {
    this.broken = true;
    this.events.push({ kind: 'break' });
  }

  private doRecover(): void {
    this.broken = false;
    this.events.push({ kind: 'recover' });
  }

  private startSpinOut(): void {
    if (this.spinningOut) return;
    this.spinningOut = true;
    this.spinOutProgress = Math.max(this.spinOutProgress, 0.0001);
    this.pending = [];
    this.events.push({ kind: 'spinOut' });
  }
}
