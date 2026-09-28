// ============================================================
// SEEDED RNG — DETERMINISTIC RANDOM NUMBER GENERATOR
// All gameplay-relevant randomness must go through this class rather than
// Math.random(), so matches are reproducible from a seed (GDD section 73).
// ============================================================

import { normalizeSeedText } from './stringSeed';

/**
 * mulberry32: small, fast, well-distributed 32-bit PRNG. Not
 * cryptographically secure — that is not a requirement for gameplay RNG.
 */
export class SeededRng {
  private state: number;
  private readonly canonicalSeedText: string;

  private constructor(seedUint32: number, canonicalSeedText: string) {
    this.state = seedUint32 >>> 0;
    this.canonicalSeedText = canonicalSeedText;
  }

  static fromSeedText(seedText: string): SeededRng {
    const { seedUint32, canonicalText } = normalizeSeedText(seedText);
    return new SeededRng(seedUint32, canonicalText);
  }

  static fromSeedUint32(seedUint32: number): SeededRng {
    return new SeededRng(seedUint32 >>> 0, seedUint32.toString(10));
  }

  getCanonicalSeedText(): string {
    return this.canonicalSeedText;
  }

  /** Returns a float in [0, 1). */
  nextFloat(): number {
    this.state |= 0;
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Returns an integer in [min, max] inclusive. */
  nextInt(min: number, max: number): number {
    if (max < min) {
      throw new Error(`SeededRng.nextInt: max (${max}) must be >= min (${min}).`);
    }
    return min + Math.floor(this.nextFloat() * (max - min + 1));
  }

  /** Returns a float in [min, max). */
  nextRange(min: number, max: number): number {
    return min + this.nextFloat() * (max - min);
  }

  /** Returns true with the given probability (0..1). */
  nextBool(probability = 0.5): boolean {
    return this.nextFloat() < probability;
  }
}

/**
 * Named RNG streams so unrelated systems never perturb each other's
 * sequences (GDD section 73: gameplay RNG, AI RNG, cosmetic RNG are kept
 * separate). Cosmetic draws (e.g. spark scatter) must never be able to
 * change gameplay-relevant outcomes just because visuals changed.
 *
 * Schema v2 (M9, RNG_SCHEMA_VERSION in src/replay/contracts.ts): `aiFirst`/
 * `aiSecond` replace the old single shared `ai` stream. Before this, both
 * sides' AIController — when both are AI-driven — read from the exact same
 * SeededRng instance (MatchSession wired `rngStreams.ai` to both sides'
 * controllerDeps), so one side's decision cadence silently perturbed the
 * other's draws. Each side now gets its own independent stream, matching
 * what the headless/Self-Test path already did (SeededRng.fromSeedText(
 * `${seed}/first`) / `${seed}/second`) — this closes that live-vs-headless
 * inconsistency, not just adds a name.
 */
export interface RngStreams {
  /**
   * The canonical match seed text — what the UI shows, what gets copied,
   * and what must be re-entered to reproduce this exact match (GDD section
   * 73: "visible, copyable, manually enterable, reusable"). This is NOT any
   * individual stream's internal seed: each stream below is salted before
   * being turned into a SeededRng, so its own getCanonicalSeedText() would
   * return a different, non-reusable value.
   */
  readonly rootSeedText: string;
  readonly gameplay: SeededRng;
  readonly aiFirst: SeededRng;
  readonly aiSecond: SeededRng;
  readonly cosmetic: SeededRng;
}

/**
 * Derives independent-looking sub-streams from one match seed by mixing in
 * a stream-specific salt. Keeps a single shareable/copyable seed (GDD
 * section 73) as the sole source of truth for the whole match.
 */
export function createRngStreams(seedText: string): RngStreams {
  const { seedUint32, canonicalText } = normalizeSeedText(seedText);
  return {
    rootSeedText: canonicalText,
    gameplay: SeededRng.fromSeedUint32((seedUint32 ^ 0x9e3779b9) >>> 0),
    aiFirst: SeededRng.fromSeedUint32((seedUint32 ^ 0x85ebca6b) >>> 0),
    aiSecond: SeededRng.fromSeedUint32((seedUint32 ^ 0x27d4eb2f) >>> 0),
    cosmetic: SeededRng.fromSeedUint32((seedUint32 ^ 0xc2b2ae35) >>> 0),
  };
}
