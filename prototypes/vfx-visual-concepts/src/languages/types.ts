// ============================================================
// VFX LAB — VISUAL LANGUAGE CONTRACT
// A "language" is one complete visual answer to every combat event, so
// all effects in the game read as one system (GDD section 51/54).
// Scenarios fire gameplay-like events; languages decide how they LOOK.
// `m` is always the normalized impact/charge magnitude in [0, 1] — VFX
// must scale with it and never visually lie about power (GDD 51).
// ============================================================

import type * as THREE from 'three';
import type { FxLayer, StreakSparks } from '../fx/FxLayer';

export type Slot = 0 | 1;

/** Services a world offers to a language. */
export interface FxContext {
  readonly scene: THREE.Scene;
  readonly camera: THREE.Camera;
  readonly layer: FxLayer;
  readonly sparks: StreakSparks;
  floorHeightAt(r: number): number;
  /** Signature color of each Bey (from its palette) — for colored energy effects. */
  beyColor(slot: Slot): THREE.Color;
  /** Arena spark palette [hot, cool] so sparks match the arena. */
  readonly arenaSparks: readonly [number, number];
  /** Camera shake: amplitude in meters, duration in seconds. */
  shake(amplitude: number, seconds: number): void;
  /** Freeze the scene for `seconds` (hitstop, GDD 26). */
  hitstop(seconds: number): void;
  /** Temporary slow motion factor for `seconds` of real time. */
  slowMotion(factor: number, seconds: number): void;
  /** Silhouette "impact frame" for `seconds` (anime). */
  impactFrame(seconds: number): void;
  /** Screen-space focus/speed lines around a world point. */
  focusLines(at: THREE.Vector3, strength: number, seconds: number, color?: string): void;
  /** Full-viewport color tint (e.g. perfect-dodge desaturation). */
  tint(css: string, seconds: number): void;
  /** Brief point-light flash. */
  flash(at: THREE.Vector3, color: number, intensity: number): void;
  /** Ghost copy of a Bey at its current pose, using `material`. */
  ghost(slot: Slot, material: THREE.Material): THREE.Object3D;
}

export interface HitEvent { pos: THREE.Vector3; normal: THREE.Vector3; m: number; attacker: Slot }
export interface ChargeEvent { pos: THREE.Vector3; progress: number; m: number; slot: Slot }
export interface ReleaseEvent { pos: THREE.Vector3; dir: THREE.Vector3; m: number; slot: Slot }
export interface MoveEvent { pos: THREE.Vector3; vel: THREE.Vector3; m: number; slot: Slot }
export interface PointEvent { pos: THREE.Vector3; m: number; slot: Slot }
export interface ScrapeEvent { pos: THREE.Vector3; normal: THREE.Vector3; tangent: THREE.Vector3; m: number; slot: Slot }
export interface DirEvent { pos: THREE.Vector3; dir: THREE.Vector3; m: number; slot: Slot }

/** Per-world instance of a language. Every handler is optional-free: a language answers all events. */
export interface LanguageRuntime {
  /** Bey-to-Bey (or attack) impact. */
  hit(e: HitEvent): void;
  /** Dash Attack charging (called every frame while charging). */
  dashCharge(e: ChargeEvent, dt: number): void;
  /** Dash Attack release. */
  dashRelease(e: ReleaseEvent): void;
  /** Fast movement (called every frame while a Bey moves fast). */
  fastMove(e: MoveEvent, dt: number): void;
  /** Circular Attack sweep (called every frame while active; progress in e.m's companion `t`). */
  circularSweep(e: PointEvent, t: number, dt: number): void;
  /** Perfect Dodge moment. */
  perfectDodge(e: DirEvent): void;
  /** While dodging (afterimages), every frame. */
  dodgeMove(e: MoveEvent, dt: number): void;
  /** Stability Break moment. */
  stabilityBreak(e: PointEvent): void;
  /** Broken Bey wobbling and grinding, every frame. */
  wobble(e: PointEvent, dt: number): void;
  /** Landing after a jump/launch. */
  landing(e: PointEvent): void;
  /** Scraping along the wall, every frame. */
  scrape(e: ScrapeEvent, dt: number): void;
  /** Sudden advance (dash / dodge activation): wind burst behind the Bey. `dir` = movement direction. */
  windBurst(e: DirEvent): void;
  /** Ring-out moment (Bey crosses the boundary). */
  ringOut(e: DirEvent): void;
  /** Ambient per-frame update. */
  tick(dt: number): void;
}

export interface VfxLanguage {
  readonly id: 'A' | 'B' | 'C';
  readonly name: string;
  readonly summary: string;
  /** What this language does for each scenario, shown in the panel. */
  readonly notes: Readonly<Record<string, string>>;
  create(ctx: FxContext): LanguageRuntime;
}
