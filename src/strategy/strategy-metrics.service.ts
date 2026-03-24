/**
 * @section imports:internals
 */

import config from "../config.ts";
import type { MarketKey, PredictionDirection } from "../market/market.types.ts";
import type { StrategyDefinition, StrategyMetricsRecord, StrategySignal, StrategySummary, StrategyTier } from "./strategy.types.ts";

/**
 * @section types
 */

type MetricsSource = "research" | "execution";
type StrategyOutcomeEntry = {
  wasCorrect: boolean | null;
  signedEdge: number;
  calibrationError: number;
  resolvedAt: number | null;
};

type MutableMetricsState = {
  outcomes: StrategyOutcomeEntry[];
  lastParticipatedAt: number | null;
};

type StrategyMetricsScope = "global" | MarketKey;

/**
 * @section class
 */

export class StrategyMetricsService {
  /**
   * @section private:attributes
   */

  private readonly definitions: StrategyDefinition[];
  private readonly globalResearchState: Map<string, MutableMetricsState>;
  private readonly marketResearchState: Map<string, MutableMetricsState>;
  private readonly globalExecutionState: Map<string, MutableMetricsState>;
  private readonly marketExecutionState: Map<string, MutableMetricsState>;

  /**
   * @section constructor
   */

  public constructor(definitions: StrategyDefinition[]) {
    this.definitions = definitions;
    this.globalResearchState = this.createInitialState(definitions);
    this.marketResearchState = new Map<string, MutableMetricsState>();
    this.globalExecutionState = this.createInitialState(definitions);
    this.marketExecutionState = new Map<string, MutableMetricsState>();
  }

  /**
   * @section private:methods
   */

  private createInitialState(definitions: StrategyDefinition[]): Map<string, MutableMetricsState> {
    const mutableState = new Map<string, MutableMetricsState>();
    for (const definition of definitions) {
      mutableState.set(definition.strategyId, {
        outcomes: [],
        lastParticipatedAt: null,
      });
    }
    return mutableState;
  }

  private createMarketStateKey(strategyId: string, marketKey: MarketKey): string {
    const marketStateKey = `${marketKey}:${strategyId}`;
    return marketStateKey;
  }

  private resolveStateMap(scope: StrategyMetricsScope, source: MetricsSource): Map<string, MutableMetricsState> {
    let targetStateMap = source === "research" ? this.globalResearchState : this.globalExecutionState;
    if (scope !== "global") {
      targetStateMap = source === "research" ? this.marketResearchState : this.marketExecutionState;
    }
    return targetStateMap;
  }

  private requireState(strategyId: string, scope: StrategyMetricsScope, source: MetricsSource): MutableMetricsState {
    const stateKey = scope === "global" ? strategyId : this.createMarketStateKey(strategyId, scope);
    const targetStateMap = this.resolveStateMap(scope, source);
    let strategyState = targetStateMap.get(stateKey);
    if (!strategyState) {
      const createdState: MutableMetricsState = {
        outcomes: [],
        lastParticipatedAt: null,
      };
      targetStateMap.set(stateKey, createdState);
      strategyState = createdState;
    }
    return strategyState;
  }

  private getSummary(strategyId: string, scope: StrategyMetricsScope): StrategySummary {
    const strategyDefinition = this.requireDefinition(strategyId);
    const researchRecord = this.buildMetricsRecord(strategyId, strategyDefinition.tier, scope, "research");
    const executionRecord = this.buildMetricsRecord(strategyId, strategyDefinition.tier, scope, "execution");
    return {
      strategyId,
      name: strategyDefinition.name,
      tier: strategyDefinition.tier,
      description: strategyDefinition.description,
      marketKey: scope === "global" ? null : scope,
      weight: researchRecord.weight,
      isEnabled: true,
      totalResolved: researchRecord.totalResolved,
      executionTotalResolved: executionRecord.totalResolved,
      wins: researchRecord.wins,
      losses: researchRecord.losses,
      voids: researchRecord.voids,
      hitRate: researchRecord.hitRate,
      cumulativePnlProxy: researchRecord.cumulativePnlProxy,
      averagePnlProxy: researchRecord.averagePnlProxy,
      executionHitRate: executionRecord.hitRate,
      executionAveragePnlProxy: executionRecord.averagePnlProxy,
      averageSignedEdge: researchRecord.averageSignedEdge,
      averageCalibrationError: researchRecord.averageCalibrationError,
      recentStreak: researchRecord.recentStreak,
      lastResolvedAt: researchRecord.lastResolvedAt,
      lastParticipatedAt: researchRecord.lastParticipatedAt,
    };
  }

  private requireDefinition(strategyId: string): StrategyDefinition {
    const strategyDefinition = this.definitions.find((definition) => definition.strategyId === strategyId);
    if (!strategyDefinition) {
      throw new Error(`Missing strategy definition for ${strategyId}`);
    }
    return strategyDefinition;
  }

  private buildMetricsRecord(strategyId: string, tier: StrategyTier, scope: StrategyMetricsScope, source: MetricsSource): StrategyMetricsRecord {
    const mutableMetricsState = this.requireState(strategyId, scope, source);
    const windowedOutcomes = this.readWindowedOutcomes(mutableMetricsState);
    const resolvedOutcomes = windowedOutcomes.filter((outcome) => outcome.wasCorrect !== null);
    const wins = resolvedOutcomes.filter((outcome) => outcome.wasCorrect).length;
    const losses = resolvedOutcomes.filter((outcome) => outcome.wasCorrect === false).length;
    const voids = windowedOutcomes.length - resolvedOutcomes.length;
    const totalResolved = resolvedOutcomes.length;
    const hitRate = totalResolved === 0 ? 0.5 : wins / totalResolved;
    const cumulativePnlProxy = resolvedOutcomes.reduce((totalPnlProxy, outcome) => totalPnlProxy + outcome.signedEdge, 0);
    const averagePnlProxy = totalResolved === 0 ? 0 : cumulativePnlProxy / totalResolved;
    const averageSignedEdge = totalResolved === 0 ? 0 : resolvedOutcomes.reduce((totalEdge, outcome) => totalEdge + outcome.signedEdge, 0) / totalResolved;
    const averageCalibrationError =
      windowedOutcomes.length === 0
        ? 0.5
        : windowedOutcomes.reduce((totalError, outcome) => totalError + outcome.calibrationError, 0) / windowedOutcomes.length;
    const recentStreak = this.computeRecentStreak(resolvedOutcomes);
    const trustFactor = Math.min(1, totalResolved / 10);
    const baseWeight = this.readBaseWeight(tier);
    const adaptiveWeight = baseWeight + ((hitRate - 0.5) * 1.6 + averageSignedEdge * 0.8 - averageCalibrationError * 0.25) * trustFactor;
    const weight = Math.max(0.2, Math.min(2.5, adaptiveWeight));
    const lastResolvedAt = windowedOutcomes.length === 0 ? null : (windowedOutcomes[windowedOutcomes.length - 1]?.resolvedAt ?? null);
    return {
      strategyId,
      totalResolved,
      wins,
      losses,
      voids,
      hitRate,
      cumulativePnlProxy,
      averagePnlProxy,
      averageSignedEdge,
      averageCalibrationError,
      recentStreak,
      lastResolvedAt,
      lastParticipatedAt: mutableMetricsState.lastParticipatedAt,
      weight,
    };
  }

  private computeRecentStreak(outcomes: StrategyOutcomeEntry[]): number {
    let recentStreak = 0;
    for (let index = outcomes.length - 1; index >= 0; index -= 1) {
      const outcome = outcomes[index];
      if (!outcome || outcome.wasCorrect === null) {
        continue;
      }
      if (outcome.wasCorrect) {
        if (recentStreak >= 0) {
          recentStreak += 1;
        } else {
          break;
        }
      }
      if (outcome.wasCorrect === false) {
        if (recentStreak <= 0) {
          recentStreak -= 1;
        } else {
          break;
        }
      }
    }
    return recentStreak;
  }

  private readBaseWeight(tier: StrategyTier): number {
    let baseWeight = 1;
    if (tier === "medium") {
      baseWeight = 0.9;
    }
    if (tier === "high") {
      baseWeight = 0.8;
    }
    return baseWeight;
  }

  private compareSummaries(leftSummary: StrategySummary, rightSummary: StrategySummary): number {
    let comparison = rightSummary.weight - leftSummary.weight;
    if (comparison === 0) {
      comparison = rightSummary.hitRate - leftSummary.hitRate;
    }
    if (comparison === 0) {
      comparison = rightSummary.executionHitRate - leftSummary.executionHitRate;
    }
    if (comparison === 0) {
      comparison = rightSummary.averageSignedEdge - leftSummary.averageSignedEdge;
    }
    if (comparison === 0) {
      comparison = leftSummary.averageCalibrationError - rightSummary.averageCalibrationError;
    }
    if (comparison === 0) {
      comparison = rightSummary.recentStreak - leftSummary.recentStreak;
    }
    return comparison;
  }

  private readRollingCutoff(mutableMetricsState: MutableMetricsState): number | null {
    const latestResolvedAt =
      mutableMetricsState.outcomes.length === 0 ? null : (mutableMetricsState.outcomes[mutableMetricsState.outcomes.length - 1]?.resolvedAt ?? null);
    const rollingCutoff = latestResolvedAt === null ? null : latestResolvedAt - config.STRATEGY_ROLLING_WINDOW_SECONDS * 1_000;
    return rollingCutoff;
  }

  private readWindowedOutcomes(mutableMetricsState: MutableMetricsState): StrategyOutcomeEntry[] {
    const rollingCutoff = this.readRollingCutoff(mutableMetricsState);
    const windowedOutcomes =
      rollingCutoff === null
        ? [...mutableMetricsState.outcomes]
        : mutableMetricsState.outcomes.filter((outcome) => outcome.resolvedAt === null || outcome.resolvedAt >= rollingCutoff);
    return windowedOutcomes;
  }

  private recordOutcomeEntry(
    mutableMetricsState: MutableMetricsState,
    wasCorrect: boolean | null,
    signedEdge: number,
    calibrationError: number,
    resolvedAt: number | null,
  ): void {
    mutableMetricsState.outcomes.push({
      wasCorrect,
      signedEdge,
      calibrationError,
      resolvedAt,
    });
    const rollingCutoff = this.readRollingCutoff(mutableMetricsState);
    if (rollingCutoff !== null) {
      mutableMetricsState.outcomes = mutableMetricsState.outcomes.filter((outcome) => outcome.resolvedAt === null || outcome.resolvedAt >= rollingCutoff);
    }
  }

  /**
   * @section public:methods
   */

  public getMarketWeight(strategyId: string, marketKey: MarketKey): number {
    const strategySummary = this.getSummary(strategyId, marketKey);
    return strategySummary.weight;
  }

  public markParticipated(marketKey: MarketKey, strategySignals: StrategySignal[], participatedAt: number): void {
    for (const strategySignal of strategySignals) {
      if (strategySignal.didRun) {
        const globalState = this.requireState(strategySignal.strategyId, "global", "research");
        const marketState = this.requireState(strategySignal.strategyId, marketKey, "research");
        globalState.lastParticipatedAt = participatedAt;
        marketState.lastParticipatedAt = participatedAt;
      }
    }
  }

  public recordResolution(
    marketKey: MarketKey,
    strategySignals: StrategySignal[],
    resolvedDirection: PredictionDirection | null,
    resolvedAt: number | null,
    source: MetricsSource,
  ): void {
    for (const strategySignal of strategySignals) {
      const wasCorrect = resolvedDirection === null ? null : strategySignal.direction === resolvedDirection;
      const signedEdge =
        resolvedDirection === null ? 0 : strategySignal.direction === resolvedDirection ? strategySignal.confidence : strategySignal.confidence * -1;
      const targetConfidence = wasCorrect === null ? strategySignal.confidence : wasCorrect ? 1 : 0;
      const calibrationError = Math.abs(strategySignal.confidence - targetConfidence);
      this.recordOutcomeEntry(this.requireState(strategySignal.strategyId, "global", source), wasCorrect, signedEdge, calibrationError, resolvedAt);
      this.recordOutcomeEntry(this.requireState(strategySignal.strategyId, marketKey, source), wasCorrect, signedEdge, calibrationError, resolvedAt);
    }
  }

  public getSummaries(marketKey?: MarketKey): StrategySummary[] {
    const scope: StrategyMetricsScope = marketKey ?? "global";
    const strategySummaries = this.definitions
      .map((definition) => this.getSummary(definition.strategyId, scope))
      .sort((leftSummary, rightSummary) => {
        return this.compareSummaries(leftSummary, rightSummary);
      });
    return strategySummaries;
  }
}
