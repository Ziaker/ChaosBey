// ============================================================
// CLASH PRESENTATION LAB — PRESENTATION DIRECTOR
// Turns one DirectionConfig + the current ClashStageSim tick result into
// concrete FX/host calls. This is the only file that reads a
// DirectionConfig's numbers — swapping A/B/C only ever changes what this
// class does, never the fixed rules underneath (ClashStageSim/
// ClashHarness/src/combat/clash/ stay identical for all three).
// ============================================================

import * as THREE from 'three';
import { ClashOutcome } from '../../../../src/combat/clash/ClashController';
import type { ClashStageSim, ClashStageTickResult } from '../sim/ClashStageSim';
import type { ClashFx } from '../fx/ClashFx';
import type { BannerStyle, DirectionConfig, TieStyleId } from './types';
import { TIE_STYLES } from './tieStyles';

export interface PresentationHost {
  requestHitstop(seconds: number): void;
  requestSlowMo(factor: number, seconds: number): void;
  setArenaClashIntensity(v: number): void;
  showBanner(text: string, color: number, style: BannerStyle): void;
  hideBanner(): void;
  flashScreen(strength: number, color?: number): void;
}

const V3 = (p: { x: number; y: number; z: number }): THREE.Vector3 => new THREE.Vector3(p.x, p.y, p.z);

export class ClashPresenter {
  private vortexAngle = 0;
  private lastAdvantageSign = 0;
  private swingBoost = 0;
  private arenaIntensityTarget = 0;
  private bannerShown = false;

  constructor(
    private direction: DirectionConfig,
    private tieStyleId: TieStyleId,
    private readonly fx: ClashFx,
    private readonly host: PresentationHost,
  ) {}

  setDirection(direction: DirectionConfig): void {
    this.direction = direction;
  }

  setTieStyle(id: TieStyleId): void {
    this.tieStyleId = id;
  }

  reset(): void {
    this.vortexAngle = 0;
    this.lastAdvantageSign = 0;
    this.swingBoost = 0;
    this.arenaIntensityTarget = 0;
    this.fx.clear();
    this.host.hideBanner();
    this.host.setArenaClashIntensity(0);
    this.bannerShown = false;
  }

  /** Call every fixed tick right after ClashStageSim.tick(). Handles both the continuous visuals (beam, arena glow) and the one-shot reactions (entry, mash pulses, resolution, ring-out). */
  handleTick(dt: number, sim: ClashStageSim, result: ClashStageTickResult): void {
    const d = this.direction;
    const phase = sim.harness.phase;
    const beat = sim.harness.beat;
    const a = V3(result.fightFrame.first.position);
    const b = V3(result.fightFrame.second.position);

    if (result.events.clashStarted) this.onEntry();

    if (phase === 'Approach' || phase === 'Active') {
      const firstScore = sim.harness.liveScore(true);
      const secondScore = sim.harness.liveScore(false);
      const totalPower = firstScore.clashPower + secondScore.clashPower;
      const advantage = totalPower > 1e-6 ? (firstScore.clashPower - secondScore.clashPower) / totalPower : 0;
      const advantageSign = Math.sign(Math.round(advantage * 100));
      if (advantageSign !== 0 && advantageSign !== this.lastAdvantageSign && this.lastAdvantageSign !== 0) {
        this.swingBoost = 1; // A lead just swapped — the vortex/beam gets a brief extra kick, direction C most of all.
      }
      if (advantageSign !== 0) this.lastAdvantageSign = advantageSign;
      this.swingBoost *= Math.exp(-dt * 3);

      this.vortexAngle += dt * (2 + d.energy.swingReactivity * (1 + this.swingBoost));
      const pulse01 = phase === 'Active' ? THREE.MathUtils.clamp((sim.harness.elapsedActiveS * 3) % 1 > 0.5 ? 0.2 : 1, 0, 1) : 0.3;
      this.fx.updateEnergyBeam(a, b, new THREE.Color(d.colors.first), new THREE.Color(d.colors.second), {
        visible: true,
        radius: d.energy.baseRadius * (1 + this.swingBoost * 0.6),
        segments: d.energy.style === 'vortex' ? 24 : d.energy.style === 'helix' ? 16 : 8,
        advantage: THREE.MathUtils.clamp(advantage * (1 + d.energy.swingReactivity * 0.3), -1, 1),
        pulse01,
        twist: this.vortexAngle * (d.energy.style === 'vortex' ? 1.4 : d.energy.style === 'helix' ? 0.7 : 0.15),
      });
      this.arenaIntensityTarget = d.arenaClashIntensity.active;
    } else {
      this.fx.hideEnergyBeam();
      this.arenaIntensityTarget = phase === 'Cooldown' && beat === 'resolutionBurst' ? d.arenaClashIntensity.resolutionPeak : 0;
    }
    this.pushArenaIntensity(dt);

    for (const edge of result.events.mashEvents) {
      const at = edge.isFirst ? a : b;
      const color = new THREE.Color(edge.isFirst ? d.colors.first : d.colors.second);
      if (d.pulse.useImpactStar) this.fx.impactStar(at.clone().setY(at.y + 0.4), color, 0.6 * d.pulse.pulseSize, 0.28);
      this.fx.mashPulse(at, color, d.pulse.pulseSize, 0.32);
      if (d.pulse.hitstopSeconds > 0) this.host.requestHitstop(d.pulse.hitstopSeconds);
    }

    if (result.resolution) this.onResolved(result.resolution, a, b);
    if (result.ringOut) this.onRingOut(result.ringOut.isFirst);
    if (result.events.resolutionBurstEnded) this.onReturn();
  }

  private onEntry(): void {
    const d = this.direction;
    this.host.flashScreen(d.entry.snapFlash, d.colors.neutral);
    if (d.entry.slowMoSeconds > 0) this.host.requestSlowMo(d.entry.slowMoFactor, d.entry.slowMoSeconds);
  }

  private onResolved(resolution: NonNullable<ClashStageTickResult['resolution']>, a: THREE.Vector3, b: THREE.Vector3): void {
    const d = this.direction;
    const mid = a.clone().lerp(b, 0.5).setY(a.y + 0.5);
    this.host.requestHitstop(d.resolution.hitstopSeconds);
    if (d.resolution.slowMoSeconds > 0) this.host.requestSlowMo(d.resolution.slowMoFactor, d.resolution.slowMoSeconds);

    if (resolution.outcome === ClashOutcome.Tie) {
      const style = TIE_STYLES[this.tieStyleId];
      const white = new THREE.Color(0xffffff);
      for (let i = 0; i < Math.max(1, d.resolution.burstRings); i++) this.fx.shockwave(mid, white, 2.4 + i * 0.8, 0.6 + i * 0.15);
      this.fx.spawnSparks(mid, white, 40, 6);
      this.showResolutionBanner(style.bannerText, d.colors.neutral);
      this.host.flashScreen(0.5, 0xffffff);
      return;
    }

    const winnerIsFirst = !resolution.loserIsFirst;
    const winnerColor = new THREE.Color(winnerIsFirst ? d.colors.first : d.colors.second);
    for (let i = 0; i < Math.max(1, d.resolution.burstRings); i++) this.fx.shockwave(mid, winnerColor, 2 + i * 0.9, 0.5 + i * 0.18);
    this.fx.spawnSparks(mid, winnerColor, 30, 7);
    if (d.pulse.useImpactStar) this.fx.impactStar(mid.clone().setY(mid.y + 0.6), winnerColor, 1.4, 0.5);
    const label = winnerIsFirst ? 'JOGADOR VENCE O CLASH' : 'OPONENTE VENCE O CLASH';
    this.showResolutionBanner(label, winnerColor.getHex());
  }

  private onRingOut(isFirst: boolean): void {
    const d = this.direction;
    this.fx.shockwave(new THREE.Vector3(0, 1, 0), new THREE.Color(0xff3b4e), 3, 0.5);
    this.host.showBanner(isFirst ? 'RING-OUT — JOGADOR SAIU DA ARENA' : 'RING-OUT — OPONENTE SAIU DA ARENA', 0xff3b4e, d.resolution.bannerStyle);
    this.bannerShown = true;
  }

  private showResolutionBanner(text: string, color: number): void {
    this.host.showBanner(text, color, this.direction.resolution.bannerStyle);
    this.bannerShown = true;
  }

  private onReturn(): void {
    if (this.bannerShown) {
      this.host.hideBanner();
      this.bannerShown = false;
    }
  }

  private pushArenaIntensity(dt: number): void {
    const k = 1 - Math.exp(-dt * 3);
    this.currentArenaIntensity += (this.arenaIntensityTarget - this.currentArenaIntensity) * k;
    this.host.setArenaClashIntensity(this.currentArenaIntensity);
  }

  private currentArenaIntensity = 0;
}
