// ============================================================
// AI INTENT (MILESTONE 7)
// GDD section 62: layer 4. A small closed set of high-level goals
// IntentSelection.ts chooses between each decision tick; ActionSelection.ts
// then turns whichever one is active into concrete ControllerActions. Kept
// as a flat enum rather than a class hierarchy — GDD section 65 wants
// "current intent" to be a simple, debug-overlay-printable value.
// ============================================================

export enum AiIntent {
  /** Close distance toward the opponent (GDD section 64 Attack: "seeks engagement"). */
  Approach = 'Approach',
  /** Open distance from the opponent (GDD section 64 Defense/Stamina: spacing, resource preservation). */
  Retreat = 'Retreat',
  /** Hold current range, adjusting laterally rather than committing forward/back — used while waiting for a better opening. */
  Circle = 'Circle',
  /** Commit to a Circular Attack now. */
  AttackCircular = 'AttackCircular',
  /** Commit to charging then releasing a Dash Attack. */
  AttackDash = 'AttackDash',
  /** Press an existing advantage: a Broken/low-Stability opponent (GDD section 64 Attack), or one near the ring-out edge — approached from the center side so the hit drives them outward (GDD section 63/129). */
  PressAdvantage = 'PressAdvantage',
  /** Prioritize returning toward the arena center over any other goal (GDD section 129: edge/ring-out awareness overrides normal play when risk is high). */
  RecoverFromEdge = 'RecoverFromEdge',
  /** Use Jump/Drift (evasive hop, or an attempt to bait/avoid via air movement). */
  UseJumpDrift = 'UseJumpDrift',
  /** Use Dodge specifically to answer an imminent opponent hitbox. */
  DodgeThreat = 'DodgeThreat',
  /** Jump to make an immediate hit miss when Dodge isn't available (GDD section 20: a jump that makes an attack miss is an evasion) — full-height jump (no steering, so no drift), carried toward the safe side. */
  JumpEvade = 'JumpEvade',
  /** Hold ground against a telegraphed/incoming Dash Attack and tap a Circular Attack timed to catch it (GDD section 23/107: the Circular-catches-Dash counter launches the dasher upward). Timing must still land — this is a read, not a guaranteed win. */
  CounterAttack = 'CounterAttack',
  /** Do nothing meaningful this tick (used sparingly — patience/whiff-recovery windows, not a default). */
  Wait = 'Wait',
}
