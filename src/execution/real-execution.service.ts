import { randomUUID } from "node:crypto";
import { MarketCatalogService, OrderService } from "@sha3/polymarket";
import type { PolymarketMarket, PostedOrderWithStatus } from "@sha3/polymarket";
import config from "../config.ts";
import type { LlmLogService } from "../llm/llm-log.service.ts";
import logger from "../logger.ts";
import type { MarketStateService } from "../market/market-state.service.ts";
import type { AssetSymbol, MarketKey, MarketSnapshotSlice, MarketWindow } from "../market/market.types.ts";
import { SUPPORTED_ASSETS, SUPPORTED_WINDOWS } from "../market/market.types.ts";
import type { PredictionEngineService } from "../prediction/prediction-engine.service.ts";
import type { PredictionResponse } from "../prediction/prediction.types.ts";
import type { ExecutionPolicyService } from "./execution-policy.service.ts";
import type {
  ExecutionAccountSummary,
  ExecutionDecision,
  ExecutionMode,
  ExecutionStyle,
  ExecutionTrade,
  MarketExecutionSummary,
  MarketPerformanceSummary,
  OpenPositionSummary,
  PaperPosition,
  PortfolioExecutionSummary,
  PositionSide,
  TradeExitReason,
} from "./execution.types.ts";

/**
 * @section consts
 */

const DEFAULT_REAL_TAKER_CONFIRMATION_TIMEOUT_MS = 5_000;

/**
 * @section types
 */

type EquityState = { peak: number; running: number; maxDrawdown: number };
type OrderServiceLike = Pick<OrderService, "disconnect" | "getMyBalance" | "init" | "postOrder" | "waitForOrderConfirmation">;
type MarketCatalogServiceLike = Pick<MarketCatalogService, "loadMarketBySlug">;
type RealPositionRecord = PaperPosition & {
  liveMarketSlug: string;
  entryOrderId: string | null;
  exitOrderId: string | null;
};
type LiveOrderExecutionResult = {
  confirmation: PostedOrderWithStatus | null;
  executionStyle: ExecutionStyle;
  hasTakerFallbackUsed: boolean;
  errorMessage: string | null;
};

/**
 * @section class
 */

export class RealExecutionService {
  /**
   * @section private:attributes
   */

  private readonly marketStateService: MarketStateService;
  private readonly predictionEngineService: PredictionEngineService;
  private readonly executionPolicyService: ExecutionPolicyService;
  private readonly llmLogService: LlmLogService | null;
  private readonly orderService: OrderServiceLike;
  private readonly marketCatalogService: MarketCatalogServiceLike;
  private readonly executionDecisions: Map<MarketKey, ExecutionDecision>;
  private readonly openPositions: Map<MarketKey, RealPositionRecord>;
  private readonly recentTrades: ExecutionTrade[];
  private readonly consumedSignalTimestamps: Map<MarketKey, number>;
  private readonly marketCache: Map<MarketKey, { market: PolymarketMarket; slug: string }>;
  private latestObservedAt: number | null;
  private balanceUsd: number | null;
  private lastBalanceRefreshAt: number | null;
  private lastBalanceError: string | null;
  private initializationError: string | null;
  private isInitialized: boolean;
  private initializationPromise: Promise<void> | null;
  private snapshotQueue: Promise<void>;

  /**
   * @section constructor
   */

  public constructor(
    marketStateService: MarketStateService,
    predictionEngineService: PredictionEngineService,
    executionPolicyService: ExecutionPolicyService,
    orderService?: OrderServiceLike,
    marketCatalogService?: MarketCatalogServiceLike,
    llmLogService?: LlmLogService,
  ) {
    if (orderService === undefined && config.POLYMARKET_PRIVATE_KEY.length === 0) {
      throw new Error("EXECUTION_MODE=real requires POLYMARKET_PRIVATE_KEY.");
    }
    this.marketStateService = marketStateService;
    this.predictionEngineService = predictionEngineService;
    this.executionPolicyService = executionPolicyService;
    this.llmLogService = llmLogService ?? null;
    this.orderService = orderService ?? OrderService.createDefault();
    this.marketCatalogService = marketCatalogService ?? MarketCatalogService.createDefault();
    this.executionDecisions = new Map<MarketKey, ExecutionDecision>();
    this.openPositions = new Map<MarketKey, RealPositionRecord>();
    this.recentTrades = [];
    this.consumedSignalTimestamps = new Map<MarketKey, number>();
    this.marketCache = new Map<MarketKey, { market: PolymarketMarket; slug: string }>();
    this.latestObservedAt = null;
    this.balanceUsd = null;
    this.lastBalanceRefreshAt = null;
    this.lastBalanceError = null;
    this.initializationError = null;
    this.isInitialized = false;
    this.initializationPromise = null;
    this.snapshotQueue = Promise.resolve();
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
    const liveTokenPrice = tokenMetrics.midpoint ?? tokenMetrics.price;
    return liveTokenPrice;
  }

  private resolveBestBid(marketSlice: MarketSnapshotSlice, positionSide: PositionSide): number | null {
    const tokenMetrics = positionSide === "up" ? marketSlice.up : marketSlice.down;
    const bestBid = tokenMetrics.bestBid;
    return bestBid;
  }

  private resolveBestAsk(marketSlice: MarketSnapshotSlice, positionSide: PositionSide): number | null {
    const tokenMetrics = positionSide === "up" ? marketSlice.up : marketSlice.down;
    const bestAsk = tokenMetrics.bestAsk;
    return bestAsk;
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

  private buildOpenPositionSummary(marketSlice: MarketSnapshotSlice, positionRecord: RealPositionRecord): OpenPositionSummary {
    const liveTokenPrice = this.resolveLiveTokenPrice(marketSlice, positionRecord.positionSide);
    const unrealizedPnlTokenPrice = positionRecord.entryFillPrice === null || liveTokenPrice === null ? null : liveTokenPrice - positionRecord.entryFillPrice;
    return {
      marketKey: positionRecord.marketKey,
      asset: positionRecord.asset,
      window: positionRecord.window,
      positionSide: positionRecord.positionSide,
      status: positionRecord.status,
      shareCount: positionRecord.shareCount,
      entryExecutionStyle: positionRecord.entryExecutionStyle,
      entryFillPrice: positionRecord.entryFillPrice,
      liveTokenPrice,
      unrealizedPnlTokenPrice: unrealizedPnlTokenPrice === null ? null : unrealizedPnlTokenPrice * positionRecord.shareCount,
      takeProfitPrice: positionRecord.takeProfitPrice,
      stopLossPrice: positionRecord.stopLossPrice,
      suggestedExitStyle: positionRecord.exitExecutionStyle,
    };
  }

  private buildPortfolioSummary(): PortfolioExecutionSummary {
    const equityState: EquityState = { peak: 0, running: 0, maxDrawdown: 0 };
    let makerEntries = 0;
    let takerEntries = 0;
    let makerTrades = 0;
    for (const executionTrade of [...this.recentTrades].reverse()) {
      equityState.running += executionTrade.realizedPnlAfterCosts;
      if (equityState.running > equityState.peak) {
        equityState.peak = equityState.running;
      }
      if (equityState.peak - equityState.running > equityState.maxDrawdown) {
        equityState.maxDrawdown = equityState.peak - equityState.running;
      }
      if (executionTrade.entryExecutionStyle === "maker") {
        makerEntries += 1;
      } else {
        takerEntries += 1;
      }
      if (executionTrade.entryExecutionStyle === "maker" || executionTrade.exitExecutionStyle === "maker") {
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

  private readWindowedTrades(marketKey: MarketKey): ExecutionTrade[] {
    const rollingTradeCutoff = this.readRollingTradeCutoff(this.latestObservedAt);
    const windowedTrades = this.recentTrades.filter((executionTrade) => {
      const isSameMarket = executionTrade.marketKey === marketKey;
      const isInsideWindow = rollingTradeCutoff === null || executionTrade.exitFilledAt >= rollingTradeCutoff;
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

  private computeMarketScore(windowedPredictions: PredictionResponse[]): number {
    let marketScore = 0.5;
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
      marketScore = Math.max(0, Math.min(1, 0.5 + ((hitRate - 0.5) * 0.6 + averageSignedEdge * 0.35 - calibrationError * 0.2) * sampleTrust));
    }
    return marketScore;
  }

  private buildMarketPerformanceSummary(asset: AssetSymbol, window: MarketWindow): MarketPerformanceSummary {
    const marketKey = this.buildMarketKey(asset, window);
    const latestPrediction = this.resolvePrediction(asset, window);
    const predictionCount = this.predictionEngineService.getPredictionCount(asset, window);
    const windowedTrades = this.readWindowedTrades(marketKey).sort((leftTrade, rightTrade) => leftTrade.exitFilledAt - rightTrade.exitFilledAt);
    const windowedResearchPredictions = this.readWindowedResearchPredictions(asset, window);
    const tradeCount = windowedTrades.length;
    const winCount = windowedTrades.filter((executionTrade) => executionTrade.realizedPnlAfterCosts > 0).length;
    const cumulativeNetPnl = windowedTrades.reduce((aggregatedPnl, executionTrade) => aggregatedPnl + executionTrade.realizedPnlAfterCosts, 0);
    const averageNetPnlPerTrade = tradeCount === 0 ? 0 : cumulativeNetPnl / tradeCount;
    const marketEquityState: EquityState = { peak: 0, running: 0, maxDrawdown: 0 };
    for (const executionTrade of windowedTrades) {
      marketEquityState.running += executionTrade.realizedPnlAfterCosts;
      if (marketEquityState.running > marketEquityState.peak) {
        marketEquityState.peak = marketEquityState.running;
      }
      if (marketEquityState.peak - marketEquityState.running > marketEquityState.maxDrawdown) {
        marketEquityState.maxDrawdown = marketEquityState.peak - marketEquityState.running;
      }
    }
    const marketScore = this.computeMarketScore(windowedResearchPredictions);
    const hasSufficientHistory = tradeCount >= config.MIN_MARKET_TRADES_FOR_SCORING;
    const hasWarmupComplete =
      predictionCount >= config.MIN_MARKET_PREDICTIONS_BEFORE_ENTRY && windowedResearchPredictions.length >= config.MIN_RESEARCH_PREDICTIONS_FOR_BOOTSTRAP;
    const hasComboReadiness = latestPrediction?.selectedCombo.isExecutionEligible ?? false;
    let status: MarketPerformanceSummary["status"] = "warming_up";
    if (hasWarmupComplete) {
      status = "research_only";
      if (marketScore < config.MIN_MARKET_SCORE_FOR_ENTRY) {
        status = "avoid";
      }
      if (marketScore >= config.MIN_MARKET_SCORE_FOR_ENTRY && hasComboReadiness) {
        status = "tradable";
      }
    }
    return {
      marketKey,
      asset,
      window,
      predictionCount,
      marketScore,
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

  private buildFallbackDecision(asset: AssetSymbol, window: MarketWindow, blockingReasons: string[]): ExecutionDecision {
    return {
      marketKey: this.buildMarketKey(asset, window),
      asset,
      window,
      isEntryAllowed: false,
      marketScore: null,
      marketTradeCount: 0,
      hasSufficientMarketHistory: false,
      positionSide: null,
      predictionDirection: null,
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
      predictionConfidence: null,
      selectedComboStrategyIds: [],
      selectedComboAffordabilityScore: null,
      regimeId: null,
      blockingReasons,
      generatedAt: this.latestObservedAt,
    };
  }

  private applyDecisionGateFailure(executionDecision: ExecutionDecision, gateFailure: string): void {
    if (!executionDecision.blockingReasons.includes(gateFailure)) {
      executionDecision.blockingReasons.push(gateFailure);
    }
    executionDecision.isEntryAllowed = false;
    executionDecision.positionSizeSuggestion = 0;
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.isInitialized) {
      if (this.initializationPromise === null) {
        this.initializationPromise = this.initializeOrderService();
      }
      await this.initializationPromise;
    }
  }

  private async initializeOrderService(): Promise<void> {
    let signatureType: number | undefined = undefined;
    if (config.POLYMARKET_SIGNATURE_TYPE.length > 0) {
      const parsedSignatureType = Number(config.POLYMARKET_SIGNATURE_TYPE);
      if (Number.isFinite(parsedSignatureType)) {
        signatureType = parsedSignatureType;
      }
    }
    try {
      const initializeOptions: {
        privateKey: string;
        funderAddress?: string;
        signatureType?: number;
        maxAllowedSlippage?: number;
      } = { privateKey: config.POLYMARKET_PRIVATE_KEY };
      if (config.POLYMARKET_FUNDER_ADDRESS.length > 0) {
        initializeOptions.funderAddress = config.POLYMARKET_FUNDER_ADDRESS;
      }
      if (signatureType !== undefined) {
        initializeOptions.signatureType = signatureType;
      }
      if (config.POLYMARKET_MAX_ALLOWED_SLIPPAGE.length > 0) {
        initializeOptions.maxAllowedSlippage = Number(config.POLYMARKET_MAX_ALLOWED_SLIPPAGE);
      }
      await this.orderService.init(initializeOptions);
      this.isInitialized = true;
      this.initializationError = null;
    } catch (error) {
      this.initializationError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  private shouldRefreshBalance(nowTimestamp: number): boolean {
    const hasNeverRefreshed = this.lastBalanceRefreshAt === null;
    const isRefreshExpired = this.lastBalanceRefreshAt !== null && nowTimestamp - this.lastBalanceRefreshAt >= config.REAL_BALANCE_REFRESH_MS;
    const shouldRefreshBalance = hasNeverRefreshed || isRefreshExpired;
    return shouldRefreshBalance;
  }

  private async refreshBalanceIfNeeded(nowTimestamp: number): Promise<void> {
    if (this.shouldRefreshBalance(nowTimestamp)) {
      try {
        const balanceUsd = await this.orderService.getMyBalance();
        this.balanceUsd = balanceUsd;
        this.lastBalanceRefreshAt = nowTimestamp;
        this.lastBalanceError = null;
      } catch (error) {
        this.lastBalanceRefreshAt = nowTimestamp;
        this.lastBalanceError = error instanceof Error ? error.message : String(error);
        logger.error(`live balance refresh failed: ${this.lastBalanceError}`);
      }
    }
  }

  private async resolvePolymarketMarket(marketKey: MarketKey, marketSlice: MarketSnapshotSlice): Promise<PolymarketMarket | null> {
    const cachedMarket = this.marketCache.get(marketKey) ?? null;
    let polymarketMarket: PolymarketMarket | null = cachedMarket?.market ?? null;
    if (marketSlice.slug === null) {
      polymarketMarket = null;
    }
    if (marketSlice.slug !== null && (cachedMarket === null || cachedMarket.slug !== marketSlice.slug)) {
      try {
        const loadedMarket = await this.marketCatalogService.loadMarketBySlug({ slug: marketSlice.slug });
        this.marketCache.set(marketKey, { market: loadedMarket, slug: marketSlice.slug });
        polymarketMarket = loadedMarket;
      } catch (error) {
        this.initializationError = error instanceof Error ? error.message : String(error);
        logger.error(`failed to load live market ${marketSlice.slug}: ${this.initializationError}`);
        polymarketMarket = null;
      }
    }
    return polymarketMarket;
  }

  private resolveDirection(positionSide: PositionSide): "up" | "down" {
    const direction = positionSide === "up" ? "up" : "down";
    return direction;
  }

  private async attemptLiveOrder(
    polymarketMarket: PolymarketMarket,
    positionSide: PositionSide,
    operation: "buy" | "sell",
    executionStyle: ExecutionStyle,
    shareCount: number,
    price: number,
    timeoutMs: number,
  ): Promise<PostedOrderWithStatus | null> {
    let confirmation: PostedOrderWithStatus | null = null;
    try {
      const postedOrder = await this.orderService.postOrder({
        market: polymarketMarket,
        op: operation,
        direction: this.resolveDirection(positionSide),
        executionType: executionStyle,
        size: shareCount,
        price,
        paperMode: false,
      });
      if (postedOrder !== null) {
        confirmation = await this.orderService.waitForOrderConfirmation({
          order: postedOrder,
          timeoutMs,
          shouldCancelOnTimeout: true,
        });
      }
    } catch (error) {
      logger.error(`live order failed for ${polymarketMarket.slug}: ${error instanceof Error ? error.message : String(error)}`);
      confirmation = null;
    }
    return confirmation;
  }

  private async executeLiveOrder(
    polymarketMarket: PolymarketMarket,
    positionSide: PositionSide,
    operation: "buy" | "sell",
    executionStyle: ExecutionStyle,
    shareCount: number,
    price: number,
    timeoutMs: number,
  ): Promise<LiveOrderExecutionResult> {
    let confirmation = await this.attemptLiveOrder(polymarketMarket, positionSide, operation, executionStyle, shareCount, price, timeoutMs);
    let resolvedExecutionStyle = executionStyle;
    let hasTakerFallbackUsed = false;
    let errorMessage: string | null = confirmation?.error?.message ?? null;
    if ((confirmation === null || !confirmation.ok) && executionStyle === "maker") {
      confirmation = await this.attemptLiveOrder(
        polymarketMarket,
        positionSide,
        operation,
        "taker",
        shareCount,
        price,
        DEFAULT_REAL_TAKER_CONFIRMATION_TIMEOUT_MS,
      );
      resolvedExecutionStyle = "taker";
      hasTakerFallbackUsed = confirmation !== null;
      errorMessage = confirmation?.error?.message ?? errorMessage;
    }
    return {
      confirmation,
      executionStyle: resolvedExecutionStyle,
      hasTakerFallbackUsed,
      errorMessage,
    };
  }

  private buildPosition(
    marketSlice: MarketSnapshotSlice,
    executionDecision: ExecutionDecision,
    signalTimestamp: number,
    polymarketMarket: PolymarketMarket,
  ): RealPositionRecord {
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
      liveMarketSlug: polymarketMarket.slug,
      entryOrderId: null,
      exitOrderId: null,
    };
  }

  private async maybeOpenPosition(
    marketSlice: MarketSnapshotSlice,
    executionDecision: ExecutionDecision,
    signalTimestamp: number,
    polymarketMarket: PolymarketMarket,
  ): Promise<boolean> {
    let hasOpenedPosition = false;
    const canOpenPosition =
      executionDecision.isEntryAllowed && !this.openPositions.has(marketSlice.marketKey) && this.openPositions.size < config.MAX_OPEN_POSITIONS_GLOBAL;
    if (canOpenPosition) {
      const positionRecord = this.buildPosition(marketSlice, executionDecision, signalTimestamp, polymarketMarket);
      this.openPositions.set(marketSlice.marketKey, positionRecord);
      const orderExecutionResult = await this.executeLiveOrder(
        polymarketMarket,
        positionRecord.positionSide,
        "buy",
        positionRecord.entryExecutionStyle,
        positionRecord.shareCount,
        executionDecision.entryReferencePrice as number,
        positionRecord.entryExecutionStyle === "maker" ? config.MAKER_ENTRY_TIMEOUT_MS : DEFAULT_REAL_TAKER_CONFIRMATION_TIMEOUT_MS,
      );
      const confirmation = orderExecutionResult.confirmation;
      if (confirmation?.ok) {
        positionRecord.entryOrderId = confirmation.id;
        positionRecord.entryExecutionStyle = orderExecutionResult.executionStyle;
        positionRecord.entryFillPrice = confirmation.price;
        positionRecord.entryFilledAt = marketSlice.generatedAt;
        positionRecord.status = "open";
        positionRecord.hasTakerFallbackUsed = orderExecutionResult.hasTakerFallbackUsed;
        this.consumedSignalTimestamps.set(marketSlice.marketKey, signalTimestamp);
        this.predictionEngineService.markPredictionExecuted(marketSlice.marketKey, signalTimestamp);
        await this.refreshBalanceIfNeeded(marketSlice.generatedAt);
        hasOpenedPosition = true;
      } else {
        this.openPositions.delete(marketSlice.marketKey);
        this.applyDecisionGateFailure(executionDecision, "live_entry_not_confirmed");
      }
    }
    return hasOpenedPosition;
  }

  private async maybeInitiateExit(marketSlice: MarketSnapshotSlice, positionRecord: RealPositionRecord): Promise<void> {
    const latestPrediction = this.resolvePrediction(marketSlice.asset, marketSlice.window);
    const exitDecision = this.executionPolicyService.buildExitDecision(marketSlice, positionRecord, latestPrediction);
    if (exitDecision.nextStopLossPrice !== null) {
      positionRecord.stopLossPrice = exitDecision.nextStopLossPrice;
    }
    if (exitDecision.exitReason !== null && exitDecision.executionStyle !== null) {
      const polymarketMarket = await this.resolvePolymarketMarket(positionRecord.marketKey, marketSlice);
      if (polymarketMarket !== null) {
        positionRecord.exitDecisionAt = marketSlice.generatedAt;
        positionRecord.exitExecutionStyle = exitDecision.executionStyle;
        positionRecord.exitReason = exitDecision.exitReason;
        positionRecord.exitPostedPrice = exitDecision.exitPrice;
        positionRecord.status = exitDecision.executionStyle === "maker" ? "exit_pending_maker" : "open";
        const orderExecutionResult = await this.executeLiveOrder(
          polymarketMarket,
          positionRecord.positionSide,
          "sell",
          exitDecision.executionStyle,
          positionRecord.shareCount,
          exitDecision.exitPrice as number,
          exitDecision.executionStyle === "maker" ? config.MAKER_EXIT_TIMEOUT_MS : DEFAULT_REAL_TAKER_CONFIRMATION_TIMEOUT_MS,
        );
        const confirmation = orderExecutionResult.confirmation;
        if (confirmation?.ok) {
          positionRecord.exitOrderId = confirmation.id;
          positionRecord.hasTakerFallbackUsed = positionRecord.hasTakerFallbackUsed || orderExecutionResult.hasTakerFallbackUsed;
          this.closePosition(marketSlice, positionRecord, confirmation.price, exitDecision.exitReason, orderExecutionResult.executionStyle);
          await this.refreshBalanceIfNeeded(marketSlice.generatedAt);
        } else {
          positionRecord.status = "open";
          positionRecord.exitExecutionStyle = null;
          positionRecord.exitDecisionAt = null;
          positionRecord.exitReason = null;
          positionRecord.exitPostedPrice = null;
        }
      }
    }
  }

  private closePosition(
    marketSlice: MarketSnapshotSlice,
    positionRecord: RealPositionRecord,
    exitFillPrice: number,
    exitReason: TradeExitReason,
    exitExecutionStyle: ExecutionStyle,
  ): void {
    const entryFillPrice = positionRecord.entryFillPrice;
    const entryFilledAt = positionRecord.entryFilledAt;
    if (entryFillPrice !== null && entryFilledAt !== null) {
      const grossMove = (exitFillPrice - entryFillPrice) * positionRecord.shareCount;
      const entryCost = this.applyEntryCosts(
        entryFillPrice,
        positionRecord.entryExecutionStyle,
        marketSlice,
        positionRecord.positionSide,
        positionRecord.shareCount,
      );
      const exitCost = this.applyExitCosts(exitFillPrice, exitExecutionStyle, marketSlice, positionRecord.positionSide, positionRecord.shareCount);
      positionRecord.exitFillPrice = exitFillPrice;
      positionRecord.exitFilledAt = marketSlice.generatedAt;
      positionRecord.exitExecutionStyle = exitExecutionStyle;
      positionRecord.exitReason = exitReason;
      positionRecord.realizedPnlTokenPrice = grossMove;
      positionRecord.realizedPnlAfterCosts = grossMove - entryCost - exitCost;
      positionRecord.status = "closed";
      const executionTrade: ExecutionTrade = {
        positionId: positionRecord.positionId,
        marketKey: positionRecord.marketKey,
        asset: positionRecord.asset,
        window: positionRecord.window,
        positionSide: positionRecord.positionSide,
        shareCount: positionRecord.shareCount,
        entryExecutionStyle: positionRecord.entryExecutionStyle,
        exitExecutionStyle,
        entryNotionalUsd: entryFillPrice * positionRecord.shareCount,
        exitNotionalUsd: exitFillPrice * positionRecord.shareCount,
        entryFillPrice,
        exitFillPrice,
        entryFilledAt,
        exitFilledAt: marketSlice.generatedAt,
        exitReason,
        realizedPnlTokenPrice: positionRecord.realizedPnlTokenPrice,
        realizedPnlAfterCosts: positionRecord.realizedPnlAfterCosts,
        holdTimeMs: marketSlice.generatedAt - entryFilledAt,
        hasTakerFallbackUsed: positionRecord.hasTakerFallbackUsed,
      };
      this.recentTrades.unshift(executionTrade);
      if (this.recentTrades.length > config.MAX_PREDICTION_HISTORY_PER_MARKET * 4) {
        this.recentTrades.splice(config.MAX_PREDICTION_HISTORY_PER_MARKET * 4);
      }
      if (this.llmLogService !== null) {
        this.llmLogService.recordTradeClosed(executionTrade);
      }
      this.openPositions.delete(positionRecord.marketKey);
      this.predictionEngineService.resolvePredictionFromTrade(
        positionRecord.marketKey,
        positionRecord.signalTimestamp,
        exitReason,
        exitFillPrice,
        marketSlice.generatedAt,
      );
    }
  }

  private async processMarket(asset: AssetSymbol, window: MarketWindow, generatedAt: number): Promise<void> {
    const marketKey = this.buildMarketKey(asset, window);
    const marketSlice = this.marketStateService.getLatestSlice(marketKey);
    if (marketSlice !== null) {
      const latestPrediction = this.resolvePrediction(asset, window);
      const openPosition = this.openPositions.get(marketKey) ?? null;
      const marketPerformanceSummary = this.buildMarketPerformanceSummary(asset, window);
      const executionDecision = this.executionPolicyService.buildEntryDecision(marketSlice, latestPrediction, openPosition, marketPerformanceSummary);
      if (executionDecision !== null) {
        if (this.balanceUsd === null) {
          this.applyDecisionGateFailure(executionDecision, "live_balance_unavailable");
        }
        if (executionDecision.isEntryAllowed) {
          const polymarketMarket = await this.resolvePolymarketMarket(marketKey, marketSlice);
          if (polymarketMarket === null) {
            this.applyDecisionGateFailure(executionDecision, "live_market_unresolved");
          } else {
            if (openPosition === null && latestPrediction !== null) {
              const lastConsumedSignalTimestamp = this.consumedSignalTimestamps.get(marketKey) ?? -1;
              const shouldConsumeSignal = latestPrediction.timestamp > lastConsumedSignalTimestamp;
              if (shouldConsumeSignal) {
                const hasOpenedPosition = await this.maybeOpenPosition(marketSlice, executionDecision, latestPrediction.timestamp, polymarketMarket);
                if (!hasOpenedPosition && executionDecision.blockingReasons.length === 0) {
                  this.applyDecisionGateFailure(executionDecision, "live_order_post_failed");
                }
              }
            }
          }
        }
        this.executionDecisions.set(marketKey, executionDecision);
        if (latestPrediction !== null) {
          this.predictionEngineService.markExecutionEligibility(
            marketKey,
            latestPrediction.timestamp,
            executionDecision.isEntryAllowed,
            executionDecision.blockingReasons,
            executionDecision.selectedComboSource,
          );
        }
      }
      const refreshedOpenPosition = this.openPositions.get(marketKey) ?? null;
      if (refreshedOpenPosition !== null && refreshedOpenPosition.status === "open") {
        await this.maybeInitiateExit(marketSlice, refreshedOpenPosition);
      }
    } else {
      this.executionDecisions.set(marketKey, this.buildFallbackDecision(asset, window, ["no_market_data"]));
    }
    this.latestObservedAt = generatedAt;
  }

  private async processSnapshot(generatedAt: number): Promise<void> {
    try {
      await this.ensureInitialized();
      await this.refreshBalanceIfNeeded(generatedAt);
      for (const asset of SUPPORTED_ASSETS) {
        for (const window of SUPPORTED_WINDOWS) {
          await this.processMarket(asset, window, generatedAt);
        }
      }
    } catch (error) {
      this.initializationError = error instanceof Error ? error.message : String(error);
      for (const asset of SUPPORTED_ASSETS) {
        for (const window of SUPPORTED_WINDOWS) {
          this.executionDecisions.set(this.buildMarketKey(asset, window), this.buildFallbackDecision(asset, window, ["live_mode_not_initialized"]));
        }
      }
      logger.error(`real execution initialization failed: ${this.initializationError}`);
    }
  }

  private async flushSnapshot(generatedAt: number, previousQueue: Promise<void>, releaseQueue: () => void): Promise<void> {
    try {
      await previousQueue;
      await this.processSnapshot(generatedAt);
    } catch (error) {
      logger.error(`real execution snapshot failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      releaseQueue();
    }
  }

  /**
   * @section public:methods
   */

  public getExecutionMode(): ExecutionMode {
    return "real";
  }

  public async handleSnapshot(generatedAt: number): Promise<void> {
    this.latestObservedAt = generatedAt;
    const previousQueue = this.snapshotQueue;
    let releaseQueue = (): void => undefined;
    this.snapshotQueue = new Promise<void>((resolve) => {
      releaseQueue = resolve;
    });
    await this.flushSnapshot(generatedAt, previousQueue, releaseQueue);
  }

  public getExecutionSummaries(): MarketExecutionSummary[] {
    const executionSummaries: MarketExecutionSummary[] = [];
    for (const asset of SUPPORTED_ASSETS) {
      for (const window of SUPPORTED_WINDOWS) {
        const marketKey = this.buildMarketKey(asset, window);
        const marketSlice = this.marketStateService.getLatestSlice(marketKey);
        const executionDecision =
          this.executionDecisions.get(marketKey) ??
          this.buildFallbackDecision(asset, window, this.initializationError === null ? ["live_mode_not_initialized"] : ["live_mode_not_initialized"]);
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
    for (const positionRecord of this.openPositions.values()) {
      const marketSlice = this.marketStateService.getLatestSlice(positionRecord.marketKey);
      if (marketSlice !== null) {
        openPositionSummaries.push(this.buildOpenPositionSummary(marketSlice, positionRecord));
      }
    }
    return openPositionSummaries;
  }

  public getRecentTrades(limit: number): ExecutionTrade[] {
    const recentTrades = this.recentTrades.slice(0, limit);
    return recentTrades;
  }

  public getPortfolioSummary(): PortfolioExecutionSummary {
    const portfolioSummary = this.buildPortfolioSummary();
    return portfolioSummary;
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

  public getOpenPositionCount(): number {
    return this.openPositions.size;
  }

  public async getAccountSummary(nowTimestamp: number): Promise<ExecutionAccountSummary> {
    try {
      await this.ensureInitialized();
      await this.refreshBalanceIfNeeded(nowTimestamp);
    } catch (error) {
      this.initializationError = error instanceof Error ? error.message : String(error);
      logger.error(`real account summary refresh failed: ${this.initializationError}`);
    }
    return {
      mode: "real",
      balanceUsd: this.balanceUsd,
      lastBalanceRefreshAt: this.lastBalanceRefreshAt,
      isBalanceStale: this.lastBalanceRefreshAt === null || nowTimestamp - this.lastBalanceRefreshAt > config.REAL_BALANCE_REFRESH_MS,
      lastBalanceError: this.lastBalanceError ?? this.initializationError,
    };
  }

  public async disconnect(): Promise<void> {
    await this.orderService.disconnect();
  }
}
