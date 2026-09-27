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
      'A entrada é um encaixe duro, sem câmera lenta. A energia entre os Beys é um arco elétrico fino, quase técnico. Cada mash é uma faísca curta e um hitstop mínimo — tátil, nunca espetacular. A arena mal reage. A resolução é um golpe direcional seco: sem clarão grande, sem banner enorme. O empate por padrão é "Sobrecarga Estática".',
    animeVsMechanical: 0.15,
    colors: { first: 0x6fd3ff, second: 0xffb347, neutral: 0xaab4c2 },
    entry: { slowMoFactor: 1, slowMoSeconds: 0, snapFlash: 0.3 },
    energy: { style: 'arc', baseRadius: 0.16, swingReactivity: 0.6 },
    pulse: { hitstopSeconds: 0.02, shakeMeters: 0.05, pulseSize: 0.55, useImpactStar: false },
    resolution: { hitstopSeconds: 0.12, slowMoFactor: 0.6, slowMoSeconds: 0.25, burstRings: 1, bannerStyle: 'quiet' },
    arenaClashIntensity: { active: 0.35, resolutionPeak: 0.5 },
    defaultTieStyle: 'static',
    cameraPresetSuggestion: 'A',
  },
  B: {
    id: 'B',
    name: 'Confronto Anime',
    tagline: 'O meio-termo — dramático, mas legível',
    blurb:
      'A entrada puxa em câmera lenta suave e trava num flash de choque. A energia é uma dupla-hélice colorida, nas cores dos dois Beys, girando mais rápido conforme o progresso. Cada mash solta uma estrela de impacto e um anel de choque, com hitstop e shake proporcionais. A resolução é uma explosão dupla na cor do vencedor, com banner "VITÓRIA/DERROTA" cheio de tela. O empate por padrão é "Espelho Partido".',
    animeVsMechanical: 0.6,
    colors: { first: 0x6fd3ff, second: 0xffb347, neutral: 0xff4fa3 },
    entry: { slowMoFactor: 0.5, slowMoSeconds: 0.3, snapFlash: 0.7 },
    energy: { style: 'helix', baseRadius: 0.26, swingReactivity: 1 },
    pulse: { hitstopSeconds: 0.045, shakeMeters: 0.12, pulseSize: 1, useImpactStar: true },
    resolution: { hitstopSeconds: 0.28, slowMoFactor: 0.35, slowMoSeconds: 0.5, burstRings: 2, bannerStyle: 'bold' },
    arenaClashIntensity: { active: 0.7, resolutionPeak: 1 },
    defaultTieStyle: 'mirror',
    cameraPresetSuggestion: 'B',
  },
  C: {
    id: 'C',
    name: 'Overdrive',
    tagline: 'O teto dramático — espetáculo máximo',
    blurb:
      'A entrada é um zoom brusco em câmera lenta forte, com flash branco de tela cheia. A energia é um vórtice tipo Cel Cyclone envolvendo os dois Beys, girando com violência e virando de lado a cada virada de vantagem. Todo mash pulsa estrela + onda de choque grandes, com hitstop e shake fortes. A resolução é uma explosão multi-anel com hitstop longo, câmera lenta de rescaldo e um banner dramático de "FINALIZAÇÃO". O empate por padrão é "Nocaute Duplo".',
    animeVsMechanical: 0.95,
    colors: { first: 0x6fd3ff, second: 0xffb347, neutral: 0xffe066 },
    entry: { slowMoFactor: 0.3, slowMoSeconds: 0.5, snapFlash: 1 },
    energy: { style: 'vortex', baseRadius: 0.4, swingReactivity: 1.6 },
    pulse: { hitstopSeconds: 0.07, shakeMeters: 0.22, pulseSize: 1.6, useImpactStar: true },
    resolution: { hitstopSeconds: 0.5, slowMoFactor: 0.2, slowMoSeconds: 0.9, burstRings: 4, bannerStyle: 'dramatic' },
    arenaClashIntensity: { active: 1, resolutionPeak: 1 },
    defaultTieStyle: 'knockdown',
    cameraPresetSuggestion: 'C',
  },
};

export const DIRECTION_IDS: readonly ('A' | 'B' | 'C')[] = ['A', 'B', 'C'];
