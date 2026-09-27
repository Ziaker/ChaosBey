// ============================================================
// CLASH PRESENTATION LAB — TIE PRESENTATION OPTIONS
// The GDD leaves the Tie's PRESENTATION genuinely open (the RULE — no
// winner, no Stability damage, symmetric physical repulsion — is already
// closed in src/combat/clash/ClashTuning.ts and ClashOrchestration.ts).
// These three options are for the owner to pick or mix; none is marked
// official. Selectable independently of the A/B/C direction, though each
// direction suggests one as its default (DirectionConfig.defaultTieStyle).
// ============================================================

import type { TieStyleConfig, TieStyleId } from './types';

export const TIE_STYLES: Readonly<Record<TieStyleId, TieStyleConfig>> = {
  mirror: {
    id: 'mirror',
    label: 'Espelho Partido',
    blurb: 'Uma onda de choque branca e simétrica separa os dois Beys ao mesmo tempo; as duas cores piscam juntas por um instante e desaparecem para neutro. Nenhum lado "perde" a tela.',
    bannerText: 'EMPATE',
  },
  static: {
    id: 'static',
    label: 'Sobrecarga Estática',
    blurb: 'Os dois Beys piscam em vermelho por uma fração de segundo (como uma falha elétrica), faíscas se espalham em todas as direções, e não aparece nenhum banner grande — a leitura fica no HUD de instrumentação, não na tela.',
    bannerText: 'SOBRECARGA — SEM VENCEDOR',
  },
  knockdown: {
    id: 'knockdown',
    label: 'Nocaute Duplo',
    blurb: 'Os dois Beys são arremessados para trás em câmera lenta, simetricamente, com um anel de choque compartilhado no ponto do Clash. Os dois banners "EMPATE" aparecem de cada lado da tela e se encontram no meio.',
    bannerText: 'NOCAUTE DUPLO — EMPATE',
  },
};

export const TIE_STYLE_IDS: readonly TieStyleId[] = ['mirror', 'static', 'knockdown'];
