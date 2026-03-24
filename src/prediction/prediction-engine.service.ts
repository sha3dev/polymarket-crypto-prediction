/**
 * @section imports:internals
 */

import { randomUUID } from "node:crypto";
import type { ComboMetricsService } from "../combo/combo-metrics.service.ts";
import type { ComboSummary, MarketComboBoard } from "../combo/combo.types.ts";
import config from "../config.ts";
import type { ComboSource, PositionSide, TradeExitReason } from "../execution/execution.types.ts";
import type { MarketStateService } from "../market/market-state.service.ts";
import type { AssetSymbol, MarketKey, MarketSnapshotSlice, MarketTrigger, MarketWindow, PredictionDirection } from "../market/market.types.ts";
import type { StrategyEngineService } from "../strategy/strategy-engine.service.ts";
import type { StrategyMetricsService } from "../strategy/strategy-metrics.service.ts";
import type { StrategySummary } from "../strategy/strategy.types.ts";
import type { PredictionStoreService } from "./prediction-store.service.ts";
import type { PredictionOutcome, PredictionRecord, PredictionResponse } from "./prediction.types.ts";

/**
 * @section class
 */

export class PredictionEngineService {
  /**
   * @section private:attributes
   */

  private readonly marketStateService: MarketStateService;
  private readonly strategyEngineService: StrategyEngineService;
  private readonly strategyMetricsService: StrategyMetricsService;
  private readonly predictionStoreService: PredictionStoreService;
  private readonly comboMetricsService: ComboMetricsService;

  /**
   * @section constructor
   */

  public constructor(
    marketStateService: MarketStateService,
    strategyEngineService: StrategyEngineService,
    strategyMetricsService: StrategyMetricsService,
    predictionStoreService: PredictionStoreService,
    comboMetricsService: ComboMetricsService,
  ) {
    this.marketStateService = marketStateService;
    this.strategyEngineService = strategyEngineService;
    this.strategyMetricsService = strategyMetricsService;
    this.predictionStoreService = predictionStoreService;
    this.comboMetricsService = comboMetricsService;
  }

  /**
   * @section private:methods
   */

  private resolvePositionSide(direction: PredictionDirection): PositionSide {
    const positionSide: PositionSide = direction === "UP" ? "up" : "down";
    return positionSide;
  }

  private resolveEntryReferencePrice(marketSlice: MarketSnapshotSlice | null, positionSide: PositionSide): number | null {
    const entryReferencePrice =
      marketSlice === null
        ? null
        : positionSide === "up"
          ? (marketSlice.up.midpoint ?? marketSlice.up.price)
          : (marketSlice.down.midpoint ?? marketSlice.down.price);
    return entryReferencePrice;
  }

  private clampTokenPrice(rawPrice: number): number {
    const clampedPrice = Math.max(0.01, Math.min(0.99, rawPrice));
    return clampedPrice;
  }

  private resolveResearchOutcome(
    predictionRecord: PredictionRecord,
    marketSlice: MarketSnapshotSlice | null,
  ): { status: PredictionOutcome["status"]; resolvedDirection: PredictionDirection | null; evaluationPrice: number | null; resolvedAt: number | null } | null {
    const liveTokenPrice =
      marketSlice === null
        ? null
        : predictionRecord.positionSide === "up"
          ? (marketSlice.up.midpoint ?? marketSlice.up.price)
          : (marketSlice.down.midpoint ?? marketSlice.down.price);
    let researchOutcome: {
      status: PredictionOutcome["status"];
      resolvedDirection: PredictionDirection | null;
      evaluationPrice: number | null;
      resolvedAt: number | null;
    } | null = null;
    if (liveTokenPrice !== null && predictionRecord.takeProfitPrice !== null && liveTokenPrice >= predictionRecord.takeProfitPrice) {
      researchOutcome = {
        status: "ok",
        resolvedDirection: predictionRecord.direction,
        evaluationPrice: liveTokenPrice,
        resolvedAt: marketSlice?.generatedAt ?? null,
      };
    }
    if (liveTokenPrice !== null && predictionRecord.stopLossPrice !== null && liveTokenPrice <= predictionRecord.stopLossPrice) {
      researchOutcome = {
        status: "ko",
        resolvedDirection: predictionRecord.direction === "UP" ? "DOWN" : "UP",
        evaluationPrice: liveTokenPrice,
        resolvedAt: marketSlice?.generatedAt ?? null,
      };
    }
    return researchOutcome;
  }

  private maybeResolveResearchPredictions(): void {
    const openPredictions = this.predictionStoreService.getOpenPredictions();
    for (const predictionRecord of openPredictions) {
      const marketSlice = this.marketStateService.getLatestSlice(predictionRecord.marketKey);
      const researchOutcome = this.resolveResearchOutcome(predictionRecord, marketSlice);
      if (researchOutcome !== null) {
        predictionRecord.isResolved = true;
        predictionRecord.outcome = {
          status: researchOutcome.status,
          resolvedAt: researchOutcome.resolvedAt,
          resolvedDirection: researchOutcome.resolvedDirection,
          evaluationPrice: researchOutcome.evaluationPrice,
          baselinePrice: predictionRecord.entryReferencePrice,
          isFallbackPriceUsed: false,
          reason: researchOutcome.status === "ok" ? "take_profit_hit" : "stop_loss_hit",
        };
        this.strategyMetricsService.recordResolution(
          predictionRecord.marketKey,
          predictionRecord.strategyBreakdown,
          researchOutcome.resolvedDirection,
          researchOutcome.resolvedAt,
          "research",
        );
        this.comboMetricsService.recordResolution(
          predictionRecord.marketKey,
          predictionRecord.predictionId,
          predictionRecord.comboBreakdown.activeCombos,
          predictionRecord.strategyBreakdown,
          this.strategyMetricsService.getSummaries(predictionRecord.marketKey),
          researchOutcome.resolvedDirection,
          researchOutcome.resolvedAt,
          "research",
        );
      }
    }
  }

  private maybeCreatePrediction(marketTrigger: MarketTrigger): void {
    const lastPredictionTimestamp = this.marketStateService.getLastPredictionTimestamp(marketTrigger.marketKey);
    const isCoolingDown = lastPredictionTimestamp !== null && marketTrigger.triggeredAt - lastPredictionTimestamp < config.MARKET_COOLDOWN_MS;
    if (!isCoolingDown) {
      const predictionContext = this.marketStateService.getPredictionContext(marketTrigger.marketKey);
      if (predictionContext) {
        const evaluationResult = this.strategyEngineService.evaluate(predictionContext);
        const strategySummaries = this.strategyMetricsService.getSummaries(predictionContext.marketKey);
        const comboApplicationResult = this.comboMetricsService.applyComboEffects(
          predictionContext.marketKey,
          evaluationResult.strategyBreakdown,
          strategySummaries,
          evaluationResult.baseWeightedScore,
          evaluationResult.baseConfidence,
        );
        const adjustedWeightedScore = comboApplicationResult.adjustedWeightedScore;
        const adjustedConfidence = comboApplicationResult.adjustedConfidence;
        const adjustedDirection = adjustedWeightedScore >= 0 ? "UP" : "DOWN";
        const positionSide = this.resolvePositionSide(adjustedDirection);
        const baselineSlice = this.marketStateService.getLatestSlice(marketTrigger.marketKey);
        const entryReferencePrice = this.resolveEntryReferencePrice(baselineSlice, positionSide);
        const takeProfitPrice = entryReferencePrice === null ? null : this.clampTokenPrice(entryReferencePrice + config.TAKE_PROFIT_DELTA);
        const stopLossPrice = entryReferencePrice === null ? null : this.clampTokenPrice(entryReferencePrice - config.STOP_LOSS_DELTA);
        const predictionRecord = this.buildPredictionRecord(
          marketTrigger.marketKey,
          adjustedDirection,
          adjustedConfidence,
          adjustedWeightedScore,
          evaluationResult.baseWeightedScore,
          evaluationResult.baseConfidence,
          marketTrigger,
          evaluationResult.strategyBreakdown,
          comboApplicationResult.comboBreakdown,
          comboApplicationResult.comboGate,
          positionSide,
          entryReferencePrice,
          takeProfitPrice,
          stopLossPrice,
          baselineSlice?.up.price ?? null,
          baselineSlice?.up.midpoint ?? null,
        );
        this.predictionStoreService.addPrediction(predictionRecord);
        this.marketStateService.markPredictionCreated(marketTrigger.marketKey, marketTrigger.triggeredAt);
        this.strategyMetricsService.markParticipated(predictionRecord.marketKey, evaluationResult.strategyBreakdown, predictionRecord.createdAt);
      }
    }
  }

  private buildPredictionRecord(
    marketKey: MarketKey,
    direction: PredictionDirection,
    confidence: number,
    weightedScore: number,
    baseWeightedScore: number,
    baseConfidence: number,
    marketTrigger: MarketTrigger,
    strategyBreakdown: PredictionRecord["strategyBreakdown"],
    comboBreakdown: PredictionRecord["comboBreakdown"],
    comboGate: PredictionRecord["comboGate"],
    positionSide: PositionSide,
    entryReferencePrice: number | null,
    takeProfitPrice: number | null,
    stopLossPrice: number | null,
    baselineUpPrice: number | null,
    baselineUpMidpoint: number | null,
  ): PredictionRecord {
    return {
      predictionId: randomUUID(),
      asset: marketTrigger.asset,
      window: marketTrigger.window,
      marketKey,
      direction,
      confidence,
      weightedScore,
      baseWeightedScore,
      adjustedWeightedScore: weightedScore,
      baseConfidence,
      adjustedConfidence: confidence,
      trigger: marketTrigger,
      createdAt: marketTrigger.triggeredAt,
      evaluationDueAt: marketTrigger.triggeredAt + config.PREDICTION_HORIZON_MS,
      positionSide,
      entryReferencePrice,
      takeProfitPrice,
      stopLossPrice,
      baselineUpPrice,
      baselineUpMidpoint,
      strategyBreakdown,
      comboBreakdown,
      comboGate,
      isExecutionEligible: false,
      executionGateFailures: [],
      wasExecuted: false,
      executionComboSource: comboGate.selectedComboSource,
      isResolved: false,
      outcome: {
        status: "pending",
        resolvedAt: null,
        resolvedDirection: null,
        evaluationPrice: null,
        baselinePrice: entryReferencePrice,
        isFallbackPriceUsed: false,
        reason: null,
      },
    };
  }

  private buildTradeOutcome(
    predictedDirection: PredictionDirection,
    exitReason: TradeExitReason,
    baselinePrice: number | null,
    evaluationPrice: number | null,
    resolvedAt: number,
  ): PredictionOutcome {
    const resolvedDirection = exitReason === "take_profit_hit" ? predictedDirection : predictedDirection === "UP" ? "DOWN" : "UP";
    const outcome: PredictionOutcome = {
      status: exitReason === "take_profit_hit" ? "ok" : "ko",
      resolvedAt,
      resolvedDirection,
      evaluationPrice,
      baselinePrice,
      isFallbackPriceUsed: false,
      reason: exitReason,
    };
    return outcome;
  }

  private buildPredictionResponse(predictionRecord: PredictionRecord): PredictionResponse {
    return {
      asset: predictionRecord.asset,
      window: predictionRecord.window,
      marketKey: predictionRecord.marketKey,
      direction: predictionRecord.direction,
      confidence: predictionRecord.confidence,
      weightedScore: predictionRecord.weightedScore,
      baseWeightedScore: predictionRecord.baseWeightedScore,
      adjustedWeightedScore: predictionRecord.adjustedWeightedScore,
      baseConfidence: predictionRecord.baseConfidence,
      adjustedConfidence: predictionRecord.adjustedConfidence,
      timestamp: predictionRecord.createdAt,
      trigger: predictionRecord.trigger,
      evaluationDueAt: predictionRecord.evaluationDueAt,
      positionSide: predictionRecord.positionSide,
      entryReferencePrice: predictionRecord.entryReferencePrice,
      takeProfitPrice: predictionRecord.takeProfitPrice,
      stopLossPrice: predictionRecord.stopLossPrice,
      isResolved: predictionRecord.isResolved,
      comboGate: predictionRecord.comboGate,
      isExecutionEligible: predictionRecord.isExecutionEligible,
      executionGateFailures: predictionRecord.executionGateFailures,
      wasExecuted: predictionRecord.wasExecuted,
      executionComboSource: predictionRecord.executionComboSource,
      result: predictionRecord.outcome,
      strategyBreakdown: predictionRecord.strategyBreakdown,
      comboBreakdown: predictionRecord.comboBreakdown,
    };
  }

  /**
   * @section public:methods
   */

  public handleSnapshot(_generatedAt: number, triggeredMarkets: MarketTrigger[]): void {
    this.maybeResolveResearchPredictions();
    for (const marketTrigger of triggeredMarkets) {
      this.maybeCreatePrediction(marketTrigger);
    }
  }

  public markExecutionEligibility(
    marketKey: MarketKey,
    predictionTimestamp: number,
    isExecutionEligible: boolean,
    gateFailures: string[],
    executionComboSource: ComboSource | null,
  ): void {
    const predictionRecord = this.predictionStoreService.getPrediction(marketKey, predictionTimestamp);
    if (predictionRecord !== null) {
      predictionRecord.isExecutionEligible = isExecutionEligible;
      predictionRecord.executionGateFailures = [...gateFailures];
      predictionRecord.executionComboSource = executionComboSource;
    }
  }

  public markPredictionExecuted(marketKey: MarketKey, predictionTimestamp: number): void {
    const predictionRecord = this.predictionStoreService.getPrediction(marketKey, predictionTimestamp);
    if (predictionRecord !== null) {
      predictionRecord.wasExecuted = true;
    }
  }

  public resolvePredictionFromTrade(
    marketKey: MarketKey,
    predictionTimestamp: number,
    exitReason: TradeExitReason,
    exitFillPrice: number,
    resolvedAt: number,
  ): void {
    const predictionRecord = this.predictionStoreService.getPrediction(marketKey, predictionTimestamp);
    if (predictionRecord !== null) {
      const outcome = this.buildTradeOutcome(predictionRecord.direction, exitReason, predictionRecord.entryReferencePrice, exitFillPrice, resolvedAt);
      this.strategyMetricsService.recordResolution(
        predictionRecord.marketKey,
        predictionRecord.strategyBreakdown,
        outcome.resolvedDirection,
        resolvedAt,
        "execution",
      );
      this.comboMetricsService.recordResolution(
        predictionRecord.marketKey,
        predictionRecord.predictionId,
        predictionRecord.comboBreakdown.activeCombos,
        predictionRecord.strategyBreakdown,
        this.strategyMetricsService.getSummaries(predictionRecord.marketKey),
        outcome.resolvedDirection,
        resolvedAt,
        "execution",
      );
      if (!predictionRecord.isResolved) {
        predictionRecord.isResolved = true;
        predictionRecord.outcome = outcome;
      }
    }
  }

  public getLatestPrediction(asset: AssetSymbol, window: MarketWindow): PredictionResponse | null {
    const predictionRecord = this.predictionStoreService.getLatestPrediction(`${asset}:${window}`);
    const predictionResponse = predictionRecord === null ? null : this.buildPredictionResponse(predictionRecord);
    return predictionResponse;
  }

  public getPredictions(asset: AssetSymbol, window: MarketWindow, limit: number): PredictionResponse[] {
    const predictionResponses = this.predictionStoreService
      .getPredictions(`${asset}:${window}`, limit)
      .map((predictionRecord) => this.buildPredictionResponse(predictionRecord));
    return predictionResponses;
  }

  public getRecentPredictions(limit: number): PredictionResponse[] {
    const predictionResponses = this.predictionStoreService
      .getRecentPredictions(limit)
      .map((predictionRecord) => this.buildPredictionResponse(predictionRecord));
    return predictionResponses;
  }

  public getRecentResolvedPredictions(limit: number): PredictionResponse[] {
    const predictionResponses = this.predictionStoreService
      .getRecentResolvedPredictions(limit)
      .map((predictionRecord) => this.buildPredictionResponse(predictionRecord));
    return predictionResponses;
  }

  public getStrategySummaries(marketKey?: MarketKey): StrategySummary[] {
    const strategySummaries = this.strategyMetricsService.getSummaries(marketKey);
    return strategySummaries;
  }

  public getPredictionCount(asset: AssetSymbol, window: MarketWindow): number {
    const predictionCount = this.predictionStoreService.getPredictionCount(`${asset}:${window}`);
    return predictionCount;
  }

  public getPendingCount(): number {
    return this.predictionStoreService.getPendingCount();
  }

  public getComboSummaries(marketKey?: MarketKey): ComboSummary[] {
    const comboSummaries = this.comboMetricsService.getComboSummaries(marketKey);
    return comboSummaries;
  }

  public getMarketComboBoards(marketKeys: MarketKey[]): MarketComboBoard[] {
    const marketComboBoards = this.comboMetricsService.getMarketComboBoards(marketKeys);
    return marketComboBoards;
  }
}
