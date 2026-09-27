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
import type { MatchConfig } from '../../src/config/match/MatchConfig';
import { SelfTestMatchWorld } from '../../src/self-test/SelfTestMatchWorld';

/** The test suite's default spawns: closer than the live game's (±4 m), so scripted scenarios reach contact quickly. */
export const HARNESS_FIRST_SPAWN = { x: 0, y: BEY_SPAWN_HEIGHT_M, z: -2 };
export const HARNESS_SECOND_SPAWN = { x: 0, y: BEY_SPAWN_HEIGHT_M, z: 2 };

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
    const parts = await SelfTestMatchWorld.buildParts({
      firstSpawn,
      secondSpawn,
      matchConfigOverrides,
      aiMashSource,
      firstDefinition: definitions.first,
      secondDefinition: definitions.second,
    });
    return new CombatHarness(parts.physics, parts.first, parts.second, parts.roundState, parts.clash);
  }
}
