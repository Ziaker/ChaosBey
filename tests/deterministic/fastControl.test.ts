// Owner, 2026-10-04: "do nada ele perde o controle e para de responder meus comandos de movimentação pelas setas quando
// fica muito rápido". A fast lap of the default funnel, steered the whole time: wall / rim impacts never take the
// controls away (they did for ~28% of the lap), and the heading follows the stick.

import { describe, expect, it } from 'vitest';
import { BEY_SPAWN_HEIGHT_M } from '../../src/bey/core/BeyTuning';
import { createDefaultMatchConfig } from '../../src/config/match/MatchConfig';
import type { ControllerActions } from '../../src/input/actions/Action';
import { CombatHarness } from './combatHarness';

const NONE: ControllerActions = { held: new Set(), pressedThisFrame: new Set(), attackHoldDurationSeconds: 0, jumpDriftHoldDurationSeconds: 0 };

describe('control at speed (owner, 2026-10-04)', () => {
  it('a fast steered lap of the funnel never loses the controls, and the heading follows the stick', async () => {
    const cfg = { ...createDefaultMatchConfig(), winByRingOut: false, winByKo: false, winBySpinOut: false };
    const h = await CombatHarness.create({ x: 0, y: BEY_SPAWN_HEIGHT_M, z: -20 }, { x: 30, y: BEY_SPAWN_HEIGHT_M, z: 30 }, cfg);
    let noControl = 0;
    let offTheStick = 0;
    let speedSum = 0;
    for (let t = 0; t < 1200; t++) {
      const v = h.first.body.linvel();
      const wanted = (Math.hypot(v.x, v.z) > 1 ? Math.atan2(v.x, v.z) : 0) + 0.18;
      const r = h.tick({ ...NONE, moveIntent: { x: Math.sin(wanted), z: Math.cos(wanted) } }, NONE);
      if (h.first.movement.getDebugState().postImpactCooldownRemainingS > 0) noControl++;
      const err = h.first.movement.getHeadingRad() - wanted;
      if (Math.abs(Math.atan2(Math.sin(err), Math.cos(err))) > 0.6) offTheStick++;
      speedSum += r.first.movement.speedMps;
    }
    expect(speedSum / 1200).toBeGreaterThan(25); // really fast
    expect(noControl).toBe(0); // was 337 of 1200 ticks
    // The stick here is the direction of travel (+0.18 rad), and since 0.49.0 the funnel's slide is part of the velocity but
    // not of what the stick drives: the heading follows the stick, the velocity also follows the slope (98 of 1200 ticks off).
    expect(offTheStick).toBeLessThan(150); // ≥ 87% of the lap on the stick (was 95% before the funnel pull)
  });
});
