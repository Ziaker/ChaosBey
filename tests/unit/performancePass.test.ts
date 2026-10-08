// Performance pass (0.57.0): everything that lets the game run on a slower PC — adaptive resolution, the frame limiter, the
// quality presets' real cost cuts, the Bey model detail and the first-launch guess. All render cost only: none of it may reach
// the simulation (the same match plays the same on every setting; see the determinism suite).

import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { ADAPTIVE_MIN_SCALE, ADAPTIVE_STEP_DOWN, AdaptiveResolution, FAST_FRAME_MS, SLOW_FRAME_MS, WARMUP_S } from '../../src/app/frontend/adaptiveResolution';
import { FRAME_LIMIT_TOLERANCE_MS, FrameLimiter } from '../../src/app/frontend/frameLimiter';
import { presentationFor } from '../../src/app/frontend/quality';
import { QualityPreset } from '../../src/config/runtime/QualityPreset';
import { detectDefaultQuality } from '../../src/config/runtime/deviceCapability';
import { DEFAULT_PLAYER_SETTINGS, QUALITY_PROFILES, sanitizePlayerSettings } from '../../src/config/settings/PlayerSettings';
import { CONCEPTS } from '../../src/bey/visual/concepts/conceptDefinitions';
import { assembleConcept } from '../../src/bey/visual/model/assembleConcept';
import { getBeyModelDetail, setBeyModelDetail } from '../../src/bey/visual/model/geometry';
import { createRailVisuals } from '../../src/presentation/railVisual';
import { railsOfMatch } from '../../src/arena/rails/StageRails';
import { ARENA_FLOOR_RADIUS } from '../../src/arena/colliders/ArenaTuning';

/** Feeds `seconds` of frames of `frameMs` each; returns every scale change in order. */
function feed(adaptive: AdaptiveResolution, frameMs: number, seconds: number, range?: { min: number; max: number }): number[] {
  const changes: number[] = [];
  for (let t = 0; t < seconds * 1000; t += frameMs) {
    const next = adaptive.update(frameMs, range);
    if (next !== null) changes.push(next);
  }
  return changes;
}

describe('adaptive resolution', () => {
  it('does nothing on a machine that holds 60 fps (16.7 ms sits between the two thresholds)', () => {
    const a = new AdaptiveResolution();
    expect(feed(a, 1000 / 60, 60)).toEqual([]);
    expect(a.scale).toBe(1);
  });

  it('steps down while frames are slow, never below the floor, and not at all during the warm-up', () => {
    const a = new AdaptiveResolution();
    expect(feed(a, 40, WARMUP_S - 0.1)).toEqual([]); // the first seconds (shader compiles) are not judged
    const changes = feed(a, 40, 30);
    expect(changes.length).toBeGreaterThan(2);
    expect(changes[0]).toBeCloseTo(1 - ADAPTIVE_STEP_DOWN, 6);
    for (let i = 1; i < changes.length; i++) expect(changes[i]!).toBeLessThan(changes[i - 1]!);
    expect(a.scale).toBe(ADAPTIVE_MIN_SCALE);
  });

  it('climbs back (slowly) when frames are fast again, up to the preset\'s ceiling only', () => {
    const a = new AdaptiveResolution(0.6);
    const range = { min: 0.5, max: 0.75 };
    const changes = feed(a, 8, 120, range);
    expect(changes.length).toBeGreaterThan(0);
    expect(a.scale).toBe(0.75);
    expect(Math.max(...changes)).toBeLessThanOrEqual(0.75);
  });

  it('a preset\'s range pulls an out-of-range scale inside it at once, and a slow frame ignores spikes (tab switches)', () => {
    const a = new AdaptiveResolution(1);
    feed(a, 1000 / 60, WARMUP_S + 0.5);
    expect(a.update(16.7, { min: 0.5, max: 0.75 })).toBe(0.75);
    const b = new AdaptiveResolution();
    expect(b.update(5000)).toBeNull();
    expect(b.smoothedFrameMs).toBeNull();
    expect(b.update(Number.NaN)).toBeNull();
  });

  it('a machine stuck at a few frames a second (frames beyond the hitch limit, one after another) is the one that gets scaled down', () => {
    const a = new AdaptiveResolution();
    const changes = feed(a, 400, 60); // 2.5 fps
    expect(changes.length).toBeGreaterThan(0);
    expect(a.scale).toBeLessThan(1);
    // ...while a single long frame in the middle of a good run changes nothing.
    const b = new AdaptiveResolution();
    feed(b, 1000 / 60, 3);
    expect(b.update(900)).toBeNull();
    expect(feed(b, 1000 / 60, 10)).toEqual([]);
    expect(b.scale).toBe(1);
  });

  it('thresholds leave a dead band around 60 fps', () => {
    expect(FAST_FRAME_MS).toBeLessThan(1000 / 60);
    expect(SLOW_FRAME_MS).toBeGreaterThan(1000 / 60);
  });
});

describe('frame limiter', () => {
  function drawn(limit: '60' | '30' | 'off', refreshHz: number, seconds = 5): number {
    const limiter = new FrameLimiter(limit);
    let n = 0;
    for (let t = 0; t < seconds * 1000; t += 1000 / refreshHz) if (limiter.shouldDraw(t)) n++;
    return n / seconds;
  }

  it('halves the drawing on a 120 Hz display at 60 fps, and does not touch a 60 Hz one', () => {
    expect(drawn('60', 120)).toBeCloseTo(60, 0);
    expect(drawn('60', 60)).toBeCloseTo(60, 0);
    expect(drawn('off', 120)).toBeCloseTo(120, 0);
  });

  it('keeps odd refresh rates close to the limit: 75 Hz is not cut to 37 fps, 144 Hz lands near 60-72', () => {
    expect(drawn('60', 75)).toBeGreaterThan(70);
    expect(drawn('60', 144)).toBeGreaterThan(58);
    expect(drawn('60', 144)).toBeLessThan(75);
  });

  it('30 fps on a 60 Hz display draws every second frame', () => {
    expect(drawn('30', 60)).toBeCloseTo(30, 0);
    expect(FRAME_LIMIT_TOLERANCE_MS).toBeLessThan(1000 / 60);
  });

  it('draws the first frame at once, and again after a reset', () => {
    const limiter = new FrameLimiter('30');
    expect(limiter.shouldDraw(1000)).toBe(true);
    expect(limiter.shouldDraw(1001)).toBe(false);
    limiter.reset();
    expect(limiter.shouldDraw(1002)).toBe(true);
  });
});

describe('quality presets and settings', () => {
  it('Low cuts cost on every axis the others do not, and High never costs less than Medium', () => {
    const { Low, Medium, High } = QUALITY_PROFILES;
    expect(Low.modelDetail).toBeLessThan(Medium.modelDetail);
    expect(Medium.modelDetail).toBe(1); // the approved models, exactly
    expect(High.modelDetail).toBe(1);
    expect(Low.antialias).toBe(false);
    expect(Medium.antialias && High.antialias).toBe(true);
    expect(Low.maxPixelRatio).toBeLessThanOrEqual(Medium.maxPixelRatio);
    expect(Medium.maxPixelRatio).toBeLessThanOrEqual(High.maxPixelRatio);
    expect(Low.renderScaleRange.max).toBeLessThan(1);
    for (const p of [Low, Medium, High]) expect(p.renderScaleRange.min).toBeLessThanOrEqual(p.renderScaleRange.max);
  });

  it('the new settings default to adaptive on and 60 fps, survive a round trip and fall back from junk', () => {
    expect(DEFAULT_PLAYER_SETTINGS.adaptiveResolution).toBe(true);
    expect(DEFAULT_PLAYER_SETTINGS.frameLimit).toBe('60');
    const saved = sanitizePlayerSettings({ ...DEFAULT_PLAYER_SETTINGS, adaptiveResolution: false, frameLimit: '30' });
    expect(saved.adaptiveResolution).toBe(false);
    expect(saved.frameLimit).toBe('30');
    const junk = sanitizePlayerSettings({ adaptiveResolution: 'yes', frameLimit: 'fast' });
    expect(junk.adaptiveResolution).toBe(true);
    expect(junk.frameLimit).toBe('60');
    // Settings saved before this pass (no such fields) keep working.
    const old = sanitizePlayerSettings({ quality: QualityPreset.Low });
    expect(old.quality).toBe(QualityPreset.Low);
    expect(old.adaptiveResolution).toBe(true);
  });

  it('the match presentation carries the performance settings of its quality preset', () => {
    const presentation = presentationFor({ ...DEFAULT_PLAYER_SETTINGS, quality: QualityPreset.Low, frameLimit: '30', adaptiveResolution: false });
    expect(presentation.performance).toEqual({ adaptiveResolution: false, frameLimit: '30', renderScaleRange: QUALITY_PROFILES.Low.renderScaleRange });
    expect(presentation.trails).toBe(false);
  });
});

describe('first-launch quality guess', () => {
  it('starts on Low for software renderers, phones, few cores, little memory and modest integrated GPUs on big screens', () => {
    expect(detectDefaultQuality({ gpu: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))' })).toBe(QualityPreset.Low);
    expect(detectDefaultQuality({ gpu: 'llvmpipe (LLVM 15.0.7, 256 bits)' })).toBe(QualityPreset.Low);
    expect(detectDefaultQuality({ mobile: true, cores: 8 })).toBe(QualityPreset.Low);
    expect(detectDefaultQuality({ cores: 2 })).toBe(QualityPreset.Low);
    expect(detectDefaultQuality({ memoryGb: 2 })).toBe(QualityPreset.Low);
    expect(detectDefaultQuality({ gpu: 'ANGLE (Intel, Intel(R) UHD Graphics 620)', cores: 4 })).toBe(QualityPreset.Low);
    expect(detectDefaultQuality({ gpu: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics)', cores: 8, memoryGb: 8, screenPixels: 8_000_000 })).toBe(QualityPreset.Low);
  });

  it('keeps the usual Medium for everything else, and never picks High on its own', () => {
    expect(detectDefaultQuality({})).toBe(QualityPreset.Medium);
    expect(detectDefaultQuality({ gpu: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060)', cores: 12, memoryGb: 8, screenPixels: 2_000_000 })).toBe(QualityPreset.Medium);
    expect(detectDefaultQuality({ gpu: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics)', cores: 8, memoryGb: 8, screenPixels: 2_000_000 })).toBe(QualityPreset.Medium);
  });
});

describe('Bey model detail', () => {
  afterEach(() => setBeyModelDetail(1));

  const triangles = (root: THREE.Object3D): number => {
    let total = 0;
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) total += m.geometry.index ? m.geometry.index.count / 3 : m.geometry.getAttribute('position').count / 3;
    });
    return total;
  };

  it('is exactly the approved model at detail 1 and clamps nonsense', () => {
    setBeyModelDetail(5);
    expect(getBeyModelDetail()).toBe(1);
    setBeyModelDetail(Number.NaN);
    expect(getBeyModelDetail()).toBe(1);
    setBeyModelDetail(0);
    expect(getBeyModelDetail()).toBeGreaterThan(0);
  });

  it('the Low preset cuts the triangles of every concept by more than half and keeps every piece (same meshes, same size)', () => {
    for (const concept of CONCEPTS.slice(0, 9)) {
      setBeyModelDetail(1);
      const full = assembleConcept(concept);
      setBeyModelDetail(QUALITY_PROFILES.Low.modelDetail);
      const low = assembleConcept(concept);
      const countMeshes = (o: THREE.Object3D): number => { let n = 0; o.traverse((x) => { if ((x as THREE.Mesh).isMesh) n++; }); return n; };
      expect(countMeshes(low.root), concept.id).toBe(countMeshes(full.root));
      expect(triangles(low.root), concept.id).toBeLessThan(triangles(full.root) * 0.6);
      const a = new THREE.Box3().setFromObject(full.root).getSize(new THREE.Vector3());
      const b = new THREE.Box3().setFromObject(low.root).getSize(new THREE.Vector3());
      // The silhouette stays: a coarser polygon is a little smaller than the circle it approximates, never by more than a few percent.
      expect(b.x / a.x, concept.id).toBeGreaterThan(0.93);
      expect(b.y / a.y, concept.id).toBeGreaterThan(0.93);
      expect(b.z / a.z, concept.id).toBeGreaterThan(0.93);
    }
  });

  it('the rails\' tubes are cheap: a few thousand triangles for the whole stage, not tens of thousands', () => {
    const rails = railsOfMatch(true, { id: 'bowl-b', depthM: 7 }, ARENA_FLOOR_RADIUS);
    expect(triangles(createRailVisuals(rails))).toBeLessThan(4000);
  });
});
