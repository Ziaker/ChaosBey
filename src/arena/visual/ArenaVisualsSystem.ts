// ============================================================
// ARENA VISUALS SYSTEM (arenaVisuals flag)
// Builds the approved arena art for the match's arena and animates it: the
// lamps, fissures and LED rail that react to a Clash, the flash at a wall
// impact, the ambient motion. It is built from the real floor's height profile
// (flat by default, or the approved bowl A/B/C), so the Beys stand on the surface
// the art draws; the default arena choice is not changed by this flag.
//
// Hard limits (tested):
//   - createArenaColliders.ts is untouched: it still builds the colliders and its
//     temporary visuals in one call; with this flag on those temporary visuals go to
//     a hidden holder (createMatchScene) and are never drawn;
//   - nothing here reaches a collider, the floor equation, the playable area or the ring-out region;
//   - no decoration stands between the camera and the action: the art keeps everything
//     inside the camera's containment radius clear (the camera is not touched, ever).
// ============================================================

import { arenaSizeScale } from '../colliders/ArenaTuning';
import * as THREE from 'three';
import type { PresentationEvent } from '../../presentation/events';
import type { PresentationFrame, PresentationSystem } from '../../presentation/hub';
import type { MatchPresentationState } from '../../presentation/state';
import type { ArenaPresetId } from '../presets/ArenaPresets';
import { arenaArtFor } from './ArenaArt';
import { ARENA_RADIUS, LAB_ARENA_RADIUS } from './common';
import type { BuiltArena } from './types';

export const ARENA_VISUALS_SYSTEM_ID = 'arena-visuals';

/** How fast the lighting follows the Clash (per second): the lab viewer's easing. */
const CLASH_FOLLOW_PER_S = 3;
const MAX_FRAME_DT = 1 / 20;
/**
 * A collision this close to the wall (m) flashes the wall lights: the lab's band (0.4 of its 12 m radius), kept in
 * metres on the real floor so a bump in the middle of the bigger stage does not light the wall.
 */
const WALL_FLASH_BAND_M = 0.4 * LAB_ARENA_RADIUS;
/** The flash sits this far inside the wall (m): the lab's 3% of 12 m. */
const WALL_FLASH_INSET_M = 0.03 * LAB_ARENA_RADIUS;

/** The two renderer settings the approved art was authored against (ACES tone mapping and its per-arena exposure). */
export interface ToneMappedRenderer {
  toneMapping: THREE.ToneMapping;
  toneMappingExposure: number;
}

export interface ArenaVisualsOptions {
  /** Where the scene fog is set (and restored). */
  readonly scene: THREE.Scene;
  /** The session's scene root: the art is a child of it and goes away with it. */
  readonly root: THREE.Object3D;
  readonly presetId: ArenaPresetId;
  /** The real floor's height by distance from the centre. */
  readonly floorHeightAtR: (r: number) => number;
  /** 0..1 extra Clash lighting from a Clash presentation, if one is running. */
  readonly getClashIntensity?: () => number;
  /**
   * The renderer. The approved arenas were authored with ACES tone mapping and a per-arena exposure; without them the brightest
   * (the stadium's polymer floor under eight spots) clips to white. They are set while this system lives and put back on dispose,
   * so flag off keeps the renderer exactly as it was. Omit to leave the renderer alone.
   */
  readonly renderer?: ToneMappedRenderer;
}

export class ArenaVisualsSystem implements PresentationSystem {
  readonly id = ARENA_VISUALS_SYSTEM_ID;

  readonly built: BuiltArena;
  private readonly previousFog: THREE.Scene['fog'];
  private readonly previousTone: { readonly mapping: THREE.ToneMapping; readonly exposure: number } | null;
  private timeS = 0;
  private clash = 0;
  private readonly point = new THREE.Vector3();

  constructor(private readonly options: ArenaVisualsOptions) {
    // Owner, 2026-10-04 (stage size): the art is built for the 36 m floor and stretched to the match's stage size.
    const size = arenaSizeScale();
    const floorAt = options.floorHeightAtR;
    this.built = arenaArtFor(options.presetId).build(undefined, floorAt ? (r: number) => floorAt(r * size) : undefined);
    this.built.root.scale.set(size, 1, size);
    this.built.root.name = `arena-art-${options.presetId}`;
    options.root.add(this.built.root);
    this.previousFog = options.scene.fog;
    options.scene.fog = this.built.fog;
    const renderer = options.renderer;
    this.previousTone = renderer ? { mapping: renderer.toneMapping, exposure: renderer.toneMappingExposure } : null;
    if (renderer) {
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = this.built.exposure;
    }
  }

  /** Where the art's wall stands (m from the centre), for tests and for decoration checks. */
  get wallRadiusM(): number {
    return this.built.wallRadius;
  }

  onEvents(events: readonly PresentationEvent[], _state: MatchPresentationState): void {
    for (const event of events) {
      if (event.kind !== 'collisionResolved') continue;
      const r = Math.hypot(event.position.x, event.position.z);
      if (r < this.built.wallRadius - WALL_FLASH_BAND_M) continue; // a bump in the middle, not the wall
      const k = (this.built.wallRadius - WALL_FLASH_INSET_M) / Math.max(r, 1e-6);
      this.point.set(event.position.x * k, event.position.y, event.position.z * k);
      this.built.flash(this.point);
    }
  }

  update(frame: PresentationFrame): void {
    const dt = Math.min(MAX_FRAME_DT, Math.max(0, frame.dtSeconds));
    this.timeS += dt;
    const active = frame.state?.clash.active ? 1 : 0;
    const target = Math.max(active, this.options.getClashIntensity?.() ?? 0);
    this.clash += (target - this.clash) * (1 - Math.exp(-dt * CLASH_FOLLOW_PER_S));
    this.built.update({ time: this.timeS, dt, clash: this.clash });
  }

  reset(): void {
    this.clash = 0;
  }

  getStats(): Readonly<Record<string, number>> {
    return { clash: this.clash, wallRadiusM: this.built.wallRadius, rimM: this.built.depth };
  }

  dispose(): void {
    this.built.root.removeFromParent();
    this.built.dispose();
    if (this.options.scene.fog === this.built.fog) this.options.scene.fog = this.previousFog;
    if (this.options.renderer && this.previousTone) {
      this.options.renderer.toneMapping = this.previousTone.mapping;
      this.options.renderer.toneMappingExposure = this.previousTone.exposure;
    }
  }
}

export function createArenaVisualsSystem(options: ArenaVisualsOptions): ArenaVisualsSystem {
  return new ArenaVisualsSystem(options);
}

/** The art's arena radius (m): the real floor's. */
export const ARENA_ART_RADIUS_M = ARENA_RADIUS;
