// ============================================================
// CLASH PRESENTATION LAB — TIE PRESENTATION OPTIONS
// The GDD leaves the Tie's PRESENTATION genuinely open (the RULE — no
// winner, no Stability damage, symmetric physical repulsion — is already
// closed in src/combat/clash/ClashTuning.ts and ClashOrchestration.ts).
// These three options are for the owner to pick or mix; none is marked
// official. None of them uses a banner or pauses the fight (show,
// don't tell). Selectable independently of the A/B/C direction, though each
// direction suggests one as its default (DirectionConfig.defaultTieStyle).
// ============================================================

import type { TieStyleConfig, TieStyleId } from './types';

export const TIE_STYLES: Readonly<Record<TieStyleId, TieStyleConfig>> = {
  mirror: {
    id: 'mirror',
    label: 'Espelho Partido',
    blurb: 'Uma onda de choque branca e simétrica separa os dois Beys ao mesmo tempo, e as duas cores piscam juntas por um instante. Nenhum lado "perde" a tela. Sem texto e sem pausa.',
  },
  static: {
    id: 'static',
    label: 'Sobrecarga Estática',
    blurb: 'Um estalo elétrico vermelho no ponto de contato, com faíscas se espalhando para todos os lados, como uma falha. Sem texto e sem pausa.',
  },
  knockdown: {
    id: 'knockdown',
    label: 'Nocaute Duplo',
    blurb: 'Um anel de choque grande e compartilhado no ponto do Clash, com uma nuvem de poeira que empurra os dois Beys para trás simetricamente. Sem texto e sem pausa.',
  },
};

export const TIE_STYLE_IDS: readonly TieStyleId[] = ['mirror', 'static', 'knockdown'];
