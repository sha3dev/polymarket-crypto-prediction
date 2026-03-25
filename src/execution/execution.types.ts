/**
 * @section imports:internals
 */

import type { ComboSize } from "../combo/combo.types.ts";
import type { AssetSymbol, CrossAssetBreadthDirection, MarketKey, MarketWindow, PredictionDirection } from "../market/market.types.ts";

/**
 * @section types
 */

export type ExecutionStyle = "maker" | "taker";
export type PositionSide = "up" | "down";
export type TradeLifecycleStatus = "idle" | "entry_pending_maker" | "open" | "exit_pending_maker" | "closed";
export type TradeExitReason = "take_profit_hit" | "stop_loss_hit";
export type ComboSource = "research" | "execution";
export type ExecutionMode = "paper" | "real";
export type SelectedComboSnapshot = {
  selectedComboKey: string | null;
  selectedComboSize: ComboSize | null;
  selectedComboSource: ComboSource | null;
  selectedComboDirection: PredictionDirection | null;
  selectedComboScore: number | null;
  predictionConfidence: number | null;
  selectedComboStrategyIds: string[];
};
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
  breadthDirection: CrossAssetBreadthDirection;
  breadthStrength: number | null;
  hasStrongBreadth: boolean;
  hasBreadthAlignment: boolean;
  selectedComboKey: string | null;
  selectedComboSize: ComboSize | null;
  selectedComboSource: ComboSource | null;
  selectedComboDirection: PredictionDirection | null;
  selectedComboScore: number | null;
  predictionConfidence: number | null;
  selectedComboStrategyIds: string[];
  selectedComboAffordabilityScore: number | null;
  regimeId: string | null;
  blockingReasons: string[];
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
export type ExecutionTrade = {
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
export type PaperTrade = ExecutionTrade;
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
  predictionCount: number;
  marketScore: number;
  tradeCount: number;
  researchPredictionCount: number;
  executedTradeCount: number;
  winRate: number;
  cumulativeNetPnl: number;
  averageNetPnlPerTrade: number;
  maxDrawdown: number;
  hasSufficientHistory: boolean;
  hasWarmupComplete: boolean;
  hasComboReadiness: boolean;
  status: "warming_up" | "research_only" | "tradable" | "avoid";
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
export type ExecutionAccountSummary = {
  mode: ExecutionMode;
  balanceUsd: number | null;
  lastBalanceRefreshAt: number | null;
  isBalanceStale: boolean;
  lastBalanceError: string | null;
};
export type ExecutionServiceSnapshot = {
  executionMode: ExecutionMode;
  account: ExecutionAccountSummary;
  executionNow: MarketExecutionSummary[];
  openPositions: OpenPositionSummary[];
  executionPerformance: PortfolioExecutionSummary;
};
export type ExecutionService = {
  getExecutionMode(): ExecutionMode;
  handleSnapshot(generatedAt: number): Promise<void> | void;
  getExecutionSummaries(): MarketExecutionSummary[];
  getOpenPositions(): OpenPositionSummary[];
  getRecentTrades(limit: number): ExecutionTrade[];
  getPortfolioSummary(): PortfolioExecutionSummary;
  getMarketPerformanceSummaries(): MarketPerformanceSummary[];
  getOpenPositionCount(): number;
  getAccountSummary(nowTimestamp: number): Promise<ExecutionAccountSummary> | ExecutionAccountSummary;
  disconnect(): Promise<void>;
};
