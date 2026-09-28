// ============================================================
// CANONICAL VALUE
// The value type every system's getDeterministicState() returns: plain,
// JSON-shaped data (numbers, booleans, strings, null, arrays, objects).
// No class instances, no functions, no references into the engine.
// ============================================================

export type CanonicalValue = number | boolean | string | null | readonly CanonicalValue[] | { readonly [key: string]: CanonicalValue };

export type CanonicalRecord = { readonly [key: string]: CanonicalValue };

/** Implemented by every simulation system whose state goes into CanonicalMatchStateV1. */
export interface DeterministicStateSource {
  /**
   * Read-only snapshot of everything in this system that can change a
   * future tick. Keys are the system's own field names, so a guard test can
   * check every field is either listed here or deliberately excluded.
   */
  getDeterministicState(): CanonicalRecord;
}

/**
 * Converts plain data (numbers, booleans, strings, null/undefined, arrays,
 * Sets, plain objects) into a CanonicalValue. Throws on anything else
 * (class instances, functions, engine handles), so engine state can never
 * slip into the hash by accident. Sets become sorted arrays; undefined
 * becomes null.
 */
export function plainData(value: unknown, path = 'value'): CanonicalValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((item, i) => plainData(item, `${path}[${i}]`));
  if (value instanceof Set) return [...value].map((item, i) => plainData(item, `${path}{${i}}`)).sort((a, b) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0));
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, CanonicalValue> = {};
    for (const [key, item] of Object.entries(value)) out[key] = plainData(item, `${path}.${key}`);
    return out;
  }
  throw new Error(`plainData: ${path} is not plain data (${typeof value === 'object' ? (value as object).constructor?.name : typeof value})`);
}

/** A 2D vector as canonical data. */
export function vec2(v: { readonly x: number; readonly z: number } | null): CanonicalValue {
  return v === null ? null : { x: v.x, z: v.z };
}
