// ============================================================
// STAMINA & STABILITY LAB — LANGUAGE CONTRACT
// A "language" is one way of showing a Bey's condition. Each Bey on stage
// gets one instance of each language; the lab turns them on and off (one
// at a time, or mixed). Languages only OBSERVE the condition state and the
// shared motion (GDD 158: VFX never decides outcomes).
// ============================================================

import type * as THREE from 'three';
import type { Particles } from '../fx/Particles';
import type { ConditionEvent, ConditionState } from '../sim/ConditionSim';
import type { MotionFrame } from '../sim/BeyMotion';
import type { BeyRig } from '../stage/BeyRig';
import type { Tuning } from '../tuning';

export type LanguageId = 'A' | 'B' | 'C';
export const LANGUAGE_IDS: readonly LanguageId[] = ['A', 'B', 'C'];

/** What a language can reach in its world. */
export interface LayerWorld {
  readonly scene: THREE.Scene;
  readonly camera: THREE.Camera;
  /** Additive particles (sparks, glow). */
  readonly glow: Particles;
  /** Normal-blended particles (smoke, dust, chips). */
  readonly soft: Particles;
  floorHeightAt(x: number, z: number): number;
  floorNormalAt(x: number, z: number, out: THREE.Vector3): THREE.Vector3;
}

export interface LayerFrame {
  readonly state: ConditionState;
  readonly motion: MotionFrame;
  /** Seconds since the lab started (for looping animation). */
  readonly time: number;
}

export interface ConditionLayer {
  readonly id: LanguageId;
  /** Show/hide everything this layer owns. Re-enabling snaps it to the current state without replaying events. */
  setEnabled(on: boolean): void;
  readonly enabled: boolean;
  /** Called every frame after the rig was placed. Write rig.mods here, spawn particles, animate owned meshes. */
  update(frame: LayerFrame, dt: number): void;
  onEvent(e: ConditionEvent, frame: LayerFrame): void;
  dispose(): void;
}

export interface LayerContext {
  readonly world: LayerWorld;
  readonly rig: BeyRig;
  readonly tuning: Tuning;
}

export interface LanguageInfo {
  readonly id: LanguageId;
  readonly name: string;
  readonly idea: string;
  readonly stamina: string;
  readonly stability: string;
  readonly broken: string;
}

export const LANGUAGE_INFO: Readonly<Record<LanguageId, LanguageInfo>> = {
  A: {
    id: 'A',
    name: 'Desgaste Mecânico',
    idea: 'Nada que não exista fisicamente. O Bey conta o próprio estado pelo movimento, pelo material e pelo contato com o chão.',
    stamina: 'O borrão do giro some e as peças aparecem. A ponta risca uma roseta cada vez mais aberta no chão. A borda começa a raspar e soltar faíscas.',
    stability: 'As 4 peças ficam frouxas e trepidam, as junções abrem e o material escurece e perde o brilho. Golpes soltam lascas.',
    broken: 'Inclinado e mancando, com a borda raspando sem parar, fumaça saindo do Driver e engasgos no giro.',
  },
  B: {
    id: 'B',
    name: 'Aura de Espírito',
    idea: 'O espírito de luta vira energia visível, na linguagem anime já aprovada. Lê de longe e usa a cor do Bey.',
    stamina: 'Uma aura em chamas sobe do Bey. Com a Stamina baixa ela encolhe, tremula e se desfaz em fiapos. Linhas de giro anime rodeiam o corpo.',
    stability: 'Escudos hexagonais orbitam o Bey, um por fração de Stability. Cada golpe estilhaça escudos, e a recuperação os recria um a um.',
    broken: 'Contorno vermelho pulsando, estrelas de tontura, raios elétricos e a aura vira brasa vermelha.',
  },
  C: {
    id: 'C',
    name: 'Instrumento no Chão',
    idea: 'O chão da arena projeta um instrumento sob o Bey. Preciso, lê de qualquer câmera e deixa o Bey limpo.',
    stamina: 'Um arco externo com marcas de 10% esvazia no sentido horário e muda de branco para âmbar e vermelho. O núcleo do Bey pulsa como um batimento que desacelera.',
    stability: 'Um anel interno de segmentos: cada golpe apaga segmentos, e a recuperação os reacende em sequência.',
    broken: 'O anel de segmentos vira listras de perigo girando.',
  },
};
