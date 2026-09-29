// ============================================================
// SFX LAB — LEVELS (loudness intent + loudness matching)
// Two tables, both tuning:
//
// TARGET_LOUDNESS — design intent: how loud each event should sit
//   relative to the others (a KO far above a floor contact, UI discreet,
//   loops in the background). K-weighted loudness (BS.1770, the LUFS
//   filter, ungated) over the audible part, after the master limiter; see
//   measure.ts.
//
// LEVEL_TRIM_DB — measured correction per direction so A, B and C reach
//   the same target: the comparison is about character, not about which
//   direction happens to be louder (louder always "sounds better").
//   Regenerated from measure.ts after changing a palette or recipe; the
//   smoke test checks the three directions stay within a few dB.
//
// Both are relative levels for the Lab's comparison, not final mix values
// for the game.
// ============================================================

import type { DirectionId } from '../directions';

export const TARGET_LOUDNESS: Readonly<Record<string, number>> = {
  spinHum: -27,
  floorScrape: -21,
  wallGrind: -22,
  dashCharge: -22.5,
  clashTension: -18.5,
  beyContact: -21.5,
  wallImpact: -20,
  landing: -21.5,
  hit: -18.5,
  counter: -17,
  circularStart: -22.5,
  dashRelease: -20,
  dodge: -23,
  dodged: -24.5,
  jump: -25,
  perfectDodge: -19,
  dashFull: -20.5,
  stabilityRecover: -22.5,
  staminaLow: -23,
  energyEmpty: -25,
  stabilityBreak: -18,
  clashStart: -17.5,
  clashMash: -27.5,
  clashResolve: -17.5,
  clashTie: -18,
  roundStart: -21,
  ringOut: -19,
  ko: -18.5,
  victory: -19,
  defeat: -20.5,
  draw: -20.5,
  uiFocus: -29.5,
  uiConfirm: -22,
  uiBack: -24.5,
  uiError: -24.5,
};

export const LEVEL_TRIM_DB: Readonly<Record<DirectionId, Readonly<Record<string, number>>>> = {
  A: { spinHum: -0.5, floorScrape: -1.5, wallGrind: 1, dashCharge: -1, clashTension: -1, beyContact: 6, wallImpact: 7, landing: 6.5, hit: 6, counter: 5, circularStart: 7, dashRelease: 3, dodge: 5.5, dodged: 6, jump: 7, perfectDodge: -0.5, dashFull: 1.5, stabilityRecover: 0, staminaLow: 1.5, energyEmpty: 6, stabilityBreak: 6.5, clashStart: 6, clashMash: 7.5, clashResolve: 5, clashTie: 4.5, roundStart: 6, ringOut: 1, ko: 3, victory: -2, defeat: -2.5, draw: -1.5, uiFocus: 6, uiConfirm: 2, uiBack: 2.5, uiError: 2 },
  B: { spinHum: -6.5, floorScrape: -5.5, wallGrind: -4.5, dashCharge: -5, clashTension: -5, beyContact: 12.5, wallImpact: 9.5, landing: 8.5, hit: 10.5, counter: 0, circularStart: 4.5, dashRelease: 2, dodge: 4.5, dodged: 6, jump: 7, perfectDodge: 0, dashFull: 0.5, stabilityRecover: -2, staminaLow: 6.5, energyEmpty: 10.5, stabilityBreak: -1, clashStart: 5.5, clashMash: 13, clashResolve: 8.5, clashTie: 0.5, roundStart: 1.5, ringOut: -1.5, ko: 1, victory: -2.5, defeat: -2.5, draw: -2.5, uiFocus: 3.5, uiConfirm: -4.5, uiBack: -4.5, uiError: -5.5 },
  C: { spinHum: -4, floorScrape: -7.5, wallGrind: -1, dashCharge: -2.5, clashTension: -4.5, beyContact: 5.5, wallImpact: 1.5, landing: 2.5, hit: 1.5, counter: 1, circularStart: 5, dashRelease: -0.5, dodge: 6.5, dodged: 7, jump: 6.5, perfectDodge: -0.5, dashFull: 5, stabilityRecover: 4, staminaLow: 2, energyEmpty: 5, stabilityBreak: 1.5, clashStart: 3, clashMash: 7.5, clashResolve: 0.5, clashTie: 2, roundStart: -4.5, ringOut: -1, ko: -0.5, victory: 7, defeat: 2, draw: 5.5, uiFocus: 11, uiConfirm: 6, uiBack: 5.5, uiError: 4 },
};

/** Linear gain for an event in a direction (0 dB when not listed). */
export function trimGain(direction: DirectionId, eventId: string): number {
  return Math.pow(10, (LEVEL_TRIM_DB[direction][eventId] ?? 0) / 20);
}
