// ============================================================
// DEBUG VISUALIZATION LAYERS (GDD sections 70, 71)
// Toggleable debug drawings over the live match: every rigid-body collider
// (Beys, floor, wall segments), attack hitboxes, the ring-out boundary,
// velocity / intended-steering / spin-axis / angular-velocity vectors,
// the last knockback and impact impulses, contact points and ground
// normals, the Dash lock-on vector and the AI's target path.
//
// Read-only (GDD section 160): drawings are rebuilt from the session's
// state every render frame and never feed back into the simulation.
// Colors are plain engineering debug colors, not a visual direction.
// ============================================================

import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { AIController } from '../../ai/controllers/AIController';
import type { MatchSession, Side } from '../../app/session/MatchSession';
import { RINGOUT_RADIUS_M } from '../../arena/ringout/RingOutTuning';
import { AttackState } from '../../combat/attacks/AttackController';
import { HITBOX_VERTICAL_REACH_M } from '../../combat/attacks/AttackTuning';
import { probeGround } from '../../physics/collision/GroundProbe';
import { FIXED_TICKS_PER_SECOND } from '../../physics/fixed-step/FixedTimestepLoop';

// ============================================================
// DEBUG VISUALIZATION — TUNING
// ============================================================

/** Arrow length per m/s of velocity. */
const VELOCITY_ARROW_M_PER_MPS = 0.25;
/** Arrow length per unit of knockback force. */
const KNOCKBACK_ARROW_M_PER_FORCE = 0.12;
/** Arrow length per m/s of impact Δv. */
const IMPACT_ARROW_M_PER_MPS = 0.35;
/** Arrow length per rad/s of angular velocity (spin rates are large; keep it short). */
const ANGULAR_ARROW_M_PER_RADPS = 0.08;
/** Fixed length of the spin-axis (local up) arrow, m. */
const SPIN_AXIS_ARROW_M = 1.6;
/** Fixed length of the intended-steering arrow, m. */
const STEERING_ARROW_M = 1.4;
/** How long a knockback / impact impulse arrow stays visible after it happened, in fixed ticks. */
const IMPULSE_VISIBLE_TICKS = Math.round(0.75 * FIXED_TICKS_PER_SECOND);
/** Height above the floor for flat markers (ring-out circle, hitbox rings), m. */
const FLAT_MARKER_Y_M = 0.04;

const COLORS = {
  collider: 0x39ff88,
  staticCollider: 0x2f8f60,
  ringOut: 0xff3355,
  hitboxCircular: 0xffb000,
  hitboxDash: 0xff4df0,
  velocity: 0x33c3ff,
  steering: 0xffffff,
  spinAxis: 0xffe14d,
  angularVelocity: 0xff8a33,
  knockback: 0xff2020,
  impact: 0xff66aa,
  contact: 0x00ffff,
  normal: 0x66ff66,
  lockOn: 0xff00aa,
  aiAim: 0xa0ff40,
  aiPrediction: 0x40a0ff,
} as const;

export type DebugLayerId =
  | 'colliders'
  | 'hitboxes'
  | 'ringOut'
  | 'velocity'
  | 'angular'
  | 'forces'
  | 'contacts'
  | 'lockOn'
  | 'targetPath';

export const DEBUG_LAYERS: readonly { id: DebugLayerId; label: string }[] = [
  { id: 'colliders', label: 'Colliders (Beys, floor, walls)' },
  { id: 'hitboxes', label: 'Attack hitboxes' },
  { id: 'ringOut', label: 'Ring-out boundary' },
  { id: 'velocity', label: 'Velocity + intended steering' },
  { id: 'angular', label: 'Spin axis + angular velocity' },
  { id: 'forces', label: 'Knockback + impact impulses' },
  { id: 'contacts', label: 'Contact points + ground normal' },
  { id: 'lockOn', label: 'Dash lock-on vector' },
  { id: 'targetPath', label: 'AI target path (aim / prediction)' },
];

interface ColliderDrawing {
  readonly collider: RAPIER.Collider;
  readonly object: THREE.Object3D;
  readonly isStatic: boolean;
}

interface SideDrawings {
  readonly velocity: THREE.ArrowHelper;
  readonly steering: THREE.ArrowHelper;
  readonly spinAxis: THREE.ArrowHelper;
  readonly angular: THREE.ArrowHelper;
  readonly knockback: THREE.ArrowHelper;
  readonly impact: THREE.ArrowHelper;
  readonly normal: THREE.ArrowHelper;
  readonly contacts: THREE.Points;
  readonly hitbox: THREE.Group;
  readonly hitboxRing: THREE.LineLoop;
  readonly hitboxCylinder: THREE.LineSegments;
  readonly lockOn: THREE.Line;
  readonly aimLine: THREE.Line;
  readonly predictionLine: THREE.Line;
  readonly predictionMarker: THREE.Mesh;
}

const UP = new THREE.Vector3(0, 1, 0);

export class DebugVisualLayers {
  private readonly root = new THREE.Group();
  private readonly layerGroups = new Map<DebugLayerId, THREE.Group>();
  private readonly enabled = new Set<DebugLayerId>();
  private readonly colliderDrawings: ColliderDrawing[] = [];
  private readonly sides: Record<Side, SideDrawings>;
  private lastImpactTick: Record<Side, number> = { first: -Infinity, second: -Infinity };
  private lastImpact: Record<Side, { direction: THREE.Vector3; deltaMps: number }> = {
    first: { direction: new THREE.Vector3(), deltaMps: 0 },
    second: { direction: new THREE.Vector3(), deltaMps: 0 },
  };

  constructor(private readonly session: MatchSession, initiallyEnabled: Iterable<DebugLayerId> = []) {
    this.root.name = 'debug-visual-layers';
    this.root.renderOrder = 10;
    for (const layer of DEBUG_LAYERS) {
      const group = new THREE.Group();
      group.name = `debug-layer-${layer.id}`;
      group.visible = false;
      this.layerGroups.set(layer.id, group);
      this.root.add(group);
    }
    this.buildColliderDrawings();
    this.buildRingOut();
    this.sides = { first: this.buildSide(), second: this.buildSide() };
    session.getSceneRoot().add(this.root);
    for (const id of initiallyEnabled) this.setEnabled(id, true);
  }

  isEnabled(id: DebugLayerId): boolean {
    return this.enabled.has(id);
  }

  getEnabled(): DebugLayerId[] {
    return DEBUG_LAYERS.map((l) => l.id).filter((id) => this.enabled.has(id));
  }

  setEnabled(id: DebugLayerId, on: boolean): void {
    if (on) this.enabled.add(id);
    else this.enabled.delete(id);
    this.group(id).visible = on;
  }

  /** Visible leaf objects in a layer — for tests and the panel. */
  countVisibleObjects(id: DebugLayerId): number {
    const group = this.group(id);
    let count = 0;
    group.traverseVisible((object) => {
      if (object !== group && object.children.length === 0) count++;
    });
    return count;
  }

  /** Refreshes every enabled layer from the session. Call once per rendered frame. */
  update(): void {
    // Impact arrows keep their last direction for a short while; capture a
    // fresh impact on the tick it happened.
    const result = this.session.getLastResult();
    if (result) {
      for (const side of ['first', 'second'] as const) {
        const movement = result[side].movement;
        if (movement.impactDeltaSpeedMps > 0) {
          this.lastImpactTick[side] = this.session.getTickIndex() - 1;
          this.lastImpact[side] = {
            direction: new THREE.Vector3(movement.impactDirection.x, 0, movement.impactDirection.z),
            deltaMps: movement.impactDeltaSpeedMps,
          };
        }
      }
    }
    if (this.enabled.has('colliders')) this.updateColliders();
    for (const side of ['first', 'second'] as const) this.updateSide(side);
  }

  dispose(): void {
    this.root.removeFromParent();
    this.root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      mesh.geometry?.dispose();
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else material?.dispose();
    });
  }

  private group(id: DebugLayerId): THREE.Group {
    return this.layerGroups.get(id)!;
  }

  private buildColliderDrawings(): void {
    const world = this.session.physics.rapierWorld;
    const beyColliders = new Set([this.session.getBey('first').collider.handle, this.session.getBey('second').collider.handle]);
    world.forEachCollider((collider) => {
      const isStatic = !beyColliders.has(collider.handle);
      const object = wireframeForCollider(collider, isStatic ? COLORS.staticCollider : COLORS.collider);
      if (!object) return;
      this.group('colliders').add(object);
      this.colliderDrawings.push({ collider, object, isStatic });
      syncToCollider(object, collider);
    });
  }

  private buildRingOut(): void {
    const circle = flatCircle(RINGOUT_RADIUS_M, COLORS.ringOut, 128);
    circle.position.y = FLAT_MARKER_Y_M;
    this.group('ringOut').add(circle);
  }

  private buildSide(): SideDrawings {
    const arrow = (color: number): THREE.ArrowHelper => new THREE.ArrowHelper(UP.clone(), new THREE.Vector3(), 1, color, 0.25, 0.15);
    const drawings: SideDrawings = {
      velocity: arrow(COLORS.velocity),
      steering: arrow(COLORS.steering),
      spinAxis: arrow(COLORS.spinAxis),
      angular: arrow(COLORS.angularVelocity),
      knockback: arrow(COLORS.knockback),
      impact: arrow(COLORS.impact),
      normal: arrow(COLORS.normal),
      contacts: new THREE.Points(
        new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(8 * 3), 3)),
        new THREE.PointsMaterial({ color: COLORS.contact, size: 0.18, depthTest: false }),
      ),
      hitbox: new THREE.Group(),
      hitboxRing: flatCircle(1, COLORS.hitboxCircular, 64),
      hitboxCylinder: new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.CylinderGeometry(1, 1, 1, 24, 1, true)),
        new THREE.LineBasicMaterial({ color: COLORS.hitboxCircular, transparent: true, opacity: 0.5 }),
      ),
      lockOn: line(COLORS.lockOn),
      aimLine: line(COLORS.aiAim),
      predictionLine: line(COLORS.aiPrediction),
      predictionMarker: new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), new THREE.MeshBasicMaterial({ color: COLORS.aiPrediction, wireframe: true })),
    };
    drawings.hitbox.add(drawings.hitboxRing, drawings.hitboxCylinder);
    this.group('velocity').add(drawings.velocity, drawings.steering);
    this.group('angular').add(drawings.spinAxis, drawings.angular);
    this.group('forces').add(drawings.knockback, drawings.impact);
    this.group('contacts').add(drawings.contacts, drawings.normal);
    this.group('hitboxes').add(drawings.hitbox);
    this.group('lockOn').add(drawings.lockOn);
    this.group('targetPath').add(drawings.aimLine, drawings.predictionLine, drawings.predictionMarker);
    return drawings;
  }

  private updateColliders(): void {
    for (const drawing of this.colliderDrawings) {
      if (!drawing.isStatic) syncToCollider(drawing.object, drawing.collider);
    }
  }

  private updateSide(side: Side): void {
    const session = this.session;
    const bey = session.getBey(side);
    const opponent = session.getBey(side === 'first' ? 'second' : 'first');
    const d = this.sides[side];
    const t = bey.body.translation();
    const origin = new THREE.Vector3(t.x, t.y, t.z);
    const tick = session.getTickIndex();

    if (this.enabled.has('velocity')) {
      const v = bey.body.linvel();
      setArrow(d.velocity, origin, new THREE.Vector3(v.x, v.y, v.z), VELOCITY_ARROW_M_PER_MPS);
      const steering = session.getLastResult()?.[side].movement.intendedSteeringVector;
      if (steering) setArrow(d.steering, origin, new THREE.Vector3(steering.x, 0, steering.z), STEERING_ARROW_M, true);
      else d.steering.visible = false;
    }

    if (this.enabled.has('angular')) {
      const q = bey.body.rotation();
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w));
      setArrow(d.spinAxis, origin, up, SPIN_AXIS_ARROW_M, true);
      const w = bey.body.angvel();
      setArrow(d.angular, origin, new THREE.Vector3(w.x, w.y, w.z), ANGULAR_ARROW_M_PER_RADPS);
    }

    if (this.enabled.has('forces')) {
      const knockback = session.getLastKnockback(side);
      if (knockback?.directionXZ && tick - knockback.tickIndex <= IMPULSE_VISIBLE_TICKS) {
        setArrow(d.knockback, origin, new THREE.Vector3(knockback.directionXZ.x, 0, knockback.directionXZ.z), knockback.force * KNOCKBACK_ARROW_M_PER_FORCE, true);
      } else {
        d.knockback.visible = false;
      }
      if (tick - this.lastImpactTick[side] <= IMPULSE_VISIBLE_TICKS && this.lastImpact[side].deltaMps > 0) {
        setArrow(d.impact, origin, this.lastImpact[side].direction, this.lastImpact[side].deltaMps * IMPACT_ARROW_M_PER_MPS, true);
      } else {
        d.impact.visible = false;
      }
    }

    if (this.enabled.has('contacts')) {
      const probe = probeGround(session.physics, bey.collider);
      const positions = d.contacts.geometry.getAttribute('position') as THREE.BufferAttribute;
      probe.contactPointsWorld.forEach((p, i) => positions.setXYZ(i, p.x, p.y, p.z));
      positions.needsUpdate = true;
      d.contacts.geometry.setDrawRange(0, probe.contactPointsWorld.length);
      d.contacts.visible = probe.contactPointsWorld.length > 0;
      if (probe.groundNormal) {
        const base = new THREE.Vector3(t.x, t.y - bey.definition.physical.colliderHalfHeightM, t.z);
        setArrow(d.normal, base, new THREE.Vector3(probe.groundNormal.x, probe.groundNormal.y, probe.groundNormal.z), 1, true);
      } else {
        d.normal.visible = false;
      }
    }

    if (this.enabled.has('hitboxes')) {
      const hitbox = bey.attack.getDebugState().activeHitbox;
      d.hitbox.visible = hitbox !== null;
      if (hitbox) {
        const color = hitbox.kind === 'dash' ? COLORS.hitboxDash : COLORS.hitboxCircular;
        (d.hitboxRing.material as THREE.LineBasicMaterial).color.setHex(color);
        (d.hitboxCylinder.material as THREE.LineBasicMaterial).color.setHex(color);
        d.hitbox.position.set(t.x, t.y, t.z);
        d.hitboxRing.scale.set(hitbox.radiusM, 1, hitbox.radiusM);
        d.hitboxRing.position.y = 0;
        d.hitboxCylinder.scale.set(hitbox.radiusM, HITBOX_VERTICAL_REACH_M * 2, hitbox.radiusM);
      }
    }

    if (this.enabled.has('lockOn')) {
      const state = bey.attack.getState();
      const locking = state === AttackState.ChargingDash || state === AttackState.DashActive;
      d.lockOn.visible = locking;
      if (locking) {
        const o = opponent.body.translation();
        setLine(d.lockOn, origin, new THREE.Vector3(o.x, o.y, o.z));
      }
    }

    if (this.enabled.has('targetPath')) {
      const controller = session.getController(side);
      const ai = controller instanceof AIController ? controller.getDebugState() : null;
      d.aimLine.visible = ai !== null;
      d.predictionLine.visible = ai?.predictedOpponentXZ != null;
      d.predictionMarker.visible = ai?.predictedOpponentXZ != null;
      if (ai) {
        setLine(d.aimLine, origin, new THREE.Vector3(ai.aimPositionXZ.x, t.y, ai.aimPositionXZ.z));
        if (ai.predictedOpponentXZ) {
          const observed = new THREE.Vector3(ai.observedOpponentXZ.x, t.y, ai.observedOpponentXZ.z);
          const predicted = new THREE.Vector3(ai.predictedOpponentXZ.x, t.y, ai.predictedOpponentXZ.z);
          setLine(d.predictionLine, observed, predicted);
          d.predictionMarker.position.copy(predicted);
        }
      }
    }
  }
}

/** Every this-many-th row/column of a heightfield is drawn: a coarse grid (the 288-cell bowl floor would be unreadable at full density). */
const HEIGHTFIELD_DRAW_STRIDE = 12;

/**
 * A heightfield (the bowl floor, the default since the arena scale pass) as a
 * coarse grid of lines on its real heights. The default floor is radially
 * symmetric, so the grid's row/column order does not matter here.
 */
function heightfieldWireframe(shape: { heights: ArrayLike<number>; scale: { x: number; y: number; z: number }; nrows: number; ncols: number }, color: number): THREE.Object3D {
  const { heights, scale, nrows, ncols } = shape;
  const at = (i: number, j: number): THREE.Vector3 => new THREE.Vector3((i / nrows - 0.5) * scale.x, heights[i * (ncols + 1) + j]! * scale.y, (j / ncols - 0.5) * scale.z);
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= nrows; i += HEIGHTFIELD_DRAW_STRIDE) {
    for (let j = 0; j < ncols; j++) points.push(at(i, j), at(i, j + 1));
  }
  for (let j = 0; j <= ncols; j += HEIGHTFIELD_DRAW_STRIDE) {
    for (let i = 0; i < nrows; i++) points.push(at(i, j), at(i + 1, j));
  }
  return new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color }));
}

function wireframeForCollider(collider: RAPIER.Collider, color: number): THREE.Object3D | null {
  if (collider.shape.type === RAPIER.ShapeType.HeightField) {
    return heightfieldWireframe(collider.shape as unknown as Parameters<typeof heightfieldWireframe>[0], color);
  }
  const shape = collider.shape as unknown as { halfExtents?: { x: number; y: number; z: number }; radius?: number; halfHeight?: number };
  let geometry: THREE.BufferGeometry;
  if (shape.halfExtents) {
    geometry = new THREE.BoxGeometry(shape.halfExtents.x * 2, shape.halfExtents.y * 2, shape.halfExtents.z * 2);
  } else if (shape.radius !== undefined && shape.halfHeight !== undefined) {
    geometry = new THREE.CylinderGeometry(shape.radius, shape.radius, shape.halfHeight * 2, 32, 1);
  } else if (shape.radius !== undefined) {
    geometry = new THREE.SphereGeometry(shape.radius, 16, 12);
  } else {
    return null;
  }
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color }));
  geometry.dispose();
  return edges;
}

function syncToCollider(object: THREE.Object3D, collider: RAPIER.Collider): void {
  const t = collider.translation();
  const q = collider.rotation();
  object.position.set(t.x, t.y, t.z);
  object.quaternion.set(q.x, q.y, q.z, q.w);
}

function flatCircle(radius: number, color: number, segments: number): THREE.LineLoop {
  const points: THREE.Vector3[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    points.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
  }
  return new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color }));
}

function line(color: number): THREE.Line {
  const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0.001, 0)]);
  return new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, depthTest: false }));
}

function setLine(object: THREE.Line, from: THREE.Vector3, to: THREE.Vector3): void {
  const positions = object.geometry.getAttribute('position') as THREE.BufferAttribute;
  positions.setXYZ(0, from.x, from.y, from.z);
  positions.setXYZ(1, to.x, to.y, to.z);
  positions.needsUpdate = true;
  object.geometry.computeBoundingSphere();
}

/** Points `arrow` along `vector`; length = |vector| × scale, or a fixed `scale` when `fixedLength`. Hidden for a ~zero vector. */
function setArrow(arrow: THREE.ArrowHelper, origin: THREE.Vector3, vector: THREE.Vector3, scale: number, fixedLength = false): void {
  const magnitude = vector.length();
  if (!(magnitude > 1e-4) || !Number.isFinite(magnitude)) {
    arrow.visible = false;
    return;
  }
  arrow.visible = true;
  arrow.position.copy(origin);
  arrow.setDirection(vector.clone().divideScalar(magnitude));
  const length = Math.max(0.05, fixedLength ? scale : magnitude * scale);
  arrow.setLength(length, Math.min(0.3, length * 0.3), Math.min(0.18, length * 0.2));
}
