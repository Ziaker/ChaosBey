// ============================================================
// CAMERA LAB — REPRODUCIBLE SCENARIOS
// Each scenario is a real fight in the game's own simulation: two Beys
// spawned at fixed spots, each driven by a script ("which actions are held
// at time t"), the real AI, or nothing. Fixed 60 Hz timestep + scripted
// input = the same fight every run, so A, B and C can be compared on
// exactly the same events.
//
// Scripts only press the same buttons a player would (arrows, Z, X, C).
// The one exception is Final Hit's setup, which starts the opponent
// Broken through the Stability system's own applyDamage() — the kind of
// "set Stability" action the GDD's Debug Lab allows (GDD 70). No physics,
// AI or balance value is changed for the camera's sake.
//
// Headings: every Bey spawns facing +Z (yaw 0). SteerRight turns toward +X.
// ============================================================

import { Action } from '../../../../src/input/actions/Action';
import type { Bey } from '../../../../src/bey/core/Bey';
import type { IntentKind } from './FightFrame';

export type ControlSpec =
  | { readonly kind: 'script'; readonly held: (t: number) => readonly Action[] }
  | { readonly kind: 'ai'; readonly seed: string }
  | { readonly kind: 'idle' };

export interface Scenario {
  readonly id: string;
  readonly label: string;
  /** One line shown in the lab. */
  readonly description: string;
  /** Camera contexts this scenario is meant to show. */
  readonly contexts: readonly string[];
  readonly durationS: number;
  readonly firstSpawn: { readonly x: number; readonly z: number };
  readonly secondSpawn: { readonly x: number; readonly z: number };
  readonly first: ControlSpec;
  readonly second: ControlSpec;
  readonly setup?: (beys: { first: Bey; second: Bey }) => void;
  /** What the scenario must produce (checked by the unit test). */
  readonly expects: readonly (IntentKind | 'clashActive' | 'roundOver' | 'closeRange' | 'farRange' | 'highSpeed')[];
}

const { MoveForward: F, MoveBackward: B, SteerLeft: L, SteerRight: R, Attack: Z, JumpDrift: J } = Action;

/** True for `on` seconds out of every `period`, starting at `offset`. */
const pulse = (t: number, period: number, on: number, offset = 0): boolean => t >= offset && ((t - offset) % period) < on;
const between = (t: number, a: number, b: number): boolean => t >= a && t < b;
const when = (cond: boolean, ...actions: Action[]): Action[] => (cond ? actions : []);

export const SCENARIOS: readonly Scenario[] = [
  {
    id: 'normal-duel',
    label: 'Normal Duel',
    description: 'IA contra IA do jogo, como uma luta de verdade: aproximações, Dash, Circular e recuos.',
    contexts: ['CombatFollow', 'CloseCombat', 'KnockbackFollow', 'HighSpeed'],
    durationS: 15,
    // Seeds and spawns picked by sweeping the real AI: combat with hits and a Clash, and no round end.
    // Re-swept after the Motion Lab integration (M11) changed every fight: 'q' (was 'k'), then again
    // after its follow-up fixes: no seed a..z keeps a Clash and 24 s without a round end any more
    // (fights end by KO in 8–16 s), so 15 s of 'u', whose round ends at 15.5 s.
    firstSpawn: { x: -3, z: -5 },
    secondSpawn: { x: 3, z: 5 },
    first: { kind: 'ai', seed: 'duel-p-u' },
    second: { kind: 'ai', seed: 'duel-o-u' },
    expects: ['hit', 'clashActive'],
  },
  {
    id: 'close-combat',
    label: 'Close Combat',
    description: 'Os dois girando colados, trocando Circular Attacks curtos.',
    contexts: ['CloseCombat', 'KnockbackFollow (leve)'],
    durationS: 6.5,
    firstSpawn: { x: 0, z: -1.8 },
    secondSpawn: { x: 0.2, z: 1.8 },
    // The opponent turns to face the player, then both push into each other and trade Circulars.
    first: { kind: 'script', held: (t) => [...when(t > 1.4 && pulse(t, 0.5, 0.3), F), ...when(pulse(t, 1.6, 0.25, 2), R), ...when(pulse(t, 0.8, 0.05, 1.7), Z)] },
    second: { kind: 'script', held: (t) => [...when(t < 1.33, R), ...when(t > 1.4 && pulse(t, 0.5, 0.3, 0.2), F), ...when(pulse(t, 1.4, 0.25, 2.5), L), ...when(pulse(t, 0.9, 0.05, 2.1), Z)] },
    expects: ['hit', 'closeRange'],
  },
  {
    id: 'far-separation',
    label: 'Far Separation',
    description: 'Oponente parado no fundo da arena; o jogador faz laços largos do outro lado.',
    contexts: ['CombatFollow (distância máxima)'],
    durationS: 12,
    firstSpawn: { x: -2, z: -7 },
    secondSpawn: { x: 0, z: 9 },
    first: { kind: 'script', held: (t) => [...when(pulse(t, 0.4, 0.22), F), ...when(pulse(t, 0.4, 0.3), R)] },
    second: { kind: 'idle' },
    expects: ['farRange'],
  },
  {
    id: 'high-speed-pass',
    label: 'High Speed Pass',
    description: 'O jogador cruza a arena em velocidade máxima passando rente ao oponente, freia, volta e passa de novo.',
    contexts: ['HighSpeed', 'look-ahead', 'encontro previsto'],
    durationS: 9,
    firstSpawn: { x: 0, z: -10.5 },
    secondSpawn: { x: 1.8, z: 1.5 },
    first: {
      kind: 'script',
      held: (t) => [
        ...when(between(t, 0, 2.3), F),
        ...when(between(t, 2.3, 3.1), B),
        ...when(between(t, 3.1, 4.4), F, R),
        ...when(between(t, 4.4, 7), F),
        ...when(between(t, 7, 9), B),
      ],
    },
    second: { kind: 'idle' },
    expects: ['highSpeed'],
  },
  {
    id: 'opposite-pass',
    label: 'Opposite Direction Pass',
    description: 'Os dois aceleram de frente um para o outro e se cruzam em sentidos opostos, sem colidir.',
    contexts: ['HighSpeed', 'aproximação frontal', 'encontro previsto'],
    durationS: 6,
    firstSpawn: { x: -1.4, z: -10.5 },
    secondSpawn: { x: 1.4, z: 10.5 },
    first: { kind: 'script', held: (t) => [...when(between(t, 1.45, 3.4), F), ...when(between(t, 3.4, 4.6), B)] },
    second: { kind: 'script', held: (t) => [...when(t < 1.33, R), ...when(between(t, 1.45, 3.4), F), ...when(between(t, 3.4, 4.6), B)] },
    expects: ['highSpeed'],
  },
  {
    id: 'dash-approach',
    label: 'Dash Approach',
    description: 'O jogador carrega o Dash Attack e dispara contra o oponente parado; depois um segundo Dash curto.',
    contexts: ['HighSpeed (Dash)', 'KnockbackFollow', 'aproximação frontal'],
    durationS: 8,
    firstSpawn: { x: 0, z: -7 },
    secondSpawn: { x: 0, z: 3 },
    first: { kind: 'script', held: (t) => [...when(between(t, 0.5, 1.4), Z), ...when(between(t, 4.6, 5), Z)] },
    second: { kind: 'idle' },
    expects: ['hit'],
  },
  {
    id: 'heavy-knockback',
    label: 'Heavy Knockback',
    description: 'Dash com carga máxima: o oponente é arremessado e bate na parede.',
    contexts: ['KnockbackFollow (forte)', 'wall impact'],
    durationS: 7,
    firstSpawn: { x: 0, z: -8 },
    secondSpawn: { x: 0, z: 1 },
    first: { kind: 'script', held: (t) => when(between(t, 0.4, 1.6), Z) },
    second: { kind: 'idle' },
    expects: ['hit', 'wallImpact'],
  },
  {
    id: 'wall-ricochet',
    label: 'Wall Ricochet',
    description: 'O jogador bate em ângulo na parede em alta velocidade e ricocheteia.',
    contexts: ['wall impact', 'HighSpeed'],
    durationS: 7,
    firstSpawn: { x: 5, z: -6 },
    secondSpawn: { x: -4, z: -2 },
    first: { kind: 'script', held: (t) => [...when(t < 3.6, F), ...when(between(t, 3.6, 5), F, L)] },
    second: { kind: 'idle' },
    expects: ['wallImpact'],
  },
  {
    id: 'ring-out-chase',
    label: 'Ring-Out Chase',
    description: 'Um Dash carregado acerta o oponente no meio de um pulo e o lança por cima da parede; a câmera persegue a trajetória.',
    contexts: ['KnockbackFollow', 'RingOut', 'Finisher'],
    durationS: 5.5,
    // Was the AI's opening (a Circular catching a Dash that carried the dasher out at ~2 s) until a
    // caught Dash stopped keeping its speed. Under the game's movement a ring-out comes from a Dash
    // hitting a Bey in the air: first holds a full Dash, second jumps; any jump from 1.28 to 1.48 s
    // rings out at 2.0 s (swept), so 1.38 s.
    firstSpawn: { x: 0, z: -1 },
    secondSpawn: { x: 0, z: 5 },
    first: { kind: 'script', held: (t) => when(t < 1.25, Z) },
    second: { kind: 'script', held: (t) => when(between(t, 1.38, 1.58), J) },
    expects: ['hit', 'ringOut', 'roundOver'],
  },
  {
    id: 'clash-setup',
    label: 'Clash Setup',
    description: 'Os dois disparam o Dash ao mesmo tempo, um contra o outro, e entram em Clash.',
    contexts: ['Clash', 'KnockbackFollow depois do Clash'],
    durationS: 10,
    firstSpawn: { x: 0, z: -5 },
    secondSpawn: { x: 0, z: 5 },
    first: { kind: 'script', held: (t) => [...when(between(t, 1.45, 2.05), Z), ...when(t > 2.4 && t < 7 && pulse(t, 0.12, 0.05, 2.4), Z)] },
    second: { kind: 'script', held: (t) => [...when(t < 1.33, R), ...when(between(t, 1.45, 2.05), Z)] },
    expects: ['clashActive', 'clashResolved'],
  },
  {
    id: 'high-speed-orbit',
    label: 'High-Speed Orbit',
    description: 'O jogador circula o oponente em alta velocidade, sempre virando.',
    contexts: ['HighSpeed', 'órbita em alta velocidade'],
    durationS: 9,
    firstSpawn: { x: -6, z: 0 },
    secondSpawn: { x: 0, z: 0 },
    first: { kind: 'script', held: (t) => [F, ...when(pulse(t, 0.2, 0.17), R)] },
    second: { kind: 'idle' },
    expects: ['highSpeed'],
  },
  {
    id: 'final-hit',
    label: 'Final Hit',
    description: 'Oponente já Quebrado (setup do Debug Lab); um Dash forte dá o KO e a câmera faz o enquadramento final.',
    contexts: ['Finisher', 'KnockbackFollow (forte)'],
    durationS: 6,
    firstSpawn: { x: 0, z: -6 },
    secondSpawn: { x: 0, z: 2 },
    first: { kind: 'script', held: (t) => when(between(t, 0.4, 1.4), Z) },
    second: { kind: 'idle' },
    setup: ({ second }) => {
      second.stability.applyDamage(second.stability.resource.max);
    },
    expects: ['hit', 'ko', 'roundOver'],
  },
];

export function scenarioById(id: string): Scenario {
  return SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0]!;
}
