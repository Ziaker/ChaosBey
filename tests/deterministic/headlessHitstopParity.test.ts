// ============================================================
// HEADLESS HITSTOP PARITY (M9-0A)
// Before this milestone, hitstop was decided entirely inside
// CombatCameraController, so the headless self-test/AI batch runner
// (src/self-test/AiMatchSimulation.ts's stepAiMatchOnWorld, which never
// constructs a camera) never froze at all on a strong hit — a live-vs-
// headless behavioral gap nothing compared directly. This drives the same
// generator the browser Self Test and `npm test`'s deterministic suite
// both use, on a real AI-vs-AI match, and proves the automatic freeze
// actually engages there too, from a real tickMatch()-produced hit —
// not a manually-injected simulationFrozen flag (see
// tests/deterministic/aiHitstopFreeze.test.ts for that complementary
// check) and not the isolated SimulationHitstop class (see
// tests/deterministic/simulationHitstop.test.ts for that).
// ============================================================

import { describe, expect, it } from 'vitest';
import { ATTACK_ARCHETYPE } from '../../src/bey/archetype/BeyArchetypes';
import { NullAiMashSource } from '../../src/combat/clash/ClashMash';
import { SelfTestMatchWorld } from '../../src/self-test/SelfTestMatchWorld';
import { stepAiMatchOnWorld } from '../../src/self-test/AiMatchSimulation';

describe('headless AI-vs-AI hitstop parity', () => {
  it('a real connecting hit freezes physics (position and velocity stop changing) for a few ticks, then resumes on its own', async () => {
    // Two aggressive Attack archetypes, very close together: guarantees a
    // real connecting hit within a handful of ticks, deterministically for
    // this seed (no need to know exactly which tick in advance).
    const world = await SelfTestMatchWorld.build({
      firstSpawn: { x: 0, y: 0.5, z: -1.5 },
      secondSpawn: { x: 0, y: 0.5, z: 1.5 },
      aiMashSource: new NullAiMashSource(),
      firstDefinition: ATTACK_ARCHETYPE,
      secondDefinition: ATTACK_ARCHETYPE,
    });

    try {
      const steps = stepAiMatchOnWorld(world, {
        seed: 'headless-hitstop-parity',
        firstDefinition: ATTACK_ARCHETYPE,
        secondDefinition: ATTACK_ARCHETYPE,
        maxTicks: 600,
      });

      let previousLinvel: { x: number; y: number; z: number } | null = null;
      let previousPosition: { x: number; y: number; z: number } | null = null;
      let frozenPlateauTicks = 0;
      let sawFrozenPlateau = false;
      let sawMovementAfterPlateau = false;

      for (let next = steps.next(); !next.done; next = steps.next()) {
        const linvel = world.second.body.linvel();
        const position = world.second.body.translation();
        const unchanged =
          previousLinvel !== null &&
          previousPosition !== null &&
          linvel.x === previousLinvel.x &&
          linvel.y === previousLinvel.y &&
          linvel.z === previousLinvel.z &&
          position.x === previousPosition.x &&
          position.y === previousPosition.y &&
          position.z === previousPosition.z;

        if (unchanged) {
          frozenPlateauTicks++;
          if (frozenPlateauTicks >= 2) sawFrozenPlateau = true;
        } else {
          if (sawFrozenPlateau) sawMovementAfterPlateau = true;
          frozenPlateauTicks = 0;
        }

        previousLinvel = { x: linvel.x, y: linvel.y, z: linvel.z };
        previousPosition = { x: position.x, y: position.y, z: position.z };

        if (sawFrozenPlateau && sawMovementAfterPlateau) break;
      }

      expect(sawFrozenPlateau, 'never saw a multi-tick plateau of bit-identical position/velocity — hitstop never engaged headless').toBe(true);
      expect(sawMovementAfterPlateau, 'physics never resumed after the plateau — hitstop never ended').toBe(true);
    } finally {
      world.dispose();
    }
  });
});
