// ============================================================
// STAGE RAILS — which rails each stage has (Rail Grinding preparation, 0.50.0)
// docs/planning/RAIL_GRINDING_FUTURE_UPDATE.md §6/§13: every stage will get rails, but the number, layout, height and
// positions are an OWNER DECISION (ASK FIRST). No layout is invented here: every stage has an empty list, so the Rails
// option exists and does nothing yet. When a layout is approved it is added to STAGE_RAIL_BLUEPRINTS as data, in stage units
// (see RailBlueprint), and every consumer — gameplay, debug, AI — reads it through railsForMatch().
// ============================================================

import type { ArenaPresetId } from '../presets/ArenaPresets';
import { resolveRail, type RailBlueprint, type RailDefinition, type RailResolveContext } from './RailBlueprint';

/** The approved rail layouts per stage. EMPTY on purpose until the owner decides them. */
export const STAGE_RAIL_BLUEPRINTS: Readonly<Record<ArenaPresetId, readonly RailBlueprint[]>> = {
  foundry: [],
  rift: [],
  tournament: [],
};

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
