/**
 * @section imports:internals
 */

import type { ComboSummary, MarketComboBoard } from "../combo/combo.types.ts";
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
import type { EngineBoard, StrategyBoard, StrategySummary } from "../strategy/strategy.types.ts";

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
  strategyBoards: StrategyBoard[];
  engineBoards: EngineBoard[];
  selectedStrategyMarketKey: string;
  winningCombinations: PredictionResponse[];
  executionNow: MarketExecutionSummary[];
  openPositions: OpenPositionSummary[];
  recentTrades: ExecutionTrade[];
  marketPerformance: MarketPerformanceSummary[];
  marketPnlTable: MarketPerformanceSummary[];
  comboBoards: MarketComboBoard[];
  comboLeaders: ComboSummary[];
  latestComboInfluence: PredictionResponse[];
  discoveryBoard: Array<{
    comboKey: string;
    setupType: string;
    hitRate: number;
    averageConfidence: number;
    sampleCount: number;
    markets: string[];
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

  private buildEngineBoards(marketKeys: MarketSummary["marketKey"][]): EngineBoard[] {
    const engineBoards = this.predictionEngineService.getEngineBoards(marketKeys);
    return engineBoards;
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

  private buildDiscoveryBoard(latestPredictions: PredictionResponse[]): DashboardSummaryPayload["discoveryBoard"] {
    const discoveryMap = new Map<
      string,
      { comboKey: string; setupType: string; hits: number; totalConfidence: number; sampleCount: number; markets: Set<string> }
    >();
    for (const prediction of latestPredictions) {
      const discoveryKey = `${prediction.winningEngineComboKey}:${prediction.winningSetupType}`;
      let discoveryEntry = discoveryMap.get(discoveryKey);
      if (!discoveryEntry) {
        discoveryEntry = {
          comboKey: prediction.winningEngineComboKey,
          setupType: prediction.winningSetupType,
          hits: 0,
          totalConfidence: 0,
          sampleCount: 0,
          markets: new Set<string>(),
        };
        discoveryMap.set(discoveryKey, discoveryEntry);
      }
      if (prediction.result.status === "ok") {
        discoveryEntry.hits += 1;
      }
      discoveryEntry.totalConfidence += prediction.confidence;
      discoveryEntry.sampleCount += 1;
      discoveryEntry.markets.add(prediction.marketKey);
    }
    const discoveryBoard = [...discoveryMap.values()]
      .map((discoveryEntry) => {
        return {
          comboKey: discoveryEntry.comboKey,
          setupType: discoveryEntry.setupType,
          hitRate: discoveryEntry.sampleCount === 0 ? 0 : discoveryEntry.hits / discoveryEntry.sampleCount,
          averageConfidence: discoveryEntry.sampleCount === 0 ? 0 : discoveryEntry.totalConfidence / discoveryEntry.sampleCount,
          sampleCount: discoveryEntry.sampleCount,
          markets: [...discoveryEntry.markets],
        };
      })
      .sort((leftEntry, rightEntry) => rightEntry.hitRate - leftEntry.hitRate || rightEntry.sampleCount - leftEntry.sampleCount)
      .slice(0, 10);
    return discoveryBoard;
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
    const strategyBoards = this.buildStrategyBoards();
    const engineBoards = this.buildEngineBoards(markets.map((market) => market.marketKey));
    const executionNow = this.executionService.getExecutionSummaries();
    const openPositions = this.executionService.getOpenPositions();
    const recentTrades = this.executionService.getRecentTrades(20);
    const marketPerformance = this.executionService.getMarketPerformanceSummaries();
    const marketPnlTable = [...marketPerformance].sort((leftMarketPerformance, rightMarketPerformance) => {
      return rightMarketPerformance.cumulativeNetPnl - leftMarketPerformance.cumulativeNetPnl;
    });
    const comboSummaries = this.predictionEngineService.getComboSummaries();
    const comboBoards = comboSummaries.length === 0 ? [] : this.buildComboBoards(marketPerformance);
    const comboLeaders = comboSummaries.slice(0, 12);
    const latestComboInfluence = latestPredictions.filter((prediction) => prediction.comboBreakdown.activeCombos.length > 0).slice(0, 12);
    const winningCombinations = latestPredictions.slice(0, 12);
    const discoveryBoard = this.buildDiscoveryBoard(latestPredictions);
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
      strategyBoards,
      engineBoards,
      selectedStrategyMarketKey: this.selectStrategyMarketKey(executionNow, marketPerformance),
      winningCombinations,
      executionNow,
      openPositions,
      recentTrades,
      marketPerformance,
      marketPnlTable,
      comboBoards,
      comboLeaders,
      latestComboInfluence,
      discoveryBoard,
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
