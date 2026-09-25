// ============================================================
// VFX ROUTING
// Decides which visual effect (if any) an ImpactEvent should spawn.
// Deliberately narrow: only an event that represents an actual physical
// contact (a connecting hit, a wall/floor bounce) spawns a spark burst —
// an evaded attack (dodged/perfectDodge) must never show a "contact"
// spark, and stabilityBreak/ko/ringOut (which co-occur with the very same
// hit that caused them, in the same tick's event list) must not spawn a
// second, duplicate burst on top of that hit's own spark. Landing is its
// own dedicated effect. Everything else (camera shake/hitstop/FOV-punch)
// is a separate consumer of the same ImpactEvent list and is unaffected
// by this routing — this module only decides the *visual* response.
// ============================================================

import type { ImpactEvent } from '../camera/ImpactEvents';

export type VfxRoute = 'spark' | 'landing' | 'none';

const SPARK_ELIGIBLE_EVENT_KINDS: ReadonlySet<ImpactEvent['kind']> = new Set(['hit', 'wallImpact']);

export function routeImpactEventToVfx(event: ImpactEvent): VfxRoute {
  if (event.kind === 'landing') return 'landing';
  if (SPARK_ELIGIBLE_EVENT_KINDS.has(event.kind)) return 'spark';
  return 'none';
}
