// ============================================================
// COMBAT HUD LAB — PURE MODEL
// The Lab compares three presentation philosophies over the SAME live
// MatchSession. This file deliberately contains only immutable metadata and
// pure helpers so the comparison/scenario contract can be unit-tested without
// Three.js, Rapier or a DOM.
// ============================================================

export type CombatHudDirectionId = 'A' | 'B' | 'C';
export type CombatHudViewMode = 'single' | 'compare' | 'sequence';

export interface CombatHudDirection {
  readonly id: CombatHudDirectionId;
  readonly name: string;
  readonly shortName: string;
  readonly philosophy: string;
  readonly emphasis: readonly string[];
}

export const COMBAT_HUD_DIRECTIONS: readonly CombatHudDirection[] = [
  {
    id: 'A',
    name: 'Clean Competitive / Broadcast Combat',
    shortName: 'Broadcast',
    philosophy: 'Immediate competitive reading with restrained ornament and stable screen anchors.',
    emphasis: ['resources first', 'minimal occlusion', 'score/state hierarchy'],
  },
  {
    id: 'B',
    name: 'Aggressive Anime Arena / Fighter Spectacle',
    shortName: 'Overdrive',
    philosophy: 'Expressive combat presentation that lets temporary events punch through without replacing the core meters.',
    emphasis: ['impact events', 'motion graphics', 'danger escalation'],
  },
  {
    id: 'C',
    name: 'Tactical Core / Mechanical System HUD',
    shortName: 'Tactical Core',
    philosophy: 'Instrument-like segmented readouts that prioritize condition, cooldowns and combat state.',
    emphasis: ['systems reading', 'segmentation', 'technical state'],
  },
] as const;

export type CombatHudScenarioId =
  | 'balanced'
  | 'close-combat'
  | 'high-speed'
  | 'edge-danger'
  | 'ring-out'
  | 'strong-knockback'
  | 'drift-recovery'
  | 'jump-landing'
  | 'perfect-dodge'
  | 'clash'
  | 'low-stamina'
  | 'stability-break'
  | 'round-end'
  | 'match-end'
  | 'arena-sweep';

export interface CombatHudScenario {
  readonly id: CombatHudScenarioId;
  readonly label: string;
  readonly purpose: string;
  /** Some scenarios use explicit Debug Lab mutations after the real session is created. */
  readonly mutatesHarness: boolean;
}

/** The 15 owner-requested evaluation contexts, in the requested order. */
export const COMBAT_HUD_SCENARIOS: readonly CombatHudScenario[] = [
  { id: 'balanced', label: '01 · Balanced combat', purpose: 'Baseline readability during normal Player-vs-AI combat.', mutatesHarness: false },
  { id: 'close-combat', label: '02 · Close combat', purpose: 'Dense centre-screen action and overlapping Bey silhouettes.', mutatesHarness: true },
  { id: 'high-speed', label: '03 · High-speed chase', purpose: 'HUD stability under camera pullback, FOV and rapid separation.', mutatesHarness: true },
  { id: 'edge-danger', label: '04 · Edge danger', purpose: 'Warning language near the ring-out boundary.', mutatesHarness: true },
  { id: 'ring-out', label: '05 · Ring-out', purpose: 'Boundary warning -> ring-out -> round-end presentation.', mutatesHarness: true },
  { id: 'strong-knockback', label: '06 · Strong knockback', purpose: 'Readability while the camera follows a launch.', mutatesHarness: true },
  { id: 'drift-recovery', label: '07 · Drift + recovery', purpose: 'Player movement-state feedback without competing with VFX.', mutatesHarness: true },
  { id: 'jump-landing', label: '08 · Jump + landing', purpose: 'Airborne/landing readability and temporary feedback.', mutatesHarness: true },
  { id: 'perfect-dodge', label: '09 · Perfect Dodge', purpose: 'Short high-priority event feedback during a real dodge interaction.', mutatesHarness: true },
  { id: 'clash', label: '10 · Clash', purpose: 'General HUD yielding to the approved Overdrive Clash presentation.', mutatesHarness: true },
  { id: 'low-stamina', label: '11 · Low Stamina', purpose: 'Critical resource hierarchy during a long-fight state.', mutatesHarness: true },
  { id: 'stability-break', label: '12 · Stability pressure / Broken', purpose: 'Near-break and Broken danger language.', mutatesHarness: true },
  { id: 'round-end', label: '13 · Round end', purpose: 'Result hierarchy and auto-continue/readability treatment.', mutatesHarness: true },
  { id: 'match-end', label: '14 · Match end / Match Point', purpose: 'Final-round score hierarchy without changing match rules.', mutatesHarness: true },
  { id: 'arena-sweep', label: '15 · Bowls A/B/C + flat', purpose: 'Same HUD against every approved floor profile.', mutatesHarness: false },
] as const;

export function combatHudDirection(id: CombatHudDirectionId): CombatHudDirection {
  return COMBAT_HUD_DIRECTIONS.find((direction) => direction.id === id)!;
}

export function combatHudScenario(id: CombatHudScenarioId): CombatHudScenario {
  return COMBAT_HUD_SCENARIOS.find((scenario) => scenario.id === id)!;
}

export function visibleDirections(mode: CombatHudViewMode, selected: CombatHudDirectionId): readonly CombatHudDirectionId[] {
  return mode === 'compare' ? (['A', 'B', 'C'] as const) : [selected];
}

/** Sequence order is deliberately fixed so repeated scenario recordings compare the same cadence. */
export function nextDirection(id: CombatHudDirectionId): CombatHudDirectionId {
  return id === 'A' ? 'B' : id === 'B' ? 'C' : 'A';
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Edge danger is a presentation-only continuous signal: 0 inside 70% radius, 1 at/outside the gameplay radius. */
export function edgeDanger(radiusM: number, gameplayRadiusM: number): number {
  if (!(gameplayRadiusM > 0)) return 0;
  const start = gameplayRadiusM * 0.7;
  return clamp01((radiusM - start) / Math.max(0.001, gameplayRadiusM - start));
}

/** Compact, deterministic status word used by all three visual directions. */
export function resourceBand(value: number): 'ok' | 'warn' | 'critical' {
  const v = clamp01(value);
  if (v <= 0.23) return 'critical';
  if (v <= 0.35) return 'warn';
  return 'ok';
}
