// Rail Grinding preparation (0.50.0, docs/planning/RAIL_GRINDING_FUTURE_UPDATE.md): the route model, the blueprint that
// puts a rail on the real floor (size, funnel depth), the stage registry (empty until the owner decides layouts) and the
// Pregame's Rails option. No gameplay exists yet: this pins the contract the implementation will build on.

import { describe, expect, it } from 'vitest';
import { advancedSnapshot, applyPreset, detectPreset } from '../../src/app/frontend/pregamePresets';
import { ADVANCED_CONTROLS, isModified, modifiedKeys, writeAdvanced } from '../../src/app/frontend/advancedControls';
import { MATCH_RULE_KEYS, changedRuleLines, createDefaultMatchSetup, defaultMatchRules, matchConfigFor, sanitizeMatchRules, withDefaultRules } from '../../src/app/frontend/matchSetup';
import { ARENA_FLOOR_RADIUS, setArenaSizeScale } from '../../src/arena/colliders/ArenaTuning';
import { floorHeightAt } from '../../src/arena/floor/ArenaFloorProfile';
import { RailPath } from '../../src/arena/rails/RailPath';
import { RAIL_RESOLVE_STEP_M, resolveRail, type RailBlueprint } from '../../src/arena/rails/RailBlueprint';
import { railsForMatch, STAGE_RAIL_BLUEPRINTS } from '../../src/arena/rails/StageRails';
import { NOT_ON_RAIL, PLACEHOLDER_RAIL_TUNING, isOnRail } from '../../src/arena/rails/RailTraversal';
import { ARENA_PRESETS } from '../../src/arena/presets/ArenaPresets';
import { createDefaultMatchConfig } from '../../src/config/match/MatchConfig';

const L_SHAPE = [
  { x: 0, y: 0, z: 0 },
  { x: 10, y: 0, z: 0 },
  { x: 10, y: 0, z: 10 },
];

describe('RailPath', () => {
  it('has the arc length of its polyline and samples positions and unit tangents along it', () => {
    const path = new RailPath(L_SHAPE);
    expect(path.lengthM).toBeCloseTo(20, 12);
    const start = path.sampleAt(0);
    expect(start.position).toEqual({ x: 0, y: 0, z: 0 });
    expect(start.tangent).toEqual({ x: 1, y: 0, z: 0 });
    const corner = path.sampleAt(10);
    expect(corner.position.x).toBeCloseTo(10, 12);
    const mid = path.sampleAt(15);
    expect(mid.position).toEqual({ x: 10, y: 0, z: 5 });
    expect(mid.tangent).toEqual({ x: 0, y: 0, z: 1 });
    for (const s of [0, 3, 10, 12.5, 20]) {
      const t = path.sampleAt(s).tangent;
      expect(Math.hypot(t.x, t.y, t.z)).toBeCloseTo(1, 12);
    }
  });

  it('clamps progress on an open rail and wraps it on a closed one', () => {
    const open = new RailPath(L_SHAPE);
    expect(open.sampleAt(-5).progressM).toBe(0);
    expect(open.sampleAt(99).progressM).toBe(20);
    expect(open.sampleAt(99).position).toEqual({ x: 10, y: 0, z: 10 });
    const closed = new RailPath(L_SHAPE, true);
    expect(closed.lengthM).toBeCloseTo(20 + Math.hypot(10, 10), 12);
    expect(closed.sampleAt(closed.lengthM + 5).position).toEqual(closed.sampleAt(5).position);
    expect(closed.sampleAt(-5).progressM).toBeCloseTo(closed.lengthM - 5, 12);
  });

  it('projects a point onto the nearest part of the rail, with its progress and distance', () => {
    const path = new RailPath(L_SHAPE);
    const near = path.project({ x: 4, y: 2, z: -3 });
    expect(near.progressM).toBeCloseTo(4, 12);
    expect(near.distanceM).toBeCloseTo(Math.hypot(2, 3), 12);
    expect(near.position).toEqual({ x: 4, y: 0, z: 0 });
    const beyondEnd = path.project({ x: 10, y: 0, z: 30 });
    expect(beyondEnd.progressM).toBeCloseTo(20, 12);
    expect(beyondEnd.distanceM).toBeCloseTo(20, 12);
    // Sampling then projecting returns the same progress.
    for (const s of [1, 7, 10, 13, 19]) expect(path.project(path.sampleAt(s).position).progressM).toBeCloseTo(s, 9);
  });

  it('refuses a degenerate route', () => {
    expect(() => new RailPath([{ x: 0, y: 0, z: 0 }])).toThrow();
    expect(() => new RailPath([{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }])).toThrow(/coincide/);
    expect(() => new RailPath(L_SHAPE.slice(0, 2), true)).toThrow();
  });

  it('is deterministic: the same points give the same samples', () => {
    const a = new RailPath(L_SHAPE);
    const b = new RailPath(L_SHAPE);
    for (const s of [0, 2.5, 11, 20]) expect(a.sampleAt(s)).toEqual(b.sampleAt(s));
  });
});

describe('RailBlueprint', () => {
  const blueprint: RailBlueprint = { id: 'test-line', label: 'Test line', points: [{ u: -0.5, v: 0, heightM: 0.4 }, { u: 0.5, v: 0, heightM: 0.4 }] };

  it('lies on the real floor: every sample is the floor height under it plus the rail height, whatever the funnel depth', () => {
    for (const depthM of [0, 2.5, 8.5, 18]) {
      const floor = { id: 'bowl-b', depthM } as const;
      const rail = resolveRail(blueprint, { floor, floorRadiusM: ARENA_FLOOR_RADIUS });
      expect(rail.path.lengthM).toBeGreaterThan(30);
      for (let s = 0; s <= rail.path.lengthM; s += 3.7) {
        const p = rail.path.sampleAt(s).position;
        // On a straight piece between samples the rail is within a small chord error of the floor + height.
        expect(Math.abs(p.y - (floorHeightAt(floor, p.x, p.z) + 0.4))).toBeLessThan(0.05 + depthM * 0.005);
      }
    }
  });

  it('follows the stage size: authored in floor radii, so it is as long as the stage is wide', () => {
    const floor = { id: 'flat', depthM: 0 } as const;
    const normal = resolveRail(blueprint, { floor, floorRadiusM: 36 });
    const big = resolveRail(blueprint, { floor, floorRadiusM: 72 });
    expect(normal.path.lengthM).toBeCloseTo(36, 6);
    expect(big.path.lengthM).toBeCloseTo(72, 6);
    // No straight piece is longer than the resolve step.
    for (let i = 1; i < big.path.points.length; i++) {
      const a = big.path.points[i - 1]!;
      const b = big.path.points[i]!;
      expect(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)).toBeLessThan(RAIL_RESOLVE_STEP_M + 0.5);
    }
  });

  it('resolves a closed blueprint into a closed rail', () => {
    const ring: RailBlueprint = { id: 'ring', label: 'Ring', closed: true, points: [{ u: 0.5, v: 0, heightM: 0.3 }, { u: 0, v: 0.5, heightM: 0.3 }, { u: -0.5, v: 0, heightM: 0.3 }, { u: 0, v: -0.5, heightM: 0.3 }] };
    const rail = resolveRail(ring, { floor: 'flat', floorRadiusM: 36 });
    expect(rail.path.closed).toBe(true);
    expect(rail.path.lengthM).toBeCloseTo(4 * Math.hypot(18, 18), 6);
  });
});

describe('stage rails and the Pregame option', () => {
  it('every stage starts with two rails (owner, 2026-10-08: "2 pra iniciar"), the same provisional layout on all of them', () => {
    for (const preset of ARENA_PRESETS) expect(STAGE_RAIL_BLUEPRINTS[preset.id], preset.id).toHaveLength(2);
    for (const preset of ARENA_PRESETS) expect(railsForMatch({ stage: preset.id, railsEnabled: true, floor: { id: 'bowl-b', depthM: 8.5 }, floorRadiusM: 36 })).toHaveLength(2);
  });

  it('with the option off a stage has no rails at all, and with it on it has the stage\'s layout resolved onto the floor', () => {
    const blueprints = { foundry: [{ id: 'f', label: 'F', points: [{ u: 0, v: 0, heightM: 0.2 }, { u: 0.5, v: 0, heightM: 0.2 }] }], rift: [], tournament: [] } as const;
    const on = railsForMatch({ stage: 'foundry', railsEnabled: true, floor: { id: 'bowl-b', depthM: 8.5 }, floorRadiusM: 36, blueprints });
    expect(on).toHaveLength(1);
    expect(on[0]!.id).toBe('f');
    expect(on[0]!.path.lengthM).toBeGreaterThan(17);
    expect(railsForMatch({ stage: 'foundry', railsEnabled: false, floor: { id: 'bowl-b', depthM: 8.5 }, floorRadiusM: 36, blueprints })).toEqual([]);
    expect(railsForMatch({ stage: 'rift', railsEnabled: true, floor: 'flat', floorRadiusM: 36, blueprints })).toEqual([]);
  });

  it('Rails is a Pregame Advanced setting: on by default (provisional), in the match config, with a control, MODIFIED when off, reset by Reset all', () => {
    expect(createDefaultMatchConfig().railsEnabled).toBe(true);
    expect(defaultMatchRules().railsEnabled).toBe(true);
    expect(MATCH_RULE_KEYS).toContain('railsEnabled');
    const control = ADVANCED_CONTROLS.find((c) => c.key === 'railsEnabled')!;
    expect(control).toMatchObject({ kind: 'toggle', id: 'rails', category: 'arena' });
    let setup = createDefaultMatchSetup();
    expect(matchConfigFor(setup).railsEnabled).toBe(true);
    setup = writeAdvanced(setup, 'railsEnabled', false, true);
    expect(matchConfigFor(setup).railsEnabled).toBe(false);
    expect(isModified(setup, 'railsEnabled')).toBe(true);
    expect(modifiedKeys(setup)).toEqual(['railsEnabled']);
    expect(changedRuleLines(setup).join(' ')).toContain('Rails');
    expect(detectPreset(setup)).toBe('custom');
    expect(sanitizeMatchRules(setup.rules).railsEnabled).toBe(false);
    expect(withDefaultRules(setup).rules.railsEnabled).toBe(true);
  });

  it('no official preset turns rails off: every preset keeps the default', () => {
    const base = createDefaultMatchSetup();
    for (const id of ['normal', 'realistic', 'epic', 'smooth', 'strategic'] as const) {
      expect(advancedSnapshot(applyPreset(base, id)).railsEnabled, id).toBe(true);
    }
  });
});

describe('rail traversal contract', () => {
  it('starts not on a rail, and carries every field the doc requires to be observable', () => {
    expect(isOnRail(NOT_ON_RAIL)).toBe(false);
    expect(Object.keys(NOT_ON_RAIL).sort()).toEqual(['direction', 'entryReason', 'entrySpeedMps', 'exitReason', 'progressM', 'railId', 'speedMps', 'timeOnRailS']);
    expect(isOnRail({ ...NOT_ON_RAIL, railId: 'x' })).toBe(true);
  });

  it('names every tuning value of the doc (§12) in one place, with placeholders that are only for prototypes', () => {
    expect(Object.keys(PLACEHOLDER_RAIL_TUNING).sort()).toEqual(['accelerationMps2', 'attachCorrectionMaxMps', 'attachCorrectionPerS', 'captureRadiusM', 'entryAngleTolRad', 'entrySpeedCarry', 'exitLiftMps', 'exitSpeedCarry', 'exitTangentBlend', 'maxSpeedMps', 'minEntrySpeedMps', 'reattachCooldownS', 'staminaDrainPerS', 'startSpeedMps', 'targetSpeedMps']);
    for (const value of Object.values(PLACEHOLDER_RAIL_TUNING)) expect(Number.isFinite(value)).toBe(true);
  });
});

setArenaSizeScale(1);
