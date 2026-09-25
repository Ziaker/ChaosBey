// ============================================================
// STABILITY — GAMEPLAY TUNING
// Resistance to violent displacement (GDD section 28/29). Approved KO
// model is "C — Stability Break": reaching zero does not itself end the
// round; the Bey enters a vulnerable Broken state, and a subsequent
// *qualifying* hit while Broken is what causes a KO (subject to active
// match rules). All values are Milestone 2 engineering placeholders.
// ============================================================

export const STABILITY_MAX = 100;

// Recovery only resumes after this long without taking a hit (GDD section
// 28: "recover partially when avoiding impacts for sufficient time";
// section 124: never refill during active collision pressure).
export const STABILITY_RECOVERY_DELAY_AFTER_HIT_S = 3;
export const STABILITY_RECOVERY_PER_S = 8;

// A hit while Broken is only "qualifying" (KO-causing) if its own
// Stability-damage component reaches this floor — a mostly-spent, barely-
// there whiff shouldn't decisively end a match. Tuning placeholder.
export const STABILITY_QUALIFYING_HIT_MIN_DAMAGE = 5;

// Owner decision (2026-09-25): Broken is recoverable, not permanent — the
// GDD requires the system to expose broken-state recovery rules. Avoiding
// hits for this much longer than the normal in-fight recovery delay lets
// a Broken Bey climb back to a small Stability floor and leave Broken,
// giving the opponent a real (but not indefinite) window to finish it.
export const STABILITY_BROKEN_RECOVERY_DELAY_AFTER_HIT_S = 6;
export const STABILITY_BROKEN_RECOVERY_FLOOR = 20;

// Wall/floor impacts also cost Stability (GDD section 37), scaled by how
// hard the hit was (MovementController's detected impact speed delta).
export const WALL_IMPACT_STABILITY_DAMAGE_PER_MPS = 0.8;
