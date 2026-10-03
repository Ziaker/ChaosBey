// Owner, 2026-10-02 (Lote 9 / item 20): MatchConfig.airControl must change the real airborne movement, not just exist in Pregame UI/config wiring.
// This drives the real tickMatch/MovementController through CombatHarness. The same sideways velocity is injected while airborne;
// with airControl=0 the lateral component is preserved, while airControl=3 applies 3x the motion preset's air grip and redirects it harder.

import { describe, expect, it } from 'vitest';
import { BEY_SPAWN_HEIGHT_M } from '../../src/bey/core/BeyTuning';
import { Action, type ControllerActions } from '../../src/input/actions/Action';
import { CombatHarness } from './combatHarness';

const NONE: ControllerActions = { held: new Set(), pressedThisFrame: new Set(), attackHoldDurationSeconds: 0, jumpDriftHoldDurationSeconds: 0 };
const forward: ControllerActions = { ...NONE, held: new Set([Action.MoveForward]) };

async function airborneLateralSpeed(airControl: number): Promise<number> {
  const h = await CombatHarness.create(
    { x: 0, y: BEY_SPAWN_HEIGHT_M, z: -14 },
    { x: 25, y: BEY_SPAWN_HEIGHT_M, z: 25 },
    { arenaFloor: 'flat', momentumGain: 0, airControl },
  );
  for (let i = 0; i < 30; i++) h.tick(NONE, NONE);

  // Heading 0 is +Z. Start high enough that the complete measurement stays airborne,
  // with +X velocity therefore entirely lateral to the commanded +Z direction.
  h.first.movement.debugSetHeading(0);
  h.first.body.setTranslation({ x: 0, y: 12, z: -14 }, true);
  h.first.body.setLinvel({ x: 6, y: 0, z: 0 }, true);
  for (let i = 0; i < 20; i++) h.tick(forward, NONE);

  const lateral = Math.abs(h.first.body.linvel().x);
  h.dispose();
  return lateral;
}

describe('Lote 9 air-control slider — real gameplay', () => {
  it('0x preserves substantially more airborne lateral velocity than 3x', async () => {
    const none = await airborneLateralSpeed(0);
    const strong = await airborneLateralSpeed(3);
    expect(none).toBeGreaterThan(5);
    expect(strong).toBeLessThan(none * 0.8);
  });
});
