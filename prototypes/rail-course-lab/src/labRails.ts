// ============================================================
// RAIL COURSE LAB — the lab's rails from its parameters (pure, so the tests can run it headless)
// ============================================================

import type { ArenaFloor } from '../../../src/arena/floor/ArenaFloorProfile';
import { resolveRail, type RailDefinition } from '../../../src/arena/rails/RailBlueprint';
import { railCourse, rotatedCourse, type RailCourseParams } from '../../../src/arena/rails/RailCourse';

export const MAX_LAB_RAILS = 3;

/** `count` copies of the course spread evenly round the arena, resolved onto the floor. */
export function labRails(params: RailCourseParams, count: number, floor: ArenaFloor, floorRadiusM: number): RailDefinition[] {
  const n = Math.max(1, Math.min(MAX_LAB_RAILS, Math.round(count)));
  const rails: RailDefinition[] = [];
  for (let i = 0; i < n; i++) {
    const blueprint = railCourse(`course-${i + 1}`, `Rail ${i + 1}`, rotatedCourse(params, (360 / n) * i));
    rails.push(resolveRail(blueprint, { floor, floorRadiusM }));
  }
  return rails;
}

export interface ParamSpec {
  readonly key: keyof RailCourseParams;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly unit: string;
}

export const PARAM_SPECS: readonly ParamSpec[] = [
  { key: 'gateAngleDeg', label: 'Posição da entrada (volta da arena)', min: 0, max: 360, step: 5, unit: '°' },
  { key: 'sweepDeg', label: 'Quanto contorna a arena (− = sentido horário)', min: -360, max: 360, step: 5, unit: '°' },
  { key: 'gateRadiusU', label: 'Distância das entradas ao centro (1 = parede)', min: 0.55, max: 0.97, step: 0.01, unit: '×' },
  { key: 'outerRadiusU', label: 'Distância do trecho de fora ao centro', min: 1.05, max: 2.2, step: 0.01, unit: '×' },
  { key: 'waves', label: 'Ondas (curvas para dentro e para fora)', min: 0, max: 6, step: 0.5, unit: '' },
  { key: 'waveAmplitudeU', label: 'Tamanho de cada onda', min: 0, max: 0.5, step: 0.01, unit: '×' },
  { key: 'insideHeightM', label: 'Altura das entradas sobre o piso', min: 0.8, max: 4, step: 0.1, unit: ' m' },
  { key: 'outsideHeightM', label: 'Altura do trecho de fora', min: 2, max: 12, step: 0.5, unit: ' m' },
  { key: 'heightWaves', label: 'Subidas e descidas', min: 0, max: 6, step: 0.5, unit: '' },
  { key: 'heightWaveAmplitudeM', label: 'Tamanho das subidas e descidas', min: 0, max: 5, step: 0.1, unit: ' m' },
  { key: 'pointCount', label: 'Suavidade (pontos do percurso)', min: 40, max: 240, step: 10, unit: '' },
];
