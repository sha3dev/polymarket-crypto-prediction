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
export type SetupType =
  | "broad_continuation"
  | "leader_laggard_catchup"
  | "local_breakout_confirmed"
  | "mispricing_repricing"
  | "fade_failed_cross"
  | "research_probe";
export type EngineId =
  | "breadth_engine"
  | "propagation_engine"
  | "local_momentum_engine"
  | "local_microstructure_engine"
  | "mispricing_engine"
  | "reversion_engine"
  | "meta_engine";
export type EngineState = "inactive" | "weak" | "active" | "dominant" | "avoid";
export type EngineSourceScope = "local" | "cross_asset" | "meta";
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
  comboCode?: string;
  weight: number;
  isEnabled: boolean;
  totalResolved: number;
  executionTotalResolved: number;
  wins: number;
  losses: number;
  voids: number;
  hitRate: number;
  cumulativePnlProxy: number;
  averagePnlProxy: number;
  executionHitRate: number;
  executionAveragePnlProxy: number;
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
  cumulativePnlProxy: number;
  averagePnlProxy: number;
  averageSignedEdge: number;
  averageCalibrationError: number;
  recentStreak: number;
  lastResolvedAt: number | null;
  lastParticipatedAt: number | null;
  weight: number;
};
export type StrategyBoard = {
  marketKey: MarketKey;
  strategies: StrategySummary[];
};
export type SignalEngineContribution = {
  strategyId: string;
  strategyName: string;
  score: number;
  weight: number;
  signedContribution: number;
};
export type SignalEngineResult = {
  engineId: EngineId;
  name: string;
  setupType: SetupType;
  direction: PredictionDirection;
  score: number;
  confidence: number;
  isActive: boolean;
  state: EngineState;
  activationReason: string | null;
  blockingReason: string | null;
  regimeFit: number;
  memberStrategyIds: string[];
  memberContributions: SignalEngineContribution[];
  sourceScope: EngineSourceScope;
};
export type EngineCombinationResult = {
  comboKey: string;
  engineIds: EngineId[];
  setupType: SetupType;
  direction: PredictionDirection;
  score: number;
  confidence: number;
  diversityScore: number;
  regimeFitScore: number;
  reason: string;
};
export type EngineBoard = {
  marketKey: MarketKey;
  engines: SignalEngineResult[];
};
export type StrategyEvaluationResult = {
  marketKey: MarketKey;
  finalDirection: PredictionDirection;
  finalConfidence: number;
  weightedScore: number;
  baseWeightedScore: number;
  adjustedWeightedScore: number;
  baseConfidence: number;
  adjustedConfidence: number;
  strategyBreakdown: StrategySignal[];
  engineBreakdown: SignalEngineResult[];
  winningCombination: EngineCombinationResult;
  winningSetupType: SetupType;
  winningEngineIds: EngineId[];
  winningEngineComboKey: string;
  winningEngineComboScore: number;
  combinationReason: string;
  qualityScore: number;
  escalatedToMedium: boolean;
  escalatedToHigh: boolean;
  context: PredictionContext;
};
