// ============================================================
// BEY FLOW FX LAB — BEY RIG
// One round-2 concept Bey (prototypes/bey-visual-concepts) at game scale
// (~1.3 m) plus every continuous effect that rides on it:
//
//   root     world position of the tip contact point
//   └ slope   aligns "up" with the bowl's normal
//     └ lean   inward tilt in a curve (from the lateral acceleration)
//       └ spin  drawn rotation of the pieces
//         └ model
//   + blur shell (smeared disc; fades as the spin dies)
//   + wind ribbon and two helix strands (path history, world space)
//   + ghost echoes (translucent copies lagging on the path)
//   + tip dust and scrape sparks (shared pools)
//
// Presentation only: it reads a FlowBey, it never writes one.
// ============================================================

import * as THREE from 'three';
import { assembleConcept, type BuiltConcept } from '../../../bey-visual-concepts/src/model/assembleConcept';
import type { ConceptDefinition } from '../../../bey-visual-concepts/src/model/types';
import { PointPool } from '../fx/PointPool';
import { WindRibbon, type RibbonShape } from '../fx/WindRibbon';
import { BEY_DIAMETER_M, floorHeight, floorSlope, type FlowBey } from '../sim/FlowSim';
import type { Tuning } from '../tuning';

// ---------------- RIG TUNING ----------------
const MAX_GHOSTS = 6;
const HISTORY = 64;                   // path samples kept for the ghost echoes
const SPIN_VISUAL_RAD_PER_S = 16;     // drawn spin at full spin
const RIM_ATTACH = 0.82;              // ribbon starts this fraction of the ring radius out from the centre
const RIM_HEIGHT_FRACTION = 0.8;      // … at this fraction of the ring's mid height
const BLUR_MAX_OPACITY = 0.6;
const DASH_BLEND_PER_S = 9;
const DUST_MIN_SPEED_MPS = 2;
const DUST_FULL_SPEED_MPS = 8;
const HELIX_STRANDS = 2;
const CORE_WIDTH_FRACTION = 0.34;   // the white core is this fraction of the ribbon's width
const CORE_LIFE_FRACTION = 0.7;    // … and a bit shorter, so the tail stays blue
// --------------------------------------------

export interface FxFlags {
  ribbon: boolean;
  helix: boolean;
  blur: boolean;
  ghost: boolean;
  dust: boolean;
  lean: boolean;
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
const _p = new THREE.Vector3();
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);

export class FlowRig {
  readonly root = new THREE.Group();
  private readonly slope = new THREE.Group();
  private readonly lean = new THREE.Group();
  private readonly spin = new THREE.Group();
  private readonly model: BuiltConcept;
  private readonly ringRadius: number;
  private readonly ringMidY: number;
  private readonly blurMesh: THREE.Mesh;
  private readonly blurMat: THREE.ShaderMaterial;
  private readonly ribbon = new WindRibbon();
  private readonly core = new WindRibbon();
  private readonly helix: WindRibbon[] = [];
  private readonly ghostMeshes: THREE.Mesh[] = [];
  private readonly ghostMat: THREE.MeshBasicMaterial;
  private readonly headColor = new THREE.Color(0.85, 1, 1);
  private readonly tailColor = new THREE.Color();
  private readonly coreHead = new THREE.Color(1, 1, 1);
  private readonly coreTail = new THREE.Color(0.55, 0.92, 1);
  private readonly dustColor = new THREE.Color(0.93, 0.84, 0.62);
  private readonly sparkColor = new THREE.Color(1, 0.78, 0.3);

  // Path history for the ghost echoes: t, x, y, z, leanRad.
  private readonly hist = new Float32Array(HISTORY * 5);
  private histStart = 0;
  private histCount = 0;

  private leanRad = 0;
  private dashBlend = 0;
  private spinAngle = 0;
  private dustCarry = 0;
  private lastDirX = 1;
  private lastDirZ = 0;
  private seed: number;

  constructor(
    definition: ConceptDefinition,
    scene: THREE.Object3D,
    private readonly dust: PointPool,
    private readonly sparks: PointPool,
    private readonly helixPhase: number,
    seed: number,
  ) {
    this.seed = seed;
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

    // Blur shell: a flat annulus just above the ring's mid height.
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
    this.spin.parent!.add(this.blurMesh); // sibling of spin: it does not turn

    // Ghost echoes: flat translucent rings in world space.
    this.ghostMat = new THREE.MeshBasicMaterial({
      color: definition.palette.primary,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const ghostGeo = new THREE.RingGeometry(this.ringRadius * 0.55, this.ringRadius * 1.02, 40, 1);
    for (let i = 0; i < MAX_GHOSTS; i++) {
      const g = new THREE.Mesh(ghostGeo, this.ghostMat.clone());
      g.rotation.x = -Math.PI / 2;
      g.visible = false;
      scene.add(g);
      this.ghostMeshes.push(g);
    }

    // Ribbon colours: white at the rim, cyan-blue at the tail, tinted by the Bey's glow.
    this.tailColor.setRGB(0, 0.35, 0.9).lerp(new THREE.Color(definition.palette.glow), 0.15);
    scene.add(this.root);
    scene.add(this.ribbon.mesh);
    scene.add(this.core.mesh);
    for (let i = 0; i < HELIX_STRANDS; i++) {
      const strand = new WindRibbon();
      this.helix.push(strand);
      scene.add(strand.mesh);
    }
  }

  get ribbonSampleCount(): number {
    return this.ribbon.sampleCount;
  }

  /** Current inward lean in degrees (signed: negative = leaning left of travel). */
  get leanDegrees(): number {
    return THREE.MathUtils.radToDeg(this.leanRad);
  }

  /** How many ghost echoes are currently drawn. */
  get visibleGhosts(): number {
    return this.ghostMeshes.filter((g) => g.visible).length;
  }

  /** Takes this sim step's path samples (ribbon, helix and ghost history). Call once per fixed step, before update(). */
  record(b: FlowBey, now: number, dt: number, tuning: Tuning, flags: FxFlags): void {
    const y = floorHeight(Math.hypot(b.x, b.z));
    // Direction of travel (kept while almost stopped).
    if (b.speed > 0.3) {
      this.lastDirX = b.vx / b.speed;
      this.lastDirZ = b.vz / b.speed;
    }
    this.dashBlend += ((b.dashing ? 1 : 0) - this.dashBlend) * (1 - Math.exp(-DASH_BLEND_PER_S * dt));

    const strength = (0.35 + 0.65 * THREE.MathUtils.clamp(b.speed / tuning.ribbonFullSpeedMps, 0, 1)) * smoothstep(0.3, 2.5, b.speed) * tuning.intensity;
    const width = THREE.MathUtils.lerp(tuning.ribbonWidthM, tuning.ribbonDashWidthM, this.dashBlend);
    this.rimPoint(b, y, _p);
    if (flags.ribbon) {
      this.ribbon.push(now, _p, strength, width);
      this.core.push(now, _p, strength, width);
    } else {
      this.ribbon.clear();
      this.core.clear();
    }
    for (const strand of this.helix) {
      if (flags.helix) strand.push(now, _p, strength, tuning.helixWidthM);
      else strand.clear();
    }
    this.pushHistory(now, b.x, y, b.z);
  }

  /** Advances the rig one rendered frame: pose, blur, ribbons, ghosts and dust. */
  update(b: FlowBey, now: number, dt: number, camera: THREE.Camera, tuning: Tuning, flags: FxFlags): void {
    const r = Math.hypot(b.x, b.z);
    const y = floorHeight(r);
    this.root.position.set(b.x, y, b.z);

    // Floor normal: up tilted away from the centre by the slope.
    const slope = floorSlope(r);
    const rx = r > 1e-6 ? b.x / r : 0;
    const rz = r > 1e-6 ? b.z / r : 0;
    _normal.set(-rx * slope, 1, -rz * slope).normalize();
    this.slope.quaternion.setFromUnitVectors(_up, _normal);
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

    // Blur shell, kept aligned with the lean/slope but not turning.
    const blurAlpha = flags.blur
      ? BLUR_MAX_OPACITY * tuning.blurStrength * tuning.intensity * smoothstep(tuning.blurFadeSpin, Math.min(1, tuning.blurFadeSpin + 0.4), b.spin)
      : 0;
    this.blurMat.uniforms.uOpacity!.value = blurAlpha;
    this.blurMesh.visible = blurAlpha > 0.003;

    this.updateRibbons(now, camera, tuning);
    this.updateGhosts(b, now, tuning, flags);
    this.emitDust(b, y, dt, tuning, flags);
  }

  private rimPoint(b: FlowBey, y: number, out: THREE.Vector3): THREE.Vector3 {
    // Outer side of the orbit (away from the turn's centre), at the ring's height.
    const sideX = this.lastDirZ * b.dir;
    const sideZ = -this.lastDirX * b.dir;
    const rad = this.ringRadius * RIM_ATTACH;
    return out.set(b.x + sideX * rad, y + this.ringMidY * RIM_HEIGHT_FRACTION, b.z + sideZ * rad);
  }

  private updateRibbons(now: number, camera: THREE.Camera, tuning: Tuning): void {
    const camPos = camera.position;
    const main: RibbonShape = {
      lifeS: tuning.ribbonLifeS,
      opacity: tuning.ribbonOpacity,
      waveM: tuning.ribbonWaveM,
      waveHz: tuning.ribbonWaveHz,
      helixRadiusM: 0,
      helixTurnsPerS: 0,
      helixPhase: 0,
      widthScale: 1,
      headColor: this.headColor,
      tailColor: this.tailColor,
    };
    this.ribbon.update(now, camPos, main);
    this.core.update(now, camPos, {
      ...main,
      opacity: Math.min(1, tuning.ribbonOpacity * tuning.ribbonCore),
      lifeS: tuning.ribbonLifeS * CORE_LIFE_FRACTION,
      widthScale: CORE_WIDTH_FRACTION,
      waveM: tuning.ribbonWaveM,
      headColor: this.coreHead,
      tailColor: this.coreTail,
    });
    this.helix.forEach((strand, i) => {
      strand.update(now, camPos, {
        ...main,
        opacity: tuning.helixOpacity,
        waveM: 0,
        helixRadiusM: tuning.helixRadiusM,
        helixTurnsPerS: tuning.helixTurnsPerS,
        helixPhase: this.helixPhase + i * Math.PI,
        widthScale: 1,
        widthOverrideM: tuning.helixWidthM,
      });
    });
  }

  private pushHistory(now: number, x: number, y: number, z: number): void {
    const slot = (this.histStart + this.histCount) % HISTORY;
    if (this.histCount === HISTORY) this.histStart = (this.histStart + 1) % HISTORY;
    else this.histCount++;
    this.hist[slot * 5] = now;
    this.hist[slot * 5 + 1] = x;
    this.hist[slot * 5 + 2] = y;
    this.hist[slot * 5 + 3] = z;
    this.hist[slot * 5 + 4] = this.leanRad;
  }

  /** Position `lagS` seconds ago, or null when the history is shorter than that. */
  private lagged(now: number, lagS: number, out: THREE.Vector3): boolean {
    const target = now - lagS;
    for (let k = this.histCount - 1; k >= 0; k--) {
      const slot = (this.histStart + k) % HISTORY;
      if (this.hist[slot * 5]! <= target) {
        out.set(this.hist[slot * 5 + 1]!, this.hist[slot * 5 + 2]!, this.hist[slot * 5 + 3]!);
        return true;
      }
    }
    return false;
  }

  private updateGhosts(b: FlowBey, now: number, tuning: Tuning, flags: FxFlags): void {
    const count = flags.ghost ? Math.min(MAX_GHOSTS, Math.round(tuning.ghostCount)) : 0;
    const speedK = smoothstep(3, 12, b.speed);
    for (let i = 0; i < MAX_GHOSTS; i++) {
      const mesh = this.ghostMeshes[i]!;
      if (i >= count || speedK <= 0.01 || !this.lagged(now, tuning.ghostSpacingS * (i + 1), _v)) {
        mesh.visible = false;
        continue;
      }
      mesh.visible = true;
      // Sits on the floor, a hair above it, at the ring's height.
      const h = floorHeight(Math.hypot(_v.x, _v.z));
      mesh.position.set(_v.x, h + this.ringMidY, _v.z);
      const fade = 1 - i / (count + 0.5);
      (mesh.material as THREE.MeshBasicMaterial).opacity = tuning.ghostOpacity * tuning.intensity * speedK * fade;
    }
  }

  private rand(): number {
    // mulberry32: deterministic, so a replayed lab shows the same dust.
    this.seed = (this.seed + 0x6d2b79f5) | 0;
    let t = Math.imul(this.seed ^ (this.seed >>> 15), 1 | this.seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  private emitDust(b: FlowBey, y: number, dt: number, tuning: Tuning, flags: FxFlags): void {
    if (!flags.dust || b.speed < DUST_MIN_SPEED_MPS) return;
    const k = smoothstep(DUST_MIN_SPEED_MPS, DUST_FULL_SPEED_MPS, b.speed);
    this.dustCarry += tuning.dustRate * tuning.intensity * k * dt;
    while (this.dustCarry >= 1) {
      this.dustCarry -= 1;
      _p.set(b.x, y + 0.06, b.z);
      const back = 0.25 * b.speed;
      _v.set(-this.lastDirX * back * (0.4 + this.rand()), 0.6 + this.rand() * 1.1, -this.lastDirZ * back * (0.4 + this.rand()));
      _v.x += (this.rand() - 0.5) * 1.6;
      _v.z += (this.rand() - 0.5) * 1.6;
      this.dust.emit(_p, _v, tuning.dustSizeM * (0.7 + this.rand() * 0.6), tuning.dustLifeS, this.dustColor, 0.55);
      if (this.rand() < 0.45) {
        _v.multiplyScalar(1.8);
        this.sparks.emit(_p, _v, tuning.dustSizeM * 0.28, tuning.dustLifeS * 0.5, this.sparkColor, 0.95);
      }
    }
  }

  /** Forgets the path (after a restart) so no stale ribbon or echo is drawn. */
  resetTrails(): void {
    this.ribbon.clear();
    this.core.clear();
    this.helix.forEach((h) => h.clear());
    this.histStart = 0;
    this.histCount = 0;
    this.leanRad = 0;
    this.dashBlend = 0;
  }

  dispose(): void {
    this.model.dispose();
    this.ribbon.dispose();
    this.core.dispose();
    this.helix.forEach((h) => h.dispose());
    this.blurMat.dispose();
    this.ghostMeshes.forEach((g) => (g.material as THREE.Material).dispose());
    this.ghostMat.dispose();
  }
}
