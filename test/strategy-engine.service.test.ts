import * as assert from "node:assert/strict";
import { test } from "node:test";

import type { PredictionContext } from "../src/market/market.types.ts";
import { StrategyEngineService } from "../src/strategy/strategy-engine.service.ts";
import { StrategyMetricsService } from "../src/strategy/strategy-metrics.service.ts";
import type { StrategyDefinition } from "../src/strategy/strategy.types.ts";

test("StrategyEngineService keeps s21 as breadth confirmation instead of primary breadth conviction", () => {
  const strategyDefinitions = buildStrategyDefinitions();
  const strategyMetricsService = new StrategyMetricsService(strategyDefinitions);
  const strategyEngineService = new StrategyEngineService(strategyMetricsService);
  const predictionContext = buildPredictionContext();
  const breadthScoreFunction = Reflect.get(strategyEngineService, "scoreCrossAssetBreadthImpulse") as ((context: PredictionContext) => number) | undefined;
  const engineBiasFunction = Reflect.get(strategyEngineService, "computeEngineBias") as ((engineId: string, context: PredictionContext) => number) | undefined;

  if (!breadthScoreFunction || !engineBiasFunction) {
    throw new Error("expected breadth helpers");
  }

  const breadthSignalScore = breadthScoreFunction.call(strategyEngineService, predictionContext);
  const breadthEngineBias = engineBiasFunction.call(strategyEngineService, "breadth_engine", predictionContext);

  assert.equal(Math.abs(breadthSignalScore) < Math.abs(breadthEngineBias), true);
  assert.equal(Math.abs(breadthSignalScore) < 0.2, true);
});

test("StrategyEngineService detects BTC trend reversal confirmation through s23", () => {
  const strategyDefinitions = buildStrategyDefinitions();
  const strategyMetricsService = new StrategyMetricsService(strategyDefinitions);
  const strategyEngineService = new StrategyEngineService(strategyMetricsService);
  const predictionContext: PredictionContext = {
    ...buildPredictionContext(),
    trigger: {
      ...buildPredictionContext().trigger,
      triggerType: "btc_trend_reversal",
    },
    crossAssetRegime: {
      ...buildPredictionContext().crossAssetRegime,
      btcUpTokenMomentum: 0.05,
      btcDownTokenMomentum: 0.01,
    },
  };
  const trendReversalFunction = Reflect.get(strategyEngineService, "scoreBtcTrendReversalConfirmation") as ((context: PredictionContext) => number) | undefined;

  if (!trendReversalFunction) {
    throw new Error("expected btc trend reversal helper");
  }

  const trendReversalScore = trendReversalFunction.call(strategyEngineService, predictionContext);

  assert.equal(trendReversalScore > 0.1, true);
});

test("StrategyEngineService turns s24 into a continuous affordability curve", () => {
  const strategyDefinitions = buildStrategyDefinitions();
  const strategyMetricsService = new StrategyMetricsService(strategyDefinitions);
  const strategyEngineService = new StrategyEngineService(strategyMetricsService);
  const cheapPredictionContext = {
    ...buildPredictionContext(),
    current: {
      ...buildPredictionContext().current,
      up: {
        ...buildPredictionContext().current.up,
        price: 0.2,
        midpoint: 0.2,
      },
      down: {
        ...buildPredictionContext().current.down,
        price: 0.8,
        midpoint: 0.8,
      },
    },
  };
  const mediumPredictionContext = {
    ...buildPredictionContext(),
    current: {
      ...buildPredictionContext().current,
      up: {
        ...buildPredictionContext().current.up,
        price: 0.5,
        midpoint: 0.5,
      },
      down: {
        ...buildPredictionContext().current.down,
        price: 0.5,
        midpoint: 0.5,
      },
    },
  };
  const expensivePredictionContext = {
    ...buildPredictionContext(),
    current: {
      ...buildPredictionContext().current,
      up: {
        ...buildPredictionContext().current.up,
        price: 0.79,
        midpoint: 0.79,
      },
      down: {
        ...buildPredictionContext().current.down,
        price: 0.21,
        midpoint: 0.21,
      },
    },
  };
  const priceStretchFunction = Reflect.get(strategyEngineService, "scorePriceStretchPenalty") as ((context: PredictionContext) => number) | undefined;

  if (!priceStretchFunction) {
    throw new Error("expected price stretch helper");
  }

  const cheapPriceStretchScore = priceStretchFunction.call(strategyEngineService, cheapPredictionContext);
  const mediumPriceStretchScore = priceStretchFunction.call(strategyEngineService, mediumPredictionContext);
  const expensivePriceStretchScore = priceStretchFunction.call(strategyEngineService, expensivePredictionContext);

  assert.equal(cheapPriceStretchScore > mediumPriceStretchScore, true);
  assert.equal(mediumPriceStretchScore > expensivePriceStretchScore, true);
  assert.equal(expensivePriceStretchScore < -0.9, true);
});

test("StrategyEngineService weakens continuation and boosts fade when the move is already stretched", () => {
  const strategyDefinitions = buildStrategyDefinitions();
  const strategyMetricsService = new StrategyMetricsService(strategyDefinitions);
  const strategyEngineService = new StrategyEngineService(strategyMetricsService);
  const stretchedPredictionContext: PredictionContext = {
    ...buildPredictionContext(),
    current: {
      ...buildPredictionContext().current,
      up: {
        ...buildPredictionContext().current.up,
        price: 0.74,
        midpoint: 0.74,
        distanceToHalf: 0.24,
      },
      down: {
        ...buildPredictionContext().current.down,
        price: 0.26,
        midpoint: 0.26,
        distanceToHalf: 0.24,
      },
    },
    crossAssetRegime: {
      ...buildPredictionContext().crossAssetRegime,
      reversalRiskScore: 0.72,
    },
  };
  const momentumFunction = Reflect.get(strategyEngineService, "scoreMomentumEwma") as ((context: PredictionContext) => number) | undefined;
  const spotMomentumFunction = Reflect.get(strategyEngineService, "scoreSpotConsensusMomentum") as ((context: PredictionContext) => number) | undefined;
  const fadeFunction = Reflect.get(strategyEngineService, "scoreLiquidityShockFade") as ((context: PredictionContext) => number) | undefined;

  if (!momentumFunction || !spotMomentumFunction || !fadeFunction) {
    throw new Error("expected stretched-move helpers");
  }

  const baseMomentumScore = momentumFunction.call(strategyEngineService, buildPredictionContext());
  const stretchedMomentumScore = momentumFunction.call(strategyEngineService, stretchedPredictionContext);
  const baseSpotMomentumScore = spotMomentumFunction.call(strategyEngineService, buildPredictionContext());
  const stretchedSpotMomentumScore = spotMomentumFunction.call(strategyEngineService, stretchedPredictionContext);
  const baseFadeScore = Math.abs(fadeFunction.call(strategyEngineService, buildPredictionContext()));
  const stretchedFadeScore = Math.abs(fadeFunction.call(strategyEngineService, stretchedPredictionContext));

  assert.equal(Math.abs(stretchedMomentumScore) < Math.abs(baseMomentumScore), true);
  assert.equal(Math.abs(stretchedSpotMomentumScore) < Math.abs(baseSpotMomentumScore), true);
  assert.equal(stretchedFadeScore > baseFadeScore, true);
});

function buildStrategyDefinitions(): StrategyDefinition[] {
  return [
    { strategyId: "s01", name: "Momentum EWMA", tier: "low", family: "momentum", description: "Short drift continuation.", isComboEligible: true },
    { strategyId: "s02", name: "Token Microprice", tier: "low", family: "microstructure", description: "Top-of-book pressure.", isComboEligible: true },
    { strategyId: "s05", name: "Order Book Churn", tier: "medium", family: "microstructure", description: "Book rotation pressure.", isComboEligible: true },
    { strategyId: "s09", name: "Spot Consensus Momentum", tier: "low", family: "momentum", description: "Cross-venue spot drift.", isComboEligible: true },
    { strategyId: "s12", name: "Volatility Breakout", tier: "medium", family: "momentum", description: "Regime breakout.", isComboEligible: false },
    { strategyId: "s14", name: "Chainlink Basis", tier: "low", family: "pricing", description: "Oracle catch-up.", isComboEligible: true },
    { strategyId: "s16", name: "Freshness Gap", tier: "low", family: "pricing", description: "Spot leads stale token.", isComboEligible: true },
    { strategyId: "s18", name: "Liquidity Shock Fade", tier: "medium", family: "reversion", description: "Short mean reversion.", isComboEligible: true },
    {
      strategyId: "s21",
      name: "Cross-Asset Breadth Impulse",
      tier: "medium",
      family: "cross_asset",
      description: "Market-wide breadth confirmation, not primary conviction.",
      isComboEligible: false,
    },
    {
      strategyId: "s22",
      name: "Anchor Follow Catch-Up",
      tier: "high",
      family: "cross_asset",
      description: "Follow lagging asset after peer impulse.",
      isComboEligible: false,
    },
    {
      strategyId: "s23",
      name: "BTC Trend Reversal Confirmation",
      tier: "high",
      family: "momentum",
      description: "BTC flips and followers start confirming the new side.",
      isComboEligible: true,
    },
    {
      strategyId: "s24",
      name: "Price Stretch Penalty",
      tier: "high",
      family: "risk",
      description: "Penalize late entries already too stretched for the TP target.",
      isComboEligible: true,
    },
  ];
}

function buildPredictionContext(): PredictionContext {
  return {
    marketKey: "sol:5m",
    asset: "sol",
    window: "5m",
    triggeredAt: 10_000,
    trigger: {
      marketKey: "sol:5m",
      asset: "sol",
      window: "5m",
      triggeredToken: "up",
      triggerType: "crossed_half",
      previousPrice: 0.49,
      currentPrice: 0.52,
      distanceToHalf: 0.02,
      triggeredAt: 10_000,
    },
    current: {
      asset: "sol",
      window: "5m",
      marketKey: "sol:5m",
      generatedAt: 10_000,
      slug: "sol-5m",
      marketStart: "2025-01-01T00:00:00.000Z",
      marketEnd: "2025-01-01T00:05:00.000Z",
      priceToBeat: 96,
      up: {
        price: 0.52,
        midpoint: 0.52,
        spread: 0.01,
        bestBid: 0.515,
        bestAsk: 0.525,
        depthTop: 120,
        imbalance: 0.42,
        distanceToHalf: 0.02,
        eventTs: 10_000,
        ageMs: 0,
      },
      down: {
        price: 0.48,
        midpoint: 0.48,
        spread: 0.01,
        bestBid: 0.475,
        bestAsk: 0.485,
        depthTop: 68,
        imbalance: -0.22,
        distanceToHalf: 0.02,
        eventTs: 10_000,
        ageMs: 0,
      },
      spotVenues: [
        { venue: "binance", price: 103.4, eventTs: 10_000, ageMs: 0, midpoint: 103.4, spread: 0.04, imbalance: 0.22 },
        { venue: "coinbase", price: 103.6, eventTs: 10_000, ageMs: 0, midpoint: 103.6, spread: 0.04, imbalance: 0.18 },
      ],
      spotConsensusPrice: 103.5,
      spotMomentum: 0.08,
      spotDispersion: 0.001,
      chainlinkPrice: 102.8,
      chainlinkAgeMs: 0,
      quality: {
        score: 0.92,
        hasLiveMarket: true,
        hasFreshTokens: true,
        hasFreshSpot: true,
        issues: [],
      },
    },
    previous: {
      asset: "sol",
      window: "5m",
      marketKey: "sol:5m",
      generatedAt: 9_000,
      slug: "sol-5m",
      marketStart: "2025-01-01T00:00:00.000Z",
      marketEnd: "2025-01-01T00:05:00.000Z",
      priceToBeat: 96,
      up: {
        price: 0.5,
        midpoint: 0.5,
        spread: 0.01,
        bestBid: 0.495,
        bestAsk: 0.505,
        depthTop: 84,
        imbalance: 0.2,
        distanceToHalf: 0,
        eventTs: 9_000,
        ageMs: 0,
      },
      down: {
        price: 0.5,
        midpoint: 0.5,
        spread: 0.01,
        bestBid: 0.495,
        bestAsk: 0.505,
        depthTop: 70,
        imbalance: -0.08,
        distanceToHalf: 0,
        eventTs: 9_000,
        ageMs: 0,
      },
      spotVenues: [
        { venue: "binance", price: 101.8, eventTs: 9_000, ageMs: 0, midpoint: 101.8, spread: 0.04, imbalance: 0.12 },
        { venue: "coinbase", price: 101.9, eventTs: 9_000, ageMs: 0, midpoint: 101.9, spread: 0.04, imbalance: 0.1 },
      ],
      spotConsensusPrice: 101.85,
      spotMomentum: 0.04,
      spotDispersion: 0.001,
      chainlinkPrice: 101.4,
      chainlinkAgeMs: 0,
      quality: {
        score: 0.92,
        hasLiveMarket: true,
        hasFreshTokens: true,
        hasFreshSpot: true,
        issues: [],
      },
    },
    history: [
      {
        generatedAt: 3_000,
        upMidpoint: 0.47,
        downMidpoint: 0.53,
        upPrice: 0.47,
        downPrice: 0.53,
        spotConsensusPrice: 98.7,
        priceToBeat: 96,
        qualityScore: 0.92,
      },
      {
        generatedAt: 4_000,
        upMidpoint: 0.48,
        downMidpoint: 0.52,
        upPrice: 0.48,
        downPrice: 0.52,
        spotConsensusPrice: 99.2,
        priceToBeat: 96,
        qualityScore: 0.92,
      },
      {
        generatedAt: 5_000,
        upMidpoint: 0.49,
        downMidpoint: 0.51,
        upPrice: 0.49,
        downPrice: 0.51,
        spotConsensusPrice: 99.8,
        priceToBeat: 96,
        qualityScore: 0.92,
      },
      { generatedAt: 6_000, upMidpoint: 0.5, downMidpoint: 0.5, upPrice: 0.5, downPrice: 0.5, spotConsensusPrice: 100.6, priceToBeat: 96, qualityScore: 0.92 },
      { generatedAt: 7_000, upMidpoint: 0.5, downMidpoint: 0.5, upPrice: 0.5, downPrice: 0.5, spotConsensusPrice: 101.1, priceToBeat: 96, qualityScore: 0.92 },
      {
        generatedAt: 8_000,
        upMidpoint: 0.51,
        downMidpoint: 0.49,
        upPrice: 0.51,
        downPrice: 0.49,
        spotConsensusPrice: 101.8,
        priceToBeat: 96,
        qualityScore: 0.92,
      },
      {
        generatedAt: 9_000,
        upMidpoint: 0.5,
        downMidpoint: 0.5,
        upPrice: 0.5,
        downPrice: 0.5,
        spotConsensusPrice: 101.85,
        priceToBeat: 96,
        qualityScore: 0.92,
      },
      {
        generatedAt: 10_000,
        upMidpoint: 0.52,
        downMidpoint: 0.48,
        upPrice: 0.52,
        downPrice: 0.48,
        spotConsensusPrice: 103.5,
        priceToBeat: 96,
        qualityScore: 0.92,
      },
    ],
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
      breadthStrength: 0.84,
      breadthParticipation: 1,
      followerParticipation: 1,
      averageSignedMove: 0.05,
      targetSignedMove: 0.02,
      peerAverageSignedMove: 0.06,
      lagRatio: 0.66,
      alignedMarketCount: 4,
      qualifyingMarketCount: 4,
      synchronyScore: 0.9,
      accelerationScore: 0.64,
      exhaustionScore: 0.18,
      reversalRiskScore: 0.14,
      isDirectional: true,
      isTradableGlobalContext: true,
      hasStrongBreadth: true,
    },
  };
}
