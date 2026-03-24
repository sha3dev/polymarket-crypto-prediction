/**
 * @section imports:internals
 */

import config from "../config.ts";
import type { PredictionDirection } from "../market/market.types.ts";
import type { StrategyDefinition, StrategyMetricsRecord, StrategySignal, StrategySummary, StrategyTier } from "./strategy.types.ts";

/**
 * @section types
 */

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

/**
 * @section class
 */

export class StrategyMetricsService {
  /**
   * @section private:attributes
   */

  private readonly definitions: StrategyDefinition[];
  private readonly mutableState: Map<string, MutableMetricsState>;

  /**
   * @section constructor
   */

  public constructor(definitions: StrategyDefinition[]) {
    this.definitions = definitions;
    this.mutableState = this.createInitialState(definitions);
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

  private requireState(strategyId: string): MutableMetricsState {
    const strategyState = this.mutableState.get(strategyId);
    if (!strategyState) {
      throw new Error(`Missing strategy state for ${strategyId}`);
    }
    return strategyState;
  }

  private getSummary(strategyId: string): StrategySummary {
    const strategyDefinition = this.requireDefinition(strategyId);
    const strategyRecord = this.buildMetricsRecord(strategyId, strategyDefinition.tier);
    return {
      strategyId,
      name: strategyDefinition.name,
      tier: strategyDefinition.tier,
      weight: strategyRecord.weight,
      isEnabled: true,
      totalResolved: strategyRecord.totalResolved,
      wins: strategyRecord.wins,
      losses: strategyRecord.losses,
      voids: strategyRecord.voids,
      hitRate: strategyRecord.hitRate,
      averageSignedEdge: strategyRecord.averageSignedEdge,
      averageCalibrationError: strategyRecord.averageCalibrationError,
      recentStreak: strategyRecord.recentStreak,
      lastResolvedAt: strategyRecord.lastResolvedAt,
      lastParticipatedAt: strategyRecord.lastParticipatedAt,
    };
  }

  private requireDefinition(strategyId: string): StrategyDefinition {
    const strategyDefinition = this.definitions.find((definition) => definition.strategyId === strategyId);
    if (!strategyDefinition) {
      throw new Error(`Missing strategy definition for ${strategyId}`);
    }
    return strategyDefinition;
  }

  private buildMetricsRecord(strategyId: string, tier: StrategyTier): StrategyMetricsRecord {
    const mutableMetricsState = this.requireState(strategyId);
    const resolvedOutcomes = mutableMetricsState.outcomes.filter((outcome) => outcome.wasCorrect !== null);
    const wins = resolvedOutcomes.filter((outcome) => outcome.wasCorrect).length;
    const losses = resolvedOutcomes.filter((outcome) => outcome.wasCorrect === false).length;
    const voids = mutableMetricsState.outcomes.length - resolvedOutcomes.length;
    const totalResolved = resolvedOutcomes.length;
    const hitRate = totalResolved === 0 ? 0.5 : wins / totalResolved;
    const averageSignedEdge = totalResolved === 0 ? 0 : resolvedOutcomes.reduce((totalEdge, outcome) => totalEdge + outcome.signedEdge, 0) / totalResolved;
    const averageCalibrationError =
      mutableMetricsState.outcomes.length === 0
        ? 0.5
        : mutableMetricsState.outcomes.reduce((totalError, outcome) => totalError + outcome.calibrationError, 0) / mutableMetricsState.outcomes.length;
    const recentStreak = this.computeRecentStreak(resolvedOutcomes);
    const trustFactor = Math.min(1, totalResolved / 10);
    const baseWeight = this.readBaseWeight(tier);
    const adaptiveWeight = baseWeight + ((hitRate - 0.5) * 1.6 + averageSignedEdge * 0.8 - averageCalibrationError * 0.25) * trustFactor;
    const weight = Math.max(0.2, Math.min(2.5, adaptiveWeight));
    const lastResolvedAt =
      mutableMetricsState.outcomes.length === 0 ? null : (mutableMetricsState.outcomes[mutableMetricsState.outcomes.length - 1]?.resolvedAt ?? null);
    return {
      strategyId,
      totalResolved,
      wins,
      losses,
      voids,
      hitRate,
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
      } else {
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

  /**
   * @section public:methods
   */

  public getWeight(strategyId: string): number {
    const strategySummary = this.getSummary(strategyId);
    return strategySummary.weight;
  }

  public markParticipated(strategySignals: StrategySignal[], participatedAt: number): void {
    for (const strategySignal of strategySignals) {
      if (strategySignal.didRun) {
        const state = this.requireState(strategySignal.strategyId);
        state.lastParticipatedAt = participatedAt;
      }
    }
  }

  public recordResolution(strategySignals: StrategySignal[], resolvedDirection: PredictionDirection | null, resolvedAt: number | null): void {
    for (const strategySignal of strategySignals) {
      const mutableMetricsState = this.requireState(strategySignal.strategyId);
      const wasCorrect = resolvedDirection === null ? null : strategySignal.direction === resolvedDirection;
      const signedEdge =
        resolvedDirection === null ? 0 : strategySignal.direction === resolvedDirection ? strategySignal.confidence : strategySignal.confidence * -1;
      const targetConfidence = wasCorrect === null ? strategySignal.confidence : wasCorrect ? 1 : 0;
      const calibrationError = Math.abs(strategySignal.confidence - targetConfidence);
      mutableMetricsState.outcomes.push({
        wasCorrect,
        signedEdge,
        calibrationError,
        resolvedAt,
      });
      if (mutableMetricsState.outcomes.length > config.STRATEGY_ROLLING_WINDOW_SIZE) {
        mutableMetricsState.outcomes.splice(0, mutableMetricsState.outcomes.length - config.STRATEGY_ROLLING_WINDOW_SIZE);
      }
    }
  }

  public getSummaries(): StrategySummary[] {
    const strategySummaries = this.definitions
      .map((definition) => this.getSummary(definition.strategyId))
      .sort((leftSummary, rightSummary) => {
        return this.compareSummaries(leftSummary, rightSummary);
      });
    return strategySummaries;
  }
}
