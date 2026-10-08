// ============================================================
// BEY REAL LAB — PHYSICS TUNING
// Every adjustable value of the "Bey Real" prototype: how much the player steers, the
// autopilot, the realistic physics (bowl, friction, spin, precession, wobble), the
// collisions (restitution, rim friction, spin exchange), the four manual actions and the
// round rules. The tuning panel edits PARAMS live and the sim reads it every step.
//
// PROPOSED = Claude's starting values; none of them is approved. Where the game already
// has a rule for an action (Dash 10-18 m/s for 0.5 s with a 5 rad/s lock-on, Circular 0.25 s
// that launches whoever touches it, Dodge 12.6 m/s with 0.5 s of i-frames, cooldowns), the
// proposal IS the game's own number (src/combat/attacks/AttackTuning.ts, src/dodge/DodgeTuning.ts),
// so the lab judges the new physics and the new control, not new action rules.
//
// Units: the label names the unit; "x" values are multipliers (1 = proposal).
// ============================================================

import {
  CIRCULAR_ACTIVE_DURATION_S,
  CIRCULAR_CATCHES_DASH_HORIZONTAL_KEEP,
  CIRCULAR_CATCHES_DASH_LAUNCH_UP_MPS,
  CIRCULAR_HITBOX_RADIUS_M,
  CIRCULAR_LAUNCH_HORIZONTAL_MPS,
  CIRCULAR_RECOVERY_S,
  DASH_ACTIVE_DURATION_S,
  DASH_COOLDOWN_DEFAULT_S,
  DASH_LOCK_ON_MAX_TURN_RATE_RAD_S,
  DASH_MAX_SPEED_MPS,
  DASH_MIN_SPEED_MPS,
  DASH_WHIFF_RECOVERY_S,
} from '../../../src/combat/attacks/AttackTuning';
import { DODGE_ACTIVE_DURATION_S, DODGE_BURST_SPEED_MPS, DODGE_COOLDOWN_S, DODGE_PERFECT_WINDOW_S } from '../../../src/dodge/DodgeTuning';

export type ParamGroup = 'control' | 'auto' | 'physics' | 'collision' | 'dash' | 'circular' | 'dodge' | 'jump' | 'rules' | 'ai';

export interface RealParams {
  // --- Control: how much the player steers ---
  /** 0..1: the share of the steering the player's stick takes when held (the references: ~30%). No stick = the autopilot steers alone. */
  influence: number;
  // --- Autopilot ---
  steerAccelMps2: number;
  cruiseSpeedMps: number;
  pursuit: number;
  orbitRadiusFrac: number;
  // --- Physics ---
  bowlPull: number;
  dragPerS: number;
  tipFrictionMps2: number;
  precessionRadPerS: number;
  spinDecayPerS: number;
  spinMoveLossPerM: number;
  spinSteerLoss: number;
  wobbleSpin: number;
  wobbleAccelMps2: number;
  massSecond: number;
  sameSpin: number;
  // --- Collisions ---
  restitutionLow: number;
  restitutionHigh: number;
  rimFriction: number;
  spinExchange: number;
  hitSpinLoss: number;
  rubSpinLoss: number;
  hitStability: number;
  wallRestitution: number;
  wallSpinLoss: number;
  // --- Dash Attack ---
  dashMinSpeedMps: number;
  dashMaxSpeedMps: number;
  dashChargeMaxS: number;
  dashDurationS: number;
  dashCooldownS: number;
  dashSnapRadPerS: number;
  dashSnapWindowS: number;
  dashLockRadPerS: number;
  dashMassBoost: number;
  dashStabilityMin: number;
  dashStabilityMax: number;
  dashSpinCost: number;
  dashWhiffRecoveryS: number;
  // --- Circular Attack ---
  circularRadiusM: number;
  circularDurationS: number;
  circularRecoveryS: number;
  circularLaunchMps: number;
  circularLaunchUpMps: number;
  circularKeepFraction: number;
  circularStability: number;
  // --- Dodge ---
  dodgeSpeedMps: number;
  dodgeBurstS: number;
  dodgeInvulnS: number;
  dodgeCooldownS: number;
  dodgePerfectS: number;
  dodgeSpinCost: number;
  // --- Jump ---
  jumpSpeedMps: number;
  gravityMps2: number;
  airControl: number;
  jumpCooldownS: number;
  // --- Rules ---
  stageRadiusM: number;
  wallHeightM: number;
  ringOutDelayS: number;
  timeLimitS: number;
  stabilityRegenPerS: number;
  brokenS: number;
  // --- AI ---
  aiAggression: number;
  aiSkill: number;
}

export interface ParamSpec {
  readonly key: keyof RealParams;
  readonly group: ParamGroup;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

export const GROUP_TITLES: Readonly<Record<ParamGroup, string>> = {
  control: 'Controle do jogador',
  auto: 'Piloto automático',
  physics: 'Física: cuba, atrito, giro',
  collision: 'Colisão entre Beys e parede',
  dash: 'Dash Attack (carregar e soltar)',
  circular: 'Ataque giratório (toque)',
  dodge: 'Esquiva',
  jump: 'Pulo',
  rules: 'Arena e regras',
  ai: 'Oponente (IA)',
};

export const PROPOSED: Readonly<RealParams> = Object.freeze({
  influence: 0.3,
  steerAccelMps2: 12,
  cruiseSpeedMps: 8.5,
  pursuit: 0.45,
  orbitRadiusFrac: 0.5,
  bowlPull: 20,
  dragPerS: 0.1,
  tipFrictionMps2: 0.7,
  precessionRadPerS: 0.4,
  spinDecayPerS: 0.0035,
  spinMoveLossPerM: 0.00035,
  spinSteerLoss: 0.00025,
  wobbleSpin: 0.35,
  wobbleAccelMps2: 3.5,
  massSecond: 1,
  sameSpin: 0,
  restitutionLow: 0.5,
  restitutionHigh: 0.78,
  rimFriction: 0.4,
  spinExchange: 0.012,
  hitSpinLoss: 0.0026,
  rubSpinLoss: 0.0016,
  hitStability: 0.6,
  wallRestitution: 0.5,
  wallSpinLoss: 0.0016,
  dashMinSpeedMps: DASH_MIN_SPEED_MPS,
  dashMaxSpeedMps: DASH_MAX_SPEED_MPS,
  dashChargeMaxS: 1.2,
  dashDurationS: DASH_ACTIVE_DURATION_S,
  dashCooldownS: DASH_COOLDOWN_DEFAULT_S,
  dashSnapRadPerS: 40,
  dashSnapWindowS: 0.08,
  dashLockRadPerS: DASH_LOCK_ON_MAX_TURN_RATE_RAD_S,
  dashMassBoost: 1.8,
  dashStabilityMin: 10,
  dashStabilityMax: 25,
  dashSpinCost: 0.012,
  dashWhiffRecoveryS: DASH_WHIFF_RECOVERY_S,
  circularRadiusM: CIRCULAR_HITBOX_RADIUS_M,
  circularDurationS: CIRCULAR_ACTIVE_DURATION_S,
  circularRecoveryS: CIRCULAR_RECOVERY_S,
  circularLaunchMps: CIRCULAR_LAUNCH_HORIZONTAL_MPS,
  circularLaunchUpMps: CIRCULAR_CATCHES_DASH_LAUNCH_UP_MPS,
  circularKeepFraction: CIRCULAR_CATCHES_DASH_HORIZONTAL_KEEP,
  circularStability: 8,
  dodgeSpeedMps: DODGE_BURST_SPEED_MPS,
  dodgeBurstS: 0.25,
  dodgeInvulnS: DODGE_ACTIVE_DURATION_S,
  dodgeCooldownS: DODGE_COOLDOWN_S,
  dodgePerfectS: DODGE_PERFECT_WINDOW_S,
  dodgeSpinCost: 0.01,
  jumpSpeedMps: 7.5,
  gravityMps2: 18,
  airControl: 0,
  jumpCooldownS: 0.4,
  stageRadiusM: 12,
  wallHeightM: 1.25,
  ringOutDelayS: 0.6,
  timeLimitS: 150,
  stabilityRegenPerS: 5,
  brokenS: 2.4,
  aiAggression: 0.6,
  aiSkill: 0.55,
});

export const PARAM_SPEC: readonly ParamSpec[] = [
  { key: 'influence', group: 'control', label: 'Influência do jogador no movimento (0 = só o automático, 1 = manual)', min: 0, max: 1, step: 0.05 },

  { key: 'steerAccelMps2', group: 'auto', label: 'Força de direção (m/s²)', min: 2, max: 30, step: 0.5 },
  { key: 'cruiseSpeedMps', group: 'auto', label: 'Velocidade de cruzeiro (m/s)', min: 3, max: 14, step: 0.5 },
  { key: 'pursuit', group: 'auto', label: 'Perseguição ao oponente (0–1)', min: 0, max: 1, step: 0.05 },
  { key: 'orbitRadiusFrac', group: 'auto', label: 'Raio da órbita (fração da arena)', min: 0.2, max: 0.8, step: 0.05 },

  { key: 'bowlPull', group: 'physics', label: 'Puxão da cuba (x)', min: 0, max: 40, step: 1 },
  { key: 'dragPerS', group: 'physics', label: 'Arrasto viscoso (1/s)', min: 0, max: 1, step: 0.01 },
  { key: 'tipFrictionMps2', group: 'physics', label: 'Atrito da ponta (m/s²)', min: 0, max: 4, step: 0.1 },
  { key: 'precessionRadPerS', group: 'physics', label: 'Curvatura de precessão do giro (rad/s)', min: 0, max: 1.5, step: 0.05 },
  { key: 'spinDecayPerS', group: 'physics', label: 'Perda de giro parado (1/s)', min: 0, max: 0.02, step: 0.0005 },
  { key: 'spinMoveLossPerM', group: 'physics', label: 'Perda de giro por velocidade', min: 0, max: 0.002, step: 0.00005 },
  { key: 'spinSteerLoss', group: 'physics', label: 'Perda de giro por esforço de direção', min: 0, max: 0.002, step: 0.00005 },
  { key: 'wobbleSpin', group: 'physics', label: 'Giro abaixo do qual o Bey balança (0–1)', min: 0.05, max: 0.7, step: 0.01 },
  { key: 'wobbleAccelMps2', group: 'physics', label: 'Força do balanço (m/s²)', min: 0, max: 10, step: 0.1 },
  { key: 'massSecond', group: 'physics', label: 'Massa do 2º Bey (x o 1º)', min: 0.5, max: 2, step: 0.05 },
  { key: 'sameSpin', group: 'physics', label: 'Giro no mesmo sentido (0 = opostos, 1 = iguais)', min: 0, max: 1, step: 1 },

  { key: 'restitutionLow', group: 'collision', label: 'Quique com giro baixo', min: 0.1, max: 1, step: 0.01 },
  { key: 'restitutionHigh', group: 'collision', label: 'Quique com giro alto', min: 0.1, max: 1, step: 0.01 },
  { key: 'rimFriction', group: 'collision', label: 'Atrito entre as bordas', min: 0, max: 1, step: 0.01 },
  { key: 'spinExchange', group: 'collision', label: 'Troca de giro no contato', min: 0, max: 0.05, step: 0.001 },
  { key: 'hitSpinLoss', group: 'collision', label: 'Giro perdido por impacto', min: 0, max: 0.01, step: 0.0002 },
  { key: 'rubSpinLoss', group: 'collision', label: 'Giro perdido por raspão', min: 0, max: 0.01, step: 0.0002 },
  { key: 'hitStability', group: 'collision', label: 'Estabilidade perdida por impacto', min: 0, max: 3, step: 0.05 },
  { key: 'wallRestitution', group: 'collision', label: 'Quique na parede', min: 0, max: 1, step: 0.01 },
  { key: 'wallSpinLoss', group: 'collision', label: 'Giro perdido na parede', min: 0, max: 0.01, step: 0.0002 },

  { key: 'dashMinSpeedMps', group: 'dash', label: 'Velocidade mínima (m/s)', min: 4, max: 20, step: 0.5 },
  { key: 'dashMaxSpeedMps', group: 'dash', label: 'Velocidade máxima (m/s)', min: 6, max: 30, step: 0.5 },
  { key: 'dashChargeMaxS', group: 'dash', label: 'Carga até o máximo (s)', min: 0.3, max: 3, step: 0.05 },
  { key: 'dashDurationS', group: 'dash', label: 'Duração (s)', min: 0.2, max: 1.2, step: 0.05 },
  { key: 'dashCooldownS', group: 'dash', label: 'Recarga (s)', min: 0.5, max: 5, step: 0.25 },
  { key: 'dashSnapRadPerS', group: 'dash', label: 'Virada imediata ao soltar (rad/s)', min: 0, max: 80, step: 1 },
  { key: 'dashSnapWindowS', group: 'dash', label: 'Janela da virada imediata (s)', min: 0, max: 0.3, step: 0.01 },
  { key: 'dashLockRadPerS', group: 'dash', label: 'Mira depois da virada (rad/s)', min: 0, max: 12, step: 0.5 },
  { key: 'dashMassBoost', group: 'dash', label: 'Massa efetiva no Dash (x)', min: 1, max: 4, step: 0.1 },
  { key: 'dashStabilityMin', group: 'dash', label: 'Estabilidade tirada, carga mínima', min: 0, max: 50, step: 1 },
  { key: 'dashStabilityMax', group: 'dash', label: 'Estabilidade tirada, carga máxima', min: 0, max: 80, step: 1 },
  { key: 'dashSpinCost', group: 'dash', label: 'Custo de giro', min: 0, max: 0.06, step: 0.001 },
  { key: 'dashWhiffRecoveryS', group: 'dash', label: 'Recuperação se errar (s)', min: 0, max: 2, step: 0.05 },

  { key: 'circularRadiusM', group: 'circular', label: 'Alcance (m)', min: 0.6, max: 3, step: 0.05 },
  { key: 'circularDurationS', group: 'circular', label: 'Duração ativa (s)', min: 0.1, max: 0.8, step: 0.05 },
  { key: 'circularRecoveryS', group: 'circular', label: 'Recuperação (s)', min: 0, max: 1, step: 0.05 },
  { key: 'circularLaunchMps', group: 'circular', label: 'Lançamento horizontal (m/s)', min: 0, max: 20, step: 0.5 },
  { key: 'circularLaunchUpMps', group: 'circular', label: 'Lançamento para cima (m/s)', min: 0, max: 14, step: 0.5 },
  { key: 'circularKeepFraction', group: 'circular', label: 'Velocidade que um Dash capturado mantém', min: 0, max: 1, step: 0.05 },
  { key: 'circularStability', group: 'circular', label: 'Estabilidade tirada de quem toca', min: 0, max: 40, step: 1 },

  { key: 'dodgeSpeedMps', group: 'dodge', label: 'Velocidade (m/s)', min: 4, max: 24, step: 0.5 },
  { key: 'dodgeBurstS', group: 'dodge', label: 'Duração do impulso (s)', min: 0.1, max: 0.6, step: 0.01 },
  { key: 'dodgeInvulnS', group: 'dodge', label: 'Invulnerável por (s)', min: 0.1, max: 1, step: 0.05 },
  { key: 'dodgeCooldownS', group: 'dodge', label: 'Recarga (s)', min: 0.5, max: 6, step: 0.25 },
  { key: 'dodgePerfectS', group: 'dodge', label: 'Janela da esquiva perfeita (s)', min: 0.05, max: 0.4, step: 0.01 },
  { key: 'dodgeSpinCost', group: 'dodge', label: 'Custo de giro', min: 0, max: 0.06, step: 0.001 },

  { key: 'jumpSpeedMps', group: 'jump', label: 'Impulso do pulo (m/s)', min: 3, max: 14, step: 0.5 },
  { key: 'gravityMps2', group: 'jump', label: 'Gravidade no ar (m/s²)', min: 6, max: 40, step: 1 },
  { key: 'airControl', group: 'jump', label: 'Controle no ar (0 = nenhum)', min: 0, max: 1, step: 0.05 },
  { key: 'jumpCooldownS', group: 'jump', label: 'Recarga do pulo (s)', min: 0, max: 2, step: 0.05 },

  { key: 'stageRadiusM', group: 'rules', label: 'Raio da arena de jogo (m)', min: 7, max: 20, step: 0.5 },
  { key: 'wallHeightM', group: 'rules', label: 'Altura da parede (m)', min: 0.3, max: 3, step: 0.1 },
  { key: 'ringOutDelayS', group: 'rules', label: 'Tempo fora da arena até perder (s)', min: 0, max: 3, step: 0.1 },
  { key: 'timeLimitS', group: 'rules', label: 'Limite de tempo (s, 0 = sem)', min: 0, max: 300, step: 10 },
  { key: 'stabilityRegenPerS', group: 'rules', label: 'Recuperação de Estabilidade (por s)', min: 0, max: 20, step: 0.5 },
  { key: 'brokenS', group: 'rules', label: 'Tempo Quebrado (s)', min: 0.5, max: 6, step: 0.1 },

  { key: 'aiAggression', group: 'ai', label: 'Agressividade da IA (0–1)', min: 0, max: 1, step: 0.05 },
  { key: 'aiSkill', group: 'ai', label: 'Reação da IA (0–1)', min: 0, max: 1, step: 0.05 },
];

export interface Preset {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly values: Partial<RealParams>;
}

export const PRESETS: readonly Preset[] = [
  { id: 'real', label: 'Bey Real (proposta)', description: 'A proposta: o automático comanda, o jogador influencia 30% e aperta os botões.', values: {} },
  { id: 'control', label: 'Mais controle', description: 'Influência de 65% e mais força de direção: o jogador conduz mais.', values: { influence: 0.65, steerAccelMps2: 18 } },
  { id: 'auto', label: 'Só automático', description: 'Influência 0: você só aperta os botões. Bom para ver o piloto automático sozinho.', values: { influence: 0 } },
  { id: 'heavy', label: 'Pesado e inercial', description: 'Mais arrasto de cuba, menos quique, giro dura mais: batalhas lentas e pesadas.', values: { bowlPull: 26, restitutionLow: 0.35, restitutionHigh: 0.55, spinDecayPerS: 0.002, dashMassBoost: 2.4, cruiseSpeedMps: 7 } },
  { id: 'wild', label: 'Selvagem', description: 'Precessão e balanço fortes, quique alto, giro acaba rápido: partidas curtas e caóticas.', values: { precessionRadPerS: 0.9, wobbleAccelMps2: 6, restitutionLow: 0.7, restitutionHigh: 0.92, spinDecayPerS: 0.007, hitSpinLoss: 0.004 } },
];

/** The live values the sim reads every step. */
export const PARAMS: RealParams = { ...PROPOSED };

export function applyParams(values: Partial<RealParams>): void {
  for (const spec of PARAM_SPEC) {
    const v = values[spec.key];
    if (typeof v === 'number' && Number.isFinite(v)) PARAMS[spec.key] = Math.min(spec.max, Math.max(spec.min, v));
  }
}

export function resetParams(): void {
  Object.assign(PARAMS, PROPOSED);
}

/** A snapshot with `overrides` on the proposal (for the headless calibration and the tests). */
export function paramsWith(overrides: Partial<RealParams> = {}): RealParams {
  const out: RealParams = { ...PROPOSED };
  for (const spec of PARAM_SPEC) {
    const v = overrides[spec.key];
    if (typeof v === 'number' && Number.isFinite(v)) out[spec.key] = Math.min(spec.max, Math.max(spec.min, v));
  }
  return out;
}
