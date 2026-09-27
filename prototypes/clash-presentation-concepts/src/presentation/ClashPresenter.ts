// ============================================================
// CLASH PRESENTATION LAB — PRESENTATION DIRECTOR
// Turns one DirectionConfig + the current ClashStageSim tick result into
// concrete FX/host calls and into the per-tick presentation levels the
// view reads (contact lean, HUD share, speedline strength). This is the
// only file that reads a DirectionConfig's numbers — swapping A/B/C only
// ever changes what this class does, never the fixed rules underneath
// (ClashStageSim/ClashHarness/src/combat/clash/ stay identical for all
// three).
//
// SHOW, DON'T TELL: nothing here writes the result on screen. Who is
// ahead is the HUD bar; who won is the impact, the knockback and the
// fight carrying on — never a banner, and never a pause (no hitstop or
// slow motion on the resolution).
// ============================================================

import * as THREE from 'three';
import { ClashOutcome } from '../../../../src/combat/clash/ClashController';
import type { ClashStageSim, ClashStageTickResult } from '../sim/ClashStageSim';
import type { ClashFx } from '../fx/ClashFx';
import type { DirectionConfig, TieStyleId } from './types';
import { hudShare } from './contactPose';

export interface PresentationHost {
  requestHitstop(seconds: number): void;
  requestSlowMo(factor: number, seconds: number): void;
  setArenaClashIntensity(v: number): void;
  flashScreen(strength: number, color?: number): void;
}

/** Visual-space positions (bowl-lifted) and floor, supplied by the view layer each tick. */
export interface PresentationSpace {
  readonly first: THREE.Vector3;
  readonly second: THREE.Vector3;
  readonly floorHeightAt: (r: number) => number;
  readonly dustColor: THREE.Color;
  readonly sparkColor: THREE.Color;
}

// ---------------- PRESENTATION TUNING ----------------
/** Stretch applied to the real ClashPower advantage for the HUD bar (see hudShare()). Same for A/B/C. */
export const HUD_ADVANTAGE_GAIN = 4;
/** How fast the HUD bar follows the live advantage (per second). */
const HUD_FOLLOW_PER_S = 8;
/** Approach progress at which the Beys start settling into the locked-contact pose. */
const CONTACT_BLEND_FROM_APPROACH = 0.6;
/** Seconds for the contact pose / HUD / speedlines to let go once the Clash resolves. */
const RELEASE_S = { contact: 0.12, hud: 0.25, speedlines: 0.35 };
/** Seconds for speedlines to reach full strength after the Clash starts. */
const SPEEDLINE_RISE_S = 0.25;
/** Extra lean from one mash event, decaying at MASH_SURGE_DECAY_PER_S. */
const MASH_SURGE = 0.45;
const MASH_SURGE_DECAY_PER_S = 7;
/** How much being ahead leans a Bey further in (and being behind, less). */
const ADVANTAGE_LEAN = 0.35;
// ------------------------------------------------------

export class ClashPresenter {
  /** 0..1 locked-contact pose weight. */
  contactWeight = 0;
  /** 0..1 speedline strength (already scaled by the direction). */
  speedlineLevel = 0;
  /** 0..1 HUD opacity. */
  hudOpacity = 0;
  /** 0..1 displayed share of the bar owned by the first (player) side. */
  hudShareFirst = 0.5;
  /** Per-side extra lean factor for the contact pose (1 = base). */
  readonly leanScale: [number, number] = [1, 1];
  private surge: [number, number] = [0, 0];
  private activeS = 0;
  private resolvedAgoS = -1;
  private currentArenaIntensity = 0;
  private arenaIntensityTarget = 0;
  /** Side colors = each chosen Bey model's approved glow color (set by the page whenever the models change). */
  sideColors: [number, number] = [0xff6a2a, 0x49d6ff];

  constructor(
    private direction: DirectionConfig,
    private tieStyleId: TieStyleId,
    private readonly fx: ClashFx,
    private readonly host: PresentationHost,
  ) {}

  get config(): DirectionConfig {
    return this.direction;
  }

  setDirection(direction: DirectionConfig): void {
    this.direction = direction;
  }

  setTieStyle(id: TieStyleId): void {
    this.tieStyleId = id;
  }

  reset(): void {
    this.contactWeight = 0;
    this.speedlineLevel = 0;
    this.hudOpacity = 0;
    this.hudShareFirst = 0.5;
    this.leanScale[0] = this.leanScale[1] = 1;
    this.surge = [0, 0];
    this.activeS = 0;
    this.resolvedAgoS = -1;
    this.currentArenaIntensity = 0;
    this.arenaIntensityTarget = 0;
    this.fx.clear();
    this.host.setArenaClashIntensity(0);
  }

  /** Call every fixed tick right after ClashStageSim.tick(). */
  handleTick(dt: number, sim: ClashStageSim, result: ClashStageTickResult, space: PresentationSpace): void {
    const d = this.direction;
    const phase = sim.harness.phase;
    const a = space.first;
    const b = space.second;
    const axis = new THREE.Vector2(b.x - a.x, b.z - a.z);
    if (axis.lengthSq() > 1e-9) axis.normalize();
    else axis.set(1, 0);
    const mid = a.clone().lerp(b, 0.5);
    const contact = new THREE.Vector3(mid.x, space.floorHeightAt(Math.hypot(mid.x, mid.z)), mid.z);

    if (result.events.clashStarted) this.onEntry();
    if (result.resolution) this.resolvedAgoS = 0;
    else if (this.resolvedAgoS >= 0) this.resolvedAgoS += dt;
    const released = this.resolvedAgoS >= 0;

    // ---- Live advantage (the real ClashPower the lab already computes) ----
    if (phase === 'Active') {
      this.activeS += dt;
      const target = hudShare(sim.harness.liveScore(true).clashPower, sim.harness.liveScore(false).clashPower, HUD_ADVANTAGE_GAIN);
      this.hudShareFirst += (target - this.hudShareFirst) * (1 - Math.exp(-dt * HUD_FOLLOW_PER_S));
    } else if (result.resolution) {
      // The bar lands on the real result as the impact happens, then fades with the Clash.
      const r = result.resolution;
      this.hudShareFirst = r.loserIsFirst === null ? 0.5 : r.loserIsFirst ? 0.04 : 0.96;
    }

    // ---- Levels: contact pose, HUD, speedlines ----
    if (released) {
      this.contactWeight = Math.max(0, 1 - this.resolvedAgoS / RELEASE_S.contact);
      this.hudOpacity = Math.max(0, 1 - this.resolvedAgoS / RELEASE_S.hud);
      this.speedlineLevel = d.speedlines.strength * Math.max(0, 1 - this.resolvedAgoS / RELEASE_S.speedlines);
    } else if (phase === 'Approach') {
      const k = THREE.MathUtils.clamp((sim.harness.approachProgress01 - CONTACT_BLEND_FROM_APPROACH) / (1 - CONTACT_BLEND_FROM_APPROACH), 0, 1);
      this.contactWeight = k;
      this.speedlineLevel = d.speedlines.strength * 0.35 * k;
      this.hudOpacity = 0;
    } else if (phase === 'Active') {
      this.contactWeight = 1;
      const rise = Math.min(1, this.activeS / SPEEDLINE_RISE_S);
      this.speedlineLevel = d.speedlines.strength * Math.max(0.35 * (1 - rise) + rise * (0.6 + 0.4 * sim.harness.activeProgress01), 0);
      this.hudOpacity = Math.min(1, this.activeS / 0.15);
    } else {
      this.contactWeight = 0;
      this.speedlineLevel = 0;
      this.hudOpacity = 0;
    }

    // ---- Effort: each mash is a push surge; being ahead leans a Bey further in ----
    for (const edge of result.events.mashEvents) this.surge[edge.isFirst ? 0 : 1] += MASH_SURGE;
    const decay = Math.exp(-dt * MASH_SURGE_DECAY_PER_S);
    this.surge[0] *= decay;
    this.surge[1] *= decay;
    const lead = (this.hudShareFirst - 0.5) * 2; // -1..1
    this.leanScale[0] = Math.max(0.4, 1 + this.surge[0] + lead * ADVANTAGE_LEAN);
    this.leanScale[1] = Math.max(0.4, 1 + this.surge[1] - lead * ADVANTAGE_LEAN);

    // ---- Contact dust: grinding in place for the whole Active beat ----
    if (phase === 'Active' && !released) {
      const effort = 0.7 + 0.3 * sim.harness.activeProgress01 + 0.25 * (this.surge[0] + this.surge[1]);
      this.fx.emitContactDust(contact, axis, dt, { perSecond: d.dust.particlesPerSecond * effort, size: d.dust.size, speed: d.dust.speed, sparkShare: d.dust.sparkShare, dustColor: space.dustColor, sparkColor: space.sparkColor });
    }

    this.arenaIntensityTarget = phase === 'Active' && !released ? d.arenaClashIntensity.active : released && this.resolvedAgoS < 1 ? d.arenaClashIntensity.resolutionPeak : 0;
    this.pushArenaIntensity(dt);

    for (const edge of result.events.mashEvents) {
      const at = edge.isFirst ? a : b;
      const color = new THREE.Color(this.sideColors[edge.isFirst ? 0 : 1]);
      if (d.pulse.useImpactStar) this.fx.impactStar(contact.clone().setY(contact.y + 0.45), color, 0.5 * d.pulse.pulseSize, 0.22);
      this.fx.mashPulse(new THREE.Vector3(at.x, contact.y + 0.02, at.z), color, d.pulse.pulseSize, 0.32);
      if (d.pulse.hitstopSeconds > 0) this.host.requestHitstop(d.pulse.hitstopSeconds);
    }

    if (result.resolution) this.onResolved(result.resolution, contact, axis, space);
    // Ring-out: no banner — the flight over the wall is the message; just a red shock where it crossed.
    // (result.ringOut stays set after the fact; the 'ringOut' camera intent marks the one tick it happens.)
    if (result.ringOut && result.fightFrame.intents.some((i) => i.kind === 'ringOut')) this.fx.shockwave(result.ringOut.isFirst ? a : b, new THREE.Color(0xff3b4e), 3, 0.5);
  }

  private onEntry(): void {
    const d = this.direction;
    this.host.flashScreen(d.entry.snapFlash, d.colors.neutral);
    if (d.entry.slowMoSeconds > 0) this.host.requestSlowMo(d.entry.slowMoFactor, d.entry.slowMoSeconds);
  }

  /** The impact itself — flash, rings, sparks, dust — while physics carries on. No hitstop, no slow motion, no banner. */
  private onResolved(resolution: NonNullable<ClashStageTickResult['resolution']>, contact: THREE.Vector3, axis: THREE.Vector2, space: PresentationSpace): void {
    const d = this.direction;
    const at = contact.clone().setY(contact.y + 0.35);
    const dustOpts = { size: d.dust.size * 1.3, speed: d.dust.speed * 1.4, sparkShare: d.dust.sparkShare, dustColor: space.dustColor, sparkColor: space.sparkColor };

    if (resolution.outcome === ClashOutcome.Tie) {
      const first = new THREE.Color(this.sideColors[0]);
      const second = new THREE.Color(this.sideColors[1]);
      if (this.tieStyleId === 'mirror') {
        const white = new THREE.Color(0xffffff);
        for (let i = 0; i < Math.max(1, d.resolution.burstRings); i++) this.fx.shockwave(at, white, 2.4 + i * 0.8, 0.6 + i * 0.15);
        this.fx.spawnSparks(at, first, Math.round(d.resolution.sparks / 2), 6);
        this.fx.spawnSparks(at, second, Math.round(d.resolution.sparks / 2), 6);
        this.host.flashScreen(d.resolution.flash * 0.8, 0xffffff);
      } else if (this.tieStyleId === 'static') {
        const red = new THREE.Color(0xff3b4e);
        this.fx.impactStar(at.clone().setY(at.y + 0.3), red, 1.1, 0.3);
        this.fx.spawnSparks(at, red, d.resolution.sparks + 20, 8);
        this.host.flashScreen(d.resolution.flash * 0.6, 0xff3b4e);
      } else {
        this.fx.shockwave(at, new THREE.Color(d.colors.neutral), 4.5, 0.8);
        this.fx.dustBurst(contact, axis, d.resolution.dustBurst * 2, dustOpts);
        this.host.flashScreen(d.resolution.flash * 0.5, 0xffffff);
      }
      return;
    }

    const winnerIsFirst = !resolution.loserIsFirst;
    const winnerColor = new THREE.Color(this.sideColors[winnerIsFirst ? 0 : 1]);
    for (let i = 0; i < Math.max(1, d.resolution.burstRings); i++) this.fx.shockwave(at, winnerColor, 2 + i * 0.9, 0.45 + i * 0.15);
    this.fx.spawnSparks(at, winnerColor, d.resolution.sparks, 7);
    this.fx.dustBurst(contact, axis, d.resolution.dustBurst, dustOpts);
    if (d.pulse.useImpactStar) this.fx.impactStar(at.clone().setY(at.y + 0.5), winnerColor, 1.2, 0.35);
    this.host.flashScreen(d.resolution.flash, winnerColor.getHex());
  }

  private pushArenaIntensity(dt: number): void {
    const k = 1 - Math.exp(-dt * 3);
    this.currentArenaIntensity += (this.arenaIntensityTarget - this.currentArenaIntensity) * k;
    this.host.setArenaClashIntensity(this.currentArenaIntensity);
  }
}
