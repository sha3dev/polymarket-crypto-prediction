/**
 * @section imports:internals
 */

import type { ComboSummary, MarketComboBoard } from "../combo/combo.types.ts";
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
import type { StrategyBoard, StrategySummary } from "../strategy/strategy.types.ts";

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
  strategyBoards: StrategyBoard[];
  selectedStrategyMarketKey: string;
  executionNow: MarketExecutionSummary[];
  openPositions: OpenPositionSummary[];
  recentTrades: PaperTrade[];
  marketPerformance: MarketPerformanceSummary[];
  marketPnlTable: MarketPerformanceSummary[];
  comboBoards: MarketComboBoard[];
  comboLeaders: ComboSummary[];
  latestComboInfluence: PredictionResponse[];
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
   * @section private:methods
   */

  private buildStrategyBoards(): StrategyBoard[] {
    const strategyBoards: StrategyBoard[] = [];
    const marketKeys = this.marketStateService.getMarketSummaries(Date.now()).map((market) => market.marketKey);
    for (const marketKey of marketKeys) {
      strategyBoards.push({
        marketKey,
        strategies: this.predictionEngineService.getStrategySummaries(marketKey),
      });
    }
    return strategyBoards;
  }

  private selectStrategyMarketKey(executionNow: MarketExecutionSummary[], marketPerformance: MarketPerformanceSummary[]): string {
    let selectedStrategyMarketKey = "btc:5m";
    const executableMarket = executionNow.find((marketExecution) => marketExecution.decision.isEntryAllowed);
    if (executableMarket) {
      selectedStrategyMarketKey = executableMarket.marketKey;
    } else {
      const bestMarketPerformance = [...marketPerformance].sort((leftMarketPerformance, rightMarketPerformance) => {
        return rightMarketPerformance.score - leftMarketPerformance.score;
      })[0];
      if (bestMarketPerformance) {
        selectedStrategyMarketKey = bestMarketPerformance.marketKey;
      }
    }
    return selectedStrategyMarketKey;
  }

  private buildComboBoards(marketPerformance: MarketPerformanceSummary[]): MarketComboBoard[] {
    const marketKeys = marketPerformance.map((marketPerformanceSummary) => marketPerformanceSummary.marketKey);
    const comboBoards = this.predictionEngineService.getMarketComboBoards(marketKeys);
    return comboBoards;
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
      pendingEvaluationCount: this.paperExecutionService.getOpenPositionCount(),
      monitoredMarketCount: 8,
      startedAt: this.startedAt,
    };
  }

  public buildDashboardSummary(nowTimestamp: number): DashboardSummaryPayload {
    const markets = this.marketStateService.getMarketSummaries(nowTimestamp);
    const latestPredictions = this.predictionEngineService.getRecentResolvedPredictions(20);
    const strategies = this.predictionEngineService.getStrategySummaries();
    const strategyBoards = this.buildStrategyBoards();
    const executionNow = this.paperExecutionService.getExecutionSummaries();
    const openPositions = this.paperExecutionService.getOpenPositions();
    const recentTrades = this.paperExecutionService.getRecentTrades(20);
    const marketPerformance = this.paperExecutionService.getMarketPerformanceSummaries();
    const marketPnlTable = [...marketPerformance].sort((leftMarketPerformance, rightMarketPerformance) => {
      return rightMarketPerformance.cumulativeNetPnl - leftMarketPerformance.cumulativeNetPnl;
    });
    const comboSummaries = this.predictionEngineService.getComboSummaries();
    const comboBoards = comboSummaries.length === 0 ? [] : this.buildComboBoards(marketPerformance);
    const comboLeaders = comboSummaries.slice(0, 12);
    const latestComboInfluence = latestPredictions.filter((prediction) => prediction.comboBreakdown.activeCombos.length > 0).slice(0, 12);
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
        pendingEvaluations: this.paperExecutionService.getOpenPositionCount(),
        totalPredictions: latestPredictions.length,
        resolvedAccuracy,
        averageConfidence,
      },
      markets,
      latestPredictions,
      strategies,
      strategyBoards,
      selectedStrategyMarketKey: this.selectStrategyMarketKey(executionNow, marketPerformance),
      executionNow,
      openPositions,
      recentTrades,
      marketPerformance,
      marketPnlTable,
      comboBoards,
      comboLeaders,
      latestComboInfluence,
      paperExecutionPerformance,
      makerTakerStats: {
        makerFillRate: paperExecutionPerformance.makerFillRate,
        makerUsageRatio: paperExecutionPerformance.makerUsageRatio,
        takerUsageRatio: paperExecutionPerformance.takerUsageRatio,
      },
    };
  }
}
