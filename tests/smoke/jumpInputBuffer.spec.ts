import { expect, test, type Page } from '@playwright/test';
import { baselineUrl } from './presentationBaseline';
import type { Action } from '../../src/input/actions/Action';

// JUMP INPUT BUFFER — REAL-BROWSER REGRESSION (item H of the hotfix's
// required tests). DriftController's Idle/Recovering states used to gate
// beginHop() on a same-tick `jumpDriftPressed && grounded`: a press landing
// on a tick where grounded briefly read false (the landing-contact bounce a
// hop produces right after touchdown — the same bounce DRIFT_AIRBORNE_GRACE_S's
// own tuning comment in DriftTuning.ts relies on existing) was silently and
// permanently dropped. Confirmed happening in real AI matches via direct
// input-event/landing instrumentation (see PR history) before the fix.
//
// This drives the REAL engine end to end through the Debug Lab — real
// MatchSession, real Rapier physics, a live AI opponent — but through
// handle.step(1) rather than real-time page.keyboard input, so the exact
// airborne-press repro is reached by DETERMINISTIC single-tick stepping on a
// fixed seed, not by racing Playwright/CDP's input-dispatch jitter (see
// git history for that dead end). Two passes on the IDENTICAL seed:
// 1. a probe pass that taps JumpDrift once and records grounded/DriftState
//    every tick, to find the exact tick where this run's own landing bounce
//    reads grounded === false (no guessed/hardcoded physics numbers);
// 2. a repro pass that sends a SECOND JumpDrift tap on exactly that tick,
//    then asserts the second hop still begins (the press was buffered, not
//    dropped) exactly once.
// Deterministic end to end (fixed seed, tick-stepped, no wall-clock
// dependency) — must pass every run with no retries (playwright.config.ts's
// project default is already retries: 0; this file adds no override).

const SEED = 'jump-input-buffer-repro-h';
const SETTLE_TICKS = 60; // matches this suite's usual "let the spawn-drop settle" convention.
const PROBE_TICKS = 220; // generous margin past any bare-tap hop's full landing + bounce.
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

/** One deterministic run on `seedText`: settle, tap JumpDrift once at SETTLE_TICKS, optionally a second tap at `secondTapTick`. Returns the full per-tick trace. */
async function runTappedMatch(page: Page, seedText: string, secondTapTick: number | null): Promise<TraceRow[]> {
  return page.evaluate(
    async ({ seedText, secondTapTick, settleTicks, probeTicks }) => {
      const handle = window.__chaosBeyDebugLab;
      if (!handle) throw new Error('no Debug Lab handle');
      await handle.restart(seedText);
      handle.setController('second', { kind: 'ai', personality: 'archetype' });
      const JumpDrift = 'JumpDrift' as Action;
      const frames: { fromTick: number; held: Action[] }[] = [
        { fromTick: 0, held: [] },
        { fromTick: settleTicks, held: [JumpDrift] },
        { fromTick: settleTicks + 1, held: [] },
      ];
      if (secondTapTick !== null) {
        frames.push({ fromTick: secondTapTick, held: [JumpDrift] }, { fromTick: secondTapTick + 1, held: [] });
      }
      handle.setController('first', { kind: 'scripted', label: 'jump-input-buffer', frames });
      handle.setPaused(true);
      const totalTicks = secondTapTick !== null ? secondTapTick + probeTicks : probeTicks;
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
    { seedText, secondTapTick, settleTicks: SETTLE_TICKS, probeTicks: PROBE_TICKS },
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

test('jump input buffer: a JumpDrift press on this run\'s own landing-bounce tick (grounded briefly false) still begins a hop, exactly once, instead of being dropped', async ({ page }) => {
  test.setTimeout(60_000);
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));

  await waitForLabReady(page);

  // Pass 1 (probe): one bare tap, no second press. Find this seed's own
  // landing-bounce tick — the first tick, shortly after landing back in
  // Idle, where grounded reads false again (never a guessed/hardcoded
  // physics number).
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

  // Owner, 2026-10-02 (Lote 4): one X press = one flight — landing from the Bey's own hop no longer bounces, so the
  // old "press on the landing-bounce tick" situation cannot happen any more: check that, then that a press made in the
  // air just before landing (the same drop the old bug made, PR #76) begins exactly one more hop on landing.
  for (let t = landedTick; t < Math.min(probe.length, landedTick + BOUNCE_SEARCH_WINDOW_TICKS); t++) {
    expect(probe[t]!.grounded, `no landing bounce after the Bey's own hop (tick ${t})`).toBe(true);
  }
  const airTick = landedTick - 3;
  expect(probe[airTick]!.grounded, 'the repro press lands in the air').toBe(false);
  const repro = await runTappedMatch(page, SEED, airTick);
  const secondHopStarts = hopStartTicks(repro).filter((t) => t > airTick);
  expect(secondHopStarts.length, 'the press made in the air must begin exactly one more hop on landing — not zero (dropped, the old bug) and not more than one').toBe(1);
  expect(secondHopStarts[0]! - landedTick, 'the kept press is used right at the landing').toBeLessThanOrEqual(3);

  expect(consoleErrors, `console errors: ${consoleErrors.join('\n')}`).toEqual([]);
});
