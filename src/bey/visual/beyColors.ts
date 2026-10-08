// ============================================================
// BEY COLORS — the one place that says what color a Bey is
// Owner, 2026-10-07: every Bey (all nine, including the B and C of a family) has its own color, and the colors drive the
// Clash bar. Everything that needs "the color of this Bey" — the roster and Character Select accent, the HUD cards and
// pips, the Clash bar — asks here, so when the four pieces get their own colors (PieceColorOverrides in model/types.ts,
// docs/design-decisions/bey-colors-plan.md) the change is made in this file and nowhere else.
// Presentation only: nothing here reaches a collider, mass or stat.
// ============================================================

import { conceptBeyFor } from '../archetype/BeyConceptRoster';
import { CONCEPTS } from './concepts/conceptDefinitions';
import type { BeyPieceName } from './model/types';

export interface BeyColors {
  /** The Bey's main color: its largest painted surfaces. */
  readonly primary: number;
  /** The bright color that stands for the Bey in the UI (cards, pips, Character Select light, the Clash bar). */
  readonly glow: number;
  /** A second color of the Bey: what a Clash bar half falls back to when both Beys are the same one. */
  readonly accent: number;
}

/** 0xrrggbb → '#rrggbb'. */
export function cssHex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

/** The colors of a gameplay definition (the nine selectable Beys), or null for a Bey without a concept (the generic default, test definitions). */
export function beyColorsFor(definitionId: string): BeyColors | null {
  const concept = conceptBeyFor(definitionId);
  const visual = concept ? CONCEPTS.find((c) => c.id === concept.conceptId) : undefined;
  if (!visual) return null;
  // PLANNED: once pieces have their own colors, the Bey's UI color comes from its impact piece (the ring) when it has one.
  const palette = visual.palette;
  return { primary: palette.primary, glow: palette.glow, accent: palette.accent };
}

/** The pieces that will carry their own color; the order the plan lists them in. */
export const BEY_COLORED_PIECES: readonly BeyPieceName[] = ['topLayer', 'ring', 'disc', 'driver'];

/**
 * The CSS colors of the two halves of the Clash bar (and the two sides' UI accents in general). Each side wears its own
 * Bey's color; when both are the same Bey (a mirror match) or colors so close they could not be told apart, the second
 * side takes its Bey's second color.
 */
export function sideAccentsCss(firstFallbackCss: string, firstId: string, secondFallbackCss: string, secondId: string): { readonly first: string; readonly second: string } {
  const first = beyColorsFor(firstId);
  const second = beyColorsFor(secondId);
  const firstCss = first ? cssHex(first.glow) : firstFallbackCss;
  const secondMain = second ? cssHex(second.glow) : secondFallbackCss;
  const tooClose = distance(firstCss, secondMain) < SIDE_COLOR_MIN_DISTANCE;
  return { first: firstCss, second: tooClose && second ? cssHex(second.accent) : secondMain };
}

/** Euclidean RGB distance (0..441) under which two side colors read as the same. */
export const SIDE_COLOR_MIN_DISTANCE = 60;

function channels(css: string): [number, number, number] {
  const n = Number.parseInt(css.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function distance(a: string, b: string): number {
  const [ar, ag, ab] = channels(a);
  const [br, bg, bb] = channels(b);
  return Math.hypot(ar - br, ag - bg, ab - bb);
}
