// M10 lane C: arena presets and the two arena sliders (wall height and
// wall bounce). The values are gameplay: they build the wall colliders,
// travel in MatchConfig and replays, and change how rounds end.

import { describe, expect, it } from 'vitest';
import {
  ARENA_PRESETS,
  ARENA_WALL_BOUNCE_RANGE,
  ARENA_WALL_HEIGHT_RANGE,
  DEFAULT_ARENA_PRESET,
  FOUNDRY_PIT,
  RIFT_CRATER,
  STANDARD_ARENA_GEOMETRY,
  TOURNAMENT_STADIUM,
  arenaPreset,
  isPresetGeometry,
} from '../../src/arena/presets/ArenaPresets';
import { ARENA_WALL_HEIGHT } from '../../src/arena/colliders/ArenaTuning';
import { WALL_MATERIAL } from '../../src/physics/materials/PhysicsMaterials';
import { arenaGeometryOf, createDefaultMatchConfig } from '../../src/config/match/MatchConfig';
import { ATTACK_ARCHETYPE, DEFENSE_ARCHETYPE, STAMINA_ARCHETYPE } from '../../src/bey/archetype/BeyArchetypes';
import { simulateAiMatch } from '../../src/self-test/AiMatchSimulation';
import { currentRuntimeFingerprint } from '../../src/replay/format/runtimeFingerprint';
import { decodeReplay, encodeReplay, sealReplay } from '../../src/replay/format/ChaosBeyReplayV1';
import { playReplayHeadless } from '../../src/replay/playback/replayPlayback';

describe('arena presets', () => {
  it('are the three approved directions; Foundry Pit, the default, is the arena every earlier milestone played', () => {
    expect(ARENA_PRESETS.map((p) => p.label)).toEqual(['Foundry Pit', 'Rift Crater', 'Tournament Stadium']);
    expect(DEFAULT_ARENA_PRESET).toBe('foundry');
    expect(STANDARD_ARENA_GEOMETRY).toEqual({ wallHeightM: ARENA_WALL_HEIGHT, wallRestitution: WALL_MATERIAL.restitution });
    expect(FOUNDRY_PIT.geometry).toEqual(STANDARD_ARENA_GEOMETRY);
    // M11 lane 4: the default floor is flat (the bowls are playtest options).
    expect(arenaGeometryOf(createDefaultMatchConfig())).toEqual({ ...STANDARD_ARENA_GEOMETRY, floor: 'flat' });
    expect(arenaPreset('rift')).toBe(RIFT_CRATER);
  });

  it('keep every value inside the slider ranges, and tell a moved slider apart', () => {
    for (const preset of ARENA_PRESETS) {
      expect(preset.geometry.wallHeightM).toBeGreaterThanOrEqual(ARENA_WALL_HEIGHT_RANGE.min);
      expect(preset.geometry.wallHeightM).toBeLessThanOrEqual(ARENA_WALL_HEIGHT_RANGE.max);
      expect(preset.geometry.wallRestitution).toBeGreaterThanOrEqual(ARENA_WALL_BOUNCE_RANGE.min);
      expect(preset.geometry.wallRestitution).toBeLessThanOrEqual(ARENA_WALL_BOUNCE_RANGE.max);
      expect(isPresetGeometry(preset.id, preset.geometry)).toBe(true);
    }
    expect(isPresetGeometry('rift', { ...RIFT_CRATER.geometry, wallHeightM: 1.2 })).toBe(false);
  });
});

describe('arena values in real matches', () => {
  it('a low, soft rim ends rounds sooner and by ring-out; a tall, bouncy barrier keeps Beys in', async () => {
    const run = async (geometry: typeof STANDARD_ARENA_GEOMETRY) => {
      let ringOuts = 0;
      let ticks = 0;
      const pairs = [
        [ATTACK_ARCHETYPE, DEFENSE_ARCHETYPE],
        [DEFENSE_ARCHETYPE, STAMINA_ARCHETYPE],
        [STAMINA_ARCHETYPE, ATTACK_ARCHETYPE],
      ] as const;
      for (const [first, second] of pairs) {
        for (let i = 0; i < 5; i++) {
          const record = await simulateAiMatch({
            seed: `arena-${i}`,
            firstDefinition: first,
            secondDefinition: second,
            matchConfigOverrides: { arenaWallHeightM: geometry.wallHeightM, arenaWallRestitution: geometry.wallRestitution },
          });
          if (String(record.stats.outcome).includes('RingOut')) ringOuts++;
          ticks += record.stats.ticks;
        }
      }
      return { ringOuts, ticks };
    };
    const rift = await run(RIFT_CRATER.geometry);
    const tournament = await run(TOURNAMENT_STADIUM.geometry);
    // Measured: Rift 15/15 ring-outs in 6338 ticks; Tournament 10/15 in 13190.
    expect(rift.ringOuts).toBeGreaterThan(tournament.ringOuts);
    expect(rift.ticks).toBeLessThan(tournament.ticks * 0.7);
  }, 300_000);

  it('are recorded in the replay and used on playback: a different wall diverges', async () => {
    const fingerprint = await currentRuntimeFingerprint();
    const record = await simulateAiMatch({
      seed: 'arena-0',
      firstDefinition: ATTACK_ARCHETYPE,
      secondDefinition: DEFENSE_ARCHETYPE,
      matchConfigOverrides: { arenaWallHeightM: RIFT_CRATER.geometry.wallHeightM, arenaWallRestitution: RIFT_CRATER.geometry.wallRestitution },
      record: { fingerprint },
    });
    const replay = record.replay!;
    expect(replay.config.matchConfig).toMatchObject({ arenaWallHeightM: 1, arenaWallRestitution: 0.4 });
    expect((await playReplayHeadless(replay, fingerprint)).status).toBe('verified');

    const { integrity: _integrity, ...rest } = replay;
    const standardWall = sealReplay({ ...rest, config: { ...rest.config, matchConfig: { ...rest.config.matchConfig, ...{ arenaWallHeightM: 2, arenaWallRestitution: 0.55 } } } });
    const decoded = decodeReplay(encodeReplay(standardWall));
    expect(decoded.ok).toBe(true);
    const verdict = await playReplayHeadless(standardWall, fingerprint);
    expect(verdict.status).toBe('diverged');
  }, 300_000);
});
