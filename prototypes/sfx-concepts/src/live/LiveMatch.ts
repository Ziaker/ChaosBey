// ============================================================
// SFX LAB — LIVE MATCH (the real game, only listened to)
// Runs the game's own simulation headless: SelfTestMatchWorld (Rapier,
// arena colliders, tickMatch, Clash, hitstop via MatchStepper) with two
// real AIControllers, exactly like the M8 Self Test. Each fixed 60 Hz tick
// goes through deriveSfx(); the Lab plays what comes out. Nothing here
// changes gameplay: it only reads the results.
// ============================================================

import { AIController } from '../../../../src/ai/controllers/AIController';
import { DEFAULT_AI_DIFFICULTY_PROFILE } from '../../../../src/ai/difficulty/AiDifficultyProfile';
import { personalityForBeyDefinitionId } from '../../../../src/ai/personalities/AiArchetypePersonalities';
import type { BeyDefinition } from '../../../../src/bey/archetype/BeyDefinition';
import { NullAiMashSource } from '../../../../src/combat/clash/ClashMash';
import { ClashState } from '../../../../src/combat/clash/ClashController';
import { RoundOutcome } from '../../../../src/combat/round-rules/RoundState';
import { createRngStreams } from '../../../../src/rng/SeededRng';
import { SelfTestMatchWorld } from '../../../../src/self-test/SelfTestMatchWorld';
import { deriveSfx, initialMemory, type DeriveMemory, type DeriveOutput, type Vec3 } from './deriveSfx';

export interface LiveFrame {
  readonly tick: number;
  readonly positions: { readonly first: Vec3; readonly second: Vec3 };
  readonly clashActive: boolean;
  readonly broken: { readonly first: boolean; readonly second: boolean };
  readonly outcome: RoundOutcome;
  readonly output: DeriveOutput;
}

export class LiveMatch {
  private memory: DeriveMemory = initialMemory();
  private tickIndex = 0;

  private constructor(
    readonly seed: string,
    readonly firstDefinition: BeyDefinition,
    readonly secondDefinition: BeyDefinition,
    private readonly world: SelfTestMatchWorld,
    private readonly firstAi: AIController,
    private readonly secondAi: AIController,
  ) {}

  static async create(seed: string, firstDefinition: BeyDefinition, secondDefinition: BeyDefinition): Promise<LiveMatch> {
    const world = await SelfTestMatchWorld.build({ aiMashSource: new NullAiMashSource(), firstDefinition, secondDefinition });
    const rng = createRngStreams(seed);
    const firstAi = new AIController(world.physics, world.first, world.second, world.clash.controller, personalityForBeyDefinitionId(firstDefinition.id), DEFAULT_AI_DIFFICULTY_PROFILE, rng.aiFirst);
    const secondAi = new AIController(world.physics, world.second, world.first, world.clash.controller, personalityForBeyDefinitionId(secondDefinition.id), DEFAULT_AI_DIFFICULTY_PROFILE, rng.aiSecond);
    return new LiveMatch(seed, firstDefinition, secondDefinition, world, firstAi, secondAi);
  }

  get ticks(): number {
    return this.tickIndex;
  }

  get outcome(): RoundOutcome {
    return this.world.roundState.result;
  }

  /** One fixed tick of the real match, and what it sounds like. */
  step(): LiveFrame {
    const out = this.world.step({ first: this.firstAi, second: this.secondAi });
    this.tickIndex++;
    const a = this.world.first.body.translation();
    const b = this.world.second.body.translation();
    const positions = { first: { x: a.x, y: a.y, z: a.z }, second: { x: b.x, y: b.y, z: b.z } };
    const clash = this.world.clash.controller;
    const output = deriveSfx(this.memory, {
      result: out.result,
      advanced: out.advanced,
      clashResolvedThisTick: out.clashResolvedThisTick,
      positions,
      radii: { first: this.firstDefinition.physical.colliderRadiusM, second: this.secondDefinition.physical.colliderRadiusM },
      clash: { state: clash.getState(), elapsedS: clash.getElapsedS(), mashFirst: clash.getFirstMashEventCount(), mashSecond: clash.getSecondMashEventCount() },
      outcome: this.world.roundState.result,
    });
    this.memory = output.memory;
    return {
      tick: this.tickIndex,
      positions,
      clashActive: clash.getState() === ClashState.Active,
      broken: { first: out.result.first.isBroken, second: out.result.second.isBroken },
      outcome: this.world.roundState.result,
      output,
    };
  }

  dispose(): void {
    this.world.dispose();
  }
}
