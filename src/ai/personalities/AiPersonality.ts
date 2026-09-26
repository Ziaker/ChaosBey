// ============================================================
// AI PERSONALITY — DATA-DRIVEN BEHAVIORAL TENDENCIES
// GDD section 64: archetype AI personalities are "tendencies, not scripts".
// This is the internal knob set IntentSelection/ActionSelection read to
// bias an otherwise-identical decision pipeline toward each archetype's
// approved direction (Attack aggressive/risk-taking, Defense reactive/
// spacing-focused, Stamina evasive/resource-preserving — GDD section 64).
// Every value here is an engineering placeholder (GDD section 167) — none
// of this is final balance, and none of it is the player-facing difficulty
// tier system (GDD section 59/171 item 4), which remains unresolved and is
// deliberately NOT decided here (see AiDifficultyProfile.ts).
// ============================================================

export interface AiPersonality {
  readonly id: string;

  /** 0..1. Higher = seeks engagement more readily, commits to Dash charges sooner, presses advantage on a broken opponent (GDD section 64 Attack). */
  readonly aggression: number;

  /** 0..1. Higher = keeps more spacing, favors counter-timing over initiating, retreats sooner when at a stamina/stability disadvantage (GDD section 64 Defense). */
  readonly caution: number;

  /** 0..1. Higher = more willing to wait out cooldowns/resources rather than force an approach; discourages spending Stamina on avoidable collisions (GDD section 64 Stamina). */
  readonly patience: number;

  /** Multiplies edge-risk weighting in RiskEvaluation — how strongly this personality avoids/reacts to ring-out danger (GDD section 129: AI must know when it is at risk and attempt recovery). Never below 1: no personality is allowed to ignore ring-out risk entirely. */
  readonly edgeCautionMultiplier: number;

  /** 0..1 probability a threatened dodge attempt actually fires in time (skill/consistency knob — humanization, GDD section 63, not raw reflex speed, which is reactionDelaySeconds below). */
  readonly dodgeSkill: number;

  /** Seconds of artificial reaction delay before a fresh decision replaces the current intent (GDD section 63: "artificial reaction delay" is explicitly approved humanization, not an accident). */
  readonly reactionDelaySeconds: number;

  /** 0..1 chance, each time a fresh decision is made, that IntentionalError.ts substitutes a deliberately weaker choice (GDD section 63/65: "deliberate errors ... error rate varies by difficulty"). */
  readonly errorRate: number;

  /** Approximate Clash mash events per second this personality presses for (GDD section 42/152: AI participates in Clash through the same abstract action interface as a player, never a literal event-synthesis backdoor). */
  readonly clashMashRatePerSecond: number;

  /** 0..1. How strongly AdaptationTracker's observed opponent tendencies are allowed to nudge decisions (GDD section 63: "AI can adapt to player habits during a fight"). */
  readonly adaptationRate: number;

  /** Preferred distance (m) from the opponent this personality tries to hold outside of an active engagement — Attack tends low, Defense/Stamina higher. */
  readonly preferredEngageRangeM: number;
}
