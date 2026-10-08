// ============================================================
// CONDITION RIG — the approved layers' view of one real Bey
// Builds the transform frame the languages hang their effects on, out of the
// Bey's real BeyVisual, never moving the Bey itself:
//
//   root    world position of the tip contact point (no rotation)
//   └ tilt   the Bey's real attitude, copied from the visual group each frame
//     └ jitter  small hit shudder (language A only, as in the lab)
//       └ blur    the spin-blur shell (shared physical layer)
//
// The effects (aura, shards, ring, stars, ...) are children of this frame, not
// of the Bey's own group, so they never become part of its hierarchy, its
// bounds or its anchors. What the rig DOES write on the Bey, and only while
// conditionVisuals is on:
//   - the drawn spin angle of the pieces (visual.spinGroup.rotation.y), clamped
//     to meshMaxRps so a fast spin never turns into a wagon wheel; the blur shell
//     carries the speed instead (the lab's rule, GDD 83);
//   - for the approved four-piece models only: material wear (darken, matte, lose
//     lacquer), glow dimming, rattle between pieces and open seams. The placeholder
//     mesh shares nothing with these, so it is left as it is.
// Nothing here touches a collider, a body, the camera or a stat.
// ============================================================

import * as THREE from 'three';
import type { BeyDefinition } from '../../bey/archetype/BeyDefinition';
import type { BeyVisual } from '../../bey/procedural-model/createBeyMesh';
import { getConceptVisualModel } from '../../bey/visual/conceptBeyVisual';
import { PIECE_ORDER } from '../../bey/visual/model/assembleConcept';
import type { ConditionRigLike, RigDimsLike, RigMods, RigPalette } from './types';
import type { ConditionTuning } from './tuning';
import type { MotionFrame } from './types';

// ---------------- RIG TUNING (the lab's values) ----------------
const SHUDDER_AMPLITUDE_M = 0.035;   // Peak hit-shudder offset at shudder = 1.
const SHUDDER_HZ = 31;
const RATTLE_OFFSET = 0.05;          // Piece rattle offset at rattle = 1 (model units, ~cm).
const RATTLE_TILT_DEG = 3.2;         // Piece rattle tilt at rattle = 1.
const SEAM_GAP_MAX = 0.14;           // setExplode() amount at seamGap = 1 (0 = assembled).
const WEAR_DARKEN = 0.45;            // Colour darkening at wear = 1.
const WEAR_ROUGHEN = 0.4;            // Roughness added at wear = 1.
const BLUR_BASE_OPACITY = 0.62;      // Blur shell opacity at full speed, blur = 1.
// ----------------------------------------------------------------

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

const FALLBACK_BODY = 0x8a93a3;

/** Ring / top / height measured on the real visual, in metres above the tip (named pieces when the visual has them). */
export function measureRigDims(visual: BeyVisual, tipBelowOriginM: number): RigDimsLike {
  // Owner, 2026-10-05 (MatchConfig.beySizeScale): a scaled model (its group scaled, its body's half-height already
  // scaled) is measured at its designed size and the result given in metres at the match's size.
  const s = visual.group.scale.x;
  if (s === 1) return measureRigDimsUnscaled(visual, tipBelowOriginM);
  const d = measureRigDimsUnscaled(visual, tipBelowOriginM / s);
  return { ringRadius: d.ringRadius * s, ringBottomY: d.ringBottomY * s, ringTopY: d.ringTopY * s, ringMidY: d.ringMidY * s, height: d.height * s, topY: d.topY * s };
}

function measureRigDimsUnscaled(visual: BeyVisual, tipBelowOriginM: number): RigDimsLike {
  visual.group.updateWorldMatrix(true, true);
  const inverse = new THREE.Matrix4().copy(visual.group.matrixWorld).invert();
  const boxOf = (object: THREE.Object3D | undefined | null): THREE.Box3 | null => {
    if (!object) return null;
    const box = new THREE.Box3().setFromObject(object).applyMatrix4(inverse);
    return box.isEmpty() ? null : box;
  };
  const whole = boxOf(visual.group) ?? new THREE.Box3(new THREE.Vector3(-0.6, -tipBelowOriginM, -0.6), new THREE.Vector3(0.6, tipBelowOriginM, 0.6));
  const ring = boxOf(visual.group.getObjectByName('ring'));
  const radiusOf = (b: THREE.Box3): number => Math.max(Math.abs(b.min.x), Math.abs(b.max.x), Math.abs(b.min.z), Math.abs(b.max.z));
  const height = whole.max.y + tipBelowOriginM;
  if (ring) {
    return {
      ringRadius: radiusOf(ring),
      ringBottomY: ring.min.y + tipBelowOriginM,
      ringTopY: ring.max.y + tipBelowOriginM,
      ringMidY: (ring.min.y + ring.max.y) / 2 + tipBelowOriginM,
      height,
      topY: height, // the lab's rule: the emblem / core sits at the model's full height
    };
  }
  // The monolithic placeholder: the widest radius sits about 60% up.
  return { ringRadius: radiusOf(whole), ringBottomY: height * 0.45, ringTopY: height * 0.75, ringMidY: height * 0.6, height, topY: height };
}

export class ConditionRig implements ConditionRigLike {
  readonly root = new THREE.Group();
  readonly tilt = new THREE.Group();
  readonly jitter = new THREE.Group();
  readonly dims: RigDimsLike;
  readonly palette: RigPalette;
  readonly mods: RigMods = { glowMul: 1, wear: 0, rattle: 0, seamGap: 0 };
  /** True when the Bey is one of the approved four-piece models (wear, rattle and seams apply). */
  readonly dressable: boolean;

  private readonly pieces: Array<{ group: THREE.Object3D; index: number }> = [];
  private readonly mats: MatRecord[] = [];
  private readonly built: ReturnType<typeof getConceptVisualModel>;
  private readonly blur = new THREE.Group();
  private readonly blurMat: THREE.ShaderMaterial;
  private readonly blurBandMat: THREE.MeshBasicMaterial;
  private readonly blurGeos: THREE.BufferGeometry[] = [];
  /** Owner, 2026-10-08 (Settings → Visual effects → Spin blur): × the approved blur strength. 1 = the approved look. */
  blurScale = 1;
  private time = 0;
  private shudder = 0;
  private readonly tmp = new THREE.Vector3();
  private readonly tmpColor = new THREE.Color();

  constructor(
    private readonly visual: BeyVisual,
    gameplay: BeyDefinition,
    private readonly tuning: ConditionTuning,
  ) {
    const tipBelow = gameplay.physical.colliderHalfHeightM;
    this.dims = measureRigDims(visual, tipBelow);
    this.built = getConceptVisualModel(visual);
    this.dressable = !!this.built;
    const palette = this.built?.concept.palette;
    this.palette = { glow: palette?.glow ?? gameplay.particle.sparkTintHex };
    const bodyA = palette?.primary ?? FALLBACK_BODY;
    const bodyB = palette?.metal ?? FALLBACK_BODY;

    this.tilt.add(this.jitter);
    this.root.add(this.tilt);

    if (this.built) {
      PIECE_ORDER.forEach((name, index) => {
        const g = this.built!.built.root.getObjectByName(name);
        if (g) this.pieces.push({ group: g, index });
      });
      const seen = new Set<THREE.Material>();
      this.built.built.root.traverse((o) => {
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
    }

    // Blur shell: the ring smeared by speed — a cap just above and just below the
    // ring plus a band around its rim, so it envelops the ring instead of hiding inside it.
    const inner = this.dims.ringRadius * 0.35;
    const outer = this.dims.ringRadius * 1.04;
    this.blurMat = new THREE.ShaderMaterial({
      vertexShader: BLUR_VERT,
      fragmentShader: BLUR_FRAG,
      uniforms: {
        uColorA: { value: new THREE.Color(bodyA) },
        uColorB: { value: new THREE.Color(bodyB) },
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
      color: new THREE.Color(bodyA).lerp(new THREE.Color(bodyB), 0.45),
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

  /** Places the frame from the Bey's real pose and draws the clamped spin. Call before the layers update. */
  update(frame: MotionFrame, bodyQuaternion: THREE.Quaternion, dt: number): void {
    const T = this.tuning;
    this.time += dt;
    this.root.position.copy(frame.position);
    this.tilt.quaternion.copy(bodyQuaternion);
    this.visual.spinGroup.rotation.y = frame.meshSpin;
    this.shudder = frame.shudder;
    const blurOn = T.blur * this.blurScale * THREE.MathUtils.smoothstep(frame.rps, T.blurFadeRps * 0.6, T.blurFadeRps * 1.6);
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

  /** Turns the mods into material / piece changes (approved models only) and the shudder offset. Call after every layer wrote its mods. */
  applyMods(shudderScale: number): void {
    if (this.built) {
      const { glowMul, wear, rattle, seamGap } = this.mods;
      const w = Math.min(1.6, Math.max(0, wear));
      for (const r of this.mats) {
        const lum = r.color.r * 0.3 + r.color.g * 0.59 + r.color.b * 0.11;
        r.material.color.copy(r.color).lerp(this.tmpColor.setScalar(lum), Math.min(1, w * 0.45)).multiplyScalar(1 - WEAR_DARKEN * Math.min(1, w));
        r.material.roughness = Math.min(1, r.roughness + WEAR_ROUGHEN * w);
        if (r.material instanceof THREE.MeshPhysicalMaterial) r.material.clearcoat = r.clearcoat * Math.max(0, 1 - w);
        r.material.emissiveIntensity = r.emissiveIntensity * Math.max(0, glowMul);
      }
      this.built.built.setExplode(Math.max(0, seamGap) * SEAM_GAP_MAX);
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
    }
    const t = this.time;
    const sh = this.shudder * shudderScale * SHUDDER_AMPLITUDE_M;
    this.jitter.position.set(Math.sin(t * SHUDDER_HZ * 6.283) * sh, Math.abs(Math.sin(t * SHUDDER_HZ * 3.1)) * sh * 0.4, Math.cos(t * SHUDDER_HZ * 5.1) * sh);
  }

  /** Puts every piece, material and seam back as built (a layer was turned off, or the system is disposed). */
  restoreModel(): void {
    this.resetMods();
    this.applyMods(0);
  }

  /** Convert a point in the tilted body frame (metres, pivot at the tip) to world space. */
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
    this.restoreModel();
    this.root.removeFromParent();
    this.blurGeos.forEach((g) => g.dispose());
    this.blurMat.dispose();
    this.blurBandMat.dispose();
  }
}
