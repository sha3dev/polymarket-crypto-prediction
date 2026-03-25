/**
 * @section imports:internals
 */

import type { ExecutionStyle, PositionSide, TradeExitReason } from "../execution/execution.types.ts";
import type { AssetSymbol, MarketKey, MarketWindow, PredictionDirection, TriggerType, TriggeredToken } from "../market/market.types.ts";
import type { PredictionOutcomeStatus } from "../prediction/prediction.types.ts";
import type { StrategyTier } from "../strategy/strategy.types.ts";

/**
 * @section types
 */

export type LlmEventType = "prediction_created" | "prediction_resolved" | "trade_closed";
export type LlmPredictionCreatedEvent = {
  eventType: "prediction_created";
  timestamp: number;
  predictionId: string;
  marketKey: MarketKey;
  asset: AssetSymbol;
  window: MarketWindow;
  triggerType: TriggerType;
  triggeredToken: TriggeredToken;
  direction: PredictionDirection;
  confidence: number;
  weightedScore: number;
  selectedComboKey: string;
  selectedComboScore: number;
  selectedComboConfidence: number;
  selectedStrategyIds: string[];
  marketQualityScore: number;
  regimeId: string;
  isExecutionEligible: boolean;
  blockingReason: string | null;
};
export type LlmPredictionResolvedEvent = {
  eventType: "prediction_resolved";
  timestamp: number;
  predictionId: string;
  marketKey: MarketKey;
  direction: PredictionDirection;
  confidence: number;
  selectedComboKey: string;
  selectedStrategyIds: string[];
  outcomeStatus: PredictionOutcomeStatus;
  outcomeReason: string | null;
  resolvedDirection: PredictionDirection | null;
  evaluationPrice: number | null;
  baselinePrice: number | null;
  wasExecuted: boolean;
  strategies: {
    strategyId: string;
    name: string;
    tier: StrategyTier;
    weight: number;
  }[];
};
export type LlmTradeClosedEvent = {
  eventType: "trade_closed";
  timestamp: number;
  positionId: string;
  marketKey: MarketKey;
  asset: AssetSymbol;
  window: MarketWindow;
  positionSide: PositionSide;
  entryStyle: ExecutionStyle;
  exitStyle: ExecutionStyle;
  exitReason: TradeExitReason;
  holdTimeMs: number;
  realizedPnlAfterCosts: number;
  hasTakerFallbackUsed: boolean;
};
export type LlmEvent = LlmPredictionCreatedEvent | LlmPredictionResolvedEvent | LlmTradeClosedEvent;
export type LlmSummaryCounts = {
  predictionsCreated: number;
  predictionsResolved: number;
  wins: number;
  losses: number;
  tradesClosed: number;
};
export type LlmSummaryQuality = {
  resolvedAccuracy: number | null;
  averageConfidence: number | null;
  averageWinConfidence: number | null;
  averageLossConfidence: number | null;
};
export type LlmMarketSummary = {
  marketKey: MarketKey;
  predictionCount: number;
  resolvedCount: number;
  winCount: number;
  lossCount: number;
  resolvedAccuracy: number | null;
  tradeCount: number;
  cumulativePnl: number;
};
export type LlmStrategySummary = {
  strategyId: string;
  name: string;
  tier: StrategyTier;
  appearances: number;
  wins: number;
  losses: number;
  hitRate: number | null;
  averageWeight: number | null;
};
export type LlmComboSummary = {
  comboKey: string;
  resolvedCount: number;
  wins: number;
  losses: number;
  hitRate: number | null;
};
export type LlmRecentReference = {
  eventType: LlmEventType;
  timestamp: number;
  referenceId: string;
  marketKey: MarketKey;
};
export type LlmSummary = {
  counts: LlmSummaryCounts;
  quality: LlmSummaryQuality;
  markets: Record<MarketKey, LlmMarketSummary>;
  strategies: Record<string, LlmStrategySummary>;
  combos: Record<string, LlmComboSummary>;
  executionBlockers: Record<string, number>;
  recentReferences: LlmRecentReference[];
  confidenceTotals: {
    resolved: number;
    wins: number;
    losses: number;
  };
};
