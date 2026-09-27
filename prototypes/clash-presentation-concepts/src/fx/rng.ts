// ============================================================
// CLASH PRESENTATION LAB — SEEDED RNG FOR FX
// The spark bursts need some scatter, but Math.random() would make every
// replay of a scenario look slightly different, which breaks the
// shot-for-shot A/B/C comparison this lab exists for. A tiny seeded
// generator (mulberry32), reseeded whenever the FX are cleared (scenario
// load, restart), makes the same scenario + direction replay identically.
// ============================================================

export const FX_RNG_SEED = 0x5eed_c1a5;

/** Returns a deterministic generator of floats in [0, 1) for a 32-bit seed. */
export function createFxRng(seed: number = FX_RNG_SEED): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
