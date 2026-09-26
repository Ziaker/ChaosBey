// ============================================================
// VFX MANAGER
// Owns every Milestone 4 VFX instance's lifecycle (sparks, landing bursts,
// speed trails, speed lines): spawns on fresh ImpactEvents, ages/removes
// finished one-shot effects every render frame, updates the persistent
// per-Bey/per-camera effects. Thin wiring only (GDD section 1.4) — the
// actual look of each effect lives in its own module.
//
// Milestone 6: sparks/landing bursts are tinted from each side's own
// BeyParticleProfile (defaulting to the fixed VfxTuning colors, so any
// caller not yet passing a profile keeps its exact prior behavior) — the
// real consumer of the per-archetype particle identity hook.
// ============================================================

import * as THREE from 'three';
import { DEFAULT_PARTICLE_PROFILE, type BeyParticleProfile } from '../bey/archetype/BeyParticleProfile';
import type { ImpactEvent, WorldPositionM } from '../camera/ImpactEvents';
import { createLandingBurst, disposeLandingBurst, updateLandingBurst, type ActiveLandingBurst } from './LandingBurstVfx';
import { createSparkBurst, disposeSparkBurst, updateSparkBurst, type ActiveSparkBurst } from './SparkBurstVfx';
import { SpeedLines } from './SpeedLinesVfx';
import { SpeedTrail } from './SpeedTrailVfx';
import { LANDING_MIN_MAGNITUDE_TO_SPAWN, SPARK_MIN_MAGNITUDE_TO_SPAWN, TRAIL_COLOR_FIRST_HEX, TRAIL_COLOR_SECOND_HEX } from './VfxTuning';
import { routeImpactEventToVfx } from './VfxRouting';

export class VfxManager {
  private activeSparkBursts: ActiveSparkBurst[] = [];
  private activeLandingBursts: ActiveLandingBurst[] = [];
  private readonly firstTrail: SpeedTrail;
  private readonly secondTrail: SpeedTrail;
  private readonly speedLines: SpeedLines;

  constructor(
    private readonly scene: THREE.Scene,
    camera: THREE.Camera,
    private readonly firstParticleProfile: BeyParticleProfile = DEFAULT_PARTICLE_PROFILE,
    private readonly secondParticleProfile: BeyParticleProfile = DEFAULT_PARTICLE_PROFILE,
  ) {
    this.firstTrail = new SpeedTrail(TRAIL_COLOR_FIRST_HEX);
    this.secondTrail = new SpeedTrail(TRAIL_COLOR_SECOND_HEX);
    scene.add(this.firstTrail.object3D);
    scene.add(this.secondTrail.object3D);

    this.speedLines = new SpeedLines();
    camera.add(this.speedLines.object3D);
  }

  /**
   * Spawns new one-shot effects for this tick's fresh impact events. Call
   * only on a tick where gameplay actually advanced (never on a tick
   * frozen by hitstop) — those already pass an empty events array from
   * tickMatch not having run.
   *
   * Routing (see VfxRouting.ts) is deliberately narrow: only 'hit' and
   * 'wallImpact' — genuine physical contact — spawn a spark. An evaded
   * attack never shows a contact spark, and stabilityBreak/ko/ringOut
   * (which co-occur with the very hit that caused them, in this same
   * event list) don't spawn a second, duplicate burst on top of that
   * hit's own spark.
   */
  onImpactEvents(events: ImpactEvent[]): void {
    for (const event of events) {
      const route = routeImpactEventToVfx(event);
      const particleProfile = event.isFirst ? this.firstParticleProfile : this.secondParticleProfile;
      if (route === 'landing') {
        if (event.magnitude < LANDING_MIN_MAGNITUDE_TO_SPAWN) continue;
        const burst = createLandingBurst(event.magnitude, event.worldPositionM, particleProfile.landingTintHex);
        this.scene.add(burst.mesh);
        this.activeLandingBursts.push(burst);
      } else if (route === 'spark') {
        if (event.magnitude < SPARK_MIN_MAGNITUDE_TO_SPAWN) continue;
        const burst = createSparkBurst(event.magnitude, event.worldPositionM, particleProfile.sparkTintHex);
        this.scene.add(burst.points);
        this.activeSparkBursts.push(burst);
      }
    }
  }

  /**
   * Runs every render frame regardless of hitstop: ages/removes finished
   * one-shot effects and updates the persistent per-Bey trails + camera
   * speed lines. `speedLinesScreenDirection` is the player's movement
   * direction already projected onto the camera's own axes (see
   * CombatCameraController) — camera-relative, not world space — so the
   * streaks track real travel direction (GDD requirement) instead of
   * sitting as a fixed radial overlay.
   */
  onRenderFrame(
    frameDeltaSeconds: number,
    firstPositionM: WorldPositionM,
    firstSpeedMps: number,
    secondPositionM: WorldPositionM,
    secondSpeedMps: number,
    speedLinesScreenDirection: { x: number; y: number },
  ): void {
    this.activeSparkBursts = this.activeSparkBursts.filter((burst) => {
      const alive = updateSparkBurst(burst, frameDeltaSeconds);
      if (!alive) {
        this.scene.remove(burst.points);
        disposeSparkBurst(burst);
      }
      return alive;
    });

    this.activeLandingBursts = this.activeLandingBursts.filter((burst) => {
      const alive = updateLandingBurst(burst, frameDeltaSeconds);
      if (!alive) {
        this.scene.remove(burst.mesh);
        disposeLandingBurst(burst);
      }
      return alive;
    });

    this.firstTrail.update(firstPositionM, firstSpeedMps);
    this.secondTrail.update(secondPositionM, secondSpeedMps);
    this.speedLines.update(firstSpeedMps, { x: speedLinesScreenDirection.x, z: speedLinesScreenDirection.y });
  }
}
