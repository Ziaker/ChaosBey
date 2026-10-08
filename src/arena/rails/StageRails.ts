// ============================================================
// STAGE RAILS — which rails each stage has (Rail Grinding preparation, 0.50.0)
// docs/planning/RAIL_GRINDING_FUTURE_UPDATE.md §6/§13: every stage will get rails, but the number, layout, height and
// positions are an OWNER DECISION. The owner asked for two rails per stage to start and left their layout to the developer
// (2026-10-08), so STARTER_RAILS is a PROVISIONAL layout, as data in stage units (see RailBlueprint); every consumer —
// gameplay, debug, AI — reads the rails through railsForMatch().
// ============================================================

import type { ArenaPresetId } from '../presets/ArenaPresets';
import { resolveRail, type RailBlueprint, type RailDefinition, type RailResolveContext } from './RailBlueprint';

/** Where the starter rails sit: a circle of this many floor radii round the centre, this high over the floor (m). PROVISIONAL. */
const STARTER_RAIL_RADIUS_U = 0.6;
const STARTER_RAIL_HEIGHT_M = 1.6;
/** How far each starter rail runs round the circle (± degrees from its middle) and how many points define it. PROVISIONAL. */
const STARTER_RAIL_HALF_SPAN_DEG = 50;
const STARTER_RAIL_POINTS = 9;

function arcRail(id: string, label: string, middleDeg: number): RailBlueprint {
  const points = [];
  for (let i = 0; i < STARTER_RAIL_POINTS; i++) {
    const deg = middleDeg - STARTER_RAIL_HALF_SPAN_DEG + (2 * STARTER_RAIL_HALF_SPAN_DEG * i) / (STARTER_RAIL_POINTS - 1);
    const rad = (deg * Math.PI) / 180;
    points.push({ u: STARTER_RAIL_RADIUS_U * Math.cos(rad), v: STARTER_RAIL_RADIUS_U * Math.sin(rad), heightM: STARTER_RAIL_HEIGHT_M });
  }
  return { id, label, points };
}

/**
 * Owner, 2026-10-08 ("2 pra iniciar, escolha por si"): two rails to start, the layout left to me — so PROVISIONAL, to be
 * changed by playtest here. Two mirrored arcs, east and west of the centre (the Beys spawn north and south, so neither side
 * is nearer), high enough that only a full jump reaches it so a Bey must jump toward one to grab it. Authored in floor radii, so they follow
 * the stage size and the funnel (RailBlueprint).
 */
export const STARTER_RAILS: readonly RailBlueprint[] = [arcRail('rail-east', 'East rail', 0), arcRail('rail-west', 'West rail', 180)];

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
