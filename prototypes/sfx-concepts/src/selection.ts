// ============================================================
// SFX LAB — SELECTION STATE (the owner's per-event decisions)
// Each event independently gets A, B, C or SEM SOM ('none'). An event the
// owner has not decided yet stays `null`: the Lab never silently picks a
// direction for them. Wherever a pending event must still make a sound
// (the live match, the context sequences), the global "pré-escuta"
// direction stands in for it, and the summary lists it as pending.
//
// Pure data + (optional) localStorage persistence. Browser storage can be
// missing or throw (private windows, previews), so every access is
// guarded and the Lab works the same without it.
// ============================================================

import { BUSES, EVENTS, type BusId } from './catalog';
import type { DirectionId } from './directions';

export type Choice = DirectionId | 'none';

export interface LabSettings {
  readonly choices: Readonly<Record<string, Choice | null>>;
  /** Stands in for events not decided yet (never saved as a decision). */
  readonly preview: DirectionId;
  readonly masterVolume: number;
  readonly busVolumes: Readonly<Record<BusId, number>>;
}

export const STORAGE_KEY = 'chaosbey.sfxLab.v1';

export function defaultSettings(): LabSettings {
  const choices: Record<string, Choice | null> = {};
  for (const event of EVENTS) choices[event.id] = null;
  const busVolumes = Object.fromEntries(BUSES.map((b) => [b.id, 1])) as Record<BusId, number>;
  return { choices, preview: 'A', masterVolume: 0.8, busVolumes };
}

const CHOICES: readonly Choice[] = ['A', 'B', 'C', 'none'];

function isChoice(value: unknown): value is Choice {
  return typeof value === 'string' && (CHOICES as readonly string[]).includes(value);
}

function clamp01(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
}

/** Reads saved settings, keeping only known events and valid values (anything else falls back to the default). */
export function parseSettings(raw: string | null): LabSettings {
  const base = defaultSettings();
  if (!raw) return base;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return base;
  }
  if (typeof data !== 'object' || data === null) return base;
  const record = data as Record<string, unknown>;
  const choices: Record<string, Choice | null> = { ...base.choices };
  const savedChoices = record.choices;
  if (typeof savedChoices === 'object' && savedChoices !== null) {
    for (const event of EVENTS) {
      const value = (savedChoices as Record<string, unknown>)[event.id];
      if (isChoice(value)) choices[event.id] = value;
    }
  }
  const preview = record.preview === 'A' || record.preview === 'B' || record.preview === 'C' ? record.preview : base.preview;
  const busVolumes = { ...base.busVolumes };
  const savedBuses = record.busVolumes;
  if (typeof savedBuses === 'object' && savedBuses !== null) {
    for (const bus of BUSES) busVolumes[bus.id] = clamp01((savedBuses as Record<string, unknown>)[bus.id], busVolumes[bus.id]);
  }
  return { choices, preview, masterVolume: clamp01(record.masterVolume, base.masterVolume), busVolumes };
}

export function serializeSettings(settings: LabSettings): string {
  return JSON.stringify({ version: 1, ...settings });
}

export function withChoice(settings: LabSettings, eventId: string, choice: Choice | null): LabSettings {
  return { ...settings, choices: { ...settings.choices, [eventId]: choice } };
}

/** What actually plays for an event: its decision, or the pré-escuta direction while pending. */
export function effectiveChoice(settings: LabSettings, eventId: string): Choice {
  return settings.choices[eventId] ?? settings.preview;
}

export interface SelectionSummary {
  readonly counts: Readonly<Record<Choice | 'pending', number>>;
  readonly rows: readonly { readonly id: string; readonly label: string; readonly category: string; readonly choice: Choice | 'pending' }[];
}

export function summarize(settings: LabSettings): SelectionSummary {
  const counts: Record<Choice | 'pending', number> = { A: 0, B: 0, C: 0, none: 0, pending: 0 };
  const rows = EVENTS.map((event) => {
    const choice: Choice | 'pending' = settings.choices[event.id] ?? 'pending';
    counts[choice]++;
    return { id: event.id, label: event.label, category: event.category, choice };
  });
  return { counts, rows };
}

/** The decision file the owner can copy/download (no pré-escuta stand-ins: pending stays pending). */
export function exportDecisions(settings: LabSettings, now: Date = new Date()): string {
  const summary = summarize(settings);
  return JSON.stringify(
    {
      lab: 'ChaosBey SFX Lab',
      version: 1,
      exportedAt: now.toISOString(),
      counts: summary.counts,
      decisions: summary.rows,
    },
    null,
    2,
  );
}

export function loadSettings(storage: Pick<Storage, 'getItem'> | null): LabSettings {
  try {
    return parseSettings(storage?.getItem(STORAGE_KEY) ?? null);
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(storage: Pick<Storage, 'setItem'> | null, settings: LabSettings): boolean {
  try {
    storage?.setItem(STORAGE_KEY, serializeSettings(settings));
    return storage !== null;
  } catch {
    return false;
  }
}
