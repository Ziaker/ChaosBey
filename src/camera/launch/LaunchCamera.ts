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
import { launcherForward, launcherRight } from '../../launch/LaunchGeometry';
import type { LaunchSequence } from '../../launch/LaunchSequence';
import { launchOutcomeFor, type LaunchSide } from '../../launch/LaunchTuning';

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

  constructor(
    private readonly sequence: LaunchSequence,
    /** The side whose launcher the first shot sits behind (the person's). */
    private readonly side: LaunchSide,
  ) {}

  apply(camera: THREE.PerspectiveCamera, frame: ExternalCameraFrame): void {
    const dt = Math.max(0, frame.dt);
    const seq = this.sequence;
    const own = seq.getPose(this.side).position;
    const otherSide: LaunchSide = this.side === 'first' ? 'second' : 'first';
    const other = seq.getPose(otherSide).position;
    const phase = seq.currentPhase;
    const f = launcherForward(this.side);
    const right = launcherRight(this.side);
    const desiredEye = new THREE.Vector3();
    const desiredFocus = new THREE.Vector3();
    let desiredFov = SET_FOV_DEG;
    let rate = FOLLOW_RATE_SET_PER_S;

    if (phase === 'mounted' || phase === 'armed') {
      // Behind and to the right of the launcher, looking over it down the arena.
      desiredEye.set(own.x - f.x * SET_BEHIND_M + right.x * SET_RIGHT_M, own.y + SET_UP_M, own.z - f.z * SET_BEHIND_M + right.z * SET_RIGHT_M);
      desiredFocus.set(own.x + f.x * SET_LOOK_AHEAD_M, own.y - SET_LOOK_DOWN_M, own.z + f.z * SET_LOOK_AHEAD_M);
      desiredFov = SET_FOV_DEG;
    } else if (phase === 'release' || phase === 'flight') {
      const plan = seq.getFlightPlan(this.side);
      const mid = new THREE.Vector3(own.x, own.y, own.z).lerp(new THREE.Vector3(other.x, other.y, other.z), FLIGHT_MID_SHARE);
      const travel = plan ? new THREE.Vector3(plan.end.x - plan.start.x, 0, plan.end.z - plan.start.z).normalize() : new THREE.Vector3(f.x, 0, f.z);
      desiredEye.set(own.x - travel.x * FLIGHT_BEHIND_M + right.x * FLIGHT_RIGHT_M, own.y + FLIGHT_UP_M, own.z - travel.z * FLIGHT_BEHIND_M + right.z * FLIGHT_RIGHT_M);
      desiredFocus.set(mid.x, mid.y + 0.5, mid.z);
      const quality = seq.getResult()?.[this.side].quality ?? 0;
      desiredFov = FLIGHT_FOV_DEG + launchOutcomeFor(quality).power * FLIGHT_FOV_POWER_DEG;
      rate = FOLLOW_RATE_FLIGHT_PER_S;
      if (this.lastPhase !== 'release' && phase === 'release') this.shake = 0.14 + launchOutcomeFor(quality).power * 0.18; // the kick of the release
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
