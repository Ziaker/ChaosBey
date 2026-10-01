import { it } from 'vitest';
import * as fs from 'node:fs';
import { runScenario } from '../../src/self-test/scenarios/ScenarioRunner';
import { findScenarioPreset } from '../../src/self-test/scenarios/ScenarioPresets';
it('dbg', async () => {
  const r = await runScenario(findScenarioPreset('clash-cooldown-collision')!);
  fs.appendFileSync('/tmp/claude-0/-home-user-ChaosBey/67e9cd76-2b84-524d-a0bc-56d7c5d89dc6/scratchpad/dbg5.txt', 'OFF=' + process.env.OFF + ' EXTRA=' + process.env.SWEEP + ' ' + r.status + ' ' + r.detail + '\n');
}, 300000);
