// ============================================================
// LAUNCH CAMERA — the three shots of the round start (presentation only)
// The approved prototype's camera work (prototypes/launch-system-concepts, LS_Lab.updateCamera), as a camera the runner drives
// instead of the combat directors while the launch runs: behind and beside the player's launcher while the point is chosen;
// a fast chase of the flight (wider, with the speed); then, once the Beys touch down, a duel frame that the combat camera takes
// over from at once. The camera is downstream of the match (camera-gameplay-separation.md): it reads where the Beys are, and
// nothing it does reaches the simulation. A person's arrows never depend on it: the aim is read from the screen vector.
// ============================================================

import * as THREE from 'three';
import type { ExternalCamera, ExternalCameraFrame } from '../real/RealCameras';

/** What the camera needs to know about the launch, as plain numbers: it never touches the launch's own objects. */
export interface LaunchShot {
  readonly phase: 'mounted' | 'armed' | 'release' | 'flight' | 'landed';
  /** The Bey the first shot sits behind, and the other one (m). */
  readonly own: { readonly x: number; readonly y: number; readonly z: number };
  readonly other: { readonly x: number; readonly y: number; readonly z: number };
  /** The launcher's forward axis (toward the arena's centre) and its right-hand side on a screen that looks along it. */
  readonly forward: { readonly x: number; readonly z: number };
  readonly right: { readonly x: number; readonly z: number };
  /** Horizontal direction of the person's flight (start → end), once released. */
  readonly travel: { readonly x: number; readonly z: number } | null;
  /** 0..1: how powerful the person's launch was (widens the chase's field of view), once released. */
  readonly power: number;
  /** Where the first shot stands when the default (12.5 m behind, 11 m right, 6.8 m up) would put it in a crowd: null = the default. */
  readonly vantage: { readonly behindM: number; readonly rightM: number; readonly upM: number } | null;
}

export type LaunchShotSource = () => LaunchShot;

const SET_FOV_DEG = 52;
const FLIGHT_FOV_DEG = 62;
const FLIGHT_FOV_POWER_DEG = 5;
const DUEL_FOV_DEG = 58;
const SET_BEHIND_M = 12.5;
const SET_RIGHT_M = 11;
const SET_UP_M = 6.8;
const SET_LOOK_AHEAD_M = 5;
const SET_LOOK_DOWN_M = 1.25;
const FLIGHT_BEHIND_M = 10;
const FLIGHT_RIGHT_M = 9;
const FLIGHT_UP_M = 5.6;
const FLIGHT_MID_SHARE = 0.32;
const DUEL_SIDE_M = 18;
const DUEL_UP_M = 11;
const DUEL_BACK_M = 15;
const FOLLOW_RATE_SET_PER_S = 5;
const FOLLOW_RATE_FLIGHT_PER_S = 8;
const SHAKE_DECAY_PER_S = 10;

const smooth = (rate: number, dt: number): number => 1 - Math.exp(-rate * dt);

export class LaunchCamera implements ExternalCamera {
  private readonly focus = new THREE.Vector3();
  private fov = SET_FOV_DEG;
  private ready = false;
  private shake = 0;
  private lastPhase = '';
  /** The pose it left the camera in, for the combat camera to blend from. */
  readonly lastEye = new THREE.Vector3();
  readonly lastFocus = new THREE.Vector3();
  lastFovDeg = SET_FOV_DEG;

  constructor(private readonly shot: LaunchShotSource) {}

  apply(camera: THREE.PerspectiveCamera, frame: ExternalCameraFrame): void {
    const dt = Math.max(0, frame.dt);
    const { own, other, phase, forward: f, right, travel: flightTravel, power, vantage } = this.shot();
    const desiredEye = new THREE.Vector3();
    const desiredFocus = new THREE.Vector3();
    let desiredFov = SET_FOV_DEG;
    let rate = FOLLOW_RATE_SET_PER_S;

    if (phase === 'mounted' || phase === 'armed') {
      // Behind and to the right of the launcher, looking over it down the arena.
      const behind = vantage?.behindM ?? SET_BEHIND_M;
      const side = vantage?.rightM ?? SET_RIGHT_M;
      desiredEye.set(own.x - f.x * behind + right.x * side, own.y + (vantage?.upM ?? SET_UP_M), own.z - f.z * behind + right.z * side);
      desiredFocus.set(own.x + f.x * SET_LOOK_AHEAD_M, own.y - SET_LOOK_DOWN_M, own.z + f.z * SET_LOOK_AHEAD_M);
      desiredFov = SET_FOV_DEG;
    } else if (phase === 'release' || phase === 'flight') {
      const mid = new THREE.Vector3(own.x, own.y, own.z).lerp(new THREE.Vector3(other.x, other.y, other.z), FLIGHT_MID_SHARE);
      const travel = new THREE.Vector3(flightTravel?.x ?? f.x, 0, flightTravel?.z ?? f.z).normalize();
      const flightBehind = vantage ? Math.min(FLIGHT_BEHIND_M, vantage.behindM + 2) : FLIGHT_BEHIND_M;
      desiredEye.set(own.x - travel.x * flightBehind + right.x * FLIGHT_RIGHT_M, own.y + (vantage ? vantage.upM : FLIGHT_UP_M), own.z - travel.z * flightBehind + right.z * FLIGHT_RIGHT_M);
      desiredFocus.set(mid.x, mid.y + 0.5, mid.z);
      desiredFov = FLIGHT_FOV_DEG + power * FLIGHT_FOV_POWER_DEG;
      rate = FOLLOW_RATE_FLIGHT_PER_S;
      if (this.lastPhase !== 'release' && phase === 'release') this.shake = 0.14 + power * 0.18; // the kick of the release
    } else {
      // Landed: the duel frame, from the side, between the two Beys.
      const target = new THREE.Vector3(own.x, own.y, own.z).lerp(new THREE.Vector3(other.x, other.y, other.z), 0.52);
      const duel = new THREE.Vector3(other.x - own.x, 0, other.z - own.z);
      if (duel.lengthSq() < 0.001) duel.set(1, 0, 0);
      duel.normalize();
      const sideVec = new THREE.Vector3(-duel.z, 0, duel.x);
      desiredFocus.set(target.x, target.y + 0.45, target.z);
      desiredEye.copy(target).addScaledVector(sideVec, DUEL_SIDE_M).add(new THREE.Vector3(0, DUEL_UP_M, DUEL_BACK_M));
      desiredFov = DUEL_FOV_DEG;
    }

    if (this.shake > 0.001) {
      desiredEye.x += (Math.random() - 0.5) * this.shake;
      desiredEye.y += (Math.random() - 0.5) * this.shake;
      desiredEye.z += (Math.random() - 0.5) * this.shake;
      this.shake *= Math.exp(-dt * SHAKE_DECAY_PER_S);
    }

    this.lastPhase = phase;
    const k = this.ready ? smooth(rate, dt) : 1;
    this.ready = true;
    camera.position.lerp(desiredEye, k);
    this.focus.lerp(desiredFocus, k);
    if (k === 1) this.focus.copy(desiredFocus);
    camera.lookAt(this.focus);
    this.fov += (desiredFov - this.fov) * k;
    camera.fov = this.fov;
    camera.updateProjectionMatrix();
    this.lastEye.copy(camera.position);
    this.lastFocus.copy(this.focus);
    this.lastFovDeg = this.fov;
  }

  dispose(): void {}
}
