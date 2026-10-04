// ============================================================
// DETERMINISTIC COMBAT TEST HARNESS
// Two Beys driven through the exact same tickMatch() orchestration
// main.ts uses, headless — Milestone 2's combat self-tests (GDD section
// 151) exercise the real controllers, not a simplified stand-in (GDD
// section 114). The match itself is built by the runtime self-test core
// (src/self-test/SelfTestMatchWorld.ts); this keeps the tests' own
// positional create() signature and their closer default spawns.
// ============================================================

import type { BeyDefinition } from '../../src/bey/archetype/BeyDefinition';
import { BEY_SPAWN_HEIGHT_M } from '../../src/bey/core/BeyTuning';
import type { ClashAiMashSource } from '../../src/combat/clash/ClashMash';
import { floorHeightAt } from '../../src/arena/floor/ArenaFloorProfile';
import { arenaFloorOf, resolveMatchConfig, type MatchConfig } from '../../src/config/match/MatchConfig';
import { SelfTestMatchWorld } from '../../src/self-test/SelfTestMatchWorld';

/** The test suite's default spawns: closer than the live game's (±4 m), so scripted scenarios reach contact quickly. */
export const HARNESS_FIRST_SPAWN = { x: 0, y: BEY_SPAWN_HEIGHT_M, z: -2 };
export const HARNESS_SECOND_SPAWN = { x: 0, y: BEY_SPAWN_HEIGHT_M, z: 2 };

/**
 * The mechanism tests built on this harness (dodge, air recovery, AI reactions, collisions, combat timing) were
 * calibrated on the handling, jump timing and floor before the owner's 2026-10-04 feel pass. They keep running on
 * that baseline so each still isolates its own mechanism; the shipped defaults (×1.45 speed/acceleration/turning,
 * 85% speed kept in turns, +150% momentum, the 7 m funnel) are covered by
 * ownerFeel20261004.test.ts (which passes createDefaultMatchConfig() explicitly) and by every AI / replay / scenario
 * simulation, which use the real defaults. A test overrides any of these by passing them.
 */
export const MECHANISM_BASELINE: Partial<MatchConfig> = {
  topSpeedScale: 1,
  accelerationScale: 1,
  turnRateScale: 1,
  turnSpeedRetention: 0,
  highSpeedControl: 0,
  momentumGain: 1,
  gravityScale: 1,
  contactRepelMps: 0,
  attackRecoilMps: 0,
  momentumDecayS: 2,
  momentumLossOnCollision: 0.5,
  jumpFullHeightM: 2.5,
  jumpShortHopHeightM: 0.1265,
  movementStaminaDrain: 1,
  dodgeCooldownS: 3,
  airControl: 1,
  dodgeStaminaCost: 20,
  arenaWallRestitution: 0.55,
  jumpHoldForFullS: 0.2,
  arenaFloor: 'bowl-a',
  arenaBowlDepthM: 2.5,
};

export class CombatHarness extends SelfTestMatchWorld {
  /**
   * `aiMashSource` defaults to ClashOrchestration's own default
   * (FixedIntervalAiMashSource, unchanged prior behavior for every existing
   * M1-M6 test) — pass NullAiMashSource explicitly (as main.ts does) when
   * `second` will be driven by a real AIController, whose own real Z/X/C
   * presses already reach ClashController through the normal per-combatant
   * channel; leaving the default active in that case would let the
   * placeholder silently add a second, unrelated mash contribution on top
   * of the AI's own (see ClashMash.ts's NullAiMashSource doc comment).
   */
  static async create(
    firstSpawn: { x: number; y: number; z: number } = HARNESS_FIRST_SPAWN,
    secondSpawn: { x: number; y: number; z: number } = HARNESS_SECOND_SPAWN,
    matchConfigOverrides: Partial<MatchConfig> = {},
    aiMashSource?: ClashAiMashSource,
    definitions: { first?: BeyDefinition; second?: BeyDefinition } = {},
  ): Promise<CombatHarness> {
    // The tests' spawn heights were written for a flat floor (y = height above
    // the ground); on a bowl floor (the default since the arena scale pass)
    // they are lifted onto it, the same way matchSpawnsFor() lifts the live
    // game's spawns. Flat: unchanged.
    matchConfigOverrides = { ...MECHANISM_BASELINE, ...matchConfigOverrides };
    const floor = arenaFloorOf(resolveMatchConfig(matchConfigOverrides)); // Lote 9: profile + depth
    const lift = (s: { x: number; y: number; z: number }) => ({ x: s.x, y: s.y + floorHeightAt(floor, s.x, s.z), z: s.z });
    const parts = await SelfTestMatchWorld.buildParts({
      firstSpawn: lift(firstSpawn),
      secondSpawn: lift(secondSpawn),
      matchConfigOverrides,
      aiMashSource,
      firstDefinition: definitions.first,
      secondDefinition: definitions.second,
    });
    return new CombatHarness(parts.physics, parts.first, parts.second, parts.roundState, parts.clash);
  }
}
