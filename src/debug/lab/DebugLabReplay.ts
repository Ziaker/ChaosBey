// ============================================================
// DEBUG LAB REPLAY (M9 lane D)
// Live playback check for the Debug Lab: as the replayed match ticks, the
// live session's state hash is compared with every checkpoint the file
// carries, so the panel can say "identical through tick N" or "DIVERGED
// at TicksCompleted N" while you watch it happen.
// ============================================================

import { arenaFloorOf } from '../../config/match/MatchConfig';
import { matchSpawnsFor } from '../../app/bootstrap/matchSpawns';
import { ATTACK_ARCHETYPE, DEFENSE_ARCHETYPE } from '../../bey/archetype/BeyArchetypes';
import type { StateHash, TicksCompleted } from '../../replay/contracts';
import type { ChaosBeyReplayV1 } from '../../replay/format/ChaosBeyReplayV1';
import type { ReplayCompatibility } from '../../replay/playback/replayPlayback';

export class LiveReplayCheck {
  private readonly expected: ReadonlyMap<TicksCompleted, StateHash>;
  private lastChecked: TicksCompleted | null = null;
  private divergedAt: TicksCompleted | null = null;

  constructor(readonly replay: ChaosBeyReplayV1) {
    this.expected = new Map(replay.checkpoints.map((c) => [c.ticksCompleted, c.hash]));
  }

  /** Ticks the recording covers: playback stops there. */
  get length(): number {
    return this.replay.frames.length;
  }

  get diverged(): boolean {
    return this.divergedAt !== null;
  }

  /** Compares the live state at `ticksCompleted` with the file's checkpoint there, if it has one. */
  check(ticksCompleted: TicksCompleted, liveHash: StateHash): void {
    const want = this.expected.get(ticksCompleted);
    if (want === undefined || this.divergedAt !== null) return;
    if (want !== liveHash) this.divergedAt = ticksCompleted;
    else this.lastChecked = ticksCompleted;
  }

  describe(ticksCompleted: TicksCompleted): string {
    if (this.divergedAt !== null) return `DIVERGED at TicksCompleted ${this.divergedAt} (last match ${this.lastChecked ?? 'none'})`;
    const done = ticksCompleted >= this.length;
    const through = this.lastChecked === null ? 'no checkpoint yet' : `identical through TicksCompleted ${this.lastChecked}`;
    return done ? `replay finished: VERIFIED, ${through} of ${this.length}` : `replaying: ${through} of ${this.length}`;
  }
}

/**
 * The Debug Lab plays the live game's match (Attack vs Defense on the live
 * spawns). A replay of any other match (e.g. a Self Test batch matchup)
 * can only be played headless; say why instead of diverging at tick 0.
 */
export function liveLabIncompatibility(replay: ChaosBeyReplayV1, compatibility: Extract<ReplayCompatibility, { ok: true }>): string | null {
  const ids = [compatibility.beys.first.id, compatibility.beys.second.id];
  if (ids[0] !== ATTACK_ARCHETYPE.id || ids[1] !== DEFENSE_ARCHETYPE.id) return `this replay is ${ids.join(' vs ')}; the Debug Lab plays ${ATTACK_ARCHETYPE.id} vs ${DEFENSE_ARCHETYPE.id} (replay it headless in the Self Test instead)`;
  const same = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => a.x === b.x && a.y === b.y && a.z === b.z;
  const live = matchSpawnsFor(arenaFloorOf({ ...replay.config.matchConfig, arenaFloor: replay.config.matchConfig.arenaFloor ?? 'flat' })); // profile + depth
  if (!same(replay.config.spawns.first, live.first) || !same(replay.config.spawns.second, live.second)) return 'this replay uses non-live spawns (replay it headless in the Self Test instead)';
  return null;
}
