// ============================================================
// FLOW FX SYSTEM (flowFx flag)
// The "Fluxo do Bey" effects of the Bey Flow FX lab as a presentation system,
// every value a Settings slider (flowFxTuning.ts):
//
//   lean        the Bey tilts into a curve, from its sideways acceleration (pivoting on the tip)
//   shadow      a small black disc on the floor under each Bey (one cheap draw call each)
//   dust        anime dust in real volume behind the tip, along the Bey's heading (FlowWind / AnimeDust)
//   wind        torn white streaks behind a fast Bey
//   Dash        shock rings born in the middle of the Bey, facing where it is fired
//   hit         the same rings at the contact, facing the attack, plus the floor crowns,
//               the flat star and a dust burst along the attack
//   words       comic "HIT" / "COUNTER!" (ComicWords)
//
// The spin blur is the approved condition blur (ConditionVisualsSystem); the session
// hands the blur slider to it.
//
// What drives it is what the match really did (presentation events and state), never a script.
// PRESENTATION ONLY: the only things written are this system's own meshes and the Bey visual
// group's attitude (the lean), which the next frame's sync rewrites from physics. No body, collider,
// stat, input, camera or clock is touched, so the simulation, the replay and the state hash are unchanged.
// ============================================================

import * as THREE from 'three';
import type { BeyDefinition } from '../../bey/archetype/BeyDefinition';
import type { BeyVisual } from '../../bey/procedural-model/createBeyMesh';
import { AttackState } from '../../combat/attacks/AttackController';
import type { PresentationEvent, PresentationSide } from '../../presentation/events';
import type { PresentationFrame, PresentationSystem } from '../../presentation/hub';
import type { MatchPresentationState } from '../../presentation/state';
import { FxLayer } from '../hybrid/fx/FxLayer';
import { effectScaleOf, type VfxOptions } from '../hybrid/intensityTiers';
import { ComicWords } from './ComicWords';
import { DEFAULT_FLOW_FX_SETTINGS, type FlowFxSettings, type FlowFxValues } from './flowFxTuning';
import { FlowWind, type FlowBeyPose } from './FlowWind';

export const FLOW_FX_SYSTEM_ID = 'flow-fx';

// ---------------- TUNING (the lab's values) ----------------
const MAX_FRAME_DT = 1 / 20;
/** Effects keep moving slowly while the game is in hitstop (the hybrid system's rate). */
const HITSTOP_FX_RATE = 0.35;
const BEY_MID_HEIGHT_RATIO = 0.55 / 0.65;   // the lab's mid-body height (0.55 m) over its Bey radius (0.65 m)
const SHADOW_LIFT_M = 0.03;
const SHADOW_SEGMENTS = 24;
const SHADOW_MARGIN = 1.1;                  // a little wider than the Bey
const SHADOW_FADE_HEIGHT_M = 3;             // the shadow fades out as the Bey jumps this high
const SLOPE_PROBE_M = 0.05;
const LEAN_MIN_SPEED_MPS = 0.5;
const HEADING_MIN_SPEED_MPS = 0.3;
const DASH_HEADING_MIN_SPEED_MPS = 2;
const VELOCITY_SMOOTH_PER_S = 20;
const RNG_SEED = 7;
// -----------------------------------------------------------

const SIDES: readonly PresentationSide[] = ['first', 'second'];
const SLOT: Readonly<Record<PresentationSide, 0 | 1>> = { first: 0, second: 1 };

export interface FlowFxBeyTarget {
  readonly visual: BeyVisual;
  readonly gameplay: BeyDefinition;
}

export interface FlowFxOptions {
  readonly scene: THREE.Object3D;
  /** Read-only: faces billboards and projects the words. Never written. */
  readonly camera: THREE.Camera;
  readonly beys: Readonly<Record<PresentationSide, FlowFxBeyTarget>>;
  /** Floor height by distance from the arena centre (floors are radial). */
  readonly floorHeightAtR: (r: number) => number;
  /** Where the words overlay is mounted. Default: the page body. `null`: no DOM. */
  readonly overlayParent?: HTMLElement | null;
  /** The Pregame's visual options (effect size follows the Bey size × this). */
  readonly vfx?: VfxOptions;
  readonly settings?: FlowFxSettings;
}

interface Track {
  readonly side: PresentationSide;
  readonly target: FlowFxBeyTarget;
  readonly pos: THREE.Vector3;
  readonly previous: THREE.Vector3;
  readonly quaternion: THREE.Quaternion;
  /** Smoothed horizontal velocity and acceleration (m/s, m/s²). */
  readonly vel: THREE.Vector2;
  readonly accel: THREE.Vector2;
  readonly pose: FlowBeyPose;
  readonly shadow: THREE.Mesh;
  hasPrevious: boolean;
  sinceMoveS: number;
  leanRad: number;
  attackState: AttackState;
}

const _up = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _tip = new THREE.Vector3();
const _offset = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _qLean = new THREE.Quaternion();
const _qFloor = new THREE.Quaternion();
const _worldUp = new THREE.Vector3(0, 1, 0);
const _axisX = new THREE.Vector3(1, 0, 0);
const _qFlat = new THREE.Quaternion();

export class FlowFxSystem implements PresentationSystem {
  readonly id = FLOW_FX_SYSTEM_ID;

  private readonly layer: FxLayer;
  private readonly wind: FlowWind;
  private readonly words: ComicWords;
  private readonly tracks: Record<PresentationSide, Track>;
  private readonly effectScale: number;
  private readonly floor: { heightAt(r: number): number; slopeAt(r: number): number };
  private settings: FlowFxSettings;
  /** The slider values with the sizes already × the Bey size (the wind code reads metres). */
  private scaled: FlowFxValues;
  private counterWord = true;
  private hitstopActive = false;
  private frames = 0;
  private hits = 0;
  private dashes = 0;
  private readonly defeated = new Set<PresentationSide>();
  private readonly tipPoint = new THREE.Vector3();

  constructor(private readonly options: FlowFxOptions) {
    const { scene, camera } = options;
    this.effectScale = effectScaleOf(options.beys.first.gameplay, options.vfx);
    this.floor = {
      heightAt: (r) => options.floorHeightAtR(r),
      slopeAt: (r) => (options.floorHeightAtR(r + SLOPE_PROBE_M) - options.floorHeightAtR(Math.max(0, r - SLOPE_PROBE_M))) / (r < SLOPE_PROBE_M ? r + SLOPE_PROBE_M : 2 * SLOPE_PROBE_M),
    };
    this.layer = new FxLayer(scene, camera);
    const radius = options.beys.first.gameplay.physical.colliderRadiusM;
    this.wind = new FlowWind(this.layer, camera, scene, this.floor, RNG_SEED, radius * BEY_MID_HEIGHT_RATIO);
    this.words = new ComicWords(camera, options.overlayParent);
    this.settings = options.settings ?? DEFAULT_FLOW_FX_SETTINGS;
    this.scaled = this.scaleValues(this.settings.values);
    this.wind.dustStyle = this.settings.dustStyle;
    this.tracks = { first: this.buildTrack('first'), second: this.buildTrack('second') };
  }

  private buildTrack(side: PresentationSide): Track {
    const target = this.options.beys[side];
    const radius = target.gameplay.physical.colliderRadiusM;
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.5, SHADOW_SEGMENTS),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5, depthWrite: false, fog: false, toneMapped: false }),
    );
    shadow.scale.setScalar(radius * 2 * SHADOW_MARGIN);
    shadow.renderOrder = -1;
    shadow.frustumCulled = false;
    shadow.name = `flow-fx-shadow-${side}`;
    shadow.visible = false;
    this.options.scene.add(shadow);
    return {
      side,
      target,
      pos: new THREE.Vector3(),
      previous: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
      vel: new THREE.Vector2(),
      accel: new THREE.Vector2(),
      pose: { x: 0, z: 0, speed: 0, headX: 1, headZ: 0, dashing: false, dashDirX: 1, dashDirZ: 0 },
      shadow,
      hasPrevious: false,
      sinceMoveS: 0,
      leanRad: 0,
      attackState: AttackState.Neutral,
    };
  }

  /** Sizes in the slider values are metres at the lab's Bey: they follow this match's Bey size × the Pregame's effects size. */
  private scaleValues(values: Readonly<FlowFxValues>): FlowFxValues {
    const k = this.effectScale;
    return {
      ...values,
      dustSizeM: values.dustSizeM * k,
      windLengthM: values.windLengthM * k,
      windWidthM: values.windWidthM * k,
      crownSizeM: values.crownSizeM * k,
      burstSizeM: values.burstSizeM * k,
    };
  }

  /** Applies new Settings live (the Settings screen, even over a paused match). */
  setSettings(settings: FlowFxSettings): void {
    this.settings = settings;
    this.scaled = this.scaleValues(settings.values);
    this.wind.dustStyle = settings.dustStyle;
    if (!settings.comicWords) this.words.clear();
  }

  /** Settings → Game feel → "COUNTER!": off, a counter hit shows the plain "HIT" word. */
  setCounterWord(on: boolean): void {
    this.counterWord = on;
  }

  getSettings(): FlowFxSettings {
    return this.settings;
  }

  /** A destroyed Bey raises no more effects of its own and loses its shadow. */
  setDefeated(side: PresentationSide): void {
    this.defeated.add(side);
    this.tracks[side].shadow.visible = false;
  }

  private flags(): { dust: boolean; wind: boolean; crown: boolean } {
    const on = this.settings.values.intensity > 0;
    return { dust: on, wind: on, crown: on };
  }

  private floorPoint(x: number, z: number): THREE.Vector3 {
    return this.tipPoint.set(x, this.floor.heightAt(Math.hypot(x, z)), z);
  }

  /** The Bey's world pose this frame, and its smoothed velocity and acceleration (only when the pose really moved). */
  private measure(track: Track, dt: number): void {
    const group = track.target.visual.group;
    group.updateWorldMatrix(true, false);
    group.matrixWorld.decompose(track.pos, track.quaternion, _offset);
    track.sinceMoveS += dt;
    if (!track.hasPrevious) {
      track.previous.copy(track.pos);
      track.hasPrevious = true;
      track.sinceMoveS = 0;
      return;
    }
    const dx = track.pos.x - track.previous.x;
    const dz = track.pos.z - track.previous.z;
    if (dx * dx + dz * dz < 1e-10 || track.sinceMoveS <= 0) return; // no new physics step drawn yet: keep the last reading
    const span = Math.min(track.sinceMoveS, MAX_FRAME_DT * 2);
    const vx = dx / span;
    const vz = dz / span;
    const k = 1 - Math.exp(-VELOCITY_SMOOTH_PER_S * span);
    const nx = track.vel.x + (vx - track.vel.x) * k;
    const nz = track.vel.y + (vz - track.vel.y) * k;
    track.accel.set((nx - track.vel.x) / span, (nz - track.vel.y) / span);
    track.vel.set(nx, nz);
    track.previous.copy(track.pos);
    track.sinceMoveS = 0;
  }

  private towardOpponent(track: Track): THREE.Vector2 {
    const other = this.tracks[track.side === 'first' ? 'second' : 'first'];
    const v = new THREE.Vector2(other.pos.x - track.pos.x, other.pos.z - track.pos.z);
    return v.lengthSq() < 1e-8 ? v.set(1, 0) : v.normalize();
  }

  private updatePose(track: Track, state: MatchPresentationState | null): void {
    const pose = track.pose;
    const speed = state ? state[track.side].speedMps : track.vel.length();
    pose.x = track.pos.x;
    pose.z = track.pos.z;
    pose.speed = speed;
    const dashing = state ? state[track.side].attackState === AttackState.DashActive : false;
    pose.dashing = dashing;
    const vlen = track.vel.length();
    if (dashing) {
      // The Dash heads for the opponent; once it is moving its velocity says where it really goes.
      const dir = vlen > DASH_HEADING_MIN_SPEED_MPS ? track.vel.clone().divideScalar(vlen) : this.towardOpponent(track);
      pose.headX = dir.x;
      pose.headZ = dir.y;
    } else if (vlen > HEADING_MIN_SPEED_MPS) {
      pose.headX = track.vel.x / vlen;
      pose.headZ = track.vel.y / vlen;
    }
  }

  onEvents(events: readonly PresentationEvent[], _state: MatchPresentationState): void {
    const flags = this.flags();
    for (const event of events) {
      if (event.kind !== 'hitResolved') continue;
      const defender = this.tracks[event.defenderSide];
      const attacker = this.tracks[event.attackerSide ?? (event.defenderSide === 'first' ? 'second' : 'first')];
      const contact = new THREE.Vector3((defender.pos.x + attacker.pos.x) / 2, (defender.pos.y + attacker.pos.y) / 2, (defender.pos.z + attacker.pos.z) / 2);
      const dx = defender.pos.x - attacker.pos.x;
      const dz = defender.pos.z - attacker.pos.z;
      this.hits++;
      this.wind.impact(contact.x, contact.z, event.magnitude, dx, dz, this.scaled, flags);
      if (this.settings.comicWords) {
        const counter = this.counterWord && event.hitboxKind === 'circular' && event.caughtOpponentDashing;
        this.words.spawn(counter ? 'counter' : 'hit', contact, this.settings.values.calloutScale, this.settings.values.calloutLifeS, event.magnitude);
      }
    }
  }

  update(frame: PresentationFrame): void {
    const state = frame.state;
    const rawDt = Math.min(MAX_FRAME_DT, Math.max(0, frame.dtSeconds));
    this.frames++;
    this.hitstopActive = state?.camera?.hitstopActive ?? false;
    const fxDt = this.hitstopActive ? rawDt * HITSTOP_FX_RATE : rawDt;
    const flags = this.flags();
    for (const side of SIDES) {
      const track = this.tracks[side];
      this.measure(track, rawDt);
      this.updatePose(track, state);
      if (!this.defeated.has(side)) {
        this.driveEffects(track, state, fxDt, flags);
        this.applyLean(track, state, rawDt);
      }
      this.placeShadow(track, state);
    }
    this.layer.tick(fxDt);
    this.wind.update(fxDt, this.scaled);
  }

  private driveEffects(track: Track, state: MatchPresentationState | null, fxDt: number, flags: { dust: boolean; wind: boolean; crown: boolean }): void {
    const bey = state?.[track.side];
    // Every Dash release (the edge into DashActive): shock rings fired toward the opponent and a fan of dust behind.
    if (bey && track.attackState !== AttackState.DashActive && bey.attackState === AttackState.DashActive) {
      const dir = this.towardOpponent(track);
      track.pose.dashDirX = dir.x;
      track.pose.dashDirZ = dir.y;
      track.pose.headX = dir.x;
      track.pose.headZ = dir.y;
      this.dashes++;
      this.wind.dashStart(SLOT[track.side], track.pose, this.scaled, flags);
    }
    if (bey) track.attackState = bey.attackState;
    const tip = this.floorPoint(track.pos.x, track.pos.z);
    this.wind.trail(SLOT[track.side], track.pose, tip, fxDt, this.scaled, flags);
  }

  /** Tilts the Bey's visual into the curve, pivoting on its tip. The next frame's sync rewrites the attitude from physics, so nothing accumulates. */
  private applyLean(track: Track, state: MatchPresentationState | null, dt: number): void {
    const v = this.settings.values;
    const bey = state?.[track.side];
    let target = 0;
    const speed = track.vel.length();
    if (v.leanMaxDeg > 0 && bey && !bey.airborne && !bey.tumbling && !bey.broken && speed > LEAN_MIN_SPEED_MPS) {
      const fx = track.vel.x / speed;
      const fz = track.vel.y / speed;
      const aLeft = track.accel.x * fz - track.accel.y * fx; // acceleration to the left of travel
      target = -THREE.MathUtils.degToRad(v.leanMaxDeg) * THREE.MathUtils.clamp(aLeft / v.leanAccelRefMps2, -1, 1);
    }
    track.leanRad += (target - track.leanRad) * (1 - Math.exp(-v.leanSmooth * Math.max(dt, 0)));
    if (Math.abs(track.leanRad) < 1e-4 || speed <= 1e-3) return;
    const group = track.target.visual.group;
    _forward.set(track.vel.x / speed, 0, track.vel.y / speed);
    _qLean.setFromAxisAngle(_forward, track.leanRad);
    // Pivot on the tip: the visual's origin is the collider centre, half a collider height above it along the Bey's own up.
    _up.set(0, 1, 0).applyQuaternion(group.quaternion);
    _tip.copy(group.position).addScaledVector(_up, -track.target.gameplay.physical.colliderHalfHeightM);
    _offset.copy(group.position).sub(_tip).applyQuaternion(_qLean);
    group.position.copy(_tip).add(_offset);
    group.quaternion.premultiply(_qLean);
    group.updateMatrixWorld(true);
  }

  private placeShadow(track: Track, state: MatchPresentationState | null): void {
    const v = this.settings.values;
    const shadow = track.shadow;
    const material = shadow.material as THREE.MeshBasicMaterial;
    const r = Math.hypot(track.pos.x, track.pos.z);
    const floorY = this.floor.heightAt(r);
    const height = Math.max(0, track.pos.y - track.target.gameplay.physical.colliderHalfHeightM - floorY);
    const visible = v.shadowOpacity > 0.003 && v.intensity > 0 && !this.defeated.has(track.side) && state !== null;
    shadow.visible = visible;
    if (!visible) return;
    material.opacity = v.shadowOpacity * (1 - THREE.MathUtils.clamp(height / SHADOW_FADE_HEIGHT_M, 0, 1));
    shadow.scale.setScalar(track.target.gameplay.physical.colliderRadiusM * 2 * SHADOW_MARGIN * v.shadowScale * (1 + 0.25 * THREE.MathUtils.clamp(height / SHADOW_FADE_HEIGHT_M, 0, 1)));
    shadow.position.set(track.pos.x, floorY + SHADOW_LIFT_M, track.pos.z);
    // Lie on the funnel: the floor normal leans away from the centre by the slope.
    const slope = this.floor.slopeAt(r);
    const rx = r > 1e-6 ? track.pos.x / r : 0;
    const rz = r > 1e-6 ? track.pos.z / r : 0;
    _normal.set(-rx * slope, 1, -rz * slope).normalize();
    _qFloor.setFromUnitVectors(_worldUp, _normal);
    shadow.quaternion.copy(_qFloor).multiply(_qFlat.setFromAxisAngle(_axisX, -Math.PI / 2));
  }

  reset(): void {
    this.layer.clear();
    this.wind.clear();
    this.words.clear();
    this.defeated.clear();
    for (const side of SIDES) {
      const t = this.tracks[side];
      t.hasPrevious = false;
      t.vel.set(0, 0);
      t.accel.set(0, 0);
      t.leanRad = 0;
      t.attackState = AttackState.Neutral;
    }
  }

  getStats(): Readonly<Record<string, number>> {
    return {
      fx: this.layer.count(),
      dustPuffs: this.wind.dustPuffs,
      dustLumps: this.wind.dustLumps,
      dustEmitted: this.wind.emittedDust,
      words: this.words.spawned,
      hits: this.hits,
      dashes: this.dashes,
      frames: this.frames,
    };
  }

  /** The dust's instanced mesh (tests and visual checks). */
  getDustMesh(): THREE.InstancedMesh {
    return this.wind.dustMesh;
  }

  getShadow(side: PresentationSide): THREE.Mesh {
    return this.tracks[side].shadow;
  }

  getLeanDegrees(side: PresentationSide): number {
    return THREE.MathUtils.radToDeg(this.tracks[side].leanRad);
  }

  dispose(): void {
    this.layer.clear();
    this.wind.dispose();
    this.words.dispose();
    for (const side of SIDES) {
      const shadow = this.tracks[side].shadow;
      shadow.removeFromParent();
      shadow.geometry.dispose();
      (shadow.material as THREE.Material).dispose();
    }
  }
}

export function createFlowFxSystem(options: FlowFxOptions): FlowFxSystem {
  return new FlowFxSystem(options);
}
