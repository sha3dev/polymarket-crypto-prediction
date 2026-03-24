/**
 * @section imports:internals
 */

import config from "../config.ts";
import type { PredictionContext, PredictionDirection } from "../market/market.types.ts";
import type { StrategyMetricsService } from "./strategy-metrics.service.ts";
import type { StrategyDefinition, StrategyEvaluationResult, StrategySignal, StrategyTier } from "./strategy.types.ts";

/**
 * @section class
 */

export class StrategyEngineService {
  /**
   * @section private:attributes
   */

  private readonly strategyMetricsService: StrategyMetricsService;
  private readonly strategyDefinitions: StrategyDefinition[];

  /**
   * @section constructor
   */

  public constructor(strategyMetricsService: StrategyMetricsService) {
    this.strategyMetricsService = strategyMetricsService;
    this.strategyDefinitions = this.createDefinitions();
  }

  /**
   * @section private:methods
   */

  private createDefinitions(): StrategyDefinition[] {
    const strategyDefinitions: StrategyDefinition[] = [
      { strategyId: "s01", name: "Momentum EWMA", tier: "low", description: "Short drift continuation." },
      { strategyId: "s02", name: "Token Microprice", tier: "low", description: "Top-of-book pressure." },
      { strategyId: "s03", name: "Token Imbalance Band", tier: "medium", description: "Multi-level depth skew." },
      { strategyId: "s04", name: "Wall Proximity", tier: "medium", description: "Liquidity barrier bias." },
      { strategyId: "s05", name: "Order Book Churn", tier: "medium", description: "Book rotation pressure." },
      { strategyId: "s06", name: "No-Arb Consistency", tier: "low", description: "UP and DOWN consistency." },
      { strategyId: "s07", name: "Spread Compression", tier: "low", description: "Liquidity improvement momentum." },
      { strategyId: "s08", name: "Barrier Timing", tier: "low", description: "Price-to-beat barrier." },
      { strategyId: "s09", name: "Spot Consensus Momentum", tier: "low", description: "Cross-venue spot drift." },
      { strategyId: "s10", name: "Spot Micropressure", tier: "medium", description: "Spot top-of-book skew." },
      { strategyId: "s11", name: "Spot Dispersion", tier: "medium", description: "Noise versus confirmation." },
      { strategyId: "s12", name: "Volatility Breakout", tier: "medium", description: "Regime breakout." },
      { strategyId: "s13", name: "Spot Slippage Skew", tier: "medium", description: "Book slope asymmetry." },
      { strategyId: "s14", name: "Chainlink Basis", tier: "low", description: "Oracle catch-up." },
      { strategyId: "s15", name: "Theoretical Probability Gap", tier: "medium", description: "Token versus barrier." },
      { strategyId: "s16", name: "Freshness Gap", tier: "low", description: "Spot leads stale token." },
      { strategyId: "s17", name: "Regime Switch", tier: "medium", description: "Time plus liquidity regime." },
      { strategyId: "s18", name: "Liquidity Shock Fade", tier: "medium", description: "Short mean reversion." },
      { strategyId: "s19", name: "Recent Performance Hedge", tier: "high", description: "Meta performance hedge." },
      { strategyId: "s20", name: "Online Logistic Blend", tier: "high", description: "Feature-weighted blend." },
    ];
    return strategyDefinitions;
  }

  private evaluateTier(tier: StrategyTier, context: PredictionContext, priorSignals: StrategySignal[]): StrategySignal[] {
    const strategySignals: StrategySignal[] = [];
    for (const definition of this.strategyDefinitions.filter((strategyDefinition) => strategyDefinition.tier === tier)) {
      strategySignals.push(this.evaluateDefinition(definition, context, priorSignals));
    }
    return strategySignals;
  }

  private evaluateDefinition(definition: StrategyDefinition, context: PredictionContext, priorSignals: StrategySignal[]): StrategySignal {
    const rawScore = this.computeScore(definition.strategyId, context, priorSignals);
    const qualityFactor = context.current.quality.score;
    const weightedScore = rawScore * qualityFactor;
    const direction: PredictionDirection = weightedScore >= 0 ? "UP" : "DOWN";
    const rawConfidence = 0.5 + Math.min(0.49, Math.abs(weightedScore));
    const confidence = Math.max(0.5, Math.min(0.99, rawConfidence));
    const weight = this.strategyMetricsService.getMarketWeight(definition.strategyId, context.marketKey);
    return {
      strategyId: definition.strategyId,
      name: definition.name,
      tier: definition.tier,
      direction,
      score: weightedScore,
      confidence,
      weight,
      qualityFactor,
      didRun: qualityFactor > 0,
      didParticipate: qualityFactor > 0,
      reason: qualityFactor > 0 ? null : "quality_gate",
      debug: this.buildDebug(definition.strategyId, context, priorSignals, weightedScore),
    };
  }

  private aggregateSignals(
    strategySignals: StrategySignal[],
    qualityScore: number,
  ): Pick<StrategyEvaluationResult, "finalDirection" | "finalConfidence" | "weightedScore" | "strategyBreakdown"> {
    const participantSignals = strategySignals.filter((strategySignal) => strategySignal.didParticipate);
    const totalWeight = participantSignals.reduce((aggregatedWeight, strategySignal) => aggregatedWeight + strategySignal.weight, 0);
    const weightedScore =
      totalWeight === 0
        ? 0
        : participantSignals.reduce((aggregatedScore, strategySignal) => aggregatedScore + strategySignal.score * strategySignal.weight, 0) / totalWeight;
    const finalDirection: PredictionDirection = weightedScore >= 0 ? "UP" : "DOWN";
    const rawConfidence = 0.5 + Math.min(0.49, Math.abs(weightedScore) * Math.max(0.2, qualityScore));
    const finalConfidence = Math.max(0.5, Math.min(0.99, rawConfidence));
    return { finalDirection, finalConfidence, weightedScore, strategyBreakdown: strategySignals };
  }

  private shouldEscalate(finalConfidence: number, weightedScore: number): boolean {
    const shouldEscalate =
      finalConfidence < config.ENSEMBLE_MEDIUM_CONFIDENCE_THRESHOLD || Math.abs(weightedScore) < config.ENSEMBLE_SCORE_ESCALATION_THRESHOLD;
    return shouldEscalate;
  }

  private buildDebug(
    strategyId: string,
    context: PredictionContext,
    priorSignals: StrategySignal[],
    weightedScore: number,
  ): Record<string, number | string | boolean | null> {
    const latestHistory = context.history[context.history.length - 1] ?? null;
    return {
      qualityScore: context.current.quality.score,
      upMidpoint: context.current.up.midpoint,
      downMidpoint: context.current.down.midpoint,
      spotConsensusPrice: context.current.spotConsensusPrice,
      priceToBeat: context.current.priceToBeat,
      historySize: context.history.length,
      priorSignalCount: priorSignals.length,
      lastQualityScore: latestHistory?.qualityScore ?? null,
      finalScoreHint: weightedScore,
      strategyId,
    };
  }

  private computeScore(strategyId: string, context: PredictionContext, priorSignals: StrategySignal[]): number {
    let score = 0;
    if (strategyId === "s01") {
      score = this.scoreMomentumEwma(context);
    }
    if (strategyId === "s02") {
      score = this.scoreTokenMicroprice(context);
    }
    if (strategyId === "s03") {
      score = this.scoreTokenImbalanceBand(context);
    }
    if (strategyId === "s04") {
      score = this.scoreWallProximity(context);
    }
    if (strategyId === "s05") {
      score = this.scoreOrderBookChurn(context);
    }
    if (strategyId === "s06") {
      score = this.scoreNoArbConsistency(context);
    }
    if (strategyId === "s07") {
      score = this.scoreSpreadCompression(context);
    }
    if (strategyId === "s08") {
      score = this.scoreBarrierTiming(context);
    }
    if (strategyId === "s09") {
      score = this.scoreSpotConsensusMomentum(context);
    }
    if (strategyId === "s10") {
      score = this.scoreSpotMicropressure(context);
    }
    if (strategyId === "s11") {
      score = this.scoreSpotDispersion(context);
    }
    if (strategyId === "s12") {
      score = this.scoreVolatilityBreakout(context);
    }
    if (strategyId === "s13") {
      score = this.scoreSpotSlippageSkew(context);
    }
    if (strategyId === "s14") {
      score = this.scoreChainlinkBasis(context);
    }
    if (strategyId === "s15") {
      score = this.scoreTheoreticalProbabilityGap(context);
    }
    if (strategyId === "s16") {
      score = this.scoreFreshnessGap(context);
    }
    if (strategyId === "s17") {
      score = this.scoreRegimeSwitch(context);
    }
    if (strategyId === "s18") {
      score = this.scoreLiquidityShockFade(context);
    }
    if (strategyId === "s19") {
      score = this.scoreRecentPerformanceHedge(priorSignals);
    }
    if (strategyId === "s20") {
      score = this.scoreOnlineLogisticBlend(context, priorSignals);
    }
    return score;
  }

  private scoreMomentumEwma(context: PredictionContext): number {
    const recentUpMidpoints = context.history
      .slice(-8)
      .map((entry) => entry.upMidpoint)
      .filter((value) => value !== null) as number[];
    let score = 0;
    if (recentUpMidpoints.length >= 2) {
      const firstPrice = recentUpMidpoints[0] ?? 0;
      const lastPrice = recentUpMidpoints[recentUpMidpoints.length - 1] ?? 0;
      const averagePrice = recentUpMidpoints.reduce((aggregatedPrice, price) => aggregatedPrice + price, 0) / recentUpMidpoints.length;
      score = averagePrice === 0 ? 0 : (lastPrice - firstPrice) / averagePrice;
    }
    return score;
  }

  private scoreTokenMicroprice(context: PredictionContext): number {
    const score =
      context.current.up.imbalance -
      context.current.down.imbalance +
      (context.current.up.distanceToHalf ?? 0) * -0.2 +
      (context.current.down.distanceToHalf ?? 0) * 0.2;
    return score;
  }

  private scoreTokenImbalanceBand(context: PredictionContext): number {
    const score = (context.current.up.depthTop - context.current.down.depthTop) / Math.max(1, context.current.up.depthTop + context.current.down.depthTop);
    return score;
  }

  private scoreWallProximity(context: PredictionContext): number {
    const score = (context.current.down.spread ?? 0) - (context.current.up.spread ?? 0) + (context.current.up.depthTop - context.current.down.depthTop) * 0.001;
    return score;
  }

  private scoreOrderBookChurn(context: PredictionContext): number {
    const previousEntry = context.history[context.history.length - 2] ?? null;
    const upMidpointChange =
      previousEntry?.upMidpoint === null || previousEntry?.upMidpoint === undefined || context.current.up.midpoint === null
        ? 0
        : context.current.up.midpoint - previousEntry.upMidpoint;
    const downMidpointChange =
      previousEntry?.downMidpoint === null || previousEntry?.downMidpoint === undefined || context.current.down.midpoint === null
        ? 0
        : context.current.down.midpoint - previousEntry.downMidpoint;
    const score = upMidpointChange - downMidpointChange;
    return score;
  }

  private scoreNoArbConsistency(context: PredictionContext): number {
    const upProbability = context.current.up.midpoint ?? context.current.up.price ?? 0.5;
    const downProbability = context.current.down.midpoint ?? context.current.down.price ?? 0.5;
    const score = 1 - downProbability - upProbability;
    return score * -1;
  }

  private scoreSpreadCompression(context: PredictionContext): number {
    const score = (context.current.down.spread ?? 0) - (context.current.up.spread ?? 0) + context.current.spotMomentum * 40;
    return score;
  }

  private scoreBarrierTiming(context: PredictionContext): number {
    const chainlinkPrice = context.current.chainlinkPrice;
    const priceToBeat = context.current.priceToBeat;
    let score = 0;
    if (chainlinkPrice !== null && priceToBeat !== null && priceToBeat !== 0) {
      score = (chainlinkPrice - priceToBeat) / priceToBeat;
    }
    return score;
  }

  private scoreSpotConsensusMomentum(context: PredictionContext): number {
    const score = context.current.spotMomentum * 100;
    return score;
  }

  private scoreSpotMicropressure(context: PredictionContext): number {
    const aggregatedImbalance =
      context.current.spotVenues.reduce((totalImbalance, spotVenue) => totalImbalance + spotVenue.imbalance, 0) /
      Math.max(1, context.current.spotVenues.length);
    return aggregatedImbalance;
  }

  private scoreSpotDispersion(context: PredictionContext): number {
    const score = context.current.spotMomentum >= 0 ? context.current.spotDispersion * -1 : context.current.spotDispersion;
    return score;
  }

  private scoreVolatilityBreakout(context: PredictionContext): number {
    const recentChanges = context.history.slice(-12).map((entry, index, entries) => {
      const previousEntry = index === 0 ? null : entries[index - 1];
      let change = 0;
      if (previousEntry?.upMidpoint !== null && previousEntry?.upMidpoint !== undefined && entry.upMidpoint !== null) {
        change = entry.upMidpoint - previousEntry.upMidpoint;
      }
      return change;
    });
    const averageAbsChange = recentChanges.reduce((totalChange, change) => totalChange + Math.abs(change), 0) / Math.max(1, recentChanges.length);
    const score = averageAbsChange === 0 ? 0 : this.scoreMomentumEwma(context) / averageAbsChange;
    return score;
  }

  private scoreSpotSlippageSkew(context: PredictionContext): number {
    const score = context.current.spotVenues.reduce((totalSpread, spotVenue) => totalSpread + (spotVenue.spread ?? 0), 0) * -0.25;
    return score;
  }

  private scoreChainlinkBasis(context: PredictionContext): number {
    let score = 0;
    if (context.current.chainlinkPrice !== null && context.current.spotConsensusPrice !== null && context.current.chainlinkPrice !== 0) {
      score = (context.current.spotConsensusPrice - context.current.chainlinkPrice) / context.current.chainlinkPrice;
    }
    return score;
  }

  private scoreTheoreticalProbabilityGap(context: PredictionContext): number {
    let theoreticalProbability = 0.5;
    if (context.current.chainlinkPrice !== null && context.current.priceToBeat !== null) {
      theoreticalProbability = context.current.chainlinkPrice >= context.current.priceToBeat ? 0.55 : 0.45;
    }
    const observedProbability = context.current.up.midpoint ?? context.current.up.price ?? 0.5;
    return theoreticalProbability - observedProbability;
  }

  private scoreFreshnessGap(context: PredictionContext): number {
    const tokenAge = Math.max(context.current.up.ageMs ?? 0, context.current.down.ageMs ?? 0);
    const bestSpotAge = Math.min(
      ...context.current.spotVenues
        .map((spotVenue) => spotVenue.ageMs)
        .filter((ageMs) => ageMs !== null)
        .map((ageMs) => ageMs as number),
      config.SPOT_MAX_AGE_MS,
    );
    const freshnessGap = tokenAge - bestSpotAge;
    const score = freshnessGap <= 0 ? 0 : context.current.spotMomentum * Math.min(5, freshnessGap / 1000);
    return score;
  }

  private scoreRegimeSwitch(context: PredictionContext): number {
    const isLiquidityStrong = context.current.up.depthTop + context.current.down.depthTop > 40;
    const score = isLiquidityStrong ? this.scoreMomentumEwma(context) : this.scoreLiquidityShockFade(context);
    return score;
  }

  private scoreLiquidityShockFade(context: PredictionContext): number {
    const score = (context.current.up.distanceToHalf ?? 0.5) - (context.current.down.distanceToHalf ?? 0.5);
    return score * -1;
  }

  private scoreRecentPerformanceHedge(priorSignals: StrategySignal[]): number {
    const averageWeightedConfidence =
      priorSignals.length === 0
        ? 0
        : priorSignals.reduce(
            (aggregatedConfidence, strategySignal) =>
              aggregatedConfidence + (strategySignal.direction === "UP" ? strategySignal.confidence : strategySignal.confidence * -1),
            0,
          ) / priorSignals.length;
    return averageWeightedConfidence;
  }

  private scoreOnlineLogisticBlend(context: PredictionContext, priorSignals: StrategySignal[]): number {
    const priorSignalBias =
      priorSignals.length === 0 ? 0 : priorSignals.reduce((aggregatedScore, strategySignal) => aggregatedScore + strategySignal.score, 0) / priorSignals.length;
    const score =
      this.scoreMomentumEwma(context) * 0.3 +
      this.scoreSpotConsensusMomentum(context) * 0.25 +
      this.scoreTokenMicroprice(context) * 0.2 +
      this.scoreBarrierTiming(context) * 0.15 +
      priorSignalBias * 0.1;
    return score;
  }

  /**
   * @section public:methods
   */

  public getDefinitions(): StrategyDefinition[] {
    return [...this.strategyDefinitions];
  }

  public evaluate(context: PredictionContext): StrategyEvaluationResult {
    const lowSignals = this.evaluateTier("low", context, []);
    const lowAggregate = this.aggregateSignals(lowSignals, context.current.quality.score);
    const shouldEscalateToMedium = this.shouldEscalate(lowAggregate.finalConfidence, lowAggregate.weightedScore);
    const mediumSignals = shouldEscalateToMedium ? this.evaluateTier("medium", context, lowSignals) : [];
    const mediumAggregate = this.aggregateSignals([...lowSignals, ...mediumSignals], context.current.quality.score);
    const shouldEscalateToHigh = this.shouldEscalate(mediumAggregate.finalConfidence, mediumAggregate.weightedScore);
    const highSignals = shouldEscalateToHigh ? this.evaluateTier("high", context, [...lowSignals, ...mediumSignals]) : [];
    const aggregate = this.aggregateSignals([...lowSignals, ...mediumSignals, ...highSignals], context.current.quality.score);
    return {
      marketKey: context.marketKey,
      finalDirection: aggregate.finalDirection,
      finalConfidence: aggregate.finalConfidence,
      weightedScore: aggregate.weightedScore,
      baseWeightedScore: aggregate.weightedScore,
      adjustedWeightedScore: aggregate.weightedScore,
      baseConfidence: aggregate.finalConfidence,
      adjustedConfidence: aggregate.finalConfidence,
      strategyBreakdown: aggregate.strategyBreakdown,
      qualityScore: context.current.quality.score,
      escalatedToMedium: shouldEscalateToMedium,
      escalatedToHigh: shouldEscalateToHigh,
      context,
    };
  }
}
