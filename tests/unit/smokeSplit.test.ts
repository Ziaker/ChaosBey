// Polish idea 9: the fast/slow split of the browser smoke suite stays honest.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SLOW_SPECS } from '../smoke/slowSpecs';

const smokeDir = join(__dirname, '..', 'smoke');
const specs = readdirSync(smokeDir).filter((f) => f.endsWith('.spec.ts'));

describe('smoke suite split (fast on pull requests, everything on main)', () => {
  it('every slow spec is a real file (a rename cannot silently move a spec to the fast set)', () => {
    for (const file of SLOW_SPECS) expect(existsSync(join(smokeDir, file)), file).toBe(true);
    expect(new Set(SLOW_SPECS).size).toBe(SLOW_SPECS.length);
  });

  it('the fast set keeps the quick checks of the boot, menus, settings, Pregame, controls, drift and the lab', () => {
    const fast = specs.filter((f) => !SLOW_SPECS.includes(f));
    for (const needed of ['boot.spec.ts', 'mainMenu.spec.ts', 'pregameOptions.spec.ts', 'settingsPauseGamepad.spec.ts', 'playerDirectionalControl.spec.ts', 'driftFeedback.spec.ts', 'jumpInputBuffer.spec.ts', 'debugLab.spec.ts']) {
      expect(fast, needed).toContain(needed);
    }
    expect(fast.length).toBeGreaterThan(SLOW_SPECS.length); // the fast set is the larger half in files, the smaller in minutes
  });
});
