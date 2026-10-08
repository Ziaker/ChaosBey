// ============================================================
// ARENA LIGHTING READABILITY (owner playtest, 2026-10-08)
// "The first stage is dark, and gets darker the deeper the funnel is" / "the second stage is too dark".
// Root cause of the first: the Foundry lamps were aimed at a 3.2 m bowl (a fixed 0.62 rad cone, long penumbra, a 40 m range
// window) and hung at a height that did not follow the stage size, so on a deep funnel the far slope and the whole wall fell
// outside the cones. These tests pin the invariants that keep any depth (0-18 m) and any stage size (x0.5-x2.5) lit the same:
//   - the key lamps' intensity and position never depend on the bowl depth;
//   - every point a lamp has to light (floor, floor edge, top of the wall) sits inside the cone, at every depth and size;
//   - the rig follows the stage size as a whole (heights, range, intensity), so a bigger stage is not dimmer.
// No GPU: the lights are read from the built scene graph.
// ============================================================

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ARENA_FLOOR_RADIUS } from '../../src/arena/colliders/ArenaTuning';
import { ARENA_FLOORS, BOWL_DEPTH_M, type ArenaFloorId } from '../../src/arena/floor/ArenaFloorProfile';
import { ARENA_ART } from '../../src/arena/visual/ArenaArt';
import { spotAngleToCover, stageCoveragePoints, stageRigIntensity } from '../../src/arena/visual/common';
import type { ArenaPresetId } from '../../src/arena/presets/ArenaPresets';

const DEPTHS_M = [0, 2.5, 8.5, 18] as const;
const SIZES = [0.5, 1, 2.5] as const;
const FLOORS: readonly ArenaFloorId[] = ['bowl-a', 'bowl-b', 'bowl-c'];
/** The wall's height above the rim in the Foundry art (m). */
const FOUNDRY_WALL_HEIGHT_M = 1.8;

function build(id: ArenaPresetId, floor: ArenaFloorId, depthM: number, size: number) {
  // The floor profile at this depth, in the art's local (unstretched) radius: what ArenaVisualsSystem hands over.
  const heightAt = (r: number): number => ARENA_FLOORS[floor].heightAtRadius(r) * (depthM / BOWL_DEPTH_M);
  const built = ARENA_ART[id].build(undefined, heightAt, size);
  built.root.updateMatrixWorld(true);
  const lights: THREE.Light[] = [];
  built.root.traverse((o) => {
    if ((o as THREE.Light).isLight) lights.push(o as THREE.Light);
  });
  return { built, heightAt, lights };
}

/** A light's pose in world space, with the art root stretched by the stage size on X/Z as ArenaVisualsSystem does. */
function worldPosition(light: THREE.Object3D, size: number): THREE.Vector3 {
  return new THREE.Vector3(light.position.x * size, light.position.y, light.position.z * size);
}

describe('Foundry Pit lighting at every bowl depth and stage size', () => {
  it('lights the centre of the floor exactly as brightly at every depth (a lamp lifted for a deep bowl is brightened to match)', () => {
    /** What the lamps deliver to the middle of the floor: sum of intensity / distance^decay (the spot's own falloff). */
    const centreLight = (lights: THREE.Light[], size: number): number =>
      lights
        .filter((l): l is THREE.SpotLight => (l as THREE.SpotLight).isSpotLight)
        .reduce((sum, spot) => sum + spot.intensity / Math.pow(worldPosition(spot, size).length(), spot.decay), 0);
    for (const floor of FLOORS) {
      for (const size of SIZES) {
        const reference = build('foundry', floor, 0, size);
        const referenceLight = centreLight(reference.lights, size);
        expect(referenceLight).toBeGreaterThan(0);
        for (const depth of DEPTHS_M) {
          const { built, lights } = build('foundry', floor, depth, size);
          expect(centreLight(lights, size) / referenceLight, `${floor} x${size} d${depth}`).toBeGreaterThan(0.97);
          expect(centreLight(lights, size) / referenceLight, `${floor} x${size} d${depth}`).toBeLessThan(1.03);
          for (const spot of lights.filter((l): l is THREE.SpotLight => (l as THREE.SpotLight).isSpotLight)) {
            expect(spot.distance).toBe(0); // no range window: it faded the far side of a big or deep stage
            // The lamps never sit lower than the lab hung them, nor lower than the wall's top plus the lab's clearance.
            expect(spot.position.y).toBeGreaterThanOrEqual(14.6 * 3 * size - 1e-9);
          }
          // The fill is the same at every depth, too.
          const fill = lights.find((l) => (l as THREE.HemisphereLight).isHemisphereLight) as THREE.HemisphereLight;
          const refFill = reference.lights.find((l) => (l as THREE.HemisphereLight).isHemisphereLight) as THREE.HemisphereLight;
          expect(fill.intensity).toBe(refFill.intensity);
          built.dispose();
        }
        reference.built.dispose();
      }
    }
  });

  it('lights the floor, the rim and the top of the wall: every point stands inside the lamps\' cones, at every depth and stage size', () => {
    for (const floor of FLOORS) {
      for (const size of SIZES) {
        for (const depth of DEPTHS_M) {
          const { built, heightAt, lights } = build('foundry', floor, depth, size);
          const spots = lights.filter((l): l is THREE.SpotLight => (l as THREE.SpotLight).isSpotLight);
          const points = stageCoveragePoints(ARENA_FLOOR_RADIUS * size, (r) => heightAt(r / size), FOUNDRY_WALL_HEIGHT_M);
          for (const spot of spots) {
            const from = worldPosition(spot, size);
            const axis = worldPosition(spot.target, size).sub(from);
            for (const p of points) {
              const offset = p.clone().sub(from).angleTo(axis);
              // Inside the cone with room to spare (the penumbra starts at 40% of the angle; the wide clamp keeps the rest within the cone).
              expect(offset, `${floor} x${size} d${depth}`).toBeLessThan(spot.angle * 0.95);
            }
          }
          built.dispose();
        }
      }
    }
  });

  it('scales the rig as a whole with the stage size: heights and intensity follow it, so a bigger stage is lit as brightly', () => {
    const base = build('foundry', 'bowl-b', 2.5, 1);
    const baseSpot = base.lights.find((l) => (l as THREE.SpotLight).isSpotLight) as THREE.SpotLight;
    for (const size of SIZES) {
      const { built, lights } = build('foundry', 'bowl-b', 2.5, size);
      const spot = lights.find((l) => (l as THREE.SpotLight).isSpotLight) as THREE.SpotLight;
      expect(spot.position.y / baseSpot.position.y).toBeCloseTo(size, 9);
      expect(spot.intensity / baseSpot.intensity).toBeCloseTo(Math.pow(size, 1.6), 9);
      // Haze thins with the distances it covers.
      expect((built.fog as THREE.FogExp2).density * size).toBeCloseTo((base.built.fog as THREE.FogExp2).density, 9);
      built.dispose();
    }
    base.built.dispose();
  });
});

describe('Rift Crater readability', () => {
  it('has enough fill that the shadowed side and the floor are visible: hemisphere + moon + opposite rim light', () => {
    const { built, lights } = build('rift', 'bowl-b', 8.5, 1);
    const hemi = lights.find((l) => (l as THREE.HemisphereLight).isHemisphereLight) as THREE.HemisphereLight;
    const directionals = lights.filter((l): l is THREE.DirectionalLight => (l as THREE.DirectionalLight).isDirectionalLight);
    // The lab's rig was a 0.45 hemisphere and one 1.3 moon (1.75 together): it read as black through the game's camera.
    expect(hemi.intensity).toBeGreaterThanOrEqual(1);
    expect(directionals.length).toBeGreaterThanOrEqual(2);
    const total = hemi.intensity + directionals.reduce((sum, l) => sum + l.intensity, 0);
    expect(total).toBeGreaterThanOrEqual(3);
    // Exactly one casts a shadow (the moon): the rim light only fills.
    expect(directionals.filter((l) => l.castShadow)).toHaveLength(1);
    expect(built.exposure).toBeGreaterThanOrEqual(1.25);
    built.dispose();
  });

  it('lights the same at every bowl depth and stage size: directional and hemisphere lights have no position that depends on either', () => {
    const reference = build('rift', 'bowl-b', 0, 1);
    const key = (lights: THREE.Light[]) =>
      lights
        .filter((l) => (l as THREE.DirectionalLight).isDirectionalLight || (l as THREE.HemisphereLight).isHemisphereLight)
        .map((l) => [l.type, l.intensity, ...l.position.toArray()]);
    for (const depth of DEPTHS_M) {
      for (const size of SIZES) {
        const { built, lights } = build('rift', 'bowl-b', depth, size);
        expect(key(lights), `d${depth} x${size}`).toEqual(key(reference.lights));
        // The fissure glows follow the stage size as a whole like the Foundry's lamps do.
        const glows = lights.filter((l): l is THREE.PointLight => (l as THREE.PointLight).isPointLight && l.intensity > 0); // (the clash flash light is off)
        const refGlows = reference.lights.filter((l): l is THREE.PointLight => (l as THREE.PointLight).isPointLight && l.intensity > 0);
        glows.forEach((glow, i) => {
          expect(glow.distance / refGlows[i]!.distance).toBeCloseTo(size, 9);
          expect(glow.intensity / refGlows[i]!.intensity).toBeCloseTo(Math.pow(size, 1.8), 9);
        });
        built.dispose();
      }
    }
    reference.built.dispose();
  });
});

describe('lighting helpers', () => {
  it('stageRigIntensity grows by size^decay on top of the lab-to-game scale pass', () => {
    expect(stageRigIntensity(100, 1.6, 1) * Math.pow(2, 1.6)).toBeCloseTo(stageRigIntensity(100, 1.6, 2), 9);
  });

  it('spotAngleToCover returns the angle that puts the worst point at the given fraction of it, within its clamps', () => {
    const from = new THREE.Vector3(0, 10, 0);
    const target = new THREE.Vector3(0, 0, 0);
    const points = [new THREE.Vector3(10, 0, 0)]; // 45 deg off the axis
    expect(spotAngleToCover(from, target, points, { fraction: 0.5, minAngle: 0.1, maxAngle: 3 })).toBeCloseTo(Math.PI / 2, 9);
    expect(spotAngleToCover(from, target, points, { fraction: 0.5, minAngle: 0.1, maxAngle: 1 })).toBe(1);
    expect(spotAngleToCover(from, target, [], { minAngle: 0.62 })).toBe(0.62);
  });
});
