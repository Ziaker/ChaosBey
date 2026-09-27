// ============================================================
// STAMINA & STABILITY LAB — BEY RIG
// Wraps one round-2 concept model (prototypes/bey-visual-concepts) at game
// scale (about 1.3 m across) in the transform chain the condition visuals
// need, following GDD 17/83 (physical orientation separate from the fast
// visual spin):
//
//   root    world position of the tip contact point (no rotation)
//   └ tilt   lean (precession, wobble, hit kick, broken lean)
//     └ jitter  hit shudder (small, high-frequency offset)
//       ├ spin     drawn rotation of the pieces (clamped rate)
//       │ └ model  the four pieces, scaled to game size
//       └ blur     the spin-blur shell (caps + rim band), driven at the true rate
//
// Language layers never touch these transforms directly. They write
// "mods" (glow multiplier, wear, rattle, seam gap), and applyMods() turns
// them into material and piece changes once per frame, so two layers can
// stack (for example B dims the glow while C pulses it).
// ============================================================

import * as THREE from 'three';
import { assembleConcept, PIECE_ORDER, type BuiltConcept, type PieceName } from '../../../bey-visual-concepts/src/model/assembleConcept';
import type { ConceptDefinition, ConceptPalette } from '../../../bey-visual-concepts/src/model/types';
import type { MotionDims, MotionFrame } from '../sim/BeyMotion';
import type { Tuning } from '../tuning';

// ---------------- RIG TUNING ----------------
/** Widest diameter of every Bey at game scale (m). GDD / decisions doc: about 1.3 m. */
export const BEY_DIAMETER_M = 1.3;
const SHUDDER_AMPLITUDE_M = 0.035;   // Peak hit-shudder offset at shudder = 1.
const SHUDDER_HZ = 31;
const RATTLE_OFFSET = 0.05;          // Piece rattle offset at rattle = 1 (model units, ~cm).
const RATTLE_TILT_DEG = 3.2;         // Piece rattle tilt at rattle = 1.
const SEAM_GAP_MAX = 0.14;           // setExplode() amount at seamGap = 1 (0 = assembled).
const WEAR_DARKEN = 0.45;            // Colour darkening at wear = 1.
const WEAR_ROUGHEN = 0.4;            // Roughness added at wear = 1.
const BLUR_BASE_OPACITY = 0.62;      // Blur shell opacity at full speed, blur = 1.
// ----------------------------------------------

export interface RigDims extends MotionDims {
  readonly scale: number;
  readonly height: number;
  readonly ringTopY: number;
  readonly ringMidY: number;
  /** Top of the Top Layer (the emblem / core). */
  readonly topY: number;
}

export interface RigMods {
  glowMul: number;
  wear: number;
  rattle: number;
  seamGap: number;
}

interface MatRecord {
  readonly material: THREE.MeshStandardMaterial;
  readonly color: THREE.Color;
  readonly roughness: number;
  readonly emissiveIntensity: number;
  readonly clearcoat: number;
}

const BLUR_VERT = /* glsl */ `
  varying vec2 vPos;
  void main() {
    vPos = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// A spinning top seen fast is smeared into concentric bands (each radius
// averages its colours over the turn). Mostly angle-independent on purpose:
// any angular pattern would alias (wagon-wheel) at game spin rates.
const BLUR_FRAG = /* glsl */ `
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform float uOpacity;
  uniform float uInner;
  uniform float uOuter;
  uniform float uAngle;
  varying vec2 vPos;
  void main() {
    float r = length(vPos);
    float t = clamp((r - uInner) / (uOuter - uInner), 0.0, 1.0);
    float bands = 0.55 + 0.45 * sin(t * 18.0) * sin(t * 7.0 + 1.3);
    float edge = smoothstep(0.0, 0.12, t) * smoothstep(1.0, 0.86, t);
    float a = atan(vPos.y, vPos.x) + uAngle * 0.02;
    float sheen = 0.85 + 0.15 * sin(a * 2.0);
    vec3 col = mix(uColorA, uColorB, smoothstep(0.55, 1.0, t) * 0.8) * (0.75 + 0.35 * bands) * sheen;
    gl_FragColor = vec4(col, uOpacity * edge * (0.55 + 0.45 * bands));
  }
`;

export class BeyRig {
  readonly root = new THREE.Group();
  readonly tilt = new THREE.Group();
  readonly jitter = new THREE.Group();
  readonly spin = new THREE.Group();
  readonly model: BuiltConcept;
  readonly dims: RigDims;
  readonly palette: ConceptPalette;
  readonly mods: RigMods = { glowMul: 1, wear: 0, rattle: 0, seamGap: 0 };

  private readonly pieces: Array<{ group: THREE.Object3D; index: number }> = [];
  private readonly mats: MatRecord[] = [];
  private readonly blur = new THREE.Group();
  private readonly blurMat: THREE.ShaderMaterial;
  private readonly blurBandMat: THREE.MeshBasicMaterial;
  private readonly blurGeos: THREE.BufferGeometry[] = [];
  private time = 0;
  private shudder = 0;
  private readonly tmp = new THREE.Vector3();

  constructor(definition: ConceptDefinition, private readonly tuning: Tuning) {
    this.palette = definition.palette;
    this.model = assembleConcept(definition);
    const m = this.model.measurements;
    const s = BEY_DIAMETER_M / m.diameter;
    const ringHolder = this.model.root.getObjectByName('ring');
    const ringBase = (ringHolder?.position.y ?? m.height * 0.45) * s;
    const ringH = m.pieces.ring.height * s;
    this.dims = {
      scale: s,
      height: m.height * s,
      ringRadius: (m.pieces.ring.diameter / 2) * s,
      ringBottomY: ringBase,
      ringTopY: ringBase + ringH,
      ringMidY: ringBase + ringH * 0.5,
      topY: m.height * s,
    };

    const scaled = new THREE.Group();
    scaled.scale.setScalar(s);
    scaled.add(this.model.root);
    this.spin.add(scaled);
    this.jitter.add(this.spin);
    this.tilt.add(this.jitter);
    this.root.add(this.tilt);

    this.model.root.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    PIECE_ORDER.forEach((name: PieceName, index) => {
      const g = this.model.root.getObjectByName(name);
      if (g) this.pieces.push({ group: g, index });
    });

    const seen = new Set<THREE.Material>();
    this.model.root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const list = Array.isArray(o.material) ? o.material : [o.material];
      for (const mat of list) {
        if (seen.has(mat) || !(mat instanceof THREE.MeshStandardMaterial)) continue;
        seen.add(mat);
        this.mats.push({
          material: mat,
          color: mat.color.clone(),
          roughness: mat.roughness,
          emissiveIntensity: mat.emissiveIntensity,
          clearcoat: mat instanceof THREE.MeshPhysicalMaterial ? mat.clearcoat : 0,
        });
      }
    });

    // Blur shell: the ring smeared by speed — a cap just above and just below the
    // ring plus a band around its rim, so it envelops the ring instead of hiding inside it.
    const inner = this.dims.ringRadius * 0.35;
    const outer = this.dims.ringRadius * 1.04;
    this.blurMat = new THREE.ShaderMaterial({
      vertexShader: BLUR_VERT,
      fragmentShader: BLUR_FRAG,
      uniforms: {
        uColorA: { value: new THREE.Color(this.palette.primary) },
        uColorB: { value: new THREE.Color(this.palette.metal) },
        uOpacity: { value: 0 },
        uInner: { value: inner },
        uOuter: { value: outer },
        uAngle: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.blurBandMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(this.palette.primary).lerp(new THREE.Color(this.palette.metal), 0.45),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const capGeo = new THREE.RingGeometry(inner, outer, 96, 1);
    const bandGeo = new THREE.CylinderGeometry(outer, outer, Math.max(0.01, this.dims.ringTopY - this.dims.ringBottomY), 96, 1, true);
    this.blurGeos.push(capGeo, bandGeo);
    for (const y of [this.dims.ringTopY + 0.006, this.dims.ringBottomY - 0.006]) {
      const cap = new THREE.Mesh(capGeo, this.blurMat);
      cap.rotation.x = -Math.PI / 2;
      cap.position.y = y;
      cap.renderOrder = 2;
      this.blur.add(cap);
    }
    const band = new THREE.Mesh(bandGeo, this.blurBandMat);
    band.position.y = this.dims.ringMidY;
    band.renderOrder = 2;
    this.blur.add(band);
    this.jitter.add(this.blur);
  }

  /** Place the rig from the motion frame. Call before the layers update. */
  update(frame: MotionFrame, dt: number): void {
    const T = this.tuning;
    this.time += dt;
    this.root.position.copy(frame.position);
    this.tilt.quaternion.copy(frame.quaternion);
    this.spin.rotation.y = frame.meshSpin;
    this.shudder = frame.shudder;
    const blurOn = T.blur * THREE.MathUtils.smoothstep(frame.rps, T.blurFadeRps * 0.6, T.blurFadeRps * 1.6);
    const opacity = Math.min(0.95, BLUR_BASE_OPACITY * blurOn);
    this.blurMat.uniforms.uOpacity!.value = opacity;
    this.blurMat.uniforms.uAngle!.value = frame.trueSpin;
    this.blurBandMat.opacity = opacity * 0.75;
    this.blur.visible = blurOn > 0.01;
  }

  resetMods(): void {
    this.mods.glowMul = 1;
    this.mods.wear = 0;
    this.mods.rattle = 0;
    this.mods.seamGap = 0;
  }

  /** Turn mods into material/piece changes. Call after every layer has written its mods. */
  applyMods(shudderScale: number): void {
    const { glowMul, wear, rattle, seamGap } = this.mods;
    const w = Math.min(1.6, Math.max(0, wear));
    for (const r of this.mats) {
      const lum = r.color.r * 0.3 + r.color.g * 0.59 + r.color.b * 0.11;
      r.material.color.copy(r.color).lerp(this.tmpColor.setScalar(lum), Math.min(1, w * 0.45)).multiplyScalar(1 - WEAR_DARKEN * Math.min(1, w));
      r.material.roughness = Math.min(1, r.roughness + WEAR_ROUGHEN * w);
      if (r.material instanceof THREE.MeshPhysicalMaterial) r.material.clearcoat = r.clearcoat * Math.max(0, 1 - w);
      r.material.emissiveIntensity = r.emissiveIntensity * Math.max(0, glowMul);
    }

    this.model.setExplode(Math.max(0, seamGap) * SEAM_GAP_MAX);
    const t = this.time;
    for (const p of this.pieces) {
      const k = p.index + 1;
      const amp = rattle * (0.4 + 0.25 * k);
      p.group.position.x = Math.sin(t * (23 + 7 * k) + k) * RATTLE_OFFSET * amp;
      p.group.position.z = Math.cos(t * (19 + 5 * k) + 2 * k) * RATTLE_OFFSET * amp;
      p.group.rotation.x = Math.sin(t * (17 + 3 * k)) * RATTLE_TILT_DEG * THREE.MathUtils.DEG2RAD * amp;
      p.group.rotation.z = Math.cos(t * (13 + 4 * k)) * RATTLE_TILT_DEG * THREE.MathUtils.DEG2RAD * amp;
      p.group.rotation.y = Math.sin(t * 9 + k) * 0.05 * amp * (p.index === 3 ? 3 : 1);
    }

    const sh = this.shudder * shudderScale * SHUDDER_AMPLITUDE_M;
    this.jitter.position.set(Math.sin(t * SHUDDER_HZ * 6.283) * sh, Math.abs(Math.sin(t * SHUDDER_HZ * 3.1)) * sh * 0.4, Math.cos(t * SHUDDER_HZ * 5.1) * sh);
  }

  private readonly tmpColor = new THREE.Color();

  /** Convert a point in the tilted body frame (meters, pivot at the tip) to world space. */
  bodyToWorld(local: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    this.root.updateMatrixWorld(true);
    return out.copy(local).applyMatrix4(this.jitter.matrixWorld);
  }

  /** The ring-rim point closest to the floor (where the rim scrapes when leaning). */
  rimLowestWorld(leanDir: number, out: THREE.Vector3): THREE.Vector3 {
    this.tmp.set(Math.cos(leanDir) * this.dims.ringRadius, this.dims.ringBottomY, Math.sin(leanDir) * this.dims.ringRadius);
    return this.bodyToWorld(this.tmp, out);
  }

  dispose(): void {
    this.model.dispose();
    this.blurGeos.forEach((g) => g.dispose());
    this.blurMat.dispose();
    this.blurBandMat.dispose();
  }
}
