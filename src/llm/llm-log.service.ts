/**
 * @section imports:externals
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";

/**
 * @section imports:internals
 */

import config from "../config.ts";
import type { ExecutionTrade } from "../execution/execution.types.ts";
import logger from "../logger.ts";
import type { MarketKey } from "../market/market.types.ts";
import type { PredictionResponse } from "../prediction/prediction.types.ts";
import type {
  LlmComboSummary,
  LlmEvent,
  LlmMarketSummary,
  LlmOpportunityCreatedEvent,
  LlmOpportunityResolvedEvent,
  LlmRecentReference,
  LlmStrategySummary,
  LlmSummary,
  LlmTradeClosedEvent,
} from "./llm.types.ts";

/**
 * @section class
 */

export class LlmLogService {
  /**
   * @section private:attributes
   */

  private readonly logDirectory: string;
  private readonly eventFilePath: string;
  private readonly summaryFilePath: string;
  private summary: LlmSummary;

  /**
   * @section constructor
   */

  public constructor(logDirectory?: string) {
    this.logDirectory = logDirectory ?? config.LLM_LOG_DIRECTORY;
    this.eventFilePath = path.join(this.logDirectory, "llm-events.jsonl");
    this.summaryFilePath = path.join(this.logDirectory, "llm-summary.json");
    this.ensureStorage();
    this.summary = this.loadSummary();
    this.persistSummary();
  }

  /**
   * @section private:methods
   */

  private ensureStorage(): void {
    if (!existsSync(this.logDirectory)) {
      mkdirSync(this.logDirectory, { recursive: true });
    }
    if (!existsSync(this.eventFilePath)) {
      writeFileSync(this.eventFilePath, "", "utf8");
    }
    if (!existsSync(this.summaryFilePath)) {
      writeFileSync(this.summaryFilePath, `${JSON.stringify(this.buildEmptySummary(), null, 2)}\n`, "utf8");
    }
  }

  private buildEmptySummary(): LlmSummary {
    const emptySummary: LlmSummary = {
      counts: {
        opportunitiesCreated: 0,
        opportunitiesResolved: 0,
        wins: 0,
        losses: 0,
        tradesClosed: 0,
      },
      quality: {
        resolvedAccuracy: null,
        averageConfidence: null,
        averageWinConfidence: null,
        averageLossConfidence: null,
      },
      markets: {} as Record<MarketKey, LlmMarketSummary>,
      strategies: {},
      combos: {},
      executionBlockers: {},
      recentReferences: [],
      confidenceTotals: {
        resolved: 0,
        wins: 0,
        losses: 0,
      },
    };
    return emptySummary;
  }

  private loadSummary(): LlmSummary {
    let loadedSummary = this.buildEmptySummary();
    try {
      const rawSummary = readFileSync(this.summaryFilePath, "utf8");
      if (rawSummary.trim().length > 0) {
        const parsedSummary = JSON.parse(rawSummary) as Partial<LlmSummary>;
        loadedSummary = {
          ...loadedSummary,
          ...parsedSummary,
          counts: {
            ...loadedSummary.counts,
            ...(parsedSummary.counts ?? {}),
          },
          quality: {
            ...loadedSummary.quality,
            ...(parsedSummary.quality ?? {}),
          },
          confidenceTotals: {
            ...loadedSummary.confidenceTotals,
            ...(parsedSummary.confidenceTotals ?? {}),
          },
          markets: (parsedSummary.markets ?? {}) as Record<MarketKey, LlmMarketSummary>,
          strategies: parsedSummary.strategies ?? {},
          combos: parsedSummary.combos ?? {},
          executionBlockers: parsedSummary.executionBlockers ?? {},
          recentReferences: parsedSummary.recentReferences ?? [],
        };
      }
    } catch (error) {
      logger.error(`llm summary load failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    return loadedSummary;
  }

  private persistSummary(): void {
    writeFileSync(this.summaryFilePath, `${JSON.stringify(this.summary, null, 2)}\n`, "utf8");
  }

  private appendEvent(llmEvent: LlmEvent): void {
    appendFileSync(this.eventFilePath, `${JSON.stringify(llmEvent)}\n`, "utf8");
  }

  private updateRecentReferences(llmRecentReference: LlmRecentReference): void {
    this.summary.recentReferences.unshift(llmRecentReference);
    if (this.summary.recentReferences.length > config.LLM_PROMPT_RECENT_EVENT_LIMIT) {
      this.summary.recentReferences.splice(config.LLM_PROMPT_RECENT_EVENT_LIMIT);
    }
  }

  private requireMarketSummary(marketKey: MarketKey): LlmMarketSummary {
    let llmMarketSummary = this.summary.markets[marketKey];
    if (llmMarketSummary === undefined) {
      llmMarketSummary = {
        marketKey,
        opportunityCount: 0,
        resolvedCount: 0,
        winCount: 0,
        lossCount: 0,
        resolvedAccuracy: null,
        tradeCount: 0,
        cumulativePnl: 0,
      };
      this.summary.markets[marketKey] = llmMarketSummary;
    }
    return llmMarketSummary;
  }

  private requireComboSummary(comboKey: string): LlmComboSummary {
    let llmComboSummary = this.summary.combos[comboKey];
    if (llmComboSummary === undefined) {
      llmComboSummary = {
        comboKey,
        resolvedCount: 0,
        wins: 0,
        losses: 0,
        hitRate: null,
      };
      this.summary.combos[comboKey] = llmComboSummary;
    }
    return llmComboSummary;
  }

  private requireStrategySummary(strategyId: string, name: string, tier: PredictionResponse["strategyBreakdown"][number]["tier"]): LlmStrategySummary {
    let llmStrategySummary = this.summary.strategies[strategyId];
    if (llmStrategySummary === undefined) {
      llmStrategySummary = {
        strategyId,
        name,
        tier,
        appearances: 0,
        wins: 0,
        losses: 0,
        hitRate: null,
        averageWeight: null,
      };
      this.summary.strategies[strategyId] = llmStrategySummary;
    }
    return llmStrategySummary;
  }

  private resolveWindowPhase(predictionResponse: PredictionResponse): "opening" | "middle" | "late" | "final" {
    let windowPhase: "opening" | "middle" | "late" | "final" = "middle";
    const remainingMs = predictionResponse.barrierState.timeRemainingMs;
    if (remainingMs !== null && remainingMs <= config.BARRIER_FORCE_DECIDED_TIME_MS) {
      windowPhase = "final";
    } else {
      if (remainingMs !== null && remainingMs <= config.PREDICTION_HORIZON_MS) {
        windowPhase = "late";
      }
    }
    return windowPhase;
  }

  private resolveTargetSide(predictionResponse: PredictionResponse): "up" | "down" {
    const targetSide: "up" | "down" = predictionResponse.direction === "UP" ? "up" : "down";
    return targetSide;
  }

  private resolveReferencePrice(predictionResponse: PredictionResponse): number | null {
    const referencePrice = predictionResponse.barrierState.chainlinkPrice ?? predictionResponse.barrierState.spotConsensusPrice;
    return referencePrice;
  }

  private resolveBarrierDistanceRatio(predictionResponse: PredictionResponse): number | null {
    const barrierDistanceRatio = predictionResponse.barrierState.chainlinkDistanceRatio ?? predictionResponse.barrierState.spotDistanceRatio ?? null;
    return barrierDistanceRatio;
  }

  private computeContestabilityScore(predictionResponse: PredictionResponse): number {
    const barrierDistanceRatio = this.resolveBarrierDistanceRatio(predictionResponse);
    let contestabilityScore =
      barrierDistanceRatio === null ? 0.5 : Math.max(0, Math.min(1, 1 - barrierDistanceRatio / Math.max(config.BARRIER_DECIDED_RATIO, 0.000_001)));
    if (predictionResponse.barrierState.isNearBarrier) {
      contestabilityScore = Math.max(contestabilityScore, 0.85);
    }
    if (predictionResponse.barrierState.isEffectivelyDecided) {
      contestabilityScore = 0.05;
    }
    return contestabilityScore;
  }

  private computeTpBeforeSlScore(predictionResponse: PredictionResponse): number {
    const tpBeforeSlScore = Math.max(
      0,
      Math.min(
        1,
        predictionResponse.confidence * 0.6 + Math.abs(predictionResponse.weightedScore) * 0.2 + this.computeContestabilityScore(predictionResponse) * 0.2,
      ),
    );
    return tpBeforeSlScore;
  }

  private computeEntryQualityScore(predictionResponse: PredictionResponse): number {
    const entryQualityScore = Math.max(
      0,
      Math.min(1, predictionResponse.selectedCombo.marketQualityScore * 0.7 + predictionResponse.selectedCombo.affordabilityScore * 0.3),
    );
    return entryQualityScore;
  }

  private updateQuality(): void {
    const resolvedCount = this.summary.counts.opportunitiesResolved;
    const winCount = this.summary.counts.wins;
    const lossCount = this.summary.counts.losses;
    this.summary.quality.resolvedAccuracy = resolvedCount === 0 ? null : winCount / resolvedCount;
    this.summary.quality.averageConfidence = resolvedCount === 0 ? null : this.summary.confidenceTotals.resolved / resolvedCount;
    this.summary.quality.averageWinConfidence = winCount === 0 ? null : this.summary.confidenceTotals.wins / winCount;
    this.summary.quality.averageLossConfidence = lossCount === 0 ? null : this.summary.confidenceTotals.losses / lossCount;
  }

  private updateOpportunityCreatedSummary(llmEvent: LlmOpportunityCreatedEvent): void {
    this.summary.counts.opportunitiesCreated += 1;
    this.requireMarketSummary(llmEvent.marketKey).opportunityCount += 1;
    if (llmEvent.blockingReason !== null) {
      this.summary.executionBlockers[llmEvent.blockingReason] = (this.summary.executionBlockers[llmEvent.blockingReason] ?? 0) + 1;
    }
    this.updateRecentReferences({
      eventType: llmEvent.eventType,
      timestamp: llmEvent.timestamp,
      referenceId: llmEvent.opportunityId,
      marketKey: llmEvent.marketKey,
    });
  }

  private updateOpportunityResolvedSummary(llmEvent: LlmOpportunityResolvedEvent): void {
    const llmMarketSummary = this.requireMarketSummary(llmEvent.marketKey);
    const llmComboSummary = this.requireComboSummary(llmEvent.selectedComboKey);
    this.summary.counts.opportunitiesResolved += 1;
    llmMarketSummary.resolvedCount += 1;
    llmComboSummary.resolvedCount += 1;
    this.summary.confidenceTotals.resolved += llmEvent.tpBeforeSlScore;
    if (llmEvent.outcomeStatus === "ok") {
      this.summary.counts.wins += 1;
      this.summary.confidenceTotals.wins += llmEvent.tpBeforeSlScore;
      llmMarketSummary.winCount += 1;
      llmComboSummary.wins += 1;
    }
    if (llmEvent.outcomeStatus === "ko") {
      this.summary.counts.losses += 1;
      this.summary.confidenceTotals.losses += llmEvent.tpBeforeSlScore;
      llmMarketSummary.lossCount += 1;
      llmComboSummary.losses += 1;
    }
    llmMarketSummary.resolvedAccuracy = llmMarketSummary.resolvedCount === 0 ? null : llmMarketSummary.winCount / llmMarketSummary.resolvedCount;
    llmComboSummary.hitRate = llmComboSummary.resolvedCount === 0 ? null : llmComboSummary.wins / llmComboSummary.resolvedCount;
    for (const strategy of llmEvent.strategies) {
      const llmStrategySummary = this.requireStrategySummary(strategy.strategyId, strategy.name, strategy.tier);
      const previousAppearances = llmStrategySummary.appearances;
      const nextAppearances = previousAppearances + 1;
      llmStrategySummary.appearances = nextAppearances;
      llmStrategySummary.averageWeight =
        llmStrategySummary.averageWeight === null
          ? strategy.weight
          : (llmStrategySummary.averageWeight * previousAppearances + strategy.weight) / nextAppearances;
      if (llmEvent.outcomeStatus === "ok") {
        llmStrategySummary.wins += 1;
      }
      if (llmEvent.outcomeStatus === "ko") {
        llmStrategySummary.losses += 1;
      }
      llmStrategySummary.hitRate = nextAppearances === 0 ? null : llmStrategySummary.wins / nextAppearances;
    }
    this.updateQuality();
    this.updateRecentReferences({
      eventType: llmEvent.eventType,
      timestamp: llmEvent.timestamp,
      referenceId: llmEvent.opportunityId,
      marketKey: llmEvent.marketKey,
    });
  }

  private updateTradeClosedSummary(llmEvent: LlmTradeClosedEvent): void {
    const llmMarketSummary = this.requireMarketSummary(llmEvent.marketKey);
    this.summary.counts.tradesClosed += 1;
    llmMarketSummary.tradeCount += 1;
    llmMarketSummary.cumulativePnl += llmEvent.realizedPnlAfterCosts;
    this.updateRecentReferences({
      eventType: llmEvent.eventType,
      timestamp: llmEvent.timestamp,
      referenceId: llmEvent.positionId,
      marketKey: llmEvent.marketKey,
    });
  }

  private recordEvent(llmEvent: LlmEvent): void {
    try {
      this.appendEvent(llmEvent);
      if (llmEvent.eventType === "opportunity_created") {
        this.updateOpportunityCreatedSummary(llmEvent);
      }
      if (llmEvent.eventType === "opportunity_resolved") {
        this.updateOpportunityResolvedSummary(llmEvent);
      }
      if (llmEvent.eventType === "trade_closed") {
        this.updateTradeClosedSummary(llmEvent);
      }
      this.persistSummary();
    } catch (error) {
      logger.error(`llm event write failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * @section public:methods
   */

  public recordPredictionCreated(predictionResponse: PredictionResponse): void {
    const llmEvent: LlmOpportunityCreatedEvent = {
      eventType: "opportunity_created",
      timestamp: predictionResponse.timestamp,
      opportunityId: `${predictionResponse.marketKey}:${predictionResponse.timestamp}`,
      marketKey: predictionResponse.marketKey,
      asset: predictionResponse.asset,
      window: predictionResponse.window,
      triggerType: predictionResponse.trigger.triggerType,
      triggeredToken: predictionResponse.trigger.triggeredToken,
      targetSide: this.resolveTargetSide(predictionResponse),
      windowPhase: this.resolveWindowPhase(predictionResponse),
      remainingMs: predictionResponse.barrierState.timeRemainingMs,
      priceToBeat: predictionResponse.barrierState.priceToBeat,
      referencePrice: this.resolveReferencePrice(predictionResponse),
      barrierDistanceRatio: this.resolveBarrierDistanceRatio(predictionResponse),
      contestabilityScore: this.computeContestabilityScore(predictionResponse),
      tpBeforeSlScore: this.computeTpBeforeSlScore(predictionResponse),
      entryQualityScore: this.computeEntryQualityScore(predictionResponse),
      selectedComboKey: predictionResponse.selectedCombo.comboKey,
      selectedComboEdgeScore: predictionResponse.selectedCombo.comboScore,
      selectedStrategyIds: predictionResponse.selectedCombo.memberStrategyIds,
      marketQualityScore: predictionResponse.selectedCombo.marketQualityScore,
      anchorConflictReason: predictionResponse.executionBlockingReasons.includes("cross_asset_regime_conflict") ? "cross_asset_regime_conflict" : null,
      isExecutionEligible: predictionResponse.isExecutionEligible,
      blockingReason: predictionResponse.executionBlockingReasons[0] ?? null,
    };
    this.recordEvent(llmEvent);
  }

  public recordPredictionResolved(predictionResponse: PredictionResponse): void {
    const llmEvent: LlmOpportunityResolvedEvent = {
      eventType: "opportunity_resolved",
      timestamp: predictionResponse.result.resolvedAt ?? predictionResponse.timestamp,
      opportunityId: `${predictionResponse.marketKey}:${predictionResponse.timestamp}`,
      marketKey: predictionResponse.marketKey,
      targetSide: this.resolveTargetSide(predictionResponse),
      windowPhase: this.resolveWindowPhase(predictionResponse),
      remainingMs: predictionResponse.barrierState.timeRemainingMs,
      priceToBeat: predictionResponse.barrierState.priceToBeat,
      referencePrice: this.resolveReferencePrice(predictionResponse),
      barrierDistanceRatio: this.resolveBarrierDistanceRatio(predictionResponse),
      contestabilityScore: this.computeContestabilityScore(predictionResponse),
      tpBeforeSlScore: this.computeTpBeforeSlScore(predictionResponse),
      entryQualityScore: this.computeEntryQualityScore(predictionResponse),
      selectedComboKey: predictionResponse.selectedCombo.comboKey,
      selectedStrategyIds: predictionResponse.selectedCombo.memberStrategyIds,
      outcomeStatus: predictionResponse.result.status,
      outcomeReason: predictionResponse.result.reason,
      closeTokenPrice: predictionResponse.result.evaluationPrice,
      entryTokenPrice: predictionResponse.entryReferencePrice,
      wasExecuted: predictionResponse.wasExecuted,
      strategies: predictionResponse.strategyBreakdown.map((strategy) => {
        return {
          strategyId: strategy.strategyId,
          name: strategy.name,
          tier: strategy.tier,
          weight: strategy.weight,
        };
      }),
    };
    this.recordEvent(llmEvent);
  }

  public recordTradeClosed(executionTrade: ExecutionTrade): void {
    const llmEvent: LlmTradeClosedEvent = {
      eventType: "trade_closed",
      timestamp: executionTrade.exitFilledAt,
      positionId: executionTrade.positionId,
      marketKey: executionTrade.marketKey,
      asset: executionTrade.asset,
      window: executionTrade.window,
      positionSide: executionTrade.positionSide,
      entryStyle: executionTrade.entryExecutionStyle,
      exitStyle: executionTrade.exitExecutionStyle,
      exitReason: executionTrade.exitReason,
      holdTimeMs: executionTrade.holdTimeMs,
      realizedPnlAfterCosts: executionTrade.realizedPnlAfterCosts,
      hasTakerFallbackUsed: executionTrade.hasTakerFallbackUsed,
    };
    this.recordEvent(llmEvent);
  }

  public getEventFilePath(): string {
    const eventFilePath = this.eventFilePath;
    return eventFilePath;
  }

  public getSummaryFilePath(): string {
    const summaryFilePath = this.summaryFilePath;
    return summaryFilePath;
  }
}
