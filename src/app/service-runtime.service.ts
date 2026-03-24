/**
 * @section imports:externals
 */

import type { ServerType } from "@hono/node-server";
import { SnapshotService } from "@sha3/polymarket-snapshot";

/**
 * @section imports:internals
 */

import config from "../config.ts";
import { DashboardSummaryService } from "../dashboard/dashboard-summary.service.ts";
import { DashboardViewService } from "../dashboard/dashboard-view.service.ts";
import { HttpServerService } from "../http/http-server.service.ts";
import logger from "../logger.ts";
import { MarketStateService } from "../market/market-state.service.ts";
import type { InputSnapshot } from "../market/market.types.ts";
import { PredictionEngineService } from "../prediction/prediction-engine.service.ts";
import { PredictionStoreService } from "../prediction/prediction-store.service.ts";
import { StrategyEngineService } from "../strategy/strategy-engine.service.ts";
import { StrategyMetricsService } from "../strategy/strategy-metrics.service.ts";
import type { StrategyDefinition } from "../strategy/strategy.types.ts";

/**
 * @section class
 */

export class ServiceRuntime {
  /**
   * @section private:attributes
   */

  private readonly snapshotService: SnapshotService | null;
  private readonly marketStateService: MarketStateService;
  private readonly predictionEngineService: PredictionEngineService;
  private readonly httpServerService: HttpServerService;
  private readonly startedAt: number;
  private server: ServerType | null;
  private hasAttachedSnapshotListener: boolean;

  /**
   * @section constructor
   */

  public constructor(
    snapshotService: SnapshotService | null,
    marketStateService: MarketStateService,
    predictionEngineService: PredictionEngineService,
    httpServerService: HttpServerService,
    startedAt: number,
  ) {
    this.snapshotService = snapshotService;
    this.marketStateService = marketStateService;
    this.predictionEngineService = predictionEngineService;
    this.httpServerService = httpServerService;
    this.startedAt = startedAt;
    this.server = null;
    this.hasAttachedSnapshotListener = false;
  }

  /**
   * @section factory
   */

  public static createDefault(): ServiceRuntime {
    const startedAt = Date.now();
    const marketStateService = new MarketStateService();
    const strategyMetricsService = new StrategyMetricsService(ServiceRuntime.buildStrategyDefinitions());
    const strategyEngineService = new StrategyEngineService(strategyMetricsService);
    const predictionEngineService = new PredictionEngineService(
      marketStateService,
      strategyEngineService,
      strategyMetricsService,
      new PredictionStoreService(),
    );
    const httpServerService = new HttpServerService(
      predictionEngineService,
      marketStateService,
      new DashboardSummaryService(marketStateService, predictionEngineService, startedAt),
      new DashboardViewService(),
    );
    return new ServiceRuntime(new SnapshotService(config.SNAPSHOT_INTERVAL_MS), marketStateService, predictionEngineService, httpServerService, startedAt);
  }

  /**
   * @section private:methods
   */

  private attachSnapshotListener(): void {
    if (this.snapshotService && !this.hasAttachedSnapshotListener) {
      this.snapshotService.addSnapshotListener({
        listener: (snapshot) => {
          this.ingestSnapshot(snapshot as InputSnapshot);
        },
      });
      this.hasAttachedSnapshotListener = true;
    }
  }

  /**
   * @section public:methods
   */

  public buildServer(): ServerType {
    const server = this.httpServerService.buildServer();
    return server;
  }

  public startServer(): ServerType {
    this.attachSnapshotListener();
    const server = this.buildServer();
    server.listen(config.DEFAULT_PORT, () => {
      logger.info(`service listening on http://localhost:${config.DEFAULT_PORT}`);
    });
    this.server = server;
    return server;
  }

  public async stop(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve, reject) => {
        this.server?.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
      this.server = null;
    }
    if (this.snapshotService) {
      await this.snapshotService.disconnect();
      this.hasAttachedSnapshotListener = false;
    }
  }

  public ingestSnapshot(snapshot: InputSnapshot): void {
    const marketUpdateResult = this.marketStateService.ingestSnapshot(snapshot);
    this.predictionEngineService.handleSnapshot(marketUpdateResult.generatedAt, marketUpdateResult.triggeredMarkets);
  }

  /**
   * @section static:methods
   */

  private static buildStrategyDefinitions(): StrategyDefinition[] {
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
}
