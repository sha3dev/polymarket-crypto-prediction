/**
 * @section imports:internals
 */

import config from "../config.ts";
import type { MarketKey } from "../market/market.types.ts";
import { SUPPORTED_ASSETS, SUPPORTED_WINDOWS } from "../market/market.types.ts";
import type { PredictionRecord } from "./prediction.types.ts";

/**
 * @section class
 */

export class PredictionStoreService {
  /**
   * @section private:attributes
   */

  private readonly predictionHistory: Map<MarketKey, PredictionRecord[]>;

  /**
   * @section constructor
   */

  public constructor() {
    this.predictionHistory = this.createInitialHistory();
  }

  /**
   * @section private:methods
   */

  private createInitialHistory(): Map<MarketKey, PredictionRecord[]> {
    const predictionHistory = new Map<MarketKey, PredictionRecord[]>();
    for (const asset of SUPPORTED_ASSETS) {
      for (const window of SUPPORTED_WINDOWS) {
        predictionHistory.set(`${asset}:${window}`, []);
      }
    }
    return predictionHistory;
  }

  private requireHistory(marketKey: MarketKey): PredictionRecord[] {
    const marketPredictions = this.predictionHistory.get(marketKey);
    if (!marketPredictions) {
      throw new Error(`Missing prediction history for ${marketKey}`);
    }
    return marketPredictions;
  }

  /**
   * @section public:methods
   */

  public addPrediction(predictionRecord: PredictionRecord): void {
    const marketPredictions = this.requireHistory(predictionRecord.marketKey);
    marketPredictions.unshift(predictionRecord);
    if (marketPredictions.length > config.MAX_PREDICTION_HISTORY_PER_MARKET) {
      marketPredictions.splice(config.MAX_PREDICTION_HISTORY_PER_MARKET);
    }
  }

  public getLatestPrediction(marketKey: MarketKey): PredictionRecord | null {
    const marketPredictions = this.requireHistory(marketKey);
    const latestPrediction = marketPredictions[0] ?? null;
    return latestPrediction;
  }

  public getPredictions(marketKey: MarketKey, limit: number): PredictionRecord[] {
    const marketPredictions = this.requireHistory(marketKey);
    const predictions = marketPredictions.slice(0, limit);
    return predictions;
  }

  public getPredictionCount(marketKey: MarketKey): number {
    const marketPredictions = this.requireHistory(marketKey);
    const predictionCount = marketPredictions.length;
    return predictionCount;
  }

  public getPendingPredictions(dueAtOrBefore: number): PredictionRecord[] {
    const pendingPredictions: PredictionRecord[] = [];
    for (const marketPredictions of this.predictionHistory.values()) {
      for (const predictionRecord of marketPredictions) {
        if (!predictionRecord.isResolved && predictionRecord.evaluationDueAt <= dueAtOrBefore) {
          pendingPredictions.push(predictionRecord);
        }
      }
    }
    return pendingPredictions;
  }

  public getPendingCount(): number {
    let pendingCount = 0;
    for (const marketPredictions of this.predictionHistory.values()) {
      pendingCount += marketPredictions.filter((predictionRecord) => !predictionRecord.isResolved).length;
    }
    return pendingCount;
  }

  public getRecentPredictions(limit: number): PredictionRecord[] {
    const recentPredictions = [...this.predictionHistory.values()]
      .flat()
      .sort((leftRecord, rightRecord) => rightRecord.createdAt - leftRecord.createdAt)
      .slice(0, limit);
    return recentPredictions;
  }
}
