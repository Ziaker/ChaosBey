// ============================================================
// BEY VISUAL CONCEPTS — MATERIALS
// Temporary PBR material kit for the visual comparison prototype.
// NOT the approved final material language (GDD section 33 / 171.3).
//
// Tuning notes:
//   - Painted plastic has a light clearcoat so it reads as a molded part.
//   - Metal is fully metallic but not mirror-chrome (roughness > 0.2).
//   - Emissive is deliberately low: these are physical machines, not holograms.
// ============================================================

import * as THREE from 'three';
import type { ConceptPalette, MaterialKit } from './types';

const PAINT_ROUGHNESS = 0.38;          // 0 = glossy, 1 = matte. Painted plastic.
const PAINT_CLEARCOAT = 0.55;          // 0–1. Lacquer layer strength on painted plastic.
const METAL_ROUGHNESS = 0.28;          // Lower = more mirror-like. Keep >= 0.2 to avoid chrome.
const DARK_METAL_ROUGHNESS = 0.42;     // Gunmetal frames/housings.
const TRANSLUCENT_OPACITY = 0.42;      // 0 = invisible, 1 = opaque.
const GLOW_INTENSITY = 1.4;            // Emissive strength of small glowing details. Keep modest.

const DARK_PLASTIC_HEX = 0x17191f;
const RUBBER_HEX = 0x0e0f12;

export function createMaterialKit(palette: ConceptPalette): MaterialKit {
  const paint = (color: number): THREE.MeshPhysicalMaterial =>
    new THREE.MeshPhysicalMaterial({
      color,
      roughness: PAINT_ROUGHNESS,
      metalness: 0.05,
      clearcoat: PAINT_CLEARCOAT,
      clearcoatRoughness: 0.28,
    });

  return {
    paint: paint(palette.primary),
    paintAlt: paint(palette.secondary),
    accent: paint(palette.accent),
    metal: new THREE.MeshStandardMaterial({ color: palette.metal, metalness: 1, roughness: METAL_ROUGHNESS }),
    darkMetal: new THREE.MeshStandardMaterial({ color: palette.darkMetal, metalness: 0.85, roughness: DARK_METAL_ROUGHNESS }),
    darkPlastic: new THREE.MeshStandardMaterial({ color: DARK_PLASTIC_HEX, metalness: 0.1, roughness: 0.6 }),
    rubber: new THREE.MeshStandardMaterial({ color: RUBBER_HEX, metalness: 0, roughness: 0.92 }),
    translucent: new THREE.MeshPhysicalMaterial({
      color: palette.translucent,
      roughness: 0.12,
      metalness: 0,
      clearcoat: 1,
      transparent: true,
      opacity: TRANSLUCENT_OPACITY,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    glow: new THREE.MeshStandardMaterial({
      color: palette.glow,
      emissive: palette.glow,
      emissiveIntensity: GLOW_INTENSITY,
      roughness: 0.4,
    }),
  };
}
