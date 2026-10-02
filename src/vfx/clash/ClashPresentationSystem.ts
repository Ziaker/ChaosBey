// ============================================================
// CLASH PRESENTATION SYSTEM (clashPresentation flag)
// The approved Overdrive direction as a presentation system. It watches the
// real Clash (ClashPresentationSnapshot + clashStarted / clashProgress /
// clashResolved events), never decides anything about it (GDD 158), and adds:
//
//   locked contact    both Beys lean into the contact point and shudder, visual only
//   speedlines        screen-space lines converging on the contact, with a clean zone around the Beys
//   contact dust      dust and grit scraped off the floor at the contact, tinted by arena
//   mash pulse        impact star + ring + sparks on every mash, in that side's colour
//   resolution        flash + rings + sparks + dust in the winner's colour, with no pause
//   arena reaction    a contact light that rises with the Clash (stand-in until the approved arena art reacts itself)
//
// FROZEN / NOT HERE (see overdrive.ts): the entry slow motion, the per-mash
// hitstop and the camera shake (the owner froze the camera; nothing scales time),
// the HUD bar restyle (open HUD decision; the tug-of-war bar already exists in
// CombatHud), and any tie-specific effect (open, ask first). The camera is only
// READ, to project the contact point for the speedlines.
//
// The only thing written on a Bey is the visual group's pose, and only while a
// Clash holds it; the physics sync overwrites it again on the next frame.
// ============================================================

import * as THREE from 'three';
import type { BeyDefinition } from '../../bey/archetype/BeyDefinition';
import type { BeyVisual } from '../../bey/procedural-model/createBeyMesh';
import { getConceptVisualModel } from '../../bey/visual/conceptBeyVisual';
import { ClashOutcome } from '../../combat/clash/ClashController';
import type { PresentationEvent, PresentationSide } from '../../presentation/events';
import type { PresentationFrame, PresentationSystem } from '../../presentation/hub';
import type { MatchPresentationState } from '../../presentation/state';
import { ClashFx } from './ClashFx';
import { clashAdvantageShare, computeContactPose } from './contactPose';
import { ARENA_CLASH_DUST_HEX, OVERDRIVE, type OverdriveConfig } from './overdrive';
import { Speedlines } from './Speedlines';

export const CLASH_PRESENTATION_SYSTEM_ID = 'clash-presentation';

// ---------------- TUNING (the lab's presentation values) ----------------
/** Stretch applied to the real ClashPower advantage for the speedline reach (the lab's HUD gain). */
const ADVANTAGE_GAIN = 4;
/** How fast the shown advantage follows the live one (per second). */
const SHARE_FOLLOW_PER_S = 8;
/** The Beys are already in contact when a Clash starts; the pose settles in over this long (the lab's approach blend does not exist in the game). */
const CONTACT_SETTLE_S = 0.12;
/** Seconds for the contact pose / speedlines to let go once the Clash resolves. */
const RELEASE_S = { contact: 0.12, speedlines: 0.35 };
/** Seconds for speedlines to reach full strength after the Clash starts. */
const SPEEDLINE_RISE_S = 0.25;
/** Extra lean from one mash event, decaying at MASH_SURGE_DECAY_PER_S. */
const MASH_SURGE = 0.45;
const MASH_SURGE_DECAY_PER_S = 7;
/** How much being ahead leans a Bey further in (and being behind, less). */
const ADVANTAGE_LEAN = 0.35;
/** Screen-space clear zone around the contact that speedlines never enter: half the Beys' on-screen span plus this many Bey diameters. */
const SPEEDLINE_CLEAR_EXTRA_BEYS = 0.9;
/** The speedline drawing changes every N ticks (deterministic hand-drawn flicker). */
const SPEEDLINE_FRAME_TICKS = 3;
/** Effects keep moving slowly while the game is in hitstop (the Hybrid VFX rate). */
const HITSTOP_FX_RATE = 0.35;
/** The screen flash fades over this long at strength 1 (the lab's value). */
const FLASH_DURATION_S = 0.35;
/** Contact light peak intensity at reaction 1, and its fade-in rate (per second). */
const REACTION_LIGHT_PEAK = 12;
const REACTION_FOLLOW_PER_S = 3;
const MAX_FRAME_DT = 1 / 20;
const OVERLAY_Z_INDEX = '900';
// ------------------------------------------------------------------------

const SIDES: readonly PresentationSide[] = ['first', 'second'];
const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

export interface ClashBeyTarget {
  readonly visual: BeyVisual;
  readonly gameplay: BeyDefinition;
}

export interface ClashPresentationOptions {
  readonly scene: THREE.Object3D;
  /** Read-only: projects the contact point for the speedlines. Never written. */
  readonly camera: THREE.Camera;
  readonly beys: Readonly<Record<PresentationSide, ClashBeyTarget>>;
  /** Floor height by distance from the arena centre (floors are radial). */
  readonly floorHeightAtR: (r: number) => number;
  /** Arena spark colour (hot end) for the contact grit. */
  readonly sparkHex: number;
  /** Arena floor dust tint. */
  readonly dustHex: number;
  readonly config?: OverdriveConfig;
  /** Where the overlay canvas is mounted. Default: the page body. `null`: no DOM. */
  readonly overlayParent?: HTMLElement | null;
}

interface SideState {
  readonly side: PresentationSide;
  readonly target: ClashBeyTarget;
  readonly color: THREE.Color;
  readonly colorHex: number;
  readonly position: THREE.Vector3;
  surge: number;
  leanScale: number;
}

export class ClashPresentationSystem implements PresentationSystem {
  readonly id = CLASH_PRESENTATION_SYSTEM_ID;

  private readonly config: OverdriveConfig;
  private readonly fx = new ClashFx();
  private readonly speedlines: Speedlines | null = null;
  private readonly speedlineCanvas: HTMLCanvasElement | null = null;
  private readonly overlayHost: HTMLElement | null = null;
  private readonly flashLayer: HTMLElement | null = null;
  private readonly light = new THREE.PointLight(0xffffff, 0, 8, 2);
  private readonly sides: Record<PresentationSide, SideState>;
  private readonly dustColor: THREE.Color;
  private readonly sparkColor: THREE.Color;

  private contactWeight = 0;
  private speedlineLevel = 0;
  private shareFirst = 0.5;
  private firstOnLeft = true;
  private activeS = 0;
  private resolvedAgoS = -1;
  private wasActive = false;
  private reaction = 0;
  private reactionTarget = 0;
  private flashRemainingS = 0;
  private flashTotalS = 0;
  private flashHex = '#ffffff';
  private timeS = 0;
  private hitstopActive = false;
  private latestTick = 0;
  private lastPoseTiltRad: [number, number] = [0, 0];
  private readonly scale = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();
  private readonly mid = new THREE.Vector3();

  constructor(private readonly options: ClashPresentationOptions) {
    this.config = options.config ?? OVERDRIVE;
    this.dustColor = new THREE.Color(options.dustHex);
    this.sparkColor = new THREE.Color(options.sparkHex);
    this.sides = { first: this.buildSide('first'), second: this.buildSide('second') };
    options.scene.add(this.fx.group, this.light);
    const parent = options.overlayParent === undefined ? (typeof document === 'undefined' ? null : document.body) : options.overlayParent;
    if (parent && typeof document !== 'undefined') {
      const host = document.createElement('div');
      host.setAttribute('data-testid', 'clash-presentation-overlay');
      host.style.cssText = `position:fixed;inset:0;pointer-events:none;z-index:${OVERLAY_Z_INDEX};`;
      const canvas = document.createElement('canvas');
      canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
      const flash = document.createElement('div');
      flash.style.cssText = 'position:absolute;inset:0;opacity:0;';
      host.append(canvas, flash);
      parent.appendChild(host);
      this.overlayHost = host;
      this.flashLayer = flash;
      this.speedlineCanvas = canvas;
      this.speedlines = new Speedlines(canvas);
    }
  }

  private buildSide(side: PresentationSide): SideState {
    const target = this.options.beys[side];
    const glow = getConceptVisualModel(target.visual)?.concept.palette.glow ?? target.gameplay.particle.sparkTintHex;
    return { side, target, color: new THREE.Color(glow), colorHex: glow, position: new THREE.Vector3(), surge: 0, leanScale: 1 };
  }

  // ---------------- events (one tick at a time) ----------------

  onEvents(events: readonly PresentationEvent[], state: MatchPresentationState): void {
    this.latestTick = state.tick;
    for (const event of events) {
      if (event.kind === 'clashStarted') {
        this.activeS = 0;
        this.resolvedAgoS = -1;
        this.shareFirst = 0.5;
        this.sides.first.surge = this.sides.second.surge = 0;
        this.firstOnLeft = this.screenX(this.sides.first.position) <= this.screenX(this.sides.second.position);
        // Entry: the snap flash in the neutral accent. (The slow motion that goes with it in the lab is not applied.)
        this.flash(this.config.entrySnapFlash, this.config.neutralHex);
      } else if (event.kind === 'clashProgress') {
        this.onMash(event.side);
      } else if (event.kind === 'clashResolved') {
        this.onResolved(event.outcome);
      }
    }
  }

  private onMash(side: PresentationSide): void {
    const s = this.sides[side];
    s.surge += MASH_SURGE;
    const c = this.contactPoint();
    const p = this.config.pulse;
    if (p.useImpactStar) this.fx.impactStar(c.clone().setY(c.y + 0.45), s.color, 0.5 * p.pulseSize, 0.22);
    this.fx.mashPulse(new THREE.Vector3(s.position.x, c.y + 0.02, s.position.z), s.color, p.pulseSize, 0.32);
    // The per-mash hitstop of the lab is not applied: HitstopClock is the only hitstop authority.
  }

  private onResolved(outcome: ClashOutcome): void {
    this.resolvedAgoS = 0;
    if (outcome === ClashOutcome.Tie) return; // the tie style is an open owner decision: no tie-specific effect
    const firstWon = outcome === ClashOutcome.FirstWins;
    const winner = this.sides[firstWon ? 'first' : 'second'];
    // The bar-share the speedlines reach with lands on the real result as the impact happens.
    this.shareFirst = firstWon ? 0.96 : 0.04;
    const r = this.config.resolution;
    const c = this.contactPoint();
    const at = c.clone().setY(c.y + 0.35);
    const axis = this.axisXZ();
    for (let i = 0; i < Math.max(1, r.burstRings); i++) this.fx.shockwave(at, winner.color, 2 + i * 0.9, 0.45 + i * 0.15);
    this.fx.spawnSparks(at, winner.color, r.sparks, 7);
    this.fx.dustBurst(c, axis, r.dustBurst, { size: this.config.dust.size * 1.3, speed: this.config.dust.speed * 1.4, sparkShare: this.config.dust.sparkShare, dustColor: this.dustColor, sparkColor: this.sparkColor });
    if (this.config.pulse.useImpactStar) this.fx.impactStar(at.clone().setY(at.y + 0.5), winner.color, 1.2, 0.35);
    this.flash(r.flash, winner.colorHex);
    // Resolution is never a pause: no hitstop, no slow motion, no banner.
  }

  // ---------------- per frame ----------------

  update(frame: PresentationFrame): void {
    const state = frame.state;
    const rawDt = Math.min(MAX_FRAME_DT, Math.max(0, frame.dtSeconds));
    this.timeS += rawDt;
    for (const side of SIDES) this.readPosition(this.sides[side]);
    if (!state) return;
    this.hitstopActive = state.camera?.hitstopActive ?? false;
    const dt = this.hitstopActive ? rawDt * HITSTOP_FX_RATE : rawDt;
    const clash = state.clash;
    const active = clash.active;
    const d = this.config;

    if (active && !this.wasActive && this.resolvedAgoS >= 0) this.resolvedAgoS = -1;
    this.wasActive = active;
    if (this.resolvedAgoS >= 0) this.resolvedAgoS += rawDt;
    const released = this.resolvedAgoS >= 0 && !active;

    // Live advantage from the real ClashPower (the snapshot's own live power).
    if (active) {
      this.activeS += rawDt;
      const target = clashAdvantageShare(clash.firstPower, clash.secondPower, ADVANTAGE_GAIN);
      this.shareFirst += (target - this.shareFirst) * (1 - Math.exp(-rawDt * SHARE_FOLLOW_PER_S));
    }

    // Levels: contact pose and speedlines.
    if (active) {
      this.contactWeight = Math.min(1, this.activeS / CONTACT_SETTLE_S);
      const rise = Math.min(1, this.activeS / SPEEDLINE_RISE_S);
      this.speedlineLevel = d.speedlines.strength * Math.max(0.35 * (1 - rise) + rise * (0.6 + 0.4 * clash.progress), 0);
    } else if (released) {
      this.contactWeight = Math.max(0, 1 - this.resolvedAgoS / RELEASE_S.contact);
      this.speedlineLevel = d.speedlines.strength * Math.max(0, 1 - this.resolvedAgoS / RELEASE_S.speedlines);
    } else {
      this.contactWeight = 0;
      this.speedlineLevel = 0;
    }

    // Effort: each mash is a push surge; being ahead leans a Bey further in.
    const decay = Math.exp(-rawDt * MASH_SURGE_DECAY_PER_S);
    this.sides.first.surge *= decay;
    this.sides.second.surge *= decay;
    const lead = (this.shareFirst - 0.5) * 2;
    this.sides.first.leanScale = Math.max(0.4, 1 + this.sides.first.surge + lead * ADVANTAGE_LEAN);
    this.sides.second.leanScale = Math.max(0.4, 1 + this.sides.second.surge - lead * ADVANTAGE_LEAN);

    // Contact dust: grinding in place for the whole Active beat.
    const contact = this.contactPoint();
    if (active) {
      const effort = 0.7 + 0.3 * clash.progress + 0.25 * (this.sides.first.surge + this.sides.second.surge);
      this.fx.emitContactDust(contact, this.axisXZ(), dt, { perSecond: d.dust.particlesPerSecond * effort, size: d.dust.size, speed: d.dust.speed, sparkShare: d.dust.sparkShare, dustColor: this.dustColor, sparkColor: this.sparkColor });
    }

    // Arena reaction (a contact light): rises with the Clash, peaks at the resolution.
    this.reactionTarget = active ? d.arenaClashIntensity.active : released && this.resolvedAgoS < 1 ? d.arenaClashIntensity.resolutionPeak : 0;
    this.reaction += (this.reactionTarget - this.reaction) * (1 - Math.exp(-rawDt * REACTION_FOLLOW_PER_S));
    this.light.position.set(contact.x, contact.y + 0.8, contact.z);
    this.light.intensity = REACTION_LIGHT_PEAK * this.reaction;

    // Pose: re-seat the visuals into the locked contact (visual group only), after the camera-independent sync.
    this.applyPose();

    this.fx.tick(dt);
    this.drawOverlay(rawDt);
  }

  private readPosition(side: SideState): void {
    const group = side.target.visual.group;
    group.updateWorldMatrix(true, false);
    group.matrixWorld.decompose(side.position, this.quaternion, this.scale);
  }

  private contactPoint(): THREE.Vector3 {
    const a = this.sides.first.position;
    const b = this.sides.second.position;
    this.mid.copy(a).lerp(b, 0.5);
    const y = this.options.floorHeightAtR(Math.hypot(this.mid.x, this.mid.z));
    return new THREE.Vector3(this.mid.x, y, this.mid.z);
  }

  private axisXZ(): THREE.Vector2 {
    const a = this.sides.first.position;
    const b = this.sides.second.position;
    const axis = new THREE.Vector2(b.x - a.x, b.z - a.z);
    return axis.lengthSq() > 1e-9 ? axis.normalize() : axis.set(1, 0);
  }

  private applyPose(): void {
    if (this.contactWeight <= 0) {
      this.lastPoseTiltRad = [0, 0];
      return;
    }
    const axis = this.axisXZ();
    const c = this.config.contact;
    SIDES.forEach((side, i) => {
      const s = this.sides[side];
      const group = s.target.visual.group;
      const pose = computeContactPose({
        position: group.position,
        quaternion: group.quaternion,
        tipDropM: s.target.gameplay.physical.colliderHalfHeightM,
        towardOpponent: i === 0 ? axis.clone() : axis.clone().negate(),
        contactWeight: this.contactWeight,
        leanScale: s.leanScale,
        params: { leanRad: THREE.MathUtils.degToRad(c.leanDeg), wobbleRad: THREE.MathUtils.degToRad(c.wobbleDeg), wobbleHz: c.wobbleHz },
        timeS: this.timeS,
        phase: i * 2.1,
      });
      group.position.copy(pose.position);
      group.quaternion.copy(pose.quaternion);
      this.lastPoseTiltRad[i] = pose.extraTiltRad;
    });
  }

  // ---------------- screen effects ----------------

  private screenX(world: THREE.Vector3): number {
    const v = world.clone().project(this.options.camera);
    return v.x;
  }

  private flash(strength: number, colorHex: number): void {
    this.flashTotalS = FLASH_DURATION_S * Math.max(0.1, strength);
    this.flashRemainingS = this.flashTotalS;
    this.flashHex = hex(colorHex);
  }

  private drawOverlay(dt: number): void {
    if (this.flashRemainingS > 0) this.flashRemainingS = Math.max(0, this.flashRemainingS - dt);
    if (this.flashLayer) {
      const k = this.flashTotalS > 0 ? this.flashRemainingS / this.flashTotalS : 0;
      this.flashLayer.style.background = this.flashHex;
      this.flashLayer.style.opacity = String(Math.min(0.55, 0.55 * k * k));
    }
    const lines = this.speedlines;
    const canvas = this.speedlineCanvas;
    if (!lines || !canvas) return;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) lines.resize(W, H, dpr);
    if (this.speedlineLevel <= 0.01) {
      lines.clear();
      return;
    }
    const camera = this.options.camera;
    const toScreen = (p: THREE.Vector3): THREE.Vector2 => {
      const v = p.clone().project(camera);
      return new THREE.Vector2((v.x * 0.5 + 0.5) * W, (-v.y * 0.5 + 0.5) * H);
    };
    const a = this.sides.first.position;
    const b = this.sides.second.position;
    const mid = a.clone().lerp(b, 0.5);
    const c = toScreen(mid.clone().setY(mid.y + 0.2));
    const beyPx = c.distanceTo(toScreen(mid.clone().setY(mid.y + 1.5)));
    const span = toScreen(a).distanceTo(toScreen(b));
    const colors = this.firstOnLeft ? [this.sides.first.colorHex, this.sides.second.colorHex] : [this.sides.second.colorHex, this.sides.first.colorHex];
    lines.draw(W, H, {
      cx: c.x,
      cy: c.y,
      clearRadius: Math.max(60, span * 0.5 + beyPx * SPEEDLINE_CLEAR_EXTRA_BEYS),
      intensity: this.speedlineLevel,
      count: this.config.speedlines.count,
      tint: this.config.speedlines.tintWithSides ? { left: hex(colors[0]!), right: hex(colors[1]!) } : null,
      leftShare: this.firstOnLeft ? this.shareFirst : 1 - this.shareFirst,
      seed: Math.floor(this.latestTick / SPEEDLINE_FRAME_TICKS),
    });
  }

  reset(): void {
    this.fx.clear();
    this.contactWeight = 0;
    this.speedlineLevel = 0;
    this.shareFirst = 0.5;
    this.activeS = 0;
    this.resolvedAgoS = -1;
    this.wasActive = false;
    this.reaction = 0;
    this.reactionTarget = 0;
    this.flashRemainingS = 0;
    this.light.intensity = 0;
    this.sides.first.surge = this.sides.second.surge = 0;
    this.speedlines?.clear();
    if (this.flashLayer) this.flashLayer.style.opacity = '0';
  }

  getStats(): Readonly<Record<string, number>> {
    const counts = this.fx.particleCounts;
    return {
      dust: counts.dust,
      grit: counts.grit,
      contactWeight: this.contactWeight,
      speedlineLevel: this.speedlineLevel,
      speedlinesDrawn: this.speedlines?.lastDrawn ?? 0,
      shareFirst: this.shareFirst,
      poseTiltFirstDeg: THREE.MathUtils.radToDeg(this.lastPoseTiltRad[0]),
      poseTiltSecondDeg: THREE.MathUtils.radToDeg(this.lastPoseTiltRad[1]),
      reaction: this.reaction,
    };
  }

  dispose(): void {
    this.fx.dispose();
    this.fx.group.removeFromParent();
    this.light.removeFromParent();
    this.light.dispose();
    this.overlayHost?.remove();
  }
}

export function createClashPresentationSystem(options: ClashPresentationOptions): ClashPresentationSystem {
  return new ClashPresentationSystem(options);
}

/** Dust tint for an arena preset id (the three approved arenas), or a neutral grey for anything else. */
export function clashDustHexFor(presetId: string | undefined): number {
  if (presetId === 'foundry' || presetId === 'rift' || presetId === 'tournament') return ARENA_CLASH_DUST_HEX[presetId];
  return ARENA_CLASH_DUST_HEX.fallback;
}
