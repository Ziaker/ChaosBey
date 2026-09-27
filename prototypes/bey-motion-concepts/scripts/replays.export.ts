// ============================================================
// BEY MOTION LAB — GAME REPLAY EXPORTER (tool, not a test)
// Runs two real AI-vs-AI matches in the game's own headless simulation
// (the same harness the deterministic tests use) and writes what the game
// actually did — per tick, per Bey: position, body orientation, visual
// spin angle, wobble, velocity, attack state, grounded — to JSON the lab
// replays. The lab itself still imports nothing from src/: it only reads
// this data. Re-run after a physics change to refresh the replays:
//
//   npx vitest run --config prototypes/bey-motion-concepts/scripts/vitest.export.config.ts
//
// Cases (M7 findings, investigated in the lab, NOT fixed in the game):
// - ext-0:  attack vs attack — a counter/knockback ending in a ring-out
//           about 1.7 s in.
// - ext-32: attack vs defense — a Bey wedged in the edge wall collider
//           for many seconds.
// ============================================================

import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { AIController } from '../../../src/ai/controllers/AIController';
import { DEFAULT_AI_DIFFICULTY_PROFILE } from '../../../src/ai/difficulty/AiDifficultyProfile';
import { personalityForBeyDefinitionId } from '../../../src/ai/personalities/AiArchetypePersonalities';
import { ARENA_FLOOR_RADIUS, ARENA_WALL_HEIGHT } from '../../../src/arena/colliders/ArenaTuning';
import { RINGOUT_RADIUS_M } from '../../../src/arena/ringout/RingOutTuning';
import { ATTACK_ARCHETYPE, DEFENSE_ARCHETYPE } from '../../../src/bey/archetype/BeyArchetypes';
import type { BeyDefinition } from '../../../src/bey/archetype/BeyDefinition';
import { NullAiMashSource } from '../../../src/combat/clash/ClashMash';
import { isGrounded } from '../../../src/physics/collision/GroundCheck';
import { FIXED_DELTA_SECONDS } from '../../../src/physics/fixed-step/FixedTimestepLoop';
import { SeededRng } from '../../../src/rng/SeededRng';
import { CombatHarness } from '../../../tests/deterministic/combatHarness';

const r3 = (n: number) => Math.round(n * 1000) / 1000;

async function exportReplay(file: string, title: string, seed: string, first: BeyDefinition, second: BeyDefinition, sampleEvery: number): Promise<void> {
  const harness = await CombatHarness.create(undefined, undefined, {}, new NullAiMashSource(), { first, second });
  const ais = [
    new AIController(harness.physics, harness.first, harness.second, harness.clash.controller, personalityForBeyDefinitionId(first.id), DEFAULT_AI_DIFFICULTY_PROFILE, SeededRng.fromSeedText(`${seed}/first`)),
    new AIController(harness.physics, harness.second, harness.first, harness.clash.controller, personalityForBeyDefinitionId(second.id), DEFAULT_AI_DIFFICULTY_PROFILE, SeededRng.fromSeedText(`${seed}/second`)),
  ];
  const beys = [harness.first, harness.second];
  // Per Bey, per sample: [x, y, z, qx, qy, qz, qw, spinAngle, wobbleOffset, vx, vy, vz, grounded(0/1)]
  const frames: number[][][] = [[], []];
  const states: string[][] = [[], []];
  const events: Array<{ t: number; kind: string; bey?: number; detail?: string }> = [];
  let tick = 0;
  for (; tick < 6000 && !harness.roundState.isOver; tick++) {
    const a = ais[0]!.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS });
    const b = ais[1]!.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS });
    const result = harness.tick(a, b);
    for (const hit of result.hitEvents) events.push({ t: r3(tick * FIXED_DELTA_SECONDS), kind: 'hit', bey: hit.attackerIsFirst ? 0 : 1, detail: hit.caughtOpponentDashing ? 'counter (caught a Dash)' : undefined });
    for (const e of result.combatEvents) if (e.kind === 'knockback') events.push({ t: r3(tick * FIXED_DELTA_SECONDS), kind: 'knockback', bey: e.targetIsFirst ? 0 : 1, detail: `force ${r3(e.force)}` });
    if (result.clashResolvedThisTick) events.push({ t: r3(tick * FIXED_DELTA_SECONDS), kind: 'clash resolved' });
    if (tick % sampleEvery !== 0) continue;
    beys.forEach((bey, i) => {
      const p = bey.body.translation();
      const q = bey.body.rotation();
      const v = bey.body.linvel();
      const spin = bey.spin.getSnapshot(bey.body);
      frames[i]!.push([p.x, p.y, p.z, q.x, q.y, q.z, q.w, spin.visualSpinAngleRad, spin.wobbleOffsetRad, v.x, v.y, v.z, isGrounded(harness.physics, bey.collider) ? 1 : 0].map(r3));
      states[i]!.push(bey.attack.getState());
    });
  }
  const replay = {
    title,
    seed,
    beys: [first.id, second.id],
    outcome: harness.roundState.result,
    endTick: tick,
    dt: FIXED_DELTA_SECONDS * sampleEvery,
    arena: { floorRadius: ARENA_FLOOR_RADIUS, wallHeight: ARENA_WALL_HEIGHT, ringOutRadius: RINGOUT_RADIUS_M },
    events,
    frames,
    states,
  };
  writeFileSync(new URL(`../src/replays/${file}`, import.meta.url), JSON.stringify(replay));
  console.log(`[replay] ${file}: ${tick} ticks, outcome ${replay.outcome}, ${events.length} events`);
}

it('exports the M7 replays', async () => {
  await exportReplay('m7-ext-0.json', 'M7 ext-0 — attack vs attack: knockback to ring-out in ~1.7 s', 'ext-0', ATTACK_ARCHETYPE, ATTACK_ARCHETYPE, 1);
  await exportReplay('m7-ext-32.json', 'M7 ext-32 — attack vs defense: Bey wedged in the edge wall', 'ext-32', ATTACK_ARCHETYPE, DEFENSE_ARCHETYPE, 2);
}, 300000);
