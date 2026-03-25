import * as assert from "node:assert/strict";
import { test } from "node:test";

import { ComboMetricsService } from "../src/combo/combo-metrics.service.ts";
import type { SelectedStrategyCombo } from "../src/combo/combo.types.ts";
import type { MarketStateService } from "../src/market/market-state.service.ts";
import type { CrossAssetRegimeId, MarketTrigger, PredictionContext } from "../src/market/market.types.ts";
import { PredictionEngineService } from "../src/prediction/prediction-engine.service.ts";
import { PredictionStoreService } from "../src/prediction/prediction-store.service.ts";
import type { StrategyEngineService } from "../src/strategy/strategy-engine.service.ts";
import type { StrategyMetricsService } from "../src/strategy/strategy-metrics.service.ts";

test("PredictionEngineService emits a model trigger when the combo state changes without a classic price trigger", () => {
  const predictionEngineService = new PredictionEngineService(
    {} as MarketStateService,
    {} as StrategyEngineService,
    {} as StrategyMetricsService,
    new PredictionStoreService(),
    new ComboMetricsService(),
  );

  const buildModelDrivenTrigger = Reflect.get(predictionEngineService, "buildModelDrivenTrigger") as
    | ((modelEvaluationSnapshot: object, triggeredAt: number) => MarketTrigger | null)
    | undefined;

  if (!buildModelDrivenTrigger) {
    throw new Error("expected model trigger helper");
  }

  // First call seeds the model state snapshot (expects null — no previous state to compare against)
  const firstModelTrigger = buildModelDrivenTrigger.call(predictionEngineService, buildModelEvaluationSnapshot("neutral", null, 0.505, 0.495), 1_000);
  // Second call sees a regime+combo shift → should emit a model-driven trigger
  const secondModelTrigger = buildModelDrivenTrigger.call(
    predictionEngineService,
    buildModelEvaluationSnapshot("btc_eth_up", buildSelectedCombo("s09+s14", 0.72), 0.58, 0.42),
    3_000,
  );

  assert.equal(firstModelTrigger, null);
  assert.notEqual(secondModelTrigger, null);
  assert.equal(secondModelTrigger?.triggerType, "combo_state_shift");
  assert.equal(secondModelTrigger?.triggeredToken, "up");
});

function buildModelEvaluationSnapshot(
  regimeId: CrossAssetRegimeId,
  selectedCombo: SelectedStrategyCombo | null,
  upPrice: number,
  downPrice: number,
): {
  predictionContext: PredictionContext;
  comboApplicationResult: {
    selectedCombo: SelectedStrategyCombo | null;
  };
} {
  const marketSlice = {
    asset: "btc" as const,
    window: "5m" as const,
    marketKey: "btc:5m" as const,
    generatedAt: 0,
    slug: "btc-5m",
    marketStart: "2025-01-01T00:00:00.000Z",
    marketEnd: "2025-01-01T00:05:00.000Z",
    priceToBeat: 100,
    up: {
      price: upPrice,
      midpoint: upPrice,
      spread: 0.01,
      bestBid: upPrice - 0.005,
      bestAsk: upPrice + 0.005,
      depthTop: 100,
      imbalance: 0.1,
      distanceToHalf: Math.abs(upPrice - 0.5),
      eventTs: 0,
      ageMs: 0,
    },
    down: {
      price: downPrice,
      midpoint: downPrice,
      spread: 0.01,
      bestBid: downPrice - 0.005,
      bestAsk: downPrice + 0.005,
      depthTop: 100,
      imbalance: -0.1,
      distanceToHalf: Math.abs(downPrice - 0.5),
      eventTs: 0,
      ageMs: 0,
    },
    spotVenues: [],
    spotConsensusPrice: 60_000,
    spotMomentum: 0.03,
    spotDispersion: 0.001,
    chainlinkPrice: 60_000,
    chainlinkAgeMs: 0,
    quality: {
      score: 0.9,
      hasLiveMarket: true,
      hasFreshTokens: true,
      hasFreshSpot: true,
      issues: [],
    },
  };
  return {
    predictionContext: {
      asset: "btc",
      window: "5m",
      marketKey: "btc:5m",
      triggeredAt: 0,
      trigger: {
        marketKey: "btc:5m",
        asset: "btc",
        window: "5m",
        triggeredToken: "up",
        triggerType: "combo_state_shift",
        previousPrice: 0.49,
        currentPrice: 0.51,
        distanceToHalf: 0.01,
        triggeredAt: 0,
      },
      current: marketSlice,
      previous: {
        ...marketSlice,
        generatedAt: -1_000,
      },
      history: [],
      crossAssetRegime: {
        regimeId,
        regimeClass: regimeId === "neutral" ? "fragmented" : "aligned",
        breadthDirection: regimeId === "neutral" ? "NEUTRAL" : "UP",
        btcDirection: regimeId === "neutral" ? "NEUTRAL" : "UP",
        ethDirection: regimeId === "neutral" ? "NEUTRAL" : "UP",
        btcUpTokenMomentum: regimeId === "neutral" ? 0 : 0.02,
        btcDownTokenMomentum: 0,
        ethUpTokenMomentum: regimeId === "neutral" ? 0 : 0.02,
        ethDownTokenMomentum: 0,
        hasBtcAnchor: regimeId !== "neutral",
        hasEthAlignment: regimeId !== "neutral",
        breadthStrength: regimeId === "neutral" ? 0 : 0.8,
        breadthParticipation: regimeId === "neutral" ? 0 : 1,
        followerParticipation: regimeId === "neutral" ? 0 : 0.5,
        averageSignedMove: regimeId === "neutral" ? 0 : 0.02,
        targetSignedMove: regimeId === "neutral" ? 0 : 0.015,
        peerAverageSignedMove: regimeId === "neutral" ? 0 : 0.02,
        lagRatio: 0.2,
        alignedMarketCount: regimeId === "neutral" ? 0 : 2,
        qualifyingMarketCount: regimeId === "neutral" ? 0 : 2,
        synchronyScore: regimeId === "neutral" ? 0 : 1,
        accelerationScore: 0.4,
        exhaustionScore: 0.1,
        reversalRiskScore: 0.05,
        isDirectional: regimeId !== "neutral",
        isTradableGlobalContext: regimeId !== "neutral",
        hasStrongBreadth: regimeId !== "neutral",
      },
    },
    comboApplicationResult: {
      selectedCombo,
    },
  };
}

function buildSelectedCombo(comboKey: string, comboScore: number): SelectedStrategyCombo {
  return {
    comboKey,
    marketKey: "btc:5m",
    memberStrategyIds: comboKey.split("+"),
    size: 2,
    direction: "UP",
    comboScore,
    agreementScore: 1,
    historicalHitRate: 1,
    historicalPnlProxy: 1,
    sampleCount: 2,
    drawdownProxy: 0,
    diversityScore: 1,
    familyRedundancyPenalty: 0,
    semanticOverlapPenalty: 0,
    anchorFitScore: 0.95,
    marketQualityScore: 0.9,
    affordabilityScore: 0.8,
    selectionReason: "test combo shift",
    isResearchEligible: true,
    isExecutionEligible: true,
    selectionSource: "research",
  };
}
