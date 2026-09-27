// ============================================================
// BEY MOTION LAB — ROTATIONAL SYMMETRY OF EACH CONCEPT'S RING
// A spinning shape with N-fold symmetry looks identical every 360°/N. The
// eye only sees one sample per rendered frame, so what reads on screen is
// the rotation per frame MODULO 360°/N (the "wagon wheel" effect): near 0
// the ring looks frozen, just below 360°/N it looks like it turns slowly
// backwards. N is the ring's repeated feature count (from the round-2
// catalog and the ring builders' counts: lobes, blades, plates, pods...).
// Asymmetric rings (N = 1) have no such aliasing. A fine repeated detail
// (rim teeth) aliases on its own, much sooner.
// ============================================================

export interface SymmetryInfo {
  /** Repeat count of the ring's main feature (1 = asymmetric, 0 = no angular feature). */
  readonly fold: number;
  readonly feature: string;
  /** A finer repeated detail that also aliases (e.g. rim teeth), if any. */
  readonly detail?: { readonly fold: number; readonly feature: string };
}

export const RING_SYMMETRY: Readonly<Record<string, SymmetryInfo>> = {
  'attack-a': { fold: 4, feature: '4 impact lobes' },
  'attack-b': { fold: 1, feature: '3 unequal blades (asymmetric)' },
  'attack-c': { fold: 2, feature: '2 hammer blocks' },
  'defense-a': { fold: 8, feature: '8 overlapping plates' },
  'defense-b': { fold: 6, feature: '6 spring pods' },
  'defense-c': { fold: 8, feature: '8 battlements' },
  'stamina-a': { fold: 5, feature: '5 curved spokes / weights' },
  'stamina-b': { fold: 6, feature: '6 pin bridges (concentric rings)', detail: { fold: 48, feature: '48 rim teeth' } },
  'stamina-c': { fold: 3, feature: '3 weighted lobes' },
};

export interface ApparentSpin {
  /** Real rotation per rendered frame (degrees). */
  readonly degPerFrame: number;
  /** Rotation per frame as the eye reads it, folded into (-period/2, period/2] (degrees; negative = looks backwards). */
  readonly apparentDegPerFrame: number | null;
  /** Human-readable verdict. */
  readonly verdict: string;
}

/** What a viewer sees at `frameHz` for a ring with `fold`-fold symmetry spinning at `rateRadS`. */
export function apparentSpin(rateRadS: number, fold: number, frameHz: number): ApparentSpin {
  const degPerFrame = (Math.abs(rateRadS) * 180) / Math.PI / frameHz;
  if (fold === 0) return { degPerFrame, apparentDegPerFrame: null, verdict: 'no angular feature: spin not readable from the ring' };
  const period = 360 / fold;
  let folded = degPerFrame % period;
  if (folded > period / 2) folded -= period;
  const ratio = Math.abs(folded) / period;
  let verdict: string;
  if (fold === 1) verdict = degPerFrame > 90 ? 'asymmetric: jumps (large steps per frame)' : 'asymmetric: reads as true spin';
  else if (ratio < 0.06) verdict = 'looks FROZEN (aliasing)';
  else if (folded < 0) verdict = 'looks like it turns BACKWARDS (aliasing)';
  else if (ratio > 0.35) verdict = 'direction ambiguous (near half a feature per frame)';
  else verdict = 'reads as forward spin';
  return { degPerFrame, apparentDegPerFrame: fold === 1 ? degPerFrame : folded, verdict };
}
