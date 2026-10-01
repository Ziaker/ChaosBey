// Ported unchanged in behaviour from prototypes/condition-visual-concepts/src/languages/instrument.ts (Stamina & Stability Lab, approved 2026-09-27;
// docs/design-decisions/condition-visual-approval.md). Only imports and the world/rig contract were adapted.
// Presentation only: observes condition, never decides an outcome (GDD 158).
// ============================================================
// LANGUAGE C — INSTRUMENTO NO CHÃO (FLOOR INSTRUMENT)
// The arena floor projects an instrument under each Bey: precise, readable
// from any camera angle and distance, shape-coded as well as colour-coded
// (segments, arc length, stripes), and it leaves the Bey itself clean.
// This is in-world (diegetic), not the HUD — the HUD stays a separate,
// unapproved decision (GDD 60 / 171.9).
//
//   Stamina   → outer arc with 10% ticks, draining clockwise; white → amber
//               → pulsing red. A notch runs around it at a quarter of the
//               spin rate. The Top Layer core pulses like a heartbeat that
//               slows as Stamina drops.
//   Stability → inner ring of segments. Hits blank segments (they flash
//               first); recovery refills them one after another.
//   Broken    → the inner ring becomes rotating hazard stripes.
//               (A red light column above the Bey was prototyped and removed
//               by the owner on 2026-09-27.)
// ============================================================

import * as THREE from 'three';
import { UV_VERT } from '../glsl';
import type { ConditionEvent } from '../types';
import type { ConditionLayer, LayerContext, LayerFrame } from '../types';

// ---------------- LANGUAGE C TUNING (multiplied by the sliders) ----------------
const INNER_R = 1.22;               // Inner (Stability) band start, × ring radius.
const INNER_W = 0.07;               // Band width (m) at cWidth = 1.
const BAND_GAP = 0.05;              // Gap between the two bands (m).
const OUTER_W = 0.085;              // Outer (Stamina) band width (m) at cWidth = 1.
const NOTCH_RATE = 0.25;            // Notch turns at this fraction of the spin rate.
const REFILL_RATE_PER_S = 0.8;      // Stability shown refilling after recovery (per second).
const HEART_HZ_EMPTY = 0.55;        // Core heartbeat near zero Stamina…
const HEART_HZ_FULL = 1.5;          // …and at full Stamina.
const COLOR_COOL = 0xd8f6ff;
const COLOR_WARN = 0xffb347;
const COLOR_CRIT = 0xff3b3b;
const COLOR_HAZARD = 0xffcc00;
// ---------------------------------------------------------------------------------

const GAUGE_FRAG = /* glsl */ `
  #define TAU 6.28318530718
  uniform float uHalf;
  uniform float uInner1;
  uniform float uInner2;
  uniform float uOuter1;
  uniform float uOuter2;
  uniform float uStamina;
  uniform float uStability;
  uniform float uSegments;
  uniform float uLit;
  uniform float uLostFrom;
  uniform float uLostTo;
  uniform float uLostFlash;
  uniform float uBroken;
  uniform float uHazard;
  uniform float uNotch;
  uniform float uNotchOn;
  uniform float uStart;
  uniform float uHit;
  uniform float uOpacity;
  uniform float uPulse;
  uniform vec3 uStaminaColor;
  uniform vec3 uSegColor;
  uniform vec3 uHazardColor;
  uniform vec3 uCrit;
  varying vec2 vUv;

  float band(float r, float a, float b) {
    float aa = fwidth(r) * 1.2;
    return smoothstep(a - aa, a + aa, r) * (1.0 - smoothstep(b - aa, b + aa, r));
  }

  void main() {
    vec2 p = (vUv - 0.5) * 2.0 * uHalf;
    float r = length(p);
    float ang = atan(p.y, p.x);
    float frac = fract((uStart - ang) / TAU);  // 0 at the far side, growing clockwise
    vec3 col = vec3(0.0);
    float alpha = 0.0;

    // Outer band: Stamina arc with 10% ticks.
    float ob = band(r, uOuter1, uOuter2);
    if (ob > 0.0) {
      float filled = step(frac, uStamina);
      float tick = step(0.985, fract(frac * 10.0)) + step(fract(frac * 10.0), 0.015);
      float lead = smoothstep(0.03, 0.0, abs(frac - uStamina)) * step(0.001, uStamina);
      vec3 c = uStaminaColor * (0.85 + 0.35 * lead);
      float a = mix(0.13, 0.95, filled) * (1.0 - 0.75 * tick);
      col = mix(col, c + uHit * 0.6, ob);
      alpha = max(alpha, a * ob * uPulse);
    }

    // RPM notch just outside the outer band.
    float nd = abs(mod(frac - uNotch + 0.5, 1.0) - 0.5) * TAU * r;
    float nb = band(r, uOuter2 + 0.015, uOuter2 + 0.06) * smoothstep(0.05, 0.0, nd) * uNotchOn;
    col = mix(col, vec3(1.0), nb);
    alpha = max(alpha, nb);

    // Inner band: Stability segments, or hazard stripes when broken.
    float ib = band(r, uInner1, uInner2);
    if (ib > 0.0) {
      float seg = floor(frac * uSegments);
      float sf = fract(frac * uSegments);
      float gap = step(sf, 0.07) + step(0.93, sf);
      float lit = step(seg + 0.5, uLit);
      float lost = step(uLostFrom - 0.5, seg) * step(seg + 0.5, uLostTo) * uLostFlash;
      vec3 c = mix(uSegColor * 0.35, uSegColor, lit);
      c = mix(c, vec3(1.0), lost);
      float a = mix(0.12, 0.92, max(lit, lost)) * (1.0 - gap);

      float stripe = step(0.5, fract(frac * uSegments * 3.0 + (r - uInner1) * 9.0 + uHazard));
      vec3 hz = mix(vec3(0.05), uHazardColor, stripe);
      hz = mix(hz, uCrit, 0.35 + 0.35 * sin(uHazard * 6.0));
      c = mix(c, hz, uBroken);
      a = mix(a, 0.95, uBroken);
      col = mix(col, c + uHit * 0.5, ib);
      alpha = max(alpha, a * ib);
    }

    gl_FragColor = vec4(col, alpha * uOpacity);
  }
`;

const FLARE_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec2 vUv;
  void main() {
    float d = length(vUv - 0.5) * 2.0;
    float core = smoothstep(0.35, 0.0, d);
    float halo = smoothstep(1.0, 0.0, d) * 0.45;
    float spikes = max(smoothstep(0.06, 0.0, abs(vUv.x - 0.5)), smoothstep(0.06, 0.0, abs(vUv.y - 0.5))) * smoothstep(1.0, 0.2, d) * 0.5;
    gl_FragColor = vec4(mix(uColor, vec3(1.0), core * 0.7), (core + halo + spikes) * uOpacity);
  }
`;

/** "Lub-dub": two quick bumps per beat. `phase` is 0..1. */
function heartbeat(phase: number): number {
  const g = (x: number, c: number): number => Math.exp(-(((x - c) / 0.055) ** 2));
  return Math.min(1, g(phase, 0.05) + 0.6 * g(phase, 0.27));
}

export class InstrumentLayer implements ConditionLayer {
  readonly id = 'C' as const;
  enabled = true;
  private readonly holder = new THREE.Group();
  private readonly gauge: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly flare: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private shownStability = 1;
  private notch = 0;
  private heartPhase = 0;
  private hazardPhase = 0;
  private hit = 0;
  private lostFrom = 0;
  private lostTo = 0;
  private lostFlash = 0;
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly n = new THREE.Vector3();
  private readonly v = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  private readonly cStamina = new THREE.Color();
  private readonly cSeg = new THREE.Color();

  constructor(private readonly ctx: LayerContext) {
    const { world } = ctx;
    this.gauge = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.ShaderMaterial({
        vertexShader: UV_VERT,
        fragmentShader: GAUGE_FRAG,
        uniforms: {
          uHalf: { value: 1 }, uInner1: { value: 0 }, uInner2: { value: 0 }, uOuter1: { value: 0 }, uOuter2: { value: 0 },
          uStamina: { value: 1 }, uStability: { value: 1 }, uSegments: { value: 8 }, uLit: { value: 8 },
          uLostFrom: { value: 0 }, uLostTo: { value: 0 }, uLostFlash: { value: 0 },
          uBroken: { value: 0 }, uHazard: { value: 0 }, uNotch: { value: 0 }, uNotchOn: { value: 1 },
          uStart: { value: 0 }, uHit: { value: 0 }, uOpacity: { value: 0.85 }, uPulse: { value: 1 },
          uStaminaColor: { value: new THREE.Color(COLOR_COOL) }, uSegColor: { value: new THREE.Color(COLOR_COOL) },
          uHazardColor: { value: new THREE.Color(COLOR_HAZARD) }, uCrit: { value: new THREE.Color(COLOR_CRIT) },
        },
        transparent: true, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
      }),
    );
    this.gauge.renderOrder = 3;
    this.holder.add(this.gauge);
    world.scene.add(this.holder);

    this.flare = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShaderMaterial({
        vertexShader: UV_VERT, fragmentShader: FLARE_FRAG,
        uniforms: { uColor: { value: new THREE.Color(COLOR_COOL) }, uOpacity: { value: 0 } },
        transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
      }),
    );
    this.flare.renderOrder = 9;
    world.scene.add(this.flare);

  }

  /** Stability segments lit on the gauge right now — read by tests. */
  get litSegments(): number {
    return this.gauge.material.uniforms.uLit!.value as number;
  }

  /** Stamina the outer arc shows right now — read by tests. */
  get staminaShown(): number {
    return this.gauge.material.uniforms.uStamina!.value as number;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.holder.visible = on;
    this.flare.visible = on;
    if (on) this.shownStability = -1;
  }

  update(frame: LayerFrame, dt: number): void {
    if (!this.enabled) return;
    const { rig, tuning: T, world } = this.ctx;
    const s = frame.state;
    const m = frame.motion;
    const time = frame.time;
    const R = rig.dims.ringRadius;
    const live = 1 - s.spinOut;

    // --- Place the gauge flat on the floor under the tip, aligned to the floor normal ---
    const x = m.position.x;
    const z = m.position.z;
    world.floorNormalAt(x, z, this.n);
    this.holder.position.set(x, world.floorHeightAt(x, z) + 0.015, z);
    this.holder.quaternion.setFromUnitVectors(this.up, this.n);
    const shrink = 1 - 0.55 * s.spinOut;
    const inner1 = R * INNER_R * T.cRadius * shrink;
    const inner2 = inner1 + INNER_W * T.cWidth;
    const outer1 = inner2 + BAND_GAP * T.cWidth;
    const outer2 = outer1 + OUTER_W * T.cWidth;
    const half = outer2 + 0.12;
    this.gauge.scale.setScalar(half * 2);

    // Start the arc on the side away from the camera (top of the screen).
    this.v.copy(this.holder.position).sub(world.camera.position);
    const start = Math.atan2(-this.v.z, this.v.x);

    // Stability shown: drops at once, refills visibly.
    const N = Math.round(T.cSegments);
    if (this.shownStability < 0) this.shownStability = s.stability;
    if (s.stability < this.shownStability) this.shownStability = s.stability;
    else this.shownStability = Math.min(s.stability, this.shownStability + REFILL_RATE_PER_S * dt);
    const lit = s.broken ? 0 : Math.ceil(this.shownStability * N - 1e-4);

    this.notch = (this.notch + m.rps * NOTCH_RATE * dt) % 1;
    this.hazardPhase += T.cHazardSpin * dt * 0.8;
    this.hit = Math.max(0, this.hit - dt * 5);
    this.lostFlash = Math.max(0, this.lostFlash - dt * 2.2);

    const staminaHex = s.stamina < T.cCritAt ? COLOR_CRIT : s.stamina < T.cWarnAt ? COLOR_WARN : COLOR_COOL;
    this.cStamina.set(staminaHex);
    const pulse = s.stamina < T.cCritAt ? 0.55 + 0.45 * Math.sin(time * Math.PI * 2 * 2.5) : 1;
    this.cSeg.set(s.stability < 0.34 ? COLOR_WARN : COLOR_COOL);

    const u = this.gauge.material.uniforms;
    u.uHalf!.value = half;
    u.uInner1!.value = inner1;
    u.uInner2!.value = inner2;
    u.uOuter1!.value = outer1;
    u.uOuter2!.value = outer2;
    u.uStamina!.value = s.stamina;
    u.uStability!.value = this.shownStability;
    u.uSegments!.value = N;
    u.uLit!.value = lit;
    u.uLostFrom!.value = this.lostFrom;
    u.uLostTo!.value = this.lostTo;
    u.uLostFlash!.value = this.lostFlash;
    u.uBroken!.value = m.brokenBlend;
    u.uHazard!.value = this.hazardPhase;
    u.uNotch!.value = this.notch;
    u.uNotchOn!.value = T.cNotch * live;
    u.uStart!.value = start;
    u.uHit!.value = this.hit;
    u.uOpacity!.value = T.cOpacity * (0.3 + 0.7 * live);
    u.uPulse!.value = pulse;
    (u.uStaminaColor!.value as THREE.Color).copy(this.cStamina);
    (u.uSegColor!.value as THREE.Color).copy(this.cSeg);

    // --- Core heartbeat (Top Layer) ---
    const hz = HEART_HZ_EMPTY + (HEART_HZ_FULL - HEART_HZ_EMPTY) * s.stamina;
    this.heartPhase = (this.heartPhase + hz * dt) % 1;
    const beat = heartbeat(this.heartPhase) * live;
    rig.mods.glowMul *= 1 + T.cCorePulse * (beat * 1.1 - 0.25);
    rig.bodyToWorld(this.v2.set(0, rig.dims.topY + 0.03, 0), this.v2);
    this.flare.position.copy(this.v2);
    this.flare.quaternion.copy(world.camera.quaternion);
    this.flare.scale.setScalar(Math.max(0.001, 0.38 * T.cCorePulse * (0.55 + 0.45 * beat)));
    (this.flare.material.uniforms.uColor!.value as THREE.Color).set(staminaHex);
    this.flare.material.uniforms.uOpacity!.value = Math.min(1, T.cCorePulse) * (0.2 + 0.8 * beat) * (0.35 + 0.65 * Math.sqrt(s.stamina)) * live;
    this.flare.visible = T.cCorePulse > 0.01;

  }

  onEvent(e: ConditionEvent, frame: LayerFrame): void {
    if (!this.enabled) return;
    const T = this.ctx.tuning;
    const N = Math.round(T.cSegments);
    if (e.kind === 'hit') {
      this.hit = 0.6 * e.magnitude + 0.2;
      // Flash the segments this hit removed.
      this.lostTo = Math.ceil(e.stabilityBefore * N - 1e-4);
      this.lostFrom = Math.ceil(Math.max(0, frame.state.stability) * N - 1e-4);
      if (frame.state.broken) this.lostFrom = 0;
      this.lostFlash = 1;
    } else if (e.kind === 'break') {
      this.lostFrom = 0;
      this.lostTo = N;
      this.lostFlash = 1;
      this.hit = 1;
    } else if (e.kind === 'recover') {
      this.shownStability = 0; // refill sweep from empty
      this.hit = 0.8;
    } else if (e.kind === 'reset') {
      this.shownStability = -1;
    }
  }

  dispose(): void {
    this.holder.removeFromParent();
    this.flare.removeFromParent();
    this.gauge.geometry.dispose();
    this.gauge.material.dispose();
    this.flare.geometry.dispose();
    this.flare.material.dispose();
  }
}
