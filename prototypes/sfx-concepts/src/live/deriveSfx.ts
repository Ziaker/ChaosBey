// ============================================================
// SFX LAB — FROM A REAL MATCH TICK TO SOUNDS (pure, observe-only)
// Reads what the game's own simulation already reports each tick
// (MatchTickResult, Clash state, round outcome) and turns it into sound
// requests and loop levels. It never feeds anything back into the match:
// a presentation layer that observes (GDD 158: VFX/SFX observe, never
// decide). Magnitudes reuse the game's ImpactMagnitude curve, the same
// numbers the camera and VFX react to.
//
// Pure (no Web Audio, no DOM), so the mapping is unit-tested with
// hand-built ticks.
// ============================================================

import type { MatchTickResult } from '../../../../src/app/simulation/tickMatch';
import { ARENA_FLOOR_RADIUS } from '../../../../src/arena/colliders/ArenaTuning';
import { BASE_SPIN_RATE_RAD_S } from '../../../../src/bey/spin/SpinTuning';
import { STAMINA_PENALTY_START_FRACTION } from '../../../../src/bey/stamina/StaminaTuning';
import { INTENDED_MAX_SPEED_MPS } from '../../../../src/bey/movement/MovementTuning';
import { knockbackMagnitude, landingMagnitude, movementImpactMagnitude } from '../../../../src/camera/ImpactMagnitude';
import { AttackState } from '../../../../src/combat/attacks/AttackController';
import { ClashOutcome, ClashState, type ClashResult } from '../../../../src/combat/clash/ClashController';
import { CLASH_TARGET_DURATION_S } from '../../../../src/combat/clash/ClashTuning';
import { RoundOutcome } from '../../../../src/combat/round-rules/RoundState';
import { DodgeState } from '../../../../src/dodge/DodgeController';
import { DriftState } from '../../../../src/drift/DriftController';

export type Side = 'first' | 'second';

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface SfxTrigger {
  readonly eventId: string;
  readonly magnitude: number;
  readonly side?: Side;
  readonly pan: number;
  readonly delayS?: number;
  /** Distance attenuation (linear, ≤ 1); see distanceGain(). */
  readonly gain: number;
}

export interface LoopTarget {
  /** Instance key, e.g. 'spinHum:first'. */
  readonly key: string;
  readonly eventId: string;
  readonly level: number;
  readonly param: number;
  readonly aux?: number;
  readonly pan: number;
  readonly side?: Side;
  /** Distance attenuation (linear, ≤ 1) to multiply the level by. */
  readonly gain: number;
}

interface SideMemory {
  readonly attack: AttackState;
  readonly dodge: DodgeState;
  readonly drift: DriftState;
  readonly broken: boolean;
  readonly staminaWarned: boolean;
  readonly chargeFullPlayed: boolean;
}

export interface DeriveMemory {
  readonly started: boolean;
  readonly first: SideMemory;
  readonly second: SideMemory;
  readonly clashState: ClashState;
  readonly mashFirst: number;
  readonly mashSecond: number;
  readonly outcome: RoundOutcome;
}

export interface DeriveInput {
  readonly result: Pick<MatchTickResult, 'first' | 'second' | 'hitEvents' | 'combatEvents'>;
  /** False on a hitstop-frozen tick: its result is last tick's, its events were already heard. */
  readonly advanced: boolean;
  readonly clashResolvedThisTick: ClashResult | null;
  readonly positions: { readonly first: Vec3; readonly second: Vec3 };
  readonly radii: { readonly first: number; readonly second: number };
  readonly clash: { readonly state: ClashState; readonly elapsedS: number; readonly mashFirst: number; readonly mashSecond: number };
  readonly outcome: RoundOutcome;
}

export interface DeriveOutput {
  readonly triggers: readonly SfxTrigger[];
  readonly loops: readonly LoopTarget[];
  readonly memory: DeriveMemory;
}

const FRESH_SIDE: SideMemory = { attack: AttackState.Neutral, dodge: DodgeState.Idle, drift: DriftState.Idle, broken: false, staminaWarned: false, chargeFullPlayed: false };

export function initialMemory(): DeriveMemory {
  return { started: false, first: FRESH_SIDE, second: FRESH_SIDE, clashState: ClashState.Idle, mashFirst: 0, mashSecond: 0, outcome: RoundOutcome.Ongoing };
}

/** Extra reach beyond the two colliders that still counts as "touching". */
export const CONTACT_MARGIN_M = 0.35;
/** How close to the wall (beyond the Bey's own radius) counts as "at the wall". */
export const WALL_MARGIN_M = 0.5;
/** Victory/defeat stingers wait for the KO / Ring-Out sound to land first. */
export const RESULT_STINGER_DELAY_S = 0.75;

// Distance: the listener rides with the player's Bey (the "first" side), as
// the game's camera sits behind it. The player's own sounds are always
// close; the opponent's come in quieter the farther away it is, down to a
// floor, so a Bey across the arena doesn't compete with the one you steer.
// Tuning, not approved.
/** Within this distance from the player's Bey: full level. */
export const DISTANCE_NEAR_M = 3;
/** At or beyond this distance: the floor. */
export const DISTANCE_FAR_M = 20;
/** The quietest a far sound gets (dB). */
export const DISTANCE_FLOOR_DB = -8;

const clamp01 = (x: number) => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));

/** Linear gain for a sound at `source` heard from the player's Bey at `listener` (horizontal distance). */
export function distanceGain(source: Vec3, listener: Vec3): number {
  const d = Math.hypot(source.x - listener.x, source.z - listener.z);
  const k = clamp01((d - DISTANCE_NEAR_M) / (DISTANCE_FAR_M - DISTANCE_NEAR_M));
  return Math.pow(10, (k * DISTANCE_FLOOR_DB) / 20);
}

/** Stereo position as heard from the middle of the fight (the camera follows both Beys). */
export function panFor(position: Vec3, positions: DeriveInput['positions']): number {
  const midX = (positions.first.x + positions.second.x) / 2;
  return Math.max(-0.8, Math.min(0.8, (position.x - midX) / 5));
}

function radial(p: Vec3): number {
  return Math.hypot(p.x, p.z);
}

export function deriveSfx(memory: DeriveMemory, input: DeriveInput): DeriveOutput {
  const { result, positions } = input;
  const triggers: SfxTrigger[] = [];
  const pos = (side: Side) => positions[side];
  const pan = (side: Side) => panFor(pos(side), positions);
  const gain = (side: Side) => distanceGain(pos(side), positions.first);
  const push = (eventId: string, magnitude: number, side?: Side, extra: Partial<SfxTrigger> = {}) =>
    triggers.push({ eventId, magnitude: clamp01(magnitude), side, pan: side ? pan(side) : 0, gain: side ? gain(side) : 1, ...extra });

  if (!memory.started) push('roundStart', 1);

  const snap = { first: result.first, second: result.second };
  const nextSide: Record<Side, SideMemory> = { first: memory.first, second: memory.second };

  if (input.advanced) {
    // Attacks that connected.
    for (const hit of result.hitEvents) {
      const defender: Side = hit.attackerIsFirst ? 'second' : 'first';
      if (hit.caughtOpponentDashing) push('counter', 1, defender);
      else push('hit', knockbackMagnitude(hit.hitbox.knockbackForce), defender);
    }
    // The game reports a perfect dodge as 'dodged' AND 'perfectDodge' on the
    // same tick; the perfect sound replaces the regular one instead of
    // stacking on it.
    const perfect = new Set(result.combatEvents.filter((e) => e.kind === 'perfectDodge').map((e) => e.targetIsFirst));
    for (const event of result.combatEvents) {
      const side: Side = event.targetIsFirst ? 'first' : 'second';
      if (event.kind === 'dodged') {
        if (!perfect.has(event.targetIsFirst)) push('dodged', 1, side);
      } else if (event.kind === 'perfectDodge') push('perfectDodge', 1, side);
      else if (event.kind === 'stabilityBreak') push('stabilityBreak', 1, side);
      else if (event.kind === 'ko') push('ko', 1, side);
      else if (event.kind === 'ringOut') push('ringOut', 1, side);
    }

    // Unscripted physical impacts: Bey×Bey contact vs. wall bounce.
    const touching = Math.hypot(pos('first').x - pos('second').x, pos('first').z - pos('second').z) <= input.radii.first + input.radii.second + CONTACT_MARGIN_M;
    let contactMagnitude = 0;
    for (const side of ['first', 'second'] as const) {
      const delta = snap[side].movement.impactDeltaSpeedMps;
      if (delta <= 0) continue;
      const magnitude = movementImpactMagnitude(delta);
      if (touching) contactMagnitude = Math.max(contactMagnitude, magnitude);
      else if (radial(pos(side)) >= ARENA_FLOOR_RADIUS - input.radii[side] - WALL_MARGIN_M) push('wallImpact', magnitude, side);
      // Anything else (a floor bump mid-arena) stays silent on purpose.
    }
    if (contactMagnitude > 0 && result.hitEvents.length === 0) {
      const mid = { x: (pos('first').x + pos('second').x) / 2, y: 0, z: (pos('first').z + pos('second').z) / 2 };
      triggers.push({ eventId: 'beyContact', magnitude: clamp01(contactMagnitude), pan: panFor(mid, positions), gain: distanceGain(mid, positions.first) });
    }

    // Per-side state edges.
    for (const side of ['first', 'second'] as const) {
      const s = snap[side];
      const before = memory[side];
      if (s.justLanded) push('landing', landingMagnitude(s.landingIntensity), side);
      if (s.attackState === AttackState.CircularActive && before.attack !== AttackState.CircularActive) push('circularStart', 1, side);
      if (s.attackState === AttackState.DashActive && before.attack !== AttackState.DashActive) {
        push('dashRelease', s.dashChargeFraction, side);
        if (before.attack === AttackState.ChargingDash && s.attackEnergyFraction <= 0.001) push('energyEmpty', 1, side);
      }
      let chargeFullPlayed = before.chargeFullPlayed;
      if (s.attackState === AttackState.ChargingDash) {
        if (s.dashChargeFraction >= 0.999 && !chargeFullPlayed) {
          push('dashFull', 1, side);
          chargeFullPlayed = true;
        }
      } else chargeFullPlayed = false;
      if (s.dodgeState === DodgeState.Dodging && before.dodge !== DodgeState.Dodging) push('dodge', 1, side);
      if (s.driftState === DriftState.Hopping && before.drift !== DriftState.Hopping) push('jump', 1, side);
      if (before.broken && !s.isBroken) push('stabilityRecover', 1, side);
      let staminaWarned = before.staminaWarned;
      if (!staminaWarned && s.staminaFraction < STAMINA_PENALTY_START_FRACTION) {
        push('staminaLow', 1, side);
        staminaWarned = true;
      }
      nextSide[side] = { attack: s.attackState, dodge: s.dodgeState, drift: s.driftState, broken: s.isBroken, staminaWarned, chargeFullPlayed };
    }
  }

  // Clash: start, mash from each side, resolution.
  const clashActive = input.clash.state === ClashState.Active;
  const progress = clamp01(input.clash.elapsedS / CLASH_TARGET_DURATION_S);
  if (clashActive && memory.clashState !== ClashState.Active) push('clashStart', 1);
  if (clashActive) {
    if (input.clash.mashFirst > memory.mashFirst) push('clashMash', progress, 'first');
    if (input.clash.mashSecond > memory.mashSecond) push('clashMash', progress, 'second');
  }
  if (input.clashResolvedThisTick) push(input.clashResolvedThisTick.outcome === ClashOutcome.Tie ? 'clashTie' : 'clashResolve', 1);

  // Round result stinger (after the KO / Ring-Out itself).
  if (memory.outcome === RoundOutcome.Ongoing && input.outcome !== RoundOutcome.Ongoing) {
    const firstWon = input.outcome === RoundOutcome.FirstWinsByKo || input.outcome === RoundOutcome.FirstWinsByRingOut;
    const draw = input.outcome === RoundOutcome.Draw;
    push(draw ? 'draw' : firstWon ? 'victory' : 'defeat', 1, undefined, { delayS: RESULT_STINGER_DELAY_S });
  }

  // Continuous sounds: where each loop should sit this tick.
  const roundOver = input.outcome !== RoundOutcome.Ongoing;
  const loops: LoopTarget[] = [];
  for (const side of ['first', 'second'] as const) {
    const s = snap[side];
    const speed = clamp01(s.movement.speedMps / INTENDED_MAX_SPEED_MPS);
    const spin = clamp01(s.spin.spinRateRadPerSec / BASE_SPIN_RATE_RAD_S);
    const outOfPlay = roundOver && ((side === 'first' && (input.outcome === RoundOutcome.SecondWinsByKo || input.outcome === RoundOutcome.SecondWinsByRingOut)) || (side === 'second' && (input.outcome === RoundOutcome.FirstWinsByKo || input.outcome === RoundOutcome.FirstWinsByRingOut)));
    const quiet = clashActive ? 0.35 : 1;
    loops.push({ key: `spinHum:${side}`, eventId: 'spinHum', side, level: outOfPlay || spin < 0.05 ? 0 : quiet, param: spin, aux: clamp01((s.isBroken ? 0.5 : 0) + s.spin.wobbleEnergy * 0.6), pan: pan(side), gain: gain(side) });
    const slip = clamp01(Math.abs(s.movement.slipAngleRad) / 0.6);
    const drifting = s.driftState === DriftState.Drifting ? 0.35 : 0;
    const scrape = s.grounded && !clashActive && !outOfPlay ? clamp01(speed * (0.25 + 0.75 * slip) + drifting * speed) : 0;
    loops.push({ key: `floorScrape:${side}`, eventId: 'floorScrape', side, level: scrape, param: speed, pan: pan(side), gain: gain(side) });
    const atWall = radial(pos(side)) >= ARENA_FLOOR_RADIUS - input.radii[side] - WALL_MARGIN_M;
    loops.push({ key: `wallGrind:${side}`, eventId: 'wallGrind', side, level: atWall && speed > 0.1 && !clashActive && !outOfPlay ? speed : 0, param: speed, pan: pan(side), gain: gain(side) });
    const charging = s.attackState === AttackState.ChargingDash;
    loops.push({ key: `dashCharge:${side}`, eventId: 'dashCharge', side, level: charging ? 1 : 0, param: s.dashChargeFraction, pan: pan(side), gain: gain(side) });
  }
  const mashTotal = input.clash.mashFirst + input.clash.mashSecond;
  loops.push({ key: 'clashTension', eventId: 'clashTension', level: clashActive ? 1 : 0, param: progress, aux: mashTotal > 0 ? Math.abs(input.clash.mashFirst - input.clash.mashSecond) / mashTotal : 0, pan: 0, gain: 1 });

  return {
    triggers,
    loops,
    memory: {
      started: true,
      first: nextSide.first,
      second: nextSide.second,
      clashState: input.clash.state,
      mashFirst: clashActive ? input.clash.mashFirst : 0,
      mashSecond: clashActive ? input.clash.mashSecond : 0,
      outcome: input.outcome,
    },
  };
}
