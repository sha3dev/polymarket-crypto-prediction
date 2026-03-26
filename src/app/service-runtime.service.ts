/**
 * @section imports:externals
 */

import type { ServerType } from "@hono/node-server";
import { SnapshotService } from "@sha3/polymarket-snapshot";

/**
 * @section imports:internals
 */

import { ComboMetricsService } from "../combo/combo-metrics.service.ts";
import config from "../config.ts";
import { DashboardSummaryService } from "../dashboard/dashboard-summary.service.ts";
import { DashboardViewService } from "../dashboard/dashboard-view.service.ts";
import { ExecutionPolicyService } from "../execution/execution-policy.service.ts";
import type { ExecutionService } from "../execution/execution.types.ts";
import { PaperExecutionService } from "../execution/paper-execution.service.ts";
import { RealExecutionService } from "../execution/real-execution.service.ts";
import { HttpServerService } from "../http/http-server.service.ts";
import { LlmLogService } from "../llm/llm-log.service.ts";
import { LlmPromptService } from "../llm/llm-prompt.service.ts";
import logger from "../logger.ts";
import { MarketStateService } from "../market/market-state.service.ts";
import type { InputSnapshot } from "../market/market.types.ts";
import { OpportunityEngineService } from "../opportunity/opportunity-engine.service.ts";
import { OpportunityStateService } from "../opportunity/opportunity-state.service.ts";
import { OpportunityStoreService } from "../opportunity/opportunity-store.service.ts";
import { PredictionEngineService } from "../prediction/prediction-engine.service.ts";
import { PredictionStoreService } from "../prediction/prediction-store.service.ts";
import { StrategyEngineService } from "../strategy/strategy-engine.service.ts";
import { StrategyMetricsService } from "../strategy/strategy-metrics.service.ts";
import type { StrategyDefinition } from "../strategy/strategy.types.ts";
import { UpdateService } from "../update/update.service.ts";

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
  private readonly opportunityEngineService: OpportunityEngineService;
  private readonly executionService: ExecutionService;
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
    opportunityEngineService: OpportunityEngineService,
    executionService: ExecutionService,
    httpServerService: HttpServerService,
    startedAt: number,
  ) {
    this.snapshotService = snapshotService;
    this.marketStateService = marketStateService;
    this.predictionEngineService = predictionEngineService;
    this.opportunityEngineService = opportunityEngineService;
    this.executionService = executionService;
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
    const comboMetricsService = new ComboMetricsService();
    const executionPolicyService = new ExecutionPolicyService();
    const llmLogService = new LlmLogService();
    const opportunityStateService = new OpportunityStateService();
    const opportunityStoreService = new OpportunityStoreService();
    const predictionEngineService = new PredictionEngineService(
      marketStateService,
      strategyEngineService,
      strategyMetricsService,
      new PredictionStoreService(),
      comboMetricsService,
      llmLogService,
    );
    const opportunityEngineService = new OpportunityEngineService(
      marketStateService,
      predictionEngineService,
      strategyEngineService,
      opportunityStateService,
      opportunityStoreService,
    );
    const executionService =
      config.EXECUTION_MODE === "real"
        ? new RealExecutionService(marketStateService, predictionEngineService, executionPolicyService, undefined, undefined, llmLogService)
        : new PaperExecutionService(marketStateService, predictionEngineService, executionPolicyService, llmLogService);
    const llmPromptService = new LlmPromptService(
      llmLogService.getSummaryFilePath(),
      llmLogService.getEventFilePath(),
      "https://github.com/sha3dev/polymarket-crypto-prediction",
      config.EXECUTION_MODE,
    );
    const httpServerService = new HttpServerService(
      opportunityEngineService,
      predictionEngineService,
      executionService,
      marketStateService,
      new DashboardSummaryService(marketStateService, opportunityEngineService, predictionEngineService, executionService, startedAt),
      new DashboardViewService(),
      new UpdateService(process.cwd(), "@sha3/polymarket-crypto-prediction"),
      llmPromptService,
    );
    return new ServiceRuntime(
      new SnapshotService(config.SNAPSHOT_INTERVAL_MS),
      marketStateService,
      predictionEngineService,
      opportunityEngineService,
      executionService,
      httpServerService,
      startedAt,
    );
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
    await this.executionService.disconnect();
  }

  public ingestSnapshot(snapshot: InputSnapshot): void {
    const marketUpdateResult = this.marketStateService.ingestSnapshot(snapshot);
    this.predictionEngineService.handleSnapshot(marketUpdateResult.generatedAt, marketUpdateResult.triggeredMarkets);
    this.opportunityEngineService.handleSnapshot();
    void this.executionService.handleSnapshot(marketUpdateResult.generatedAt);
  }

  /**
   * @section static:methods
   */

  private static buildStrategyDefinitions(): StrategyDefinition[] {
    // Must stay in sync with StrategyEngineService.createDefinitions()
    const strategyDefinitions: StrategyDefinition[] = [
      // --- low tier ---
      { strategyId: "s01", name: "Momentum EWMA", tier: "low", family: "momentum", description: "Short drift continuation.", isComboEligible: true },
      { strategyId: "s02", name: "Token Microprice", tier: "low", family: "microstructure", description: "Top-of-book pressure.", isComboEligible: true },
      { strategyId: "s06", name: "No-Arb Consistency", tier: "low", family: "pricing", description: "Up+down deviation from unity.", isComboEligible: true },
      {
        strategyId: "s07",
        name: "Spread Compression",
        tier: "low",
        family: "microstructure",
        description: "Spread diff plus spot drift.",
        isComboEligible: true,
      },
      { strategyId: "s09", name: "Spot Consensus Momentum", tier: "low", family: "momentum", description: "Cross-venue spot drift.", isComboEligible: true },
      {
        strategyId: "s10",
        name: "Spot Micropressure",
        tier: "low",
        family: "microstructure",
        description: "Aggregated venue imbalance.",
        isComboEligible: true,
      },
      { strategyId: "s14", name: "Chainlink Basis", tier: "low", family: "pricing", description: "Oracle catch-up.", isComboEligible: true },
      {
        strategyId: "s15",
        name: "Theoretical Probability Gap",
        tier: "low",
        family: "pricing",
        description: "Oracle-implied vs observed gap.",
        isComboEligible: true,
      },
      { strategyId: "s16", name: "Freshness Gap", tier: "low", family: "pricing", description: "Spot leads stale token.", isComboEligible: true },
      {
        strategyId: "s24",
        name: "Spot-Token Divergence",
        tier: "low",
        family: "pricing",
        description: "Spot price moved but token midpoint lags behind.",
        isComboEligible: true,
      },
      // --- medium tier ---
      {
        strategyId: "s03",
        name: "Token Imbalance Band",
        tier: "medium",
        family: "microstructure",
        description: "Depth ratio pressure.",
        isComboEligible: true,
      },
      { strategyId: "s04", name: "Wall Proximity", tier: "medium", family: "microstructure", description: "Spread-depth wall signal.", isComboEligible: true },
      { strategyId: "s05", name: "Order Book Churn", tier: "medium", family: "microstructure", description: "Book rotation pressure.", isComboEligible: true },
      {
        strategyId: "s08",
        name: "Barrier Timing",
        tier: "medium",
        family: "pricing",
        description: "Chainlink vs price-to-beat proximity.",
        isComboEligible: true,
      },
      {
        strategyId: "s11",
        name: "Spot Dispersion",
        tier: "medium",
        family: "reversion",
        description: "Cross-venue price spread as reversion.",
        isComboEligible: true,
      },
      { strategyId: "s12", name: "Volatility Breakout", tier: "medium", family: "momentum", description: "Regime breakout.", isComboEligible: false },
      {
        strategyId: "s13",
        name: "Spot Slippage Skew",
        tier: "medium",
        family: "microstructure",
        description: "Venue spread skew direction.",
        isComboEligible: true,
      },
      {
        strategyId: "s17",
        name: "Regime Switch",
        tier: "medium",
        family: "momentum",
        description: "Conditional momentum or reversion.",
        isComboEligible: true,
      },
      { strategyId: "s18", name: "Liquidity Shock Fade", tier: "medium", family: "reversion", description: "Short mean reversion.", isComboEligible: true },
      {
        strategyId: "s21",
        name: "Cross-Asset Breadth Impulse",
        tier: "medium",
        family: "cross_asset",
        description: "Market-wide breadth confirmation, not primary conviction.",
        isComboEligible: false,
      },
      // --- high tier ---
      {
        strategyId: "s19",
        name: "Recent Performance Hedge",
        tier: "high",
        family: "momentum",
        description: "Meta signal from prior strategy consensus.",
        isComboEligible: false,
      },
      {
        strategyId: "s20",
        name: "Online Logistic Blend",
        tier: "high",
        family: "momentum",
        description: "Weighted blend of core strategies plus prior bias.",
        isComboEligible: false,
      },
      {
        strategyId: "s22",
        name: "Anchor Follow Catch-Up",
        tier: "high",
        family: "cross_asset",
        description: "Follow lagging asset after BTC and ETH impulse.",
        isComboEligible: false,
      },
      {
        strategyId: "s23",
        name: "BTC Trend Reversal Confirmation",
        tier: "high",
        family: "momentum",
        description: "BTC flips and followers start confirming the new side.",
        isComboEligible: false,
      },
    ];
    return strategyDefinitions;
  }
}
