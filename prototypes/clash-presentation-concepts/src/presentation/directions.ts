// ============================================================
// CLASH PRESENTATION LAB — THE THREE DIRECTIONS
// A, B and C are three complete, clearly different answers to the same
// fixed Clash beat. None is marked as the pick — the owner chooses or
// mixes them after reviewing the artifact (GDD 1.6/1.7).
// ============================================================

import type { DirectionConfig } from './types';

export const DIRECTIONS: Readonly<Record<'A' | 'B' | 'C', DirectionConfig>> = {
  A: {
    id: 'A',
    name: 'Impacto Mecânico',
    tagline: 'Contato seco, leitura em primeiro lugar',
    blurb:
      'Os Beys travam num encaixe duro, pouco inclinados, tremendo de leve. Speedlines finas e discretas, poeira seca e faíscas curtas de metal no ponto de contato. Barra de força técnica e fina. Na resolução, só um clarão curto e o knockback. Empate padrão: "Sobrecarga Estática".',
    animeVsMechanical: 0.15,
    colors: { neutral: 0xaab4c2 },
    entry: { slowMoFactor: 1, slowMoSeconds: 0, snapFlash: 0.3 },
    contact: { leanDeg: 7, wobbleDeg: 1.2, wobbleHz: 9 },
    speedlines: { strength: 0.45, count: 40, tintWithSides: false },
    dust: { particlesPerSecond: 70, size: 0.14, speed: 2.2, sparkShare: 0.35 },
    hud: { style: 'mechanical' },
    pulse: { hitstopSeconds: 0.02, shakeMeters: 0.05, pulseSize: 0.55, useImpactStar: false },
    resolution: { flash: 0.25, burstRings: 1, sparks: 18, dustBurst: 30 },
    arenaClashIntensity: { active: 0.35, resolutionPeak: 0.5 },
    defaultTieStyle: 'static',
    cameraPresetSuggestion: 'A',
  },
  B: {
    id: 'B',
    name: 'Confronto Anime',
    tagline: 'O meio-termo — dramático, mas legível',
    blurb:
      'A entrada puxa em câmera lenta suave. Os Beys se inclinam um contra o outro e vibram com o esforço. Speedlines fortes nas cores dos dois lados convergem no ponto de contato. Uma nuvem de poeira e faíscas sai de baixo deles. Cada mash solta uma estrela de impacto. A barra de força é colorida e pulsa. A resolução é um clarão e uma explosão na cor do vencedor, e o combate segue direto. Empate padrão: "Espelho Partido".',
    animeVsMechanical: 0.6,
    colors: { neutral: 0xff4fa3 },
    entry: { slowMoFactor: 0.5, slowMoSeconds: 0.3, snapFlash: 0.7 },
    contact: { leanDeg: 11, wobbleDeg: 2.2, wobbleHz: 11 },
    speedlines: { strength: 0.75, count: 70, tintWithSides: true },
    dust: { particlesPerSecond: 140, size: 0.2, speed: 3.2, sparkShare: 0.3 },
    hud: { style: 'anime' },
    pulse: { hitstopSeconds: 0.045, shakeMeters: 0.12, pulseSize: 1, useImpactStar: true },
    resolution: { flash: 0.6, burstRings: 2, sparks: 32, dustBurst: 60 },
    arenaClashIntensity: { active: 0.7, resolutionPeak: 1 },
    defaultTieStyle: 'mirror',
    cameraPresetSuggestion: 'B',
  },
  C: {
    id: 'C',
    name: 'Overdrive',
    tagline: 'O teto dramático — espetáculo máximo',
    blurb:
      'A entrada é um corte brusco em câmera lenta forte, com flash branco. Os Beys se inclinam muito, raspando e tremendo violentamente. Speedlines densas e brilhantes tomam a borda da tela, deixando livre só o centro da disputa. Tem muita poeira e muitas faíscas. Todo mash solta estrela e onda de choque grandes. A barra de força é grossa e brilhante. A resolução é uma explosão multi-anel sem pausa. Empate padrão: "Nocaute Duplo".',
    animeVsMechanical: 0.95,
    colors: { neutral: 0xffe066 },
    entry: { slowMoFactor: 0.3, slowMoSeconds: 0.5, snapFlash: 1 },
    contact: { leanDeg: 15, wobbleDeg: 3.5, wobbleHz: 13 },
    speedlines: { strength: 1, count: 110, tintWithSides: true },
    dust: { particlesPerSecond: 230, size: 0.26, speed: 4.2, sparkShare: 0.28 },
    hud: { style: 'overdrive' },
    pulse: { hitstopSeconds: 0.07, shakeMeters: 0.22, pulseSize: 1.6, useImpactStar: true },
    resolution: { flash: 1, burstRings: 4, sparks: 50, dustBurst: 100 },
    arenaClashIntensity: { active: 1, resolutionPeak: 1 },
    defaultTieStyle: 'knockdown',
    cameraPresetSuggestion: 'C',
  },
};

export const DIRECTION_IDS: readonly ('A' | 'B' | 'C')[] = ['A', 'B', 'C'];
