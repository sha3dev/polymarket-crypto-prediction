/**
 * @section imports:internals
 */

import config from "../config.ts";
import type { AssetSymbol, CrossAssetBreadthDirection, MarketSnapshotSlice, PredictionContext } from "../market/market.types.ts";
import type { OpportunityFactorSignal, OpportunitySide } from "./opportunity.types.ts";
import type {
  AnchorContextState,
  BarrierReachabilityState,
  MarketOpportunityState,
  TokenOpportunityState,
  WindowPhase,
  WindowState,
} from "./opportunity.types.ts";

/**
 * @section class
 */

export class OpportunityStateService {
  /**
   * @section private:methods
   */

  private clamp(rawValue: number, minValue: number, maxValue: number): number {
    const clampedValue = Math.max(minValue, Math.min(maxValue, rawValue));
    return clampedValue;
  }

  private parseTimestamp(timestampValue: string | null): number | null {
    const parsedTimestamp = timestampValue === null ? Number.NaN : Date.parse(timestampValue);
    const normalizedTimestamp = Number.isFinite(parsedTimestamp) ? parsedTimestamp : null;
    return normalizedTimestamp;
  }

  private resolveWindowPhase(elapsedRatio: number | null, remainingMs: number | null): WindowPhase {
    let phase: WindowPhase = "middle";
    if (remainingMs !== null && remainingMs <= config.BARRIER_FORCE_DECIDED_TIME_MS) {
      phase = "final";
    } else {
      if (elapsedRatio === null || elapsedRatio < 0.15) {
        phase = "opening";
      } else {
        if (elapsedRatio >= 0.92) {
          phase = "final";
        } else {
          if (elapsedRatio >= 0.7) {
            phase = "late";
          }
        }
      }
    }
    return phase;
  }

  private resolveOpportunitySide(direction: CrossAssetBreadthDirection): OpportunitySide | null {
    let opportunitySide: OpportunitySide | null = null;
    if (direction === "UP") {
      opportunitySide = "up";
    }
    if (direction === "DOWN") {
      opportunitySide = "down";
    }
    return opportunitySide;
  }

  private resolveBarrierReferencePrice(currentSlice: MarketSnapshotSlice): {
    referencePrice: number | null;
    referenceSource: BarrierReachabilityState["referenceSource"];
  } {
    let referencePrice = currentSlice.chainlinkPrice;
    let referenceSource: BarrierReachabilityState["referenceSource"] = "chainlink";
    if (referencePrice === null) {
      referencePrice = currentSlice.spotConsensusPrice;
      referenceSource = referencePrice === null ? "none" : "spot";
    }
    return { referencePrice, referenceSource };
  }

  private buildWindowState(currentSlice: MarketSnapshotSlice): WindowState {
    const marketStartTimestamp = this.parseTimestamp(currentSlice.marketStart);
    const marketEndTimestamp = this.parseTimestamp(currentSlice.marketEnd);
    const elapsedMs = marketStartTimestamp === null ? null : Math.max(0, currentSlice.generatedAt - marketStartTimestamp);
    const remainingMs = marketEndTimestamp === null ? null : Math.max(0, marketEndTimestamp - currentSlice.generatedAt);
    const totalWindowMs = marketStartTimestamp === null || marketEndTimestamp === null ? null : marketEndTimestamp - marketStartTimestamp;
    const elapsedRatio = totalWindowMs === null || totalWindowMs <= 0 || elapsedMs === null ? null : this.clamp(elapsedMs / totalWindowMs, 0, 1);
    const windowState: WindowState = {
      marketStart: currentSlice.marketStart,
      marketEnd: currentSlice.marketEnd,
      elapsedMs,
      remainingMs,
      elapsedRatio,
      phase: this.resolveWindowPhase(elapsedRatio, remainingMs),
    };
    return windowState;
  }

  private buildBarrierReachability(currentSlice: MarketSnapshotSlice): BarrierReachabilityState {
    const { referencePrice, referenceSource } = this.resolveBarrierReferencePrice(currentSlice);
    const priceToBeat = currentSlice.priceToBeat;
    const signedBarrierDistance = referencePrice === null || priceToBeat === null ? null : referencePrice - priceToBeat;
    const barrierDistanceRatio =
      signedBarrierDistance === null || priceToBeat === null || priceToBeat === 0 ? null : Math.abs(signedBarrierDistance) / Math.abs(priceToBeat);
    const dominantResolutionSide = currentSlice.barrierState.dominantSide === "UP" ? "up" : currentSlice.barrierState.dominantSide === "DOWN" ? "down" : null;
    const remainingMs = currentSlice.barrierState.timeRemainingMs;
    const requiredMovePerSecond =
      signedBarrierDistance === null || remainingMs === null || remainingMs <= 0 ? null : Math.abs(signedBarrierDistance) / Math.max(1, remainingMs / 1_000);
    const isBarrierKnown = currentSlice.barrierState.isBarrierDataUsable;
    const normalizedDistance =
      barrierDistanceRatio === null ? 0.5 : this.clamp(barrierDistanceRatio / Math.max(config.BARRIER_DECIDED_RATIO, 0.000_001), 0, 1.5);
    const timeSupport = remainingMs === null ? 0.5 : this.clamp(remainingMs / Math.max(config.PREDICTION_HORIZON_MS, 1), 0, 1);
    let contestabilityScore = isBarrierKnown ? this.clamp((1 - normalizedDistance) * 0.7 + timeSupport * 0.3, 0, 1) : 0.5;
    if (currentSlice.barrierState.isNearBarrier) {
      contestabilityScore = Math.max(contestabilityScore, 0.85);
    }
    if (currentSlice.barrierState.isEffectivelyDecided) {
      contestabilityScore = 0.05;
    }
    const barrierReachability: BarrierReachabilityState = {
      priceToBeat,
      referencePrice,
      referenceSource,
      signedBarrierDistance,
      barrierDistanceRatio,
      dominantResolutionSide,
      contestabilityScore,
      requiredMovePerSecond,
      isReachable: !currentSlice.barrierState.isEffectivelyDecided && contestabilityScore >= 0.2,
      isEffectivelyDecided: currentSlice.barrierState.isEffectivelyDecided,
      reason: currentSlice.barrierState.decisionReason ?? "missing_barrier_inputs",
    };
    return barrierReachability;
  }

  private buildAnchorContext(context: PredictionContext): AnchorContextState {
    const btcSide = this.resolveOpportunitySide(context.crossAssetRegime.btcDirection);
    const ethSide = this.resolveOpportunitySide(context.crossAssetRegime.ethDirection);
    const anchorStrength = this.clamp((context.crossAssetRegime.breadthStrength + context.crossAssetRegime.synchronyScore) / 2, 0, 1);
    const followerSupport = this.clamp((context.crossAssetRegime.followerParticipation + context.crossAssetRegime.breadthParticipation) / 2, 0, 1);
    let isHardConflict = false;
    let reason: string | null = null;
    if (context.asset === "eth" && btcSide !== null && ethSide !== null && btcSide !== ethSide) {
      isHardConflict = true;
      reason = "eth_anchor_conflict";
    }
    if ((context.asset === "sol" || context.asset === "xrp") && (btcSide === null || ethSide === null || btcSide !== ethSide)) {
      isHardConflict = true;
      reason = "alt_anchor_conflict";
    }
    const anchorContext: AnchorContextState = {
      btcSide,
      ethSide,
      anchorStrength,
      followerSupport,
      isHardConflict,
      reason,
    };
    return anchorContext;
  }

  private resolveFactorScope(strategyId: string, family: OpportunityFactorSignal["scope"] | string): OpportunityFactorSignal["scope"] {
    let factorScope: OpportunityFactorSignal["scope"] = "timing";
    if (family === "microstructure") {
      factorScope = "microstructure";
    }
    if (family === "cross_asset") {
      factorScope = "anchor";
    }
    if (family === "pricing") {
      factorScope = strategyId === "s08" || strategyId === "s14" || strategyId === "s15" ? "reachability" : "pricing";
    }
    return factorScope;
  }

  private computeSideFactorEdge(factors: OpportunityFactorSignal[], side: OpportunitySide): number {
    const sideFactors = factors.filter((factor) => factor.targetSide === side);
    const weightSum = sideFactors.reduce((aggregatedWeight, factor) => aggregatedWeight + factor.weight, 0);
    const sideFactorEdge =
      weightSum === 0
        ? 0.5
        : this.clamp(sideFactors.reduce((aggregatedEdge, factor) => aggregatedEdge + factor.edgeScore * factor.weight, 0) / weightSum, 0, 1);
    return sideFactorEdge;
  }

  private resolveDirectionalAnchorConflict(asset: AssetSymbol, side: OpportunitySide, anchorContext: AnchorContextState): boolean {
    let isDirectionalAnchorConflict = false;
    if (asset === "eth") {
      isDirectionalAnchorConflict = anchorContext.btcSide !== null && side !== anchorContext.btcSide;
    }
    if (asset === "sol" || asset === "xrp") {
      isDirectionalAnchorConflict =
        anchorContext.btcSide === null || anchorContext.ethSide === null || anchorContext.btcSide !== anchorContext.ethSide || side !== anchorContext.btcSide;
    }
    return isDirectionalAnchorConflict;
  }

  private resolveLiveTokenPrice(currentSlice: MarketSnapshotSlice, side: OpportunitySide): number | null {
    const tokenMetrics = side === "up" ? currentSlice.up : currentSlice.down;
    const liveTokenPrice = tokenMetrics.midpoint ?? tokenMetrics.price;
    return liveTokenPrice;
  }

  private computeEntryQualityScore(currentSlice: MarketSnapshotSlice, side: OpportunitySide): number {
    const tokenMetrics = side === "up" ? currentSlice.up : currentSlice.down;
    const spreadScore = 1 - this.clamp((tokenMetrics.spread ?? config.MAX_SPREAD_FOR_ENTRY) / Math.max(config.MAX_SPREAD_FOR_ENTRY, 0.000_1), 0, 1);
    const depthScore = this.clamp(tokenMetrics.depthTop / Math.max(config.MIN_DEPTH_FOR_MAKER * 2, 1), 0, 1);
    const freshnessScore = tokenMetrics.ageMs === null ? 0.5 : 1 - this.clamp(tokenMetrics.ageMs / Math.max(config.TOKEN_MAX_AGE_MS * 2, 1), 0, 1);
    const entryQualityScore = this.clamp(currentSlice.quality.score * 0.45 + spreadScore * 0.25 + depthScore * 0.2 + freshnessScore * 0.1, 0, 1);
    return entryQualityScore;
  }

  private computeMicrostructureScore(currentSlice: MarketSnapshotSlice, side: OpportunitySide): number {
    const tokenMetrics = side === "up" ? currentSlice.up : currentSlice.down;
    const imbalanceScore = this.clamp(0.5 + tokenMetrics.imbalance * 0.5, 0, 1);
    const depthScore = this.clamp(tokenMetrics.depthTop / Math.max(config.MIN_DEPTH_FOR_MAKER * 2, 1), 0, 1);
    const spreadScore = 1 - this.clamp((tokenMetrics.spread ?? config.MAX_SPREAD_FOR_ENTRY) / Math.max(config.MAX_SPREAD_FOR_ENTRY, 0.000_1), 0, 1);
    const microstructureScore = this.clamp(imbalanceScore * 0.5 + depthScore * 0.25 + spreadScore * 0.25, 0, 1);
    return microstructureScore;
  }

  private computeAffordabilityScore(livePrice: number | null): number {
    const affordabilityScore =
      livePrice === null ? 0 : this.clamp(1 - Math.abs(livePrice - config.ENTRY_TARGET_PRICE) / Math.max(config.ENTRY_TARGET_PRICE, 0.000_1), 0, 1);
    return affordabilityScore;
  }

  private computeLateEntryPenalty(windowState: WindowState, contestabilityScore: number): number {
    let lateEntryPenalty = 0;
    if (windowState.phase === "late") {
      lateEntryPenalty = 0.18;
    }
    if (windowState.phase === "final") {
      lateEntryPenalty = 0.32;
    }
    lateEntryPenalty += (1 - contestabilityScore) * 0.18;
    return this.clamp(lateEntryPenalty, 0, 0.65);
  }

  private buildTokenOpportunity(
    currentSlice: MarketSnapshotSlice,
    side: OpportunitySide,
    barrierReachability: BarrierReachabilityState,
    anchorContext: AnchorContextState,
    windowState: WindowState,
    factors: OpportunityFactorSignal[],
  ): TokenOpportunityState {
    const livePrice = this.resolveLiveTokenPrice(currentSlice, side);
    const entryQualityScore = this.computeEntryQualityScore(currentSlice, side);
    const microstructureScore = this.computeMicrostructureScore(currentSlice, side);
    const affordabilityScore = this.computeAffordabilityScore(livePrice);
    const factorEdge = this.computeSideFactorEdge(factors, side);
    const barrierAlignmentScore = barrierReachability.dominantResolutionSide === null ? 0.5 : barrierReachability.dominantResolutionSide === side ? 0.85 : 0.2;
    const hasDirectionalAnchorConflict = this.resolveDirectionalAnchorConflict(currentSlice.asset, side, anchorContext);
    const anchorAdjustment = hasDirectionalAnchorConflict ? -0.25 : anchorContext.anchorStrength * 0.12;
    const lateEntryPenalty = this.computeLateEntryPenalty(windowState, barrierReachability.contestabilityScore);
    const expectedPathScore = this.clamp(
      factorEdge * 0.34 +
        entryQualityScore * 0.18 +
        microstructureScore * 0.16 +
        affordabilityScore * 0.1 +
        barrierReachability.contestabilityScore * 0.14 +
        barrierAlignmentScore * 0.08 +
        anchorAdjustment -
        lateEntryPenalty,
      0,
      1,
    );
    const tpDistance = livePrice === null ? null : Math.max(0, Math.min(0.99, livePrice + config.TAKE_PROFIT_DELTA) - livePrice);
    const slDistance = livePrice === null ? null : Math.max(0, livePrice - Math.max(0.01, livePrice - config.STOP_LOSS_DELTA));
    const tpBeforeSlScore = this.clamp(
      expectedPathScore * 0.58 +
        entryQualityScore * 0.14 +
        barrierReachability.contestabilityScore * 0.14 +
        microstructureScore * 0.08 +
        affordabilityScore * 0.06,
      0,
      1,
    );
    const tokenOpportunity: TokenOpportunityState = {
      side,
      livePrice,
      entryQualityScore,
      tpDistance,
      slDistance,
      tpBeforeSlScore,
      lateEntryPenalty,
      affordabilityScore,
      microstructureScore,
      expectedPathScore,
    };
    return tokenOpportunity;
  }

  /**
   * @section public:methods
   */

  public buildFactorSignals(
    context: PredictionContext,
    strategyBreakdown: Array<{
      strategyId: string;
      name: string;
      tier: OpportunityFactorSignal["tier"];
      family: string;
      direction: "UP" | "DOWN";
      score: number;
      confidence: number;
      weight: number;
      reason: string | null;
      debug: Record<string, number | string | boolean | null>;
    }>,
  ): OpportunityFactorSignal[] {
    const factorSignals = strategyBreakdown.map((strategySignal) => {
      const targetSide: OpportunitySide = strategySignal.direction === "UP" ? "up" : "down";
      return {
        factorId: strategySignal.strategyId,
        marketKey: context.marketKey,
        name: strategySignal.name,
        tier: strategySignal.tier,
        scope: this.resolveFactorScope(strategySignal.strategyId, strategySignal.family),
        targetSide,
        edgeScore: this.clamp(Math.abs(strategySignal.score), 0, 1),
        confidence: strategySignal.confidence,
        weight: strategySignal.weight,
        reason: strategySignal.reason,
        debug: strategySignal.debug,
      };
    });
    return factorSignals;
  }

  public buildMarketOpportunityState(context: PredictionContext, factors: OpportunityFactorSignal[]): MarketOpportunityState {
    const windowState = this.buildWindowState(context.current);
    const barrierReachability = this.buildBarrierReachability(context.current);
    const anchorContext = this.buildAnchorContext(context);
    const upOpportunity = this.buildTokenOpportunity(context.current, "up", barrierReachability, anchorContext, windowState, factors);
    const downOpportunity = this.buildTokenOpportunity(context.current, "down", barrierReachability, anchorContext, windowState, factors);
    const bestOpportunity = upOpportunity.tpBeforeSlScore >= downOpportunity.tpBeforeSlScore ? upOpportunity : downOpportunity;
    const hasOpportunity =
      barrierReachability.isReachable && !anchorContext.isHardConflict && bestOpportunity.tpBeforeSlScore >= 0.55 && windowState.phase !== "final";
    const marketOpportunityState: MarketOpportunityState = {
      marketKey: context.marketKey,
      asset: context.asset,
      window: context.window,
      windowState,
      barrierReachability,
      anchorContext,
      upOpportunity,
      downOpportunity,
      recommendedSide: hasOpportunity ? bestOpportunity.side : null,
      recommendedSideScore: bestOpportunity.tpBeforeSlScore,
      hasOpportunity,
      reason: hasOpportunity
        ? `recommended_${bestOpportunity.side}`
        : anchorContext.isHardConflict
          ? (anchorContext.reason ?? "anchor_conflict")
          : barrierReachability.isReachable
            ? "insufficient_token_edge"
            : barrierReachability.reason,
    };
    return marketOpportunityState;
  }
}
