// ============================================================
// LANGUAGE B — AURA DE ESPÍRITO (SPIRIT AURA)
// The Bey's fighting spirit as visible energy, in the approved anime
// family (decisions doc §3b: Dash aura, afterimages, dazed rings). Reads
// from far away and uses each Bey's own colour.
//
//   Stamina   → a flame aura rising from the Bey: tall and dense when
//               fresh; shorter, flickering and broken into wisps when
//               tired. Anime spin lines circle the body (fewer when tired).
//   Stability → hexagonal shield shards orbit the Bey, one per slice of
//               Stability. Hits shatter shards; recovery re-forms them.
//   Broken    → no shards, a pulsing red fresnel outline, dazed stars,
//               electric arcs, and the aura turns to red embers.
// ============================================================

import * as THREE from 'three';
import { NOISE_GLSL, UV_VERT } from '../fx/glsl';
import type { ConditionEvent } from '../sim/ConditionSim';
import type { ConditionLayer, LayerContext, LayerFrame } from './types';

// ---------------- LANGUAGE B TUNING (multiplied by the sliders) ----------------
const AURA_HEIGHT_EMPTY = 0.6;        // Aura height (× Bey height) near zero Stamina…
const AURA_HEIGHT_FULL = 2.2;         // …and at full Stamina.
const AURA_MIN_INTENSITY = 0.18;      // Aura intensity left near zero Stamina.
const SPIN_LINE_COUNT = 5;
const SPIN_LINE_MAX_RPS = 4.5;        // Drawn speed of the spin lines (fast but never aliasing).
const SHARD_ORBIT_RADIUS = 1.55;      // × ring radius.
const SHARD_SIZE_M = 0.13;
const SHARD_ORBIT_RAD_S = 0.9;
const SHARD_BREAK_S = 0.5;
const SHARD_FORM_S = 0.35;
const SHARD_AMBER = 0xffb030;         // Stability below 50%.
const SHARD_RED = 0xff3344;           // Stability below 25%.
const DANGER_COLOR = 0xff2a44;
const DAZED_COLOR = 0xffe066;
const ARC_COLOR = 0xff7ad9;
const ARC_POOL = 4;
const ARC_RATE = 5;                   // Arcs per second at bArcs = 1.
const PULSE_RING_S = 0.45;
// ---------------------------------------------------------------------------------

const AURA_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uIntensity;
  uniform float uBreakup;
  uniform float uCrackle;
  uniform float uSeed;
  uniform vec3 uColor;
  uniform vec3 uHot;
  uniform vec3 uDanger;
  varying vec2 vUv;
  ${NOISE_GLSL}
  void main() {
    float y = vUv.y;
    vec2 p = vec2(vUv.x * 7.0, y * 2.4 - uTime * 1.8);
    float n = fbm(p + uSeed);
    float n2 = fbm(p * 2.1 - vec2(0.0, uTime * 0.9) + 3.7);
    float body = n * 0.65 + n2 * 0.35 + (1.0 - y) * 0.55 - 0.25;
    float thr = 0.38 + uBreakup * 0.42;
    float flame = smoothstep(thr, thr + 0.16, body);
    float fade = pow(1.0 - y, 1.3) * smoothstep(0.0, 0.12, y);
    vec3 col = mix(uColor, uHot, smoothstep(thr + 0.1, thr + 0.45, body));
    float crack = step(0.8, fract(n2 * 6.0 + uTime * 3.0));
    vec3 ember = mix(uDanger * 0.55, vec3(1.0, 0.8, 0.6), crack * 0.7);
    col = mix(col, ember, uCrackle);
    gl_FragColor = vec4(col, flame * fade * uIntensity);
  }
`;

const FRESNEL_VERT = /* glsl */ `
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;
const FRESNEL_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
    gl_FragColor = vec4(uColor, f * uOpacity);
  }
`;

type ShardPhase = 'on' | 'off' | 'breaking' | 'forming';
interface Shard {
  readonly pivot: THREE.Group;
  readonly body: THREE.Group;
  readonly fill: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  readonly edge: THREE.LineSegments<THREE.EdgesGeometry, THREE.LineBasicMaterial>;
  phase: ShardPhase;
  t: number;
}

function starGeometry(size: number): THREE.ShapeGeometry {
  const s = new THREE.Shape();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 2;
    const r = i % 2 === 0 ? size : size * 0.38;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  s.closePath();
  return new THREE.ShapeGeometry(s);
}

export class SpiritLayer implements ConditionLayer {
  readonly id = 'B' as const;
  enabled = true;

  private readonly aura = new THREE.Group();
  private readonly auraMats: THREE.ShaderMaterial[] = [];
  private readonly lines: Array<THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>> = [];
  private readonly lineGroup = new THREE.Group();
  private readonly shardRing = new THREE.Group();
  private shards: Shard[] = [];
  private shardCount = 0;
  private shardAngle = 0;
  private readonly shell: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private readonly dazed = new THREE.Group();
  private readonly stars: Array<THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>> = [];
  private readonly arcs: Array<{ line: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>; life: number }> = [];
  private arcDebt = 0;
  private readonly pulse: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private pulseT = 1;
  private hitDip = 0;
  private needsSync = true;
  private readonly glowColor: THREE.Color;
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly shardGeo: THREE.CylinderGeometry;
  private readonly shardEdges: THREE.EdgesGeometry;

  constructor(private readonly ctx: LayerContext) {
    const { rig, world } = ctx;
    const R = rig.dims.ringRadius;
    this.glowColor = new THREE.Color(rig.palette.glow);
    const hot = this.glowColor.clone().lerp(new THREE.Color(0xffffff), 0.6);

    // --- Aura: two nested open cones rising from the floor, upright (not leaning) ---
    const makeAura = (rTop: number, rBottom: number, seed: number): void => {
      const g = new THREE.CylinderGeometry(rTop, rBottom, 1, 40, 12, true).translate(0, 0.5, 0);
      const m = new THREE.ShaderMaterial({
        vertexShader: UV_VERT,
        fragmentShader: AURA_FRAG,
        uniforms: {
          uTime: { value: 0 }, uIntensity: { value: 1 }, uBreakup: { value: 0 }, uCrackle: { value: 0 }, uSeed: { value: seed },
          uColor: { value: this.glowColor.clone() }, uHot: { value: hot }, uDanger: { value: new THREE.Color(DANGER_COLOR) },
        },
        transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(g, m);
      mesh.renderOrder = 6;
      this.aura.add(mesh);
      this.auraMats.push(m);
    };
    makeAura(R * 0.95, R * 1.32, 0);
    makeAura(R * 0.5, R * 1.05, 11.3);
    rig.root.add(this.aura);

    // --- Spin lines: thin arcs around the body, leaning with it ---
    for (let i = 0; i < SPIN_LINE_COUNT; i++) {
      const r = R * (1.1 + 0.07 * i);
      const g = new THREE.RingGeometry(r, r + 0.02, 40, 1, 0, 1.1 + 0.25 * (i % 2));
      const m = new THREE.MeshBasicMaterial({ color: hot, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
      const line = new THREE.Mesh(g, m);
      line.rotation.x = -Math.PI / 2;
      line.position.y = rig.dims.ringMidY + (i - 2) * 0.045;
      line.renderOrder = 6;
      const holder = new THREE.Group();
      holder.add(line);
      holder.rotation.y = i * 2.1;
      this.lineGroup.add(holder);
      this.lines.push(line);
    }
    rig.jitter.add(this.lineGroup);

    // --- Shield shards (upright ring around the Bey) ---
    this.shardGeo = new THREE.CylinderGeometry(SHARD_SIZE_M, SHARD_SIZE_M, 0.02, 6).rotateX(Math.PI / 2);
    this.shardEdges = new THREE.EdgesGeometry(this.shardGeo);
    this.shardRing.position.y = rig.dims.ringMidY + 0.05;
    rig.root.add(this.shardRing);

    // --- Danger shell (fresnel outline), follows the lean ---
    this.shell = new THREE.Mesh(
      new THREE.SphereGeometry(1, 32, 16),
      new THREE.ShaderMaterial({
        vertexShader: FRESNEL_VERT, fragmentShader: FRESNEL_FRAG,
        uniforms: { uColor: { value: new THREE.Color(DANGER_COLOR) }, uOpacity: { value: 0 } },
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      }),
    );
    this.shell.scale.set(R * 1.3, rig.dims.height * 0.75, R * 1.3);
    this.shell.position.y = rig.dims.height * 0.5;
    this.shell.renderOrder = 7;
    rig.jitter.add(this.shell);

    // --- Dazed stars above the Bey ---
    const starGeo = starGeometry(0.1);
    for (let i = 0; i < 3; i++) {
      const star = new THREE.Mesh(starGeo, new THREE.MeshBasicMaterial({ color: DAZED_COLOR, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      star.renderOrder = 8;
      this.dazed.add(star);
      this.stars.push(star);
    }
    this.dazed.position.y = rig.dims.height + 0.3;
    rig.root.add(this.dazed);

    // --- Electric arcs (world space) ---
    for (let i = 0; i < ARC_POOL; i++) {
      const g = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(10 * 3), 3));
      const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: ARC_COLOR, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
      line.frustumCulled = false;
      line.renderOrder = 8;
      world.scene.add(line);
      this.arcs.push({ line, life: 0 });
    }

    // --- Flat pulse ring (break / recover) ---
    this.pulse = new THREE.Mesh(
      new THREE.RingGeometry(0.85, 1, 64),
      new THREE.MeshBasicMaterial({ color: DANGER_COLOR, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
    );
    this.pulse.rotation.x = -Math.PI / 2;
    this.pulse.position.y = 0.05;
    this.pulse.renderOrder = 6;
    rig.root.add(this.pulse);
  }

  /** Shards currently standing (on or forming) — read by tests and the automation hook. */
  get intactShards(): number {
    return this.shards.filter((sh) => sh.phase === 'on' || sh.phase === 'forming').length;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    for (const o of [this.aura, this.lineGroup, this.shardRing, this.shell, this.dazed, this.pulse]) o.visible = on;
    for (const a of this.arcs) a.line.visible = on;
    if (on) this.needsSync = true;
  }

  private rebuildShards(n: number): void {
    for (const s of this.shards) {
      s.pivot.removeFromParent();
      s.fill.material.dispose();
      s.edge.material.dispose();
    }
    this.shards = [];
    const R = this.ctx.rig.dims.ringRadius;
    for (let i = 0; i < n; i++) {
      const pivot = new THREE.Group();
      pivot.rotation.y = (i / n) * Math.PI * 2;
      const body = new THREE.Group();
      body.position.z = R * SHARD_ORBIT_RADIUS;
      const fill = new THREE.Mesh(this.shardGeo, new THREE.MeshBasicMaterial({ color: this.glowColor, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      const edge = new THREE.LineSegments(this.shardEdges, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
      fill.renderOrder = 7;
      edge.renderOrder = 7;
      body.add(fill, edge);
      pivot.add(body);
      this.shardRing.add(pivot);
      this.shards.push({ pivot, body, fill, edge, phase: 'on', t: 0 });
    }
    this.shardCount = n;
  }

  update(frame: LayerFrame, dt: number): void {
    if (!this.enabled) return;
    const { rig, tuning: T, world } = this.ctx;
    const s = frame.state;
    const m = frame.motion;
    const time = frame.time;
    const N = Math.round(T.bShards);
    if (N !== this.shardCount) {
      this.rebuildShards(N);
      this.needsSync = true;
    }
    const target = s.broken ? 0 : Math.ceil(s.stability * N - 1e-4);
    if (this.needsSync) {
      this.shards.forEach((sh, i) => {
        sh.phase = i < target ? 'on' : 'off';
        sh.t = 0;
      });
      this.needsSync = false;
    }

    // --- Aura ---
    const live = 1 - s.spinOut;
    const flicker = 1 - T.bAuraBreakup * (1 - s.stamina) * 0.5 * (0.5 + 0.5 * Math.sin(time * 23) * Math.sin(time * 7.3));
    this.hitDip = Math.max(0, this.hitDip - dt * 3);
    const intensity = T.bAuraIntensity * (AURA_MIN_INTENSITY + (1 - AURA_MIN_INTENSITY) * s.stamina ** 0.7) * flicker * live * (1 - 0.5 * this.hitDip);
    const breakup = Math.min(1, T.bAuraBreakup * (1 - s.stamina) ** 1.3 + 0.6 * s.spinOut);
    for (const mat of this.auraMats) {
      mat.uniforms.uTime!.value = time;
      mat.uniforms.uIntensity!.value = intensity;
      mat.uniforms.uBreakup!.value = breakup;
      mat.uniforms.uCrackle!.value = m.brokenBlend;
    }
    this.aura.scale.y = Math.max(0.001, T.bAuraHeight * rig.dims.height * (AURA_HEIGHT_EMPTY + (AURA_HEIGHT_FULL - AURA_HEIGHT_EMPTY) * s.stamina) * (0.3 + 0.7 * live));
    this.aura.visible = intensity > 0.002 && T.bAuraHeight > 0;

    // --- Spin lines ---
    const spinVis = T.bSpinLines * THREE.MathUtils.smoothstep(m.rps, 0.5, 3) * live;
    this.lineGroup.rotation.y += Math.min(m.rps, SPIN_LINE_MAX_RPS) * Math.PI * 2 * dt;
    this.lines.forEach((line, i) => {
      line.material.opacity = Math.min(1, spinVis * 0.75 * THREE.MathUtils.clamp(s.stamina * SPIN_LINE_COUNT - i + 0.5, 0, 1));
    });

    // --- Shards ---
    this.shardAngle += T.bShardOrbit * SHARD_ORBIT_RAD_S * dt;
    this.shardRing.rotation.y = this.shardAngle;
    const shardColor = s.stability < 0.25 ? SHARD_RED : s.stability < 0.5 ? SHARD_AMBER : rig.palette.glow;
    const intact = this.shards.filter((sh) => sh.phase === 'on' || sh.phase === 'forming').length;
    if (intact > target) {
      for (let i = this.shards.length - 1, k = intact - target; i >= 0 && k > 0; i--) {
        const sh = this.shards[i]!;
        if (sh.phase === 'on' || sh.phase === 'forming') {
          this.shatter(sh);
          k--;
        }
      }
    } else if (intact < target) {
      for (let i = 0, k = target - intact; i < this.shards.length && k > 0; i++) {
        const sh = this.shards[i]!;
        if (sh.phase === 'off') {
          sh.phase = 'forming';
          sh.t = 0;
          this.sparkAt(sh.body, 4, 0xffffff);
          k--;
        }
      }
    }
    const lowFlicker = s.stability < 0.35 ? 0.65 + 0.35 * Math.sin(time * 31) : 1;
    this.shards.forEach((sh, i) => {
      sh.t += dt;
      const bob = Math.sin(time * 2 + i) * 0.04;
      let scale = T.bShardSize;
      let opacity = 1;
      let out = 0;
      if (sh.phase === 'forming') {
        const k = Math.min(1, sh.t / SHARD_FORM_S);
        scale *= k < 0.7 ? (k / 0.7) * 1.25 : 1.25 - 0.25 * ((k - 0.7) / 0.3);
        opacity = k;
        if (k >= 1) sh.phase = 'on';
      } else if (sh.phase === 'breaking') {
        const k = Math.min(1, sh.t / SHARD_BREAK_S);
        out = k * 1.6;
        scale *= 1 - k * 0.6;
        opacity = 1 - k;
        sh.body.rotation.z += dt * 14;
        sh.body.rotation.x += dt * 9;
        if (k >= 1) sh.phase = 'off';
      } else if (sh.phase === 'off') {
        opacity = 0;
      } else {
        sh.body.rotation.set(0, 0, 0);
        opacity = lowFlicker;
      }
      sh.body.visible = opacity > 0.01 && scale > 0.01;
      sh.body.scale.setScalar(Math.max(0.001, scale));
      sh.body.position.set(0, bob + out * 0.4, rig.dims.ringRadius * SHARD_ORBIT_RADIUS + out);
      if (sh.phase !== 'breaking') sh.fill.material.color.set(shardColor);
      sh.fill.material.opacity = 0.35 * opacity * live;
      sh.edge.material.opacity = 0.9 * opacity * live;
    });

    // --- Broken: danger shell, dazed stars, arcs ---
    const b = m.brokenBlend;
    const beat = 0.55 + 0.45 * Math.sin(time * Math.PI * 2 * T.bDangerHz);
    this.shell.material.uniforms.uOpacity!.value = T.bDangerShell * b * beat * 1.2;
    this.shell.visible = T.bDangerShell * b > 0.01;
    this.dazed.visible = T.bDazed * b > 0.01;
    if (this.dazed.visible) {
      this.stars.forEach((star, i) => {
        const a = time * 2.4 + (i / 3) * Math.PI * 2;
        star.position.set(Math.cos(a) * 0.42, Math.sin(time * 3 + i) * 0.05, Math.sin(a) * 0.42);
        star.quaternion.copy(world.camera.quaternion);
        star.scale.setScalar(T.bDazed * b * (0.9 + 0.2 * Math.sin(time * 6 + i)));
        star.material.opacity = Math.min(1, b);
      });
    }
    this.arcDebt += T.bArcs * ARC_RATE * b * dt;
    while (this.arcDebt >= 1) {
      this.arcDebt -= 1;
      this.spawnArc();
    }
    for (const a of this.arcs) {
      a.life = Math.max(0, a.life - dt);
      a.line.material.opacity = a.life > 0 ? Math.min(1, a.life * 10) : 0;
    }

    // --- Glow dims with Stamina ---
    const dim = 1 - T.bGlowDim * (1 - (0.15 + 0.85 * s.stamina ** 0.8));
    rig.mods.glowMul *= dim * live;

    // --- Pulse ring ---
    if (this.pulseT < 1) {
      this.pulseT = Math.min(1, this.pulseT + dt / PULSE_RING_S);
      const r = rig.dims.ringRadius * (0.8 + 2.6 * this.pulseT);
      this.pulse.scale.setScalar(r);
      this.pulse.material.opacity = (1 - this.pulseT) * 0.9;
    }
    this.pulse.visible = this.pulseT < 1;
  }

  private shatter(sh: Shard): void {
    sh.phase = 'breaking';
    sh.t = 0;
    this.sparkAt(sh.body, 9, sh.fill.material.color.getHex());
  }

  private sparkAt(obj: THREE.Object3D, count: number, color: number): void {
    const { world } = this.ctx;
    obj.getWorldPosition(this.tmp);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1 + Math.random() * 2.5;
      world.glow.spawn({
        x: this.tmp.x, y: this.tmp.y, z: this.tmp.z,
        vx: Math.cos(a) * sp, vy: (Math.random() - 0.3) * 2.5, vz: Math.sin(a) * sp,
        life: 0.3 + Math.random() * 0.3, size: 0.07, sizeEnd: 0.01, color, drag: 0.2,
      });
    }
  }

  private spawnArc(): void {
    const slot = this.arcs.find((a) => a.life <= 0);
    if (!slot) return;
    const { rig } = this.ctx;
    const R = rig.dims.ringRadius * 1.2;
    const h = rig.dims.height;
    const a0 = Math.random() * Math.PI * 2;
    const a1 = a0 + 0.8 + Math.random() * 1.6;
    rig.bodyToWorld(this.tmp.set(Math.cos(a0) * R, h * (0.2 + 0.6 * Math.random()), Math.sin(a0) * R), this.tmp);
    rig.bodyToWorld(this.tmp2.set(Math.cos(a1) * R, h * (0.2 + 0.6 * Math.random()), Math.sin(a1) * R), this.tmp2);
    const pos = slot.line.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < 10; i++) {
      const t = i / 9;
      const j = i === 0 || i === 9 ? 0 : 0.12;
      pos.setXYZ(
        i,
        this.tmp.x + (this.tmp2.x - this.tmp.x) * t + (Math.random() - 0.5) * j,
        this.tmp.y + (this.tmp2.y - this.tmp.y) * t + (Math.random() - 0.5) * j + Math.sin(t * Math.PI) * 0.15,
        this.tmp.z + (this.tmp2.z - this.tmp.z) * t + (Math.random() - 0.5) * j,
      );
    }
    pos.needsUpdate = true;
    slot.line.material.color.set(Math.random() < 0.5 ? ARC_COLOR : 0xffffff);
    slot.life = 0.08 + Math.random() * 0.07;
  }

  onEvent(e: ConditionEvent, frame: LayerFrame): void {
    if (!this.enabled) return;
    const { rig, world } = this.ctx;
    if (e.kind === 'hit') {
      this.hitDip = 1;
      const p = frame.motion.position;
      for (let i = 0; i < 6; i++) {
        world.glow.spawn({
          x: p.x + Math.cos(e.dirAngle) * rig.dims.ringRadius, y: p.y + rig.dims.ringMidY, z: p.z + Math.sin(e.dirAngle) * rig.dims.ringRadius,
          vx: (Math.random() - 0.5) * 3, vy: Math.random() * 2, vz: (Math.random() - 0.5) * 3,
          life: 0.35, size: 0.1, sizeEnd: 0.02, color: rig.palette.glow, drag: 0.2,
        });
      }
    } else if (e.kind === 'break') {
      this.pulse.material.color.set(DANGER_COLOR);
      this.pulseT = 0;
    } else if (e.kind === 'recover') {
      this.pulse.material.color.set(0xffffff);
      this.pulseT = 0;
    } else if (e.kind === 'spinOut' || e.kind === 'down') {
      const p = frame.motion.position;
      for (let i = 0; i < 18; i++) {
        world.glow.spawn({
          x: p.x + (Math.random() - 0.5) * 0.6, y: p.y + 0.2 + Math.random() * 0.4, z: p.z + (Math.random() - 0.5) * 0.6,
          vx: (Math.random() - 0.5) * 0.4, vy: 0.8 + Math.random() * 1.2, vz: (Math.random() - 0.5) * 0.4,
          life: 0.9 + Math.random() * 0.6, size: 0.12, sizeEnd: 0.02, color: rig.palette.glow, alpha: 0.7, drag: 0.5,
        });
      }
    } else if (e.kind === 'reset') {
      this.needsSync = true;
    }
  }

  dispose(): void {
    this.rebuildShards(0);
    this.aura.removeFromParent();
    this.lineGroup.removeFromParent();
    this.shardRing.removeFromParent();
    this.shell.removeFromParent();
    this.dazed.removeFromParent();
    this.pulse.removeFromParent();
    this.aura.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    this.auraMats.forEach((m) => m.dispose());
    this.lines.forEach((l) => { l.geometry.dispose(); l.material.dispose(); });
    this.shardGeo.dispose();
    this.shardEdges.dispose();
    this.shell.geometry.dispose();
    this.shell.material.dispose();
    this.stars[0]?.geometry.dispose();
    this.stars.forEach((s) => s.material.dispose());
    for (const a of this.arcs) {
      a.line.removeFromParent();
      a.line.geometry.dispose();
      a.line.material.dispose();
    }
    this.pulse.geometry.dispose();
    this.pulse.material.dispose();
  }
}
