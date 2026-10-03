// ============================================================
// HYBRID VFX SYSTEM (hybridVfx flag)
// The approved Hybrid language with the Cel Cyclone wind burst, as a
// presentation system. The lab's choreography fired each effect from a script;
// here the same handlers are driven by what the match really did:
//
//   hitResolved            → hit        (A sparks/chips/dust + B stars/rings/lines)
//   ChargingDash           → dashCharge, every frame
//   ChargingDash → Dash    → dashRelease + windBurst (Cel Cyclone)
//   speed above 3 m/s      → fastMove   (the lab's own threshold)
//   CircularActive         → circularSweep
//   dodged / perfectDodge  → windBurst / perfectDodge, dodgeMove while dodging
//   stabilityBroken        → stabilityBreak; broken → wobble every frame
//   landed                 → landing;  ringOut → ringOut
//   collisionResolved      → scrape (one shot, only at the wall)
//
// What is deliberately NOT applied (the owner froze the camera for this pass,
// and nothing here scales time): camera shake (×1.35 stays metadata), hitstop
// (HitstopClock is the only authority), slow motion. The language still asks
// for them through its context; the requests are counted for observability and
// dropped. Screen effects (impact frame, tint, focus lines) use their own
// overlay layer, never a child of the camera.
//
// Observes only: no body, collider, stat, input or camera is written.
// ============================================================

import { FLOOR_SCAR_HIT_MIN_M, FLOOR_SCAR_LANDING_MIN_M, VFX_LIGHT } from './intensityTiers';
import { FloorScars } from './FloorScars';
import * as THREE from 'three';
import type { BeyDefinition } from '../../bey/archetype/BeyDefinition';
import type { BeyVisual } from '../../bey/procedural-model/createBeyMesh';
import { getConceptVisualModel } from '../../bey/visual/conceptBeyVisual';
import { AttackState } from '../../combat/attacks/AttackController';
import { CIRCULAR_ACTIVE_DURATION_S } from '../../combat/attacks/AttackTuning';
import { DodgeState } from '../../dodge/DodgeController';
import type { PresentationEvent, PresentationSide } from '../../presentation/events';
import type { PresentationFrame, PresentationSystem } from '../../presentation/hub';
import type { BeyPresentationState, MatchPresentationState } from '../../presentation/state';
import { measureRigDims } from '../condition/conditionRig';
import { FxLayer, StreakSparks } from './fx/FxLayer';
import { makeHybrid } from './languages/hybrid';
import type { FxContext, LanguageRuntime, Slot } from './languages/types';
import { ScreenOverlay } from './ScreenOverlay';
import { TUNING } from './tuning';

export const HYBRID_VFX_SYSTEM_ID = 'hybrid-vfx';

// ---------------- TUNING (the lab's values) ----------------
const SPARK_CAPACITY = 1500;
/** Effects keep moving slowly while the game is in hitstop (the lab's rate). */
const HITSTOP_FX_RATE = 0.35;
/** Speed above which a Bey throws speed sparks and skid marks (the lab's own threshold, m/s). */
const FAST_MOVE_SPEED_MPS = 3;
/** A collision this close to the wall counts as a wall scrape (fraction of the arena radius). */
const WALL_ZONE = 0.6;
const MAX_FRAME_DT = 1 / 20;
const FLASH_FADE_PER_S = 5;
/** The scrape handler is per-frame in the lab; a wall bounce plays it once, as one fixed tick. */
const ONE_SHOT_DT = 1 / 60;
// -----------------------------------------------------------

const SLOT: Readonly<Record<PresentationSide, Slot>> = { first: 0, second: 1 };
const SIDES: readonly PresentationSide[] = ['first', 'second'];

export interface HybridBeyTarget {
  readonly visual: BeyVisual;
  readonly gameplay: BeyDefinition;
}

export interface HybridVfxOptions {
  readonly scene: THREE.Object3D;
  /** Read-only: faces billboards and projects the screen effects. Never written. */
  readonly camera: THREE.Camera;
  readonly beys: Readonly<Record<PresentationSide, HybridBeyTarget>>;
  /** Floor height by distance from the arena centre (floors are radial). */
  readonly floorHeightAtR: (r: number) => number;
  /** The arena's [hot, cool] spark palette. */
  readonly arenaSparks: readonly [number, number];
  readonly arenaRadiusM: number;
  /** Where the screen overlay is mounted. Default: the page body. `null`: no DOM. */
  readonly overlayParent?: HTMLElement | null;
}

/** What the language asked of the camera and the clock: counted, never applied. */
export interface DroppedRequests {
  shake: number;
  hitstop: number;
  slowMotion: number;
}

interface BeyTrack {
  readonly side: PresentationSide;
  readonly target: HybridBeyTarget;
  readonly ringAboveOriginM: number;
  readonly color: THREE.Color;
  readonly pos: THREE.Vector3;
  readonly previous: THREE.Vector3;
  readonly vel: THREE.Vector3;
  hasPrevious: boolean;
  attackState: AttackState;
  dodgeState: DodgeState;
  lastCharge: number;
  circularElapsed: number;
}

export class HybridVfxSystem implements PresentationSystem {
  readonly id = HYBRID_VFX_SYSTEM_ID;

  readonly dropped: DroppedRequests = { shake: 0, hitstop: 0, slowMotion: 0 };
  private readonly layer: FxLayer;
  private readonly scars: FloorScars;
  private readonly sparks: StreakSparks;
  private readonly overlay: ScreenOverlay;
  private readonly flashLight = new THREE.PointLight(0xffffff, 0, 10, 2);
  private flashT = 0;
  private flashPeak = 0;
  private runtime: LanguageRuntime;
  private readonly tracks: Record<PresentationSide, BeyTrack>;
  private hitstopActive = false;
  private frames = 0;
  private dustSpawned = 0;
  private readonly up = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();

  constructor(private readonly options: HybridVfxOptions) {
    const { scene, camera } = options;
    this.layer = new FxLayer(scene, camera);
    this.scars = new FloorScars(this.layer, options.floorHeightAtR);
    this.sparks = new StreakSparks(SPARK_CAPACITY, options.floorHeightAtR);
    this.overlay = new ScreenOverlay(camera, options.overlayParent);
    scene.add(this.sparks.object, this.flashLight);
    this.tracks = { first: this.buildTrack('first'), second: this.buildTrack('second') };
    this.runtime = makeHybrid('cel').create(this.context());
  }

  private buildTrack(side: PresentationSide): BeyTrack {
    const target = this.options.beys[side];
    const dims = measureRigDims(target.visual, target.gameplay.physical.colliderHalfHeightM);
    const palette = getConceptVisualModel(target.visual)?.concept.palette;
    return {
      side,
      target,
      ringAboveOriginM: dims.ringMidY - target.gameplay.physical.colliderHalfHeightM,
      color: new THREE.Color(palette?.glow ?? target.gameplay.particle.sparkTintHex),
      pos: new THREE.Vector3(),
      previous: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      hasPrevious: false,
      attackState: AttackState.Neutral,
      dodgeState: DodgeState.Idle,
      lastCharge: 0,
      circularElapsed: 0,
    };
  }

  /** The language runtime (tests and visual checks drive its handlers directly). */
  getRuntime(): LanguageRuntime {
    return this.runtime;
  }

  /** The context the language sees: the game's pose, floor and scene; camera and time requests are dropped. */
  private context(): FxContext {
    const { scene, camera, floorHeightAtR, arenaSparks } = this.options;
    return {
      scene,
      camera,
      layer: this.layer,
      sparks: this.sparks,
      floorHeightAt: floorHeightAtR,
      beyColor: (slot) => this.track(slot).color.clone(),
      beyPos: (slot) => this.track(slot).pos.clone(),
      arenaSparks,
      shake: () => void this.dropped.shake++,
      hitstop: () => void this.dropped.hitstop++,
      slowMotion: () => void this.dropped.slowMotion++,
      impactFrame: (seconds) => this.overlay.impactFrame(seconds * TUNING.impactFrameLength),
      focusLines: (at, strength, seconds, color) => {
        if (TUNING.focusLines > 0) this.overlay.focusLines(at, strength * TUNING.focusLines, seconds, color);
      },
      tint: (css, seconds) => this.overlay.tint(css, seconds),
      flash: (at, color, intensity) => {
        this.flashLight.position.set(at.x, at.y + 0.5, at.z);
        this.flashLight.color.set(color);
        this.flashPeak = intensity * TUNING.flash;
        this.flashT = 1;
      },
      countDust: (n) => void (this.dustSpawned += n),
      ghost: (slot, material) => {
        const source = this.track(slot).target.visual.group;
        const copy = source.clone(true);
        copy.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.isMesh) {
            mesh.material = material;
            mesh.castShadow = false;
            mesh.userData.sharedGeometry = true;
          }
        });
        return copy;
      },
    };
  }

  private track(slot: Slot): BeyTrack {
    return this.tracks[slot === 0 ? 'first' : 'second'];
  }

  /** The Bey's ring position and velocity this frame. */
  private measure(track: BeyTrack, dt: number): void {
    const group = track.target.visual.group;
    group.updateWorldMatrix(true, false);
    group.matrixWorld.decompose(track.pos, this.quaternion, this.scale);
    this.up.set(0, 1, 0).applyQuaternion(this.quaternion);
    track.pos.addScaledVector(this.up, track.ringAboveOriginM);
    if (track.hasPrevious && dt > 0) track.vel.copy(track.pos).sub(track.previous).divideScalar(dt);
    else track.vel.set(0, 0, 0);
    track.previous.copy(track.pos);
    track.hasPrevious = true;
  }

  /** Unit XZ direction of motion, or toward the opponent when standing still. */
  private travelDirection(track: BeyTrack, out: THREE.Vector3): THREE.Vector3 {
    out.set(track.vel.x, 0, track.vel.z);
    if (out.lengthSq() < 1e-4) {
      const other = this.tracks[track.side === 'first' ? 'second' : 'first'];
      out.set(other.pos.x - track.pos.x, 0, other.pos.z - track.pos.z);
    }
    return out.lengthSq() < 1e-8 ? out.set(1, 0, 0) : out.normalize();
  }

  onEvents(events: readonly PresentationEvent[], _state: MatchPresentationState): void {
    const windThisCall = new Set<PresentationSide>();
    for (const event of events) {
      switch (event.kind) {
        case 'hitResolved': {
          const defender = this.tracks[event.defenderSide];
          const attacker = this.tracks[event.attackerSide ?? (event.defenderSide === 'first' ? 'second' : 'first')];
          // Contact point: between the two Beys. Normal: attacker toward defender, with a little lift (the lab's convention).
          const contact = defender.pos.clone().add(attacker.pos).multiplyScalar(0.5);
          const normal = new THREE.Vector3(defender.pos.x - attacker.pos.x, 0, defender.pos.z - attacker.pos.z);
          if (normal.lengthSq() < 1e-8) normal.set(1, 0, 0);
          normal.normalize().setY(0.2).normalize();
          this.runtime.hit({ pos: contact, normal, m: event.magnitude, attacker: SLOT[attacker.side] });
          if (event.magnitude >= FLOOR_SCAR_HIT_MIN_M) this.scars.scar(contact, event.magnitude);
          break;
        }
        case 'dodged': {
          const track = this.tracks[event.side];
          if (!windThisCall.has(event.side)) {
            windThisCall.add(event.side);
            this.runtime.windBurst({ pos: track.pos.clone(), dir: this.travelDirection(track, this.dir).clone(), m: event.magnitude, slot: SLOT[event.side] });
          }
          break;
        }
        case 'perfectDodge': {
          const track = this.tracks[event.side];
          const dir = this.travelDirection(track, this.dir).clone();
          if (!windThisCall.has(event.side)) {
            windThisCall.add(event.side);
            this.runtime.windBurst({ pos: track.pos.clone(), dir, m: event.magnitude, slot: SLOT[event.side] });
          }
          this.runtime.perfectDodge({ pos: track.pos.clone(), dir, m: event.magnitude, slot: SLOT[event.side] });
          break;
        }
        case 'stabilityBroken':
          this.runtime.stabilityBreak({ pos: this.tracks[event.side].pos.clone(), m: event.magnitude, slot: SLOT[event.side] });
          break;
        case 'landed':
          this.runtime.landing({ pos: this.tracks[event.side].pos.clone(), m: event.magnitude, slot: SLOT[event.side] });
          if (event.launched && event.magnitude >= FLOOR_SCAR_LANDING_MIN_M) this.scars.scar(this.tracks[event.side].pos.clone(), event.magnitude);
          break;
        case 'ringOut': {
          const track = this.tracks[event.side];
          const out = new THREE.Vector3(track.pos.x, 0, track.pos.z);
          if (out.lengthSq() < 1e-8) out.set(1, 0, 0);
          this.runtime.ringOut({ pos: track.pos.clone(), dir: out.normalize().setY(0.35).normalize(), m: Math.max(event.magnitude, 0.6), slot: SLOT[event.side] });
          break;
        }
        case 'collisionResolved': {
          const track = this.tracks[event.side];
          const r = Math.hypot(track.pos.x, track.pos.z);
          if (r < this.options.arenaRadiusM * WALL_ZONE) break; // a bump in the middle, not the wall
          const outward = new THREE.Vector3(track.pos.x, 0, track.pos.z).normalize();
          const normal = outward.clone().negate();
          const tangent = new THREE.Vector3(-outward.z, 0, outward.x);
          this.runtime.scrape({ pos: track.pos.clone().addScaledVector(outward, 0.7).setY(track.pos.y - 0.1), normal, tangent, m: event.magnitude, slot: SLOT[event.side] }, ONE_SHOT_DT);
          break;
        }
        default:
          break;
      }
    }
  }

  update(frame: PresentationFrame): void {
    const state = frame.state;
    const rawDt = Math.min(MAX_FRAME_DT, Math.max(0, frame.dtSeconds));
    this.frames++;
    for (const side of SIDES) this.measure(this.tracks[side], rawDt);
    if (state) {
      this.hitstopActive = state.camera?.hitstopActive ?? false;
      for (const side of SIDES) this.driveContinuous(this.tracks[side], state[side], rawDt);
    }
    // The language's own hitstop is dropped (HitstopClock owns it), but while the game is frozen the effects slow like the lab's.
    const fxDt = this.hitstopActive ? rawDt * HITSTOP_FX_RATE : rawDt;
    this.runtime.tick(fxDt);
    this.layer.tick(fxDt);
    this.sparks.tick(fxDt);
    this.overlay.update(rawDt);
    this.flashT = Math.max(0, this.flashT - rawDt * FLASH_FADE_PER_S);
    this.flashLight.intensity = this.flashPeak * this.flashT;
  }

  private driveContinuous(track: BeyTrack, bey: BeyPresentationState, dt: number): void {
    const slot = SLOT[track.side];
    const pos = track.pos.clone();
    // Dash: charge every frame, release on the edge into the active dash.
    if (bey.attackState === AttackState.ChargingDash) {
      track.lastCharge = bey.dashCharge;
      this.runtime.dashCharge({ pos, progress: bey.dashCharge, m: bey.dashCharge, slot }, dt);
    }
    // Every Dash releases its wind and dust (owner, 2026-10-02): on any edge into DashActive (a slow frame can skip the
    // charge), never weaker than the lab's Light intensity, so a short Dash still raises visible dust.
    if (track.attackState !== AttackState.DashActive && bey.attackState === AttackState.DashActive) {
      const dir = this.travelDirection(track, this.dir).clone();
      const charge = track.attackState === AttackState.ChargingDash ? track.lastCharge : bey.dashCharge;
      const m = Math.max(VFX_LIGHT, charge);
      this.runtime.dashRelease({ pos, dir, m, slot });
      this.runtime.windBurst({ pos: pos.clone(), dir, m, slot });
    }
    // Circular: the sweep, with its own progress.
    if (bey.attackState === AttackState.CircularActive) {
      if (track.attackState !== AttackState.CircularActive) track.circularElapsed = 0;
      const t = Math.min(1, track.circularElapsed / CIRCULAR_ACTIVE_DURATION_S);
      track.circularElapsed += dt;
      this.runtime.circularSweep({ pos, m: 0.6, slot }, t, dt);
    }
    track.attackState = bey.attackState;
    // Dodge: every dodge raises the Cel Cyclone wind and dust as it starts (owner, 2026-10-02; it used to show only
    // on an evaded hit, strongly only on a Perfect Dodge), at the lab's Light intensity; afterimages while dodging.
    if (track.dodgeState !== DodgeState.Dodging && bey.dodgeState === DodgeState.Dodging) {
      this.runtime.windBurst({ pos: pos.clone(), dir: this.travelDirection(track, this.dir).clone(), m: VFX_LIGHT, slot });
    }
    if (bey.dodgeState === DodgeState.Dodging) this.runtime.dodgeMove({ pos, vel: track.vel.clone(), m: 0.6, slot }, dt);
    track.dodgeState = bey.dodgeState;
    // Speed sparks and skid marks.
    if (bey.speedMps > FAST_MOVE_SPEED_MPS) this.runtime.fastMove({ pos, vel: track.vel.clone(), m: bey.speedFraction, slot }, dt);
    // A broken Bey wobbles and grinds.
    if (bey.broken) this.runtime.wobble({ pos, m: bey.stabilityDeficit, slot }, dt);
  }

  reset(): void {
    this.layer.clear();
    this.sparks.clear();
    this.overlay.clear();
    this.flashT = 0;
    this.flashLight.intensity = 0;
    this.runtime = makeHybrid('cel').create(this.context());
    for (const side of SIDES) {
      const t = this.tracks[side];
      t.hasPrevious = false;
      t.attackState = AttackState.Neutral;
      t.dodgeState = DodgeState.Idle;
      t.lastCharge = 0;
      t.circularElapsed = 0;
    }
  }

  getStats(): Readonly<Record<string, number>> {
    const screen = this.overlay.getStats();
    return {
      fx: this.layer.count(),
      sparks: this.sparks.count(),
      focusLines: screen.focusLines,
      impactFrame: screen.impactFrame,
      droppedShake: this.dropped.shake,
      droppedHitstop: this.dropped.hitstop,
      droppedSlowMotion: this.dropped.slowMotion,
      frames: this.frames,
      dust: this.dustSpawned,
      floorScars: this.scars.count(),
      floorScarsMade: this.scars.made,
    };
  }

  dispose(): void {
    this.layer.clear();
    this.sparks.clear();
    this.sparks.object.removeFromParent();
    this.sparks.object.geometry.dispose();
    (this.sparks.object.material as THREE.Material).dispose();
    this.flashLight.removeFromParent();
    this.flashLight.dispose();
    this.overlay.dispose();
  }
}

export function createHybridVfxSystem(options: HybridVfxOptions): HybridVfxSystem {
  return new HybridVfxSystem(options);
}
