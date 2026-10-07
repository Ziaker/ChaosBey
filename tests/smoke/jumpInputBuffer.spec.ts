import { expect, test, type Page } from '@playwright/test';
import { baselineUrl } from './presentationBaseline';
import type { Action } from '../../src/input/actions/Action';

// JUMP INPUT BUFFER — REAL-BROWSER REGRESSION (item H of the hotfix's
// required tests). DriftController's Idle/Recovering states used to gate
// beginHop() on a same-tick `jumpDriftPressed && grounded`: a press landing
// on a tick where grounded briefly read false was silently and permanently
// dropped. Confirmed happening in real AI matches via direct input-event/
// landing instrumentation (see PR history) before the fix.
//
// Rewritten for the current jump rules (owner, 2026-10-04/05): one X press is
// one flight, and a SECOND press made while the short hop is still in the air
// (held, with the Bey moving) is the drift — tap + hold — never a second hop.
// The regression the test guards is unchanged: a press made in the air just
// before landing must not be dropped. Now that means: it starts the drift
// right at the landing, and the Bey never takes off a second time.
//
// This drives the REAL engine end to end through the Debug Lab — real
// MatchSession, real Rapier physics, an idle opponent (so that a bump can't
// end the drift) — but through handle.step(1) rather than real-time
// page.keyboard input, so the exact airborne-press repro is reached by
// DETERMINISTIC single-tick stepping on a fixed seed, not by racing
// Playwright/CDP's input-dispatch jitter (see git history for that dead end).
// Two passes on the IDENTICAL seed:
// 1. a probe pass that taps JumpDrift once and records grounded/DriftState
//    every tick, to find the exact tick where this run lands (no guessed or
//    hardcoded physics numbers);
// 2. a repro pass that presses JumpDrift again 3 ticks before that landing and
//    keeps it held, then asserts the drift starts (the press was kept, not
//    dropped) and that there is no second hop.
// Deterministic end to end (fixed seed, tick-stepped, no wall-clock
// dependency) — must pass every run with no retries (playwright.config.ts's
// project default is already retries: 0; this file adds no override).

const SEED = 'jump-input-buffer-repro-h';
const SETTLE_TICKS = 60; // matches this suite's usual "let the spawn-drop settle" convention.
const RUN_UP_TICKS = 45; // forward the whole time, a short run-up before the tap (at the Beys' speed a longer one reaches the wall).
const PROBE_TICKS = 70; // past a bare-tap hop's landing, short of the wall.
const DRIFT_START_TICKS = 12; // the press is answered at once: the fast drop starts the drift ~0.1 s (6 ticks) later.
const BOUNCE_SEARCH_WINDOW_TICKS = 20; // how far past landing to look for the bounce.

interface TraceRow {
  tick: number;
  state: string;
  grounded: boolean | null;
}

async function waitForLabReady(page: Page): Promise<void> {
  await page.goto(baselineUrl('/ChaosBey/?mode=debug-lab'));
  await expect(page.getByTestId('debug-lab-status')).toContainText('RUNNING', { timeout: 15_000 });
}

/** One deterministic run on `seedText`: forward the whole time, tap JumpDrift once at SETTLE_TICKS, optionally press it again at `secondPressTick` and keep it held. Returns the full per-tick trace. */
async function runTappedMatch(page: Page, seedText: string, secondPressTick: number | null): Promise<TraceRow[]> {
  return page.evaluate(
    async ({ seedText, secondPressTick, settleTicks, runUpTicks, probeTicks }) => {
      const handle = window.__chaosBeyDebugLab;
      if (!handle) throw new Error('no Debug Lab handle');
      // The flat floor: this checks the input buffer, and the default funnel's slope makes a Bey running at speed leave the
      // floor on its own (grounded false for a tick or two), which is not the landing bounce this test looks for.
      await handle.setArenaFloor('flat');
      await handle.restart(seedText);
      handle.setController('second', { kind: 'idle' });
      // Off to the side, out of the run's path: the Beys are fast, and a Bey running straight at the idle opponent (spawned
      // 21 m ahead) bumped into it ~1.3 s in — a knock that reads grounded === false for a few ticks, which this test
      // once mistook for a landing bounce.
      const second = handle.getSession()!.getBey('second').body;
      second.setTranslation({ x: 16, y: second.translation().y, z: 12 }, true);
      const JumpDrift = 'JumpDrift' as Action;
      const MoveForward = 'MoveForward' as Action;
      const frames: { fromTick: number; held: Action[] }[] = [
        { fromTick: 0, held: [] },
        { fromTick: settleTicks - runUpTicks, held: [MoveForward] },
        { fromTick: settleTicks, held: [MoveForward, JumpDrift] },
        { fromTick: settleTicks + 1, held: [MoveForward] },
      ];
      if (secondPressTick !== null) frames.push({ fromTick: secondPressTick, held: [MoveForward, JumpDrift] });
      handle.setController('first', { kind: 'scripted', label: 'jump-input-buffer', frames });
      handle.setPaused(true);
      const totalTicks = settleTicks + probeTicks;
      const trace: { tick: number; state: string; grounded: boolean | null }[] = [];
      for (let i = 0; i < totalTicks; i++) {
        handle.step(1);
        const session = handle.getSession();
        if (!session) throw new Error('no session');
        const state = session.getBey('first').drift.getState();
        const grounded = session.getLastResult()?.first.grounded ?? null;
        trace.push({ tick: i, state, grounded });
      }
      return trace;
    },
    { seedText, secondPressTick, settleTicks: SETTLE_TICKS, runUpTicks: RUN_UP_TICKS, probeTicks: PROBE_TICKS },
  );
}

/** Ticks where DriftState transitioned INTO 'Hopping' (one entry per hop that actually began). */
function hopStartTicks(trace: readonly TraceRow[]): number[] {
  const starts: number[] = [];
  let previous = 'Idle';
  for (const row of trace) {
    if (previous !== 'Hopping' && row.state === 'Hopping') starts.push(row.tick);
    previous = row.state;
  }
  return starts;
}

test('jump input buffer: a JumpDrift press made in the air just before landing is kept — it starts the drift (tap + hold), exactly one hop, instead of being dropped', async ({ page }) => {
  test.setTimeout(60_000);
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));

  await waitForLabReady(page);

  // Pass 1 (probe): one bare tap, no second press. Find this seed's own landing tick (never a guessed/hardcoded physics number).
  const probe = await runTappedMatch(page, SEED, null);
  const probeHopStarts = hopStartTicks(probe);
  expect(probeHopStarts.length, 'the bare tap must produce a hop at all').toBeGreaterThan(0);
  const hopStart = probeHopStarts[0]!;

  let landedTick = -1;
  for (let t = hopStart + 1; t < probe.length; t++) {
    if (probe[t]!.state === 'Idle') {
      landedTick = t;
      break;
    }
  }
  expect(landedTick, 'the hop must land back in Idle within the probe window').toBeGreaterThan(hopStart);

  // One X press = one flight (owner, 2026-10-02, Lote 4): landing from the Bey's own hop does not bounce, so there is no
  // "grounded briefly false" tick after it (measured on the flat floor: the first tick after landing has no vertical
  // speed). A second press is the drift press — tap + hold (owner, 2026-10-04): a press made in the air just before
  // landing (the same drop the old bug made, PR #76) must be KEPT. Kept now means: the drift starts right away, and the
  // Bey never takes off a second time.
  for (let t = landedTick; t < Math.min(probe.length, landedTick + BOUNCE_SEARCH_WINDOW_TICKS); t++) {
    expect(probe[t]!.grounded, `no landing bounce after the Bey's own hop (tick ${t})`).toBe(true);
  }
  const airTick = landedTick - 3;
  expect(probe[airTick]!.grounded, 'the repro press lands in the air').toBe(false);
  const repro = await runTappedMatch(page, SEED, airTick);
  expect(hopStartTicks(repro), 'one tap, one flight: the press made in the air must not begin a second hop').toHaveLength(1);
  const driftStart = repro.findIndex((row, t) => t > airTick && row.state === 'Drifting');
  expect(driftStart, 'the press made in the air must start the drift — not be dropped').toBeGreaterThan(airTick);
  expect(driftStart - airTick, 'the kept press is answered right away').toBeLessThanOrEqual(DRIFT_START_TICKS);

  expect(consoleErrors, `console errors: ${consoleErrors.join('\n')}`).toEqual([]);
});
