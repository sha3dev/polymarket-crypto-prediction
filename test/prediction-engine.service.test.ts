import * as assert from "node:assert/strict";
import { test } from "node:test";

import { ComboMetricsService } from "../src/combo/combo-metrics.service.ts";
import type { SelectedStrategyCombo } from "../src/combo/combo.types.ts";
import config from "../src/config.ts";
import type { MarketStateService } from "../src/market/market-state.service.ts";
import type { CrossAssetRegimeId, MarketBarrierState, MarketTrigger, PredictionContext } from "../src/market/market.types.ts";
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

test("PredictionEngineService blocks ideas when the market is too close to resolution", () => {
  const predictionEngineService = new PredictionEngineService(
    {} as MarketStateService,
    {} as StrategyEngineService,
    {} as StrategyMetricsService,
    new PredictionStoreService(),
    new ComboMetricsService(),
  );
  const hasEnoughMarketTimeRemaining = Reflect.get(predictionEngineService, "hasEnoughMarketTimeRemaining") as
    | ((marketSlice: PredictionContext["current"] | null, createdAt: number) => boolean)
    | undefined;
  const staleMarketSlice = {
    ...buildModelEvaluationSnapshot("btc_eth_up", buildSelectedCombo("s09+s14", 0.72), 0.58, 0.42).predictionContext.current,
    marketEnd: "2025-01-01T00:00:09.000Z",
  };
  const freshMarketSlice = {
    ...staleMarketSlice,
    marketEnd: "2025-01-01T00:05:00.000Z",
  };

  if (hasEnoughMarketTimeRemaining === undefined) {
    throw new Error("expected market-time helper");
  }

  assert.equal(hasEnoughMarketTimeRemaining.call(predictionEngineService, staleMarketSlice, Date.parse("2025-01-01T00:00:00.000Z")), false);
  assert.equal(hasEnoughMarketTimeRemaining.call(predictionEngineService, freshMarketSlice, Date.parse("2025-01-01T00:00:00.000Z")), true);
});

test("PredictionEngineService blocks ideas when the market barrier is effectively decided", () => {
  const predictionEngineService = new PredictionEngineService(
    {} as MarketStateService,
    {} as StrategyEngineService,
    {} as StrategyMetricsService,
    new PredictionStoreService(),
    new ComboMetricsService(),
  );
  const hasContestableBarrierState = Reflect.get(predictionEngineService, "hasContestableBarrierState") as
    | ((marketSlice: PredictionContext["current"] | null, direction: "UP" | "DOWN") => boolean)
    | undefined;
  const decidedMarketSlice = {
    ...buildModelEvaluationSnapshot("btc_eth_up", buildSelectedCombo("s09+s14", 0.72), 0.58, 0.42).predictionContext.current,
    barrierState: buildBarrierState({ isEffectivelyDecided: true, dominantSide: "UP", isNearBarrier: false }),
  };

  if (hasContestableBarrierState === undefined) {
    throw new Error("expected barrier helper");
  }

  assert.equal(hasContestableBarrierState.call(predictionEngineService, decidedMarketSlice, "UP"), false);
});

test("PredictionEngineService blocks directions that fight the dominant barrier side late in the window", () => {
  const predictionEngineService = new PredictionEngineService(
    {} as MarketStateService,
    {} as StrategyEngineService,
    {} as StrategyMetricsService,
    new PredictionStoreService(),
    new ComboMetricsService(),
  );
  const hasContestableBarrierState = Reflect.get(predictionEngineService, "hasContestableBarrierState") as
    | ((marketSlice: PredictionContext["current"] | null, direction: "UP" | "DOWN") => boolean)
    | undefined;
  const conflictedMarketSlice = {
    ...buildModelEvaluationSnapshot("btc_eth_up", buildSelectedCombo("s09+s14", 0.72), 0.58, 0.42).predictionContext.current,
    barrierState: buildBarrierState({ dominantSide: "UP", isNearBarrier: false, timeRemainingMs: 15_000 }),
  };

  if (hasContestableBarrierState === undefined) {
    throw new Error("expected barrier helper");
  }

  assert.equal(hasContestableBarrierState.call(predictionEngineService, conflictedMarketSlice, "DOWN"), false);
  assert.equal(hasContestableBarrierState.call(predictionEngineService, conflictedMarketSlice, "UP"), true);
});

test("PredictionEngineService widens take profit materially in strong aligned contexts", () => {
  const predictionEngineService = new PredictionEngineService(
    {} as MarketStateService,
    {} as StrategyEngineService,
    {} as StrategyMetricsService,
    new PredictionStoreService(),
    new ComboMetricsService(),
  );
  const computeAdaptiveTakeProfitDelta = Reflect.get(predictionEngineService, "computeAdaptiveTakeProfitDelta") as
    | ((confidence: number, comboScore: number, regimeClass: string) => number)
    | undefined;

  if (computeAdaptiveTakeProfitDelta === undefined) {
    throw new Error("expected adaptive take-profit helper");
  }

  const takeProfitDelta = computeAdaptiveTakeProfitDelta.call(predictionEngineService, 0.84, 0.81, "aligned");

  assert.equal(takeProfitDelta > config.TAKE_PROFIT_DELTA * 1.2, true);
  assert.equal(takeProfitDelta <= config.TAKE_PROFIT_DELTA * 1.6, true);
});

test("PredictionEngineService keeps stop loss materially wider than the old micro-stop profile", () => {
  const predictionEngineService = new PredictionEngineService(
    {} as MarketStateService,
    {} as StrategyEngineService,
    {} as StrategyMetricsService,
    new PredictionStoreService(),
    new ComboMetricsService(),
  );
  const computeAdaptiveStopLossDelta = Reflect.get(predictionEngineService, "computeAdaptiveStopLossDelta") as
    | ((confidence: number, comboScore: number, regimeClass: string) => number)
    | undefined;

  if (computeAdaptiveStopLossDelta === undefined) {
    throw new Error("expected adaptive stop-loss helper");
  }

  const stopLossDelta = computeAdaptiveStopLossDelta.call(predictionEngineService, 0.78, 0.76, "aligned");

  assert.equal(stopLossDelta >= config.STOP_LOSS_DELTA, true);
  assert.equal(stopLossDelta > 0.07, true);
  assert.equal(stopLossDelta <= config.STOP_LOSS_DELTA * 1.4, true);
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
    barrierState: buildBarrierState(),
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
      barrierState: marketSlice.barrierState,
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
    barrierAlignmentScore: 0.8,
    marketQualityScore: 0.9,
    affordabilityScore: 0.8,
    selectionReason: "test combo shift",
    isResearchEligible: true,
    isExecutionEligible: true,
    selectionSource: "research",
  };
}

function buildBarrierState(overrides: Partial<MarketBarrierState> = {}): MarketBarrierState {
  return {
    priceToBeat: 60_000,
    chainlinkPrice: 60_000,
    spotConsensusPrice: 60_000,
    marketEnd: "2025-01-01T00:05:00.000Z",
    timeRemainingMs: 180_000,
    chainlinkDistanceRatio: 0,
    spotDistanceRatio: 0,
    dominantSide: null,
    isNearBarrier: true,
    isEffectivelyDecided: false,
    isBarrierDataUsable: true,
    decisionReason: "near barrier",
    ...overrides,
  };
}
