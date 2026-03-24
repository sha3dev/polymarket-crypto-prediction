/**
 * @section imports:internals
 */

import { randomUUID } from "node:crypto";
import type { ComboMetricsService } from "../combo/combo-metrics.service.ts";
import type { ComboSummary, MarketComboBoard } from "../combo/combo.types.ts";

import config from "../config.ts";
import type { MarketStateService } from "../market/market-state.service.ts";
import type { AssetSymbol, MarketKey, MarketTrigger, MarketWindow, PredictionDirection } from "../market/market.types.ts";
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
        const baselineSlice = this.marketStateService.getLatestSlice(marketTrigger.marketKey);
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
      baselineUpPrice,
      baselineUpMidpoint,
      strategyBreakdown,
      comboBreakdown,
      isResolved: false,
      outcome: {
        status: "pending",
        resolvedAt: null,
        resolvedDirection: null,
        evaluationPrice: null,
        baselinePrice: baselineUpMidpoint ?? baselineUpPrice,
        isFallbackPriceUsed: false,
        reason: null,
      },
    };
  }

  private resolveDuePredictions(generatedAt: number): void {
    const pendingPredictions = this.predictionStoreService.getPendingPredictions(generatedAt);
    for (const pendingPrediction of pendingPredictions) {
      const marketEvaluationPrice = this.marketStateService.getEvaluationPrice(pendingPrediction.marketKey);
      const baselinePrice = pendingPrediction.baselineUpMidpoint ?? pendingPrediction.baselineUpPrice;
      const resolvedPrice = marketEvaluationPrice.midpoint ?? marketEvaluationPrice.fallbackPrice;
      const resolvedDirection = baselinePrice === null || resolvedPrice === null ? null : resolvedPrice > baselinePrice + 0.001 ? "UP" : "DOWN";
      const outcome = this.buildOutcome(
        pendingPrediction.direction,
        resolvedDirection,
        baselinePrice,
        resolvedPrice,
        marketEvaluationPrice.isFallbackPriceUsed,
        marketEvaluationPrice.observedAt,
      );
      pendingPrediction.isResolved = true;
      pendingPrediction.outcome = outcome;
      this.strategyMetricsService.recordResolution(pendingPrediction.marketKey, pendingPrediction.strategyBreakdown, resolvedDirection, outcome.resolvedAt);
      this.comboMetricsService.recordResolution(
        pendingPrediction.marketKey,
        pendingPrediction.predictionId,
        pendingPrediction.comboBreakdown.activeCombos,
        pendingPrediction.strategyBreakdown,
        this.strategyMetricsService.getSummaries(pendingPrediction.marketKey),
        resolvedDirection,
        outcome.resolvedAt,
      );
    }
  }

  private buildOutcome(
    predictedDirection: PredictionDirection,
    resolvedDirection: PredictionDirection | null,
    baselinePrice: number | null,
    evaluationPrice: number | null,
    isFallbackPriceUsed: boolean,
    observedAt: number | null,
  ): PredictionOutcome {
    let outcome: PredictionOutcome = {
      status: "void",
      resolvedAt: observedAt,
      resolvedDirection,
      evaluationPrice,
      baselinePrice,
      isFallbackPriceUsed,
      reason: "unresolved_due_to_data_gap",
    };
    if (resolvedDirection !== null) {
      const wasCorrect = predictedDirection === resolvedDirection;
      outcome = {
        status: wasCorrect ? "ok" : "ko",
        resolvedAt: observedAt,
        resolvedDirection,
        evaluationPrice,
        baselinePrice,
        isFallbackPriceUsed,
        reason: null,
      };
    }
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
      isResolved: predictionRecord.isResolved,
      result: predictionRecord.outcome,
      strategyBreakdown: predictionRecord.strategyBreakdown,
      comboBreakdown: predictionRecord.comboBreakdown,
    };
  }

  /**
   * @section public:methods
   */

  public handleSnapshot(generatedAt: number, triggeredMarkets: MarketTrigger[]): void {
    this.resolveDuePredictions(generatedAt);
    for (const marketTrigger of triggeredMarkets) {
      this.maybeCreatePrediction(marketTrigger);
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
