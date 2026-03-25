import * as assert from "node:assert/strict";
import { test } from "node:test";

import type { Operation, PolymarketMarket, PostedOrder, PostedOrderWithStatus } from "@sha3/polymarket";
import type { ExecutionPolicyService } from "../src/execution/execution-policy.service.ts";
import type {
  ExecutionDecision,
  ExecutionStyle,
  ExecutionTrade,
  MarketPerformanceSummary,
  PaperPosition,
  TradeExitReason,
} from "../src/execution/execution.types.ts";
import { RealExecutionService } from "../src/execution/real-execution.service.ts";
import type { MarketStateService } from "../src/market/market-state.service.ts";
import type { MarketQuality, MarketSnapshotSlice, SpotVenueMetrics, TokenMetrics } from "../src/market/market.types.ts";
import type { PredictionEngineService } from "../src/prediction/prediction-engine.service.ts";
import type { PredictionResponse } from "../src/prediction/prediction.types.ts";

test("RealExecutionService caches account balance for the refresh window", async () => {
  let initCount = 0;
  let balanceCount = 0;
  const orderService = {
    async init(): Promise<void> {
      initCount += 1;
    },
    async getMyBalance(): Promise<number> {
      balanceCount += 1;
      return 321.45;
    },
    async postOrder(): Promise<PostedOrder | null> {
      return null;
    },
    async waitForOrderConfirmation(): Promise<PostedOrderWithStatus> {
      throw new Error("not expected");
    },
    async disconnect(): Promise<void> {
      return;
    },
  };
  const realExecutionService = new RealExecutionService(
    buildMarketStateServiceMock(buildMarketSnapshotSlice(2_000, 0.52)),
    buildPredictionEngineMock(buildLivePredictionResponse(), []),
    buildExecutionPolicyServiceMock(),
    orderService,
    buildMarketCatalogServiceMock(),
  );

  const firstSummary = await realExecutionService.getAccountSummary(10_000);
  const secondSummary = await realExecutionService.getAccountSummary(11_000);

  assert.equal(initCount, 1);
  assert.equal(balanceCount, 1);
  assert.equal(firstSummary.mode, "real");
  assert.equal(firstSummary.balanceUsd, 321.45);
  assert.equal(secondSummary.balanceUsd, 321.45);
});

test("RealExecutionService opens and closes confirmed real trades", async () => {
  let currentSlice = buildMarketSnapshotSlice(40_000, 0.5);
  const postedOrders: Array<{ op: string; executionType: string }> = [];
  let orderSequence = 0;
  let resolveTradeCount = 0;
  const orderService = {
    async init(): Promise<void> {
      return;
    },
    async getMyBalance(): Promise<number> {
      return 500;
    },
    async postOrder(options: {
      op: Operation;
      executionType?: "maker" | "taker";
      price: number;
      size: number;
      paperMode?: boolean;
    }): Promise<PostedOrder | null> {
      orderSequence += 1;
      postedOrders.push({ op: options.op, executionType: options.executionType ?? "taker" });
      return {
        op: options.op,
        price: options.price,
        size: options.size,
        direction: "up",
        executionType: options.executionType ?? "taker",
        market: buildPolymarketMarket(),
        id: `ord-${orderSequence}`,
        date: new Date("2025-01-01T00:00:00.000Z"),
      };
    },
    async waitForOrderConfirmation(options: { order: PostedOrder }): Promise<PostedOrderWithStatus> {
      return {
        ...options.order,
        ok: true,
        status: "confirmed",
        latency: 10,
      };
    },
    async disconnect(): Promise<void> {
      return;
    },
  };
  const resolvedPredictions = buildResolvedPredictionHistory();
  const predictionEngineMock = buildPredictionEngineMock(buildLivePredictionResponse(), resolvedPredictions, () => {
    resolveTradeCount += 1;
  });
  const realExecutionService = new RealExecutionService(
    buildMarketStateServiceMock(() => currentSlice),
    predictionEngineMock,
    buildExecutionPolicyServiceMock(),
    orderService,
    buildMarketCatalogServiceMock(),
  );
  const mutableRealExecutionService = realExecutionService as unknown as { recentTrades: ExecutionTrade[] };
  mutableRealExecutionService.recentTrades.push(...buildSeedTrades());

  await realExecutionService.handleSnapshot(40_000);
  assert.equal(realExecutionService.getOpenPositionCount(), 1);
  assert.equal(postedOrders[0]?.op, "buy");

  currentSlice = buildMarketSnapshotSlice(41_000, 0.64);
  await realExecutionService.handleSnapshot(41_000);

  assert.equal(realExecutionService.getOpenPositionCount(), 0);
  assert.equal(postedOrders[1]?.op, "sell");
  assert.equal(resolveTradeCount, 1);
  assert.equal(realExecutionService.getRecentTrades(10).length >= 4, true);
});

test("RealExecutionService keeps neutral market score at baseline during bootstrap", () => {
  const realExecutionService = new RealExecutionService(
    buildMarketStateServiceMock(buildMarketSnapshotSlice(2_000, 0.52)),
    buildPredictionEngineMock(buildLivePredictionResponse(), []),
    buildExecutionPolicyServiceMock(),
    buildOrderServiceMock(),
    buildMarketCatalogServiceMock(),
  );

  const marketPerformanceSummary = realExecutionService.getMarketPerformanceSummaries().find((summary) => summary.marketKey === "btc:5m");

  assert.notEqual(marketPerformanceSummary, undefined);
  assert.equal(marketPerformanceSummary?.researchPredictionCount, 0);
  assert.equal(marketPerformanceSummary?.tradeCount, 0);
  assert.equal(marketPerformanceSummary?.marketScore, 0.5);
});

test("RealExecutionService derives market score from resolved predictions instead of trade PnL", () => {
  const realExecutionService = new RealExecutionService(
    buildMarketStateServiceMock(buildMarketSnapshotSlice(2_000, 0.52)),
    buildPredictionEngineMock(buildLivePredictionResponse(), buildResolvedPredictionHistory()),
    buildExecutionPolicyServiceMock(),
    buildOrderServiceMock(),
    buildMarketCatalogServiceMock(),
  );
  const mutableRealExecutionService = realExecutionService as unknown as { recentTrades: ExecutionTrade[] };
  const seedTrade = buildSeedTrades()[0];
  if (seedTrade === undefined) {
    throw new Error("expected seed trade");
  }
  mutableRealExecutionService.recentTrades.push({
    ...seedTrade,
    marketKey: "btc:5m",
    realizedPnlAfterCosts: -0.4,
    exitFilledAt: 19_500,
  });

  const marketPerformanceSummary = realExecutionService.getMarketPerformanceSummaries().find((summary) => summary.marketKey === "btc:5m");

  assert.notEqual(marketPerformanceSummary, undefined);
  assert.equal((marketPerformanceSummary?.marketScore ?? 0) > 0.7, true);
  assert.equal(marketPerformanceSummary?.status, "tradable");
});

function buildMarketStateServiceMock(marketSliceOrFactory: MarketSnapshotSlice | (() => MarketSnapshotSlice)): MarketStateService {
  return {
    getLatestSlice(marketKey: string): MarketSnapshotSlice | null {
      let marketSlice: MarketSnapshotSlice | null = null;
      if (marketKey === "btc:5m") {
        marketSlice = typeof marketSliceOrFactory === "function" ? marketSliceOrFactory() : marketSliceOrFactory;
      }
      return marketSlice;
    },
  } as unknown as MarketStateService;
}

function buildPredictionEngineMock(
  livePrediction: PredictionResponse,
  resolvedPredictions: PredictionResponse[],
  onTradeResolved?: () => void,
): PredictionEngineService {
  return {
    getLatestPrediction(asset: string, window: string): PredictionResponse | null {
      return asset === "btc" && window === "5m" ? livePrediction : null;
    },
    getPredictions(asset: string, window: string): PredictionResponse[] {
      return asset === "btc" && window === "5m" ? resolvedPredictions : [];
    },
    getPredictionCount(asset: string, window: string): number {
      return asset === "btc" && window === "5m" ? resolvedPredictions.length + 1 : 0;
    },
    markPredictionExecuted(): void {
      return;
    },
    resolvePredictionFromTrade(): void {
      if (onTradeResolved) {
        onTradeResolved();
      }
    },
    markExecutionEligibility(): void {
      return;
    },
  } as unknown as PredictionEngineService;
}

function buildMarketCatalogServiceMock(): { loadMarketBySlug(): Promise<PolymarketMarket> } {
  return {
    async loadMarketBySlug(): Promise<PolymarketMarket> {
      return buildPolymarketMarket();
    },
  };
}

function buildOrderServiceMock(): {
  init(): Promise<void>;
  getMyBalance(): Promise<number>;
  postOrder(): Promise<PostedOrder | null>;
  waitForOrderConfirmation(): Promise<PostedOrderWithStatus>;
  disconnect(): Promise<void>;
} {
  return {
    async init(): Promise<void> {
      return;
    },
    async getMyBalance(): Promise<number> {
      return 500;
    },
    async postOrder(): Promise<PostedOrder | null> {
      return null;
    },
    async waitForOrderConfirmation(): Promise<PostedOrderWithStatus> {
      throw new Error("not expected");
    },
    async disconnect(): Promise<void> {
      return;
    },
  };
}

function buildExecutionPolicyServiceMock(): ExecutionPolicyService {
  return {
    buildEntryDecision(
      marketSlice: MarketSnapshotSlice | null,
      prediction: PredictionResponse | null,
      openPosition: PaperPosition | null,
      _marketPerformanceSummary: MarketPerformanceSummary | null,
    ): ExecutionDecision | null {
      let executionDecision: ExecutionDecision | null = null;
      if (marketSlice !== null && prediction !== null && openPosition === null) {
        executionDecision = {
          marketKey: marketSlice.marketKey,
          asset: marketSlice.asset,
          window: marketSlice.window,
          isEntryAllowed: true,
          marketScore: 0.82,
          marketTradeCount: 12,
          hasSufficientMarketHistory: true,
          positionSide: "up",
          predictionDirection: prediction.direction,
          entryReferencePrice: 0.5,
          orderShareCount: 5,
          orderNotionalUsd: 2.5,
          takeProfitPrice: 0.62,
          stopLossPrice: 0.42,
          executionStyle: "maker",
          executionReason: "test_entry",
          urgencyScore: 0.1,
          makerFillProbability: 0.8,
          bookRiskScore: 0.1,
          positionSizeSuggestion: 1,
          breadthDirection: "UP",
          breadthStrength: 0.8,
          hasStrongBreadth: true,
          hasBreadthAlignment: true,
          selectedComboKey: "s01+s02",
          selectedComboSize: 2,
          selectedComboSource: "research",
          selectedComboDirection: "UP",
          selectedComboScore: 0.82,
          selectedComboConfidence: 0.9,
          selectedComboStrategyIds: ["s01", "s02"],
          selectedComboAffordabilityScore: 0.84,
          regimeId: "btc_eth_up",
          blockingReasons: [],
          generatedAt: marketSlice.generatedAt,
        };
      }
      return executionDecision;
    },
    buildExitDecision(
      marketSlice: MarketSnapshotSlice,
      _openPosition: PaperPosition,
      _prediction: PredictionResponse | null,
    ): {
      exitReason: TradeExitReason | null;
      executionStyle: ExecutionStyle | null;
      exitPrice: number | null;
      nextStopLossPrice: number | null;
    } {
      const shouldExit = (marketSlice.up.midpoint ?? marketSlice.up.price ?? 0) >= 0.62;
      return {
        exitReason: shouldExit ? "take_profit_hit" : null,
        executionStyle: shouldExit ? "maker" : null,
        exitPrice: shouldExit ? 0.62 : null,
        nextStopLossPrice: null,
      };
    },
  } as unknown as ExecutionPolicyService;
}

function buildPolymarketMarket(): PolymarketMarket {
  return {
    id: "m-1",
    slug: "btc-5m",
    question: "BTC?",
    symbol: "btc",
    conditionId: "condition-1",
    outcomes: ["UP", "DOWN"],
    clobTokenIds: ["up-token", "down-token"],
    upTokenId: "up-token",
    downTokenId: "down-token",
    orderMinSize: 5,
    orderPriceMinTickSize: "0.01",
    eventStartTime: "2025-01-01T00:00:00.000Z",
    endDate: "2025-01-01T00:05:00.000Z",
    start: new Date("2025-01-01T00:00:00.000Z"),
    end: new Date("2025-01-01T00:05:00.000Z"),
    raw: {},
  };
}

function buildMarketSnapshotSlice(generatedAt: number, upMidpoint: number): MarketSnapshotSlice {
  const tokenMetrics = buildTokenMetrics(upMidpoint);
  const spotVenues: SpotVenueMetrics[] = [
    {
      venue: "binance",
      price: 60_000,
      eventTs: generatedAt,
      ageMs: 0,
      midpoint: 60_000,
      spread: 1,
      imbalance: 0.08,
    },
  ];
  const quality: MarketQuality = {
    score: 0.95,
    hasLiveMarket: true,
    hasFreshTokens: true,
    hasFreshSpot: true,
    issues: [],
  };
  return {
    asset: "btc",
    window: "5m",
    marketKey: "btc:5m",
    generatedAt,
    slug: "btc-5m",
    marketStart: "2025-01-01T00:00:00.000Z",
    marketEnd: "2025-01-01T00:05:00.000Z",
    priceToBeat: 100,
    up: tokenMetrics,
    down: buildTokenMetrics(1 - upMidpoint),
    spotVenues,
    spotConsensusPrice: 60_000,
    spotMomentum: 0.03,
    spotDispersion: 0.001,
    chainlinkPrice: 60_001,
    chainlinkAgeMs: 0,
    quality,
  };
}

function buildTokenMetrics(midpoint: number): TokenMetrics {
  return {
    price: midpoint,
    midpoint,
    spread: 0.01,
    bestBid: midpoint - 0.005,
    bestAsk: midpoint + 0.005,
    depthTop: 100,
    imbalance: 0.09,
    distanceToHalf: Math.abs(midpoint - 0.5),
    eventTs: 0,
    ageMs: 0,
  };
}

function buildLivePredictionResponse(): PredictionResponse {
  return {
    asset: "btc",
    window: "5m",
    marketKey: "btc:5m",
    direction: "UP",
    confidence: 0.91,
    weightedScore: 0.82,
    baseWeightedScore: 0.79,
    adjustedWeightedScore: 0.82,
    baseConfidence: 0.85,
    adjustedConfidence: 0.91,
    timestamp: 40_000,
    trigger: {
      marketKey: "btc:5m",
      asset: "btc",
      window: "5m",
      triggeredToken: "up",
      triggerType: "crossed_half",
      previousPrice: 0.49,
      currentPrice: 0.5,
      distanceToHalf: 0,
      triggeredAt: 40_000,
    },
    evaluationDueAt: 70_000,
    positionSide: "up",
    entryReferencePrice: 0.5,
    takeProfitPrice: 0.62,
    stopLossPrice: 0.42,
    isResolved: false,
    comboGate: {
      hasComboGatePassed: true,
      selectedComboKey: "s09+s21",
      selectedComboSize: 2,
      selectedComboSource: "research",
      effectiveComboScore: 0.82,
      gateReason: null,
    },
    crossAssetRegime: {
      regimeId: "btc_eth_up",
      regimeClass: "aligned",
      breadthDirection: "UP",
      btcDirection: "UP",
      ethDirection: "UP",
      btcUpTokenMomentum: 0.02,
      btcDownTokenMomentum: 0.02,
      ethUpTokenMomentum: 0.02,
      ethDownTokenMomentum: 0.02,
      hasBtcAnchor: true,
      hasEthAlignment: true,
      breadthStrength: 0.78,
      breadthParticipation: 1,
      followerParticipation: 1,
      averageSignedMove: 0.04,
      targetSignedMove: 0.02,
      peerAverageSignedMove: 0.04,
      lagRatio: 0.3,
      alignedMarketCount: 4,
      qualifyingMarketCount: 4,
      synchronyScore: 1,
      accelerationScore: 0.61,
      exhaustionScore: 0.24,
      reversalRiskScore: 0.16,
      isDirectional: true,
      isTradableGlobalContext: true,
      hasStrongBreadth: true,
    },
    isExecutionEligible: false,
    executionBlockingReasons: [],
    wasExecuted: false,
    executionComboSource: "research",
    result: {
      status: "pending",
      resolvedAt: null,
      resolvedDirection: null,
      evaluationPrice: null,
      baselinePrice: 0.5,
      isFallbackPriceUsed: false,
      reason: null,
    },
    strategyBreakdown: [],
    selectedCombo: {
      comboKey: "s09+s21",
      marketKey: "btc:5m",
      memberStrategyIds: ["s09", "s21"],
      size: 2,
      direction: "UP",
      comboConfidence: 0.9,
      comboScore: 0.82,
      agreementScore: 1,
      historicalHitRate: 0.7,
      historicalPnlProxy: 0.2,
      sampleCount: 12,
      drawdownProxy: 0.08,
      diversityScore: 1,
      familyRedundancyPenalty: 0,
      semanticOverlapPenalty: 0,
      anchorFitScore: 1,
      marketQualityScore: 0.95,
      affordabilityScore: 0.86,
      selectionReason: "execution good agr 1.00 fit 1.00",
      isResearchEligible: true,
      isExecutionEligible: true,
      selectionSource: "research",
    },
    comboBreakdown: {
      activeCombos: [],
      appliedBoostCombos: [],
      appliedDisagreementCombos: [],
      totalBoostApplied: 0,
      totalConfidencePenaltyApplied: 0,
    },
  };
}

function buildResolvedPredictionHistory(): PredictionResponse[] {
  const resolvedPredictions: PredictionResponse[] = [];
  for (let index = 0; index < 8; index += 1) {
    resolvedPredictions.push({
      ...buildLivePredictionResponse(),
      timestamp: 10_000 + index * 1_000,
      isResolved: true,
      result: {
        status: "ok",
        resolvedAt: 10_500 + index * 1_000,
        resolvedDirection: "UP",
        evaluationPrice: 0.64,
        baselinePrice: 0.5,
        isFallbackPriceUsed: false,
        reason: "take_profit_hit",
      },
    });
  }
  return resolvedPredictions;
}

function buildSeedTrades(): ExecutionTrade[] {
  const seedTrades: ExecutionTrade[] = [];
  for (let index = 0; index < 3; index += 1) {
    seedTrades.push({
      positionId: `seed-${index}`,
      marketKey: "btc:5m",
      asset: "btc",
      window: "5m",
      positionSide: "up",
      shareCount: 5,
      entryExecutionStyle: "taker",
      exitExecutionStyle: "taker",
      entryNotionalUsd: 2.5,
      exitNotionalUsd: 3.1,
      entryFillPrice: 0.5,
      exitFillPrice: 0.62,
      entryFilledAt: 5_000 + index * 1_000,
      exitFilledAt: 5_500 + index * 1_000,
      exitReason: "take_profit_hit",
      realizedPnlTokenPrice: 0.6,
      realizedPnlAfterCosts: 0.45,
      holdTimeMs: 500,
      hasTakerFallbackUsed: false,
    });
  }
  return seedTrades;
}
