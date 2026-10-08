// ============================================================
// STAGE RAILS — which rails each stage has (Rail Grinding preparation, 0.50.0)
// docs/planning/RAIL_GRINDING_FUTURE_UPDATE.md §6/§13: every stage will get rails, but the number, layout, height and
// positions are an OWNER DECISION. The owner asked for two rails per stage to start and left their layout to the developer
// (2026-10-08), so STARTER_RAILS is a PROVISIONAL layout, as data in stage units (see RailBlueprint); every consumer —
// gameplay, debug, AI — reads the rails through railsForMatch().
// ============================================================

import type { ArenaPresetId } from '../presets/ArenaPresets';
import { resolveRail, type RailBlueprint, type RailDefinition, type RailResolveContext } from './RailBlueprint';
import { railCourse, rotatedCourse, type RailCourseParams } from './RailCourse';

/**
 * Owner, 2026-10-08, after the Rail Course Lab: course A ("Volta larga") with the owner's own numbers — a long route with a gate
 * inside the wall at each end (0.88 of the floor radius, 1.8 m over the floor) that goes out over the wall (7.5 m up), round the
 * OUTSIDE of the arena (1.4 floor radii from the centre, 110° clockwise) and back in. Two rails, one on each side of the arena
 * (the same course turned 180°), on every stage. Authored in floor radii, so it follows the stage size and the funnel.
 */
export const OWNER_COURSE: RailCourseParams = {
  gateAngleDeg: 0,
  sweepDeg: -110,
  gateRadiusU: 0.88,
  outerRadiusU: 1.4,
  waves: 0,
  waveAmplitudeU: 0,
  insideHeightM: 1.8,
  outsideHeightM: 7.5,
  heightWaves: 0,
  heightWaveAmplitudeM: 0,
  pointCount: 240,
};

export const STARTER_RAILS: readonly RailBlueprint[] = [
  railCourse('rail-east', 'East rail', OWNER_COURSE),
  railCourse('rail-west', 'West rail', rotatedCourse(OWNER_COURSE, 180)),
];

/**
 * The rail layouts per stage. All three share the starter layout for now; when a stage gets its own, the stage must also join
 * the MatchConfig (the simulation has to know it for replays to verify live and headless alike) — a test guards that.
 */
export const STAGE_RAIL_BLUEPRINTS: Readonly<Record<ArenaPresetId, readonly RailBlueprint[]>> = {
  foundry: STARTER_RAILS,
  rift: STARTER_RAILS,
  tournament: STARTER_RAILS,
};

/** The stage a simulation resolves rails for while every stage shares one layout (see STAGE_RAIL_BLUEPRINTS). */
export const SHARED_RAIL_STAGE: ArenaPresetId = 'foundry';

export interface RailsForMatchOptions extends RailResolveContext {
  readonly stage: ArenaPresetId;
  /** MatchConfig.railsEnabled (the Pregame's Rails option): off = no rails at all, as if the stage had none. */
  readonly railsEnabled: boolean;
  /** Test/prototype override of the layouts (default: STAGE_RAIL_BLUEPRINTS). */
  readonly blueprints?: Readonly<Record<ArenaPresetId, readonly RailBlueprint[]>>;
}

/** The rails a match is played with: the stage's layout resolved onto its floor, or none when the option is off. */
export function railsForMatch(options: RailsForMatchOptions): readonly RailDefinition[] {
  if (!options.railsEnabled) return [];
  const layouts = (options.blueprints ?? STAGE_RAIL_BLUEPRINTS)[options.stage];
  return layouts.map((blueprint) => resolveRail(blueprint, options));
}

/** The rails of a match while every stage shares one layout: what the live match and the headless worlds both resolve, so they agree. */
export function railsOfMatch(railsEnabled: boolean, floor: RailResolveContext['floor'], floorRadiusM: number): readonly RailDefinition[] {
  return railsForMatch({ stage: SHARED_RAIL_STAGE, railsEnabled, floor, floorRadiusM });
}
