import * as assert from "node:assert/strict";
import { test } from "node:test";

import { StrategyMetricsService } from "../src/strategy/strategy-metrics.service.ts";
import type { StrategyDefinition, StrategySignal } from "../src/strategy/strategy.types.ts";

test("StrategyMetricsService only counts outcomes inside the rolling time window", () => {
  const strategyDefinitions: StrategyDefinition[] = [{ strategyId: "s01", name: "Momentum EWMA", tier: "low", description: "Short drift continuation." }];
  const strategyMetricsService = new StrategyMetricsService(strategyDefinitions);
  const staleSignal: StrategySignal = {
    strategyId: "s01",
    name: "Momentum EWMA",
    tier: "low",
    direction: "UP",
    score: 0.9,
    confidence: 0.9,
    weight: 1,
    qualityFactor: 1,
    didRun: true,
    didParticipate: true,
    reason: null,
    debug: {},
  };
  const freshSignal: StrategySignal = {
    strategyId: "s01",
    name: "Momentum EWMA",
    tier: "low",
    direction: "DOWN",
    score: -0.8,
    confidence: 0.8,
    weight: 1,
    qualityFactor: 1,
    didRun: true,
    didParticipate: true,
    reason: null,
    debug: {},
  };

  strategyMetricsService.recordResolution("btc:5m", [staleSignal], "DOWN", 0, "research");
  strategyMetricsService.recordResolution("btc:5m", [freshSignal], "DOWN", 7_500_000, "research");

  const marketSummary = strategyMetricsService.getSummaries("btc:5m")[0];

  assert.equal(marketSummary?.totalResolved, 1);
  assert.equal(marketSummary?.wins, 1);
  assert.equal(marketSummary?.losses, 0);
  assert.equal(marketSummary?.hitRate, 1);
});
