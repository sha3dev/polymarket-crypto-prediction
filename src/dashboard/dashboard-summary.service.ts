/**
 * @section imports:internals
 */

import config from "../config.ts";
import type {
  MarketExecutionSummary,
  MarketPerformanceSummary,
  OpenPositionSummary,
  PaperTrade,
  PortfolioExecutionSummary,
} from "../execution/execution.types.ts";
import type { PaperExecutionService } from "../execution/paper-execution.service.ts";
import type { MarketStateService } from "../market/market-state.service.ts";
import type { MarketSummary } from "../market/market.types.ts";
import type { PredictionEngineService } from "../prediction/prediction-engine.service.ts";
import type { PredictionResponse } from "../prediction/prediction.types.ts";
import type { StrategySummary } from "../strategy/strategy.types.ts";

/**
 * @section types
 */

export type HealthPayload = {
  ok: true;
  serviceName: string;
  snapshotAgeMs: number | null;
  isSnapshotHealthy: boolean;
  pendingEvaluationCount: number;
  monitoredMarketCount: number;
  startedAt: number;
};

export type DashboardSummaryPayload = {
  generatedAt: number;
  pollIntervalMs: number;
  health: HealthPayload;
  kpis: {
    liveMarkets: number;
    pendingEvaluations: number;
    totalPredictions: number;
    resolvedAccuracy: number;
    averageConfidence: number;
  };
  markets: MarketSummary[];
  latestPredictions: PredictionResponse[];
  strategies: StrategySummary[];
  executionNow: MarketExecutionSummary[];
  openPositions: OpenPositionSummary[];
  recentTrades: PaperTrade[];
  marketPerformance: MarketPerformanceSummary[];
  paperExecutionPerformance: PortfolioExecutionSummary;
  makerTakerStats: {
    makerFillRate: number;
    makerUsageRatio: number;
    takerUsageRatio: number;
  };
};

/**
 * @section class
 */

export class DashboardSummaryService {
  /**
   * @section private:attributes
   */

  private readonly marketStateService: MarketStateService;
  private readonly predictionEngineService: PredictionEngineService;
  private readonly paperExecutionService: PaperExecutionService;
  private readonly startedAt: number;

  /**
   * @section constructor
   */

  public constructor(
    marketStateService: MarketStateService,
    predictionEngineService: PredictionEngineService,
    paperExecutionService: PaperExecutionService,
    startedAt: number,
  ) {
    this.marketStateService = marketStateService;
    this.predictionEngineService = predictionEngineService;
    this.paperExecutionService = paperExecutionService;
    this.startedAt = startedAt;
  }

  /**
   * @section public:methods
   */

  public buildHealthPayload(nowTimestamp: number): HealthPayload {
    const snapshotAgeMs = this.marketStateService.getLatestSnapshotAge(nowTimestamp);
    const isSnapshotHealthy = snapshotAgeMs !== null && snapshotAgeMs <= config.TOKEN_MAX_AGE_MS * 2;
    return {
      ok: true,
      serviceName: config.SERVICE_NAME,
      snapshotAgeMs,
      isSnapshotHealthy,
      pendingEvaluationCount: this.predictionEngineService.getPendingCount(),
      monitoredMarketCount: 8,
      startedAt: this.startedAt,
    };
  }

  public buildDashboardSummary(nowTimestamp: number): DashboardSummaryPayload {
    const markets = this.marketStateService.getMarketSummaries(nowTimestamp);
    const latestPredictions = this.predictionEngineService.getRecentPredictions(20);
    const strategies = this.predictionEngineService.getStrategySummaries();
    const executionNow = this.paperExecutionService.getExecutionSummaries();
    const openPositions = this.paperExecutionService.getOpenPositions();
    const recentTrades = this.paperExecutionService.getRecentTrades(20);
    const marketPerformance = this.paperExecutionService.getMarketPerformanceSummaries();
    const paperExecutionPerformance = this.paperExecutionService.getPortfolioSummary();
    const resolvedPredictions = latestPredictions.filter((prediction) => prediction.result.status !== "pending");
    const okPredictions = resolvedPredictions.filter((prediction) => prediction.result.status === "ok");
    const resolvedAccuracy = resolvedPredictions.length === 0 ? 0 : okPredictions.length / resolvedPredictions.length;
    const averageConfidence =
      latestPredictions.length === 0
        ? 0
        : latestPredictions.reduce((aggregatedConfidence, prediction) => aggregatedConfidence + prediction.confidence, 0) / latestPredictions.length;
    return {
      generatedAt: nowTimestamp,
      pollIntervalMs: config.DASHBOARD_POLL_INTERVAL_MS,
      health: this.buildHealthPayload(nowTimestamp),
      kpis: {
        liveMarkets: markets.filter((market) => market.isLive).length,
        pendingEvaluations: this.predictionEngineService.getPendingCount(),
        totalPredictions: latestPredictions.length,
        resolvedAccuracy,
        averageConfidence,
      },
      markets,
      latestPredictions,
      strategies,
      executionNow,
      openPositions,
      recentTrades,
      marketPerformance,
      paperExecutionPerformance,
      makerTakerStats: {
        makerFillRate: paperExecutionPerformance.makerFillRate,
        makerUsageRatio: paperExecutionPerformance.makerUsageRatio,
        takerUsageRatio: paperExecutionPerformance.takerUsageRatio,
      },
    };
  }
}
