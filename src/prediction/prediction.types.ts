/**
 * @section imports:internals
 */

import type { ComboBreakdown } from "../combo/combo.types.ts";
import type { AssetSymbol, MarketKey, MarketTrigger, MarketWindow, PredictionDirection } from "../market/market.types.ts";
import type { StrategySignal } from "../strategy/strategy.types.ts";

/**
 * @section types
 */

export type PredictionOutcomeStatus = "pending" | "ok" | "ko" | "void";
export type PredictionOutcome = {
  status: PredictionOutcomeStatus;
  resolvedAt: number | null;
  resolvedDirection: PredictionDirection | null;
  evaluationPrice: number | null;
  baselinePrice: number | null;
  isFallbackPriceUsed: boolean;
  reason: string | null;
};
export type PredictionRecord = {
  predictionId: string;
  asset: AssetSymbol;
  window: MarketWindow;
  marketKey: MarketKey;
  direction: PredictionDirection;
  confidence: number;
  weightedScore: number;
  baseWeightedScore: number;
  adjustedWeightedScore: number;
  baseConfidence: number;
  adjustedConfidence: number;
  trigger: MarketTrigger;
  createdAt: number;
  evaluationDueAt: number;
  baselineUpPrice: number | null;
  baselineUpMidpoint: number | null;
  strategyBreakdown: StrategySignal[];
  comboBreakdown: ComboBreakdown;
  isResolved: boolean;
  outcome: PredictionOutcome;
};
export type PredictionResponse = {
  asset: AssetSymbol;
  window: MarketWindow;
  marketKey: MarketKey;
  direction: PredictionDirection;
  confidence: number;
  weightedScore: number;
  baseWeightedScore: number;
  adjustedWeightedScore: number;
  baseConfidence: number;
  adjustedConfidence: number;
  timestamp: number;
  trigger: MarketTrigger;
  evaluationDueAt: number;
  isResolved: boolean;
  result: PredictionOutcome;
  strategyBreakdown: StrategySignal[];
  comboBreakdown: ComboBreakdown;
};
