// ============================================================
// BEY AUDIO PROFILE — DATA-DRIVEN PER-ARCHETYPE AUDIO IDENTITY (MILESTONE 6)
// The audio half of M6's remaining identity axis (GDD section 6/31):
// Attack/Defense/Stamina must be able to point to different audio
// identities. No real audio-playback engine exists in this project yet
// (Milestone 4/5 are visual-only), so this is intentionally a pure data
// hook — cue IDs only, no asset/sound file, same precedent as
// GameState.DebugLab being declared in the state enum "with no screen
// built yet" (GameState.ts). Wiring a real Web Audio player is later
// work; what this milestone requires is that each archetype's
// BeyDefinition can already point at its own distinct audio identity, and
// that a resolveBeyAudioProfile()-style consumer, once it exists, reads
// this instead of a hardcoded/shared cue.
//
// Cue IDs are internal identifiers (matching each archetype's existing
// "-prototype" id convention), not player-facing names — GDD section
// 96/97's naming approval gate is unaffected by this.
// ============================================================

export interface BeyAudioProfile {
  hitCueId: string;
  dashCueId: string;
}

/** Byte-identical placeholder cue set for anything not yet given an explicit archetype identity. */
export const DEFAULT_AUDIO_PROFILE: BeyAudioProfile = {
  hitCueId: 'default-hit',
  dashCueId: 'default-dash',
};
