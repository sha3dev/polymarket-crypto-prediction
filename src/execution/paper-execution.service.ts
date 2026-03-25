/**
 * @section imports:internals
 */

import { randomUUID } from "node:crypto";
import config from "../config.ts";
import type { MarketStateService } from "../market/market-state.service.ts";
import type { AssetSymbol, MarketKey, MarketSnapshotSlice, MarketWindow } from "../market/market.types.ts";
import { SUPPORTED_ASSETS, SUPPORTED_WINDOWS } from "../market/market.types.ts";
import type { PredictionEngineService } from "../prediction/prediction-engine.service.ts";
import type { PredictionResponse } from "../prediction/prediction.types.ts";
import type { ExecutionPolicyService } from "./execution-policy.service.ts";
import type {
  ExecutionAccountSummary,
  ExecutionDecision,
  ExecutionStyle,
  ExecutionTrade,
  MarketExecutionSummary,
  MarketPerformanceSummary,
  OpenPositionSummary,
  PaperPosition,
  PaperTrade,
  PortfolioExecutionSummary,
  PositionSide,
  TradeExitReason,
} from "./execution.types.ts";

/**
 * @section types
 */

type EquityState = { peak: number; running: number; maxDrawdown: number };

/**
 * @section class
 */

export class PaperExecutionService {
  /**
   * @section private:attributes
   */

  private readonly marketStateService: MarketStateService;
  private readonly predictionEngineService: PredictionEngineService;
  private readonly executionPolicyService: ExecutionPolicyService;
  private readonly executionDecisions: Map<MarketKey, ExecutionDecision>;
  private readonly openPositions: Map<MarketKey, PaperPosition>;
  private readonly recentTrades: PaperTrade[];
  private readonly consumedSignalTimestamps: Map<MarketKey, number>;
  private latestObservedAt: number | null;

  /**
   * @section constructor
   */

  public constructor(marketStateService: MarketStateService, predictionEngineService: PredictionEngineService, executionPolicyService: ExecutionPolicyService) {
    this.marketStateService = marketStateService;
    this.predictionEngineService = predictionEngineService;
    this.executionPolicyService = executionPolicyService;
    this.executionDecisions = new Map<MarketKey, ExecutionDecision>();
    this.openPositions = new Map<MarketKey, PaperPosition>();
    this.recentTrades = [];
    this.consumedSignalTimestamps = new Map<MarketKey, number>();
    this.latestObservedAt = null;
  }

  /**
   * @section private:methods
   */

  private buildMarketKey(asset: AssetSymbol, window: MarketWindow): MarketKey {
    const marketKey: MarketKey = `${asset}:${window}`;
    return marketKey;
  }

  private resolvePrediction(asset: AssetSymbol, window: MarketWindow): PredictionResponse | null {
    const predictionResponse = this.predictionEngineService.getLatestPrediction(asset, window);
    return predictionResponse;
  }

  private resolveLiveTokenPrice(marketSlice: MarketSnapshotSlice, positionSide: PositionSide): number | null {
    const tokenMetrics = positionSide === "up" ? marketSlice.up : marketSlice.down;
    return tokenMetrics.midpoint ?? tokenMetrics.price;
  }

  private resolveBestBid(marketSlice: MarketSnapshotSlice, positionSide: PositionSide): number | null {
    const tokenMetrics = positionSide === "up" ? marketSlice.up : marketSlice.down;
    return tokenMetrics.bestBid;
  }

  private resolveBestAsk(marketSlice: MarketSnapshotSlice, positionSide: PositionSide): number | null {
    const tokenMetrics = positionSide === "up" ? marketSlice.up : marketSlice.down;
    return tokenMetrics.bestAsk;
  }

  private roundPolymarketFeePrecision(rawFee: number): number {
    const roundedFee = Math.round(rawFee * 10_000) / 10_000;
    const normalizedFee = roundedFee < 0.0001 ? 0 : roundedFee;
    return normalizedFee;
  }

  private computePolymarketCryptoTakerFee(fillPrice: number, shareCount: number): number {
    const feeRate = 0.25;
    const exponent = 2;
    const fee = shareCount * fillPrice * feeRate * (fillPrice * (1 - fillPrice)) ** exponent;
    const normalizedFee = this.roundPolymarketFeePrecision(fee);
    return normalizedFee;
  }

  private computeExecutionSlippageCost(
    spread: number,
    executionStyle: ExecutionStyle,
    marketSlice: MarketSnapshotSlice,
    positionSide: PositionSide,
    shareCount: number,
  ): number {
    const tokenMetrics = positionSide === "up" ? marketSlice.up : marketSlice.down;
    const depthPenalty = tokenMetrics.depthTop < config.MIN_DEPTH_FOR_MAKER ? config.LOW_DEPTH_SLIPPAGE_PROXY : 0;
    const slippageCost = (executionStyle === "taker" ? spread * 0.5 + depthPenalty : spread * 0.1) * shareCount;
    return slippageCost;
  }

  private applyEntryCosts(
    entryFillPrice: number,
    executionStyle: ExecutionStyle,
    marketSlice: MarketSnapshotSlice,
    positionSide: PositionSide,
    shareCount: number,
  ): number {
    const spread = positionSide === "up" ? (marketSlice.up.spread ?? 0) : (marketSlice.down.spread ?? 0);
    const exchangeFee = executionStyle === "taker" ? this.computePolymarketCryptoTakerFee(entryFillPrice, shareCount) : 0;
    const cost = exchangeFee + this.computeExecutionSlippageCost(spread, executionStyle, marketSlice, positionSide, shareCount);
    return cost;
  }

  private applyExitCosts(
    exitFillPrice: number,
    executionStyle: ExecutionStyle,
    marketSlice: MarketSnapshotSlice,
    positionSide: PositionSide,
    shareCount: number,
  ): number {
    const spread = positionSide === "up" ? (marketSlice.up.spread ?? 0) : (marketSlice.down.spread ?? 0);
    const exchangeFee = executionStyle === "taker" ? this.computePolymarketCryptoTakerFee(exitFillPrice, shareCount) : 0;
    const cost = exchangeFee + this.computeExecutionSlippageCost(spread, executionStyle, marketSlice, positionSide, shareCount);
    return cost;
  }

  private resolveTakerEntryFillPrice(marketSlice: MarketSnapshotSlice, positionSide: PositionSide): number | null {
    const bestAsk = this.resolveBestAsk(marketSlice, positionSide);
    const fallbackPrice = this.resolveLiveTokenPrice(marketSlice, positionSide);
    const takerFillPrice = bestAsk ?? fallbackPrice;
    return takerFillPrice;
  }

  private resolveTakerExitFillPrice(marketSlice: MarketSnapshotSlice, positionSide: PositionSide): number | null {
    const bestBid = this.resolveBestBid(marketSlice, positionSide);
    const fallbackPrice = this.resolveLiveTokenPrice(marketSlice, positionSide);
    const takerExitFillPrice = bestBid ?? fallbackPrice;
    return takerExitFillPrice;
  }

  private buildPosition(marketSlice: MarketSnapshotSlice, executionDecision: ExecutionDecision, signalTimestamp: number): PaperPosition {
    return {
      positionId: randomUUID(),
      marketKey: marketSlice.marketKey,
      asset: marketSlice.asset,
      window: marketSlice.window,
      positionSide: executionDecision.positionSide as PositionSide,
      entryDecisionAt: marketSlice.generatedAt,
      entryExecutionStyle: executionDecision.executionStyle as ExecutionStyle,
      shareCount: executionDecision.orderShareCount,
      entryPostedPrice: executionDecision.executionStyle === "maker" ? executionDecision.entryReferencePrice : null,
      entryFillPrice: null,
      entryFilledAt: null,
      takeProfitPrice: executionDecision.takeProfitPrice as number,
      stopLossPrice: executionDecision.stopLossPrice as number,
      status: executionDecision.executionStyle === "maker" ? "entry_pending_maker" : "open",
      exitDecisionAt: null,
      exitExecutionStyle: null,
      exitPostedPrice: null,
      exitFillPrice: null,
      exitFilledAt: null,
      exitReason: null,
      realizedPnlTokenPrice: null,
      realizedPnlAfterCosts: null,
      makerAttempts: executionDecision.executionStyle === "maker" ? 1 : 0,
      hasTakerFallbackUsed: false,
      signalTimestamp,
    };
  }

  private maybeOpenPosition(marketSlice: MarketSnapshotSlice, executionDecision: ExecutionDecision, signalTimestamp: number): boolean {
    let hasOpenedPosition = false;
    const canOpenPosition =
      executionDecision.isEntryAllowed && !this.openPositions.has(marketSlice.marketKey) && this.openPositions.size < config.MAX_OPEN_POSITIONS_GLOBAL;
    if (canOpenPosition) {
      const paperPosition = this.buildPosition(marketSlice, executionDecision, signalTimestamp);
      if (paperPosition.status === "open") {
        const takerFillPrice = this.resolveTakerEntryFillPrice(marketSlice, paperPosition.positionSide);
        if (takerFillPrice !== null) {
          paperPosition.entryFillPrice = takerFillPrice;
          paperPosition.entryFilledAt = marketSlice.generatedAt;
        }
      }
      this.openPositions.set(marketSlice.marketKey, paperPosition);
      this.consumedSignalTimestamps.set(marketSlice.marketKey, signalTimestamp);
      this.predictionEngineService.markPredictionExecuted(marketSlice.marketKey, signalTimestamp);
      hasOpenedPosition = true;
    }
    return hasOpenedPosition;
  }

  private maybeFillPendingEntry(marketSlice: MarketSnapshotSlice, paperPosition: PaperPosition): void {
    const makerEntryPrice = paperPosition.entryPostedPrice;
    const bestAsk = this.resolveBestAsk(marketSlice, paperPosition.positionSide);
    const hasCrossedPrice = bestAsk !== null && makerEntryPrice !== null && bestAsk <= makerEntryPrice;
    const hasTimedOut = paperPosition.entryDecisionAt + config.MAKER_ENTRY_TIMEOUT_MS <= marketSlice.generatedAt;
    if (hasCrossedPrice && makerEntryPrice !== null) {
      paperPosition.entryFillPrice = makerEntryPrice;
      paperPosition.entryFilledAt = marketSlice.generatedAt;
      paperPosition.status = "open";
    }
    if (!hasCrossedPrice && hasTimedOut) {
      const takerFillPrice = this.resolveTakerEntryFillPrice(marketSlice, paperPosition.positionSide);
      if (takerFillPrice !== null) {
        paperPosition.entryFillPrice = takerFillPrice;
        paperPosition.entryFilledAt = marketSlice.generatedAt;
        paperPosition.status = "open";
        paperPosition.hasTakerFallbackUsed = true;
      } else {
        this.openPositions.delete(marketSlice.marketKey);
      }
    }
  }

  private maybeInitiateExit(marketSlice: MarketSnapshotSlice, paperPosition: PaperPosition): void {
    const exitDecision = this.executionPolicyService.buildExitDecision(marketSlice, paperPosition);
    if (exitDecision.exitReason !== null && exitDecision.executionStyle !== null) {
      paperPosition.exitDecisionAt = marketSlice.generatedAt;
      paperPosition.exitExecutionStyle = exitDecision.executionStyle;
      paperPosition.exitReason = exitDecision.exitReason;
      if (exitDecision.executionStyle === "maker") {
        paperPosition.status = "exit_pending_maker";
        paperPosition.exitPostedPrice = exitDecision.exitPrice;
      } else {
        const takerExitFillPrice = this.resolveTakerExitFillPrice(marketSlice, paperPosition.positionSide);
        if (takerExitFillPrice !== null) {
          this.closePosition(marketSlice, paperPosition, takerExitFillPrice, exitDecision.exitReason, "taker");
        }
      }
    }
  }

  private maybeFillPendingExit(marketSlice: MarketSnapshotSlice, paperPosition: PaperPosition): void {
    const makerExitPrice = paperPosition.exitPostedPrice;
    const bestBid = this.resolveBestBid(marketSlice, paperPosition.positionSide);
    const hasCrossedPrice = bestBid !== null && makerExitPrice !== null && bestBid >= makerExitPrice;
    const hasTimedOut = (paperPosition.exitDecisionAt ?? 0) + config.MAKER_EXIT_TIMEOUT_MS <= marketSlice.generatedAt;
    if (hasCrossedPrice && makerExitPrice !== null && paperPosition.exitReason !== null) {
      this.closePosition(marketSlice, paperPosition, makerExitPrice, paperPosition.exitReason, "maker");
    }
    if (!hasCrossedPrice && hasTimedOut && paperPosition.exitReason !== null) {
      const takerExitFillPrice = this.resolveTakerExitFillPrice(marketSlice, paperPosition.positionSide);
      if (takerExitFillPrice !== null) {
        paperPosition.hasTakerFallbackUsed = true;
        this.closePosition(marketSlice, paperPosition, takerExitFillPrice, paperPosition.exitReason, "taker");
      }
    }
  }

  private closePosition(
    marketSlice: MarketSnapshotSlice,
    paperPosition: PaperPosition,
    exitFillPrice: number,
    exitReason: TradeExitReason,
    exitExecutionStyle: ExecutionStyle,
  ): void {
    const entryFillPrice = paperPosition.entryFillPrice;
    const entryFilledAt = paperPosition.entryFilledAt;
    if (entryFillPrice !== null && entryFilledAt !== null) {
      const grossMove = (exitFillPrice - entryFillPrice) * paperPosition.shareCount;
      const entryCost = this.applyEntryCosts(
        entryFillPrice,
        paperPosition.entryExecutionStyle,
        marketSlice,
        paperPosition.positionSide,
        paperPosition.shareCount,
      );
      const exitCost = this.applyExitCosts(exitFillPrice, exitExecutionStyle, marketSlice, paperPosition.positionSide, paperPosition.shareCount);
      paperPosition.exitFillPrice = exitFillPrice;
      paperPosition.exitFilledAt = marketSlice.generatedAt;
      paperPosition.exitExecutionStyle = exitExecutionStyle;
      paperPosition.exitReason = exitReason;
      paperPosition.realizedPnlTokenPrice = grossMove;
      paperPosition.realizedPnlAfterCosts = grossMove - entryCost - exitCost;
      paperPosition.status = "closed";
      this.recentTrades.unshift({
        positionId: paperPosition.positionId,
        marketKey: paperPosition.marketKey,
        asset: paperPosition.asset,
        window: paperPosition.window,
        positionSide: paperPosition.positionSide,
        shareCount: paperPosition.shareCount,
        entryExecutionStyle: paperPosition.entryExecutionStyle,
        exitExecutionStyle,
        entryNotionalUsd: entryFillPrice * paperPosition.shareCount,
        exitNotionalUsd: exitFillPrice * paperPosition.shareCount,
        entryFillPrice,
        exitFillPrice,
        entryFilledAt,
        exitFilledAt: marketSlice.generatedAt,
        exitReason,
        realizedPnlTokenPrice: paperPosition.realizedPnlTokenPrice,
        realizedPnlAfterCosts: paperPosition.realizedPnlAfterCosts,
        holdTimeMs: marketSlice.generatedAt - entryFilledAt,
        hasTakerFallbackUsed: paperPosition.hasTakerFallbackUsed,
      });
      if (this.recentTrades.length > config.MAX_PREDICTION_HISTORY_PER_MARKET * 4) {
        this.recentTrades.splice(config.MAX_PREDICTION_HISTORY_PER_MARKET * 4);
      }
      this.openPositions.delete(paperPosition.marketKey);
      this.predictionEngineService.resolvePredictionFromTrade(
        paperPosition.marketKey,
        paperPosition.signalTimestamp,
        exitReason,
        exitFillPrice,
        marketSlice.generatedAt,
      );
    }
  }

  private buildOpenPositionSummary(marketSlice: MarketSnapshotSlice, paperPosition: PaperPosition): OpenPositionSummary {
    const liveTokenPrice = this.resolveLiveTokenPrice(marketSlice, paperPosition.positionSide);
    const unrealizedPnlTokenPrice = paperPosition.entryFillPrice === null || liveTokenPrice === null ? null : liveTokenPrice - paperPosition.entryFillPrice;
    return {
      marketKey: paperPosition.marketKey,
      asset: paperPosition.asset,
      window: paperPosition.window,
      positionSide: paperPosition.positionSide,
      status: paperPosition.status,
      shareCount: paperPosition.shareCount,
      entryExecutionStyle: paperPosition.entryExecutionStyle,
      entryFillPrice: paperPosition.entryFillPrice,
      liveTokenPrice,
      unrealizedPnlTokenPrice: unrealizedPnlTokenPrice === null ? null : unrealizedPnlTokenPrice * paperPosition.shareCount,
      takeProfitPrice: paperPosition.takeProfitPrice,
      stopLossPrice: paperPosition.stopLossPrice,
      suggestedExitStyle: paperPosition.exitExecutionStyle,
    };
  }

  private buildPortfolioSummary(): PortfolioExecutionSummary {
    const equityState: EquityState = { peak: 0, running: 0, maxDrawdown: 0 };
    let makerEntries = 0;
    let takerEntries = 0;
    let makerTrades = 0;
    for (const paperTrade of [...this.recentTrades].reverse()) {
      equityState.running += paperTrade.realizedPnlAfterCosts;
      if (equityState.running > equityState.peak) {
        equityState.peak = equityState.running;
      }
      const drawdown = equityState.peak - equityState.running;
      if (drawdown > equityState.maxDrawdown) {
        equityState.maxDrawdown = drawdown;
      }
      if (paperTrade.entryExecutionStyle === "maker") {
        makerEntries += 1;
      } else {
        takerEntries += 1;
      }
      if (paperTrade.entryExecutionStyle === "maker" || paperTrade.exitExecutionStyle === "maker") {
        makerTrades += 1;
      }
    }
    const tradeCount = this.recentTrades.length;
    return {
      openPositionCount: this.openPositions.size,
      executableEntryCount: [...this.executionDecisions.values()].filter((decision) => decision.isEntryAllowed).length,
      cumulativeNetPnl: equityState.running,
      averageNetPnlPerTrade: tradeCount === 0 ? 0 : equityState.running / tradeCount,
      maxDrawdown: equityState.maxDrawdown,
      makerFillRate: tradeCount === 0 ? 0 : makerTrades / tradeCount,
      makerUsageRatio: tradeCount === 0 ? 0 : makerEntries / tradeCount,
      takerUsageRatio: tradeCount === 0 ? 0 : takerEntries / tradeCount,
      tradeCount,
    };
  }

  private readRollingTradeCutoff(nowTimestamp: number | null): number | null {
    const rollingTradeCutoff = nowTimestamp === null ? null : nowTimestamp - config.MARKET_SCORE_WINDOW_SECONDS * 1_000;
    return rollingTradeCutoff;
  }

  private readWindowedTrades(marketKey: MarketKey): PaperTrade[] {
    const rollingTradeCutoff = this.readRollingTradeCutoff(this.latestObservedAt);
    const windowedTrades = this.recentTrades.filter((paperTrade) => {
      const isSameMarket = paperTrade.marketKey === marketKey;
      const isInsideWindow = rollingTradeCutoff === null || paperTrade.exitFilledAt >= rollingTradeCutoff;
      return isSameMarket && isInsideWindow;
    });
    return windowedTrades;
  }

  private readWindowedResearchPredictions(asset: AssetSymbol, window: MarketWindow): PredictionResponse[] {
    const rollingTradeCutoff = this.readRollingTradeCutoff(this.latestObservedAt);
    const researchPredictions = this.predictionEngineService
      .getPredictions(asset, window, config.MAX_PREDICTION_HISTORY_PER_MARKET)
      .filter((prediction) => prediction.isResolved);
    const windowedResearchPredictions = researchPredictions.filter((prediction) => {
      const resolvedAt = prediction.result.resolvedAt;
      return rollingTradeCutoff === null || resolvedAt === null || resolvedAt >= rollingTradeCutoff;
    });
    return windowedResearchPredictions;
  }

  private computeExecutionScore(windowedTrades: PaperTrade[]): number | null {
    let executionScore: number | null = null;
    if (windowedTrades.length > 0) {
      const winCount = windowedTrades.filter((paperTrade) => paperTrade.realizedPnlAfterCosts > 0).length;
      const hitRate = winCount / windowedTrades.length;
      const cumulativeNetPnl = windowedTrades.reduce((aggregatedPnl, paperTrade) => aggregatedPnl + paperTrade.realizedPnlAfterCosts, 0);
      const averageNetPnlPerTrade = cumulativeNetPnl / windowedTrades.length;
      const marketEquityState: EquityState = { peak: 0, running: 0, maxDrawdown: 0 };
      for (const paperTrade of windowedTrades) {
        marketEquityState.running += paperTrade.realizedPnlAfterCosts;
        if (marketEquityState.running > marketEquityState.peak) {
          marketEquityState.peak = marketEquityState.running;
        }
        const drawdown = marketEquityState.peak - marketEquityState.running;
        if (drawdown > marketEquityState.maxDrawdown) {
          marketEquityState.maxDrawdown = drawdown;
        }
      }
      const sampleTrust = Math.min(1, windowedTrades.length / Math.max(1, config.MIN_MARKET_TRADES_FOR_SCORING * 2));
      const pnlComponent = Math.max(-1, Math.min(1, averageNetPnlPerTrade / 0.1));
      const drawdownPenalty = Math.max(0, Math.min(1, marketEquityState.maxDrawdown / 0.6));
      executionScore = Math.max(0, Math.min(1, 0.5 + ((hitRate - 0.5) * 0.5 + pnlComponent * 0.35 - drawdownPenalty * 0.25) * sampleTrust));
    }
    return executionScore;
  }

  private computeResearchScore(windowedPredictions: PredictionResponse[]): number {
    let researchScore = 0.5;
    if (windowedPredictions.length > 0) {
      const resolvedPredictions = windowedPredictions.filter((prediction) => prediction.result.status !== "void");
      const winCount = resolvedPredictions.filter((prediction) => prediction.result.status === "ok").length;
      const hitRate = resolvedPredictions.length === 0 ? 0.5 : winCount / resolvedPredictions.length;
      const cumulativeSignedEdge = resolvedPredictions.reduce((aggregatedEdge, prediction) => {
        const signedEdge = prediction.result.status === "ok" ? prediction.confidence : prediction.confidence * -1;
        return aggregatedEdge + signedEdge;
      }, 0);
      const averageSignedEdge = resolvedPredictions.length === 0 ? 0 : cumulativeSignedEdge / resolvedPredictions.length;
      const calibrationError =
        windowedPredictions.length === 0
          ? 0.5
          : windowedPredictions.reduce((aggregatedError, prediction) => {
              const targetConfidence = prediction.result.status === "ok" ? 1 : prediction.result.status === "ko" ? 0 : prediction.confidence;
              return aggregatedError + Math.abs(prediction.confidence - targetConfidence);
            }, 0) / windowedPredictions.length;
      const sampleTrust = Math.min(1, windowedPredictions.length / Math.max(1, config.MIN_RESEARCH_PREDICTIONS_FOR_BOOTSTRAP * 2));
      researchScore = Math.max(0, Math.min(1, 0.5 + ((hitRate - 0.5) * 0.6 + averageSignedEdge * 0.35 - calibrationError * 0.2) * sampleTrust));
    }
    return researchScore;
  }

  private computeBootstrapDiscount(researchPredictionCount: number, tradeCount: number, qualityScore: number): number {
    const researchProgress = Math.max(0, Math.min(1, researchPredictionCount / Math.max(1, config.MIN_RESEARCH_PREDICTIONS_FOR_BOOTSTRAP)));
    const tradeProgress = Math.max(0, Math.min(1, tradeCount / Math.max(1, config.MIN_MARKET_TRADES_FOR_SCORING)));
    const bootstrapDiscount =
      config.EXECUTION_BOOTSTRAP_MIN_DISCOUNT +
      (config.EXECUTION_BOOTSTRAP_MAX_DISCOUNT - config.EXECUTION_BOOTSTRAP_MIN_DISCOUNT) * (researchProgress * 0.7 + tradeProgress * 0.2 + qualityScore * 0.1);
    return bootstrapDiscount;
  }

  private applyBootstrapDiscountToResearchScore(researchScore: number, bootstrapDiscount: number): number {
    const neutralScore = 0.5;
    const discountedResearchScore = neutralScore + (researchScore - neutralScore) * bootstrapDiscount;
    const normalizedDiscountedResearchScore = Math.max(0, Math.min(1, discountedResearchScore));
    return normalizedDiscountedResearchScore;
  }

  private buildMarketPerformanceSummary(asset: AssetSymbol, window: MarketWindow): MarketPerformanceSummary {
    const marketKey = this.buildMarketKey(asset, window);
    const latestPrediction = this.resolvePrediction(asset, window);
    const predictionCount = this.predictionEngineService.getPredictionCount(asset, window);
    const windowedTrades = this.readWindowedTrades(marketKey).sort((leftTrade, rightTrade) => {
      return leftTrade.exitFilledAt - rightTrade.exitFilledAt;
    });
    const windowedResearchPredictions = this.readWindowedResearchPredictions(asset, window);
    const tradeCount = windowedTrades.length;
    const winCount = windowedTrades.filter((paperTrade) => paperTrade.realizedPnlAfterCosts > 0).length;
    const cumulativeNetPnl = windowedTrades.reduce((aggregatedPnl, paperTrade) => aggregatedPnl + paperTrade.realizedPnlAfterCosts, 0);
    const averageNetPnlPerTrade = tradeCount === 0 ? 0 : cumulativeNetPnl / tradeCount;
    const marketEquityState: EquityState = { peak: 0, running: 0, maxDrawdown: 0 };
    for (const paperTrade of windowedTrades) {
      marketEquityState.running += paperTrade.realizedPnlAfterCosts;
      if (marketEquityState.running > marketEquityState.peak) {
        marketEquityState.peak = marketEquityState.running;
      }
      const drawdown = marketEquityState.peak - marketEquityState.running;
      if (drawdown > marketEquityState.maxDrawdown) {
        marketEquityState.maxDrawdown = drawdown;
      }
    }
    const researchScore = this.computeResearchScore(windowedResearchPredictions);
    const executionScore = this.computeExecutionScore(windowedTrades);
    const marketSlice = this.marketStateService.getLatestSlice(marketKey);
    const bootstrapDiscount = this.computeBootstrapDiscount(windowedResearchPredictions.length, tradeCount, marketSlice?.quality.score ?? 0);
    const discountedResearchScore = this.applyBootstrapDiscountToResearchScore(researchScore, bootstrapDiscount);
    const effectiveExecutionScore = executionScore === null ? discountedResearchScore : Math.min(executionScore, discountedResearchScore);
    const hasSufficientHistory = tradeCount >= config.MIN_MARKET_TRADES_FOR_SCORING;
    const hasWarmupComplete =
      predictionCount >= config.MIN_MARKET_PREDICTIONS_BEFORE_ENTRY && windowedResearchPredictions.length >= config.MIN_RESEARCH_PREDICTIONS_FOR_BOOTSTRAP;
    const hasComboReadiness = latestPrediction?.selectedCombo.isExecutionEligible ?? false;
    let status: MarketPerformanceSummary["status"] = "warming_up";
    if (hasWarmupComplete) {
      status = "research_only";
      if (effectiveExecutionScore < config.MIN_EXECUTION_SCORE_FOR_ENTRY || researchScore < config.MIN_RESEARCH_SCORE_FOR_BOOTSTRAP) {
        status = "avoid";
      }
      if (effectiveExecutionScore >= config.MIN_EXECUTION_SCORE_FOR_ENTRY && hasComboReadiness) {
        status = "tradable";
      }
    }
    return {
      marketKey,
      asset,
      window,
      predictionCount,
      score: effectiveExecutionScore,
      researchScore,
      executionScore,
      effectiveExecutionScore,
      tradeCount,
      researchPredictionCount: windowedResearchPredictions.length,
      executedTradeCount: tradeCount,
      winRate: tradeCount === 0 ? 0.5 : winCount / tradeCount,
      cumulativeNetPnl,
      averageNetPnlPerTrade,
      maxDrawdown: marketEquityState.maxDrawdown,
      hasSufficientHistory,
      hasWarmupComplete,
      hasComboReadiness,
      status,
    };
  }

  /**
   * @section public:methods
   */

  public handleSnapshot(generatedAt: number): void {
    this.latestObservedAt = generatedAt;
    for (const asset of SUPPORTED_ASSETS) {
      for (const window of SUPPORTED_WINDOWS) {
        const marketKey = this.buildMarketKey(asset, window);
        const marketSlice = this.marketStateService.getLatestSlice(marketKey);
        if (marketSlice !== null) {
          const latestPrediction = this.resolvePrediction(asset, window);
          const openPosition = this.openPositions.get(marketKey) ?? null;
          const marketPerformanceSummary = this.buildMarketPerformanceSummary(asset, window);
          const executionDecision = this.executionPolicyService.buildEntryDecision(marketSlice, latestPrediction, openPosition, marketPerformanceSummary);
          if (executionDecision !== null) {
            this.executionDecisions.set(marketKey, executionDecision);
          }
          if (latestPrediction !== null && executionDecision !== null) {
            this.predictionEngineService.markExecutionEligibility(
              marketKey,
              latestPrediction.timestamp,
              executionDecision.isEntryAllowed,
              executionDecision.blockingReasons,
              executionDecision.selectedComboSource,
            );
          }
          if (openPosition !== null) {
            if (openPosition.status === "entry_pending_maker") {
              this.maybeFillPendingEntry(marketSlice, openPosition);
            }
            if (openPosition.status === "open") {
              this.maybeInitiateExit(marketSlice, openPosition);
            }
            if (openPosition.status === "exit_pending_maker") {
              this.maybeFillPendingExit(marketSlice, openPosition);
            }
          }
          if (latestPrediction !== null) {
            const lastConsumedSignalTimestamp = this.consumedSignalTimestamps.get(marketKey) ?? -1;
            const shouldConsumeSignal =
              latestPrediction.timestamp > lastConsumedSignalTimestamp && executionDecision !== null && executionDecision.isEntryAllowed;
            if (shouldConsumeSignal) {
              this.maybeOpenPosition(marketSlice, executionDecision, latestPrediction.timestamp);
            }
          }
        }
      }
    }
  }

  public getExecutionSummaries(): MarketExecutionSummary[] {
    const executionSummaries: MarketExecutionSummary[] = [];
    for (const asset of SUPPORTED_ASSETS) {
      for (const window of SUPPORTED_WINDOWS) {
        const marketKey = this.buildMarketKey(asset, window);
        const marketSlice = this.marketStateService.getLatestSlice(marketKey);
        const executionDecision = this.executionDecisions.get(marketKey) ?? {
          marketKey,
          asset,
          window,
          isEntryAllowed: false,
          positionSide: null,
          predictionDirection: null,
          marketScore: null,
          researchScore: null,
          executionScore: null,
          effectiveExecutionScore: null,
          marketTradeCount: 0,
          hasSufficientMarketHistory: false,
          entryReferencePrice: null,
          orderShareCount: 0,
          orderNotionalUsd: null,
          takeProfitPrice: null,
          stopLossPrice: null,
          executionStyle: null,
          executionReason: null,
          urgencyScore: 0,
          makerFillProbability: 0,
          bookRiskScore: 1,
          positionSizeSuggestion: 0,
          breadthDirection: "NEUTRAL",
          breadthStrength: null,
          hasStrongBreadth: false,
          hasBreadthAlignment: true,
          selectedComboKey: null,
          selectedComboSize: null,
          selectedComboSource: null,
          selectedComboDirection: null,
          selectedComboScore: null,
          selectedComboExecutionScore: null,
          selectedComboConfidence: null,
          selectedComboStrategyIds: [],
          selectedComboAffordabilityScore: null,
          regimeId: null,
          readinessScore: 0,
          blockingReasons: ["no_market_data"],
          generatedAt: null,
        };
        const openPosition = this.openPositions.get(marketKey) ?? null;
        executionSummaries.push({
          marketKey,
          asset,
          window,
          decision: executionDecision,
          openPosition: openPosition !== null && marketSlice !== null ? this.buildOpenPositionSummary(marketSlice, openPosition) : null,
        });
      }
    }
    return executionSummaries;
  }

  public getOpenPositionCount(): number {
    return this.openPositions.size;
  }

  public getOpenPositions(): OpenPositionSummary[] {
    const openPositionSummaries: OpenPositionSummary[] = [];
    for (const paperPosition of this.openPositions.values()) {
      const marketSlice = this.marketStateService.getLatestSlice(paperPosition.marketKey);
      if (marketSlice !== null) {
        openPositionSummaries.push(this.buildOpenPositionSummary(marketSlice, paperPosition));
      }
    }
    return openPositionSummaries;
  }

  public getRecentTrades(limit: number): ExecutionTrade[] {
    const recentTrades = this.recentTrades.slice(0, limit);
    return recentTrades;
  }

  public getPortfolioSummary(): PortfolioExecutionSummary {
    return this.buildPortfolioSummary();
  }

  public getMarketPerformanceSummaries(): MarketPerformanceSummary[] {
    const marketPerformanceSummaries: MarketPerformanceSummary[] = [];
    for (const asset of SUPPORTED_ASSETS) {
      for (const window of SUPPORTED_WINDOWS) {
        marketPerformanceSummaries.push(this.buildMarketPerformanceSummary(asset, window));
      }
    }
    return marketPerformanceSummaries;
  }

  public getExecutionMode(): "paper" {
    return "paper";
  }

  public getAccountSummary(_nowTimestamp: number): ExecutionAccountSummary {
    return {
      mode: "paper",
      balanceUsd: null,
      lastBalanceRefreshAt: null,
      isBalanceStale: false,
      lastBalanceError: null,
    };
  }

  public async disconnect(): Promise<void> {
    return;
  }
}
