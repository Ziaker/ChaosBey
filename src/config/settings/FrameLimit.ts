// ============================================================
// FRAME LIMIT SETTING (performance pass, 0.57.0)
// How many frames per second the game may draw. The simulation always ticks at 60 Hz; this only decides how often the picture
// is redrawn (see app/frontend/frameLimiter.ts). Render cost only.
// ============================================================

export type FrameLimitSetting = 'off' | '60' | '30';
export const FRAME_LIMIT_SETTINGS: readonly FrameLimitSetting[] = ['off', '60', '30'];
/** 60: the game moves at 60 Hz, so a higher rate only redraws copies of the same frame (on a 144 Hz display, 2.4× the cost). */
export const DEFAULT_FRAME_LIMIT: FrameLimitSetting = '60';
