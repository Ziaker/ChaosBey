// Ported unchanged in behaviour from prototypes/condition-visual-concepts/src/fx/glsl.ts (Stamina & Stability Lab, approved 2026-09-27;
// docs/design-decisions/condition-visual-approval.md). Only imports and the world/rig contract were adapted.
// Presentation only: observes condition, never decides an outcome (GDD 158).
// ============================================================
// STAMINA & STABILITY LAB — SHARED GLSL SNIPPETS
// Small value-noise + fbm used by the aura and beam shaders. Procedural
// on purpose: no canvas textures, so every layer also builds in Node
// (unit tests) without a DOM.
// ============================================================

export const NOISE_GLSL = /* glsl */ `
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * vnoise(p);
      p = p * 2.03 + vec2(17.1, 9.2);
      a *= 0.5;
    }
    return v;
  }
`;

/** Pass-through vertex shader exposing uv. */
export const UV_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
