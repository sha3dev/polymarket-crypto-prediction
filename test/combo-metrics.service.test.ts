import * as assert from "node:assert/strict";
import { test } from "node:test";

import { ComboMetricsService } from "../src/combo/combo-metrics.service.ts";
import type { CrossAssetRegime, MarketKey, PredictionDirection } from "../src/market/market.types.ts";
import type { StrategySignal } from "../src/strategy/strategy.types.ts";

test("ComboMetricsService ignores strategies removed from combo search", () => {
  const comboMetricsService = new ComboMetricsService();
  const buildActiveComboCandidates = Reflect.get(comboMetricsService, "buildActiveComboCandidates") as
    | ((marketKey: MarketKey, strategySignals: StrategySignal[]) => Array<{ comboDefinition: { memberStrategyIds: string[] } }>)
    | undefined;

  if (!buildActiveComboCandidates) {
    throw new Error("expected combo candidate builder");
  }

  const activeComboCandidates = buildActiveComboCandidates.call(comboMetricsService, "btc:5m", [
    buildStrategySignal("s01", "momentum", 0.88, 0.92, 0.91, true),
    buildStrategySignal("s11", "momentum", 0.84, 0.9, 0.89, false),
    buildStrategySignal("s14", "pricing", 0.42, 0.74, 0.72, true),
  ]);

  const comboMembers = activeComboCandidates.flatMap((activeComboCandidate) => activeComboCandidate.comboDefinition.memberStrategyIds);

  assert.equal(comboMembers.includes("s11"), false);
  assert.equal(comboMembers.includes("s01"), true);
});

test("ComboMetricsService penalizes semantic overlap and keeps a usable combo score", () => {
  const comboMetricsService = new ComboMetricsService();
  const selectedStrategyCombo = comboMetricsService.selectBestComboForMarket({
    marketKey: "btc:5m",
    strategySignals: [
      buildStrategySignal("s01", "momentum", 0.92, 0.94, 0.95, true),
      buildStrategySignal("s09", "momentum", 0.91, 0.94, 0.94, true),
      buildStrategySignal("s14", "pricing", 0.75, 0.87, 0.84, true),
      buildStrategySignal("s16", "pricing", 0.72, 0.85, 0.83, true),
    ],
    crossAssetRegime: buildCrossAssetRegime("UP"),
    marketQualityScore: 0.58,
  });

  assert.notEqual(selectedStrategyCombo, null);
  assert.equal(selectedStrategyCombo?.comboKey === "s01+s09", false);
  assert.equal((selectedStrategyCombo?.semanticOverlapPenalty ?? 0) <= 0.12, true);
  assert.equal((selectedStrategyCombo?.comboScore ?? 0) > 0, true);
});

test("ComboMetricsService rejects pure continuation combos without a sanity-check member", () => {
  const comboMetricsService = new ComboMetricsService();
  const selectedStrategyCombo = comboMetricsService.selectBestComboForMarket({
    marketKey: "btc:5m",
    strategySignals: [
      buildStrategySignal("s01", "momentum", 0.88, 0.92, 0.91, true),
      buildStrategySignal("s09", "momentum", 0.86, 0.9, 0.9, true),
      buildStrategySignal("s02", "microstructure", 0.82, 0.89, 0.88, true),
      buildStrategySignal("s05", "microstructure", 0.78, 0.88, 0.86, true),
    ],
    crossAssetRegime: buildCrossAssetRegime("UP"),
    marketQualityScore: 0.9,
  });

  assert.equal(selectedStrategyCombo, null);
});

test("ComboMetricsService uses affordability to weaken late-entry combos", () => {
  const comboMetricsService = new ComboMetricsService();
  const buildCandidateFromMembers = Reflect.get(comboMetricsService, "buildCandidateFromMembers") as
    | ((marketKey: MarketKey, strategySignals: StrategySignal[]) => object)
    | undefined;
  const computeAffordabilityScore = Reflect.get(comboMetricsService, "computeAffordabilityScore") as
    | ((strategySignals: StrategySignal[]) => number)
    | undefined;

  if (!buildCandidateFromMembers || !computeAffordabilityScore) {
    throw new Error("expected affordability helpers");
  }

  buildCandidateFromMembers.call(comboMetricsService, "btc:5m", [buildStrategySignal("s14", "pricing", 0.78, 0.9, 0.88, true)]);
  const affordabilitySignals = [buildStrategySignal("s14", "pricing", 0.78, 0.9, 0.88, true, undefined, { normalizedAffordability: 0.08 })];
  const affordabilityScore = computeAffordabilityScore.call(comboMetricsService, affordabilitySignals);

  assert.equal(affordabilityScore < 0.2, true);
});

test("ComboMetricsService scores combos from replay across prior trigger moments", () => {
  const comboMetricsService = new ComboMetricsService();

  comboMetricsService.recordPredictionMoment(
    "btc:5m",
    "p-1",
    [
      buildStrategySignal("s01", "momentum", 0.84, 0.88, 0.9, true, "UP"),
      buildStrategySignal("s14", "pricing", 0.72, 0.86, 0.84, true, "UP"),
      buildStrategySignal("s18", "reversion", -0.3, 0.62, 0.5, true, "DOWN"),
    ],
    1_000,
  );
  comboMetricsService.resolvePredictionMoment("btc:5m", "p-1", "UP", 31_000);
  comboMetricsService.recordPredictionMoment(
    "btc:5m",
    "p-2",
    [
      buildStrategySignal("s01", "momentum", 0.82, 0.87, 0.88, true, "UP"),
      buildStrategySignal("s14", "pricing", 0.68, 0.84, 0.82, true, "UP"),
      buildStrategySignal("s02", "microstructure", 0.55, 0.72, 0.7, true, "UP"),
    ],
    2_000,
  );
  comboMetricsService.resolvePredictionMoment("btc:5m", "p-2", "UP", 32_000);

  const selectedStrategyCombo = comboMetricsService.selectBestComboForMarket({
    marketKey: "btc:5m",
    strategySignals: [
      buildStrategySignal("s01", "momentum", 0.86, 0.89, 0.91, true, "UP"),
      buildStrategySignal("s14", "pricing", 0.7, 0.86, 0.83, true, "UP"),
      buildStrategySignal("s02", "microstructure", 0.52, 0.7, 0.72, true, "UP"),
    ],
    crossAssetRegime: buildCrossAssetRegime("UP"),
    marketQualityScore: 0.8,
  });

  assert.notEqual(selectedStrategyCombo, null);
  assert.equal(selectedStrategyCombo?.comboKey, "s01+s14");
  assert.equal((selectedStrategyCombo?.sampleCount ?? 0) >= 2, true);
  assert.equal((selectedStrategyCombo?.comboScore ?? 0) > 0.2, true);
});

function buildStrategySignal(
  strategyId: string,
  family: StrategySignal["family"],
  score: number,
  confidence: number,
  snapshotUtility: number,
  isComboEligible: boolean,
  direction?: PredictionDirection,
  debug?: Record<string, number | string | boolean | null>,
): StrategySignal {
  const resolvedDirection = direction ?? (score >= 0 ? "UP" : "DOWN");
  return {
    strategyId,
    name: strategyId,
    tier: "medium",
    family,
    direction: resolvedDirection,
    score,
    confidence,
    weight: 1,
    snapshotUtility,
    qualityFactor: 1,
    didRun: true,
    didParticipate: true,
    isComboEligible,
    reason: null,
    debug: debug ?? {},
  };
}

function buildCrossAssetRegime(direction: PredictionDirection): CrossAssetRegime {
  return {
    regimeId: direction === "UP" ? "btc_eth_up" : "btc_eth_down",
    regimeClass: "aligned",
    breadthDirection: direction,
    btcDirection: direction,
    ethDirection: direction,
    btcUpTokenMomentum: direction === "UP" ? 0.03 : 0.005,
    btcDownTokenMomentum: direction === "DOWN" ? 0.03 : 0.005,
    ethUpTokenMomentum: direction === "UP" ? 0.025 : 0.004,
    ethDownTokenMomentum: direction === "DOWN" ? 0.025 : 0.004,
    hasBtcAnchor: true,
    hasEthAlignment: true,
    breadthStrength: 0.7,
    breadthParticipation: 1,
    followerParticipation: 0.5,
    averageSignedMove: direction === "UP" ? 0.02 : -0.02,
    targetSignedMove: direction === "UP" ? 0.015 : -0.015,
    peerAverageSignedMove: direction === "UP" ? 0.018 : -0.018,
    lagRatio: 0.35,
    alignedMarketCount: 2,
    qualifyingMarketCount: 2,
    synchronyScore: 1,
    accelerationScore: 0.45,
    exhaustionScore: 0.12,
    reversalRiskScore: 0.08,
    isDirectional: true,
    isTradableGlobalContext: true,
    hasStrongBreadth: true,
  };
}
