// ============================================================
// CLASH PRESENTATION LAB — PHYSICAL STAGE
// Owns the real Rapier physics, the real arena colliders and the real
// Bey bodies (same construction the Camera Lab uses for its fights), plus
// the ClashHarness state machine. This is the ONLY place that touches
// physics: it positions the two Beys for the presentation-only Approach
// beat (no physics.step() while they converge — direct position
// authorship, clearly not real movement), holds them still during Active
// (mirroring tickMatch()'s own "no physics step while a Clash is Active"
// rule), and applies the SAME physical-consequence functions the real
// ClashOrchestration uses (computeKnockback/applyKnockback for a win, the
// symmetric repulsion formula for a Tie) the instant the real
// ClashController resolves — never a bespoke lab-only physics answer, and
// never a declared ring-out: isRingOut() only ever OBSERVES where physics
// carried the loser.
// ============================================================

import * as THREE from 'three';
import { ClashOutcome } from '../../../../src/combat/clash/ClashController';
import { CLASH_TIE_REPULSION_BASE_FORCE } from '../../../../src/combat/clash/ClashTuning';
import { applyKnockback, computeKnockback } from '../../../../src/combat/knockback/Knockback';
import { KNOCKBACK_IMPULSE_PER_FORCE_UNIT, KNOCKBACK_UPWARD_LAUNCH_FRACTION } from '../../../../src/combat/knockback/KnockbackTuning';
import { createArenaColliders } from '../../../../src/arena/colliders/createArenaColliders';
import { isRingOut } from '../../../../src/arena/ringout/RingOut';
import { CLASH_RESOLVED_MAGNITUDE } from '../../../../src/camera/ImpactMagnitude';
import { ATTACK_ARCHETYPE, DEFENSE_ARCHETYPE } from '../../../../src/bey/archetype/BeyArchetypes';
import { createBey, type Bey } from '../../../../src/bey/core/Bey';
import { BEY_SPAWN_HEIGHT_M } from '../../../../src/bey/core/BeyTuning';
import { isGrounded } from '../../../../src/physics/collision/GroundCheck';
import { normalize, scale, subtract, type Vec2 } from '../../../../src/physics/Vec2';
import { PhysicsWorld } from '../../../../src/physics/world/PhysicsWorld';
import type { CameraIntent, FightFrame, FighterFrame, Vec3 } from '../../../camera-concepts/src/fight/FightFrame';
import { ATTACK_A, DEFENSE_A } from '../../../bey-visual-concepts/src/concepts/conceptDefinitions';
import type { ConceptDefinition } from '../../../bey-visual-concepts/src/model/types';
import { ClashHarness, type ClashTickEvents } from '../harness/ClashHarness';
import type { ClashScenario } from '../harness/scenarios';
import { createDetailedBeyVisual, type DetailedBeyVisual } from './DetailedBeyVisual';

/** Presentation harness: this lab has no Stability system of its own, so the loser's Stability fraction is treated as full (1 = no reduction) for the physical knockback formula, same as CIRCULAR_BASE_KNOCKBACK_FORCE-class hits against an undamaged Bey. */
const ASSUMED_DEFENDER_STABILITY_FRACTION = 1;
/** Where the two Beys are dropped (±x, m) to measure their resting height before the scenario starts. */
const SETTLE_X_M = 5;
/** Physics steps (1/60s) for that drop to settle. */
const SETTLE_STEPS = 90;

export interface RingOutInfo {
  isFirst: boolean;
  atS: number;
}

export interface ClashResolutionInfo {
  outcome: ClashOutcome;
  loserIsFirst: boolean | null;
  firstClashPower: number;
  secondClashPower: number;
  firstMashEventCount: number;
  secondMashEventCount: number;
}

export interface ClashStageTickResult {
  events: ClashTickEvents;
  fightFrame: FightFrame;
  resolution: ClashResolutionInfo | null;
  ringOut: RingOutInfo | null;
}

function vecOf(p: { x: number; y: number; z: number }): Vec3 {
  return { x: p.x, y: p.y, z: p.z };
}

export class ClashStageSim {
  readonly harness = new ClashHarness();
  readonly visuals = new THREE.Group();
  firstVisual: DetailedBeyVisual;
  secondVisual: DetailedBeyVisual;

  private physicsRunning = false;
  private simTimeS = 0;
  private approachFrom: [THREE.Vector3, THREE.Vector3];
  private approachTo: [THREE.Vector3, THREE.Vector3];
  private ringOutInfo: RingOutInfo | null = null;
  private lastFrame: FightFrame;
  /** Body-origin height (m) at which each Bey actually rests on the floor, measured once in create() (the Attack and Defense colliders differ). */
  private readonly restY: readonly [number, number];

  private constructor(
    readonly scenario: ClashScenario,
    private readonly physics: PhysicsWorld,
    private readonly first: Bey,
    private readonly second: Bey,
    firstConcept: ConceptDefinition,
    secondConcept: ConceptDefinition,
    restY: readonly [number, number],
  ) {
    this.restY = restY;
    this.firstVisual = createDetailedBeyVisual(firstConcept, restY[0]);
    this.secondVisual = createDetailedBeyVisual(secondConcept, restY[1]);
    this.visuals.add(this.firstVisual.group, this.secondVisual.group);

    const axisAngle = scenario.arena === 'rift' ? Math.PI * 0.15 : 0; // A little visual variety in which direction the clash axis faces per arena, purely cosmetic.
    const dir = new THREE.Vector3(Math.cos(axisAngle), 0, Math.sin(axisAngle));
    const toPoint = (r: number): THREE.Vector3 => dir.clone().multiplyScalar(r).setY(BEY_SPAWN_HEIGHT_M);
    this.approachTo = [toPoint(scenario.first.clashRadiusM), toPoint(scenario.second.clashRadiusM)];
    const spreadDir = new THREE.Vector3(-dir.z, 0, dir.x); // perpendicular to the clash axis, so Approach reads as a converging "entrada" rather than sliding along the same line.
    this.approachFrom = [
      this.approachTo[0].clone().addScaledVector(spreadDir, -scenario.approachSpreadM * 0.5),
      this.approachTo[1].clone().addScaledVector(spreadDir, scenario.approachSpreadM * 0.5),
    ];
    this.placeBeys(this.approachFrom);
    this.lastFrame = this.describe([]);
  }

  static async create(scenario: ClashScenario, firstConcept: ConceptDefinition = ATTACK_A, secondConcept: ConceptDefinition = DEFENSE_A): Promise<ClashStageSim> {
    const physics = await PhysicsWorld.create();
    // Physics colliders only: the game's own placeholder arena mesh this also builds is discarded (this lab shows the approved arena-visual-concepts art in the browser-only view layer instead — see stage/ClashStageView.ts).
    createArenaColliders(new THREE.Scene(), physics);
    const first = createBey(physics, { x: -SETTLE_X_M, y: BEY_SPAWN_HEIGHT_M, z: 0 }, ATTACK_ARCHETYPE);
    const second = createBey(physics, { x: SETTLE_X_M, y: BEY_SPAWN_HEIGHT_M, z: 0 }, DEFENSE_ARCHETYPE);
    // Let both bodies drop onto the floor once, far apart, and record where they come to rest. The
    // Approach/Active beats author positions directly (no physics step), so without this the Beys
    // would hover at the 0.6m spawn height for the whole Clash and then drop at resolution.
    for (let i = 0; i < SETTLE_STEPS; i++) physics.step();
    const restY: [number, number] = [first.body.translation().y, second.body.translation().y];
    for (const bey of [first, second]) {
      bey.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      bey.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      bey.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    }
    return new ClashStageSim(scenario, physics, first, second, firstConcept, secondConcept, restY);
  }

  /**
   * Swaps which of the 9 approved concepts (visual-prototypes-approval.md
   * §1) each side renders — purely cosmetic, no physics/collider/stat
   * change. Which 3 of the 9 (one per archetype) ship is still an open
   * decision; this lets the owner review the Clash presentation itself
   * with any of them, and picking one here is not that decision.
   */
  setConcepts(firstConcept: ConceptDefinition, secondConcept: ConceptDefinition): void {
    this.visuals.remove(this.firstVisual.group, this.secondVisual.group);
    this.firstVisual.dispose();
    this.secondVisual.dispose();
    this.firstVisual = createDetailedBeyVisual(firstConcept, this.restY[0]);
    this.secondVisual = createDetailedBeyVisual(secondConcept, this.restY[1]);
    this.visuals.add(this.firstVisual.group, this.secondVisual.group);
    this.syncVisuals();
  }

  beginApproach(): void {
    this.harness.beginApproach({
      firstStaminaFraction: this.scenario.first.staminaFraction,
      secondStaminaFraction: this.scenario.second.staminaFraction,
      firstSpeedMps: this.scenario.first.speedMps,
      secondSpeedMps: this.scenario.second.speedMps,
      connectDeltaS: this.scenario.connectDeltaS,
    });
  }

  private placeBeys(at: readonly [THREE.Vector3, THREE.Vector3]): void {
    this.first.body.setTranslation({ x: at[0].x, y: this.restY[0], z: at[0].z }, true);
    this.second.body.setTranslation({ x: at[1].x, y: this.restY[1], z: at[1].z }, true);
  }

  tick(dt: number, firstMashed: boolean, secondMashed: boolean): ClashStageTickResult {
    this.simTimeS += dt;
    const events = this.harness.tick(dt, firstMashed, secondMashed);
    const intents: CameraIntent[] = [];
    let resolution: ClashResolutionInfo | null = null;

    if (this.harness.phase === 'Approach') {
      const t = THREE.MathUtils.smoothstep(this.harness.approachProgress01, 0, 1);
      this.placeBeys([this.approachFrom[0].clone().lerp(this.approachTo[0], t), this.approachFrom[1].clone().lerp(this.approachTo[1], t)]);
    } else if (events.clashStarted) {
      this.placeBeys(this.approachTo);
      const mid = this.approachTo[0].clone().lerp(this.approachTo[1], 0.5);
      intents.push({ kind: 'clashStart', magnitude: 0.6, targetIsFirst: null, position: vecOf(mid) });
    }

    for (const e of events.mashEvents) {
      const pos = e.isFirst ? this.first.body.translation() : this.second.body.translation();
      intents.push({ kind: 'hit', magnitude: 0.16, targetIsFirst: null, position: vecOf(pos) });
    }

    if (events.resolved) {
      resolution = this.applyResolution(events.resolved.outcome, events.resolved.firstMashEventCount, events.resolved.secondMashEventCount);
      const mid = new THREE.Vector3().addVectors(this.approachTo[0], this.approachTo[1]).multiplyScalar(0.5);
      intents.push({ kind: 'clashResolved', magnitude: CLASH_RESOLVED_MAGNITUDE, targetIsFirst: resolution.loserIsFirst, position: vecOf(mid) });
      this.physicsRunning = true;
    }

    if (this.physicsRunning) {
      this.physics.step();
      this.checkRingOut(intents);
    }
    // Physics keeps running after the resolution burst: the fight carries on from wherever the
    // knockback left the Beys (no freeze, no reset), exactly like the match would.

    this.syncVisuals();
    this.lastFrame = this.describe(intents);
    return { events, fightFrame: this.lastFrame, resolution, ringOut: this.ringOutInfo };
  }

  private checkRingOut(intents: CameraIntent[]): void {
    if (this.ringOutInfo) return;
    for (const [isFirst, bey] of [[true, this.first], [false, this.second]] as const) {
      const p = bey.body.translation();
      if (isRingOut({ x: p.x, z: p.z })) {
        this.ringOutInfo = { isFirst, atS: this.simTimeS };
        intents.push({ kind: 'ringOut', magnitude: 1, targetIsFirst: isFirst, position: vecOf(p) });
      }
    }
  }

  private applyResolution(outcome: ClashOutcome, firstMashEventCount: number, secondMashEventCount: number): ClashResolutionInfo {
    const info: ClashResolutionInfo = {
      outcome,
      loserIsFirst: outcome === ClashOutcome.Tie ? null : outcome === ClashOutcome.FirstWins ? false : true,
      firstClashPower: this.harness.controller.getLastResult()?.firstClashPower ?? 0,
      secondClashPower: this.harness.controller.getLastResult()?.secondClashPower ?? 0,
      firstMashEventCount,
      secondMashEventCount,
    };

    const firstXZ: Vec2 = { x: this.first.body.translation().x, z: this.first.body.translation().z };
    const secondXZ: Vec2 = { x: this.second.body.translation().x, z: this.second.body.translation().z };

    if (outcome === ClashOutcome.Tie) {
      const direction = normalize(subtract(secondXZ, firstXZ));
      const impulseMagnitude = CLASH_TIE_REPULSION_BASE_FORCE * KNOCKBACK_IMPULSE_PER_FORCE_UNIT;
      const horizontal = scale(direction, impulseMagnitude);
      const upward = impulseMagnitude * KNOCKBACK_UPWARD_LAUNCH_FRACTION;
      this.second.body.applyImpulse({ x: horizontal.x, y: upward, z: horizontal.z }, true);
      this.first.body.applyImpulse({ x: -horizontal.x, y: upward, z: -horizontal.z }, true);
      return info;
    }

    const winnerIsFirst = outcome === ClashOutcome.FirstWins;
    const winner = winnerIsFirst ? this.first : this.second;
    const loser = winnerIsFirst ? this.second : this.first;
    const winnerXZ = winnerIsFirst ? firstXZ : secondXZ;
    const loserXZ = winnerIsFirst ? secondXZ : firstXZ;
    const winnerScenario = winnerIsFirst ? this.scenario.first : this.scenario.second;
    const loserScenario = winnerIsFirst ? this.scenario.second : this.scenario.first;

    const knockback = computeKnockback({
      baseForce: this.scenario.knockbackForce,
      attackerSpeedMps: winnerScenario.speedMps,
      defenderSpeedMps: loserScenario.speedMps,
      defenderStabilityFraction: ASSUMED_DEFENDER_STABILITY_FRACTION,
      defenderStaminaPenaltyFraction: 1 - loserScenario.staminaFraction,
      attackStat: winner.stats.attack,
      defenseStat: loser.stats.defense,
      attackerVelocityXZ: { x: 0, z: 0 }, // both Beys are held still through Active, exactly like the real game.
      impactDirectionXZ: normalize(subtract(loserXZ, winnerXZ)),
    });
    applyKnockback(loser.body, winnerXZ, loserXZ, knockback);
    return info;
  }

  private syncVisuals(): void {
    for (const [bey, visual] of [[this.first, this.firstVisual], [this.second, this.secondVisual]] as const) {
      const t = bey.body.translation();
      const r = bey.body.rotation();
      visual.group.position.set(t.x, t.y, t.z);
      visual.group.quaternion.set(r.x, r.y, r.z, r.w);
      visual.spinGroup.rotation.y += 8 * (1 / 60); // Presentation harness: a gentle idle spin so the Beys don't look inert; this lab doesn't run SpinController.
    }
  }

  private fighter(bey: Bey): FighterFrame {
    const t = bey.body.translation();
    const v = bey.body.linvel();
    return {
      position: vecOf(t),
      velocity: { x: v.x, y: v.y, z: v.z },
      speed: Math.hypot(v.x, v.z),
      airborne: !isGrounded(this.physics, bey.collider),
      attack: 'none',
      broken: false,
    };
  }

  private describe(intents: CameraIntent[]): FightFrame {
    return {
      tick: 0,
      time: this.simTimeS,
      first: this.fighter(this.first),
      second: this.fighter(this.second),
      intents,
      clashActive: this.harness.phase === 'Active',
      clashProgress: this.harness.activeProgress01,
      roundOver: false,
      ringOutIsFirst: this.ringOutInfo?.isFirst ?? null,
    };
  }

  /** Body-origin height (m) above the floor at which [first, second] rest — also how far below the origin each tip touches the floor. */
  get restHeights(): readonly [number, number] {
    return this.restY;
  }

  get frame(): FightFrame {
    return this.lastFrame;
  }

  dispose(): void {
    this.visuals.removeFromParent();
    this.visuals.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m: THREE.Material) => m.dispose());
      }
    });
    this.physics.rapierWorld.free();
  }
}
