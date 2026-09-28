// ============================================================
// STATE HASH (M9 — owner decision: strict floats)
// Hashes a CanonicalValue (normally CanonicalMatchStateV1) with FNV-1a 64
// (STATE_HASH_ALGORITHM) over a canonical byte encoding:
// - objects: keys sorted, so field order in code never matters;
// - each value carries a type tag, so 1, "1" and true never collide;
// - numbers are their exact IEEE-754 float64 bits, little-endian. The only
//   canonicalization is -0 -> +0 and every NaN -> one NaN pattern. No
//   rounding: a last-bit difference is a real divergence and must show.
// Pure TypeScript, no BigInt (the hash runs every checkpoint in batches).
// ============================================================

import type { StateHash } from '../contracts';
import type { CanonicalValue } from './CanonicalValue';

const TAG_NULL = 0x00;
const TAG_FALSE = 0x01;
const TAG_TRUE = 0x02;
const TAG_NUMBER = 0x03;
const TAG_STRING = 0x04;
const TAG_ARRAY = 0x05;
const TAG_OBJECT = 0x06;

const numberView = new DataView(new ArrayBuffer(8));
const textEncoder = new TextEncoder();

/** FNV-1a 64 state as four 16-bit limbs (h0 = lowest), so every step fits in 32-bit integer math. */
class Fnv1a64 {
  private h0 = 0x2325;
  private h1 = 0x8422;
  private h2 = 0x9ce4;
  private h3 = 0xcbf2;

  byte(b: number): void {
    this.h0 ^= b & 0xff;
    // Multiply by the FNV-64 prime 0x100000001b3 (limbs: 0x01b3, 0, 0x0100, 0).
    const t0 = this.h0 * 0x1b3;
    let t1 = this.h1 * 0x1b3;
    let t2 = this.h2 * 0x1b3 + this.h0 * 0x100;
    const t3 = this.h3 * 0x1b3 + this.h1 * 0x100;
    t1 += t0 >>> 16;
    this.h0 = t0 & 0xffff;
    t2 += t1 >>> 16;
    this.h1 = t1 & 0xffff;
    this.h3 = (t3 + (t2 >>> 16)) & 0xffff;
    this.h2 = t2 & 0xffff;
  }

  bytes(data: Uint8Array): void {
    for (let i = 0; i < data.length; i++) this.byte(data[i]!);
  }

  u32(n: number): void {
    this.byte(n);
    this.byte(n >>> 8);
    this.byte(n >>> 16);
    this.byte(n >>> 24);
  }

  hex(): string {
    return [this.h3, this.h2, this.h1, this.h0].map((limb) => limb.toString(16).padStart(4, '0')).join('');
  }
}

function writeNumber(hash: Fnv1a64, n: number): void {
  if (Number.isNaN(n)) {
    numberView.setUint32(0, 0x00000000, true);
    numberView.setUint32(4, 0x7ff80000, true);
  } else {
    numberView.setFloat64(0, n === 0 ? 0 : n, true); // -0 -> +0
  }
  for (let i = 0; i < 8; i++) hash.byte(numberView.getUint8(i));
}

function writeValue(hash: Fnv1a64, value: CanonicalValue): void {
  if (value === null) {
    hash.byte(TAG_NULL);
  } else if (typeof value === 'boolean') {
    hash.byte(value ? TAG_TRUE : TAG_FALSE);
  } else if (typeof value === 'number') {
    hash.byte(TAG_NUMBER);
    writeNumber(hash, value);
  } else if (typeof value === 'string') {
    const encoded = textEncoder.encode(value);
    hash.byte(TAG_STRING);
    hash.u32(encoded.length);
    hash.bytes(encoded);
  } else if (Array.isArray(value)) {
    hash.byte(TAG_ARRAY);
    hash.u32(value.length);
    for (const item of value) writeValue(hash, item);
  } else {
    const record = value as { readonly [key: string]: CanonicalValue };
    const keys = Object.keys(record).sort();
    hash.byte(TAG_OBJECT);
    hash.u32(keys.length);
    for (const key of keys) {
      writeValue(hash, key);
      writeValue(hash, record[key]!);
    }
  }
}

/** The STATE_HASH_ALGORITHM hash of a canonical value, as 16 lowercase hex characters. */
export function stateHash(value: CanonicalValue): StateHash {
  const hash = new Fnv1a64();
  writeValue(hash, value);
  return hash.hex();
}

/** FNV-1a 64 of raw bytes (exposed for the algorithm's published test vectors and for definition digests). */
export function fnv1a64Bytes(data: Uint8Array): string {
  const hash = new Fnv1a64();
  hash.bytes(data);
  return hash.hex();
}

/**
 * Paths where two canonical values differ (exact comparison, same
 * canonicalization as the hash), e.g. `beys.first.body.linvel.x`. Used to
 * say which component diverged, not only that the hashes differ.
 */
export function diffCanonical(a: CanonicalValue, b: CanonicalValue, path = ''): string[] {
  const same = (x: number, y: number) => (Number.isNaN(x) && Number.isNaN(y)) || x === y; // -0 === 0, like the hash
  if (typeof a === 'number' && typeof b === 'number') return same(a, b) ? [] : [path || '(root)'];
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b ? [] : [path || '(root)'];
  if (Array.isArray(a) !== Array.isArray(b)) return [path || '(root)'];
  const ra = a as { readonly [key: string]: CanonicalValue };
  const rb = b as { readonly [key: string]: CanonicalValue };
  const keys = [...new Set([...Object.keys(ra), ...Object.keys(rb)])].sort();
  const out: string[] = [];
  for (const key of keys) {
    const sub = path ? `${path}.${key}` : key;
    if (!(key in ra) || !(key in rb)) out.push(sub);
    else out.push(...diffCanonical(ra[key]!, rb[key]!, sub));
  }
  return out;
}
