/**
 * @section imports:internals
 */

import type { ExecutionStyle, PositionSide, TradeExitReason } from "../execution/execution.types.ts";
import type { AssetSymbol, MarketKey, MarketWindow, TriggerType, TriggeredToken } from "../market/market.types.ts";
import type { OpportunitySide, WindowPhase } from "../opportunity/opportunity.types.ts";
import type { PredictionOutcomeStatus } from "../prediction/prediction.types.ts";
import type { StrategyTier } from "../strategy/strategy.types.ts";

/**
 * @section types
 */

export type LlmEventType = "opportunity_created" | "opportunity_resolved" | "trade_closed";
export type LlmOpportunityCreatedEvent = {
  eventType: "opportunity_created";
  timestamp: number;
  opportunityId: string;
  marketKey: MarketKey;
  asset: AssetSymbol;
  window: MarketWindow;
  triggerType: TriggerType;
  triggeredToken: TriggeredToken;
  targetSide: OpportunitySide;
  windowPhase: WindowPhase;
  remainingMs: number | null;
  priceToBeat: number | null;
  referencePrice: number | null;
  barrierDistanceRatio: number | null;
  contestabilityScore: number;
  tpBeforeSlScore: number;
  entryQualityScore: number;
  selectedComboKey: string;
  selectedComboEdgeScore: number;
  selectedStrategyIds: string[];
  marketQualityScore: number | null;
  anchorConflictReason: string | null;
  isExecutionEligible: boolean;
  blockingReason: string | null;
};
export type LlmOpportunityResolvedEvent = {
  eventType: "opportunity_resolved";
  timestamp: number;
  opportunityId: string;
  marketKey: MarketKey;
  targetSide: OpportunitySide;
  windowPhase: WindowPhase;
  remainingMs: number | null;
  priceToBeat: number | null;
  referencePrice: number | null;
  barrierDistanceRatio: number | null;
  contestabilityScore: number;
  tpBeforeSlScore: number;
  entryQualityScore: number;
  selectedComboKey: string;
  selectedStrategyIds: string[];
  outcomeStatus: PredictionOutcomeStatus;
  outcomeReason: string | null;
  closeTokenPrice: number | null;
  entryTokenPrice: number | null;
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
export type LlmEvent = LlmOpportunityCreatedEvent | LlmOpportunityResolvedEvent | LlmTradeClosedEvent;
export type LlmSummaryCounts = {
  opportunitiesCreated: number;
  opportunitiesResolved: number;
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
  opportunityCount: number;
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
