// ============================================================
// BEY REAL — THE CAMERA CHOICE
// Which camera a Bey Real match is watched with. Kept in src/camera/ (presentation) so no gameplay file ever names a camera.
// ============================================================

/** The camera the match plays with: the game's original directors, the mode's own, or one the player orbits. */
export const REAL_CAMERA_MODES = ['original', 'real', 'free'] as const;
export type RealCameraMode = (typeof REAL_CAMERA_MODES)[number];
export const DEFAULT_REAL_CAMERA: RealCameraMode = 'real';
export const REAL_CAMERA_LABELS: Readonly<Record<RealCameraMode, string>> = {
  original: 'Original (a câmera do jogo normal)',
  real: 'Bey Real (alta, mostra a arena e os dois Beys)',
  free: 'Livre (arraste para girar, roda para aproximar)',
};
