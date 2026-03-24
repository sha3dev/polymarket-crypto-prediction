/**
 * @section imports:externals
 */

import { createAdaptorServer } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import { Hono } from "hono";

/**
 * @section imports:internals
 */

import config from "../config.ts";
import type { DashboardSummaryService } from "../dashboard/dashboard-summary.service.ts";
import type { DashboardViewService } from "../dashboard/dashboard-view.service.ts";
import type { ExecutionService } from "../execution/execution.types.ts";
import type { MarketStateService } from "../market/market-state.service.ts";
import type { AssetSymbol, MarketWindow } from "../market/market.types.ts";
import { SUPPORTED_ASSETS, SUPPORTED_WINDOWS } from "../market/market.types.ts";
import type { PredictionEngineService } from "../prediction/prediction-engine.service.ts";

/**
 * @section class
 */

export class HttpServerService {
  /**
   * @section private:attributes
   */

  private readonly predictionEngineService: PredictionEngineService;
  private readonly executionService: ExecutionService;
  private readonly marketStateService: MarketStateService;
  private readonly dashboardSummaryService: DashboardSummaryService;
  private readonly dashboardViewService: DashboardViewService;

  /**
   * @section constructor
   */

  public constructor(
    predictionEngineService: PredictionEngineService,
    executionService: ExecutionService,
    marketStateService: MarketStateService,
    dashboardSummaryService: DashboardSummaryService,
    dashboardViewService: DashboardViewService,
  ) {
    this.predictionEngineService = predictionEngineService;
    this.executionService = executionService;
    this.marketStateService = marketStateService;
    this.dashboardSummaryService = dashboardSummaryService;
    this.dashboardViewService = dashboardViewService;
  }

  /**
   * @section private:methods
   */

  private parseAsset(asset: string | undefined): AssetSymbol | null {
    let parsedAsset: AssetSymbol | null = null;
    if (asset && SUPPORTED_ASSETS.includes(asset as AssetSymbol)) {
      parsedAsset = asset as AssetSymbol;
    }
    return parsedAsset;
  }

  private parseWindow(window: string | undefined): MarketWindow | null {
    let parsedWindow: MarketWindow | null = null;
    if (window && SUPPORTED_WINDOWS.includes(window as MarketWindow)) {
      parsedWindow = window as MarketWindow;
    }
    return parsedWindow;
  }

  private parseLimit(rawLimit: string | undefined): number | null {
    let parsedLimit = 20;
    if (rawLimit !== undefined) {
      const numericLimit = Number(rawLimit);
      if (Number.isInteger(numericLimit) && numericLimit >= 1 && numericLimit <= config.MAX_PREDICTION_QUERY_LIMIT) {
        parsedLimit = numericLimit;
      } else {
        parsedLimit = Number.NaN;
      }
    }
    return Number.isNaN(parsedLimit) ? null : parsedLimit;
  }

  /**
   * @section public:methods
   */

  public buildServer(): ServerType {
    const app = new Hono();
    app.get("/", (context) => {
      context.header("content-type", "text/html; charset=utf-8");
      return context.html(this.dashboardViewService.buildHtml(), 200);
    });
    app.get("/v1/healthz", (context) => {
      context.header("content-type", config.RESPONSE_CONTENT_TYPE);
      return context.json(this.dashboardSummaryService.buildHealthPayload(Date.now()), 200);
    });
    app.get("/v1/dashboard/summary", async (context) => {
      context.header("content-type", config.RESPONSE_CONTENT_TYPE);
      return context.json(await this.dashboardSummaryService.buildDashboardSummary(Date.now()), 200);
    });
    app.get("/v1/strategies", (context) => {
      const asset = this.parseAsset(context.req.query("asset"));
      const window = this.parseWindow(context.req.query("window"));
      const hasAsset = context.req.query("asset") !== undefined;
      const hasWindow = context.req.query("window") !== undefined;
      if ((hasAsset || hasWindow) && (!asset || !window)) {
        return context.json({ code: "invalid_request", message: "asset and window must be provided together." }, 400);
      }
      context.header("content-type", config.RESPONSE_CONTENT_TYPE);
      return context.json(this.predictionEngineService.getStrategySummaries(asset && window ? `${asset}:${window}` : undefined), 200);
    });
    app.get("/v1/combos", (context) => {
      const asset = this.parseAsset(context.req.query("asset"));
      const window = this.parseWindow(context.req.query("window"));
      const limit = this.parseLimit(context.req.query("limit"));
      const hasAsset = context.req.query("asset") !== undefined;
      const hasWindow = context.req.query("window") !== undefined;
      if ((hasAsset || hasWindow) && (!asset || !window)) {
        return context.json({ code: "invalid_request", message: "asset and window must be provided together." }, 400);
      }
      if (limit === null) {
        return context.json({ code: "invalid_request", message: "a valid limit is required." }, 400);
      }
      context.header("content-type", config.RESPONSE_CONTENT_TYPE);
      return context.json(this.predictionEngineService.getComboSummaries(asset && window ? `${asset}:${window}` : undefined).slice(0, limit), 200);
    });
    app.get("/v1/execution", async (context) => {
      const executionPerformance = this.executionService.getPortfolioSummary();
      context.header("content-type", config.RESPONSE_CONTENT_TYPE);
      return context.json(
        {
          executionMode: this.executionService.getExecutionMode(),
          account: await this.executionService.getAccountSummary(Date.now()),
          executionNow: this.executionService.getExecutionSummaries(),
          openPositions: this.executionService.getOpenPositions(),
          executionPerformance,
          paperExecutionPerformance: executionPerformance,
        },
        200,
      );
    });
    app.get("/v1/trades", (context) => {
      const limit = this.parseLimit(context.req.query("limit"));
      if (limit === null) {
        return context.json({ code: "invalid_request", message: "a valid limit is required." }, 400);
      }
      context.header("content-type", config.RESPONSE_CONTENT_TYPE);
      return context.json(this.executionService.getRecentTrades(limit), 200);
    });
    app.get("/v1/markets", (context) => {
      context.header("content-type", config.RESPONSE_CONTENT_TYPE);
      return context.json(this.marketStateService.getMarketSummaries(Date.now()), 200);
    });
    app.get("/v1/predict", (context) => {
      const asset = this.parseAsset(context.req.query("asset"));
      const window = this.parseWindow(context.req.query("window"));
      if (!asset || !window) {
        return context.json({ code: "invalid_request", message: "asset and window are required." }, 400);
      }
      const prediction = this.predictionEngineService.getLatestPrediction(asset, window);
      if (!prediction) {
        return context.json({ code: "not_found", message: "No prediction available for that market." }, 404);
      }
      context.header("content-type", config.RESPONSE_CONTENT_TYPE);
      return context.json(prediction, 200);
    });
    app.get("/v1/predictions", (context) => {
      const asset = this.parseAsset(context.req.query("asset"));
      const window = this.parseWindow(context.req.query("window"));
      const limit = this.parseLimit(context.req.query("limit"));
      if (!asset || !window || limit === null) {
        return context.json({ code: "invalid_request", message: "asset, window, and a valid limit are required." }, 400);
      }
      context.header("content-type", config.RESPONSE_CONTENT_TYPE);
      return context.json(this.predictionEngineService.getPredictions(asset, window, limit), 200);
    });
    return createAdaptorServer({ fetch: app.fetch });
  }
}
