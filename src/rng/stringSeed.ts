// ============================================================
// SEED NORMALIZATION
// Converts any human-friendly seed text (numeric, UUID-like, or
// arbitrary string) into a canonical 32-bit unsigned integer that
// seeds the deterministic RNG. See GDD section 73.
// ============================================================

/**
 * cyrb53-style string hash. Not cryptographic — only needs to be fast,
 * stable across runs, and well-distributed for RNG seeding.
 */
function hashStringToUint32(text: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0 ^ h1 >>> 0) >>> 0;
}

/**
 * Normalizes arbitrary seed input text into a canonical uint32 seed value
 * plus the canonical string form that should be stored in telemetry/replay
 * metadata (GDD section 73/76). A purely numeric string is treated as the
 * literal numeric seed so short human-entered seeds like "1234" behave
 * predictably; anything else (including UUID-like strings) is hashed.
 */
export function normalizeSeedText(rawSeedText: string): { seedUint32: number; canonicalText: string } {
  const trimmed = rawSeedText.trim();
  if (trimmed.length === 0) {
    throw new Error('normalizeSeedText: seed text must not be empty.');
  }

  const isPlainInteger = /^-?\d+$/.test(trimmed);
  if (isPlainInteger) {
    const asNumber = Math.abs(Number.parseInt(trimmed, 10)) >>> 0;
    return { seedUint32: asNumber, canonicalText: trimmed };
  }

  return { seedUint32: hashStringToUint32(trimmed), canonicalText: trimmed };
}

/** Generates a fresh, human-shareable random seed string (copyable, reusable). */
export function generateRandomSeedText(): string {
  return Math.floor(Math.random() * 0xffffffff).toString(10);
}
