import * as assert from "node:assert/strict";
import { test } from "node:test";

import { ServiceRuntime } from "../src/index.ts";
import type { StrategySummary } from "../src/index.ts";

test("ServiceRuntime serves the dashboard HTML", async () => {
  const serviceRuntime = ServiceRuntime.createDefault();
  const server = serviceRuntime.buildServer();

  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to bind test server");
  }

  const response = await fetch(`http://127.0.0.1:${address.port}/`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /Polymarket 5m \/ 15m predictor/);
  assert.match(html, /Combo Board/);
  assert.match(html, /Trade Candidates/);
  assert.match(html, /Direction chosen by the winning combo/);

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
});

test("ServiceRuntime validates predict queries and exposes health and markets", async () => {
  const serviceRuntime = ServiceRuntime.createDefault();
  const server = serviceRuntime.buildServer();

  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to bind test server");
  }

  const invalidResponse = await fetch(`http://127.0.0.1:${address.port}/v1/predict?asset=ada&window=5m`);
  const invalidJson = await invalidResponse.json();
  assert.equal(invalidResponse.status, 400);
  assert.equal(invalidJson.code, "invalid_request");

  const missingPredictionResponse = await fetch(`http://127.0.0.1:${address.port}/v1/predict?asset=btc&window=5m`);
  assert.equal(missingPredictionResponse.status, 404);

  const healthResponse = await fetch(`http://127.0.0.1:${address.port}/v1/healthz`);
  const healthJson = await healthResponse.json();
  assert.equal(healthResponse.status, 200);
  assert.equal(healthJson.ok, true);
  assert.equal(healthJson.monitoredMarketCount, 8);

  const marketsResponse = await fetch(`http://127.0.0.1:${address.port}/v1/markets`);
  const marketsJson = await marketsResponse.json();
  assert.equal(marketsResponse.status, 200);
  assert.equal(marketsJson.length, 8);

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
});

test("ServiceRuntime creates predictions, enforces cooldown, resolves TP/SL outcomes, and updates summaries", async () => {
  const serviceRuntime = ServiceRuntime.createDefault();
  const server = serviceRuntime.buildServer();

  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to bind test server");
  }

  serviceRuntime.ingestSnapshot(
    buildSnapshot(1_000, {
      btc5m: { slug: "btc-5m", upPrice: 0.45, downPrice: 0.55, upMidpoint: 0.45, downMidpoint: 0.55 },
      eth5m: { slug: "eth-5m", upPrice: 0.45, downPrice: 0.55, upMidpoint: null, downMidpoint: null },
    }),
  );
  serviceRuntime.ingestSnapshot(
    buildSnapshot(2_000, {
      btc5m: { slug: "btc-5m", upPrice: 0.51, downPrice: 0.49, upMidpoint: 0.51, downMidpoint: 0.49 },
      eth5m: { slug: "eth-5m", upPrice: 0.5, downPrice: 0.5, upMidpoint: null, downMidpoint: null },
    }),
  );
  serviceRuntime.ingestSnapshot(
    buildSnapshot(3_000, {
      btc5m: { slug: "btc-5m", upPrice: 0.49, downPrice: 0.51, upMidpoint: 0.49, downMidpoint: 0.51 },
    }),
  );
  serviceRuntime.ingestSnapshot(
    buildSnapshot(5_000, {
      btc5m: { slug: "btc-5m", upPrice: 0.55, downPrice: 0.45, upMidpoint: 0.55, downMidpoint: 0.45 },
    }),
  );
  serviceRuntime.ingestSnapshot(
    buildSnapshot(8_500, {
      btc5m: { slug: "btc-5m", upPrice: 0.56, downPrice: 0.44, upMidpoint: 0.56, downMidpoint: 0.44, chainlinkPrice: 59_500 },
      eth5m: { slug: "eth-5m", upPrice: 0.54, downPrice: 0.46, upMidpoint: 0.54, downMidpoint: 0.46, chainlinkPrice: 2_940 },
    }),
  );
  serviceRuntime.ingestSnapshot(
    buildSnapshot(12_000, {
      btc5m: { slug: "btc-5m", upPrice: 0.6, downPrice: 0.4, upMidpoint: 0.6, downMidpoint: 0.4, chainlinkPrice: 59_400 },
      eth5m: { slug: "eth-5m", upPrice: 0.57, downPrice: 0.43, upMidpoint: 0.57, downMidpoint: 0.43, chainlinkPrice: 2_930 },
    }),
  );

  const latestPredictionResponse = await fetch(`http://127.0.0.1:${address.port}/v1/predict?asset=btc&window=5m`);
  const latestPredictionJson = await latestPredictionResponse.json();
  assert.equal(latestPredictionResponse.status, 200);
  assert.equal(latestPredictionJson.asset, "btc");
  assert.equal(latestPredictionJson.window, "5m");
  assert.ok(latestPredictionJson.strategyBreakdown.length >= 8);
  assert.equal(typeof latestPredictionJson.baseWeightedScore, "number");
  assert.equal(typeof latestPredictionJson.adjustedWeightedScore, "number");
  assert.equal(typeof latestPredictionJson.baseConfidence, "number");
  assert.equal(typeof latestPredictionJson.adjustedConfidence, "number");
  assert.equal(typeof latestPredictionJson.crossAssetRegime.breadthDirection, "string");
  assert.equal(typeof latestPredictionJson.crossAssetRegime.breadthStrength, "number");
  assert.equal(typeof latestPredictionJson.crossAssetRegime.regimeId, "string");
  assert.equal(Array.isArray(latestPredictionJson.comboBreakdown.activeCombos), true);
  assert.equal(typeof latestPredictionJson.selectedCombo.comboKey, "string");
  assert.equal(Array.isArray(latestPredictionJson.selectedCombo.memberStrategyIds), true);

  const cooldownPredictionsResponse = await fetch(`http://127.0.0.1:${address.port}/v1/predictions?asset=btc&window=5m&limit=10`);
  const cooldownPredictionsJson = await cooldownPredictionsResponse.json();
  assert.equal(cooldownPredictionsJson.length, 1);
  const warmupExecutionResponse = await fetch(`http://127.0.0.1:${address.port}/v1/execution`);
  const warmupExecutionJson = await warmupExecutionResponse.json();
  const btcWarmupDecision = warmupExecutionJson.executionNow.find((execution: { marketKey: string }) => execution.marketKey === "btc:5m");
  assert.equal(warmupExecutionResponse.status, 200);
  assert.equal(btcWarmupDecision.decision.blockingReasons.includes("market_warming_up"), true);

  serviceRuntime.ingestSnapshot(
    buildSnapshot(33_000, {
      btc5m: { slug: "btc-5m", upPrice: 0.62, downPrice: 0.38, upMidpoint: 0.62, downMidpoint: 0.38 },
      eth5m: { slug: "eth-5m", upPrice: 0.44, downPrice: 0.56, upMidpoint: null, downMidpoint: null },
    }),
  );
  serviceRuntime.ingestSnapshot(
    buildSnapshot(34_000, {
      btc5m: { slug: "btc-5m", upPrice: 0.73, downPrice: 0.27, upMidpoint: 0.73, downMidpoint: 0.27 },
    }),
  );
  serviceRuntime.ingestSnapshot(
    buildSnapshot(35_000, {
      btc5m: { slug: "btc-5m", upPrice: 0.75, downPrice: 0.25, upMidpoint: 0.75, downMidpoint: 0.25 },
    }),
  );
  serviceRuntime.ingestSnapshot(
    buildSnapshot(41_000, {
      btc5m: { slug: "btc-5m", upPrice: 0.48, downPrice: 0.52, upMidpoint: 0.48, downMidpoint: 0.52 },
    }),
  );
  serviceRuntime.ingestSnapshot(
    buildSnapshot(42_000, {
      btc5m: { slug: "btc-5m", upPrice: 0.51, downPrice: 0.49, upMidpoint: 0.51, downMidpoint: 0.49 },
    }),
  );
  serviceRuntime.ingestSnapshot(
    buildSnapshot(44_000, {
      btc5m: { slug: "btc-5m", upPrice: 0.54, downPrice: 0.46, upMidpoint: 0.54, downMidpoint: 0.46 },
    }),
  );
  serviceRuntime.ingestSnapshot(
    buildSnapshot(49_000, {
      btc5m: { slug: "btc-5m", upPrice: 0.75, downPrice: 0.25, upMidpoint: 0.75, downMidpoint: 0.25 },
    }),
  );

  const limitedPredictionsResponse = await fetch(`http://127.0.0.1:${address.port}/v1/predictions?asset=btc&window=5m&limit=2`);
  const limitedPredictionsJson = await limitedPredictionsResponse.json();
  assert.equal(limitedPredictionsJson.length >= 1, true);

  const strategiesResponse = await fetch(`http://127.0.0.1:${address.port}/v1/strategies`);
  const strategiesJson = (await strategiesResponse.json()) as StrategySummary[];
  assert.equal(strategiesResponse.status, 200);
  assert.equal(strategiesJson.length, 11);
  assert.equal(
    strategiesJson.every((strategy) => strategy.totalResolved >= 0),
    true,
  );
  assert.equal(strategiesJson[0]?.marketKey, null);

  const btcStrategiesResponse = await fetch(`http://127.0.0.1:${address.port}/v1/strategies?asset=btc&window=5m`);
  const btcStrategiesJson = (await btcStrategiesResponse.json()) as StrategySummary[];
  assert.equal(btcStrategiesResponse.status, 200);
  assert.equal(btcStrategiesJson.length, 11);
  assert.equal(btcStrategiesJson[0]?.marketKey, "btc:5m");
  assert.equal(
    btcStrategiesJson.every((strategy) => strategy.totalResolved >= 0),
    true,
  );

  const solStrategiesResponse = await fetch(`http://127.0.0.1:${address.port}/v1/strategies?asset=sol&window=5m`);
  const solStrategiesJson = (await solStrategiesResponse.json()) as StrategySummary[];
  assert.equal(solStrategiesResponse.status, 200);
  assert.equal(solStrategiesJson.length, 11);
  assert.equal(solStrategiesJson[0]?.marketKey, "sol:5m");
  assert.ok(solStrategiesJson.every((strategy) => strategy.totalResolved === 0));

  const combosResponse = await fetch(`http://127.0.0.1:${address.port}/v1/combos`);
  const combosJson = await combosResponse.json();
  assert.equal(combosResponse.status, 200);
  assert.equal(Array.isArray(combosJson), true);

  const btcCombosResponse = await fetch(`http://127.0.0.1:${address.port}/v1/combos?asset=btc&window=5m&limit=5`);
  const btcCombosJson = await btcCombosResponse.json();
  assert.equal(btcCombosResponse.status, 200);
  assert.equal(Array.isArray(btcCombosJson), true);
  assert.equal(
    btcCombosJson.every((comboSummary: { marketKey: string }) => comboSummary.marketKey === "btc:5m"),
    true,
  );

  const executionResponse = await fetch(`http://127.0.0.1:${address.port}/v1/execution`);
  const executionJson = await executionResponse.json();
  assert.equal(executionResponse.status, 200);
  assert.equal(executionJson.executionMode, "paper");
  assert.equal(executionJson.account.mode, "paper");
  assert.equal(executionJson.account.balanceUsd, null);
  assert.equal(executionJson.executionNow.length, 8);
  assert.equal(typeof executionJson.executionNow[0].decision.marketTradeCount, "number");
  assert.equal(typeof executionJson.executionNow[0].decision.breadthDirection, "string");
  assert.equal(typeof executionJson.executionNow[0].decision.hasBreadthAlignment, "boolean");
  assert.equal(typeof executionJson.executionNow[0].decision.marketScore, "number");
  assert.equal("readinessScore" in executionJson.executionNow[0].decision, false);
  assert.equal("executionScore" in executionJson.executionNow[0].decision, false);
  assert.equal("effectiveExecutionScore" in executionJson.executionNow[0].decision, false);
  assert.equal(Array.isArray(executionJson.executionNow[0].decision.selectedComboStrategyIds), true);
  assert.equal(executionJson.executionNow[0].decision.orderShareCount >= 5, true);
  assert.equal(executionJson.executionNow[0].decision.orderNotionalUsd === null || executionJson.executionNow[0].decision.orderNotionalUsd >= 1, true);
  assert.equal(typeof executionJson.executionPerformance.tradeCount, "number");
  assert.equal(typeof executionJson.paperExecutionPerformance.tradeCount, "number");

  const tradesResponse = await fetch(`http://127.0.0.1:${address.port}/v1/trades?limit=10`);
  const tradesJson = await tradesResponse.json();
  assert.equal(tradesResponse.status, 200);
  assert.equal(Array.isArray(tradesJson), true);
  if (tradesJson.length > 0) {
    assert.equal(tradesJson[0].shareCount >= 5, true);
    assert.equal(tradesJson[0].entryNotionalUsd >= 1, true);
  }

  const summaryResponse = await fetch(`http://127.0.0.1:${address.port}/v1/dashboard/summary`);
  const summaryJson = await summaryResponse.json();
  assert.equal(summaryResponse.status, 200);
  assert.equal(summaryJson.executionMode, "paper");
  assert.equal(summaryJson.account.mode, "paper");
  assert.equal(Array.isArray(summaryJson.latestPredictions), true);
  assert.equal(
    summaryJson.latestPredictions.every((prediction: { result: { status: string } }) => prediction.result.status !== "pending"),
    true,
  );
  assert.equal(summaryJson.health.pendingEvaluationCount, summaryJson.openPositions?.length ?? 0);
  assert.equal(summaryJson.markets.length, 8);
  assert.equal(summaryJson.globalRegime === null || typeof summaryJson.globalRegime.regimeId === "string", true);
  assert.equal(summaryJson.globalRegimes === null || typeof summaryJson.globalRegimes["5m"] === "object", true);
  assert.equal(summaryJson.globalRegimes === null || typeof summaryJson.globalRegimes["15m"] === "object", true);
  assert.ok(summaryJson.executionNow.length === 8);
  assert.equal(summaryJson.marketPerformance.length, 8);
  assert.equal(summaryJson.marketPnlTable.length, 8);
  assert.equal(Array.isArray(summaryJson.winningCombinations), true);
  assert.equal(Array.isArray(summaryJson.discoveryBoard), true);
  assert.equal(Array.isArray(summaryJson.tradeCandidates), true);
  assert.equal(typeof summaryJson.executionPerformance.tradeCount, "number");
  assert.equal(typeof summaryJson.paperExecutionPerformance.tradeCount, "number");

  const invalidLimitResponse = await fetch(`http://127.0.0.1:${address.port}/v1/predictions?asset=btc&window=5m&limit=999`);
  assert.equal(invalidLimitResponse.status, 400);
  const invalidStrategiesResponse = await fetch(`http://127.0.0.1:${address.port}/v1/strategies?asset=btc`);
  assert.equal(invalidStrategiesResponse.status, 400);
  const invalidTradeLimitResponse = await fetch(`http://127.0.0.1:${address.port}/v1/trades?limit=999`);
  assert.equal(invalidTradeLimitResponse.status, 400);

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
});

test("ServiceRuntime exposes ETH combo candidates from BTC anchor support before strong breadth exists", async () => {
  const serviceRuntime = ServiceRuntime.createDefault();
  const server = serviceRuntime.buildServer();

  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to bind test server");
  }

  serviceRuntime.ingestSnapshot(
    buildSnapshot(1_000, {
      btc5m: { slug: "btc-5m", upPrice: 0.48, downPrice: 0.52, upMidpoint: 0.48, downMidpoint: 0.52 },
      eth5m: { slug: "eth-5m", upPrice: 0.48, downPrice: 0.52, upMidpoint: 0.48, downMidpoint: 0.52 },
    }),
  );
  serviceRuntime.ingestSnapshot(
    buildSnapshot(2_000, {
      btc5m: { slug: "btc-5m", upPrice: 0.52, downPrice: 0.48, upMidpoint: 0.52, downMidpoint: 0.48 },
      eth5m: { slug: "eth-5m", upPrice: 0.505, downPrice: 0.495, upMidpoint: 0.505, downMidpoint: 0.495 },
    }),
  );
  serviceRuntime.ingestSnapshot(
    buildSnapshot(4_000, {
      btc5m: { slug: "btc-5m", upPrice: 0.57, downPrice: 0.43, upMidpoint: 0.57, downMidpoint: 0.43, chainlinkPrice: 59_600 },
      eth5m: { slug: "eth-5m", upPrice: 0.52, downPrice: 0.48, upMidpoint: 0.52, downMidpoint: 0.48, chainlinkPrice: 2_950 },
    }),
  );
  serviceRuntime.ingestSnapshot(
    buildSnapshot(7_000, {
      btc5m: { slug: "btc-5m", upPrice: 0.61, downPrice: 0.39, upMidpoint: 0.61, downMidpoint: 0.39, chainlinkPrice: 59_300 },
      eth5m: { slug: "eth-5m", upPrice: 0.56, downPrice: 0.44, upMidpoint: 0.56, downMidpoint: 0.44, chainlinkPrice: 2_920 },
    }),
  );
  serviceRuntime.ingestSnapshot(
    buildSnapshot(10_000, {
      btc5m: { slug: "btc-5m", upPrice: 0.64, downPrice: 0.36, upMidpoint: 0.64, downMidpoint: 0.36, chainlinkPrice: 59_100 },
      eth5m: { slug: "eth-5m", upPrice: 0.59, downPrice: 0.41, upMidpoint: 0.59, downMidpoint: 0.41, chainlinkPrice: 2_900 },
    }),
  );
  serviceRuntime.ingestSnapshot(
    buildSnapshot(12_000, {
      btc5m: { slug: "btc-5m", upPrice: 0.645, downPrice: 0.355, upMidpoint: 0.645, downMidpoint: 0.355, chainlinkPrice: 59_000 },
      eth5m: { slug: "eth-5m", upPrice: 0.595, downPrice: 0.405, upMidpoint: 0.595, downMidpoint: 0.405, chainlinkPrice: 2_890 },
    }),
  );

  const ethCombosResponse = await fetch(`http://127.0.0.1:${address.port}/v1/combos?asset=eth&window=5m&limit=5`);
  const ethCombosJson = await ethCombosResponse.json();

  assert.equal(ethCombosResponse.status, 200);
  assert.equal(Array.isArray(ethCombosJson), true);
  assert.equal(ethCombosJson.length >= 1, true);
  assert.equal(typeof ethCombosJson[0].comboKey, "string");

  const ethPredictionsResponse = await fetch(`http://127.0.0.1:${address.port}/v1/predictions?asset=eth&window=5m&limit=5`);
  const ethPredictionsJson = await ethPredictionsResponse.json();

  assert.equal(ethPredictionsResponse.status, 200);
  assert.equal(Array.isArray(ethPredictionsJson), true);
  assert.equal(ethPredictionsJson.length >= 1, true);
  assert.equal(ethPredictionsJson[0].marketKey, "eth:5m");

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
});

test("ServiceRuntime keeps SOL combo candidates visible when BTC and ETH provide soft aligned anchor support", async () => {
  const serviceRuntime = ServiceRuntime.createDefault();
  const server = serviceRuntime.buildServer();

  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to bind test server");
  }

  serviceRuntime.ingestSnapshot(
    buildSnapshot(1_000, {
      btc5m: { slug: "btc-5m", upPrice: 0.48, downPrice: 0.52, upMidpoint: 0.48, downMidpoint: 0.52 },
      eth5m: { slug: "eth-5m", upPrice: 0.485, downPrice: 0.515, upMidpoint: 0.485, downMidpoint: 0.515 },
      sol5m: { slug: "sol-5m", upPrice: 0.47, downPrice: 0.53, upMidpoint: 0.47, downMidpoint: 0.53 },
    }),
  );
  serviceRuntime.ingestSnapshot(
    buildSnapshot(2_000, {
      btc5m: { slug: "btc-5m", upPrice: 0.53, downPrice: 0.47, upMidpoint: 0.53, downMidpoint: 0.47 },
      eth5m: { slug: "eth-5m", upPrice: 0.515, downPrice: 0.485, upMidpoint: 0.515, downMidpoint: 0.485 },
      sol5m: { slug: "sol-5m", upPrice: 0.505, downPrice: 0.495, upMidpoint: 0.505, downMidpoint: 0.495 },
    }),
  );
  serviceRuntime.ingestSnapshot(
    buildSnapshot(4_000, {
      btc5m: { slug: "btc-5m", upPrice: 0.58, downPrice: 0.42, upMidpoint: 0.58, downMidpoint: 0.42, chainlinkPrice: 59_500 },
      eth5m: { slug: "eth-5m", upPrice: 0.55, downPrice: 0.45, upMidpoint: 0.55, downMidpoint: 0.45, chainlinkPrice: 2_940 },
      sol5m: { slug: "sol-5m", upPrice: 0.525, downPrice: 0.475, upMidpoint: 0.525, downMidpoint: 0.475, chainlinkPrice: 132 },
    }),
  );
  serviceRuntime.ingestSnapshot(
    buildSnapshot(7_000, {
      btc5m: { slug: "btc-5m", upPrice: 0.61, downPrice: 0.39, upMidpoint: 0.61, downMidpoint: 0.39, chainlinkPrice: 59_250 },
      eth5m: { slug: "eth-5m", upPrice: 0.58, downPrice: 0.42, upMidpoint: 0.58, downMidpoint: 0.42, chainlinkPrice: 2_910 },
      sol5m: { slug: "sol-5m", upPrice: 0.54, downPrice: 0.46, upMidpoint: 0.54, downMidpoint: 0.46, chainlinkPrice: 131.5 },
    }),
  );
  serviceRuntime.ingestSnapshot(
    buildSnapshot(9_000, {
      btc5m: { slug: "btc-5m", upPrice: 0.615, downPrice: 0.385, upMidpoint: 0.615, downMidpoint: 0.385, chainlinkPrice: 59_200 },
      eth5m: { slug: "eth-5m", upPrice: 0.585, downPrice: 0.415, upMidpoint: 0.585, downMidpoint: 0.415, chainlinkPrice: 2_900 },
      sol5m: { slug: "sol-5m", upPrice: 0.55, downPrice: 0.45, upMidpoint: 0.55, downMidpoint: 0.45, chainlinkPrice: 131 },
    }),
  );

  const solCombosResponse = await fetch(`http://127.0.0.1:${address.port}/v1/combos?asset=sol&window=5m&limit=5`);
  const solCombosJson = await solCombosResponse.json();

  assert.equal(solCombosResponse.status, 200);
  assert.equal(Array.isArray(solCombosJson), true);
  assert.equal(solCombosJson.length >= 1, true);
  assert.equal(solCombosJson[0].marketKey, "sol:5m");

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
});

function buildSnapshot(
  generatedAt: number,
  overrides: {
    btc5m?: MarketOverride;
    btc15m?: MarketOverride;
    eth5m?: MarketOverride;
    eth15m?: MarketOverride;
    sol5m?: MarketOverride;
    sol15m?: MarketOverride;
    xrp5m?: MarketOverride;
    xrp15m?: MarketOverride;
  },
): Record<string, number | string | null> & { generated_at: number } {
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

  applyMarketOverride(snapshot, "btc_5m", overrides.btc5m, generatedAt);
  applyMarketOverride(snapshot, "btc_15m", overrides.btc15m, generatedAt);
  applyMarketOverride(snapshot, "eth_5m", overrides.eth5m, generatedAt);
  applyMarketOverride(snapshot, "eth_15m", overrides.eth15m, generatedAt);
  applyMarketOverride(snapshot, "sol_5m", overrides.sol5m, generatedAt);
  applyMarketOverride(snapshot, "sol_15m", overrides.sol15m, generatedAt);
  applyMarketOverride(snapshot, "xrp_5m", overrides.xrp5m, generatedAt);
  applyMarketOverride(snapshot, "xrp_15m", overrides.xrp15m, generatedAt);

  return snapshot;
}

type MarketOverride = {
  slug: string | null;
  upPrice: number;
  downPrice: number;
  upMidpoint: number | null;
  downMidpoint: number | null;
  chainlinkPrice?: number;
};

function applyMarketOverride(
  snapshot: Record<string, number | string | null>,
  prefix: string,
  marketOverride: MarketOverride | undefined,
  generatedAt: number,
): void {
  const [asset] = prefix.split("_");
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
  if (marketOverride?.chainlinkPrice !== undefined) {
    snapshot[`${asset}_chainlink_price`] = marketOverride.chainlinkPrice;
  }
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
