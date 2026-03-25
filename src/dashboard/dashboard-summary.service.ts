/**
 * @section imports:internals
 */

import type { MarketComboBoard } from "../combo/combo.types.ts";
import config from "../config.ts";
import type {
  ExecutionAccountSummary,
  ExecutionMode,
  ExecutionService,
  ExecutionTrade,
  MarketExecutionSummary,
  MarketPerformanceSummary,
  OpenPositionSummary,
  PortfolioExecutionSummary,
} from "../execution/execution.types.ts";
import type { MarketStateService } from "../market/market-state.service.ts";
import type { CrossAssetRegime, MarketSummary } from "../market/market.types.ts";
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
  executionMode: ExecutionMode;
  account: ExecutionAccountSummary;
  health: HealthPayload;
  kpis: {
    liveMarkets: number;
    pendingEvaluations: number;
    totalPredictions: number;
    resolvedAccuracy: number;
    averageConfidence: number;
  };
  markets: MarketSummary[];
  globalRegime: CrossAssetRegime | null;
  globalRegimes: {
    "5m": CrossAssetRegime | null;
    "15m": CrossAssetRegime | null;
  };
  latestPredictions: PredictionResponse[];
  strategies: StrategySummary[];
  winningCombinations: PredictionResponse[];
  executionNow: MarketExecutionSummary[];
  openPositions: OpenPositionSummary[];
  recentTrades: ExecutionTrade[];
  marketPerformance: MarketPerformanceSummary[];
  marketPnlTable: MarketPerformanceSummary[];
  comboSearchBoards: MarketComboBoard[];
  tradeCandidates: Array<{
    marketKey: string;
    comboKey: string | null;
    marketScore: number | null;
    comboScore: number | null;
    affordabilityScore: number | null;
    blockingReason: string | null;
    isEntryAllowed: boolean;
  }>;
  executionPerformance: PortfolioExecutionSummary;
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
  private readonly executionService: ExecutionService;
  private readonly startedAt: number;

  /**
   * @section constructor
   */

  public constructor(
    marketStateService: MarketStateService,
    predictionEngineService: PredictionEngineService,
    executionService: ExecutionService,
    startedAt: number,
  ) {
    this.marketStateService = marketStateService;
    this.predictionEngineService = predictionEngineService;
    this.executionService = executionService;
    this.startedAt = startedAt;
  }

  /**
   * @section private:methods
   */

  private selectGlobalRegime(markets: MarketSummary[]): CrossAssetRegime | null {
    let globalRegime: CrossAssetRegime | null = null;
    for (const market of markets) {
      const marketRegime = this.marketStateService.getCrossAssetRegime(market.marketKey);
      if (marketRegime !== null) {
        if (globalRegime === null || marketRegime.breadthStrength > globalRegime.breadthStrength) {
          globalRegime = marketRegime;
        }
      }
    }
    return globalRegime;
  }

  private buildGlobalRegimes(): DashboardSummaryPayload["globalRegimes"] {
    const globalRegimes: DashboardSummaryPayload["globalRegimes"] = {
      "5m": this.marketStateService.getCrossAssetRegime("btc:5m"),
      "15m": this.marketStateService.getCrossAssetRegime("btc:15m"),
    };
    return globalRegimes;
  }

  private buildTradeCandidates(executionNow: MarketExecutionSummary[]): DashboardSummaryPayload["tradeCandidates"] {
    const tradeCandidates = [...executionNow]
      .map((marketExecution) => {
        return {
          marketKey: marketExecution.marketKey,
          comboKey: marketExecution.decision.selectedComboKey,
          marketScore: marketExecution.decision.marketScore,
          comboScore: marketExecution.decision.selectedComboScore,
          affordabilityScore: marketExecution.decision.selectedComboAffordabilityScore,
          blockingReason: marketExecution.decision.blockingReasons[0] ?? null,
          isEntryAllowed: marketExecution.decision.isEntryAllowed,
        };
      })
      .sort((leftCandidate, rightCandidate) => {
        let comparison = Number(rightCandidate.isEntryAllowed) - Number(leftCandidate.isEntryAllowed);
        if (comparison === 0) {
          comparison = (rightCandidate.comboScore ?? 0) - (leftCandidate.comboScore ?? 0);
        }
        if (comparison === 0) {
          comparison = (rightCandidate.affordabilityScore ?? 0) - (leftCandidate.affordabilityScore ?? 0);
        }
        if (comparison === 0) {
          comparison = (rightCandidate.marketScore ?? 0) - (leftCandidate.marketScore ?? 0);
        }
        return comparison;
      });
    return tradeCandidates;
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
      pendingEvaluationCount: this.executionService.getOpenPositionCount(),
      monitoredMarketCount: 8,
      startedAt: this.startedAt,
    };
  }

  public async buildDashboardSummary(nowTimestamp: number): Promise<DashboardSummaryPayload> {
    const markets = this.marketStateService.getMarketSummaries(nowTimestamp);
    const globalRegime = this.selectGlobalRegime(markets);
    const globalRegimes = this.buildGlobalRegimes();
    const latestPredictions = this.predictionEngineService.getRecentResolvedPredictions(20);
    const strategies = this.predictionEngineService.getStrategySummaries();
    const executionNow = this.executionService.getExecutionSummaries();
    const openPositions = this.executionService.getOpenPositions();
    const recentTrades = this.executionService.getRecentTrades(20);
    const marketPerformance = this.executionService.getMarketPerformanceSummaries();
    const marketPnlTable = [...marketPerformance].sort((leftMarketPerformance, rightMarketPerformance) => {
      return rightMarketPerformance.cumulativeNetPnl - leftMarketPerformance.cumulativeNetPnl;
    });
    const comboSearchBoards = this.predictionEngineService.getMarketComboBoards(markets.map((market) => market.marketKey));
    const winningCombinations = latestPredictions.slice(0, 12);
    const tradeCandidates = this.buildTradeCandidates(executionNow);
    const executionPerformance = this.executionService.getPortfolioSummary();
    const paperExecutionPerformance = executionPerformance;
    const account = await this.executionService.getAccountSummary(nowTimestamp);
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
      executionMode: this.executionService.getExecutionMode(),
      account,
      health: this.buildHealthPayload(nowTimestamp),
      kpis: {
        liveMarkets: markets.filter((market) => market.isLive).length,
        pendingEvaluations: this.executionService.getOpenPositionCount(),
        totalPredictions: latestPredictions.length,
        resolvedAccuracy,
        averageConfidence,
      },
      markets,
      globalRegime,
      globalRegimes,
      latestPredictions,
      strategies,
      winningCombinations,
      executionNow,
      openPositions,
      recentTrades,
      marketPerformance,
      marketPnlTable,
      comboSearchBoards,
      tradeCandidates,
      executionPerformance,
      paperExecutionPerformance,
      makerTakerStats: {
        makerFillRate: executionPerformance.makerFillRate,
        makerUsageRatio: executionPerformance.makerUsageRatio,
        takerUsageRatio: executionPerformance.takerUsageRatio,
      },
    };
  }
}
