// ============================================================
// VFX ROUTING SELF-TESTS
// A connecting hit or wall/floor bounce is the only thing that should ever
// spawn a "contact" spark — an evaded attack must never show one, and
// stabilityBreak/ko/ringOut (which co-occur with the same hit in the same
// tick's event list) must not spawn a duplicate burst on top of it.
// ============================================================

import { describe, expect, it } from 'vitest';
import type { ImpactEvent, ImpactEventKind } from '../../src/camera/ImpactEvents';
import { routeImpactEventToVfx } from '../../src/vfx/VfxRouting';

const POS = { x: 0, y: 0, z: 0 };

function eventOf(kind: ImpactEventKind): ImpactEvent {
  return { kind, magnitude: 1, worldPositionM: POS, isFirst: true };
}

describe('routeImpactEventToVfx', () => {
  it('routes physical-contact events to a spark', () => {
    expect(routeImpactEventToVfx(eventOf('hit'))).toBe('spark');
    expect(routeImpactEventToVfx(eventOf('wallImpact'))).toBe('spark');
  });

  it('routes landing to its own dedicated effect, not a spark', () => {
    expect(routeImpactEventToVfx(eventOf('landing'))).toBe('landing');
  });

  it('never routes an evaded attack to a contact spark', () => {
    expect(routeImpactEventToVfx(eventOf('dodged'))).toBe('none');
    expect(routeImpactEventToVfx(eventOf('perfectDodge'))).toBe('none');
  });

  it('does not give stabilityBreak/ko/ringOut their own spark (they co-occur with the hit that already gets one)', () => {
    expect(routeImpactEventToVfx(eventOf('stabilityBreak'))).toBe('none');
    expect(routeImpactEventToVfx(eventOf('ko'))).toBe('none');
    expect(routeImpactEventToVfx(eventOf('ringOut'))).toBe('none');
  });
});
