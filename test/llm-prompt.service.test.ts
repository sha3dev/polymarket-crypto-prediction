import * as assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import type { ExecutionTrade } from "../src/execution/execution.types.ts";
import { LlmLogService } from "../src/llm/llm-log.service.ts";
import { LlmPromptService } from "../src/llm/llm-prompt.service.ts";
import type { PredictionResponse } from "../src/prediction/prediction.types.ts";

test("LlmPromptService returns an empty-state prompt with task and repo context", () => {
  const llmDirectory = mkdtempSync(path.join(os.tmpdir(), "llm-prompt-empty-"));
  const llmLogService = new LlmLogService(llmDirectory);
  const llmPromptService = new LlmPromptService(
    llmLogService.getSummaryFilePath(),
    llmLogService.getEventFilePath(),
    "https://github.com/sha3dev/polymarket-crypto-prediction",
    "paper",
  );

  const prompt = llmPromptService.buildPrompt();

  assert.equal(prompt.includes("## Task Specification"), true);
  assert.equal(prompt.includes("Repository URL: https://github.com/sha3dev/polymarket-crypto-prediction"), true);
  assert.equal(prompt.includes("no runtime evidence yet"), true);

  rmSync(llmDirectory, { recursive: true, force: true });
});

test("LlmLogService appends prediction and trade events and updates the rolling summary", () => {
  const llmDirectory = mkdtempSync(path.join(os.tmpdir(), "llm-prompt-summary-"));
  const llmLogService = new LlmLogService(llmDirectory);

  llmLogService.recordPredictionCreated(buildPredictionResponse({ resultStatus: "pending" }));
  llmLogService.recordPredictionResolved(buildPredictionResponse({ resultStatus: "ok", resolvedAt: 1_030, wasExecuted: true }));
  llmLogService.recordTradeClosed(buildExecutionTrade());

  const eventLines = readFileSync(llmLogService.getEventFilePath(), "utf8")
    .trim()
    .split("\n")
    .filter((line) => line.length > 0);
  const summary = JSON.parse(readFileSync(llmLogService.getSummaryFilePath(), "utf8")) as {
    counts: {
      predictionsCreated: number;
      predictionsResolved: number;
      wins: number;
      tradesClosed: number;
    };
    quality: {
      resolvedAccuracy: number | null;
    };
    markets: Record<string, { predictionCount: number; tradeCount: number; cumulativePnl: number }>;
    combos: Record<string, { resolvedCount: number; hitRate: number | null }>;
  };

  assert.equal(eventLines.length, 3);
  assert.equal(summary.counts.predictionsCreated, 1);
  assert.equal(summary.counts.predictionsResolved, 1);
  assert.equal(summary.counts.wins, 1);
  assert.equal(summary.counts.tradesClosed, 1);
  assert.equal(summary.quality.resolvedAccuracy, 1);
  assert.equal(summary.markets["btc:5m"]?.predictionCount, 1);
  assert.equal(summary.markets["btc:5m"]?.tradeCount, 1);
  assert.equal(summary.markets["btc:5m"]?.cumulativePnl, 0.18);
  assert.equal(summary.combos["combo-alpha"]?.resolvedCount, 1);
  assert.equal(summary.combos["combo-alpha"]?.hitRate, 1);

  rmSync(llmDirectory, { recursive: true, force: true });
});

test("LlmPromptService keeps the prompt under the configured character cap", () => {
  const llmDirectory = mkdtempSync(path.join(os.tmpdir(), "llm-prompt-cap-"));
  const summaryFilePath = path.join(llmDirectory, "llm-summary.json");
  const eventFilePath = path.join(llmDirectory, "llm-events.jsonl");
  const longComboKey = `combo-${"x".repeat(2_000)}`;
  const longStrategyId = `s99-${"y".repeat(1_000)}`;
  const summary = {
    counts: {
      predictionsCreated: 99,
      predictionsResolved: 80,
      wins: 45,
      losses: 35,
      tradesClosed: 40,
    },
    quality: {
      resolvedAccuracy: 0.5625,
      averageConfidence: 0.71,
      averageWinConfidence: 0.76,
      averageLossConfidence: 0.64,
    },
    markets: {
      "btc:5m": {
        marketKey: "btc:5m",
        predictionCount: 99,
        resolvedCount: 80,
        winCount: 45,
        lossCount: 35,
        resolvedAccuracy: 0.5625,
        tradeCount: 40,
        cumulativePnl: 12.345,
      },
    },
    strategies: {
      [longStrategyId]: {
        strategyId: longStrategyId,
        name: "Long Strategy Name",
        tier: "high",
        appearances: 80,
        wins: 45,
        losses: 35,
        hitRate: 0.5625,
        averageWeight: 0.72,
      },
    },
    combos: {
      [longComboKey]: {
        comboKey: longComboKey,
        resolvedCount: 80,
        wins: 45,
        losses: 35,
        hitRate: 0.5625,
      },
    },
    executionBlockers: {
      [`reason-${"z".repeat(2_000)}`]: 12,
    },
    recentReferences: [],
    confidenceTotals: {
      resolved: 56.8,
      wins: 34.2,
      losses: 22.6,
    },
  };
  const eventLines = Array.from({ length: 30 }, (_, index) => {
    return JSON.stringify({
      eventType: "prediction_resolved",
      timestamp: 1_000 + index,
      predictionId: `btc:5m:${index}`,
      marketKey: "btc:5m",
      direction: "UP",
      confidence: 0.75,
      selectedComboKey: longComboKey,
      selectedStrategyIds: [longStrategyId],
      outcomeStatus: "ok",
      outcomeReason: "take_profit_hit",
      resolvedDirection: "UP",
      evaluationPrice: 0.61,
      baselinePrice: 0.51,
      wasExecuted: true,
      strategies: [{ strategyId: longStrategyId, name: "Long Strategy Name", tier: "high", weight: 0.8 }],
    });
  }).join("\n");

  writeFileSync(summaryFilePath, JSON.stringify(summary, null, 2), "utf8");
  writeFileSync(eventFilePath, `${eventLines}\n`, "utf8");

  const llmPromptService = new LlmPromptService(summaryFilePath, eventFilePath, "https://github.com/sha3dev/polymarket-crypto-prediction", "paper");
  const prompt = llmPromptService.buildPrompt();

  assert.equal(prompt.length <= 12_000, true);
  assert.equal(prompt.includes("## Task Specification"), true);
  assert.equal(prompt.includes("## Repository Context"), true);

  rmSync(llmDirectory, { recursive: true, force: true });
});

type PredictionResponseOptions = {
  resultStatus: PredictionResponse["result"]["status"];
  resolvedAt?: number;
  wasExecuted?: boolean;
};

function buildPredictionResponse(predictionResponseOptions: PredictionResponseOptions): PredictionResponse {
  return {
    asset: "btc",
    window: "5m",
    marketKey: "btc:5m",
    direction: "UP",
    confidence: 0.74,
    weightedScore: 0.66,
    baseWeightedScore: 0.62,
    adjustedWeightedScore: 0.66,
    baseConfidence: 0.7,
    adjustedConfidence: 0.74,
    timestamp: 1_000,
    trigger: {
      marketKey: "btc:5m",
      asset: "btc",
      window: "5m",
      triggeredToken: "up",
      triggerType: "crossed_half",
      previousPrice: 0.49,
      currentPrice: 0.51,
      distanceToHalf: 0.01,
      triggeredAt: 990,
    },
    evaluationDueAt: 31_000,
    positionSide: "up",
    entryReferencePrice: 0.51,
    takeProfitPrice: 0.63,
    stopLossPrice: 0.43,
    isResolved: predictionResponseOptions.resultStatus !== "pending",
    comboGate: {
      hasComboGatePassed: true,
      selectedComboKey: "combo-alpha",
      selectedComboSize: 2,
      selectedComboSource: "research",
      effectiveComboScore: 0.66,
      gateReason: null,
    },
    crossAssetRegime: {
      regimeId: "btc_up",
      regimeClass: "anchor",
      breadthDirection: "UP",
      btcDirection: "UP",
      ethDirection: "UP",
      btcUpTokenMomentum: 0.1,
      btcDownTokenMomentum: -0.1,
      ethUpTokenMomentum: 0.05,
      ethDownTokenMomentum: -0.05,
      hasBtcAnchor: true,
      hasEthAlignment: true,
      breadthStrength: 0.7,
      breadthParticipation: 1,
      followerParticipation: 0.5,
      averageSignedMove: 0.03,
      targetSignedMove: 0.05,
      peerAverageSignedMove: 0.02,
      lagRatio: 0.1,
      alignedMarketCount: 2,
      qualifyingMarketCount: 2,
      synchronyScore: 0.8,
      accelerationScore: 0.4,
      exhaustionScore: 0.1,
      reversalRiskScore: 0.1,
      isDirectional: true,
      isTradableGlobalContext: true,
      hasStrongBreadth: true,
    },
    isExecutionEligible: false,
    executionBlockingReasons: ["market_warming_up"],
    wasExecuted: predictionResponseOptions.wasExecuted ?? false,
    executionComboSource: "research",
    result: {
      status: predictionResponseOptions.resultStatus,
      resolvedAt: predictionResponseOptions.resolvedAt ?? null,
      resolvedDirection: predictionResponseOptions.resultStatus === "ok" ? "UP" : null,
      evaluationPrice: predictionResponseOptions.resultStatus === "pending" ? null : 0.61,
      baselinePrice: 0.51,
      isFallbackPriceUsed: false,
      reason: predictionResponseOptions.resultStatus === "ok" ? "take_profit_hit" : null,
    },
    strategyBreakdown: [
      {
        strategyId: "s01",
        name: "Momentum EWMA",
        tier: "low",
        family: "momentum",
        direction: "UP",
        score: 0.5,
        confidence: 0.7,
        weight: 0.8,
        snapshotUtility: 0.6,
        qualityFactor: 0.9,
        didRun: true,
        didParticipate: true,
        isComboEligible: true,
        reason: "positive drift",
        debug: {},
      },
    ],
    selectedCombo: {
      comboKey: "combo-alpha",
      marketKey: "btc:5m",
      memberStrategyIds: ["s01", "s02"],
      size: 2,
      direction: "UP",
      comboScore: 0.66,
      agreementScore: 0.7,
      historicalHitRate: 0.6,
      historicalPnlProxy: 0.2,
      sampleCount: 10,
      drawdownProxy: 0.1,
      diversityScore: 0.4,
      familyRedundancyPenalty: 0.1,
      semanticOverlapPenalty: 0.05,
      anchorFitScore: 0.7,
      marketQualityScore: 0.88,
      affordabilityScore: 0.55,
      selectionReason: "test combo",
      isResearchEligible: true,
      isExecutionEligible: false,
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

function buildExecutionTrade(): ExecutionTrade {
  return {
    positionId: "trade-1",
    marketKey: "btc:5m",
    asset: "btc",
    window: "5m",
    positionSide: "up",
    shareCount: 10,
    entryExecutionStyle: "maker",
    exitExecutionStyle: "taker",
    entryNotionalUsd: 5.1,
    exitNotionalUsd: 6.2,
    entryFillPrice: 0.51,
    exitFillPrice: 0.62,
    entryFilledAt: 1_000,
    exitFilledAt: 1_030,
    exitReason: "take_profit_hit",
    realizedPnlTokenPrice: 0.2,
    realizedPnlAfterCosts: 0.18,
    holdTimeMs: 30,
    hasTakerFallbackUsed: false,
  };
}
