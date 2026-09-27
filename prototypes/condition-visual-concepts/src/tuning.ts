// ============================================================
// STAMINA & STABILITY LAB — LIVE TUNING
// Every adjustable parameter of the three condition languages, plus the
// physical motion they all share. The tuning panel edits TUNING live and
// everything reads it every frame, so changes show immediately.
//
// APPROVED holds the owner's final configuration: the values saved with
// "Salvar como final" on 2026-09-27 (all three directions on), minus C's
// red light column, which the owner removed afterwards. Recorded in
// docs/design-decisions/condition-visual-approval.md. "Voltar ao aprovado"
// returns here; rows that differ from it turn orange.
//
// Units: multipliers (1 = Claude's original proposal) unless the label names a unit.
// ============================================================

export interface TuningSpec {
  readonly key: keyof Tuning;
  readonly group: TuningGroup;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

export type TuningGroup = 'physics' | 'A' | 'B' | 'C';

export const GROUP_TITLES: Readonly<Record<TuningGroup, string>> = {
  physics: 'Física e giro (comum às 3)',
  A: 'A — Desgaste Mecânico',
  B: 'B — Aura de Espírito',
  C: 'C — Instrumento no Chão',
};

export interface Tuning {
  // --- Shared physical expression (every direction) ---
  spinMaxRps: number;
  spinMinRps: number;
  spinCurve: number;
  meshMaxRps: number;
  blur: number;
  blurFadeRps: number;
  wobbleStart: number;
  wobbleMaxDeg: number;
  precessionHz: number;
  nutation: number;
  tipWander: number;
  stabilityWobble: number;
  hitTiltDeg: number;
  hitTiltFull: number;
  knockback: number;
  recoverySpeed: number;
  brokenLeanDeg: number;
  brokenStutter: number;
  spinOutSeconds: number;

  // --- A: Mechanical wear ---
  aTrail: number;
  aTrailSeconds: number;
  aRattle: number;
  aSeamGap: number;
  aWear: number;
  aGrind: number;
  aSmoke: number;
  aShudder: number;
  aDebris: number;

  // --- B: Spirit aura ---
  bAuraHeight: number;
  bAuraIntensity: number;
  bAuraBreakup: number;
  bSpinLines: number;
  bShards: number;
  bShardSize: number;
  bShardOrbit: number;
  bDangerShell: number;
  bDangerHz: number;
  bDazed: number;
  bArcs: number;
  bGlowDim: number;

  // --- C: Floor instrument ---
  cRadius: number;
  cWidth: number;
  cOpacity: number;
  cSegments: number;
  cWarnAt: number;
  cCritAt: number;
  cNotch: number;
  cCorePulse: number;
  cHazardSpin: number;
}

/** Owner's final configuration (2026-09-27). "Voltar ao aprovado" returns here. */
export const APPROVED: Readonly<Tuning> = {
  spinMaxRps: 18,
  spinMinRps: 1.2,
  spinCurve: 1.6,
  meshMaxRps: 3.5,
  blur: 1,
  blurFadeRps: 6,
  wobbleStart: 0.55,
  wobbleMaxDeg: 16,
  precessionHz: 0.9,
  nutation: 1,
  tipWander: 1,
  stabilityWobble: 1,
  hitTiltDeg: 26,
  hitTiltFull: 0.3,
  knockback: 1,
  recoverySpeed: 3,
  brokenLeanDeg: 11,
  brokenStutter: 0.5,
  spinOutSeconds: 3,

  aTrail: 0.55,
  aTrailSeconds: 3.6,
  aRattle: 0.5,
  aSeamGap: 1.8,
  aWear: 1.65,
  aGrind: 2.35,
  aSmoke: 2.4,
  aShudder: 1,
  aDebris: 2.35,

  bAuraHeight: 0.4,
  bAuraIntensity: 0.25,
  bAuraBreakup: 1.5,
  bSpinLines: 1.3,
  bShards: 6,
  bShardSize: 1,
  bShardOrbit: 0.9,
  bDangerShell: 0,
  bDangerHz: 2.2,
  bDazed: 1.6,
  bArcs: 1.85,
  bGlowDim: 0.8,

  cRadius: 1.15,
  cWidth: 0.95,
  cOpacity: 0.6,
  cSegments: 10,
  cWarnAt: 0.35,
  cCritAt: 0.23,
  cNotch: 0.85,
  cCorePulse: 1.25,
  cHazardSpin: 1.15,
};

/** Live values (mutated by the tuning panel). */
export const TUNING: Tuning = { ...APPROVED };

export const TUNING_SPEC: readonly TuningSpec[] = [
  { key: 'spinMaxRps', group: 'physics', label: 'Giro com Stamina cheia (voltas/s)', min: 4, max: 40, step: 0.5 },
  { key: 'spinMinRps', group: 'physics', label: 'Giro perto do fim (voltas/s)', min: 0.3, max: 6, step: 0.1 },
  { key: 'spinCurve', group: 'physics', label: 'Quando o giro começa a cair (1 = linear, >1 = mais tarde)', min: 0.4, max: 3, step: 0.05 },
  { key: 'meshMaxRps', group: 'physics', label: 'Giro máximo desenhado das peças (evita a roda de carroça)', min: 1, max: 12, step: 0.25 },
  { key: 'blur', group: 'physics', label: 'Disco de borrão do giro', min: 0, max: 1.5, step: 0.05 },
  { key: 'blurFadeRps', group: 'physics', label: 'Borrão some abaixo de (voltas/s)', min: 1, max: 15, step: 0.5 },
  { key: 'wobbleStart', group: 'physics', label: 'Stamina em que o bamboleio começa (0–1)', min: 0, max: 1, step: 0.05 },
  { key: 'wobbleMaxDeg', group: 'physics', label: 'Bamboleio com Stamina zerada (°)', min: 0, max: 35, step: 0.5 },
  { key: 'precessionHz', group: 'physics', label: 'Velocidade da precessão (voltas do eixo/s)', min: 0.1, max: 3, step: 0.05 },
  { key: 'nutation', group: 'physics', label: 'Tremor fino do eixo (nutação)', min: 0, max: 2, step: 0.05 },
  { key: 'tipWander', group: 'physics', label: 'Deriva da ponta (roseta no chão)', min: 0, max: 2, step: 0.05 },
  { key: 'stabilityWobble', group: 'physics', label: 'Bamboleio extra com Stability baixa', min: 0, max: 2, step: 0.05 },
  { key: 'hitTiltDeg', group: 'physics', label: 'Tombo do golpe com Stability zerada (°)', min: 0, max: 45, step: 0.5 },
  { key: 'hitTiltFull', group: 'physics', label: 'Tombo com Stability cheia (fração do valor acima)', min: 0, max: 1, step: 0.05 },
  { key: 'knockback', group: 'physics', label: 'Deslocamento do golpe', min: 0, max: 2, step: 0.05 },
  { key: 'recoverySpeed', group: 'physics', label: 'Rapidez para reerguer depois do golpe', min: 0.5, max: 8, step: 0.1 },
  { key: 'brokenLeanDeg', group: 'physics', label: 'Inclinação fixa quando quebrado (°)', min: 0, max: 30, step: 0.5 },
  { key: 'brokenStutter', group: 'physics', label: 'Engasgos do giro quando quebrado', min: 0, max: 1, step: 0.05 },
  { key: 'spinOutSeconds', group: 'physics', label: 'Duração do spin-out (s)', min: 1, max: 6, step: 0.1 },

  { key: 'aTrail', group: 'A', label: 'Marca da ponta no chão', min: 0, max: 2, step: 0.05 },
  { key: 'aTrailSeconds', group: 'A', label: 'Duração da marca (s)', min: 0.5, max: 8, step: 0.1 },
  { key: 'aRattle', group: 'A', label: 'Folga entre as 4 peças', min: 0, max: 2, step: 0.05 },
  { key: 'aSeamGap', group: 'A', label: 'Abertura das junções', min: 0, max: 2, step: 0.05 },
  { key: 'aWear', group: 'A', label: 'Desgaste do material (escurece e fica fosco)', min: 0, max: 2, step: 0.05 },
  { key: 'aGrind', group: 'A', label: 'Faíscas de raspagem da borda', min: 0, max: 3, step: 0.05 },
  { key: 'aSmoke', group: 'A', label: 'Fumaça quando quebrado', min: 0, max: 3, step: 0.05 },
  { key: 'aShudder', group: 'A', label: 'Trepidação no golpe', min: 0, max: 2, step: 0.05 },
  { key: 'aDebris', group: 'A', label: 'Lascas soltas no golpe', min: 0, max: 3, step: 0.05 },

  { key: 'bAuraHeight', group: 'B', label: 'Altura da aura', min: 0, max: 2.5, step: 0.05 },
  { key: 'bAuraIntensity', group: 'B', label: 'Intensidade da aura', min: 0, max: 2, step: 0.05 },
  { key: 'bAuraBreakup', group: 'B', label: 'Aura se desfaz com Stamina baixa', min: 0, max: 2, step: 0.05 },
  { key: 'bSpinLines', group: 'B', label: 'Linhas de giro (anime)', min: 0, max: 2, step: 0.05 },
  { key: 'bShards', group: 'B', label: 'Escudos de Stability (quantidade)', min: 3, max: 12, step: 1 },
  { key: 'bShardSize', group: 'B', label: 'Tamanho dos escudos', min: 0.4, max: 2, step: 0.05 },
  { key: 'bShardOrbit', group: 'B', label: 'Velocidade de órbita dos escudos', min: 0, max: 3, step: 0.05 },
  { key: 'bDangerShell', group: 'B', label: 'Contorno de perigo quando quebrado', min: 0, max: 2, step: 0.05 },
  { key: 'bDangerHz', group: 'B', label: 'Pulso do perigo (Hz)', min: 0.5, max: 6, step: 0.1 },
  { key: 'bDazed', group: 'B', label: 'Estrelas de tontura quando quebrado', min: 0, max: 2, step: 0.05 },
  { key: 'bArcs', group: 'B', label: 'Raios elétricos quando quebrado', min: 0, max: 3, step: 0.05 },
  { key: 'bGlowDim', group: 'B', label: 'Brilho do Bey apaga com a Stamina', min: 0, max: 1, step: 0.05 },

  { key: 'cRadius', group: 'C', label: 'Raio do anel', min: 0.6, max: 2, step: 0.05 },
  { key: 'cWidth', group: 'C', label: 'Espessura do anel', min: 0.3, max: 2.5, step: 0.05 },
  { key: 'cOpacity', group: 'C', label: 'Opacidade do anel', min: 0, max: 1, step: 0.05 },
  { key: 'cSegments', group: 'C', label: 'Segmentos de Stability', min: 3, max: 16, step: 1 },
  { key: 'cWarnAt', group: 'C', label: 'Stamina de alerta, âmbar (0–1)', min: 0, max: 0.6, step: 0.01 },
  { key: 'cCritAt', group: 'C', label: 'Stamina crítica, vermelho (0–1)', min: 0, max: 0.4, step: 0.01 },
  { key: 'cNotch', group: 'C', label: 'Marcador de rotação no anel', min: 0, max: 1, step: 0.05 },
  { key: 'cCorePulse', group: 'C', label: 'Pulso do núcleo (batimento)', min: 0, max: 2, step: 0.05 },
  { key: 'cHazardSpin', group: 'C', label: 'Giro das listras de perigo', min: 0, max: 3, step: 0.05 },
];

/** Replace live values with `values` (unknown keys ignored, out-of-range values clamped). */
export function applyTuning(values: Partial<Record<string, unknown>>): void {
  for (const spec of TUNING_SPEC) {
    const v = values[spec.key];
    if (typeof v === 'number' && Number.isFinite(v)) TUNING[spec.key] = Math.min(spec.max, Math.max(spec.min, v));
  }
}

export function resetTuning(): void {
  Object.assign(TUNING, APPROVED);
}
