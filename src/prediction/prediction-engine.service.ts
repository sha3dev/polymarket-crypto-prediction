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
const MODEL_TRIGGER_MIN_SCORE_DELTA = 0.16;
const RESEARCH_TRIGGER_MIN_SCORE = 0.46;
const RESEARCH_TRIGGER_MIN_QUALITY = 0.68;

/**
 * @section types
 */

type ModelStateSnapshot = {
  comboKey: string | null;
  direction: PredictionDirection | null;
  comboScore: number;
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
  // Per-snapshot cache: cleared at the start of each handleSnapshot to avoid redundant evaluations
  private readonly modelEvaluationCache: Map<MarketKey, ModelEvaluationSnapshot | null>;

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
    this.modelEvaluationCache = new Map<MarketKey, ModelEvaluationSnapshot | null>();
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
  ): {
    status: PredictionOutcome["status"];
    resolvedDirection: PredictionDirection | null;
    evaluationPrice: number | null;
    resolvedAt: number | null;
    reason: string;
  } | null {
    const liveTokenPrice =
      marketSlice === null
        ? null
        : predictionRecord.positionSide === "up"
          ? (marketSlice.up.midpoint ?? marketSlice.up.price)
          : (marketSlice.down.midpoint ?? marketSlice.down.price);
    const nowTimestamp = marketSlice?.generatedAt ?? Date.now();
    let researchOutcome: {
      status: PredictionOutcome["status"];
      resolvedDirection: PredictionDirection | null;
      evaluationPrice: number | null;
      resolvedAt: number | null;
      reason: string;
    } | null = null;
    // --- TP hit: always resolve as a win immediately (no more trailing stop that converts wins to losses) ---
    if (liveTokenPrice !== null && predictionRecord.takeProfitPrice !== null && liveTokenPrice >= predictionRecord.takeProfitPrice) {
      researchOutcome = {
        status: "ok",
        resolvedDirection: predictionRecord.direction,
        evaluationPrice: liveTokenPrice,
        resolvedAt: nowTimestamp,
        reason: "take_profit_hit",
      };
    }
    // --- SL hit: resolve as a loss (only if TP wasn't also hit on this tick) ---
    if (researchOutcome === null && liveTokenPrice !== null && predictionRecord.stopLossPrice !== null && liveTokenPrice <= predictionRecord.stopLossPrice) {
      researchOutcome = {
        status: "ko",
        resolvedDirection: predictionRecord.direction === "UP" ? "DOWN" : "UP",
        evaluationPrice: liveTokenPrice,
        resolvedAt: nowTimestamp,
        reason: "stop_loss_hit",
      };
    }
    // --- Time-based resolution: if prediction horizon has passed, resolve on current P&L ---
    if (researchOutcome === null && nowTimestamp >= predictionRecord.evaluationDueAt && liveTokenPrice !== null) {
      const entryPrice = predictionRecord.entryReferencePrice ?? 0.5;
      const isInProfit = liveTokenPrice > entryPrice;
      researchOutcome = {
        status: isInProfit ? "ok" : "ko",
        resolvedDirection: isInProfit ? predictionRecord.direction : predictionRecord.direction === "UP" ? "DOWN" : "UP",
        evaluationPrice: liveTokenPrice,
        resolvedAt: nowTimestamp,
        reason: isInProfit ? "horizon_profit" : "horizon_loss",
      };
    }
    return researchOutcome;
  }

  private hasResearchQualityConfirmation(qualityScore: number): boolean {
    const hasResearchQualityConfirmation = qualityScore >= RESEARCH_TRIGGER_MIN_QUALITY;
    return hasResearchQualityConfirmation;
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
          reason: researchOutcome.reason,
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
          this.strategyMetricsService.getSummaries(predictionRecord.marketKey),
          researchOutcome.resolvedDirection,
          researchOutcome.resolvedAt,
          "research",
        );
        this.comboMetricsService.resolvePredictionMoment(
          predictionRecord.marketKey,
          predictionRecord.predictionId,
          researchOutcome.resolvedDirection,
          researchOutcome.resolvedAt,
        );
        if (this.llmLogService !== null) {
          this.llmLogService.recordPredictionResolved(this.buildPredictionResponse(predictionRecord));
        }
      }
    }
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
    // Token prices always go UP when the position is winning, regardless of up/down side
    const tokenMomentum =
      previousTokenPrice === null || currentTokenPrice === null || previousTokenPrice === 0 ? 0 : (currentTokenPrice - previousTokenPrice) / previousTokenPrice;
    const hasMomentumConfirmation = tokenMomentum >= config.MIN_TRIGGER_SPOT_MOMENTUM;
    return hasMomentumConfirmation;
  }

  private hasBreadthConfirmation(marketKey: MarketKey, positionSide: PositionSide): boolean {
    const predictionContext = this.marketStateService.getPredictionContext(marketKey);
    let hasBreadthConfirmation = marketKey.startsWith("btc:");
    if (predictionContext !== null) {
      const crossAssetRegime = predictionContext.crossAssetRegime;
      const expectedDirection: PredictionDirection = positionSide === "up" ? "UP" : "DOWN";
      if (!marketKey.startsWith("btc:")) {
        // Neutral breadth → no directional conflict, always passes
        if (crossAssetRegime.breadthDirection === "NEUTRAL") {
          hasBreadthConfirmation = true;
        } else {
          const isDirectionAligned = crossAssetRegime.breadthDirection === expectedDirection;
          // Strong breadth MUST align with prediction direction
          if (crossAssetRegime.hasStrongBreadth) {
            // Even aligned strong breadth fails if exhaustion is very high (fading move)
            hasBreadthConfirmation = isDirectionAligned && crossAssetRegime.exhaustionScore < 0.85;
          } else {
            // Weak breadth: allow aligned predictions, and also allow counter-breadth if breadth is very weak
            hasBreadthConfirmation = isDirectionAligned || crossAssetRegime.breadthStrength < config.MIN_WEAK_BREADTH_STRENGTH_FOR_PREDICTION;
          }
        }
      }
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

  private computeAdaptiveTakeProfitDelta(confidence: number, comboScore: number, regimeClass: string): number {
    // High-confidence + strong regime = wider TP to capture more upside
    // Low-confidence = tighter TP to lock in small gains
    const confidenceMultiplier = 0.7 + confidence * 0.6;
    const comboMultiplier = 0.8 + Math.max(0, comboScore - 0.5) * 0.8;
    const regimeMultiplier =
      regimeClass === "anchor" || regimeClass === "aligned" ? 1.15 : regimeClass === "reversal" || regimeClass === "fragmented" ? 0.8 : 1;
    const adaptiveDelta = config.TAKE_PROFIT_DELTA * confidenceMultiplier * comboMultiplier * regimeMultiplier;
    // Clamp to reasonable bounds: 60% to 160% of base delta
    const clampedDelta = Math.max(config.TAKE_PROFIT_DELTA * 0.6, Math.min(config.TAKE_PROFIT_DELTA * 1.6, adaptiveDelta));
    return clampedDelta;
  }

  private computeAdaptiveStopLossDelta(confidence: number, comboScore: number, regimeClass: string): number {
    // Low-confidence = tighter SL to cut losses fast
    // High-confidence + strong regime = slightly wider SL to avoid noise stops
    const confidenceMultiplier = 0.75 + confidence * 0.5;
    const comboMultiplier = 0.85 + Math.max(0, comboScore - 0.5) * 0.5;
    const regimeMultiplier =
      regimeClass === "reversal" || regimeClass === "fragmented" ? 0.75 : regimeClass === "anchor" || regimeClass === "aligned" ? 1.1 : 1;
    const adaptiveDelta = config.STOP_LOSS_DELTA * confidenceMultiplier * comboMultiplier * regimeMultiplier;
    // Clamp to reasonable bounds: 50% to 140% of base delta
    const clampedDelta = Math.max(config.STOP_LOSS_DELTA * 0.5, Math.min(config.STOP_LOSS_DELTA * 1.4, adaptiveDelta));
    return clampedDelta;
  }

  private isModelTriggerType(triggerType: TriggerType): boolean {
    const isModelTriggerType = triggerType === "combo_state_shift" || triggerType === "regime_state_shift";
    return isModelTriggerType;
  }

  private evaluateCurrentModel(marketKey: MarketKey): ModelEvaluationSnapshot | null {
    let modelEvaluationSnapshot = this.modelEvaluationCache.get(marketKey) ?? null;
    const hasCachedSnapshot = this.modelEvaluationCache.has(marketKey);
    if (!hasCachedSnapshot) {
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
      this.modelEvaluationCache.set(marketKey, modelEvaluationSnapshot);
    }
    return modelEvaluationSnapshot;
  }

  private buildModelStateSnapshot(modelEvaluationSnapshot: ModelEvaluationSnapshot): ModelStateSnapshot {
    const selectedCombo = modelEvaluationSnapshot.comboApplicationResult.selectedCombo;
    const modelStateSnapshot: ModelStateSnapshot = {
      comboKey: selectedCombo?.comboKey ?? null,
      direction: selectedCombo?.direction ?? null,
      comboScore: selectedCombo?.comboScore ?? 0,
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
      const hasStrongEnoughModelState = currentModelStateSnapshot.comboScore >= MODEL_TRIGGER_MIN_SCORE;
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
      const hasScoreConfirmation = (selectedCombo?.comboScore ?? 0) >= RESEARCH_TRIGGER_MIN_SCORE;
      const hasQualityConfirmation = this.hasResearchQualityConfirmation(modelEvaluationSnapshot.predictionContext.current.quality.score);
      const hasAnchorConfirmation = this.hasAnchorConfirmation(marketTrigger.marketKey, marketTrigger.triggeredToken);
      hasModelTriggerConfirmed = isPastDelay && hasDirectionMatch && hasScoreConfirmation && hasQualityConfirmation && hasAnchorConfirmation;
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
      const hasWeakCombo = (selectedCombo?.comboScore ?? 0) < RESEARCH_TRIGGER_MIN_SCORE;
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
        const tokenPrice = this.resolveConfirmationTokenPrice(marketSlice, positionSide);
        // Token prices always go above 0.50 when winning, regardless of up/down side
        const distanceFromHalf = tokenPrice === null ? 0 : tokenPrice - 0.5;
        const isPastDelay = ageMs >= config.TRIGGER_CONFIRMATION_DELAY_MS;
        const hasMovedAwayFromHalf = distanceFromHalf >= config.MIN_TRIGGER_DISTANCE_FROM_HALF;
        const hasMomentumConfirmation = this.hasMomentumConfirmation(marketTrigger.marketKey, marketSlice, positionSide);
        const hasQualityConfirmation = this.hasResearchQualityConfirmation(marketSlice.quality.score);
        const hasBreadthConfirmation = this.hasBreadthConfirmation(marketTrigger.marketKey, positionSide);
        const hasAnchorConfirmation = this.hasAnchorConfirmation(marketTrigger.marketKey, positionSide);
        const modelEvaluationSnapshot = this.evaluateCurrentModel(marketTrigger.marketKey);
        const selectedCombo = modelEvaluationSnapshot?.comboApplicationResult.selectedCombo ?? null;
        const expectedDirection: PredictionDirection = positionSide === "up" ? "UP" : "DOWN";
        const hasComboDirectionMatch = selectedCombo?.direction === expectedDirection;
        const hasComboScoreConfirmation = (selectedCombo?.comboScore ?? 0) >= RESEARCH_TRIGGER_MIN_SCORE;
        // Breadth confirmation is now required (AND) — no more bypassing breadth with anchor alone
        hasPendingTriggerConfirmed =
          isPastDelay &&
          hasMovedAwayFromHalf &&
          hasMomentumConfirmation &&
          hasQualityConfirmation &&
          hasBreadthConfirmation &&
          hasAnchorConfirmation &&
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
        // Token prices always go above 0.50 when winning, regardless of up/down side
        const distanceFromHalf = tokenPrice === null ? 0 : tokenPrice - 0.5;
        shouldDropPendingTrigger = ageMs > config.TRIGGER_CONFIRMATION_DELAY_MS * 4 || distanceFromHalf <= 0;
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

  private computeAdaptiveCooldownMs(marketKey: MarketKey): number {
    const modelEvaluationSnapshot = this.evaluateCurrentModel(marketKey);
    let cooldownMs = config.MARKET_COOLDOWN_MS;
    if (modelEvaluationSnapshot !== null) {
      const regimeClass = modelEvaluationSnapshot.predictionContext.crossAssetRegime.regimeClass;
      // Extend cooldown in noisy regimes to avoid whipsawing
      if (regimeClass === "reversal") {
        cooldownMs = config.MARKET_COOLDOWN_MS * 2;
      }
      if (regimeClass === "fragmented") {
        cooldownMs = config.MARKET_COOLDOWN_MS * 1.5;
      }
      // Slightly shorter cooldown in strong directional regimes
      if (regimeClass === "anchor" || regimeClass === "aligned") {
        cooldownMs = config.MARKET_COOLDOWN_MS * 0.75;
      }
    }
    return cooldownMs;
  }

  private maybeCreatePrediction(marketTrigger: MarketTrigger, createdAt: number): boolean {
    const lastPredictionTimestamp = this.marketStateService.getLastPredictionTimestamp(marketTrigger.marketKey);
    const adaptiveCooldownMs = this.computeAdaptiveCooldownMs(marketTrigger.marketKey);
    const isCoolingDown = lastPredictionTimestamp !== null && createdAt - lastPredictionTimestamp < adaptiveCooldownMs;
    let hasCreatedPrediction = false;
    if (!isCoolingDown) {
      const modelEvaluationSnapshot = this.evaluateCurrentModel(marketTrigger.marketKey);
      if (modelEvaluationSnapshot !== null) {
        const predictionContext = modelEvaluationSnapshot.predictionContext;
        const evaluationResult = modelEvaluationSnapshot.evaluationResult;
        const comboApplicationResult = modelEvaluationSnapshot.comboApplicationResult;
        const selectedCombo = comboApplicationResult.selectedCombo;
        if (selectedCombo !== null) {
          // In untradable global context (neutral/fragmented regime), require stronger conviction
          const isTradableContext = predictionContext.crossAssetRegime.isTradableGlobalContext;
          const contextMinComboScore = isTradableContext ? RESEARCH_TRIGGER_MIN_SCORE : RESEARCH_TRIGGER_MIN_SCORE + 0.08;
          const hasContextualConviction = selectedCombo.comboScore >= contextMinComboScore;
          if (hasContextualConviction) {
            const winningDirection = selectedCombo.direction;
            const positionSide = this.resolvePositionSide(winningDirection);
            const baselineSlice = this.marketStateService.getLatestSlice(marketTrigger.marketKey);
            const entryReferencePrice = this.resolveEntryReferencePrice(baselineSlice, positionSide);
            const regimeClass = predictionContext.crossAssetRegime.regimeClass;
            const takeProfitDelta = this.computeAdaptiveTakeProfitDelta(comboApplicationResult.adjustedConfidence, selectedCombo.comboScore, regimeClass);
            const stopLossDelta = this.computeAdaptiveStopLossDelta(comboApplicationResult.adjustedConfidence, selectedCombo.comboScore, regimeClass);
            const takeProfitPrice = entryReferencePrice === null ? null : this.clampTokenPrice(entryReferencePrice + takeProfitDelta);
            const stopLossPrice = entryReferencePrice === null ? null : this.clampTokenPrice(entryReferencePrice - stopLossDelta);
            const predictionRecord = this.buildPredictionRecord(
              marketTrigger.marketKey,
              winningDirection,
              comboApplicationResult.adjustedConfidence,
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
            this.comboMetricsService.recordPredictionMoment(
              predictionRecord.marketKey,
              predictionRecord.predictionId,
              predictionRecord.strategyBreakdown,
              predictionRecord.createdAt,
            );
            if (this.llmLogService !== null) {
              this.llmLogService.recordPredictionCreated(this.buildPredictionResponse(predictionRecord));
            }
            hasCreatedPrediction = true;
          }
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
    // Clear per-snapshot evaluation cache so each tick gets fresh evaluations
    this.modelEvaluationCache.clear();
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
        this.strategyMetricsService.getSummaries(predictionRecord.marketKey),
        outcome.resolvedDirection,
        resolvedAt,
        "execution",
      );
      this.comboMetricsService.resolvePredictionMoment(predictionRecord.marketKey, predictionRecord.predictionId, outcome.resolvedDirection, resolvedAt);
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
