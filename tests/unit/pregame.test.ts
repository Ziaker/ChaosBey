// M10 lane B: AI tiers, the AI explanation, match rules and round scoring.

import { describe, expect, it } from 'vitest';
import { DEFAULT_ARENA_FLOOR } from '../../src/arena/floor/ArenaFloorProfile';
import { DEFAULT_AI_DIFFICULTY_PROFILE, applyDifficultyTraits } from '../../src/ai/difficulty/AiDifficultyProfile';
import { ACE_TIER, AI_DIFFICULTY_TIERS, RIVAL_TIER, ROOKIE_TIER, aiDifficultyTier } from '../../src/ai/difficulty/AiDifficultyTiers';
import { ATTACK_AI_PERSONALITY, DEFENSE_AI_PERSONALITY, STAMINA_AI_PERSONALITY } from '../../src/ai/personalities/AiArchetypePersonalities';
import { aiCapabilities, aiStyleLines } from '../../src/app/frontend/aiExplanation';
import { EMPTY_SCORE, describeRoundsToWin, matchWinner, roundSeed, scoreRound } from '../../src/app/frontend/matchScore';
import {
  createDefaultMatchSetup,
  matchConfigFor,
  matchupLines,
  normalizeSeedText,
  opponentControllerFor,
  withArenaFloor, withArenaPreset,
  withPlayerBey,
} from '../../src/app/frontend/matchSetup';
import { RoundOutcome } from '../../src/combat/round-rules/RoundState';
import { createDefaultMatchConfig } from '../../src/config/match/MatchConfig';

const PERSONALITIES = [ATTACK_AI_PERSONALITY, DEFENSE_AI_PERSONALITY, STAMINA_AI_PERSONALITY];

describe('AI difficulty tiers (Rookie / Rival / Ace)', () => {
  it('are three data profiles; Rival is the internal default the AI has always played', () => {
    expect(AI_DIFFICULTY_TIERS.map((t) => t.id)).toEqual(['rookie', 'rival', 'ace']);
    const { id: _rivalId, ...rival } = RIVAL_TIER.profile;
    const { id: _defaultId, ...fallback } = DEFAULT_AI_DIFFICULTY_PROFILE;
    expect(rival).toEqual(fallback);
    expect(aiDifficultyTier('ace')).toBe(ACE_TIER);
  });

  it('order every skill axis Rookie < Rival < Ace', () => {
    const [rookie, rival, ace] = AI_DIFFICULTY_TIERS.map((t) => t.profile);
    expect(rookie!.reactionDelayMultiplier).toBeGreaterThan(rival!.reactionDelayMultiplier);
    expect(rival!.reactionDelayMultiplier).toBeGreaterThan(ace!.reactionDelayMultiplier);
    expect(rookie!.errorRateMultiplier).toBeGreaterThan(rival!.errorRateMultiplier);
    expect(rival!.errorRateMultiplier).toBeGreaterThan(ace!.errorRateMultiplier);
    for (const key of ['predictionStrength', 'adaptationMultiplier', 'clashMashRateMultiplier', 'evasionMultiplier', 'arenaAwarenessMultiplier'] as const) {
      expect(rookie![key], key).toBeLessThan(rival![key]);
      expect(rival![key], key).toBeLessThan(ace![key]);
    }
  });

  it('never make the AI perfect or blind to ring-outs (GDD 63)', () => {
    for (const tier of AI_DIFFICULTY_TIERS) {
      expect(tier.profile.errorRateMultiplier).toBeGreaterThan(0);
      for (const personality of PERSONALITIES) {
        const played = applyDifficultyTraits(personality, tier.profile);
        expect(played.edgeCautionMultiplier).toBeGreaterThanOrEqual(1);
        expect(played.dodgeSkill).toBeLessThanOrEqual(0.95);
        expect(played.dodgeSkill).toBeGreaterThan(0);
      }
    }
  });

  it('leave the personality untouched at multipliers of 1 (Rival and the Debug Lab default)', () => {
    for (const personality of PERSONALITIES) {
      expect(applyDifficultyTraits(personality, RIVAL_TIER.profile)).toBe(personality);
      expect(applyDifficultyTraits(personality, DEFAULT_AI_DIFFICULTY_PROFILE)).toBe(personality);
    }
    const aceDefense = applyDifficultyTraits(DEFENSE_AI_PERSONALITY, ACE_TIER.profile);
    expect(aceDefense.dodgeSkill).toBe(0.95); // 0.75 × 1.35, capped: never a guaranteed dodge
    expect(aceDefense.edgeCautionMultiplier).toBeCloseTo(1.69, 12);
    expect(aceDefense.aggression).toBe(DEFENSE_AI_PERSONALITY.aggression);
  });
});

describe('AI explanation', () => {
  it('shows seven capabilities, each stronger or equal from Rookie to Ace', () => {
    for (const personality of PERSONALITIES) {
      const [rookie, rival, ace] = [ROOKIE_TIER, RIVAL_TIER, ACE_TIER].map((t) => aiCapabilities(personality, t.profile));
      expect(rookie!.map((c) => c.key)).toEqual(['reaction', 'prediction', 'consistency', 'evasion', 'arenaAwareness', 'clash', 'adaptation']);
      rookie!.forEach((capability, i) => {
        expect(capability.score).toBeGreaterThanOrEqual(0);
        expect(capability.score).toBeLessThanOrEqual(1);
        expect(capability.score, `${personality.id} ${capability.key}`).toBeLessThanOrEqual(rival![i]!.score);
        expect(rival![i]!.score, `${personality.id} ${capability.key}`).toBeLessThanOrEqual(ace![i]!.score);
      });
      // Every axis but arena awareness (floored at 1 for an Attack AI) visibly differs.
      expect(rookie!.filter((c, i) => c.score < ace![i]!.score).length).toBeGreaterThanOrEqual(6);
    }
  });

  it('reads out the values the AI really plays with', () => {
    const rival = aiCapabilities(ATTACK_AI_PERSONALITY, RIVAL_TIER.profile);
    expect(rival.find((c) => c.key === 'reaction')!.readout).toBe('0.22 s');
    expect(rival.find((c) => c.key === 'clash')!.readout).toBe('6.0 presses/s');
    expect(rival.find((c) => c.key === 'evasion')!.readout).toBe('dodges 55% of threats in time');
    expect(aiCapabilities(ATTACK_AI_PERSONALITY, ROOKIE_TIER.profile).find((c) => c.key === 'adaptation')!.readout).toBe('never adapts');
  });

  it('describes each archetype style, resource use included', () => {
    expect(aiStyleLines(ATTACK_AI_PERSONALITY).join(' ')).toMatch(/Dash attacks early.*edge.*spends Stamina freely/);
    expect(aiStyleLines(DEFENSE_AI_PERSONALITY).join(' ')).toMatch(/Circular counter.*centre/);
    expect(aiStyleLines(STAMINA_AI_PERSONALITY).join(' ')).toMatch(/Avoids heavy collisions.*Stamina runs low.*thrifty/);
  });
});

describe('match setup rules', () => {
  it('feeds the Clash impact through the one MatchConfig path and the tier/style to the AI', () => {
    const setup = { ...createDefaultMatchSetup(), clashImpactMultiplier: 1.5, ai: { tier: 'ace' as const, style: 'defense' as const } };
    expect(matchConfigFor(setup)).toEqual({ ...createDefaultMatchConfig(), clashImpactMultiplier: 1.5 });
    expect(matchConfigFor(createDefaultMatchSetup())).toEqual(createDefaultMatchConfig());
    expect(opponentControllerFor(setup)).toEqual({ kind: 'ai', personality: 'defense', difficulty: 'ace' });
  });

  it('feeds the Ring-out delay (owner, 2026-10-02; provisional 1.5 s) through MatchConfig', () => {
    expect(createDefaultMatchSetup().rules.ringOutDelayS).toBe(1.5);
    const setup = { ...createDefaultMatchSetup(), rules: { ...createDefaultMatchSetup().rules, ringOutDelayS: 0.25 } };
    expect(matchConfigFor(setup)).toEqual({ ...createDefaultMatchConfig(), ringOutDelayS: 0.25 });
  });

  it('feeds the Dash cooldown (owner, 2026-10-02; provisional 1.5 s) through MatchConfig', () => {
    expect(createDefaultMatchSetup().rules.dashCooldownS).toBe(1.5);
    const setup = { ...createDefaultMatchSetup(), rules: { ...createDefaultMatchSetup().rules, dashCooldownS: 4 } };
    expect(matchConfigFor(setup)).toEqual({ ...createDefaultMatchConfig(), dashCooldownS: 4 });
  });

  it('builds the arena walls from the preset, and a preset change resets moved sliders', () => {
    const rift = withArenaPreset(createDefaultMatchSetup(), 'rift');
    expect(matchConfigFor(rift)).toMatchObject({ arenaWallHeightM: 1, arenaWallRestitution: 0.4 });
    const custom = { ...rift, arena: { ...rift.arena, geometry: { wallHeightM: 0.6, wallRestitution: 0.9 } } };
    expect(matchConfigFor(custom)).toMatchObject({ arenaWallHeightM: 0.6, arenaWallRestitution: 0.9 });
    expect(withArenaPreset(custom, 'tournament').arena).toEqual({ presetId: 'tournament', geometry: { wallHeightM: 2.6, wallRestitution: 0.7, floor: DEFAULT_ARENA_FLOOR } });
    // M11 lane 4: the floor profile is independent of the look: a preset change keeps it.
    const bowl = withArenaFloor(rift, 'bowl-b');
    expect(matchConfigFor(bowl).arenaFloor).toBe('bowl-b');
    expect(withArenaPreset(bowl, 'foundry').arena.geometry.floor).toBe('bowl-b');
    expect(matchConfigFor(createDefaultMatchSetup()).arenaFloor).toBe(DEFAULT_ARENA_FLOOR);
  });

  it('keeps a hand-picked opponent when the player changes Bey, and follows the default otherwise', () => {
    const base = createDefaultMatchSetup('attack-prototype');
    expect(withPlayerBey(base, 'defense-prototype').opponentBeyId).toBe('stamina-prototype');
    const picked = { ...base, opponentBeyId: 'attack-prototype' };
    expect(withPlayerBey(picked, 'stamina-prototype').opponentBeyId).toBe('attack-prototype');
    expect(withPlayerBey(base, 'attack-prototype')).toBe(base);
  });

  it('treats a blank seed as random', () => {
    expect(normalizeSeedText('   ')).toBeNull();
    expect(normalizeSeedText(' abc ')).toBe('abc');
  });

  it('summarises the matchup from both definitions', () => {
    const lines = matchupLines(createDefaultMatchSetup('attack-prototype')).map((l) => `${l.tone}: ${l.text}`);
    expect(lines).toEqual([
      'good: You hit harder (8 vs 3)',
      'bad: They are tougher (3 vs 8)',
      'even: Even stamina (4 vs 4)',
      'bad: They are heavier: you get launched further',
    ]);
  });
});

describe('match score', () => {
  it('counts wins per side, draws for nobody, and ends at N wins', () => {
    let score = scoreRound(EMPTY_SCORE, RoundOutcome.FirstWinsByRingOut);
    score = scoreRound(score, RoundOutcome.Draw);
    score = scoreRound(score, RoundOutcome.SecondWinsByKo);
    expect(score).toEqual({ player: 1, opponent: 1, rounds: 3 });
    expect(scoreRound(score, RoundOutcome.Ongoing)).toBe(score);
    expect(matchWinner(score, 2)).toBeNull();
    expect(matchWinner(score, 1)).toBe('player');
    expect(matchWinner(scoreRound(score, RoundOutcome.SecondWinsByRingOut), 2)).toBe('opponent');
  });

  it('gives each round its own seed, round 1 being the match seed', () => {
    expect(roundSeed('abc', 1)).toBe('abc');
    expect(roundSeed('abc', 2)).toBe('abc/round-2');
    expect(roundSeed('abc', 2)).not.toBe(roundSeed('abc', 3));
    expect(describeRoundsToWin(1)).toBe('Single round');
    expect(describeRoundsToWin(2)).toBe('First to 2 (best of 3)');
  });
});
