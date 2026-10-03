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
import { ARENA_FLOOR_RADIUS } from '../../../../src/arena/colliders/ArenaTuning';
import type { IntentKind } from './FightFrame';

/**
 * Arena scale pass (floor radius 12 m -> 36 m). The scenarios that are about
 * the wall / the ring-out (Heavy Knockback, Wall Ricochet, Ring-Out Chase)
 * were laid out for a wall 12 m from the centre; they are shifted +Z by this
 * much so each one still starts the same distance from the wall it is aimed at.
 */
const WALL_SHIFT_M = ARENA_FLOOR_RADIUS - 12;

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
    // (fights end by KO in 8–16 s), so 15 s; 'g' since the owner-playtest controls (Clash at
    // 5.9 s, round end at 16.6 s; was 'u'); 'k' since wall bounces without input settle like idle
    // motion (Clash at 2.0 s, round end at 16.6 s; was 'g'); 'r' since the movement/weight/dodge
    // playtest pass (steering/grip tightened, gravity raised, short hop shortened, dodge rewritten
    // as a flat state) changed fight timing again — 'k' no longer reaches a Clash at all within 15s
    // (Clash at 2.0 s, no round end within 15 s); 'b' since the arena scale pass (floor radius 12 m ->
    // 36 m, the flat floor now a heightfield, then its resolution 288 -> 144 cells, changed every AI fight again: 'r' no longer reaches a
    // Clash; 'b' is the first of a..z with a Clash and no round end within 15 s). 'c' since the Dash cooldown
    // replaced Attack Energy (owner, 2026-10-02): 'b' now ends its round inside 15 s; 'c' is the first of a..z with
    // a hit, a Clash, no round end and every readability guard holding (seed only; no camera value changed).
    firstSpawn: { x: -3, z: -5 },
    secondSpawn: { x: 3, z: 5 },
    first: { kind: 'ai', seed: 'duel-p-c' },
    second: { kind: 'ai', seed: 'duel-o-c' },
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
    firstSpawn: { x: 0, z: -8 + WALL_SHIFT_M },
    secondSpawn: { x: 0, z: 1 + WALL_SHIFT_M },
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
    firstSpawn: { x: 5, z: -6 + WALL_SHIFT_M },
    secondSpawn: { x: -4, z: -2 + WALL_SHIFT_M },
    first: { kind: 'script', held: (t) => [...when(t < 3.6, F), ...when(between(t, 3.6, 5), F, L)] },
    second: { kind: 'idle' },
    expects: ['wallImpact'],
  },
  {
    id: 'ring-out-chase',
    label: 'Ring-Out Chase',
    description: 'Um Dash carregado acerta o oponente, já vulnerável e no meio de um pulo, e o lança por cima da parede; a câmera persegue a trajetória.',
    contexts: ['KnockbackFollow', 'RingOut', 'Finisher'],
    durationS: 5.5,
    // Jump/air-control hotfix follow-up: the old setup had second's own,
    // then-uncut full jump (apex ~2.33 m) alone clear the 2 m wall. The
    // hotfix's approved full-jump target (1.0-1.5 m) can never do that by
    // itself any more, with or without a plain Dash's modest knockback
    // lift (see src/self-test/scenarios/ScenarioPresets.ts's 'ring-out'
    // preset for the full writeup and the measurements behind this). The
    // same fix applies here: make second maximally vulnerable to knockback
    // (GDD section 27/30's own formula — zero Stamina, low-but-not-zero
    // Stability so a Dash's own stability damage doesn't zero it out and
    // freeze the round before the physics can play out), so the Dash's
    // knockback impulse — additive to whatever vy the jump already has —
    // stacks with the jump's own residual velocity. Swept (the hit always
    // lands at ~1.47 s regardless of second's own jump timing): starting
    // the jump anywhere from 1.22 to 1.26 s rang out; earlier left second
    // still grounded when the Dash arrived (no hit registered at all —
    // the Dash's own approach reads differently against a grounded vs. an
    // already-airborne target), later gave the jump too little time to
    // build height before the hit added its own knockback vy.
    firstSpawn: { x: 0, z: -1 + WALL_SHIFT_M },
    secondSpawn: { x: 0, z: 5 + WALL_SHIFT_M },
    setup: ({ second }) => {
      second.stamina.resource.set(0);
      second.stability.debugSetValue(30);
    },
    first: { kind: 'script', held: (t) => when(t < 1.25, Z) },
    second: { kind: 'script', held: (t) => when(between(t, 1.24, 1.44), J) },
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
