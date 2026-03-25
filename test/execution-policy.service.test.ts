import * as assert from "node:assert/strict";
import { test } from "node:test";

import { ExecutionPolicyService } from "../src/execution/execution-policy.service.ts";
import type { MarketPerformanceSummary, PaperPosition, PositionSide } from "../src/execution/execution.types.ts";
import type { MarketQuality, MarketSnapshotSlice, PredictionDirection, SpotVenueMetrics, TokenMetrics } from "../src/market/market.types.ts";
import type { PredictionResponse } from "../src/prediction/prediction.types.ts";

test("ExecutionPolicyService blocks entries that fight a strong cross-asset breadth regime", () => {
  const executionPolicyService = new ExecutionPolicyService();
  const prediction = buildPredictionResponse("DOWN");
  const executionDecision = executionPolicyService.buildEntryDecision(buildMarketSnapshotSlice(), prediction, null, buildMarketPerformanceSummary());

  if (executionDecision === null) {
    throw new Error("expected execution decision");
  }
  assert.equal(executionDecision.isEntryAllowed, false);
  assert.equal(executionDecision.breadthDirection, "UP");
  assert.equal(executionDecision.hasBreadthAlignment, false);
  assert.equal(executionDecision.blockingReasons.includes("cross_asset_regime_conflict"), true);
});

test("ExecutionPolicyService blocks alt longs when the BTC anchor is clearly down", () => {
  const executionPolicyService = new ExecutionPolicyService();
  const prediction = buildPredictionResponse("UP", "xrp", "DOWN", "NEUTRAL");
  const executionDecision = executionPolicyService.buildEntryDecision(buildMarketSnapshotSlice("xrp"), prediction, null, buildMarketPerformanceSummary("xrp"));

  if (executionDecision === null) {
    throw new Error("expected execution decision");
  }
  assert.equal(executionDecision.isEntryAllowed, false);
  assert.equal(executionDecision.blockingReasons.includes("cross_asset_regime_conflict"), true);
});

test("ExecutionPolicyService blocks ETH when BTC is clearly moving the other way", () => {
  const executionPolicyService = new ExecutionPolicyService();
  const prediction = buildPredictionResponse("UP", "eth", "DOWN", "NEUTRAL");
  const executionDecision = executionPolicyService.buildEntryDecision(buildMarketSnapshotSlice("eth"), prediction, null, buildMarketPerformanceSummary("eth"));

  if (executionDecision === null) {
    throw new Error("expected execution decision");
  }
  assert.equal(executionDecision.isEntryAllowed, false);
  assert.equal(executionDecision.blockingReasons.includes("cross_asset_regime_conflict"), true);
});

test("ExecutionPolicyService blocks ETH UP when BTC UP token momentum is not supportive", () => {
  const executionPolicyService = new ExecutionPolicyService();
  const prediction = buildPredictionResponse("UP", "eth", "UP", "UP", {
    btcUpTokenMomentum: 0.001,
  });
  const executionDecision = executionPolicyService.buildEntryDecision(buildMarketSnapshotSlice("eth"), prediction, null, buildMarketPerformanceSummary("eth"));

  if (executionDecision === null) {
    throw new Error("expected execution decision");
  }
  assert.equal(executionDecision.isEntryAllowed, false);
  assert.equal(executionDecision.blockingReasons.includes("cross_asset_regime_conflict"), true);
});

test("ExecutionPolicyService blocks SOL when BTC and ETH align against it", () => {
  const executionPolicyService = new ExecutionPolicyService();
  const prediction = buildPredictionResponse("UP", "sol", "DOWN", "DOWN");
  const executionDecision = executionPolicyService.buildEntryDecision(buildMarketSnapshotSlice("sol"), prediction, null, buildMarketPerformanceSummary("sol"));

  if (executionDecision === null) {
    throw new Error("expected execution decision");
  }
  assert.equal(executionDecision.isEntryAllowed, false);
  assert.equal(executionDecision.blockingReasons.includes("cross_asset_regime_conflict"), true);
});

test("ExecutionPolicyService blocks XRP when BTC and ETH are not aligned", () => {
  const executionPolicyService = new ExecutionPolicyService();
  const prediction = buildPredictionResponse("UP", "xrp", "UP", "NEUTRAL");
  const executionDecision = executionPolicyService.buildEntryDecision(buildMarketSnapshotSlice("xrp"), prediction, null, buildMarketPerformanceSummary("xrp"));

  if (executionDecision === null) {
    throw new Error("expected execution decision");
  }
  assert.equal(executionDecision.isEntryAllowed, false);
  assert.equal(executionDecision.blockingReasons.includes("cross_asset_regime_conflict"), true);
});

test("ExecutionPolicyService allows SOL only when BTC and ETH align with it", () => {
  const executionPolicyService = new ExecutionPolicyService();
  const prediction = buildPredictionResponse("UP", "sol", "UP", "UP");
  const executionDecision = executionPolicyService.buildEntryDecision(buildMarketSnapshotSlice("sol"), prediction, null, buildMarketPerformanceSummary("sol"));

  if (executionDecision === null) {
    throw new Error("expected execution decision");
  }
  assert.equal(executionDecision.blockingReasons.includes("cross_asset_regime_conflict"), false);
});

test("ExecutionPolicyService blocks SOL UP when BTC and ETH UP tokens do not both support it", () => {
  const executionPolicyService = new ExecutionPolicyService();
  const prediction = buildPredictionResponse("UP", "sol", "UP", "UP", {
    btcUpTokenMomentum: 0.02,
    ethUpTokenMomentum: 0.001,
  });
  const executionDecision = executionPolicyService.buildEntryDecision(buildMarketSnapshotSlice("sol"), prediction, null, buildMarketPerformanceSummary("sol"));

  if (executionDecision === null) {
    throw new Error("expected execution decision");
  }
  assert.equal(executionDecision.isEntryAllowed, false);
  assert.equal(executionDecision.blockingReasons.includes("cross_asset_regime_conflict"), true);
});

test("ExecutionPolicyService blocks entries when the historical market score is too low", () => {
  const executionPolicyService = new ExecutionPolicyService();
  const prediction = buildPredictionResponse("UP", "btc", "UP", "UP");
  const executionDecision = executionPolicyService.buildEntryDecision(buildMarketSnapshotSlice("btc"), prediction, null, {
    ...buildMarketPerformanceSummary("btc"),
    marketScore: 0.54,
  });

  if (executionDecision === null) {
    throw new Error("expected execution decision");
  }
  assert.equal(executionDecision.isEntryAllowed, false);
  assert.equal(executionDecision.blockingReasons.includes("market_score_too_low"), true);
});

test("ExecutionPolicyService keeps the position open at take profit when continuation still looks healthy", () => {
  const executionPolicyService = new ExecutionPolicyService();
  const marketSlice = buildMarketSnapshotSlice("btc");
  marketSlice.up.price = 0.64;
  marketSlice.up.midpoint = 0.64;
  marketSlice.up.bestBid = 0.635;
  marketSlice.up.bestAsk = 0.645;
  const openPosition = buildOpenPosition("up");
  const prediction = buildPredictionResponse("UP", "btc", "UP", "UP");
  const exitDecision = executionPolicyService.buildExitDecision(marketSlice, openPosition, prediction);

  assert.equal(exitDecision.exitReason, null);
  assert.equal(exitDecision.nextStopLossPrice, 0.5);
});

test("ExecutionPolicyService exits at take profit when continuation has degraded", () => {
  const executionPolicyService = new ExecutionPolicyService();
  const marketSlice = buildMarketSnapshotSlice("btc");
  marketSlice.up.price = 0.64;
  marketSlice.up.midpoint = 0.64;
  marketSlice.up.bestBid = 0.635;
  marketSlice.up.bestAsk = 0.645;
  const openPosition = buildOpenPosition("up");
  const degradedPrediction = buildPredictionResponse("UP", "btc", "UP", "UP");
  degradedPrediction.selectedCombo.comboScore = 0.54;
  degradedPrediction.selectedCombo.affordabilityScore = 0.1;
  const exitDecision = executionPolicyService.buildExitDecision(marketSlice, openPosition, degradedPrediction);

  assert.equal(exitDecision.exitReason, "take_profit_hit");
  assert.notEqual(exitDecision.executionStyle, null);
});

function buildMarketSnapshotSlice(asset: "btc" | "eth" | "sol" | "xrp" = "btc"): MarketSnapshotSlice {
  const tokenMetrics = buildTokenMetrics(0.5);
  const marketQuality: MarketQuality = {
    score: 0.95,
    hasLiveMarket: true,
    hasFreshTokens: true,
    hasFreshSpot: true,
    issues: [],
  };
  const spotVenues: SpotVenueMetrics[] = [
    {
      venue: "binance",
      price: 60_000,
      eventTs: 2_000,
      ageMs: 0,
      midpoint: 60_000,
      spread: 1,
      imbalance: 0.05,
    },
  ];
  return {
    asset,
    window: "5m",
    marketKey: `${asset}:5m`,
    generatedAt: 2_000,
    slug: `${asset}-5m`,
    marketStart: "2025-01-01T00:00:00.000Z",
    marketEnd: "2025-01-01T00:05:00.000Z",
    priceToBeat: 100,
    up: tokenMetrics,
    down: tokenMetrics,
    spotVenues,
    spotConsensusPrice: 60_000,
    spotMomentum: 0.02,
    spotDispersion: 0.001,
    chainlinkPrice: 60_001,
    chainlinkAgeMs: 0,
    quality: marketQuality,
  };
}

function buildTokenMetrics(midpoint: number): TokenMetrics {
  return {
    price: midpoint,
    midpoint,
    spread: 0.01,
    bestBid: midpoint - 0.005,
    bestAsk: midpoint + 0.005,
    depthTop: 80,
    imbalance: 0.05,
    distanceToHalf: Math.abs(midpoint - 0.5),
    eventTs: 2_000,
    ageMs: 0,
  };
}

function buildPredictionResponse(
  direction: PredictionDirection,
  asset: "btc" | "eth" | "sol" | "xrp" = "btc",
  btcDirection: "UP" | "DOWN" | "NEUTRAL" = "UP",
  ethDirection: "UP" | "DOWN" | "NEUTRAL" = "UP",
  tokenMomentumOverrides: Partial<{
    btcUpTokenMomentum: number;
    btcDownTokenMomentum: number;
    ethUpTokenMomentum: number;
    ethDownTokenMomentum: number;
  }> = {},
): PredictionResponse {
  const positionSide: PositionSide = direction === "UP" ? "up" : "down";
  return {
    asset,
    window: "5m",
    marketKey: `${asset}:5m`,
    direction,
    confidence: 0.88,
    weightedScore: direction === "UP" ? 0.88 : -0.88,
    baseWeightedScore: direction === "UP" ? 0.82 : -0.82,
    adjustedWeightedScore: direction === "UP" ? 0.88 : -0.88,
    baseConfidence: 0.8,
    adjustedConfidence: 0.88,
    timestamp: 2_000,
    trigger: {
      marketKey: `${asset}:5m`,
      asset,
      window: "5m",
      triggeredToken: "up",
      triggerType: "crossed_half",
      previousPrice: 0.49,
      currentPrice: 0.51,
      distanceToHalf: 0.01,
      triggeredAt: 2_000,
    },
    evaluationDueAt: 32_000,
    positionSide,
    entryReferencePrice: 0.5,
    takeProfitPrice: 0.62,
    stopLossPrice: 0.42,
    isResolved: false,
    comboGate: {
      hasComboGatePassed: true,
      selectedComboKey: "s09+s21",
      selectedComboSize: 2,
      selectedComboSource: "research",
      effectiveComboScore: 0.79,
      gateReason: null,
    },
    crossAssetRegime: {
      regimeId:
        btcDirection === "UP" && ethDirection === "UP"
          ? "btc_eth_up"
          : btcDirection === "DOWN" && ethDirection === "DOWN"
            ? "btc_eth_down"
            : btcDirection === "UP"
              ? "btc_up"
              : btcDirection === "DOWN"
                ? "btc_down"
                : "fragmented",
      regimeClass:
        btcDirection === "UP" && ethDirection === "UP"
          ? "aligned"
          : btcDirection === "DOWN" && ethDirection === "DOWN"
            ? "aligned"
            : btcDirection === "NEUTRAL"
              ? "fragmented"
              : "anchor",
      breadthDirection: "UP",
      btcDirection,
      ethDirection,
      btcUpTokenMomentum: tokenMomentumOverrides.btcUpTokenMomentum ?? 0.02,
      btcDownTokenMomentum: tokenMomentumOverrides.btcDownTokenMomentum ?? 0.02,
      ethUpTokenMomentum: tokenMomentumOverrides.ethUpTokenMomentum ?? 0.02,
      ethDownTokenMomentum: tokenMomentumOverrides.ethDownTokenMomentum ?? 0.02,
      hasBtcAnchor: btcDirection !== "NEUTRAL",
      hasEthAlignment: btcDirection !== "NEUTRAL" && btcDirection === ethDirection,
      breadthStrength: 0.91,
      breadthParticipation: 1,
      followerParticipation: 1,
      averageSignedMove: 0.08,
      targetSignedMove: 0.01,
      peerAverageSignedMove: 0.09,
      lagRatio: 0.88,
      alignedMarketCount: 4,
      qualifyingMarketCount: 4,
      synchronyScore: 1,
      accelerationScore: 0.72,
      exhaustionScore: 0.28,
      reversalRiskScore: 0.18,
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
      marketKey: `${asset}:5m`,
      memberStrategyIds: ["s09", "s21"],
      size: 2,
      direction,
      comboConfidence: 0.88,
      comboScore: 0.84,
      agreementScore: 1,
      historicalHitRate: 0.7,
      historicalPnlProxy: 0.2,
      sampleCount: 10,
      drawdownProxy: 0.1,
      diversityScore: 1,
      familyRedundancyPenalty: 0,
      semanticOverlapPenalty: 0,
      anchorFitScore: asset === "btc" ? 1 : asset === "eth" ? 0.95 : btcDirection === ethDirection && btcDirection === direction ? 1 : 0.2,
      marketQualityScore: 0.95,
      affordabilityScore: 0.81,
      selectionReason: "research good agr 1.00 fit 1.00",
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

function buildOpenPosition(positionSide: PositionSide): PaperPosition {
  return {
    positionId: "position-1",
    marketKey: "btc:5m",
    asset: "btc" as const,
    window: "5m" as const,
    positionSide,
    entryDecisionAt: 1_000,
    entryExecutionStyle: "maker" as const,
    shareCount: 10,
    entryPostedPrice: null,
    entryFillPrice: 0.5,
    entryFilledAt: 1_100,
    takeProfitPrice: 0.62,
    stopLossPrice: 0.42,
    status: "open" as const,
    exitDecisionAt: null,
    exitExecutionStyle: null,
    exitPostedPrice: null,
    exitFillPrice: null,
    exitFilledAt: null,
    exitReason: null,
    realizedPnlTokenPrice: null,
    realizedPnlAfterCosts: null,
    makerAttempts: 1,
    hasTakerFallbackUsed: false,
    signalTimestamp: 1_000,
  };
}

function buildMarketPerformanceSummary(asset: "btc" | "eth" | "sol" | "xrp" = "btc"): MarketPerformanceSummary {
  return {
    marketKey: `${asset}:5m`,
    asset,
    window: "5m",
    predictionCount: 10,
    marketScore: 0.82,
    tradeCount: 8,
    researchPredictionCount: 10,
    executedTradeCount: 8,
    winRate: 0.62,
    cumulativeNetPnl: 0.18,
    averageNetPnlPerTrade: 0.0225,
    maxDrawdown: 0.05,
    hasSufficientHistory: true,
    hasWarmupComplete: true,
    hasComboReadiness: true,
    status: "tradable",
  };
}
