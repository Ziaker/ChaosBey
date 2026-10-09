// ============================================================
// LAUNCH RIG — the physical launchers and the guides of the Launch System A (presentation only)
// Owner-approved (docs/design-decisions/launch-system-approval.md §3): "both Beys are visibly attached to physical 3D
// launchers; launcher body, socket/attachment and release motion must read as the source of the launch; the launcher may
// recoil/open as demonstrated in the approved prototype." The launcher is the prototype's (LS_Launcher: a base, a handle,
// a head with an accent rail, a socket with two clamps that open on release, a spool and a ripcord that the timing marker
// pulls), on the match's real floor, turned toward the entry point. Beside it: the ground target the player chooses, the
// dashed arc of the flight, the wind rings of the release and a trail behind each Bey in the air.
//
// Everything here is drawn from the sequence's state; nothing reads or writes the simulation.
// ============================================================

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { floorHeightAt } from '../arena/floor/ArenaFloorProfile';
import { arcPoints, launcherBase, launcherYaw, type FlightPlan, type LaunchArena } from '../launch/LaunchGeometry';
import type { LaunchSequence, LaunchView } from '../launch/LaunchSequence';
import { LAUNCH_SIDES, type LaunchSide } from '../launch/LaunchTuning';

const TARGET_COLOR_HEX = 0x6fd3ff;
const TARGET_RING_INNER = 1.35;
const TARGET_RING_OUTER = 1.55;
const TARGET_CROSS_HALF = 2.1;
const GUIDE_ARC_M = 6.2;
const TRAIL_POINTS = 34;
const WIND_RINGS = 3;
const WIND_LIFE_S = 0.62;

const smooth = (rate: number, dt: number): number => 1 - Math.exp(-rate * dt);

/** One launcher, as in the approved prototype. */
export class LauncherModel {
  readonly group = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly accent: THREE.MeshStandardMaterial;
  private readonly dark = new THREE.MeshStandardMaterial({ color: 0x171d26, metalness: 0.86, roughness: 0.3 });
  private readonly metal = new THREE.MeshStandardMaterial({ color: 0x536071, metalness: 0.92, roughness: 0.22 });
  private readonly clampL: THREE.Mesh;
  private readonly clampR: THREE.Mesh;
  private readonly ripcord = new THREE.Group();
  private open = 0;
  private recoil = 0;
  private pull = 0;

  constructor(readonly side: LaunchSide, accent: THREE.ColorRepresentation) {
    this.group.name = `launch-rig:${side}`;
    this.accent = new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 1.25, metalness: 0.48, roughness: 0.28 });
    this.group.add(this.body);
    const box = (w: number, h: number, d: number, segments: number, radius: number, material: THREE.Material): THREE.Mesh => new THREE.Mesh(new RoundedBoxGeometry(w, h, d, segments, radius), material);
    const base = box(5.3, 0.62, 3.5, 4, 0.15, this.dark);
    base.position.set(0, 0.34, 0.55);
    const handle = box(1.2, 3.6, 1.05, 4, 0.18, this.dark);
    handle.position.set(0, 1.85, 1.55);
    handle.rotation.x = -0.08;
    const head = box(3.7, 0.74, 2.6, 4, 0.18, this.metal);
    head.position.set(0, 3.12, -0.52);
    const accentRail = box(3.35, 0.12, 2.08, 3, 0.05, this.accent);
    accentRail.position.set(0, 3.49, -0.55);
    const socket = new THREE.Group();
    socket.position.set(0, 3.7, -1.18);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.18, 0.11, 10, 48), this.accent);
    ring.rotation.x = Math.PI / 2;
    socket.add(ring);
    this.clampL = box(0.32, 0.42, 1.48, 3, 0.08, this.metal);
    this.clampR = this.clampL.clone();
    this.clampL.position.set(-1.08, 0.02, 0.05);
    this.clampR.position.set(1.08, 0.02, 0.05);
    socket.add(this.clampL, this.clampR);
    const spool = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.48, 0.52, 20), this.accent);
    spool.rotation.z = Math.PI / 2;
    spool.position.set(0, 2.86, 0.52);
    const cord = box(4.0, 0.12, 0.18, 2, 0.03, this.metal);
    cord.position.x = 2.05;
    const grip = box(0.62, 1.05, 0.52, 4, 0.12, this.dark);
    grip.position.set(4.16, 0, 0);
    const gripAccent = box(0.18, 0.76, 0.58, 3, 0.05, this.accent);
    gripAccent.position.set(4.18, 0, 0);
    this.ripcord.add(cord, grip, gripAccent);
    this.ripcord.position.set(0, 2.86, 0.52);
    this.body.add(base, handle, head, accentRail, spool, this.ripcord, socket);
    this.group.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.castShadow = true;
        node.receiveShadow = true;
      }
    });
  }

  setAccent(color: THREE.ColorRepresentation): void {
    this.accent.color.set(color);
    this.accent.emissive.set(color);
  }

  /** The release: the clamps open and the body kicks back. */
  fire(): void {
    this.recoil = 1;
  }

  /** `armedPull` is the marker (0..1) while a person is timing (it tugs the cord a little), 0 otherwise. */
  update(dt: number, released: boolean, armedPull: number): void {
    this.open += ((released ? 1 : 0) - this.open) * smooth(17, dt);
    this.clampL.rotation.z = -this.open * 0.72;
    this.clampR.rotation.z = this.open * 0.72;
    this.pull += (armedPull * 0.18 - this.pull) * smooth(14, dt);
    this.ripcord.position.x = this.pull * 3.15;
    this.recoil *= Math.exp(-dt * 9.5);
    this.body.position.z = this.recoil * 0.55;
    this.body.rotation.x = -this.recoil * 0.045;
    this.accent.emissiveIntensity = released ? 0.55 : 1.15 + this.pull * 1.1;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.group.traverse((node) => {
      if (node instanceof THREE.Mesh) node.geometry.dispose();
    });
    this.accent.dispose();
    this.dark.dispose();
    this.metal.dispose();
  }
}

interface WindRing {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.MeshBasicMaterial;
  age: number;
  readonly speed: number;
}

interface Trail {
  readonly side: LaunchSide;
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.LineBasicMaterial;
  readonly line: THREE.Line;
  readonly points: THREE.Vector3[];
}

export class LaunchRig {
  readonly root = new THREE.Group();
  private readonly launchers: Record<LaunchSide, LauncherModel>;
  private readonly targetMarker = new THREE.Group();
  private readonly targetRingMaterial: THREE.MeshBasicMaterial;
  private readonly targetCrossMaterial: THREE.LineBasicMaterial;
  private readonly arc: THREE.Line;
  private readonly arcMaterial: THREE.LineDashedMaterial;
  private readonly rings: WindRing[] = [];
  private readonly trails: Trail[] = [];
  private time = 0;
  private released = false;
  private readonly accents: Record<LaunchSide, THREE.Color>;

  constructor(parent: THREE.Object3D, private readonly arena: LaunchArena, accents: Record<LaunchSide, THREE.ColorRepresentation>) {
    this.root.name = 'launch-rig';
    this.accents = { first: new THREE.Color(accents.first), second: new THREE.Color(accents.second) };
    this.launchers = { first: new LauncherModel('first', accents.first), second: new LauncherModel('second', accents.second) };
    this.root.add(this.launchers.first.group, this.launchers.second.group);

    this.targetRingMaterial = new THREE.MeshBasicMaterial({ color: TARGET_COLOR_HEX, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.RingGeometry(TARGET_RING_INNER, TARGET_RING_OUTER, 56), this.targetRingMaterial);
    ring.rotation.x = -Math.PI / 2;
    this.targetCrossMaterial = new THREE.LineBasicMaterial({ color: TARGET_COLOR_HEX, transparent: true, opacity: 0.72, depthWrite: false });
    const cross = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-TARGET_CROSS_HALF, 0, 0), new THREE.Vector3(TARGET_CROSS_HALF, 0, 0), new THREE.Vector3(0, 0, -TARGET_CROSS_HALF), new THREE.Vector3(0, 0, TARGET_CROSS_HALF)]),
      this.targetCrossMaterial,
    );
    this.targetMarker.add(ring, cross);
    this.arcMaterial = new THREE.LineDashedMaterial({ color: TARGET_COLOR_HEX, transparent: true, opacity: 0.46, dashSize: 0.75, gapSize: 0.55, depthWrite: false });
    this.arc = new THREE.Line(new THREE.BufferGeometry(), this.arcMaterial);
    this.arc.frustumCulled = false;
    this.root.add(this.targetMarker, this.arc);
    parent.add(this.root);
  }

  /** Where the flight started and ended, for the wind rings and the trails: call once, on the release. */
  onRelease(sequence: LaunchSequence): void {
    this.released = true;
    for (const side of LAUNCH_SIDES) {
      const plan = sequence.getFlightPlan(side);
      if (!plan) continue;
      this.launchers[side].fire();
      this.spawnWind(plan, side);
      this.startTrail(side);
    }
  }

  private spawnWind(plan: FlightPlan, side: LaunchSide): void {
    const strength = side === 'first' ? 1.2 : 1.15;
    for (let i = 0; i < WIND_RINGS; i++) {
      const material = new THREE.MeshBasicMaterial({ color: this.accents[side], transparent: true, opacity: 0.52 / (i + 1), blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(new THREE.RingGeometry(0.7 + i * 0.28, 0.84 + i * 0.34, 64), material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(plan.start.x, plan.start.y - 2.55, plan.start.z);
      this.root.add(mesh);
      this.rings.push({ mesh, material, age: -i * 0.045, speed: 7.5 * strength * (1 + i * 0.12) });
    }
  }

  private startTrail(side: LaunchSide): void {
    const geometry = new THREE.BufferGeometry();
    const material = new THREE.LineBasicMaterial({ color: this.accents[side], transparent: true, opacity: 0.72, blending: THREE.AdditiveBlending, depthWrite: false });
    const line = new THREE.Line(geometry, material);
    line.frustumCulled = false;
    this.root.add(line);
    this.trails.push({ side, geometry, material, line, points: [] });
  }

  /** Once per frame: launcher turn and clamps, the target and the arc, the rings and the trails. */
  update(dt: number, view: LaunchView, sequence: LaunchSequence, people: readonly LaunchSide[]): void {
    this.time += dt;
    const beforeRelease = view.phase === 'mounted' || view.phase === 'armed';
    for (const side of LAUNCH_SIDES) {
      const launcher = this.launchers[side];
      const base = launcherBase(side, this.arena);
      launcher.group.position.set(base.x, base.y, base.z);
      launcher.group.rotation.y = launcherYaw(side, this.arena, view.targets[side]);
      launcher.update(dt, !beforeRelease, view.phase === 'armed' && people.includes(side) ? view.marker : 0);
    }

    // The ground target and the dashed arc: the first person's, before the release.
    const side = people[0];
    const showGuide = beforeRelease && side !== undefined;
    this.targetMarker.visible = showGuide;
    this.arc.visible = showGuide;
    if (showGuide) {
      const t = view.targets[side];
      const y = floorHeightAt(this.arena.floor, t.x, t.z) + 0.07;
      this.targetMarker.position.set(t.x, y, t.z);
      this.targetMarker.scale.setScalar(1 + Math.sin(this.time * 4.5) * 0.07);
      const start = sequence.getPose(side).position;
      const points = arcPoints(start, { x: t.x, y: y + 0.11, z: t.z }, GUIDE_ARC_M).map((p) => new THREE.Vector3(p.x, p.y, p.z));
      this.arc.geometry.setFromPoints(points);
      this.arc.computeLineDistances();
    }

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]!;
      r.age += dt;
      if (r.age < 0) {
        r.mesh.visible = false;
        continue;
      }
      r.mesh.visible = true;
      const f = Math.min(1, r.age / WIND_LIFE_S);
      r.mesh.scale.setScalar(1 + r.age * r.speed);
      r.material.opacity = (1 - f) * 0.5;
      if (f >= 1) {
        r.mesh.removeFromParent();
        r.mesh.geometry.dispose();
        r.material.dispose();
        this.rings.splice(i, 1);
      }
    }

    const inAir = (s: LaunchSide): boolean => sequence.getPose(s).state === 'flying';
    for (let i = this.trails.length - 1; i >= 0; i--) {
      const trail = this.trails[i]!;
      if (inAir(trail.side)) {
        const p = sequence.getPose(trail.side).position;
        trail.points.push(new THREE.Vector3(p.x, p.y, p.z));
        if (trail.points.length > TRAIL_POINTS) trail.points.shift();
        if (trail.points.length > 1) trail.geometry.setFromPoints(trail.points);
      } else if (this.released) {
        trail.material.opacity *= Math.exp(-dt * 4.5);
        if (trail.material.opacity < 0.02) {
          trail.line.removeFromParent();
          trail.geometry.dispose();
          trail.material.dispose();
          this.trails.splice(i, 1);
        }
      }
    }
  }

  /** After the fight has begun the launchers sink away: 0 = standing, 1 = gone (each shrinks about its own foot). */
  retract(amount: number): void {
    const k = Math.max(0, Math.min(1, amount));
    const scale = Math.max(0.001, 1 - k * k * (3 - 2 * k));
    for (const side of LAUNCH_SIDES) this.launchers[side].group.scale.setScalar(scale);
  }

  dispose(): void {
    for (const side of LAUNCH_SIDES) this.launchers[side].dispose();
    for (const r of this.rings) {
      r.mesh.geometry.dispose();
      r.material.dispose();
    }
    for (const t of this.trails) {
      t.geometry.dispose();
      t.material.dispose();
    }
    this.rings.length = 0;
    this.trails.length = 0;
    this.targetMarker.traverse((node) => {
      if (node instanceof THREE.Mesh || node instanceof THREE.LineSegments) node.geometry.dispose();
    });
    this.targetRingMaterial.dispose();
    this.targetCrossMaterial.dispose();
    this.arc.geometry.dispose();
    this.arcMaterial.dispose();
    this.root.removeFromParent();
  }
}
