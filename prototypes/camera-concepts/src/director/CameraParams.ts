// ============================================================
// CAMERA LAB — PARAMETERS AND THE THREE PRESETS
// Every value the Camera Director reads, with its range and meaning, and
// the three directions proposed for approval. PROTOTYPE VALUES (GDD 167):
// nothing here is approved until the owner picks a direction or a mix.
//
//   A  Arena Fighter / Readability First — the most consistent framing:
//      contained orbit, heavy damping, gentle FOV, no side switching.
//   B  Cinematic Hybrid — livelier: contextual orbit, look-ahead, clear
//      speed FOV, controlled reframing on Dash/knockback, rare side swaps.
//   C  Hyper Dynamic — the dramatic ceiling the GDD allows: strong orbit,
//      big distance swings, aggressive FOV and pull-back, strong
//      look-ahead, impacts re-compose the shot, the side changes with the
//      action — still with every readability guard on.
//
// Units are in the labels. "per s" smoothing rates are exponential
// (1 - e^(-rate·dt)), so they behave the same at any frame rate.
// ============================================================

export type PresetId = 'A' | 'B' | 'C';
export const PRESET_IDS: readonly PresetId[] = ['A', 'B', 'C'];

export interface CameraParams {
  // FOV
  baseFov: number;
  maxFov: number;
  fovSpeedStrength: number;
  fovSpeedCurve: number;
  fovDamping: number;
  fovMaxRate: number;
  impactFovPunch: number;
  // Distance & height
  minDistance: number;
  maxDistance: number;
  separationResponse: number;
  distanceDeadband: number;
  cameraHeight: number;
  verticalOffset: number;
  // Orbit & side
  lateralOffset: number;
  orbitStrength: number;
  orbitSpeed: number;
  orbitDamping: number;
  sideSwitchCooldown: number;
  // Smoothing
  positionDamping: number;
  rotationDamping: number;
  transitionSpeed: number;
  // Framing & look-ahead
  framingBias: number;
  opponentWeight: number;
  lookAheadStrength: number;
  velocityLookAhead: number;
  accelLookAhead: number;
  encounterWeight: number;
  // Contexts
  highSpeedPullback: number;
  closePushIn: number;
  knockbackFollow: number;
  knockbackDelay: number;
  recoverySpeed: number;
  impactReframe: number;
  // Shake
  shakeIntensity: number;
  shakeDecay: number;
  speedShake: number;
  impactShake: number;
  // Readability guards
  speedFilterHz: number;
  microImpactThreshold: number;
  floorClearance: number;
  beyClearance: number;
  offscreenRescue: number;
}

export const PRESETS: Readonly<Record<PresetId, Readonly<CameraParams>>> = {
  A: {
    baseFov: 58, maxFov: 74, fovSpeedStrength: 0.6, fovSpeedCurve: 1.4, fovDamping: 2.5, fovMaxRate: 35, impactFovPunch: 3,
    minDistance: 8.5, maxDistance: 15, separationResponse: 0.55, distanceDeadband: 0.6, cameraHeight: 6, verticalOffset: 0.4,
    lateralOffset: 14, orbitStrength: 0.2, orbitSpeed: 40, orbitDamping: 2, sideSwitchCooldown: 60,
    positionDamping: 4, rotationDamping: 5, transitionSpeed: 2,
    framingBias: 0.5, opponentWeight: 1, lookAheadStrength: 0.3, velocityLookAhead: 0.25, accelLookAhead: 0, encounterWeight: 0.3,
    highSpeedPullback: 1.5, closePushIn: 1, knockbackFollow: 0.3, knockbackDelay: 0.12, recoverySpeed: 1.5, impactReframe: 0,
    shakeIntensity: 0.6, shakeDecay: 9, speedShake: 0, impactShake: 0.6,
    speedFilterHz: 1.5, microImpactThreshold: 0.25, floorClearance: 1.5, beyClearance: 2.5, offscreenRescue: 1,
  },
  B: {
    baseFov: 62, maxFov: 88, fovSpeedStrength: 0.85, fovSpeedCurve: 1.1, fovDamping: 3.5, fovMaxRate: 60, impactFovPunch: 6,
    minDistance: 7.2, maxDistance: 17, separationResponse: 0.62, distanceDeadband: 0.4, cameraHeight: 5, verticalOffset: 0.5,
    lateralOffset: 20, orbitStrength: 0.6, orbitSpeed: 70, orbitDamping: 3, sideSwitchCooldown: 6,
    positionDamping: 5.5, rotationDamping: 7, transitionSpeed: 3,
    framingBias: 0.55, opponentWeight: 0.85, lookAheadStrength: 0.7, velocityLookAhead: 0.4, accelLookAhead: 0.03, encounterWeight: 0.6,
    highSpeedPullback: 2.2, closePushIn: 1.8, knockbackFollow: 0.55, knockbackDelay: 0.08, recoverySpeed: 2, impactReframe: 8,
    shakeIntensity: 1, shakeDecay: 7, speedShake: 0.3, impactShake: 1,
    speedFilterHz: 2.5, microImpactThreshold: 0.18, floorClearance: 1.2, beyClearance: 2, offscreenRescue: 1,
  },
  C: {
    baseFov: 66, maxFov: 100, fovSpeedStrength: 1, fovSpeedCurve: 0.9, fovDamping: 5, fovMaxRate: 110, impactFovPunch: 11,
    minDistance: 6, maxDistance: 20, separationResponse: 0.75, distanceDeadband: 0.25, cameraHeight: 4, verticalOffset: 0.6,
    lateralOffset: 28, orbitStrength: 1, orbitSpeed: 105, orbitDamping: 4.5, sideSwitchCooldown: 3,
    positionDamping: 7.5, rotationDamping: 10, transitionSpeed: 4.5,
    framingBias: 0.6, opponentWeight: 0.7, lookAheadStrength: 1, velocityLookAhead: 0.6, accelLookAhead: 0.06, encounterWeight: 0.9,
    highSpeedPullback: 3.2, closePushIn: 2.6, knockbackFollow: 0.85, knockbackDelay: 0.04, recoverySpeed: 2.5, impactReframe: 20,
    shakeIntensity: 1.4, shakeDecay: 5.5, speedShake: 0.7, impactShake: 1.4,
    speedFilterHz: 3.5, microImpactThreshold: 0.12, floorClearance: 0.9, beyClearance: 1.6, offscreenRescue: 1,
  },
};

export interface ParamSpec {
  readonly key: keyof CameraParams;
  readonly group: string;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  /** What it does, shown as a tooltip and in the README. */
  readonly doc: string;
}

export const PARAM_GROUPS = [
  'FOV',
  'Distância e altura',
  'Órbita e lado',
  'Suavização',
  'Enquadramento e look-ahead',
  'Contextos',
  'Shake',
  'Proteções de leitura',
] as const;

export const PARAM_SPEC: readonly ParamSpec[] = [
  { key: 'baseFov', group: 'FOV', label: 'FOV base (°)', min: 40, max: 90, step: 1, doc: 'FOV vertical parado. Configurável no pré-jogo pelo GDD.' },
  { key: 'maxFov', group: 'FOV', label: 'FOV máximo (°, teto 120)', min: 50, max: 120, step: 1, doc: 'Até onde a velocidade abre o FOV. O teto conceitual do GDD é 120°.' },
  { key: 'fovSpeedStrength', group: 'FOV', label: 'Força velocidade → FOV', min: 0, max: 1, step: 0.05, doc: '0 = FOV não muda com velocidade; 1 = chega ao máximo na velocidade de referência (16 m/s).' },
  { key: 'fovSpeedCurve', group: 'FOV', label: 'Curva velocidade → FOV (1 = linear)', min: 0.4, max: 3, step: 0.05, doc: '>1 guarda a abertura para as velocidades altas; <1 abre cedo.' },
  { key: 'fovDamping', group: 'FOV', label: 'Resposta do FOV (por s)', min: 0.5, max: 12, step: 0.1, doc: 'Quão rápido o FOV persegue o alvo.' },
  { key: 'fovMaxRate', group: 'FOV', label: 'Variação máxima do FOV (°/s)', min: 5, max: 200, step: 5, doc: 'Trava contra FOV pulsando: limite de graus por segundo.' },
  { key: 'impactFovPunch', group: 'FOV', label: 'Soco de FOV no impacto (°)', min: 0, max: 20, step: 0.5, doc: 'Abertura rápida de FOV num impacto forte, proporcional à magnitude.' },

  { key: 'minDistance', group: 'Distância e altura', label: 'Distância mínima (m)', min: 3, max: 14, step: 0.1, doc: 'Distância horizontal do olho ao alvo com os Beys juntos.' },
  { key: 'maxDistance', group: 'Distância e altura', label: 'Distância máxima (m)', min: 8, max: 30, step: 0.5, doc: 'Limite de afastamento.' },
  { key: 'separationResponse', group: 'Distância e altura', label: 'Resposta à separação (m por m)', min: 0, max: 1.5, step: 0.05, doc: 'Quanto a câmera recua por metro de separação acima de 3 m.' },
  { key: 'distanceDeadband', group: 'Distância e altura', label: 'Zona morta da distância (m)', min: 0, max: 2, step: 0.05, doc: 'Trava contra zoom oscilando: o alvo de distância só muda quando a diferença passa disso.' },
  { key: 'cameraHeight', group: 'Distância e altura', label: 'Altura da câmera (m)', min: 1.5, max: 12, step: 0.1, doc: 'Altura do olho acima do alvo na distância mínima (sobe um pouco com a distância).' },
  { key: 'verticalOffset', group: 'Distância e altura', label: 'Offset vertical do alvo (m)', min: -1, max: 3, step: 0.05, doc: 'Eleva o ponto para onde a câmera olha.' },

  { key: 'lateralOffset', group: 'Órbita e lado', label: 'Offset lateral / ombro (°)', min: 0, max: 60, step: 1, doc: 'Quanto a câmera sai de trás do jogador para um lado (o "semi" do semi-over-the-shoulder).' },
  { key: 'orbitStrength', group: 'Órbita e lado', label: 'Força da órbita', min: 0, max: 1.5, step: 0.05, doc: 'Quanto a câmera acompanha o movimento circular da luta (e deriva sozinha no combate próximo).' },
  { key: 'orbitSpeed', group: 'Órbita e lado', label: 'Velocidade máxima de órbita (°/s)', min: 10, max: 240, step: 5, doc: 'Trava anti-enjoo: a câmera nunca gira mais rápido que isso.' },
  { key: 'orbitDamping', group: 'Órbita e lado', label: 'Suavização da órbita (por s)', min: 0.5, max: 12, step: 0.1, doc: 'Quão rápido o ângulo da câmera persegue o alvo.' },
  { key: 'sideSwitchCooldown', group: 'Órbita e lado', label: 'Intervalo mínimo entre trocas de lado (s, 60 = nunca)', min: 1, max: 60, step: 0.5, doc: 'Trava contra a câmera trocando de lado várias vezes em poucos segundos.' },

  { key: 'positionDamping', group: 'Suavização', label: 'Suavização de posição (por s)', min: 0.5, max: 15, step: 0.1, doc: 'Quão rápido o olho alcança a posição desejada. Alto = chega junto; baixo = atrasa.' },
  { key: 'rotationDamping', group: 'Suavização', label: 'Suavização do alvo / rotação (por s)', min: 0.5, max: 20, step: 0.1, doc: 'Quão rápido o ponto olhado alcança o alvo.' },
  { key: 'transitionSpeed', group: 'Suavização', label: 'Velocidade de transição entre modos (por s)', min: 0.5, max: 10, step: 0.1, doc: 'Quão rápido um contexto (alta velocidade, perto, knockback, Clash...) entra e sai.' },

  { key: 'framingBias', group: 'Enquadramento e look-ahead', label: 'Viés do alvo (0 = jogador, 0,5 = meio, 1 = oponente)', min: 0, max: 1, step: 0.05, doc: 'Onde fica o ponto olhado na linha jogador → oponente.' },
  { key: 'opponentWeight', group: 'Enquadramento e look-ahead', label: 'Peso do oponente na direção', min: 0, max: 1, step: 0.05, doc: '1 = a câmera sempre alinha no eixo jogador → oponente (foco no oponente do GDD); menos = mistura com a direção de movimento do jogador.' },
  { key: 'lookAheadStrength', group: 'Enquadramento e look-ahead', label: 'Força do look-ahead', min: 0, max: 1.5, step: 0.05, doc: 'Multiplicador geral do adiantamento na direção do movimento.' },
  { key: 'velocityLookAhead', group: 'Enquadramento e look-ahead', label: 'Look-ahead de velocidade (s à frente)', min: 0, max: 1.2, step: 0.05, doc: 'Quantos segundos de movimento a câmera antecipa.' },
  { key: 'accelLookAhead', group: 'Enquadramento e look-ahead', label: 'Look-ahead de aceleração (s²)', min: 0, max: 0.2, step: 0.005, doc: 'Antecipa mudanças de velocidade (arrancadas, Dash).' },
  { key: 'encounterWeight', group: 'Enquadramento e look-ahead', label: 'Previsão de encontro', min: 0, max: 1, step: 0.05, doc: 'Quando os dois vão se cruzar em até 1,2 s, puxa o enquadramento para o ponto do encontro e abre um pouco.' },

  { key: 'highSpeedPullback', group: 'Contextos', label: 'Recuo em alta velocidade (m)', min: 0, max: 8, step: 0.1, doc: 'Distância extra quando algum Bey passa de ~9–15 m/s.' },
  { key: 'closePushIn', group: 'Contextos', label: 'Aproximação no combate próximo (m)', min: 0, max: 4, step: 0.1, doc: 'Quanto a câmera se aproxima com os Beys a menos de ~2–4 m.' },
  { key: 'knockbackFollow', group: 'Contextos', label: 'Força do knockback follow', min: 0, max: 1, step: 0.05, doc: 'Quanto o enquadramento segue o Bey arremessado.' },
  { key: 'knockbackDelay', group: 'Contextos', label: 'Atraso do knockback follow (s)', min: 0, max: 0.5, step: 0.01, doc: 'Espera antes de começar a seguir, para o impacto ser lido parado.' },
  { key: 'recoverySpeed', group: 'Contextos', label: 'Recuperação após deslocamento cinemático (por s)', min: 0.3, max: 6, step: 0.1, doc: 'Quão rápido o knockback follow e os empurrões de impacto voltam ao normal.' },
  { key: 'impactReframe', group: 'Contextos', label: 'Reenquadramento no impacto (°)', min: 0, max: 40, step: 1, doc: 'Giro de câmera num impacto grande para mostrar a trajetória de lado.' },

  { key: 'shakeIntensity', group: 'Shake', label: 'Intensidade geral do shake', min: 0, max: 2.5, step: 0.05, doc: 'Multiplicador de todo tremor (acessibilidade, GDD 121).' },
  { key: 'shakeDecay', group: 'Shake', label: 'Decaimento do shake (por s)', min: 1, max: 20, step: 0.5, doc: 'Quão rápido o tremor de impacto some.' },
  { key: 'speedShake', group: 'Shake', label: 'Contribuição da velocidade', min: 0, max: 2, step: 0.05, doc: 'Tremor contínuo leve em alta velocidade.' },
  { key: 'impactShake', group: 'Shake', label: 'Contribuição do impacto', min: 0, max: 2.5, step: 0.05, doc: 'Tremor por impacto, proporcional à magnitude.' },

  { key: 'speedFilterHz', group: 'Proteções de leitura', label: 'Filtro da velocidade (Hz)', min: 0.3, max: 10, step: 0.1, doc: 'Trava contra FOV/recuo pulsando por ruído: a velocidade usada passa por um passa-baixa.' },
  { key: 'microImpactThreshold', group: 'Proteções de leitura', label: 'Ignorar impactos abaixo de (magnitude 0–1)', min: 0, max: 0.6, step: 0.01, doc: 'Trava contra reagir violentamente a microimpactos.' },
  { key: 'floorClearance', group: 'Proteções de leitura', label: 'Altura mínima acima do chão (m)', min: 0.3, max: 4, step: 0.1, doc: 'A câmera nunca entra no chão.' },
  { key: 'beyClearance', group: 'Proteções de leitura', label: 'Distância mínima de qualquer Bey (m)', min: 0.8, max: 5, step: 0.1, doc: 'A câmera nunca atravessa um Bey.' },
  { key: 'offscreenRescue', group: 'Proteções de leitura', label: 'Resgate de Bey fora do quadro', min: 0, max: 2, step: 0.05, doc: 'Se um Bey sai do quadro, a câmera recua, abre o FOV e puxa o alvo até ele voltar.' },
];

export function cloneParams(p: Readonly<CameraParams>): CameraParams {
  return { ...p };
}

/** Apply values over `target` (unknown keys ignored, out-of-range values clamped). */
export function applyParams(target: CameraParams, values: Partial<Record<string, unknown>>): void {
  for (const spec of PARAM_SPEC) {
    const v = values[spec.key];
    if (typeof v === 'number' && Number.isFinite(v)) target[spec.key] = Math.min(spec.max, Math.max(spec.min, v));
  }
}
