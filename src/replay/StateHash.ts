// ============================================================
// STATE HASH V1 (M9-A)
// Turns a CanonicalMatchStateV1 into a short, comparable digest — the
// thing two runs (live vs. headless, or a recorded replay vs. its
// playback, once a later lane builds those) actually compare to decide
// "did this diverge". Deliberately NOT JSON.stringify(state): that
// depends on the state object's own key insertion order (an incidental
// implementation detail, not a contract) and treats every number as a
// decimal string that quietly loses the -0/+0 distinction one way and
// mangles NaN into `null` the other way — either could hide, or falsely
// report, a divergence. This instead writes every field, by name, in one
// fixed order (see writeBeyState/writeClashState below — never
// Object.keys() or a spread), as exact IEEE-754 bytes.
//
// No tolerance anywhere: two states hash equal only if every field is
// bit-for-bit identical (after the two canonicalizations below, which are
// about removing spurious differences that were never real gameplay
// differences, not about "close enough"):
// - -0 and +0 hash identically (canonicalized to +0) — they're the same
//   gameplay value; nothing in this codebase's physics/resource math
//   should be able to flip a hash purely over a sign-of-zero artifact.
// - Every NaN hashes identically regardless of its specific bit payload
//   (the engine always produces the same payload for an ordinary NaN
//   result, but nothing guarantees that forever, and a hash that could
//   fail on that basis alone would be worse than useless) — though a NaN
//   appearing at all is itself exactly the kind of physics blow-up
//   MatchAnomalyDetector already flags separately; this just keeps the
//   hash meaningful if one does.
//
// Versioned (CANONICAL_STATE_VERSION is part of the hashed bytes and the
// result): a hash computed under a different canonical-state shape must
// never compare equal to one from this version by accident.
//
// Explicitly OUT of scope here (later M9 lanes): comparing two
// StateHashResults, localizing/reporting a divergence, anything about
// replay recording or playback. This file only answers "what is this
// state's digest", never "do these two digests match".
// ============================================================

import type { CanonicalBeyState, CanonicalClashState, CanonicalMatchStateV1 } from './CanonicalMatchState';
import type { StateHashResult, StateHashSection } from './contracts';

const FNV_OFFSET_BASIS_64 = 0xcbf29ce484222325n;
const FNV_PRIME_64 = 0x100000001b3n;
const UINT64_MASK = 0xffffffffffffffffn;

/** FNV-1a, 64-bit. Not cryptographic — this only needs to make an accidental collision between two genuinely different match states practically impossible, not resist a deliberate attacker. */
function fnv1a64(bytes: Uint8Array): bigint {
  let hash = FNV_OFFSET_BASIS_64;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME_64) & UINT64_MASK;
  }
  return hash;
}

function toHex16(value: bigint): string {
  return value.toString(16).padStart(16, '0');
}

const textEncoder = new TextEncoder();

/** Appends fields as exact bytes, in whatever order the caller writes them — the field order is the caller's contract (see writeBeyState/writeClashState), never derived from object key order. */
class CanonicalByteWriter {
  private readonly chunks: number[] = [];
  private readonly scratch = new DataView(new ArrayBuffer(8));

  writeFloat64(value: number): void {
    // Canonicalize before writing: -0 -> +0, and any NaN -> the one
    // literal NaN value (whatever bit pattern this engine gives *that*,
    // consistently) — see this file's header for why.
    const canonical = Number.isNaN(value) ? NaN : Object.is(value, -0) ? 0 : value;
    this.scratch.setFloat64(0, canonical, false);
    this.pushScratch(8);
  }

  writeUint32(value: number): void {
    this.scratch.setUint32(0, value >>> 0, false);
    this.pushScratch(4);
  }

  writeBool(value: boolean): void {
    this.chunks.push(value ? 1 : 0);
  }

  /** Length-prefixed, so writing "ab" then "c" can never hash the same as writing "a" then "bc". */
  writeString(value: string): void {
    const encoded = textEncoder.encode(value);
    this.writeUint32(encoded.length);
    for (const byte of encoded) this.chunks.push(byte);
  }

  private pushScratch(byteLength: number): void {
    for (let i = 0; i < byteLength; i++) this.chunks.push(this.scratch.getUint8(i));
  }

  toBytes(): Uint8Array {
    return new Uint8Array(this.chunks);
  }
}

function writeVec3(w: CanonicalByteWriter, v: { x: number; y: number; z: number }): void {
  w.writeFloat64(v.x);
  w.writeFloat64(v.y);
  w.writeFloat64(v.z);
}

/** Field order fixed here, by name — see this file's header. Extending CanonicalMatchStateV1 means adding a line here too; nothing here is derived automatically from the type. */
function writeBeyState(w: CanonicalByteWriter, bey: CanonicalBeyState): void {
  writeVec3(w, bey.positionM);
  w.writeFloat64(bey.rotation.x);
  w.writeFloat64(bey.rotation.y);
  w.writeFloat64(bey.rotation.z);
  w.writeFloat64(bey.rotation.w);
  writeVec3(w, bey.linvelMps);
  writeVec3(w, bey.angvelRadPerS);

  w.writeFloat64(bey.movement.headingRad);
  w.writeFloat64(bey.movement.turnRateRadPerS);
  w.writeFloat64(bey.movement.postImpactCooldownRemainingS);

  w.writeFloat64(bey.spin.spinRateRadPerSec);
  w.writeFloat64(bey.spin.visualSpinAngleRad);
  w.writeFloat64(bey.spin.wobbleEnergy);
  w.writeFloat64(bey.spin.wobbleTimeAccumulatorS);

  w.writeString(bey.drift.state);
  w.writeFloat64(bey.drift.hopTimerS);
  w.writeFloat64(bey.drift.recoveryTimerS);
  w.writeFloat64(bey.drift.jumpAssistElapsedS);
  w.writeBool(bey.drift.wasGrounded);
  w.writeFloat64(bey.drift.lastAirborneVerticalVelocityMps);

  w.writeString(bey.dodge.state);
  w.writeFloat64(bey.dodge.activeTimerS);
  w.writeFloat64(bey.dodge.cooldownTimerS);
  w.writeBool(bey.dodge.wasGrounded);
  w.writeBool(bey.dodge.airRecoveryAvailable);
  w.writeBool(bey.dodge.launchPending);
  w.writeFloat64(bey.dodge.launchPendingRemainingS);

  w.writeString(bey.attack.state);
  w.writeFloat64(bey.attack.bufferTimerS);
  w.writeFloat64(bey.attack.chargeTimerS);
  w.writeFloat64(bey.attack.activeTimerS);
  w.writeFloat64(bey.attack.recoveryTimerS);

  w.writeFloat64(bey.stamina.value);
  w.writeFloat64(bey.stability.value);
  w.writeBool(bey.stability.broken);
  w.writeFloat64(bey.stability.timeSinceLastDamageS);
  w.writeFloat64(bey.attackEnergy.value);
  w.writeFloat64(bey.attackEnergy.timeSinceLastConsumptionS);

  w.writeUint32(bey.aiRngState);
}

function writeClashState(w: CanonicalByteWriter, clash: CanonicalClashState): void {
  w.writeString(clash.state);
  w.writeFloat64(clash.elapsedS);
  w.writeFloat64(clash.cooldownRemainingS);
  w.writeUint32(clash.firstMashEventCount);
  w.writeUint32(clash.secondMashEventCount);
  w.writeFloat64(clash.firstStaminaFractionAtStart);
  w.writeFloat64(clash.secondStaminaFractionAtStart);
  w.writeFloat64(clash.firstSpeedMpsAtStart);
  w.writeFloat64(clash.secondSpeedMpsAtStart);
  w.writeBool(clash.lastResult !== null);
  if (clash.lastResult) {
    w.writeString(clash.lastResult.outcome);
    w.writeFloat64(clash.lastResult.firstClashPower);
    w.writeFloat64(clash.lastResult.secondClashPower);
    w.writeUint32(clash.lastResult.firstMashEventCount);
    w.writeUint32(clash.lastResult.secondMashEventCount);
  }
}

function hashSection(write: (w: CanonicalByteWriter) => void): string {
  const writer = new CanonicalByteWriter();
  write(writer);
  return toHex16(fnv1a64(writer.toBytes()));
}

/**
 * Hashes one CanonicalMatchStateV1. Three section digests (first/second/
 * match) are computed independently so a mismatch can be localized to one
 * side or to match-level state (round/Clash) without re-hashing everything
 * — then combined, with the version and tick, into the overall `hash`.
 */
export function computeStateHash(state: CanonicalMatchStateV1): StateHashResult {
  const sections: Record<StateHashSection, string> = {
    first: hashSection((w) => writeBeyState(w, state.first)),
    second: hashSection((w) => writeBeyState(w, state.second)),
    match: hashSection((w) => {
      w.writeString(state.roundOutcome);
      writeClashState(w, state.clash);
    }),
  };

  const overall = hashSection((w) => {
    w.writeUint32(state.canonicalStateVersion);
    w.writeUint32(state.tick);
    w.writeString(sections.first);
    w.writeString(sections.second);
    w.writeString(sections.match);
  });

  return {
    canonicalStateVersion: state.canonicalStateVersion,
    tick: state.tick,
    hash: overall,
    sections,
  };
}
