/**
 * @section imports:internals
 */

import config from "../config.ts";
import type { MarketSnapshotSlice, PredictionDirection } from "../market/market.types.ts";
import type { PredictionResponse } from "../prediction/prediction.types.ts";
import type { ExecutionDecision, ExecutionStyle, PaperPosition, PositionSide, TradeExitReason } from "./execution.types.ts";

/**
 * @section class
 */

export class ExecutionPolicyService {
  /**
   * @section private:methods
   */

  private buildBlockedDecision(marketSlice: MarketSnapshotSlice, prediction: PredictionResponse | null, gateFailures: string[]): ExecutionDecision {
    const positionSide = this.resolvePositionSide(prediction?.direction ?? null);
    const referencePrice = positionSide === null ? null : this.resolveTokenPrice(marketSlice, positionSide);
    const takeProfitPrice = referencePrice === null ? null : this.clampTokenPrice(referencePrice + config.TAKE_PROFIT_DELTA);
    const stopLossPrice = referencePrice === null ? null : this.clampTokenPrice(referencePrice - config.STOP_LOSS_DELTA);
    return {
      marketKey: marketSlice.marketKey,
      asset: marketSlice.asset,
      window: marketSlice.window,
      isEntryAllowed: false,
      positionSide,
      predictionDirection: prediction?.direction ?? null,
      entryReferencePrice: referencePrice,
      takeProfitPrice,
      stopLossPrice,
      executionStyle: null,
      executionReason: null,
      urgencyScore: 0,
      makerFillProbability: 0,
      bookRiskScore: 1,
      positionSizeSuggestion: 0,
      gateFailures,
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

  private resolveTokenPrice(marketSlice: MarketSnapshotSlice, positionSide: PositionSide): number | null {
    const tokenMetrics = positionSide === "up" ? marketSlice.up : marketSlice.down;
    const tokenPrice = tokenMetrics.midpoint ?? tokenMetrics.price;
    return tokenPrice;
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

  private computeTimeToMarketEndMs(marketSlice: MarketSnapshotSlice): number | null {
    const marketEndTimestamp = marketSlice.marketEnd === null ? Number.NaN : Date.parse(marketSlice.marketEnd);
    const timeToMarketEndMs = Number.isNaN(marketEndTimestamp) ? null : marketEndTimestamp - marketSlice.generatedAt;
    return timeToMarketEndMs;
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

  private computeUrgencyScore(
    marketSlice: MarketSnapshotSlice,
    prediction: PredictionResponse,
    referencePrice: number,
    timeToMarketEndMs: number | null,
  ): number {
    const distanceToTarget = Math.abs(referencePrice - config.ENTRY_TARGET_PRICE);
    const timePressure =
      timeToMarketEndMs === null ? 0 : Math.max(0, Math.min(1, 1 - timeToMarketEndMs / Math.max(config.MIN_TIME_TO_END_FOR_NEW_ENTRY_MS, 1)));
    const confidencePressure = Math.max(0, Math.min(1, (prediction.confidence - config.MIN_ENTRY_CONFIDENCE) / 0.35));
    const qualityPressure = 1 - marketSlice.quality.score;
    const urgencyScore = Math.max(0, Math.min(1, distanceToTarget * 12 + timePressure * 0.4 + confidencePressure * 0.35 + qualityPressure * 0.25));
    return urgencyScore;
  }

  private computeBookRiskScore(spread: number, depth: number, imbalance: number): number {
    const spreadRisk = Math.max(0, Math.min(1, spread / Math.max(config.MAX_SPREAD_FOR_ENTRY, 0.0001)));
    const depthRisk = 1 - Math.max(0, Math.min(1, depth / Math.max(config.MIN_DEPTH_FOR_MAKER, 1)));
    const imbalanceRisk = Math.abs(imbalance) * 0.5;
    const bookRiskScore = Math.max(0, Math.min(1, spreadRisk * 0.5 + depthRisk * 0.35 + imbalanceRisk * 0.15));
    return bookRiskScore;
  }

  private resolveExecutionStyle(
    spread: number,
    depth: number,
    urgencyScore: number,
    makerFillProbability: number,
    timeToMarketEndMs: number | null,
    midpointDrift: number,
  ): ExecutionStyle {
    let executionStyle: ExecutionStyle = "maker";
    const isTakerRequired =
      spread <= 0.01 ||
      urgencyScore >= config.TAKER_URGENCY_THRESHOLD ||
      makerFillProbability <= 0.35 ||
      (timeToMarketEndMs !== null && timeToMarketEndMs <= 90_000) ||
      Math.abs(midpointDrift) > config.MAKER_DRIFT_LIMIT;
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

  private buildExecutionReason(
    executionStyle: ExecutionStyle,
    spread: number,
    makerFillProbability: number,
    urgencyScore: number,
    timeToMarketEndMs: number | null,
  ): string {
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
            if (timeToMarketEndMs !== null && timeToMarketEndMs <= 90_000) {
              executionReason = "expiry_urgency";
            } else {
              executionReason = "book_drift_take_liquidity";
            }
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
  ): ExecutionDecision | null {
    let executionDecision: ExecutionDecision | null = null;
    if (marketSlice !== null) {
      if (prediction === null || openPosition !== null) {
        executionDecision = this.buildBlockedDecision(marketSlice, prediction, prediction === null ? ["no_prediction"] : ["position_already_open"]);
      } else {
        const positionSide = this.resolvePositionSide(prediction.direction);
        if (positionSide === null) {
          executionDecision = this.buildBlockedDecision(marketSlice, prediction, ["invalid_direction"]);
        } else {
          const referencePrice = this.resolveTokenPrice(marketSlice, positionSide);
          const timeToMarketEndMs = this.computeTimeToMarketEndMs(marketSlice);
          const gateFailures: string[] = [];
          if (referencePrice === null) {
            gateFailures.push("no_reference_price");
          }
          if (!marketSlice.quality.hasLiveMarket) {
            gateFailures.push("market_not_live");
          }
          if (marketSlice.quality.score < config.MIN_MARKET_QUALITY_FOR_ENTRY) {
            gateFailures.push("quality_too_low");
          }
          if (prediction.confidence < config.MIN_ENTRY_CONFIDENCE) {
            gateFailures.push("confidence_too_low");
          }
          if (referencePrice !== null && Math.abs(referencePrice - config.ENTRY_TARGET_PRICE) > config.ENTRY_BAND_HALF_WIDTH) {
            gateFailures.push("outside_entry_band");
          }
          if (timeToMarketEndMs !== null && timeToMarketEndMs <= config.MIN_TIME_TO_END_FOR_NEW_ENTRY_MS) {
            gateFailures.push("too_close_to_expiry");
          }
          const spread = this.resolveSpread(marketSlice, positionSide);
          if (spread > config.MAX_SPREAD_FOR_ENTRY) {
            gateFailures.push("spread_too_wide");
          }
          if (gateFailures.length > 0 || referencePrice === null) {
            executionDecision = this.buildBlockedDecision(marketSlice, prediction, gateFailures);
          } else {
            const depth = this.resolveDepth(marketSlice, positionSide);
            const imbalance = this.resolveImbalance(marketSlice, positionSide);
            const midpointDrift = this.computeRecentMidpointDrift(marketSlice, positionSide);
            const urgencyScore = this.computeUrgencyScore(marketSlice, prediction, referencePrice, timeToMarketEndMs);
            const makerFillProbability = this.computeMakerFillProbability(spread, depth, urgencyScore, midpointDrift);
            const bookRiskScore = this.computeBookRiskScore(spread, depth, imbalance);
            const executionStyle = this.resolveExecutionStyle(spread, depth, urgencyScore, makerFillProbability, timeToMarketEndMs, midpointDrift);
            const positionSizeSuggestion = Math.max(0, Math.min(1, prediction.confidence * marketSlice.quality.score * (1 - bookRiskScore)));
            executionDecision = {
              marketKey: marketSlice.marketKey,
              asset: marketSlice.asset,
              window: marketSlice.window,
              isEntryAllowed: true,
              positionSide,
              predictionDirection: prediction.direction,
              entryReferencePrice: referencePrice,
              takeProfitPrice: this.clampTokenPrice(referencePrice + config.TAKE_PROFIT_DELTA),
              stopLossPrice: this.clampTokenPrice(referencePrice - config.STOP_LOSS_DELTA),
              executionStyle,
              executionReason: this.buildExecutionReason(executionStyle, spread, makerFillProbability, urgencyScore, timeToMarketEndMs),
              urgencyScore,
              makerFillProbability,
              bookRiskScore,
              positionSizeSuggestion,
              gateFailures: [],
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
    const timeToMarketEndMs = this.computeTimeToMarketEndMs(marketSlice);
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
    if (timeToMarketEndMs !== null && timeToMarketEndMs <= config.FORCE_FLATTEN_LEAD_MS) {
      exitReason = "flatten_before_expiry";
    }
    const urgencyScore = exitReason === "stop_loss_hit" || exitReason === "flatten_before_expiry" ? 1 : Math.max(0, Math.min(1, bookRiskScore + spread * 8));
    let executionStyle: ExecutionStyle | null = null;
    if (exitReason !== null) {
      executionStyle = urgencyScore >= config.TAKER_URGENCY_THRESHOLD || spread <= 0.01 ? "taker" : "maker";
    }
    const exitPrice = liveTokenPrice;
    return { exitReason, executionStyle, exitPrice };
  }
}
