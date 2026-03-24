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

function buildStrategyDefinitions(): StrategyDefinition[] {
  return [
    { strategyId: "s01", name: "Momentum EWMA", tier: "low", description: "Short drift continuation." },
    { strategyId: "s02", name: "Token Microprice", tier: "low", description: "Top-of-book pressure." },
    { strategyId: "s03", name: "Token Imbalance Band", tier: "medium", description: "Multi-level depth skew." },
    { strategyId: "s04", name: "Wall Proximity", tier: "medium", description: "Liquidity barrier bias." },
    { strategyId: "s05", name: "Order Book Churn", tier: "medium", description: "Book rotation pressure." },
    { strategyId: "s06", name: "No-Arb Consistency", tier: "low", description: "UP and DOWN consistency." },
    { strategyId: "s07", name: "Spread Compression", tier: "low", description: "Liquidity improvement momentum." },
    { strategyId: "s08", name: "Barrier Timing", tier: "low", description: "Price-to-beat barrier." },
    { strategyId: "s09", name: "Spot Consensus Momentum", tier: "low", description: "Cross-venue spot drift." },
    { strategyId: "s10", name: "Spot Micropressure", tier: "medium", description: "Spot top-of-book skew." },
    { strategyId: "s11", name: "Spot Dispersion", tier: "medium", description: "Noise versus confirmation." },
    { strategyId: "s12", name: "Volatility Breakout", tier: "medium", description: "Regime breakout." },
    { strategyId: "s13", name: "Spot Slippage Skew", tier: "medium", description: "Book slope asymmetry." },
    { strategyId: "s14", name: "Chainlink Basis", tier: "low", description: "Oracle catch-up." },
    { strategyId: "s15", name: "Theoretical Probability Gap", tier: "medium", description: "Token versus barrier." },
    { strategyId: "s16", name: "Freshness Gap", tier: "low", description: "Spot leads stale token." },
    { strategyId: "s17", name: "Regime Switch", tier: "medium", description: "Time plus liquidity regime." },
    { strategyId: "s18", name: "Liquidity Shock Fade", tier: "medium", description: "Short mean reversion." },
    { strategyId: "s19", name: "Recent Performance Hedge", tier: "high", description: "Meta performance hedge." },
    { strategyId: "s20", name: "Online Logistic Blend", tier: "high", description: "Feature-weighted blend." },
    { strategyId: "s21", name: "Cross-Asset Breadth Impulse", tier: "medium", description: "Market-wide breadth confirmation, not primary conviction." },
    { strategyId: "s22", name: "Leader-Laggard Catch-Up", tier: "high", description: "Follow lagging asset after peer impulse." },
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
      regimeId: "broad_up_strong",
      regimeClass: "directional",
      breadthDirection: "UP",
      btcDirection: "UP",
      ethDirection: "UP",
      btcUpTokenMomentum: 0.02,
      btcDownTokenMomentum: 0.02,
      ethUpTokenMomentum: 0.02,
      ethDownTokenMomentum: 0.02,
      anchorAsset: "btc",
      anchorDirection: "UP",
      breadthStrength: 0.84,
      breadthParticipation: 1,
      averageSignedMove: 0.05,
      targetSignedMove: 0.02,
      peerAverageSignedMove: 0.06,
      lagRatio: 0.66,
      alignedMarketCount: 4,
      qualifyingMarketCount: 4,
      leaderMarketKey: "btc:5m",
      leaderGroup: ["btc:5m", "eth:5m"],
      laggardGroup: ["sol:5m", "xrp:5m"],
      synchronyScore: 0.9,
      accelerationScore: 0.64,
      exhaustionScore: 0.18,
      reversalRiskScore: 0.14,
      isDirectional: true,
      isTradableGlobalContext: true,
      hasStrongBreadth: true,
      hasLeaderLaggardOpportunity: true,
    },
  };
}
