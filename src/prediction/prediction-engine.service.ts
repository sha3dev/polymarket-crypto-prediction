/**
 * @section imports:internals
 */

import { randomUUID } from "node:crypto";
import type { ComboMetricsService } from "../combo/combo-metrics.service.ts";
import type { ComboSummary, MarketComboBoard } from "../combo/combo.types.ts";
import config from "../config.ts";
import type { ComboSource, PositionSide, TradeExitReason } from "../execution/execution.types.ts";
import type { LlmLogService } from "../llm/llm-log.service.ts";
import type { MarketStateService } from "../market/market-state.service.ts";
import type { AssetSymbol, MarketKey, MarketSnapshotSlice, MarketTrigger, MarketWindow, PredictionDirection, TriggerType } from "../market/market.types.ts";
import { SUPPORTED_ASSETS, SUPPORTED_WINDOWS } from "../market/market.types.ts";
import type { StrategyEngineService } from "../strategy/strategy-engine.service.ts";
import type { StrategyMetricsService } from "../strategy/strategy-metrics.service.ts";
import type { EngineBoard, StrategySummary } from "../strategy/strategy.types.ts";
import type { PredictionStoreService } from "./prediction-store.service.ts";
import type { PredictionOutcome, PredictionRecord, PredictionResponse } from "./prediction.types.ts";

/**
 * @section consts
 */

const MODEL_TRIGGER_MIN_SCORE = 0.58;
const MODEL_TRIGGER_MIN_CONFIDENCE = 0.58;
const MODEL_TRIGGER_MIN_SCORE_DELTA = 0.16;

/**
 * @section types
 */

type ModelStateSnapshot = {
  comboKey: string | null;
  direction: PredictionDirection | null;
  comboScore: number;
  comboConfidence: number;
  regimeId: string;
};

type ModelEvaluationSnapshot = {
  predictionContext: NonNullable<ReturnType<MarketStateService["getContinuousPredictionContext"]>>;
  evaluationResult: ReturnType<StrategyEngineService["evaluate"]>;
  comboApplicationResult: ReturnType<ComboMetricsService["applyComboEffects"]>;
};

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
  private readonly llmLogService: LlmLogService | null;
  private readonly pendingTriggers: Map<MarketKey, MarketTrigger>;
  private readonly modelStateSnapshots: Map<MarketKey, ModelStateSnapshot>;

  /**
   * @section constructor
   */

  public constructor(
    marketStateService: MarketStateService,
    strategyEngineService: StrategyEngineService,
    strategyMetricsService: StrategyMetricsService,
    predictionStoreService: PredictionStoreService,
    comboMetricsService: ComboMetricsService,
    llmLogService?: LlmLogService,
  ) {
    this.marketStateService = marketStateService;
    this.strategyEngineService = strategyEngineService;
    this.strategyMetricsService = strategyMetricsService;
    this.predictionStoreService = predictionStoreService;
    this.comboMetricsService = comboMetricsService;
    this.llmLogService = llmLogService ?? null;
    this.pendingTriggers = new Map<MarketKey, MarketTrigger>();
    this.modelStateSnapshots = new Map<MarketKey, ModelStateSnapshot>();
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
      if (this.shouldHoldResearchAfterTakeProfit(predictionRecord, marketSlice)) {
        predictionRecord.stopLossPrice = Math.max(predictionRecord.stopLossPrice ?? 0, predictionRecord.entryReferencePrice ?? 0);
      } else {
        researchOutcome = {
          status: "ok",
          resolvedDirection: predictionRecord.direction,
          evaluationPrice: liveTokenPrice,
          resolvedAt: marketSlice?.generatedAt ?? null,
        };
      }
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

  private shouldHoldResearchAfterTakeProfit(predictionRecord: PredictionRecord, marketSlice: MarketSnapshotSlice | null): boolean {
    const modelEvaluationSnapshot = this.evaluateCurrentModel(predictionRecord.marketKey);
    let shouldHoldResearchAfterTakeProfit = false;
    if (marketSlice !== null && modelEvaluationSnapshot !== null) {
      const selectedCombo = modelEvaluationSnapshot.comboApplicationResult.selectedCombo;
      const expectedDirection = predictionRecord.direction;
      const hasDirectionMatch = selectedCombo?.direction === expectedDirection;
      const hasComboSupport = (selectedCombo?.comboScore ?? 0) >= config.MIN_COMBO_EXECUTION_SCORE;
      const hasAnchorConfirmation = this.hasAnchorConfirmation(predictionRecord.marketKey, predictionRecord.positionSide === "up" ? "up" : "down");
      const hasAffordabilitySupport = (selectedCombo?.affordabilityScore ?? 0) >= 0.2;
      const hasQualitySupport = marketSlice.quality.score >= config.MIN_RESEARCH_MARKET_QUALITY;
      shouldHoldResearchAfterTakeProfit = hasDirectionMatch && hasComboSupport && hasAnchorConfirmation && hasAffordabilitySupport && hasQualitySupport;
    }
    return shouldHoldResearchAfterTakeProfit;
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
        if (this.llmLogService !== null) {
          this.llmLogService.recordPredictionResolved(this.buildPredictionResponse(predictionRecord));
        }
      }
    }
  }

  private resolveSignedDirection(positionSide: PositionSide): number {
    const signedDirection = positionSide === "up" ? 1 : -1;
    return signedDirection;
  }

  private resolveConfirmationTokenPrice(marketSlice: MarketSnapshotSlice, positionSide: PositionSide): number | null {
    const tokenPrice = positionSide === "up" ? (marketSlice.up.midpoint ?? marketSlice.up.price) : (marketSlice.down.midpoint ?? marketSlice.down.price);
    return tokenPrice;
  }

  private hasMomentumConfirmation(marketKey: MarketKey, marketSlice: MarketSnapshotSlice, positionSide: PositionSide): boolean {
    const predictionContext = this.marketStateService.getPredictionContext(marketKey);
    const previousSlice = predictionContext?.previous ?? null;
    const previousTokenPrice =
      previousSlice === null
        ? null
        : positionSide === "up"
          ? (previousSlice.up.midpoint ?? previousSlice.up.price)
          : (previousSlice.down.midpoint ?? previousSlice.down.price);
    const currentTokenPrice = this.resolveConfirmationTokenPrice(marketSlice, positionSide);
    const signedDirection = this.resolveSignedDirection(positionSide);
    const signedMomentum =
      previousTokenPrice === null || currentTokenPrice === null || previousTokenPrice === 0
        ? 0
        : signedDirection * ((currentTokenPrice - previousTokenPrice) / previousTokenPrice);
    const hasMomentumConfirmation = signedMomentum >= config.MIN_TRIGGER_SPOT_MOMENTUM;
    return hasMomentumConfirmation;
  }

  private hasBreadthConfirmation(marketKey: MarketKey): boolean {
    const predictionContext = this.marketStateService.getPredictionContext(marketKey);
    let hasBreadthConfirmation = false;
    if (predictionContext !== null) {
      const crossAssetRegime = predictionContext.crossAssetRegime;
      hasBreadthConfirmation =
        crossAssetRegime.breadthDirection === "NEUTRAL" || crossAssetRegime.breadthStrength >= config.MIN_WEAK_BREADTH_STRENGTH_FOR_PREDICTION;
    }
    return hasBreadthConfirmation;
  }

  private hasAnchorConfirmation(marketKey: MarketKey, positionSide: PositionSide): boolean {
    const predictionContext = this.marketStateService.getPredictionContext(marketKey);
    let hasAnchorConfirmation = true;
    if (predictionContext !== null) {
      const asset = predictionContext.current.asset;
      const crossAssetRegime = predictionContext.crossAssetRegime;
      const requiredBtcMomentum = positionSide === "up" ? crossAssetRegime.btcUpTokenMomentum : crossAssetRegime.btcDownTokenMomentum;
      const requiredEthMomentum = positionSide === "up" ? crossAssetRegime.ethUpTokenMomentum : crossAssetRegime.ethDownTokenMomentum;
      const anchorThreshold = config.CROSS_ASSET_BREADTH_MOVE_THRESHOLD * 0.35;
      if (asset === "eth") {
        hasAnchorConfirmation = requiredBtcMomentum >= anchorThreshold;
      }
      if (asset === "sol" || asset === "xrp") {
        hasAnchorConfirmation = requiredBtcMomentum >= anchorThreshold && requiredEthMomentum >= anchorThreshold;
      }
    }
    return hasAnchorConfirmation;
  }

  private isModelTriggerType(triggerType: TriggerType): boolean {
    const isModelTriggerType = triggerType === "combo_state_shift" || triggerType === "regime_state_shift";
    return isModelTriggerType;
  }

  private evaluateCurrentModel(marketKey: MarketKey): ModelEvaluationSnapshot | null {
    let modelEvaluationSnapshot: ModelEvaluationSnapshot | null = null;
    const predictionContext = this.marketStateService.getContinuousPredictionContext(marketKey);
    if (predictionContext !== null) {
      const evaluationResult = this.strategyEngineService.evaluate(predictionContext);
      const strategySummaries = this.strategyMetricsService.getSummaries(predictionContext.marketKey);
      const comboApplicationResult = this.comboMetricsService.applyComboEffects(
        predictionContext.marketKey,
        evaluationResult.strategyBreakdown,
        strategySummaries,
        evaluationResult.weightedScore,
        evaluationResult.finalConfidence,
        predictionContext.crossAssetRegime,
        predictionContext.current.quality.score,
      );
      modelEvaluationSnapshot = {
        predictionContext,
        evaluationResult,
        comboApplicationResult,
      };
    }
    return modelEvaluationSnapshot;
  }

  private buildModelStateSnapshot(modelEvaluationSnapshot: ModelEvaluationSnapshot): ModelStateSnapshot {
    const selectedCombo = modelEvaluationSnapshot.comboApplicationResult.selectedCombo;
    const modelStateSnapshot: ModelStateSnapshot = {
      comboKey: selectedCombo?.comboKey ?? null,
      direction: selectedCombo?.direction ?? null,
      comboScore: selectedCombo?.comboScore ?? 0,
      comboConfidence: selectedCombo?.comboConfidence ?? 0,
      regimeId: modelEvaluationSnapshot.predictionContext.crossAssetRegime.regimeId,
    };
    return modelStateSnapshot;
  }

  private resolveTriggerPrices(
    marketSlice: MarketSnapshotSlice,
    previousSlice: MarketSnapshotSlice | null,
    triggeredToken: PositionSide,
  ): { previousPrice: number | null; currentPrice: number | null; distanceToHalf: number | null } {
    const currentPrice = this.resolveConfirmationTokenPrice(marketSlice, triggeredToken);
    const previousPrice = previousSlice === null ? null : this.resolveConfirmationTokenPrice(previousSlice, triggeredToken);
    const distanceToHalf = currentPrice === null ? null : Math.abs(currentPrice - 0.5);
    return {
      previousPrice,
      currentPrice,
      distanceToHalf,
    };
  }

  private buildModelDrivenTrigger(modelEvaluationSnapshot: ModelEvaluationSnapshot, triggeredAt: number): MarketTrigger | null {
    const currentModelStateSnapshot = this.buildModelStateSnapshot(modelEvaluationSnapshot);
    const previousModelStateSnapshot = this.modelStateSnapshots.get(modelEvaluationSnapshot.predictionContext.marketKey) ?? null;
    this.modelStateSnapshots.set(modelEvaluationSnapshot.predictionContext.marketKey, currentModelStateSnapshot);
    let marketTrigger: MarketTrigger | null = null;
    const selectedCombo = modelEvaluationSnapshot.comboApplicationResult.selectedCombo;
    if (previousModelStateSnapshot !== null && selectedCombo !== null && currentModelStateSnapshot.direction !== null) {
      const hasDirectionShift = previousModelStateSnapshot.direction !== currentModelStateSnapshot.direction;
      const hasComboIdentityShift = previousModelStateSnapshot.comboKey !== currentModelStateSnapshot.comboKey;
      const hasRegimeShift = previousModelStateSnapshot.regimeId !== currentModelStateSnapshot.regimeId && currentModelStateSnapshot.regimeId !== "neutral";
      const hasScoreShift = Math.abs(previousModelStateSnapshot.comboScore - currentModelStateSnapshot.comboScore) >= MODEL_TRIGGER_MIN_SCORE_DELTA;
      const hasMeaningfulShift = hasDirectionShift || hasComboIdentityShift || hasRegimeShift || hasScoreShift;
      const hasStrongEnoughModelState =
        currentModelStateSnapshot.comboScore >= MODEL_TRIGGER_MIN_SCORE && currentModelStateSnapshot.comboConfidence >= MODEL_TRIGGER_MIN_CONFIDENCE;
      if (hasMeaningfulShift && hasStrongEnoughModelState) {
        const triggerType: TriggerType = hasRegimeShift && !hasDirectionShift && !hasComboIdentityShift ? "regime_state_shift" : "combo_state_shift";
        const triggeredToken = this.resolvePositionSide(currentModelStateSnapshot.direction);
        const triggerPrices = this.resolveTriggerPrices(
          modelEvaluationSnapshot.predictionContext.current,
          modelEvaluationSnapshot.predictionContext.previous,
          triggeredToken,
        );
        marketTrigger = {
          marketKey: modelEvaluationSnapshot.predictionContext.marketKey,
          asset: modelEvaluationSnapshot.predictionContext.asset,
          window: modelEvaluationSnapshot.predictionContext.window,
          triggeredToken,
          triggerType,
          previousPrice: triggerPrices.previousPrice,
          currentPrice: triggerPrices.currentPrice,
          distanceToHalf: triggerPrices.distanceToHalf,
          triggeredAt,
        };
      }
    }
    return marketTrigger;
  }

  private hasModelTriggerConfirmed(marketTrigger: MarketTrigger, nowTimestamp: number): boolean {
    const modelEvaluationSnapshot = this.evaluateCurrentModel(marketTrigger.marketKey);
    let hasModelTriggerConfirmed = false;
    if (modelEvaluationSnapshot !== null) {
      const selectedCombo = modelEvaluationSnapshot.comboApplicationResult.selectedCombo;
      const expectedDirection: PredictionDirection = marketTrigger.triggeredToken === "up" ? "UP" : "DOWN";
      const ageMs = nowTimestamp - marketTrigger.triggeredAt;
      const isPastDelay = ageMs >= config.TRIGGER_CONFIRMATION_DELAY_MS;
      const hasDirectionMatch = selectedCombo?.direction === expectedDirection;
      const hasScoreConfirmation = (selectedCombo?.comboScore ?? 0) >= MODEL_TRIGGER_MIN_SCORE;
      const hasConfidenceConfirmation = (selectedCombo?.comboConfidence ?? 0) >= MODEL_TRIGGER_MIN_CONFIDENCE;
      const hasQualityConfirmation = modelEvaluationSnapshot.predictionContext.current.quality.score >= config.MIN_RESEARCH_MARKET_QUALITY;
      const hasAnchorConfirmation = this.hasAnchorConfirmation(marketTrigger.marketKey, marketTrigger.triggeredToken);
      hasModelTriggerConfirmed =
        isPastDelay && hasDirectionMatch && hasScoreConfirmation && hasConfidenceConfirmation && hasQualityConfirmation && hasAnchorConfirmation;
    }
    return hasModelTriggerConfirmed;
  }

  private shouldDropModelTrigger(marketTrigger: MarketTrigger, nowTimestamp: number): boolean {
    const modelEvaluationSnapshot = this.evaluateCurrentModel(marketTrigger.marketKey);
    let shouldDropModelTrigger = false;
    if (modelEvaluationSnapshot === null) {
      shouldDropModelTrigger = true;
    } else {
      const selectedCombo = modelEvaluationSnapshot.comboApplicationResult.selectedCombo;
      const expectedDirection: PredictionDirection = marketTrigger.triggeredToken === "up" ? "UP" : "DOWN";
      const ageMs = nowTimestamp - marketTrigger.triggeredAt;
      const hasDirectionMismatch = selectedCombo?.direction !== expectedDirection;
      const hasWeakCombo = (selectedCombo?.comboScore ?? 0) < 0.5;
      shouldDropModelTrigger = ageMs > config.TRIGGER_CONFIRMATION_DELAY_MS * 4 || hasDirectionMismatch || hasWeakCombo;
    }
    return shouldDropModelTrigger;
  }

  private hasPendingTriggerConfirmed(marketTrigger: MarketTrigger, nowTimestamp: number): boolean {
    let hasPendingTriggerConfirmed = false;
    if (this.isModelTriggerType(marketTrigger.triggerType)) {
      hasPendingTriggerConfirmed = this.hasModelTriggerConfirmed(marketTrigger, nowTimestamp);
    } else {
      const marketSlice = this.marketStateService.getLatestSlice(marketTrigger.marketKey);
      if (marketSlice !== null) {
        const ageMs = nowTimestamp - marketTrigger.triggeredAt;
        const positionSide: PositionSide = marketTrigger.triggeredToken;
        const signedDirection = this.resolveSignedDirection(positionSide);
        const tokenPrice = this.resolveConfirmationTokenPrice(marketSlice, positionSide);
        const signedDistanceFromHalf = tokenPrice === null ? 0 : signedDirection * (tokenPrice - 0.5);
        const isPastDelay = ageMs >= config.TRIGGER_CONFIRMATION_DELAY_MS;
        const hasMovedAwayFromHalf = signedDistanceFromHalf >= config.MIN_TRIGGER_DISTANCE_FROM_HALF;
        const hasMomentumConfirmation = this.hasMomentumConfirmation(marketTrigger.marketKey, marketSlice, positionSide);
        const hasQualityConfirmation = marketSlice.quality.score >= config.MIN_RESEARCH_MARKET_QUALITY;
        const hasBreadthConfirmation = this.hasBreadthConfirmation(marketTrigger.marketKey);
        const hasAnchorConfirmation = this.hasAnchorConfirmation(marketTrigger.marketKey, positionSide);
        const modelEvaluationSnapshot = this.evaluateCurrentModel(marketTrigger.marketKey);
        const selectedCombo = modelEvaluationSnapshot?.comboApplicationResult.selectedCombo ?? null;
        const expectedDirection: PredictionDirection = positionSide === "up" ? "UP" : "DOWN";
        const hasComboDirectionMatch = selectedCombo?.direction === expectedDirection;
        const hasComboScoreConfirmation = (selectedCombo?.comboScore ?? 0) >= 0.54;
        hasPendingTriggerConfirmed =
          isPastDelay &&
          hasMovedAwayFromHalf &&
          hasMomentumConfirmation &&
          hasQualityConfirmation &&
          (hasBreadthConfirmation || hasAnchorConfirmation) &&
          hasComboDirectionMatch &&
          hasComboScoreConfirmation;
      }
    }
    return hasPendingTriggerConfirmed;
  }

  private shouldDropPendingTrigger(marketTrigger: MarketTrigger, nowTimestamp: number): boolean {
    let shouldDropPendingTrigger = false;
    if (this.isModelTriggerType(marketTrigger.triggerType)) {
      shouldDropPendingTrigger = this.shouldDropModelTrigger(marketTrigger, nowTimestamp);
    } else {
      const marketSlice = this.marketStateService.getLatestSlice(marketTrigger.marketKey);
      if (marketSlice === null) {
        shouldDropPendingTrigger = true;
      } else {
        const ageMs = nowTimestamp - marketTrigger.triggeredAt;
        const tokenPrice = this.resolveConfirmationTokenPrice(marketSlice, marketTrigger.triggeredToken);
        const signedDirection = this.resolveSignedDirection(marketTrigger.triggeredToken);
        const signedDistanceFromHalf = tokenPrice === null ? 0 : signedDirection * (tokenPrice - 0.5);
        shouldDropPendingTrigger = ageMs > config.TRIGGER_CONFIRMATION_DELAY_MS * 4 || signedDistanceFromHalf <= 0;
      }
    }
    return shouldDropPendingTrigger;
  }

  private shouldReplacePendingTrigger(existingTrigger: MarketTrigger | null, nextTrigger: MarketTrigger): boolean {
    let shouldReplacePendingTrigger = existingTrigger === null;
    if (existingTrigger !== null && existingTrigger.triggeredToken !== nextTrigger.triggeredToken) {
      shouldReplacePendingTrigger = true;
    }
    if (existingTrigger !== null && existingTrigger.triggerType !== nextTrigger.triggerType) {
      shouldReplacePendingTrigger = true;
    }
    if (existingTrigger !== null && !this.isModelTriggerType(existingTrigger.triggerType) && this.isModelTriggerType(nextTrigger.triggerType)) {
      shouldReplacePendingTrigger = true;
    }
    if (existingTrigger !== null && this.isModelTriggerType(nextTrigger.triggerType) && nextTrigger.triggeredAt > existingTrigger.triggeredAt) {
      shouldReplacePendingTrigger = this.isModelTriggerType(existingTrigger.triggerType);
    }
    if (existingTrigger !== null && this.isModelTriggerType(existingTrigger.triggerType) && nextTrigger.triggerType === "crossed_half") {
      shouldReplacePendingTrigger = false;
    }
    return shouldReplacePendingTrigger;
  }

  private maybeCreatePrediction(marketTrigger: MarketTrigger, createdAt: number): boolean {
    const lastPredictionTimestamp = this.marketStateService.getLastPredictionTimestamp(marketTrigger.marketKey);
    const isCoolingDown = lastPredictionTimestamp !== null && createdAt - lastPredictionTimestamp < config.MARKET_COOLDOWN_MS;
    let hasCreatedPrediction = false;
    if (!isCoolingDown) {
      const modelEvaluationSnapshot = this.evaluateCurrentModel(marketTrigger.marketKey);
      if (modelEvaluationSnapshot !== null) {
        const predictionContext = modelEvaluationSnapshot.predictionContext;
        const evaluationResult = modelEvaluationSnapshot.evaluationResult;
        const comboApplicationResult = modelEvaluationSnapshot.comboApplicationResult;
        const selectedCombo = comboApplicationResult.selectedCombo;
        if (selectedCombo !== null) {
          const winningDirection = selectedCombo.direction;
          const positionSide = this.resolvePositionSide(winningDirection);
          const baselineSlice = this.marketStateService.getLatestSlice(marketTrigger.marketKey);
          const entryReferencePrice = this.resolveEntryReferencePrice(baselineSlice, positionSide);
          const takeProfitPrice = entryReferencePrice === null ? null : this.clampTokenPrice(entryReferencePrice + config.TAKE_PROFIT_DELTA);
          const stopLossPrice = entryReferencePrice === null ? null : this.clampTokenPrice(entryReferencePrice - config.STOP_LOSS_DELTA);
          const predictionRecord = this.buildPredictionRecord(
            marketTrigger.marketKey,
            winningDirection,
            selectedCombo.comboConfidence,
            selectedCombo.direction === "UP" ? selectedCombo.comboScore : selectedCombo.comboScore * -1,
            evaluationResult.baseWeightedScore,
            evaluationResult.baseConfidence,
            marketTrigger,
            evaluationResult.strategyBreakdown,
            selectedCombo,
            comboApplicationResult.comboBreakdown,
            comboApplicationResult.comboGate,
            predictionContext.crossAssetRegime,
            createdAt,
            positionSide,
            entryReferencePrice,
            takeProfitPrice,
            stopLossPrice,
            baselineSlice?.up.price ?? null,
            baselineSlice?.up.midpoint ?? null,
          );
          this.predictionStoreService.addPrediction(predictionRecord);
          this.marketStateService.markPredictionCreated(marketTrigger.marketKey, createdAt);
          this.strategyMetricsService.markParticipated(predictionRecord.marketKey, evaluationResult.strategyBreakdown, predictionRecord.createdAt);
          if (this.llmLogService !== null) {
            this.llmLogService.recordPredictionCreated(this.buildPredictionResponse(predictionRecord));
          }
          hasCreatedPrediction = true;
        }
      }
    }
    return hasCreatedPrediction;
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
    selectedCombo: PredictionRecord["selectedCombo"],
    comboBreakdown: PredictionRecord["comboBreakdown"],
    comboGate: PredictionRecord["comboGate"],
    crossAssetRegime: PredictionRecord["crossAssetRegime"],
    createdAt: number,
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
      createdAt,
      evaluationDueAt: marketTrigger.triggeredAt + config.PREDICTION_HORIZON_MS,
      positionSide,
      entryReferencePrice,
      takeProfitPrice,
      stopLossPrice,
      baselineUpPrice,
      baselineUpMidpoint,
      strategyBreakdown,
      selectedCombo,
      comboBreakdown,
      comboGate,
      crossAssetRegime,
      isExecutionEligible: false,
      executionBlockingReasons: [],
      wasExecuted: false,
      executionComboSource: selectedCombo.selectionSource,
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
      crossAssetRegime: predictionRecord.crossAssetRegime,
      isExecutionEligible: predictionRecord.isExecutionEligible,
      executionBlockingReasons: predictionRecord.executionBlockingReasons,
      wasExecuted: predictionRecord.wasExecuted,
      executionComboSource: predictionRecord.executionComboSource,
      result: predictionRecord.outcome,
      strategyBreakdown: predictionRecord.strategyBreakdown,
      selectedCombo: predictionRecord.selectedCombo,
      comboBreakdown: predictionRecord.comboBreakdown,
    };
  }

  /**
   * @section public:methods
   */

  public handleSnapshot(_generatedAt: number, triggeredMarkets: MarketTrigger[]): void {
    this.maybeResolveResearchPredictions();
    const allTriggeredMarkets: MarketTrigger[] = [...triggeredMarkets];
    for (const asset of SUPPORTED_ASSETS) {
      for (const window of SUPPORTED_WINDOWS) {
        const marketKey: MarketKey = `${asset}:${window}`;
        const modelEvaluationSnapshot = this.evaluateCurrentModel(marketKey);
        if (modelEvaluationSnapshot !== null) {
          const modelDrivenTrigger = this.buildModelDrivenTrigger(modelEvaluationSnapshot, _generatedAt);
          if (modelDrivenTrigger !== null) {
            allTriggeredMarkets.push(modelDrivenTrigger);
          }
        }
      }
    }
    for (const marketTrigger of allTriggeredMarkets) {
      const existingTrigger = this.pendingTriggers.get(marketTrigger.marketKey) ?? null;
      if (this.shouldReplacePendingTrigger(existingTrigger, marketTrigger)) {
        this.pendingTriggers.set(marketTrigger.marketKey, marketTrigger);
      }
    }
    for (const asset of SUPPORTED_ASSETS) {
      for (const window of SUPPORTED_WINDOWS) {
        const marketKey: MarketKey = `${asset}:${window}`;
        const pendingTrigger = this.pendingTriggers.get(marketKey) ?? null;
        if (pendingTrigger !== null) {
          if (this.hasPendingTriggerConfirmed(pendingTrigger, _generatedAt)) {
            const hasCreatedPrediction = this.maybeCreatePrediction(pendingTrigger, _generatedAt);
            if (hasCreatedPrediction) {
              this.pendingTriggers.delete(marketKey);
            }
          } else {
            if (this.shouldDropPendingTrigger(pendingTrigger, _generatedAt)) {
              this.pendingTriggers.delete(marketKey);
            }
          }
        }
      }
    }
  }

  public markExecutionEligibility(
    marketKey: MarketKey,
    predictionTimestamp: number,
    isExecutionEligible: boolean,
    blockingReasons: string[],
    executionComboSource: ComboSource | null,
  ): void {
    const predictionRecord = this.predictionStoreService.getPrediction(marketKey, predictionTimestamp);
    if (predictionRecord !== null) {
      predictionRecord.isExecutionEligible = isExecutionEligible;
      predictionRecord.executionBlockingReasons = [...blockingReasons];
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
        if (this.llmLogService !== null) {
          this.llmLogService.recordPredictionResolved(this.buildPredictionResponse(predictionRecord));
        }
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

  public getEngineBoards(marketKeys: MarketKey[]): EngineBoard[] {
    const engineBoards: EngineBoard[] = [];
    for (const marketKey of marketKeys) {
      const predictionContext = this.marketStateService.getPredictionContext(marketKey);
      if (predictionContext !== null) {
        const evaluationResult = this.strategyEngineService.evaluate(predictionContext);
        engineBoards.push({ marketKey, engines: evaluationResult.engineBreakdown });
      } else {
        engineBoards.push({ marketKey, engines: [] });
      }
    }
    return engineBoards;
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
