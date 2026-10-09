// ============================================================
// WARM UP THE RENDERER (0.62.0)
// A shader program is compiled the first time a material is drawn, and a texture is uploaded the first time it is sampled.
// Left to the first frames, that is a freeze exactly when the round appears — and a smaller stutter later, at the first
// impact or landing whose effect had never been drawn. Everything a round draws exists in the scene before it starts (the
// arena, both Beys, the rails, the launchers, the effect pools), so it is all compiled and uploaded here, behind the loading
// screen, in parallel with the browser's other work where KHR_parallel_shader_compile is available.
//
// Render cost only: it draws nothing, touches no simulation state and never throws (a failure just leaves the old behaviour:
// compile on first use).
// ============================================================

import * as THREE from 'three';

const TEXTURE_SLOTS = ['map', 'emissiveMap', 'alphaMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'lightMap', 'bumpMap'] as const;

/** Longest the loading screen waits for the driver (ms); a slow compile past this carries on in the background. */
export const WARM_UP_TIMEOUT_MS = 8000;

export interface WarmUpReport {
  readonly programsBefore: number;
  readonly programsAfter: number;
  readonly texturesUploaded: number;
  readonly ms: number;
  readonly timedOut: boolean;
}

export async function warmUpRenderer(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, timeoutMs = WARM_UP_TIMEOUT_MS): Promise<WarmUpReport> {
  const started = performance.now();
  const programsBefore = renderer.info.programs?.length ?? 0;
  let texturesUploaded = 0;
  let timedOut = false;
  try {
    // Textures first: they are uploaded on the CPU side and the compile below can then run alongside.
    const seen = new Set<THREE.Texture>();
    scene.traverse((object) => {
      const material = (object as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!material) return;
      for (const m of Array.isArray(material) ? material : [material]) {
        const slots = m as unknown as Record<string, THREE.Texture | null | undefined>;
        for (const slot of TEXTURE_SLOTS) {
          const texture = slots[slot];
          if (texture && texture.isTexture && !seen.has(texture) && texture.image) {
            seen.add(texture);
            renderer.initTexture(texture);
            texturesUploaded++;
          }
        }
      }
    });
    // `compile` walks every object of the scene (hidden ones too — the pooled effects), only lights must be visible.
    const compiled = renderer.compileAsync(scene, camera);
    const timeout = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), timeoutMs));
    timedOut = (await Promise.race([compiled, timeout])) === 'timeout';
  } catch (error) {
    console.warn('ChaosBey: renderer warm-up skipped:', error);
  }
  return { programsBefore, programsAfter: renderer.info.programs?.length ?? 0, texturesUploaded, ms: performance.now() - started, timedOut };
}
