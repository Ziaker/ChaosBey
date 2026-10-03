// ============================================================
// MOMENTUM — GAMEPLAY TUNING (owner, 2026-10-02, Lote 3)
// "O jogo é muito mais sobre build-up de velocidade do que ataques um atrás
// do outro." Each Bey has a momentum resource (0..1): it builds while the
// Bey keeps moving fast without sharp turns and drains when it brakes, turns
// hard, stands still, takes a hit or hits a wall. Its top speed is
// maxSpeed × (1 + momentum × gain). The defaults are PROVISIONAL (owner
// numbers where given: +100% gain, 4 s to fill, 2 s to drain); each is a
// Pregame slider (MatchConfig).
// ============================================================

export const MOMENTUM_GAIN_DEFAULT = 1;
export const MOMENTUM_GAIN_RANGE = { min: 0, max: 2, step: 0.1 } as const;
export const MOMENTUM_FILL_DEFAULT_S = 4;
export const MOMENTUM_FILL_RANGE = { min: 1, max: 10, step: 0.5 } as const;
export const MOMENTUM_DECAY_DEFAULT_S = 2;
export const MOMENTUM_DECAY_RANGE = { min: 0.5, max: 6, step: 0.25 } as const;

/** Builds only above this fraction of the Bey's current top speed (the owner's "~50% do teto atual"). */
export const MOMENTUM_BUILD_MIN_SPEED_FRACTION = 0.5;
/** A heading change faster than this (rad/s) is a sharp turn: momentum drains instead of building. PROVISIONAL. */
export const MOMENTUM_SHARP_TURN_RAD_PER_S = 2.2;

// --- Body collisions (owner item 9) ---
// When the Beys touch without an attack, the slower one takes Stability
// damage ∝ the speed difference (plus knockback) and the faster one loses
// part of its momentum. Default damage = a Circular Attack's
// (CIRCULAR_STABILITY_DAMAGE) at a 10 m/s difference; the Pregame slider
// "Body collision damage" scales it (×1 default).
export const BODY_COLLISION_REFERENCE_SPEED_DIFF_MPS = 10;
export const BODY_COLLISION_DAMAGE_DEFAULT = 1;
export const BODY_COLLISION_DAMAGE_RANGE = { min: 0, max: 3, step: 0.1 } as const;
/** Fraction of the faster Bey's momentum lost on a body collision ("Momentum loss on collision"); also on a hit taken or a wall impact. PROVISIONAL. */
export const MOMENTUM_LOSS_ON_COLLISION_DEFAULT = 0.5;
export const MOMENTUM_LOSS_ON_COLLISION_RANGE = { min: 0, max: 1, step: 0.05 } as const;
/** Both Beys take this much Stability damage on a qualifying contact, even at equal speeds (the owner's "dano mínimo simétrico"). PROVISIONAL. */
export const BODY_COLLISION_MIN_DAMAGE = 1;
/** Contacts closing slower than this (m/s) are resting contact, not a collision. PROVISIONAL. */
export const BODY_COLLISION_MIN_CLOSING_SPEED_MPS = 1.5;
/** One collision per contact: after one, the pair ignores contact for this long. PROVISIONAL. */
export const BODY_COLLISION_COOLDOWN_S = 0.35;
/** Extra reach (m) beyond the two colliders' radii that still counts as touching (contact solver slop). */
export const BODY_COLLISION_CONTACT_SLOP_M = 0.05;
