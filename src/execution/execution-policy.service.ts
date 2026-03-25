/**
 * @section imports:internals
 */

import config from "../config.ts";
import type { MarketSnapshotSlice, PredictionDirection } from "../market/market.types.ts";
import type { PredictionResponse } from "../prediction/prediction.types.ts";
import type { ExecutionDecision, ExecutionStyle, MarketPerformanceSummary, PaperPosition, PositionSide, TradeExitReason } from "./execution.types.ts";

/**
 * @section class
 */

export class ExecutionPolicyService {
  /**
   * @section private:methods
   */

  private buildBlockedDecision(
    marketSlice: MarketSnapshotSlice,
    prediction: PredictionResponse | null,
    marketPerformanceSummary: MarketPerformanceSummary | null,
    blockingReasons: string[],
  ): ExecutionDecision {
    const positionSide = this.resolvePositionSide(prediction?.direction ?? null);
    const referencePrice = positionSide === null ? null : this.resolveTokenPrice(marketSlice, positionSide);
    const orderShareCount = referencePrice === null ? 0 : this.computeMinimumShareCount(referencePrice);
    const orderNotionalUsd = referencePrice === null ? null : this.computeOrderNotionalUsd(referencePrice, orderShareCount);
    const takeProfitPrice = referencePrice === null ? null : this.clampTokenPrice(referencePrice + config.TAKE_PROFIT_DELTA);
    const stopLossPrice = referencePrice === null ? null : this.clampTokenPrice(referencePrice - config.STOP_LOSS_DELTA);
    return {
      marketKey: marketSlice.marketKey,
      asset: marketSlice.asset,
      window: marketSlice.window,
      isEntryAllowed: false,
      marketScore: marketPerformanceSummary?.marketScore ?? null,
      marketTradeCount: marketPerformanceSummary?.tradeCount ?? 0,
      hasSufficientMarketHistory: marketPerformanceSummary?.hasSufficientHistory ?? false,
      positionSide,
      predictionDirection: prediction?.direction ?? null,
      entryReferencePrice: referencePrice,
      orderShareCount,
      orderNotionalUsd,
      takeProfitPrice,
      stopLossPrice,
      executionStyle: null,
      executionReason: null,
      urgencyScore: 0,
      makerFillProbability: 0,
      bookRiskScore: 1,
      positionSizeSuggestion: 0,
      breadthDirection: prediction?.crossAssetRegime.breadthDirection ?? "NEUTRAL",
      breadthStrength: prediction?.crossAssetRegime.breadthStrength ?? null,
      hasStrongBreadth: prediction?.crossAssetRegime.hasStrongBreadth ?? false,
      hasBreadthAlignment: this.hasBreadthAlignment(prediction),
      selectedComboKey: prediction?.selectedCombo.comboKey ?? null,
      selectedComboSize: prediction?.selectedCombo.size ?? null,
      selectedComboSource: prediction?.selectedCombo.selectionSource ?? null,
      selectedComboDirection: prediction?.selectedCombo.direction ?? null,
      selectedComboScore: prediction?.selectedCombo.comboScore ?? null,
      selectedComboConfidence: prediction?.selectedCombo.comboConfidence ?? null,
      selectedComboStrategyIds: prediction?.selectedCombo.memberStrategyIds ?? [],
      selectedComboAffordabilityScore: prediction?.selectedCombo.affordabilityScore ?? null,
      regimeId: prediction?.crossAssetRegime.regimeId ?? null,
      blockingReasons,
      generatedAt: marketSlice.generatedAt,
    };
  }

  private resolvePositionSide(predictionDirection: PredictionDirection | null): PositionSide | null {
    let positionSide: PositionSide | null = null;
    if (predictionDirection === "UP") {
      positionSide = "up";
    }
    if (predictionDirection === "DOWN") {
      positionSide = "down";
    }
    return positionSide;
  }

  private hasBreadthAlignment(prediction: PredictionResponse | null): boolean {
    let hasBreadthAlignment = true;
    const breadthDirection = prediction?.crossAssetRegime.breadthDirection ?? "NEUTRAL";
    const hasStrongBreadth = prediction?.crossAssetRegime.hasStrongBreadth ?? false;
    if (prediction !== null && hasStrongBreadth && breadthDirection !== "NEUTRAL") {
      hasBreadthAlignment = prediction.direction === breadthDirection;
    }
    return hasBreadthAlignment;
  }

  private appendBlockingReasonIfMissing(blockingReasons: string[], blockingReason: string): void {
    if (!blockingReasons.includes(blockingReason)) {
      blockingReasons.push(blockingReason);
    }
  }

  private hasAnchorTokenMomentumSupport(prediction: PredictionResponse, asset: MarketSnapshotSlice["asset"]): boolean {
    const tokenMomentumThreshold = config.CROSS_ASSET_BREADTH_MOVE_THRESHOLD;
    const isUpPrediction = prediction.direction === "UP";
    const btcRequiredMomentum = isUpPrediction ? prediction.crossAssetRegime.btcUpTokenMomentum : prediction.crossAssetRegime.btcDownTokenMomentum;
    const ethRequiredMomentum = isUpPrediction ? prediction.crossAssetRegime.ethUpTokenMomentum : prediction.crossAssetRegime.ethDownTokenMomentum;
    let hasAnchorTokenMomentumSupport = true;
    if (asset === "eth") {
      hasAnchorTokenMomentumSupport = btcRequiredMomentum >= tokenMomentumThreshold;
    }
    if (asset === "sol" || asset === "xrp") {
      hasAnchorTokenMomentumSupport = btcRequiredMomentum >= tokenMomentumThreshold && ethRequiredMomentum >= tokenMomentumThreshold;
    }
    return hasAnchorTokenMomentumSupport;
  }

  private appendAnchorGateFailures(blockingReasons: string[], prediction: PredictionResponse, marketSlice: MarketSnapshotSlice): void {
    const btcDirection = prediction.crossAssetRegime.btcDirection;
    const ethDirection = prediction.crossAssetRegime.ethDirection;
    const predictionDirection = prediction.direction;
    if (marketSlice.asset === "eth") {
      const hasEthConflictWithBtc = btcDirection !== "NEUTRAL" && predictionDirection !== btcDirection;
      if (hasEthConflictWithBtc) {
        this.appendBlockingReasonIfMissing(blockingReasons, "cross_asset_regime_conflict");
      }
      if (!this.hasAnchorTokenMomentumSupport(prediction, marketSlice.asset)) {
        this.appendBlockingReasonIfMissing(blockingReasons, "cross_asset_regime_conflict");
      }
    }
    if (marketSlice.asset === "sol" || marketSlice.asset === "xrp") {
      const hasMissingDirectionalAlignment = btcDirection === "NEUTRAL" || ethDirection === "NEUTRAL" || btcDirection !== ethDirection;
      const hasAltDirectionConflict = !hasMissingDirectionalAlignment && predictionDirection !== btcDirection;
      if (hasMissingDirectionalAlignment || hasAltDirectionConflict) {
        this.appendBlockingReasonIfMissing(blockingReasons, "cross_asset_regime_conflict");
      }
      if (!this.hasAnchorTokenMomentumSupport(prediction, marketSlice.asset)) {
        this.appendBlockingReasonIfMissing(blockingReasons, "cross_asset_regime_conflict");
      }
    }
  }

  private resolveTokenPrice(marketSlice: MarketSnapshotSlice, positionSide: PositionSide): number | null {
    const tokenMetrics = positionSide === "up" ? marketSlice.up : marketSlice.down;
    const tokenPrice = tokenMetrics.midpoint ?? tokenMetrics.price;
    return tokenPrice;
  }

  private computeMinimumShareCount(referencePrice: number): number {
    const shareCountFromUsd = Math.ceil(config.MIN_ORDER_USD / Math.max(referencePrice, 0.0001));
    const minimumShareCount = Math.max(config.MIN_ORDER_SHARES, shareCountFromUsd);
    return minimumShareCount;
  }

  private computeOrderNotionalUsd(referencePrice: number, orderShareCount: number): number {
    const orderNotionalUsd = referencePrice * orderShareCount;
    return orderNotionalUsd;
  }

  private resolveSpread(marketSlice: MarketSnapshotSlice, positionSide: PositionSide): number {
    const tokenMetrics = positionSide === "up" ? marketSlice.up : marketSlice.down;
    const spread = tokenMetrics.spread ?? 1;
    return spread;
  }

  private resolveDepth(marketSlice: MarketSnapshotSlice, positionSide: PositionSide): number {
    const tokenMetrics = positionSide === "up" ? marketSlice.up : marketSlice.down;
    return tokenMetrics.depthTop;
  }

  private resolveImbalance(marketSlice: MarketSnapshotSlice, positionSide: PositionSide): number {
    const tokenMetrics = positionSide === "up" ? marketSlice.up : marketSlice.down;
    return tokenMetrics.imbalance;
  }

  private computeRecentMidpointDrift(marketSlice: MarketSnapshotSlice, positionSide: PositionSide): number {
    let midpointDrift = 0;
    const currentMidpoint = positionSide === "up" ? marketSlice.up.midpoint : marketSlice.down.midpoint;
    if (currentMidpoint !== null) {
      const referencePrice = positionSide === "up" ? marketSlice.up.price : marketSlice.down.price;
      if (referencePrice !== null && referencePrice !== 0) {
        midpointDrift = (currentMidpoint - referencePrice) / referencePrice;
      }
    }
    return midpointDrift;
  }

  private computeMakerFillProbability(spread: number, depth: number, urgencyScore: number, midpointDrift: number): number {
    const spreadScore = Math.max(0, Math.min(1, spread / Math.max(0.0001, config.MIN_SPREAD_FOR_MAKER * 2)));
    const depthScore = Math.max(0, Math.min(1, depth / Math.max(1, config.MIN_DEPTH_FOR_MAKER * 2)));
    const driftPenalty = Math.max(0, Math.min(1, Math.abs(midpointDrift) / Math.max(0.0001, config.MAKER_DRIFT_LIMIT)));
    const urgencyPenalty = urgencyScore * 0.6;
    const makerFillProbability = Math.max(0, Math.min(1, spreadScore * 0.35 + depthScore * 0.45 + (1 - driftPenalty) * 0.2 - urgencyPenalty));
    return makerFillProbability;
  }

  private computeUrgencyScore(marketSlice: MarketSnapshotSlice, prediction: PredictionResponse, referencePrice: number): number {
    const distanceToTarget = Math.abs(referencePrice - config.ENTRY_TARGET_PRICE);
    const confidencePressure = Math.max(0, Math.min(1, (prediction.confidence - config.MIN_ENTRY_CONFIDENCE) / 0.35));
    const qualityPressure = 1 - marketSlice.quality.score;
    const urgencyScore = Math.max(0, Math.min(1, distanceToTarget * 12 + confidencePressure * 0.45 + qualityPressure * 0.25));
    return urgencyScore;
  }

  private computeBookRiskScore(spread: number, depth: number, imbalance: number): number {
    const spreadRisk = Math.max(0, Math.min(1, spread / Math.max(config.MAX_SPREAD_FOR_ENTRY, 0.0001)));
    const depthRisk = 1 - Math.max(0, Math.min(1, depth / Math.max(config.MIN_DEPTH_FOR_MAKER, 1)));
    const imbalanceRisk = Math.abs(imbalance) * 0.5;
    const bookRiskScore = Math.max(0, Math.min(1, spreadRisk * 0.5 + depthRisk * 0.35 + imbalanceRisk * 0.15));
    return bookRiskScore;
  }

  private resolveExecutionStyle(spread: number, depth: number, urgencyScore: number, makerFillProbability: number, midpointDrift: number): ExecutionStyle {
    let executionStyle: ExecutionStyle = "maker";
    const isTakerRequired =
      spread <= 0.01 || urgencyScore >= config.TAKER_URGENCY_THRESHOLD || makerFillProbability <= 0.35 || Math.abs(midpointDrift) > config.MAKER_DRIFT_LIMIT;
    if (isTakerRequired) {
      executionStyle = "taker";
    }
    if (spread < config.MIN_SPREAD_FOR_MAKER) {
      executionStyle = "taker";
    }
    if (depth < config.MIN_DEPTH_FOR_MAKER && urgencyScore > 0.45) {
      executionStyle = "taker";
    }
    return executionStyle;
  }

  private buildExecutionReason(executionStyle: ExecutionStyle, spread: number, makerFillProbability: number, urgencyScore: number): string {
    let executionReason = "maker_preferred";
    if (executionStyle === "taker") {
      if (spread <= 0.01) {
        executionReason = "tight_spread_take_liquidity";
      } else {
        if (urgencyScore >= config.TAKER_URGENCY_THRESHOLD) {
          executionReason = "urgency_take_liquidity";
        } else {
          if (makerFillProbability <= 0.35) {
            executionReason = "low_fill_probability";
          } else {
            executionReason = "book_drift_take_liquidity";
          }
        }
      }
    }
    return executionReason;
  }

  private clampTokenPrice(rawPrice: number): number {
    const clampedPrice = Math.max(0.01, Math.min(0.99, rawPrice));
    return clampedPrice;
  }

  /**
   * @section public:methods
   */

  public buildEntryDecision(
    marketSlice: MarketSnapshotSlice | null,
    prediction: PredictionResponse | null,
    openPosition: PaperPosition | null,
    marketPerformanceSummary: MarketPerformanceSummary | null,
  ): ExecutionDecision | null {
    let executionDecision: ExecutionDecision | null = null;
    if (marketSlice !== null) {
      if (prediction === null || openPosition !== null) {
        executionDecision = this.buildBlockedDecision(
          marketSlice,
          prediction,
          marketPerformanceSummary,
          prediction === null ? ["no_prediction"] : ["position_already_open"],
        );
      } else {
        const positionSide = this.resolvePositionSide(prediction.direction);
        if (positionSide === null) {
          executionDecision = this.buildBlockedDecision(marketSlice, prediction, marketPerformanceSummary, ["invalid_direction"]);
        } else {
          const referencePrice = this.resolveTokenPrice(marketSlice, positionSide);
          const blockingReasons: string[] = [];
          if (referencePrice === null) {
            blockingReasons.push("no_reference_price");
          }
          if (!this.hasBreadthAlignment(prediction)) {
            blockingReasons.push("cross_asset_regime_conflict");
          }
          this.appendAnchorGateFailures(blockingReasons, prediction, marketSlice);
          if (!marketSlice.quality.hasLiveMarket) {
            blockingReasons.push("market_not_live");
          }
          if (marketSlice.quality.score < config.MIN_MARKET_QUALITY_FOR_ENTRY) {
            blockingReasons.push("quality_too_low");
          }
          if (prediction.selectedCombo.comboConfidence < config.MIN_ENTRY_CONFIDENCE) {
            blockingReasons.push("confidence_too_low");
          }
          if (prediction.selectedCombo.comboScore < 0.58) {
            blockingReasons.push("combo_score_too_low");
          }
          if (prediction.selectedCombo.anchorFitScore < 0.9) {
            blockingReasons.push("anchor_fit_too_low");
          }
          if (prediction.selectedCombo.affordabilityScore < 0.35) {
            blockingReasons.push("combo_score_too_low");
          }
          if (referencePrice !== null && Math.abs(referencePrice - config.ENTRY_TARGET_PRICE) > config.ENTRY_BAND_HALF_WIDTH) {
            blockingReasons.push("outside_entry_band");
          }
          const spread = this.resolveSpread(marketSlice, positionSide);
          if (spread > config.MAX_SPREAD_FOR_ENTRY) {
            blockingReasons.push("spread_too_wide");
          }
          if (marketPerformanceSummary !== null && marketPerformanceSummary.status === "warming_up") {
            blockingReasons.push("market_warming_up");
          }
          if (marketPerformanceSummary !== null && marketPerformanceSummary.marketScore < config.MIN_MARKET_SCORE_FOR_ENTRY) {
            blockingReasons.push("market_score_too_low");
          }
          const orderShareCount = referencePrice === null ? 0 : this.computeMinimumShareCount(referencePrice);
          const orderNotionalUsd = referencePrice === null ? null : this.computeOrderNotionalUsd(referencePrice, orderShareCount);
          if (orderNotionalUsd !== null && orderNotionalUsd < config.MIN_ORDER_USD) {
            blockingReasons.push("order_notional_too_low");
          }
          if (orderShareCount < config.MIN_ORDER_SHARES) {
            blockingReasons.push("order_share_count_too_low");
          }
          if (blockingReasons.length > 0 || referencePrice === null || marketPerformanceSummary === null) {
            executionDecision = this.buildBlockedDecision(marketSlice, prediction, marketPerformanceSummary, blockingReasons);
          } else {
            const depth = this.resolveDepth(marketSlice, positionSide);
            const imbalance = this.resolveImbalance(marketSlice, positionSide);
            const midpointDrift = this.computeRecentMidpointDrift(marketSlice, positionSide);
            const urgencyScore = this.computeUrgencyScore(marketSlice, prediction, referencePrice);
            const makerFillProbability = this.computeMakerFillProbability(spread, depth, urgencyScore, midpointDrift);
            const bookRiskScore = this.computeBookRiskScore(spread, depth, imbalance);
            const executionStyle = this.resolveExecutionStyle(spread, depth, urgencyScore, makerFillProbability, midpointDrift);
            const positionSizeSuggestion = Math.max(0, Math.min(1, prediction.confidence * marketSlice.quality.score * (1 - bookRiskScore)));
            executionDecision = {
              marketKey: marketSlice.marketKey,
              asset: marketSlice.asset,
              window: marketSlice.window,
              isEntryAllowed: true,
              marketScore: marketPerformanceSummary.marketScore,
              marketTradeCount: marketPerformanceSummary.tradeCount,
              hasSufficientMarketHistory: marketPerformanceSummary.hasSufficientHistory,
              positionSide,
              predictionDirection: prediction.direction,
              entryReferencePrice: referencePrice,
              orderShareCount,
              orderNotionalUsd,
              takeProfitPrice: this.clampTokenPrice(referencePrice + config.TAKE_PROFIT_DELTA),
              stopLossPrice: this.clampTokenPrice(referencePrice - config.STOP_LOSS_DELTA),
              executionStyle,
              executionReason: this.buildExecutionReason(executionStyle, spread, makerFillProbability, urgencyScore),
              urgencyScore,
              makerFillProbability,
              bookRiskScore,
              positionSizeSuggestion,
              breadthDirection: prediction.crossAssetRegime.breadthDirection,
              breadthStrength: prediction.crossAssetRegime.breadthStrength,
              hasStrongBreadth: prediction.crossAssetRegime.hasStrongBreadth,
              hasBreadthAlignment: true,
              selectedComboKey: prediction.selectedCombo.comboKey,
              selectedComboSize: prediction.selectedCombo.size,
              selectedComboSource: prediction.selectedCombo.selectionSource,
              selectedComboDirection: prediction.selectedCombo.direction,
              selectedComboScore: prediction.selectedCombo.comboScore,
              selectedComboConfidence: prediction.selectedCombo.comboConfidence,
              selectedComboStrategyIds: [...prediction.selectedCombo.memberStrategyIds],
              selectedComboAffordabilityScore: prediction.selectedCombo.affordabilityScore,
              regimeId: prediction.crossAssetRegime.regimeId,
              blockingReasons: [],
              generatedAt: marketSlice.generatedAt,
            };
          }
        }
      }
    }
    return executionDecision;
  }

  public buildExitDecision(
    marketSlice: MarketSnapshotSlice,
    paperPosition: PaperPosition,
  ): { exitReason: TradeExitReason | null; executionStyle: ExecutionStyle | null; exitPrice: number | null } {
    const liveTokenPrice = this.resolveTokenPrice(marketSlice, paperPosition.positionSide);
    const spread = this.resolveSpread(marketSlice, paperPosition.positionSide);
    const depth = this.resolveDepth(marketSlice, paperPosition.positionSide);
    const imbalance = this.resolveImbalance(marketSlice, paperPosition.positionSide);
    const bookRiskScore = this.computeBookRiskScore(spread, depth, imbalance);
    let exitReason: TradeExitReason | null = null;
    if (liveTokenPrice !== null && liveTokenPrice >= paperPosition.takeProfitPrice) {
      exitReason = "take_profit_hit";
    }
    if (liveTokenPrice !== null && liveTokenPrice <= paperPosition.stopLossPrice) {
      exitReason = "stop_loss_hit";
    }
    const urgencyScore = exitReason === "stop_loss_hit" ? 1 : Math.max(0, Math.min(1, bookRiskScore + spread * 8));
    let executionStyle: ExecutionStyle | null = null;
    if (exitReason !== null) {
      executionStyle = urgencyScore >= config.TAKER_URGENCY_THRESHOLD || spread <= 0.01 ? "taker" : "maker";
    }
    const exitPrice = liveTokenPrice;
    return { exitReason, executionStyle, exitPrice };
  }
}
