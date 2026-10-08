// ============================================================
// BEY FLOW FX LAB — HIT / BLOCK / COUNTER CALLOUTS
// Three candidate looks for the floating combat word. The owner chose A
// (Quadrinho) on 2026-10-08 and asked that the words be an OPTION in the
// game's Settings; B and C stay here only as history.
//
//   A — Quadrinho:  comic burst, thick outline, wobbling pop (Western comic).
//   B — Arcade:     chunky pixel-ish letters with a stepped shadow, bounce
//                   (the PS1/PS2-era look of the references).
//   C — Cinético:   clean wide-tracked caps with a slash, slides in and
//                   cuts out; colour-coded, the least noisy.
//
// The words are DOM elements (CSS in index.html does the look and the
// animation), projected from a world point. Presentation only.
// ============================================================

import type { CalloutKind } from '../sim/FlowSim';

export type CalloutStyleId = 'A' | 'B' | 'C';

export interface CalloutStyleInfo {
  readonly id: CalloutStyleId;
  readonly label: string;
  readonly description: string;
}

export const CALLOUT_STYLES: readonly CalloutStyleInfo[] = [
  { id: 'A', label: 'A — Quadrinho (escolhido)', description: 'Explosão de gibi: contorno grosso, balanço ao aparecer. Escolhido pelo owner; no jogo será uma opção nas Configurações.' },
  { id: 'B', label: 'B — Arcade', description: 'Letras grossas com sombra em degraus, quique (estilo dos jogos de PS1/PS2).' },
  { id: 'C', label: 'C — Cinético', description: 'Maiúsculas limpas com corte diagonal; desliza e some. O mais discreto.' },
];

export const CALLOUT_WORDS: Readonly<Record<CalloutKind, string>> = {
  hit: 'HIT',
  block: 'BLOCK',
  counter: 'COUNTER!',
};

/** What each word means, for the lab's legend (GDD terms: a Circular that catches a Dash is a counter). */
export const CALLOUT_MEANING: Readonly<Record<CalloutKind, string>> = {
  hit: 'Golpe que acerta.',
  block: 'Golpe absorvido pelo defensor.',
  counter: 'Circular que pega um Dash.',
};

export class CalloutLayer {
  private readonly live = new Set<HTMLElement>();

  constructor(private readonly host: HTMLElement) {}

  get liveCount(): number {
    return this.live.size;
  }

  /** `x`, `y` are pixels inside the host; `m` (0..1) makes bigger hits bigger. */
  spawn(kind: CalloutKind, style: CalloutStyleId, x: number, y: number, scale: number, lifeS: number, m: number): HTMLElement {
    const el = document.createElement('div');
    el.className = `callout style-${style.toLowerCase()} kind-${kind}`;
    el.textContent = CALLOUT_WORDS[kind];
    el.dataset.text = CALLOUT_WORDS[kind];
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.setProperty('--scale', String(scale * (0.8 + 0.5 * m)));
    el.style.setProperty('--life', `${lifeS}s`);
    el.style.setProperty('--tilt', `${(Math.random() - 0.5) * 10}deg`);
    this.host.appendChild(el);
    this.live.add(el);
    const remove = (): void => {
      this.live.delete(el);
      el.remove();
    };
    el.addEventListener('animationend', remove, { once: true });
    window.setTimeout(remove, lifeS * 1000 + 250); // safety net if animations are reduced
    return el;
  }

  clear(): void {
    for (const el of this.live) el.remove();
    this.live.clear();
  }
}
