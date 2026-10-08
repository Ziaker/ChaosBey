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
//       ├ blur shell (smeared disc; fades as the spin dies)
//       └ wind blades (crescent bands wrapping the Bey)
//
// The clouds, streaks and crowns that stay behind in the world are not
// here: they belong to AnimeWind. Presentation only: the rig reads a
// FlowBey, it never writes one.
// ============================================================

import * as THREE from 'three';
import { assembleConcept, type BuiltConcept } from '../../../bey-visual-concepts/src/model/assembleConcept';
import type { ConceptDefinition } from '../../../bey-visual-concepts/src/model/types';
import { crescent } from '../fx/animeTextures';
import { BEY_DIAMETER_M, floorHeight, floorSlope, type FlowBey } from '../sim/FlowSim';
import type { Tuning } from '../tuning';

// ---------------- RIG TUNING ----------------
const MAX_SWOOSHES = 4;
const SPIN_VISUAL_RAD_PER_S = 16;     // drawn spin at full spin
const BLUR_MAX_OPACITY = 0.6;
const SWOOSH_RADIUS_FACTOR = 1.25;    // blade distance from the axis, in ring radii
const SWOOSH_TILT_RAD = 0.3;          // blades are tipped up toward the outside
const SWOOSH_HEIGHT_FRACTION = 0.9;   // … at this fraction of the ring's mid height
const SWOOSH_FADE_IN_SPEED_MPS = 2;
const SWOOSH_FULL_SPEED_MPS = 8;
const SWOOSH_BOB = 0.12;
const SWOOSH_SIZE_RADIUS = 0.12;      // extra distance per metre of blade size
// --------------------------------------------

export interface FxFlags {
  blur: boolean;
  lean: boolean;
  dust: boolean;
  wind: boolean;
  swoosh: boolean;
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
  private readonly swooshPivots: THREE.Group[] = [];
  private readonly swooshMats: THREE.MeshBasicMaterial[] = [];
  private readonly swooshMeshes: THREE.Mesh[] = [];
  private readonly swooshGeo = new THREE.PlaneGeometry(1, 0.8);
  private readonly swooshGroup = new THREE.Group();

  private leanRad = 0;
  private spinAngle = 0;
  private swooshAngle = 0;
  private swooshTime = 0;
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

    // Wind blades: crescents lying around the Bey, concave side toward the axis, orbiting with the spin.
    this.swooshGroup.position.y = this.ringMidY * SWOOSH_HEIGHT_FRACTION;
    this.lean.add(this.swooshGroup);
    for (let i = 0; i < MAX_SWOOSHES; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: crescent(),
        side: THREE.DoubleSide,
        transparent: true,
        depthWrite: false,
        alphaTest: 0.45,
        opacity: 0,
        fog: false,
      });
      const mesh = new THREE.Mesh(this.swooshGeo, mat);
      mesh.rotation.x = -Math.PI / 2 + SWOOSH_TILT_RAD; // texture "up" points to -z, i.e. outward from the mesh's offset below
      this.swooshMeshes.push(mesh);
      const pivot = new THREE.Group();
      pivot.add(mesh);
      pivot.visible = false;
      this.swooshGroup.add(pivot);
      this.swooshPivots.push(pivot);
      this.swooshMats.push(mat);
    }
    scene.add(this.root);
  }

  /** Current inward lean in degrees (signed: negative = leaning left of travel). */
  get leanDegrees(): number {
    return THREE.MathUtils.radToDeg(this.leanRad);
  }

  /** How many wind blades are currently drawn. */
  get visibleSwooshes(): number {
    return this.swooshPivots.filter((p) => p.visible).length;
  }

  /** Writes the tip contact point (on the floor) into `out`. */
  tip(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.root.position);
  }

  /** Advances the rig one rendered frame: pose, lean, spin, blur and wind blades. */
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

    this.updateSwooshes(b, dt, tuning, flags);
  }

  private updateSwooshes(b: FlowBey, dt: number, tuning: Tuning, flags: FxFlags): void {
    const count = flags.swoosh ? Math.min(MAX_SWOOSHES, Math.round(tuning.swooshCount)) : 0;
    this.swooshAngle += tuning.swooshSpinRps * Math.PI * 2 * b.dir * dt;
    this.swooshTime += dt;
    const speedK = smoothstep(SWOOSH_FADE_IN_SPEED_MPS, SWOOSH_FULL_SPEED_MPS, b.speed);
    const spinK = smoothstep(0.1, 0.5, b.spin);
    const opacity = tuning.swooshOpacity * Math.min(1, tuning.intensity) * speedK * spinK;
    const size = tuning.swooshSizeM * (0.8 + 0.3 * speedK);
    for (let i = 0; i < MAX_SWOOSHES; i++) {
      const pivot = this.swooshPivots[i]!;
      const on = i < count && opacity > 0.01;
      pivot.visible = on;
      if (!on) continue;
      pivot.rotation.y = this.swooshAngle + (i / count) * Math.PI * 2;
      pivot.position.y = Math.sin(this.swooshTime * 3 + i * 1.7) * SWOOSH_BOB;
      const mesh = this.swooshMeshes[i]!;
      mesh.scale.setScalar(size);
      mesh.position.z = -(this.ringRadius * SWOOSH_RADIUS_FACTOR + SWOOSH_SIZE_RADIUS * size);
      this.swooshMats[i]!.opacity = opacity;
    }
  }

  dispose(): void {
    this.model.dispose();
    this.blurMat.dispose();
    this.blurMesh.geometry.dispose();
    this.swooshMats.forEach((m) => m.dispose());
    this.swooshGeo.dispose();
  }
}
