/**
 * @section imports:internals
 */

import { randomUUID } from "node:crypto";

import config from "../config.ts";
import type { MarketStateService } from "../market/market-state.service.ts";
import type { AssetSymbol, MarketKey, MarketSnapshotSlice, MarketWindow } from "../market/market.types.ts";
import { SUPPORTED_ASSETS, SUPPORTED_WINDOWS } from "../market/market.types.ts";
import type { PredictionEngineService } from "../prediction/prediction-engine.service.ts";
import type { ExecutionPolicyService } from "./execution-policy.service.ts";
import type {
  ExecutionDecision,
  ExecutionStyle,
  MarketExecutionSummary,
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
  }

  /**
   * @section private:methods
   */

  private buildMarketKey(asset: AssetSymbol, window: MarketWindow): MarketKey {
    const marketKey: MarketKey = `${asset}:${window}`;
    return marketKey;
  }

  private resolvePrediction(asset: AssetSymbol, window: MarketWindow) {
    return this.predictionEngineService.getLatestPrediction(asset, window);
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

  private applyEntryCosts(entryFillPrice: number, executionStyle: ExecutionStyle, marketSlice: MarketSnapshotSlice, positionSide: PositionSide): number {
    const spread = positionSide === "up" ? (marketSlice.up.spread ?? 0) : (marketSlice.down.spread ?? 0);
    const bpsCost = executionStyle === "maker" ? config.ENTRY_COST_PROXY_BPS * 0.5 : config.ENTRY_COST_PROXY_BPS;
    const cost = entryFillPrice * (bpsCost / 10_000) + (executionStyle === "taker" ? spread * 0.5 : spread * 0.1);
    return cost;
  }

  private applyExitCosts(exitFillPrice: number, executionStyle: ExecutionStyle, marketSlice: MarketSnapshotSlice, positionSide: PositionSide): number {
    const spread = positionSide === "up" ? (marketSlice.up.spread ?? 0) : (marketSlice.down.spread ?? 0);
    const bpsCost = executionStyle === "maker" ? config.EXIT_COST_PROXY_BPS * 0.5 : config.EXIT_COST_PROXY_BPS;
    const cost = exitFillPrice * (bpsCost / 10_000) + (executionStyle === "taker" ? spread * 0.5 : spread * 0.1);
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
    const forcedFlattenAt = marketSlice.marketEnd === null ? null : Date.parse(marketSlice.marketEnd) - config.FORCE_FLATTEN_LEAD_MS;
    return {
      positionId: randomUUID(),
      marketKey: marketSlice.marketKey,
      asset: marketSlice.asset,
      window: marketSlice.window,
      positionSide: executionDecision.positionSide as PositionSide,
      entryDecisionAt: marketSlice.generatedAt,
      entryExecutionStyle: executionDecision.executionStyle as ExecutionStyle,
      entryPostedPrice: executionDecision.executionStyle === "maker" ? executionDecision.entryReferencePrice : null,
      entryFillPrice: null,
      entryFilledAt: null,
      takeProfitPrice: executionDecision.takeProfitPrice as number,
      stopLossPrice: executionDecision.stopLossPrice as number,
      forcedFlattenAt,
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

  private maybeOpenPosition(marketSlice: MarketSnapshotSlice, executionDecision: ExecutionDecision, signalTimestamp: number): void {
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
    }
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
      const grossMove = exitFillPrice - entryFillPrice;
      const entryCost = this.applyEntryCosts(entryFillPrice, paperPosition.entryExecutionStyle, marketSlice, paperPosition.positionSide);
      const exitCost = this.applyExitCosts(exitFillPrice, exitExecutionStyle, marketSlice, paperPosition.positionSide);
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
        entryExecutionStyle: paperPosition.entryExecutionStyle,
        exitExecutionStyle,
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
    }
  }

  private buildOpenPositionSummary(marketSlice: MarketSnapshotSlice, paperPosition: PaperPosition): OpenPositionSummary {
    const liveTokenPrice = this.resolveLiveTokenPrice(marketSlice, paperPosition.positionSide);
    const unrealizedPnlTokenPrice = paperPosition.entryFillPrice === null || liveTokenPrice === null ? null : liveTokenPrice - paperPosition.entryFillPrice;
    const timeToForcedFlattenMs = paperPosition.forcedFlattenAt === null ? null : Math.max(0, paperPosition.forcedFlattenAt - marketSlice.generatedAt);
    return {
      marketKey: paperPosition.marketKey,
      asset: paperPosition.asset,
      window: paperPosition.window,
      positionSide: paperPosition.positionSide,
      status: paperPosition.status,
      entryExecutionStyle: paperPosition.entryExecutionStyle,
      entryFillPrice: paperPosition.entryFillPrice,
      liveTokenPrice,
      unrealizedPnlTokenPrice,
      takeProfitPrice: paperPosition.takeProfitPrice,
      stopLossPrice: paperPosition.stopLossPrice,
      timeToForcedFlattenMs,
      suggestedExitStyle: paperPosition.exitExecutionStyle,
    };
  }

  private buildPortfolioSummary(): PortfolioExecutionSummary {
    const equityState: EquityState = { peak: 0, running: 0, maxDrawdown: 0 };
    let makerEntries = 0;
    let takerEntries = 0;
    let makerTrades = 0;
    let forcedFlattenTrades = 0;
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
      if (paperTrade.exitReason === "flatten_before_expiry") {
        forcedFlattenTrades += 1;
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
      forcedFlattenRate: tradeCount === 0 ? 0 : forcedFlattenTrades / tradeCount,
      makerUsageRatio: tradeCount === 0 ? 0 : makerEntries / tradeCount,
      takerUsageRatio: tradeCount === 0 ? 0 : takerEntries / tradeCount,
      tradeCount,
    };
  }

  /**
   * @section public:methods
   */

  public handleSnapshot(_generatedAt: number): void {
    for (const asset of SUPPORTED_ASSETS) {
      for (const window of SUPPORTED_WINDOWS) {
        const marketKey = this.buildMarketKey(asset, window);
        const marketSlice = this.marketStateService.getLatestSlice(marketKey);
        if (marketSlice !== null) {
          const latestPrediction = this.resolvePrediction(asset, window);
          const openPosition = this.openPositions.get(marketKey) ?? null;
          const executionDecision = this.executionPolicyService.buildEntryDecision(marketSlice, latestPrediction, openPosition);
          if (executionDecision !== null) {
            this.executionDecisions.set(marketKey, executionDecision);
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
          entryReferencePrice: null,
          takeProfitPrice: null,
          stopLossPrice: null,
          executionStyle: null,
          executionReason: null,
          urgencyScore: 0,
          makerFillProbability: 0,
          bookRiskScore: 1,
          positionSizeSuggestion: 0,
          gateFailures: ["no_market_data"],
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

  public getRecentTrades(limit: number): PaperTrade[] {
    const recentTrades = this.recentTrades.slice(0, limit);
    return recentTrades;
  }

  public getPortfolioSummary(): PortfolioExecutionSummary {
    return this.buildPortfolioSummary();
  }
}
