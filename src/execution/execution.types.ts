/**
 * @section imports:internals
 */

import type { AssetSymbol, MarketKey, MarketWindow, PredictionDirection } from "../market/market.types.ts";

/**
 * @section types
 */

export type ExecutionStyle = "maker" | "taker";
export type PositionSide = "up" | "down";
export type TradeLifecycleStatus = "idle" | "entry_pending_maker" | "open" | "exit_pending_maker" | "closed";
export type TradeExitReason = "take_profit_hit" | "stop_loss_hit";
export type ExecutionDecision = {
  marketKey: MarketKey;
  asset: AssetSymbol;
  window: MarketWindow;
  isEntryAllowed: boolean;
  marketScore: number | null;
  marketTradeCount: number;
  hasSufficientMarketHistory: boolean;
  positionSide: PositionSide | null;
  predictionDirection: PredictionDirection | null;
  entryReferencePrice: number | null;
  orderShareCount: number;
  orderNotionalUsd: number | null;
  takeProfitPrice: number | null;
  stopLossPrice: number | null;
  executionStyle: ExecutionStyle | null;
  executionReason: string | null;
  urgencyScore: number;
  makerFillProbability: number;
  bookRiskScore: number;
  positionSizeSuggestion: number;
  gateFailures: string[];
  generatedAt: number | null;
};
export type PaperPosition = {
  positionId: string;
  marketKey: MarketKey;
  asset: AssetSymbol;
  window: MarketWindow;
  positionSide: PositionSide;
  entryDecisionAt: number;
  entryExecutionStyle: ExecutionStyle;
  shareCount: number;
  entryPostedPrice: number | null;
  entryFillPrice: number | null;
  entryFilledAt: number | null;
  takeProfitPrice: number;
  stopLossPrice: number;
  status: TradeLifecycleStatus;
  exitDecisionAt: number | null;
  exitExecutionStyle: ExecutionStyle | null;
  exitPostedPrice: number | null;
  exitFillPrice: number | null;
  exitFilledAt: number | null;
  exitReason: TradeExitReason | null;
  realizedPnlTokenPrice: number | null;
  realizedPnlAfterCosts: number | null;
  makerAttempts: number;
  hasTakerFallbackUsed: boolean;
  signalTimestamp: number;
};
export type PaperTrade = {
  positionId: string;
  marketKey: MarketKey;
  asset: AssetSymbol;
  window: MarketWindow;
  positionSide: PositionSide;
  shareCount: number;
  entryExecutionStyle: ExecutionStyle;
  exitExecutionStyle: ExecutionStyle;
  entryNotionalUsd: number;
  exitNotionalUsd: number;
  entryFillPrice: number;
  exitFillPrice: number;
  entryFilledAt: number;
  exitFilledAt: number;
  exitReason: TradeExitReason;
  realizedPnlTokenPrice: number;
  realizedPnlAfterCosts: number;
  holdTimeMs: number;
  hasTakerFallbackUsed: boolean;
};
export type OpenPositionSummary = {
  marketKey: MarketKey;
  asset: AssetSymbol;
  window: MarketWindow;
  positionSide: PositionSide;
  status: TradeLifecycleStatus;
  shareCount: number;
  entryExecutionStyle: ExecutionStyle;
  entryFillPrice: number | null;
  liveTokenPrice: number | null;
  unrealizedPnlTokenPrice: number | null;
  takeProfitPrice: number;
  stopLossPrice: number;
  suggestedExitStyle: ExecutionStyle | null;
};
export type MarketExecutionSummary = {
  marketKey: MarketKey;
  asset: AssetSymbol;
  window: MarketWindow;
  decision: ExecutionDecision;
  openPosition: OpenPositionSummary | null;
};
export type MarketPerformanceSummary = {
  marketKey: MarketKey;
  asset: AssetSymbol;
  window: MarketWindow;
  score: number;
  tradeCount: number;
  winRate: number;
  cumulativeNetPnl: number;
  averageNetPnlPerTrade: number;
  maxDrawdown: number;
  hasSufficientHistory: boolean;
  status: "warming_up" | "good" | "avoid";
};
export type PortfolioExecutionSummary = {
  openPositionCount: number;
  executableEntryCount: number;
  cumulativeNetPnl: number;
  averageNetPnlPerTrade: number;
  maxDrawdown: number;
  makerFillRate: number;
  makerUsageRatio: number;
  takerUsageRatio: number;
  tradeCount: number;
};
