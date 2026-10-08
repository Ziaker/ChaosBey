// ============================================================
// BEY FLOW FX LAB — BEY RIG
// One round-2 concept Bey (prototypes/bey-visual-concepts) at game scale
// (~1.3 m) plus the effects that are part of the Bey itself:
//
//   root     world position of the tip contact point
//   └ slope   aligns "up" with the bowl's normal
//     └ lean   inward tilt in a curve (from the lateral acceleration)
//       ├ spin   drawn rotation of the pieces
//       │ └ model
//       └ blur shell (smeared disc; fades as the spin dies)
//
// The dust, streaks and crowns that stay behind in the world are not
// here: they belong to AnimeWind. Presentation only: the rig reads a
// FlowBey, it never writes one.
// ============================================================

import * as THREE from 'three';
import { assembleConcept, type BuiltConcept } from '../../../bey-visual-concepts/src/model/assembleConcept';
import type { ConceptDefinition } from '../../../bey-visual-concepts/src/model/types';
import { BEY_DIAMETER_M, floorHeight, floorSlope, type FlowBey } from '../sim/FlowSim';
import type { Tuning } from '../tuning';

// ---------------- RIG TUNING ----------------
const SPIN_VISUAL_RAD_PER_S = 16;     // drawn spin at full spin
const BLUR_MAX_OPACITY = 0.6;
// --------------------------------------------

export interface FxFlags {
  blur: boolean;
  lean: boolean;
  dust: boolean;
  wind: boolean;
  crown: boolean;
}

const BLUR_VERT = /* glsl */ `
  varying vec2 vPos;
  void main() {
    vPos = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// A fast top is smeared into concentric bands (every radius averages its
// colours over the turn). Mostly angle-independent on purpose: an angular
// pattern would alias at game spin rates.
const BLUR_FRAG = /* glsl */ `
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform float uOpacity;
  uniform float uInner;
  uniform float uOuter;
  varying vec2 vPos;
  void main() {
    float r = length(vPos);
    float t = clamp((r - uInner) / (uOuter - uInner), 0.0, 1.0);
    float bands = 0.55 + 0.45 * sin(t * 18.0) * sin(t * 7.0 + 1.3);
    float edge = smoothstep(0.0, 0.12, t) * smoothstep(1.0, 0.82, t);
    vec3 col = mix(uColorA, uColorB, smoothstep(0.4, 1.0, t)) * (0.75 + 0.35 * bands);
    gl_FragColor = vec4(col, uOpacity * edge * (0.5 + 0.5 * bands));
  }
`;

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const _forward = new THREE.Vector3();
const _localForward = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);

export class FlowRig {
  readonly root = new THREE.Group();
  /** The Bey's own colour, for tinting effects. */
  readonly accent: THREE.Color;
  private readonly slope = new THREE.Group();
  private readonly lean = new THREE.Group();
  private readonly spin = new THREE.Group();
  private readonly model: BuiltConcept;
  private readonly ringRadius: number;
  private readonly ringMidY: number;
  private readonly blurMesh: THREE.Mesh;
  private readonly blurMat: THREE.ShaderMaterial;

  private leanRad = 0;
  private spinAngle = 0;
  private lastDirX = 1;
  private lastDirZ = 0;

  constructor(definition: ConceptDefinition, scene: THREE.Object3D) {
    this.accent = new THREE.Color(definition.palette.glow);
    this.model = assembleConcept(definition);
    const m = this.model.measurements;
    const s = BEY_DIAMETER_M / m.diameter;
    const ringHolder = this.model.root.getObjectByName('ring');
    const ringBase = (ringHolder?.position.y ?? m.height * 0.45) * s;
    const ringH = m.pieces.ring.height * s;
    this.ringRadius = (m.pieces.ring.diameter / 2) * s;
    this.ringMidY = ringBase + ringH * 0.5;

    const scaled = new THREE.Group();
    scaled.scale.setScalar(s);
    scaled.add(this.model.root);
    this.spin.add(scaled);
    this.lean.add(this.spin);
    this.slope.add(this.lean);
    this.root.add(this.slope);

    // Blur shell: a flat annulus just above the ring's mid height; it does not turn.
    const outer = this.ringRadius * 1.04;
    const inner = outer * 0.2;
    this.blurMat = new THREE.ShaderMaterial({
      uniforms: {
        uColorA: { value: new THREE.Color(definition.palette.primary) },
        uColorB: { value: new THREE.Color(definition.palette.accent) },
        uOpacity: { value: 0 },
        uInner: { value: inner },
        uOuter: { value: outer },
      },
      vertexShader: BLUR_VERT,
      fragmentShader: BLUR_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.blurMesh = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 64, 1), this.blurMat);
    this.blurMesh.rotation.x = -Math.PI / 2;
    this.blurMesh.position.y = this.ringMidY + 0.02;
    this.lean.add(this.blurMesh);

    scene.add(this.root);
  }

  /** Current inward lean in degrees (signed: negative = leaning left of travel). */
  get leanDegrees(): number {
    return THREE.MathUtils.radToDeg(this.leanRad);
  }

  /** Writes the tip contact point (on the floor) into `out`. */
  tip(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.root.position);
  }

  /** Advances the rig one rendered frame: pose, lean, spin and blur. */
  update(b: FlowBey, dt: number, tuning: Tuning, flags: FxFlags): void {
    const r = Math.hypot(b.x, b.z);
    const y = floorHeight(r);
    this.root.position.set(b.x, y, b.z);

    // Floor normal: up tilted away from the centre by the slope.
    const slope = floorSlope(r);
    const rx = r > 1e-6 ? b.x / r : 0;
    const rz = r > 1e-6 ? b.z / r : 0;
    _normal.set(-rx * slope, 1, -rz * slope).normalize();
    this.slope.quaternion.setFromUnitVectors(_up, _normal);

    // Direction of travel (kept while almost stopped).
    if (b.speed > 0.3) {
      this.lastDirX = b.vx / b.speed;
      this.lastDirZ = b.vz / b.speed;
    }
    _forward.set(this.lastDirX, 0, this.lastDirZ);

    // Lean: tilt the top toward the inside of the turn.
    let targetLean = 0;
    if (flags.lean && b.speed > 0.5) {
      const aLeft = b.ax * _forward.z - b.az * _forward.x; // acceleration to the left of travel
      targetLean = -THREE.MathUtils.degToRad(tuning.leanMaxDeg) * THREE.MathUtils.clamp(aLeft / tuning.leanAccelRefMps2, -1, 1);
    }
    this.leanRad += (targetLean - this.leanRad) * (1 - Math.exp(-tuning.leanSmooth * dt));
    _localForward.copy(_forward).applyQuaternion(_q.copy(this.slope.quaternion).invert());
    this.lean.quaternion.setFromAxisAngle(_localForward, this.leanRad);

    // Drawn spin.
    this.spinAngle += SPIN_VISUAL_RAD_PER_S * (0.25 + 0.75 * b.spin) * dt;
    this.spin.rotation.y = this.spinAngle;

    // Blur shell.
    const blurAlpha = flags.blur
      ? BLUR_MAX_OPACITY * tuning.blurStrength * tuning.intensity * smoothstep(tuning.blurFadeSpin, Math.min(1, tuning.blurFadeSpin + 0.4), b.spin)
      : 0;
    this.blurMat.uniforms.uOpacity!.value = blurAlpha;
    this.blurMesh.visible = blurAlpha > 0.003;

  }

  dispose(): void {
    this.model.dispose();
    this.blurMat.dispose();
    this.blurMesh.geometry.dispose();
  }
}
