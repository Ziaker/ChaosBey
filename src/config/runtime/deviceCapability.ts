// ============================================================
// DEVICE CAPABILITY — which quality preset a first launch should start on (performance pass, 0.57.0)
// A weak PC should not have to dig through Settings to make the game playable: the very first launch (no saved Settings) looks
// at what the browser says about the machine and starts on Low when it is clearly modest, else on the usual Medium. It never
// picks High (that costs more and is the player's call) and never overrides saved Settings. A guess, not a benchmark — the
// adaptive resolution (app/frontend/adaptiveResolution.ts) corrects whatever the guess gets wrong while playing.
// ============================================================

import { DEFAULT_QUALITY_PRESET, QualityPreset } from './QualityPreset';

export interface DeviceProbe {
  /** navigator.hardwareConcurrency (logical cores). */
  readonly cores?: number;
  /** navigator.deviceMemory (GB, coarse: 0.25..8). */
  readonly memoryGb?: number;
  /** The unmasked WebGL renderer string, when the browser reveals it. */
  readonly gpu?: string;
  /** Screen width × height × devicePixelRatio²: how many pixels a full-window frame fills. */
  readonly screenPixels?: number;
  /** A phone/tablet user agent. */
  readonly mobile?: boolean;
}

/** A GPU string that means "no real GPU": software rasteriser or the OS fallback. */
const SOFTWARE_GPU = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic|virtualbox|vmware|parallels/i;
/** Integrated / mobile GPUs: fine for the game at a modest resolution, short on fill rate at a high one. */
const MODEST_GPU = /intel.*(hd|uhd|iris|graphics)|\bmali\b|adreno|powervr|videocore|vega\s*\d\b.*graphics|radeon\(tm\)\s*graphics/i;
/** A full-window frame above this many pixels (a 4K display, or a 1440p one at 1.5×) is a lot for a modest GPU. */
const MANY_PIXELS = 4_000_000;

export function detectDefaultQuality(probe: DeviceProbe): QualityPreset {
  const gpu = probe.gpu ?? '';
  if (SOFTWARE_GPU.test(gpu)) return QualityPreset.Low;
  if (probe.mobile === true) return QualityPreset.Low;
  const cores = probe.cores ?? 8;
  const memory = probe.memoryGb ?? 8;
  if (cores <= 2 || memory <= 2) return QualityPreset.Low;
  const modestGpu = MODEST_GPU.test(gpu);
  if (modestGpu && (cores <= 4 || memory <= 4 || (probe.screenPixels ?? 0) > MANY_PIXELS)) return QualityPreset.Low;
  return DEFAULT_QUALITY_PRESET;
}

/** Reads the probe from the browser (never throws; any missing value is simply left out). */
export function probeDevice(): DeviceProbe {
  const nav = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { deviceMemory?: number });
  let gpu: string | undefined;
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null;
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    if (gl && info) gpu = String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL));
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    /* the probe is a hint only */
  }
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  const screenPixels = typeof screen === 'undefined' ? undefined : screen.width * dpr * screen.height * dpr;
  return {
    cores: nav?.hardwareConcurrency,
    memoryGb: nav?.deviceMemory,
    gpu,
    screenPixels,
    mobile: nav ? /android|iphone|ipad|ipod|mobile/i.test(nav.userAgent) : undefined,
  };
}
