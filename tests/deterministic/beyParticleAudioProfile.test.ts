// ============================================================
// BEY PARTICLE/AUDIO PROFILE SELF-TESTS (MILESTONE 6)
// Proves the remaining M6 identity axis: Attack/Defense/Stamina point to
// different particle (VFX tint) and audio (cue ID) identities, defaults
// stay byte-identical to the fixed Milestone 4/5 constants, and — the
// real "not a dead hook" check — VfxManager actually tints each side's
// spark/landing bursts from its own BeyParticleProfile end to end.
// ============================================================

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ATTACK_ARCHETYPE, DEFENSE_ARCHETYPE, STAMINA_ARCHETYPE } from '../../src/bey/archetype/BeyArchetypes';
import { DEFAULT_AUDIO_PROFILE } from '../../src/bey/archetype/BeyAudioProfile';
import { DEFAULT_BEY_DEFINITION } from '../../src/bey/archetype/BeyDefinition';
import { DEFAULT_PARTICLE_PROFILE } from '../../src/bey/archetype/BeyParticleProfile';
import { createLandingBurst } from '../../src/vfx/LandingBurstVfx';
import { createSparkBurst } from '../../src/vfx/SparkBurstVfx';
import { LANDING_RING_COLOR_HEX, SPARK_COLOR_HEX } from '../../src/vfx/VfxTuning';
import { VfxManager } from '../../src/vfx/VfxManager';

describe('BeyParticleProfile — per-archetype VFX tint differs purely from data', () => {
  it('the three archetypes have pairwise-distinct spark and landing tints', () => {
    const profiles = [ATTACK_ARCHETYPE, DEFENSE_ARCHETYPE, STAMINA_ARCHETYPE].map((d) => d.particle);
    expect(new Set(profiles.map((p) => p.sparkTintHex)).size).toBe(3);
    expect(new Set(profiles.map((p) => p.landingTintHex)).size).toBe(3);
  });

  it('each archetype\'s tint is exactly its own already-approved prototype color, not an invented new one', () => {
    expect(ATTACK_ARCHETYPE.particle).toEqual({ sparkTintHex: 0xff5c5c, landingTintHex: 0x4a0b0b });
    expect(DEFENSE_ARCHETYPE.particle).toEqual({ sparkTintHex: 0x4f8cff, landingTintHex: 0x0b1e4a });
    expect(STAMINA_ARCHETYPE.particle).toEqual({ sparkTintHex: 0x4fffb0, landingTintHex: 0x0b4a2e });
  });

  it('DEFAULT_BEY_DEFINITION keeps the exact fixed Milestone 4/5 VFX colors', () => {
    expect(DEFAULT_BEY_DEFINITION.particle).toEqual(DEFAULT_PARTICLE_PROFILE);
    expect(DEFAULT_PARTICLE_PROFILE).toEqual({ sparkTintHex: SPARK_COLOR_HEX, landingTintHex: LANDING_RING_COLOR_HEX });
  });
});

describe('BeyAudioProfile — per-archetype cue identity differs purely from data', () => {
  it('the three archetypes have pairwise-distinct hit/dash cue IDs', () => {
    const profiles = [ATTACK_ARCHETYPE, DEFENSE_ARCHETYPE, STAMINA_ARCHETYPE].map((d) => d.audio);
    expect(new Set(profiles.map((p) => p.hitCueId)).size).toBe(3);
    expect(new Set(profiles.map((p) => p.dashCueId)).size).toBe(3);
  });

  it('each archetype\'s cue IDs follow its own "-prototype" identity, not a shared/default one', () => {
    expect(ATTACK_ARCHETYPE.audio).toEqual({ hitCueId: 'attack-prototype-hit', dashCueId: 'attack-prototype-dash' });
    expect(DEFENSE_ARCHETYPE.audio).toEqual({ hitCueId: 'defense-prototype-hit', dashCueId: 'defense-prototype-dash' });
    expect(STAMINA_ARCHETYPE.audio).toEqual({ hitCueId: 'stamina-prototype-hit', dashCueId: 'stamina-prototype-dash' });
  });

  it('DEFAULT_BEY_DEFINITION keeps the placeholder default cue set', () => {
    expect(DEFAULT_BEY_DEFINITION.audio).toEqual(DEFAULT_AUDIO_PROFILE);
  });
});

function firstPointsMaterialColorHex(scene: THREE.Scene): number | null {
  for (const child of scene.children) {
    if (child instanceof THREE.Points) return (child.material as THREE.PointsMaterial).color.getHex();
  }
  return null;
}

function firstRingMeshColorHex(scene: THREE.Scene): number | null {
  for (const child of scene.children) {
    if (child instanceof THREE.Mesh) return (child.material as THREE.MeshBasicMaterial).color.getHex();
  }
  return null;
}

describe('createSparkBurst/createLandingBurst — tintHex parameter', () => {
  it('createSparkBurst defaults to SPARK_COLOR_HEX and honors an explicit tintHex', () => {
    const defaultBurst = createSparkBurst(0.5, { x: 0, y: 0, z: 0 });
    expect((defaultBurst.points.material as THREE.PointsMaterial).color.getHex()).toBe(SPARK_COLOR_HEX);

    const tintedBurst = createSparkBurst(0.5, { x: 0, y: 0, z: 0 }, 0x123456);
    expect((tintedBurst.points.material as THREE.PointsMaterial).color.getHex()).toBe(0x123456);
  });

  it('createLandingBurst defaults to LANDING_RING_COLOR_HEX and honors an explicit tintHex', () => {
    const defaultBurst = createLandingBurst(0.5, { x: 0, y: 0, z: 0 });
    expect((defaultBurst.mesh.material as THREE.MeshBasicMaterial).color.getHex()).toBe(LANDING_RING_COLOR_HEX);

    const tintedBurst = createLandingBurst(0.5, { x: 0, y: 0, z: 0 }, 0x654321);
    expect((tintedBurst.mesh.material as THREE.MeshBasicMaterial).color.getHex()).toBe(0x654321);
  });
});

describe('VfxManager — really uses each side\'s own BeyParticleProfile, not a dead/unused hook', () => {
  it('a hit event spawns a spark tinted with the affected side\'s own sparkTintHex', () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const vfxManager = new VfxManager(scene, camera, ATTACK_ARCHETYPE.particle, DEFENSE_ARCHETYPE.particle);

    vfxManager.onImpactEvents([{ kind: 'hit', magnitude: 0.5, worldPositionM: { x: 0, y: 0, z: 0 }, isFirst: true }]);
    expect(firstPointsMaterialColorHex(scene)).toBe(ATTACK_ARCHETYPE.particle.sparkTintHex);
  });

  it('the same event for the second side tints with the second side\'s own sparkTintHex instead', () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const vfxManager = new VfxManager(scene, camera, ATTACK_ARCHETYPE.particle, DEFENSE_ARCHETYPE.particle);

    vfxManager.onImpactEvents([{ kind: 'hit', magnitude: 0.5, worldPositionM: { x: 0, y: 0, z: 0 }, isFirst: false }]);
    expect(firstPointsMaterialColorHex(scene)).toBe(DEFENSE_ARCHETYPE.particle.sparkTintHex);
  });

  it('a landing event tints the landing ring with the affected side\'s own landingTintHex', () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const vfxManager = new VfxManager(scene, camera, ATTACK_ARCHETYPE.particle, DEFENSE_ARCHETYPE.particle);

    vfxManager.onImpactEvents([{ kind: 'landing', magnitude: 0.5, worldPositionM: { x: 0, y: 0, z: 0 }, isFirst: true }]);
    expect(firstRingMeshColorHex(scene)).toBe(ATTACK_ARCHETYPE.particle.landingTintHex);
  });

  it('constructing VfxManager with no particle profiles reproduces the exact old fixed-color behavior', () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const vfxManager = new VfxManager(scene, camera);

    vfxManager.onImpactEvents([{ kind: 'hit', magnitude: 0.5, worldPositionM: { x: 0, y: 0, z: 0 }, isFirst: true }]);
    expect(firstPointsMaterialColorHex(scene)).toBe(SPARK_COLOR_HEX);
  });
});
