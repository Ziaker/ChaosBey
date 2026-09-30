// ============================================================
// FIGHT FRAME (what gameplay tells the camera; ported from the Camera Lab)
// The only thing the Camera Director ever reads. Gameplay provides
// context and intent; the director decides the presentation (GDD 50:
// "Gameplay systems should emit camera intents/events", "do not let every
// gameplay component directly mutate the Three.js camera").
//
// A FightSource produces one FightFrame per fixed 60 Hz tick. Today the
// lab has one real source (RealSimSource: the game's own tickMatch with
// scripted/AI controllers). The approved movement from the Bey Motion Lab
// can later plug in as another FightSource without touching the director.
// ============================================================

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type FighterAttack = 'none' | 'charging' | 'dash' | 'circular' | 'recovery';

export interface FighterFrame {
  readonly position: Vec3;
  readonly velocity: Vec3;
  /** Horizontal speed (m/s). */
  readonly speed: number;
  readonly airborne: boolean;
  readonly attack: FighterAttack;
  readonly broken: boolean;
}

/**
 * A camera intent: something happened that the camera may react to.
 * Magnitudes come from the game's own ImpactMagnitude curve (the approved
 * "Hybrid scalable" profile C), so the lab reacts to the same numbers the
 * game would.
 */
export type IntentKind =
  | 'hit'
  | 'wallImpact'
  | 'landing'
  | 'stabilityBreak'
  | 'ko'
  | 'ringOut'
  | 'dodged'
  | 'perfectDodge'
  | 'clashStart'
  | 'clashResolved';

export interface CameraIntent {
  readonly kind: IntentKind;
  /** 0..1 */
  readonly magnitude: number;
  /** The fighter this is about (the defender for a hit); null = both / neither. */
  readonly targetIsFirst: boolean | null;
  readonly position: Vec3;
}

export interface FightFrame {
  readonly tick: number;
  /** Seconds since the scenario started. */
  readonly time: number;
  /** "first" is the player, "second" the opponent — the codebase-wide convention. */
  readonly first: FighterFrame;
  readonly second: FighterFrame;
  readonly intents: readonly CameraIntent[];
  readonly clashActive: boolean;
  /** 0..1 progress through the ~4 s Clash contest while active. */
  readonly clashProgress: number;
  /** The round ended (KO or ring-out). */
  readonly roundOver: boolean;
  /** Which fighter left the ring, if any. */
  readonly ringOutIsFirst: boolean | null;
  /** The player is holding a movement direction this tick (the game only; the lab's frames leave it out). */
  readonly playerSteering?: boolean;
}

export interface FightSource {
  readonly label: string;
  /** True when this source is a controlled/temporary choreography rather than the real simulation. */
  readonly temporary: boolean;
  /** Advance one fixed tick (1/60 s) and describe it. */
  step(): FightFrame;
  /** The latest frame without advancing. */
  readonly frame: FightFrame;
}

export function horizontalDistance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}
