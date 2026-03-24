import * as assert from "node:assert/strict";
import { test } from "node:test";

import { ExecutionPolicyService } from "../src/execution/execution-policy.service.ts";
import type { MarketPerformanceSummary, PositionSide } from "../src/execution/execution.types.ts";
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
  assert.equal(executionDecision.gateFailures.includes("cross_asset_regime_conflict"), true);
});

function buildMarketSnapshotSlice(): MarketSnapshotSlice {
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
    asset: "btc",
    window: "5m",
    marketKey: "btc:5m",
    generatedAt: 2_000,
    slug: "btc-5m",
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

function buildPredictionResponse(direction: PredictionDirection): PredictionResponse {
  const positionSide: PositionSide = direction === "UP" ? "up" : "down";
  return {
    asset: "btc",
    window: "5m",
    marketKey: "btc:5m",
    direction,
    confidence: 0.88,
    weightedScore: direction === "UP" ? 0.88 : -0.88,
    baseWeightedScore: direction === "UP" ? 0.82 : -0.82,
    adjustedWeightedScore: direction === "UP" ? 0.88 : -0.88,
    baseConfidence: 0.8,
    adjustedConfidence: 0.88,
    timestamp: 2_000,
    trigger: {
      marketKey: "btc:5m",
      asset: "btc",
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
      regimeId: "leader_laggard_up",
      regimeClass: "leader_laggard",
      breadthDirection: "UP",
      breadthStrength: 0.91,
      breadthParticipation: 1,
      averageSignedMove: 0.08,
      targetSignedMove: 0.01,
      peerAverageSignedMove: 0.09,
      lagRatio: 0.88,
      alignedMarketCount: 4,
      qualifyingMarketCount: 4,
      leaderMarketKey: "eth:5m",
      leaderGroup: ["eth:5m", "btc:5m"],
      laggardGroup: ["btc:5m"],
      synchronyScore: 1,
      accelerationScore: 0.72,
      exhaustionScore: 0.28,
      reversalRiskScore: 0.18,
      isDirectional: true,
      isTradableGlobalContext: true,
      hasStrongBreadth: true,
      hasLeaderLaggardOpportunity: true,
    },
    isExecutionEligible: false,
    executionGateFailures: [],
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
    engineBreakdown: [],
    winningSetupType: "leader_laggard_catchup",
    winningEngineIds: ["breadth_engine", "propagation_engine", "local_momentum_engine"],
    winningEngineComboKey: "breadth_engine+propagation_engine+local_momentum_engine",
    winningEngineComboScore: 0.84,
    combinationReason: "leaders move first, laggard catches up",
    comboBreakdown: {
      activeCombos: [],
      appliedBoostCombos: [],
      appliedDisagreementCombos: [],
      totalBoostApplied: 0,
      totalConfidencePenaltyApplied: 0,
    },
  };
}

function buildMarketPerformanceSummary(): MarketPerformanceSummary {
  return {
    marketKey: "btc:5m",
    asset: "btc",
    window: "5m",
    predictionCount: 10,
    score: 0.81,
    researchScore: 0.82,
    executionScore: 0.79,
    effectiveExecutionScore: 0.79,
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
