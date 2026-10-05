// ============================================================
// CIRCULAR VORTEX — rebuilt from scratch (owner, 2026-10-04: "a animação do ataque giratório está INCOMPLETA e MAL
// FEITA, refaz do zero"; before: "tem que ter seu efeito visual ao redor do bey, não dentro dele […] algo como um
// vortex que se dissipa").
//
// Why the last one read as incomplete: it was driven by the attack's own progress, and a Circular is only 0.25 s
// active — the effect was cut the instant the attack ended, mid-animation. This one is its own timed animation,
// started by trigger() on the attack's first frame and always played to the end (~0.9 s):
//   FORM     (0–0.1 s)   the swirl pulls in around the Bey from a wider, fainter ring;
//   SPIN     (to 0.32 s) a full whirl of wind around the Bey — a spiral disc on the floor and a ring wall of wind
//                        streaks, both turning fast; nothing inside the Bey's body (inner radius 0.75 m);
//   DISSIPATE(to 0.9 s)  it unwinds outward to ~2× its size, rises, slows and fades, shedding motes.
// Drawn with two small shaders (spiral bands with noise breakup) instead of a few tubes, so the wind is continuous.
// Presentation only: it never reads or writes gameplay.
// ============================================================

import * as THREE from 'three';

/** The Circular's slash ring radius (1.25 + 0.3 × 0.6) × 1.2 — the vortex's outer edge at full spin. */
export const CIRCULAR_VORTEX_RADIUS_M = (1.25 + 0.3 * 0.6) * 1.2;
/** Clear of the Bey's body (its visual radius is ~0.6 m): the effect is around it, never inside. */
export const CIRCULAR_VORTEX_INNER_RADIUS_M = 0.75;
export const CIRCULAR_VORTEX_FORM_S = 0.1;
export const CIRCULAR_VORTEX_SPIN_END_S = 0.32;
export const CIRCULAR_VORTEX_LIFE_S = 0.9;
const WALL_RADIUS_M = 1.05;
const WALL_HEIGHT_M = 1.0;
const MOTES = 70;

const NOISE_GLSL = /* glsl */ `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
`;

/** The floor disc: spiral wind bands in an annulus, brightest on a ring that drifts outward as it dissipates. */
const DISC_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uAlpha;
  uniform float uSpread;
  varying vec2 vPos;
  ${NOISE_GLSL}
  void main() {
    float r = length(vPos);
    float inner = ${CIRCULAR_VORTEX_INNER_RADIUS_M.toFixed(3)};
    float outer = ${(CIRCULAR_VORTEX_RADIUS_M * 1.15).toFixed(3)};
    float u = (r - inner) / (outer - inner);
    if (u < 0.0 || u > 1.0) discard;
    float theta = atan(vPos.y, vPos.x);
    // Logarithmic spiral bands, swept by time (the wind turning), broken up by noise.
    float s = theta * 5.0 + log(r) * 9.0 - uTime * 26.0;
    float bands = pow(0.5 + 0.5 * sin(s), 5.0);
    float n = noise(vec2(theta * 4.0 - uTime * 10.0, r * 5.0));
    bands *= 0.45 + 0.9 * n;
    // Radial envelope: a ring that moves outward as the vortex dissipates; soft at both edges.
    float centre = mix(0.32, 0.85, uSpread);
    float env = exp(-pow((u - centre) / 0.28, 2.0)) * smoothstep(0.0, 0.08, u) * smoothstep(1.0, 0.85, u);
    float a = clamp(bands * env * uAlpha, 0.0, 0.85);
    vec3 col = mix(uColor, vec3(1.0), 0.3 + 0.6 * clamp(bands, 0.0, 1.0));
    gl_FragColor = vec4(col, a);
  }
`;

/** The wind wall: a ring of diagonal streaks around the Bey, fading at its top and bottom. */
const WALL_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uAlpha;
  varying vec2 vUv;
  ${NOISE_GLSL}
  void main() {
    float theta = vUv.x * 6.2831853;
    float s = theta * 4.0 + vUv.y * 5.0 - uTime * 30.0;
    float streak = pow(0.5 + 0.5 * sin(s), 8.0);
    float n = noise(vec2(vUv.x * 18.0 - uTime * 14.0, vUv.y * 3.0 + uTime * 2.0));
    streak *= 0.35 + 1.0 * n;
    float fade = sin(3.14159265 * vUv.y);
    fade *= fade;
    float a = streak * fade * uAlpha;
    vec3 col = mix(uColor, vec3(1.0), clamp(streak, 0.0, 1.0) * 0.7);
    gl_FragColor = vec4(col * a, a);
  }
`;

const DISC_VERTEX = /* glsl */ `
  varying vec2 vPos;
  void main() {
    vPos = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const WALL_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

function shaderMaterial(fragmentShader: string, vertexShader: string, color: THREE.Color, blending: THREE.Blending): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color.clone() }, uTime: { value: 0 }, uAlpha: { value: 0 }, uSpread: { value: 0 } },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    // The disc blends normally (additive washed out on a light floor); the wall is additive (premultiplied) glow.
    blending,
  });
}

/** A soft round dot (no DOM needed), so the motes are glowing specks, not squares. */
let softDotTexture: THREE.DataTexture | null = null;
function softDot(): THREE.DataTexture {
  if (softDotTexture) return softDotTexture;
  const size = 32;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) / (size / 2);
      const a = Math.max(0, 1 - d);
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(255 * a * a);
    }
  }
  softDotTexture = new THREE.DataTexture(data, size, size);
  softDotTexture.needsUpdate = true;
  return softDotTexture;
}

function easeOut(x: number): number {
  return 1 - (1 - x) * (1 - x);
}

export class CircularVortex {
  readonly object = new THREE.Group();
  private readonly disc: THREE.Mesh;
  private readonly discMaterial: THREE.ShaderMaterial;
  private readonly wall: THREE.Mesh;
  private readonly wallMaterial: THREE.ShaderMaterial;
  private readonly motes: THREE.Points;
  private readonly moteMaterial: THREE.PointsMaterial;
  private readonly motePos = new Float32Array(MOTES * 3);
  private readonly moteVel = new Float32Array(MOTES * 3);
  private readonly moteColor: THREE.Color;
  /** Seconds since trigger(); null = not playing. */
  private age: number | null = null;
  private time = 0;
  private readonly anchor = new THREE.Vector3();

  /** `sizeScale`: the Bey's in-match size (owner, 2026-10-05: MatchConfig.beySizeScale), × the whole vortex. */
  constructor(color: THREE.Color, sizeScale = 1) {
    this.object.scale.setScalar(sizeScale);
    this.moteColor = color.clone().lerp(new THREE.Color(0xffffff), 0.5);
    this.discMaterial = shaderMaterial(DISC_FRAGMENT, DISC_VERTEX, color, THREE.NormalBlending);
    const outer = CIRCULAR_VORTEX_RADIUS_M * 1.15;
    this.disc = new THREE.Mesh(new THREE.RingGeometry(CIRCULAR_VORTEX_INNER_RADIUS_M, outer, 96, 4), this.discMaterial);
    this.disc.rotation.x = -Math.PI / 2;
    this.wallMaterial = shaderMaterial(WALL_FRAGMENT, WALL_VERTEX, color, THREE.AdditiveBlending);
    this.wall = new THREE.Mesh(new THREE.CylinderGeometry(WALL_RADIUS_M, WALL_RADIUS_M * 1.25, WALL_HEIGHT_M, 64, 1, true), this.wallMaterial);
    this.wall.position.y = WALL_HEIGHT_M / 2 - 0.2;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.motePos, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MOTES * 3), 3));
    this.moteMaterial = new THREE.PointsMaterial({ size: 0.16, map: softDot(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.motes = new THREE.Points(geometry, this.moteMaterial);
    this.motes.frustumCulled = false;
    this.object.add(this.disc, this.wall, this.motes);
    this.object.visible = false;
    this.object.renderOrder = 5;
  }

  /** True while the animation plays (tests). */
  get isPlaying(): boolean {
    return this.age !== null;
  }

  /** Starts (or restarts) the full animation at the Bey's position. */
  trigger(pos: THREE.Vector3): void {
    this.age = 0;
    this.anchor.copy(pos);
    // Motes start on a ring just outside the Bey with a tangential (spin) + outward velocity.
    for (let i = 0; i < MOTES; i++) {
      const a = (i / MOTES) * Math.PI * 2 + (i % 3) * 0.7;
      const r = CIRCULAR_VORTEX_INNER_RADIUS_M + ((i * 7) % 10) * 0.05;
      this.motePos[i * 3] = Math.cos(a) * r;
      this.motePos[i * 3 + 1] = ((i * 13) % 10) * 0.07;
      this.motePos[i * 3 + 2] = Math.sin(a) * r;
      const tangential = 6 + (i % 5) * 0.6;
      const outward = 1.2 + (i % 4) * 0.6;
      this.moteVel[i * 3] = -Math.sin(a) * tangential + Math.cos(a) * outward;
      this.moteVel[i * 3 + 1] = 0.6 + (i % 3) * 0.5;
      this.moteVel[i * 3 + 2] = Math.cos(a) * tangential + Math.sin(a) * outward;
    }
  }

  /** Stops at once (a destroyed Bey keeps no effects). */
  stop(): void {
    this.age = null;
    this.object.visible = false;
  }

  /** Every frame. `pos` is the Bey's position (null = unknown: the vortex stays where it is). */
  update(pos: THREE.Vector3 | null, dt: number): void {
    if (this.age === null) return;
    this.age += dt;
    this.time += dt;
    const age = this.age;
    if (age >= CIRCULAR_VORTEX_LIFE_S) {
      this.stop();
      return;
    }
    this.object.visible = true;
    const form = Math.min(1, age / CIRCULAR_VORTEX_FORM_S);
    const dissipate = Math.max(0, (age - CIRCULAR_VORTEX_SPIN_END_S) / (CIRCULAR_VORTEX_LIFE_S - CIRCULAR_VORTEX_SPIN_END_S));
    // Follows the Bey while it spins, then lets go progressively as it dissipates.
    if (pos) this.anchor.lerp(pos, 1 - dissipate);
    this.object.position.set(this.anchor.x, this.anchor.y - 0.15, this.anchor.z);

    const alpha = easeOut(form) * Math.pow(1 - dissipate, 1.4);
    // Forms inward (from 1.35× to 1×), then widens to ~2× as it dissipates.
    const scale = (1.35 - 0.35 * easeOut(form)) * (1 + 0.95 * easeOut(dissipate));
    // The wind slows as it dies; the shader time integrates that speed so the bands never jump.
    const spinRate = 1 - 0.6 * dissipate;
    const shaderTime = this.time * spinRate;

    this.disc.scale.setScalar(scale);
    this.discMaterial.uniforms.uTime!.value = shaderTime;
    this.discMaterial.uniforms.uAlpha!.value = 2.4 * alpha;
    this.discMaterial.uniforms.uSpread!.value = dissipate;

    this.wall.scale.set(scale, 1 + 0.9 * dissipate, scale);
    this.wall.position.y = WALL_HEIGHT_M / 2 - 0.2 + 0.6 * dissipate;
    this.wallMaterial.uniforms.uTime!.value = shaderTime;
    this.wallMaterial.uniforms.uAlpha!.value = 1.3 * alpha * (1 - 0.4 * dissipate);

    // Motes: carried round by the spin, flung outward, rising, fading with the vortex.
    const colors = (this.motes.geometry.getAttribute('color') as THREE.BufferAttribute).array as Float32Array;
    const drag = Math.exp(-3 * dt);
    for (let i = 0; i < MOTES; i++) {
      const k = i * 3;
      this.motePos[k] = this.motePos[k]! + this.moteVel[k]! * dt;
      this.motePos[k + 1] = this.motePos[k + 1]! + this.moteVel[k + 1]! * dt;
      this.motePos[k + 2] = this.motePos[k + 2]! + this.moteVel[k + 2]! * dt;
      this.moteVel[k] = this.moteVel[k]! * drag;
      this.moteVel[k + 2] = this.moteVel[k + 2]! * drag;
      const fade = alpha * (0.5 + 0.5 * ((i * 5) % 7) / 7);
      colors[k] = this.moteColor.r * fade;
      colors[k + 1] = this.moteColor.g * fade;
      colors[k + 2] = this.moteColor.b * fade;
    }
    this.motes.geometry.getAttribute('position').needsUpdate = true;
    this.motes.geometry.getAttribute('color').needsUpdate = true;
  }

  dispose(): void {
    this.object.removeFromParent();
    this.disc.geometry.dispose();
    this.wall.geometry.dispose();
    this.motes.geometry.dispose();
    this.discMaterial.dispose();
    this.wallMaterial.dispose();
    this.moteMaterial.dispose();
  }
}
