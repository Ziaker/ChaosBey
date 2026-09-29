// ============================================================
// SFX LAB — CONTEXT SEQUENCES (a sound in its situation)
// Some sounds only make sense next to others: a Dash is charge → full →
// release → hit; a Clash is start → tension → mash → resolution; a KO
// needs the round-result stinger after it. These short scripted scenes
// play the current per-event choices in context. They are choreography
// for listening, not gameplay (the real match lives in LiveMatch.ts).
// ============================================================

import { mulberry32 } from './engine/variation';

export type Side = 'first' | 'second';

export interface SequenceStep {
  readonly atS: number;
  readonly eventId: string;
  readonly magnitude?: number;
  readonly side?: Side;
  readonly pan?: number;
}

/** A loop's level/param glide between two times. */
export interface LoopRamp {
  readonly key: string;
  readonly eventId: string;
  readonly fromS: number;
  readonly toS: number;
  readonly level: readonly [number, number];
  readonly param: readonly [number, number];
  readonly aux?: readonly [number, number];
  readonly pan?: number;
  readonly archetypeId?: string;
}

export interface Sequence {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly durationS: number;
  readonly steps: readonly SequenceStep[];
  readonly loops: readonly LoopRamp[];
}

const L = -0.45;
const R = 0.45;

function spinBed(durationS: number, levels: readonly [number, number] = [1, 1]): LoopRamp[] {
  return [
    { key: 'spinHum:first', eventId: 'spinHum', fromS: 0, toS: durationS, level: levels, param: [0.95, 0.85], pan: L, archetypeId: 'attack-prototype' },
    { key: 'spinHum:second', eventId: 'spinHum', fromS: 0, toS: durationS, level: levels, param: [0.9, 0.8], pan: R, archetypeId: 'defense-prototype' },
  ];
}

function clashScene(outcomeEvent: 'clashResolve' | 'clashTie'): Sequence {
  const steps: SequenceStep[] = [{ atS: 0.1, eventId: 'clashStart' }];
  // Mash from both sides, accelerating as the contest heats up.
  let t = 0.45;
  let side: Side = 'first';
  while (t < 4.05) {
    const progress = (t - 0.1) / 4;
    steps.push({ atS: t, eventId: 'clashMash', magnitude: progress, side, pan: side === 'first' ? L : R });
    t += 0.2 - 0.12 * progress;
    side = side === 'first' ? 'second' : 'first';
  }
  steps.push({ atS: 4.15, eventId: outcomeEvent });
  if (outcomeEvent === 'clashResolve') steps.push({ atS: 4.4, eventId: 'wallImpact', magnitude: 0.75, side: 'second', pan: R });
  return {
    id: outcomeEvent === 'clashResolve' ? 'clash' : 'clash-tie',
    label: outcomeEvent === 'clashResolve' ? 'Clash completo (vencedor)' : 'Clash empatado',
    description: outcomeEvent === 'clashResolve' ? 'Início, ~4 s de tensão com mash dos dois lados, resolução sem pausa e o knockback batendo na parede.' : 'Mesmo Clash terminando em empate (estilo visual de empate ainda aberto).',
    durationS: 5.4,
    steps,
    loops: [
      ...spinBed(5.4, [0.35, 0.35]),
      { key: 'clashTension', eventId: 'clashTension', fromS: 0.1, toS: 4.15, level: [1, 1], param: [0, 1], aux: [0, 0.4] },
      { key: 'clashTension', eventId: 'clashTension', fromS: 4.15, toS: 4.2, level: [0, 0], param: [1, 1] },
    ],
  };
}

function mixStress(): Sequence {
  const random = mulberry32(0xc0ffee);
  const steps: SequenceStep[] = [];
  for (let t = 0.1; t < 4.6; t += 0.07 + random() * 0.08) {
    const roll = random();
    const pan = random() * 1.4 - 0.7;
    if (roll < 0.45) steps.push({ atS: t, eventId: 'beyContact', magnitude: random(), pan });
    else if (roll < 0.65) steps.push({ atS: t, eventId: 'wallImpact', magnitude: random(), side: pan < 0 ? 'first' : 'second', pan });
    else if (roll < 0.85) steps.push({ atS: t, eventId: 'hit', magnitude: 0.3 + random() * 0.7, pan });
    else steps.push({ atS: t, eventId: roll < 0.93 ? 'circularStart' : 'dodge', side: pan < 0 ? 'first' : 'second', pan });
  }
  steps.push({ atS: 4.7, eventId: 'ko', side: 'second', pan: R });
  steps.push({ atS: 5.45, eventId: 'victory' });
  return {
    id: 'mix-stress',
    label: 'Teste de poluição (luta densa)',
    description: 'Contatos, quiques e acertos quase sem pausa, com giro e atrito ligados. Ouça o mix cortar repetições e o KO "furar" tudo. O log mostra o que foi descartado e por quê.',
    durationS: 7.2,
    steps,
    loops: [
      ...spinBed(7.2),
      { key: 'floorScrape:first', eventId: 'floorScrape', fromS: 0, toS: 4.6, level: [0.5, 0.9], param: [0.6, 1], pan: L },
      { key: 'floorScrape:second', eventId: 'floorScrape', fromS: 0, toS: 4.6, level: [0.8, 0.4], param: [1, 0.5], pan: R },
      { key: 'floorScrape:first', eventId: 'floorScrape', fromS: 4.6, toS: 4.8, level: [0, 0], param: [0.2, 0.2], pan: L },
      { key: 'floorScrape:second', eventId: 'floorScrape', fromS: 4.6, toS: 4.8, level: [0, 0], param: [0.2, 0.2], pan: R },
    ],
  };
}

export const SEQUENCES: readonly Sequence[] = [
  {
    id: 'exchange',
    label: 'Troca de golpes',
    description: 'Contato, Circular, acerto, quique, esquiva e um Dash completo (carga → máxima → disparo → acerto pesado → parede).',
    durationS: 4.3,
    steps: [
      { atS: 0.2, eventId: 'beyContact', magnitude: 0.35 },
      { atS: 0.55, eventId: 'circularStart', side: 'first', pan: L },
      { atS: 0.7, eventId: 'hit', magnitude: 0.45, pan: R },
      { atS: 1.05, eventId: 'wallImpact', magnitude: 0.55, side: 'second', pan: 0.7 },
      { atS: 1.5, eventId: 'dodge', side: 'second', pan: R },
      { atS: 1.75, eventId: 'circularStart', side: 'first', pan: L },
      { atS: 1.85, eventId: 'dodged', side: 'second', pan: R },
      { atS: 3.0, eventId: 'dashFull', side: 'first', pan: L },
      { atS: 3.2, eventId: 'dashRelease', magnitude: 1, side: 'first', pan: L },
      { atS: 3.36, eventId: 'hit', magnitude: 0.9, pan: R },
      { atS: 3.7, eventId: 'wallImpact', magnitude: 0.85, side: 'second', pan: 0.75 },
    ],
    loops: [
      ...spinBed(4.3),
      { key: 'floorScrape:first', eventId: 'floorScrape', fromS: 0, toS: 1.2, level: [0.3, 0.6], param: [0.5, 0.8], pan: L },
      { key: 'floorScrape:first', eventId: 'floorScrape', fromS: 1.2, toS: 2.2, level: [0.6, 0], param: [0.8, 0.3], pan: L },
      { key: 'dashCharge:first', eventId: 'dashCharge', fromS: 2.2, toS: 3.0, level: [1, 1], param: [0, 1], pan: L },
      { key: 'dashCharge:first', eventId: 'dashCharge', fromS: 3.0, toS: 3.2, level: [1, 1], param: [1, 1], pan: L },
      { key: 'dashCharge:first', eventId: 'dashCharge', fromS: 3.2, toS: 3.25, level: [0, 0], param: [1, 1], pan: L },
    ],
  },
  {
    id: 'counter',
    label: 'Counter e aterrissagem',
    description: 'O oponente carrega e dispara o Dash; o Circular do jogador o pega no ar (Counter) e ele cai pesado.',
    durationS: 2.8,
    steps: [
      { atS: 0.8, eventId: 'dashRelease', magnitude: 0.7, side: 'second', pan: R },
      { atS: 0.95, eventId: 'circularStart', side: 'first', pan: L },
      { atS: 1.05, eventId: 'counter', pan: 0.2 },
      { atS: 1.95, eventId: 'landing', magnitude: 0.85, side: 'second', pan: 0.6 },
    ],
    loops: [...spinBed(2.8), { key: 'dashCharge:second', eventId: 'dashCharge', fromS: 0.1, toS: 0.8, level: [1, 1], param: [0, 0.7], pan: R }, { key: 'dashCharge:second', eventId: 'dashCharge', fromS: 0.8, toS: 0.85, level: [0, 0], param: [0.7, 0.7], pan: R }],
  },
  {
    id: 'perfect-dodge',
    label: 'Perfect Dodge',
    description: 'O Dash do oponente é esquivado no último instante e ele segue até a parede.',
    durationS: 2.2,
    steps: [
      { atS: 0.65, eventId: 'dashRelease', magnitude: 0.6, side: 'second', pan: R },
      { atS: 0.76, eventId: 'dodge', side: 'first', pan: L },
      { atS: 0.84, eventId: 'perfectDodge', side: 'first', pan: L },
      { atS: 1.35, eventId: 'wallImpact', magnitude: 0.45, side: 'second', pan: -0.7 },
    ],
    loops: [...spinBed(2.2), { key: 'dashCharge:second', eventId: 'dashCharge', fromS: 0.05, toS: 0.65, level: [1, 1], param: [0, 0.6], pan: R }, { key: 'dashCharge:second', eventId: 'dashCharge', fromS: 0.65, toS: 0.7, level: [0, 0], param: [0.6, 0.6], pan: R }],
  },
  clashScene('clashResolve'),
  clashScene('clashTie'),
  {
    id: 'break',
    label: 'Quebra e recuperação',
    description: 'Três acertos derrubam a Estabilidade (Quebrado, com o giro tremendo) e, sem apanhar, ele se recupera.',
    durationS: 5,
    steps: [
      { atS: 0.2, eventId: 'hit', magnitude: 0.55, pan: R },
      { atS: 0.7, eventId: 'hit', magnitude: 0.7, pan: R },
      { atS: 1.2, eventId: 'hit', magnitude: 0.8, pan: R },
      { atS: 1.25, eventId: 'stabilityBreak', side: 'second', pan: R },
      { atS: 4.0, eventId: 'stabilityRecover', side: 'second', pan: R },
    ],
    loops: [
      { key: 'spinHum:first', eventId: 'spinHum', fromS: 0, toS: 5, level: [1, 1], param: [0.9, 0.85], pan: L, archetypeId: 'attack-prototype' },
      { key: 'spinHum:second', eventId: 'spinHum', fromS: 0, toS: 1.25, level: [1, 1], param: [0.8, 0.7], aux: [0, 0.2], pan: R, archetypeId: 'defense-prototype' },
      { key: 'spinHum:second', eventId: 'spinHum', fromS: 1.25, toS: 4.0, level: [1, 1], param: [0.6, 0.55], aux: [1, 0.8], pan: R, archetypeId: 'defense-prototype' },
      { key: 'spinHum:second', eventId: 'spinHum', fromS: 4.0, toS: 5, level: [1, 1], param: [0.6, 0.6], aux: [0.3, 0], pan: R, archetypeId: 'defense-prototype' },
    ],
  },
  {
    id: 'ring-out',
    label: 'Fim por Ring-Out',
    description: 'O oponente é empurrado raspando na parede, leva um golpe final e sai do estádio; stinger de vitória.',
    durationS: 4.2,
    steps: [
      { atS: 1.3, eventId: 'hit', magnitude: 0.95, pan: 0.6 },
      { atS: 1.5, eventId: 'wallImpact', magnitude: 0.9, side: 'second', pan: 0.8 },
      { atS: 1.72, eventId: 'ringOut', side: 'second', pan: 0.8 },
      { atS: 2.47, eventId: 'victory' },
    ],
    loops: [
      ...spinBed(1.72),
      { key: 'spinHum:second', eventId: 'spinHum', fromS: 1.72, toS: 1.8, level: [0, 0], param: [0.8, 0.8], pan: R },
      { key: 'wallGrind:second', eventId: 'wallGrind', fromS: 0.1, toS: 1.3, level: [0.3, 1], param: [0.5, 1], pan: 0.7 },
      { key: 'wallGrind:second', eventId: 'wallGrind', fromS: 1.3, toS: 1.35, level: [0, 0], param: [1, 1], pan: 0.7 },
      { key: 'floorScrape:second', eventId: 'floorScrape', fromS: 0.1, toS: 1.3, level: [0.4, 0.8], param: [0.6, 1], pan: 0.6 },
      { key: 'floorScrape:second', eventId: 'floorScrape', fromS: 1.3, toS: 1.35, level: [0, 0], param: [1, 1], pan: 0.6 },
    ],
  },
  {
    id: 'ko',
    label: 'Fim por KO',
    description: 'Stamina crítica do jogador, dois acertos, o giro morre (KO) e stinger de derrota.',
    durationS: 5,
    steps: [
      { atS: 0.2, eventId: 'staminaLow', side: 'first', pan: L },
      { atS: 0.9, eventId: 'hit', magnitude: 0.6, pan: L },
      { atS: 1.5, eventId: 'hit', magnitude: 0.75, pan: L },
      { atS: 2.1, eventId: 'ko', side: 'first', pan: L },
      { atS: 2.85, eventId: 'defeat' },
    ],
    loops: [
      { key: 'spinHum:first', eventId: 'spinHum', fromS: 0, toS: 2.1, level: [1, 1], param: [0.45, 0.12], aux: [0.2, 0.7], pan: L, archetypeId: 'stamina-prototype' },
      { key: 'spinHum:first', eventId: 'spinHum', fromS: 2.1, toS: 2.15, level: [0, 0], param: [0.1, 0.1], pan: L, archetypeId: 'stamina-prototype' },
      { key: 'spinHum:second', eventId: 'spinHum', fromS: 0, toS: 5, level: [1, 1], param: [0.8, 0.75], pan: R, archetypeId: 'attack-prototype' },
    ],
  },
  {
    id: 'jumps',
    label: 'Pulos, aterrissagens e energia',
    description: 'Dois pulos com quedas de força diferente e um Dash que esgota a Attack Energy (sai à força).',
    durationS: 3.2,
    steps: [
      { atS: 0.2, eventId: 'jump', side: 'first', pan: L },
      { atS: 0.7, eventId: 'landing', magnitude: 0.4, side: 'first', pan: L },
      { atS: 1.0, eventId: 'jump', side: 'second', pan: R },
      { atS: 1.55, eventId: 'landing', magnitude: 0.95, side: 'second', pan: R },
      { atS: 2.55, eventId: 'energyEmpty', side: 'first', pan: L },
      { atS: 2.56, eventId: 'dashRelease', magnitude: 0.55, side: 'first', pan: L },
    ],
    loops: [...spinBed(3.2), { key: 'dashCharge:first', eventId: 'dashCharge', fromS: 1.8, toS: 2.55, level: [1, 1], param: [0, 0.55], pan: L }, { key: 'dashCharge:first', eventId: 'dashCharge', fromS: 2.55, toS: 2.6, level: [0, 0], param: [0.55, 0.55], pan: L }],
  },
  {
    id: 'round',
    label: 'Início da rodada',
    description: 'O stinger de início e o giro dos três arquétipos entrando (Attack, Defense, Stamina: timbres próprios, GDD 32).',
    durationS: 3.6,
    steps: [{ atS: 0.1, eventId: 'roundStart' }],
    loops: [
      { key: 'spinHum:first', eventId: 'spinHum', fromS: 1.2, toS: 3.6, level: [1, 1], param: [1, 0.95], pan: -0.6, archetypeId: 'attack-prototype' },
      { key: 'spinHum:second', eventId: 'spinHum', fromS: 1.8, toS: 3.6, level: [1, 1], param: [1, 0.95], pan: 0, archetypeId: 'defense-prototype' },
      { key: 'spinHum:third', eventId: 'spinHum', fromS: 2.4, toS: 3.6, level: [1, 1], param: [1, 0.95], pan: 0.6, archetypeId: 'stamina-prototype' },
    ],
  },
  {
    id: 'menu',
    label: 'Main Menu',
    description: 'Navegar entre entradas, confirmar, abrir e fechar a seção Developer, e um erro.',
    durationS: 2.8,
    steps: [
      { atS: 0.1, eventId: 'uiFocus' },
      { atS: 0.35, eventId: 'uiFocus' },
      { atS: 0.6, eventId: 'uiFocus' },
      { atS: 0.95, eventId: 'uiConfirm' },
      { atS: 1.45, eventId: 'uiFocus' },
      { atS: 1.75, eventId: 'uiBack' },
      { atS: 2.3, eventId: 'uiError' },
    ],
    loops: [],
  },
  mixStress(),
];

export function sequenceById(id: string): Sequence {
  const sequence = SEQUENCES.find((s) => s.id === id);
  if (!sequence) throw new Error(`unknown sequence: ${id}`);
  return sequence;
}

/** Where every loop of a sequence should be at time `t` (the last ramp that started wins). */
export function loopStateAt(sequence: Sequence, t: number): Map<string, { eventId: string; level: number; param: number; aux: number; pan: number; archetypeId?: string }> {
  const state = new Map<string, { eventId: string; level: number; param: number; aux: number; pan: number; archetypeId?: string }>();
  for (const ramp of sequence.loops) {
    if (t < ramp.fromS) continue;
    const span = Math.max(1e-6, ramp.toS - ramp.fromS);
    const k = Math.max(0, Math.min(1, (t - ramp.fromS) / span));
    const lerp = (pair: readonly [number, number]) => pair[0] + (pair[1] - pair[0]) * k;
    const ended = t > ramp.toS;
    state.set(ramp.key, {
      eventId: ramp.eventId,
      level: ended && ramp.toS >= sequence.durationS - 1e-6 ? 0 : lerp(ramp.level),
      param: lerp(ramp.param),
      aux: ramp.aux ? lerp(ramp.aux) : 0,
      pan: ramp.pan ?? 0,
      archetypeId: ramp.archetypeId,
    });
  }
  return state;
}
