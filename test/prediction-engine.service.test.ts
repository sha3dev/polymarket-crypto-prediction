import * as assert from "node:assert/strict";
import { test } from "node:test";

import { ComboMetricsService } from "../src/combo/combo-metrics.service.ts";
import { MarketStateService } from "../src/market/market-state.service.ts";
import type { InputSnapshot, MarketTrigger } from "../src/market/market.types.ts";
import { PredictionEngineService } from "../src/prediction/prediction-engine.service.ts";
import { PredictionStoreService } from "../src/prediction/prediction-store.service.ts";
import { StrategyEngineService } from "../src/strategy/strategy-engine.service.ts";
import { StrategyMetricsService } from "../src/strategy/strategy-metrics.service.ts";
import type { StrategyDefinition } from "../src/strategy/strategy.types.ts";

test("PredictionEngineService emits a model trigger when the combo state changes without a classic price trigger", () => {
  const strategyDefinitions = buildStrategyDefinitions();
  const marketStateService = new MarketStateService();
  const strategyMetricsService = new StrategyMetricsService(strategyDefinitions);
  const strategyEngineService = new StrategyEngineService(strategyMetricsService);
  const predictionStoreService = new PredictionStoreService();
  const comboMetricsService = new ComboMetricsService();
  const predictionEngineService = new PredictionEngineService(
    marketStateService,
    strategyEngineService,
    strategyMetricsService,
    predictionStoreService,
    comboMetricsService,
  );
  const evaluateCurrentModel = Reflect.get(predictionEngineService, "evaluateCurrentModel") as ((marketKey: "btc:5m") => object | null) | undefined;
  const buildModelDrivenTrigger = Reflect.get(predictionEngineService, "buildModelDrivenTrigger") as
    | ((modelEvaluationSnapshot: object, triggeredAt: number) => MarketTrigger | null)
    | undefined;

  if (!evaluateCurrentModel || !buildModelDrivenTrigger) {
    throw new Error("expected model trigger helpers");
  }

  marketStateService.ingestSnapshot(
    buildSnapshot(1_000, {
      slug: "btc-5m",
      upPrice: 0.505,
      downPrice: 0.495,
      upMidpoint: 0.505,
      downMidpoint: 0.495,
    }),
  );
  const firstEvaluationSnapshot = evaluateCurrentModel.call(predictionEngineService, "btc:5m");
  const firstModelTrigger = firstEvaluationSnapshot === null ? null : buildModelDrivenTrigger.call(predictionEngineService, firstEvaluationSnapshot, 1_000);

  const secondSnapshot = buildSnapshot(3_000, {
    slug: "btc-5m",
    upPrice: 0.58,
    downPrice: 0.42,
    upMidpoint: 0.58,
    downMidpoint: 0.42,
  });
  secondSnapshot.btc_chainlink_price = 59_600;
  secondSnapshot.btc_binance_price = 60_600;
  secondSnapshot.btc_coinbase_price = 60_640;
  secondSnapshot.btc_kraken_price = 60_580;
  secondSnapshot.btc_okx_price = 60_620;
  marketStateService.ingestSnapshot(secondSnapshot);
  const secondEvaluationSnapshot = evaluateCurrentModel.call(predictionEngineService, "btc:5m");
  const secondModelTrigger = secondEvaluationSnapshot === null ? null : buildModelDrivenTrigger.call(predictionEngineService, secondEvaluationSnapshot, 3_000);

  assert.equal(firstModelTrigger, null);
  assert.notEqual(secondModelTrigger, null);
  assert.equal(secondModelTrigger?.triggerType, "combo_state_shift");
  assert.equal(secondModelTrigger?.triggeredToken, "up");
});

type BtcMarketOverride = {
  slug: string | null;
  upPrice: number;
  downPrice: number;
  upMidpoint: number | null;
  downMidpoint: number | null;
};

function buildStrategyDefinitions(): StrategyDefinition[] {
  return [
    { strategyId: "s01", name: "Momentum EWMA", tier: "low", family: "momentum", description: "Short drift continuation.", isComboEligible: true },
    { strategyId: "s02", name: "Token Microprice", tier: "low", family: "microstructure", description: "Top-of-book pressure.", isComboEligible: true },
    { strategyId: "s05", name: "Order Book Churn", tier: "medium", family: "microstructure", description: "Book rotation pressure.", isComboEligible: true },
    { strategyId: "s09", name: "Spot Consensus Momentum", tier: "low", family: "momentum", description: "Cross-venue spot drift.", isComboEligible: true },
    { strategyId: "s12", name: "Volatility Breakout", tier: "medium", family: "momentum", description: "Regime breakout.", isComboEligible: false },
    { strategyId: "s14", name: "Chainlink Basis", tier: "low", family: "pricing", description: "Oracle catch-up.", isComboEligible: true },
    { strategyId: "s16", name: "Freshness Gap", tier: "low", family: "pricing", description: "Spot leads stale token.", isComboEligible: true },
    { strategyId: "s18", name: "Liquidity Shock Fade", tier: "medium", family: "reversion", description: "Short mean reversion.", isComboEligible: true },
    {
      strategyId: "s21",
      name: "Cross-Asset Breadth Impulse",
      tier: "medium",
      family: "cross_asset",
      description: "Market-wide breadth confirmation, not primary conviction.",
      isComboEligible: false,
    },
    {
      strategyId: "s22",
      name: "Anchor Follow Catch-Up",
      tier: "high",
      family: "cross_asset",
      description: "Follow lagging asset after peer impulse.",
      isComboEligible: true,
    },
    {
      strategyId: "s23",
      name: "BTC Trend Reversal Confirmation",
      tier: "high",
      family: "momentum",
      description: "BTC flips and followers start confirming the new side.",
      isComboEligible: true,
    },
    {
      strategyId: "s24",
      name: "Price Stretch Penalty",
      tier: "high",
      family: "risk",
      description: "Penalize late entries already too stretched for the TP target.",
      isComboEligible: true,
    },
  ];
}

function buildSnapshot(generatedAt: number, btc5m: BtcMarketOverride): InputSnapshot {
  const snapshot: Record<string, number | string | null> & { generated_at: number } = {
    generated_at: generatedAt,
    btc_binance_price: 60_000,
    btc_binance_order_book_json: buildOrderBookJson(60_000, 60_001),
    btc_binance_event_ts: generatedAt,
    btc_coinbase_price: 60_010,
    btc_coinbase_order_book_json: buildOrderBookJson(60_009, 60_011),
    btc_coinbase_event_ts: generatedAt,
    btc_kraken_price: 59_990,
    btc_kraken_order_book_json: buildOrderBookJson(59_989, 59_991),
    btc_kraken_event_ts: generatedAt,
    btc_okx_price: 60_005,
    btc_okx_order_book_json: buildOrderBookJson(60_004, 60_006),
    btc_okx_event_ts: generatedAt,
    btc_chainlink_price: 60_003,
    btc_chainlink_event_ts: generatedAt,
    eth_binance_price: 3_000,
    eth_binance_order_book_json: buildOrderBookJson(2_999, 3_001),
    eth_binance_event_ts: generatedAt,
    eth_coinbase_price: 3_001,
    eth_coinbase_order_book_json: buildOrderBookJson(3_000, 3_002),
    eth_coinbase_event_ts: generatedAt,
    eth_kraken_price: 2_998,
    eth_kraken_order_book_json: buildOrderBookJson(2_997, 2_999),
    eth_kraken_event_ts: generatedAt,
    eth_okx_price: 3_002,
    eth_okx_order_book_json: buildOrderBookJson(3_001, 3_003),
    eth_okx_event_ts: generatedAt,
    eth_chainlink_price: 3_000,
    eth_chainlink_event_ts: generatedAt,
    sol_binance_price: 145,
    sol_binance_order_book_json: buildOrderBookJson(144.9, 145.1),
    sol_binance_event_ts: generatedAt,
    sol_coinbase_price: 145.2,
    sol_coinbase_order_book_json: buildOrderBookJson(145.1, 145.3),
    sol_coinbase_event_ts: generatedAt,
    sol_kraken_price: 144.8,
    sol_kraken_order_book_json: buildOrderBookJson(144.7, 144.9),
    sol_kraken_event_ts: generatedAt,
    sol_okx_price: 145.1,
    sol_okx_order_book_json: buildOrderBookJson(145.0, 145.2),
    sol_okx_event_ts: generatedAt,
    sol_chainlink_price: 145.0,
    sol_chainlink_event_ts: generatedAt,
    xrp_binance_price: 0.62,
    xrp_binance_order_book_json: buildOrderBookJson(0.619, 0.621),
    xrp_binance_event_ts: generatedAt,
    xrp_coinbase_price: 0.621,
    xrp_coinbase_order_book_json: buildOrderBookJson(0.62, 0.622),
    xrp_coinbase_event_ts: generatedAt,
    xrp_kraken_price: 0.619,
    xrp_kraken_order_book_json: buildOrderBookJson(0.618, 0.62),
    xrp_kraken_event_ts: generatedAt,
    xrp_okx_price: 0.6205,
    xrp_okx_order_book_json: buildOrderBookJson(0.62, 0.621),
    xrp_okx_event_ts: generatedAt,
    xrp_chainlink_price: 0.62,
    xrp_chainlink_event_ts: generatedAt,
  };

  applyMarketOverride(snapshot, "btc_5m", btc5m, generatedAt);
  applyMarketOverride(snapshot, "btc_15m", undefined, generatedAt);
  applyMarketOverride(snapshot, "eth_5m", undefined, generatedAt);
  applyMarketOverride(snapshot, "eth_15m", undefined, generatedAt);
  applyMarketOverride(snapshot, "sol_5m", undefined, generatedAt);
  applyMarketOverride(snapshot, "sol_15m", undefined, generatedAt);
  applyMarketOverride(snapshot, "xrp_5m", undefined, generatedAt);
  applyMarketOverride(snapshot, "xrp_15m", undefined, generatedAt);

  return snapshot;
}

function applyMarketOverride(
  snapshot: Record<string, number | string | null>,
  prefix: string,
  marketOverride: BtcMarketOverride | undefined,
  generatedAt: number,
): void {
  snapshot[`${prefix}_slug`] = marketOverride?.slug ?? null;
  snapshot[`${prefix}_market_start`] = marketOverride ? "2025-01-01T00:00:00.000Z" : null;
  snapshot[`${prefix}_market_end`] = marketOverride ? "2025-01-01T00:05:00.000Z" : null;
  snapshot[`${prefix}_price_to_beat`] = marketOverride ? 100 : null;
  snapshot[`${prefix}_up_asset_id`] = marketOverride ? `${prefix}-up` : null;
  snapshot[`${prefix}_up_price`] = marketOverride?.upPrice ?? null;
  snapshot[`${prefix}_up_order_book_json`] =
    marketOverride && marketOverride.upMidpoint !== null ? buildOrderBookJson(marketOverride.upMidpoint - 0.01, marketOverride.upMidpoint + 0.01) : null;
  snapshot[`${prefix}_up_event_ts`] = marketOverride ? generatedAt : null;
  snapshot[`${prefix}_down_asset_id`] = marketOverride ? `${prefix}-down` : null;
  snapshot[`${prefix}_down_price`] = marketOverride?.downPrice ?? null;
  snapshot[`${prefix}_down_order_book_json`] =
    marketOverride && marketOverride.downMidpoint !== null ? buildOrderBookJson(marketOverride.downMidpoint - 0.01, marketOverride.downMidpoint + 0.01) : null;
  snapshot[`${prefix}_down_event_ts`] = marketOverride ? generatedAt : null;
}

function buildOrderBookJson(bestBid: number, bestAsk: number): string {
  return JSON.stringify({
    bids: [
      { price: bestBid, size: 10 },
      { price: bestBid - 0.01, size: 12 },
    ],
    asks: [
      { price: bestAsk, size: 11 },
      { price: bestAsk + 0.01, size: 9 },
    ],
  });
}
