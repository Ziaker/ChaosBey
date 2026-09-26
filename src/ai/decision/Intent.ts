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
  /** Press an existing advantage against a Broken/low-Stability opponent (GDD section 64 Attack). */
  PressAdvantage = 'PressAdvantage',
  /** Prioritize returning toward the arena center over any other goal (GDD section 129: edge/ring-out awareness overrides normal play when risk is high). */
  RecoverFromEdge = 'RecoverFromEdge',
  /** Use Jump/Drift (evasive hop, or an attempt to bait/avoid via air movement). */
  UseJumpDrift = 'UseJumpDrift',
  /** Use Dodge specifically to answer an imminent opponent hitbox. */
  DodgeThreat = 'DodgeThreat',
  /** Do nothing meaningful this tick (used sparingly — patience/whiff-recovery windows, not a default). */
  Wait = 'Wait',
}
