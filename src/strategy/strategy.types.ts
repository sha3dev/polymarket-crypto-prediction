/**
 * @section imports:internals
 */

import type { MarketKey, PredictionContext, PredictionDirection } from "../market/market.types.ts";

/**
 * @section consts
 */

export const STRATEGY_TIERS = ["low", "medium", "high"] as const;

/**
 * @section types
 */

export type StrategyTier = (typeof STRATEGY_TIERS)[number];
export type StrategyDefinition = {
  strategyId: string;
  name: string;
  tier: StrategyTier;
  description: string;
};
export type StrategySignal = {
  strategyId: string;
  name: string;
  tier: StrategyTier;
  direction: PredictionDirection;
  score: number;
  confidence: number;
  weight: number;
  qualityFactor: number;
  didRun: boolean;
  didParticipate: boolean;
  reason: string | null;
  debug: Record<string, number | string | boolean | null>;
};
export type StrategySummary = {
  strategyId: string;
  name: string;
  tier: StrategyTier;
  description: string;
  marketKey: MarketKey | null;
  weight: number;
  isEnabled: boolean;
  totalResolved: number;
  wins: number;
  losses: number;
  voids: number;
  hitRate: number;
  averageSignedEdge: number;
  averageCalibrationError: number;
  recentStreak: number;
  lastResolvedAt: number | null;
  lastParticipatedAt: number | null;
};
export type StrategyMetricsRecord = {
  strategyId: string;
  totalResolved: number;
  wins: number;
  losses: number;
  voids: number;
  hitRate: number;
  averageSignedEdge: number;
  averageCalibrationError: number;
  recentStreak: number;
  lastResolvedAt: number | null;
  lastParticipatedAt: number | null;
  weight: number;
};
export type StrategyEvaluationResult = {
  marketKey: MarketKey;
  finalDirection: PredictionDirection;
  finalConfidence: number;
  weightedScore: number;
  strategyBreakdown: StrategySignal[];
  qualityScore: number;
  escalatedToMedium: boolean;
  escalatedToHigh: boolean;
  context: PredictionContext;
};
