// ============================================================
// CLASH PRESENTATION LAB — SCENARIOS
// Ten reproducible setups (deterministic: fixed 60Hz tick + scripted mash
// rates, no unseeded randomness) covering every case the owner asked for.
// Each scenario only sets the INPUTS the real src/combat/clash/ formula
// takes (Stamina fraction, speed, mash rate) plus where the two Beys sit
// for the physical knockback/ring-out beat — never the formula, caps,
// window or cooldown themselves.
// ============================================================

import { CLASH_VELOCITY_REFERENCE_MPS } from '../../../../src/combat/clash/ClashTuning';
import { DASH_MAX_KNOCKBACK_FORCE, DASH_MIN_KNOCKBACK_FORCE } from '../../../../src/combat/attacks/AttackTuning';
import { constantRateMash, rampMash, type MashLogEntry } from './mash';
import type { ClashAiMashSource } from '../../../../src/combat/clash/ClashMash';

export type ArenaId = 'foundry' | 'rift' | 'stadium';

export type MashProfile = { kind: 'rate'; eventsPerSecond: number } | { kind: 'ramp'; beforeEventsPerSecond: number; afterEventsPerSecond: number; switchAtS: number };

export function mashSourceFor(profile: MashProfile): ClashAiMashSource {
  return profile.kind === 'rate' ? constantRateMash(profile.eventsPerSecond) : rampMash(profile.beforeEventsPerSecond, profile.afterEventsPerSecond, profile.switchAtS);
}

export interface ClashSideConfig {
  /** 0..1, fed straight into ClashController.tryStart() — this lab lets the owner set it directly rather than deriving it from a full match simulation. */
  staminaFraction: number;
  /** m/s at the moment of connect, same reasoning as staminaFraction above. */
  speedMps: number;
  mash: MashProfile;
  /** Distance from the arena center (m) along the shared clash axis where this Bey ends up once Approach finishes. Negative = toward -x. */
  clashRadiusM: number;
}

export interface ClashScenario {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly arena: ArenaId;
  /** How far apart (m) the two Beys start before Approach converges them onto the clash axis — presentation-only motion, see ClashHarness's module doc. */
  readonly approachSpreadM: number;
  /** Seconds between the two attacks connecting, purely for the "is this inside the 150ms window" HUD fact. */
  readonly connectDeltaS: number;
  /** Synthetic hitbox force (same unit as a real attack's knockbackForce) used for the physical resolution beat — a presentation-harness stand-in for "whichever attack actually landed", since this lab has no real attack/hit-detection pipeline. */
  readonly knockbackForce: number;
  readonly first: ClashSideConfig;
  readonly second: ClashSideConfig;
}

// Bracket the real Dash Attack's own knockback force range (AttackTuning.ts) so the physical beat lands in a believable place, without pretending this lab knows which real attack connected.
const MODEST_FORCE = DASH_MIN_KNOCKBACK_FORCE; // 8 — a clear but contained knockback.
// Presentation harness: exaggerated well past a real Dash so scenario 9 clears RINGOUT_RADIUS_M on its own,
// airborne over the 2m wall. 4× (was 3×) with the loser 4m from the center (was 6m) since the Beys
// now start the resolution resting on the floor instead of hovering at the 0.6m spawn height: from the
// floor, a launch that starts 6m out hits the side of the wall first (and can then sink through the
// wall collider — the M7 ext-32 wedge, not a real ring-out). Swept force 3×–8× × loser 4–8m: loser
// at 4–5m clears the wall cleanly for every force from 3.5× up, so 4× @ 4m sits inside that margin.
const RING_OUT_FORCE = DASH_MAX_KNOCKBACK_FORCE * 4;

/**
 * Center-to-center distance (m) at which the two Beys' colliders touch (2 × 0.65 m collider radius)
 * — a Clash only ever starts from contact, so every scenario places the two Beys exactly this far
 * apart on the clash axis (the symmetric ones use ±0.65 m). The resolution scenarios keep the
 * loser's position and put the winner in contact with it, so the physical consequence is unchanged.
 */
export const CONTACT_SEPARATION_M = 1.3;

const rate = (eventsPerSecond: number): MashProfile => ({ kind: 'rate', eventsPerSecond });
const ramp = (beforeEventsPerSecond: number, afterEventsPerSecond: number, switchAtS: number): MashProfile => ({ kind: 'ramp', beforeEventsPerSecond, afterEventsPerSecond, switchAtS });

export const SCENARIOS: readonly ClashScenario[] = [
  {
    id: 'balanced',
    label: 'Clash equilibrado',
    description: 'Os dois lados mancham perto do mesmo ritmo, Stamina e velocidade parecidas — uma vitória apertada, decidida pela diferença fina de mash.',
    arena: 'foundry',
    approachSpreadM: 3.5,
    connectDeltaS: 0.04,
    knockbackForce: MODEST_FORCE,
    first: { staminaFraction: 0.72, speedMps: 8.6, mash: rate(4.5), clashRadiusM: -0.65 },
    second: { staminaFraction: 0.68, speedMps: 8.3, mash: rate(4.2), clashRadiusM: 0.65 },
  },
  {
    id: 'player-dominates',
    label: 'Jogador domina desde o início',
    description: 'O jogador manche forte, com boa Stamina e velocidade, desde o primeiro instante do Clash.',
    arena: 'foundry',
    approachSpreadM: 3.5,
    connectDeltaS: 0.05,
    knockbackForce: MODEST_FORCE,
    first: { staminaFraction: 0.85, speedMps: 9, mash: rate(9), clashRadiusM: -0.65 },
    second: { staminaFraction: 0.5, speedMps: 4, mash: rate(0.8), clashRadiusM: 0.65 },
  },
  {
    id: 'ai-dominates',
    label: 'IA domina desde o início',
    description: 'O lado oposto (simulado via harness, GDD: a IA participa do mash) mancha forte desde o início; o jogador mal reage.',
    arena: 'rift',
    approachSpreadM: 3.5,
    connectDeltaS: 0.05,
    knockbackForce: MODEST_FORCE,
    first: { staminaFraction: 0.5, speedMps: 4, mash: rate(0.8), clashRadiusM: -0.65 },
    second: { staminaFraction: 0.85, speedMps: 9, mash: rate(9), clashRadiusM: 0.65 },
  },
  {
    id: 'comeback',
    label: 'Comeback no último segundo',
    description: 'O jogador manche pouco por quase todo o Clash e dispara só no último segundo, virando um resultado que parecia perdido.',
    arena: 'stadium',
    approachSpreadM: 3.5,
    connectDeltaS: 0.03,
    knockbackForce: MODEST_FORCE,
    first: { staminaFraction: 0.8, speedMps: 8, mash: ramp(1, 12, 3), clashRadiusM: -0.65 },
    second: { staminaFraction: 0.7, speedMps: 7, mash: rate(4), clashRadiusM: 0.65 },
  },
  {
    id: 'high-mash-low-stamina',
    label: 'Mash alto com Stamina baixa',
    description: 'O jogador manche no limite (MashPerformance satura em 1.0), mas a Stamina quase zerada trava o StaminaFactor perto do piso de 0.5 — mostra o cap ao vivo.',
    arena: 'foundry',
    approachSpreadM: 3.5,
    connectDeltaS: 0.06,
    knockbackForce: MODEST_FORCE,
    first: { staminaFraction: 0.05, speedMps: 6, mash: rate(10), clashRadiusM: -0.65 },
    second: { staminaFraction: 0.8, speedMps: 5, mash: rate(3), clashRadiusM: 0.65 },
  },
  {
    id: 'low-mash-high-velocity',
    label: 'Mash baixo com velocidade alta',
    description: 'O jogador quase não manche, mas chegou no Clash na velocidade de referência — o VelocityFactor bate no teto 1.0 mesmo com MashPerformance baixo.',
    arena: 'rift',
    approachSpreadM: 3.5,
    connectDeltaS: 0.02,
    knockbackForce: MODEST_FORCE,
    first: { staminaFraction: 0.8, speedMps: CLASH_VELOCITY_REFERENCE_MPS, mash: rate(1), clashRadiusM: -0.65 },
    second: { staminaFraction: 0.8, speedMps: 4, mash: rate(3), clashRadiusM: 0.65 },
  },
  {
    id: 'tie',
    label: 'Empate',
    description: 'Entradas idênticas nos dois lados: mesmo ClashPower exato, dentro da tolerância de ponto flutuante — dispara o desempate simétrico (sem vencedor, sem dano de Stability).',
    arena: 'stadium',
    approachSpreadM: 3.5,
    connectDeltaS: 0,
    knockbackForce: MODEST_FORCE,
    first: { staminaFraction: 0.75, speedMps: 8, mash: rate(4.4), clashRadiusM: -0.65 },
    second: { staminaFraction: 0.75, speedMps: 8, mash: rate(4.4), clashRadiusM: 0.65 },
  },
  {
    id: 'resolution-normal-knockback',
    label: 'Resolução: knockback normal (sem ring-out)',
    description: 'Vitória clara do jogador perto do centro da arena — o knockback físico empurra o perdedor, mas ele não chega perto da borda.',
    arena: 'foundry',
    approachSpreadM: 2.5,
    connectDeltaS: 0.04,
    knockbackForce: MODEST_FORCE,
    first: { staminaFraction: 0.85, speedMps: 9, mash: rate(9), clashRadiusM: 3 - CONTACT_SEPARATION_M },
    second: { staminaFraction: 0.5, speedMps: 4, mash: rate(0.5), clashRadiusM: 3 },
  },
  {
    id: 'resolution-ring-out',
    label: 'Resolução: ring-out natural após o knockback',
    description: 'Mesma vitória clara, mas com um knockback bem mais forte na direção da parede — a física arremessa o perdedor por cima dela sozinha; o Clash nunca declara o ring-out.',
    arena: 'rift',
    approachSpreadM: 2.5,
    connectDeltaS: 0.04,
    knockbackForce: RING_OUT_FORCE,
    // 8m of open floor between the loser and the wall (ARENA_FLOOR_RADIUS=12) gives the launch time to arc up over the 2m wall before reaching it — a knockback that starts close to the wall slams into its side instead of clearing it (see RingOutTuning.ts: the only way out is airborne, over the wall).
    first: { staminaFraction: 0.85, speedMps: 9, mash: rate(9), clashRadiusM: 4 - CONTACT_SEPARATION_M },
    second: { staminaFraction: 0.5, speedMps: 4, mash: rate(0.5), clashRadiusM: 4 },
  },
  {
    id: 'cooldown-watch',
    label: 'Cooldown (10s) em detalhe',
    description: 'Um Clash rápido e decisivo só para acompanhar o cooldown de 10s por inteiro — use a velocidade 4× para não esperar.',
    arena: 'stadium',
    approachSpreadM: 3.5,
    connectDeltaS: 0.05,
    knockbackForce: MODEST_FORCE,
    first: { staminaFraction: 0.8, speedMps: 8.5, mash: rate(7), clashRadiusM: -0.65 },
    second: { staminaFraction: 0.6, speedMps: 6, mash: rate(2), clashRadiusM: 0.65 },
  },
];

export function scenarioById(id: string): ClashScenario {
  return SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0]!;
}

export type { MashLogEntry };
