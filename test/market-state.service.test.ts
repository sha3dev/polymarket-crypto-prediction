import * as assert from "node:assert/strict";
import { test } from "node:test";

import { MarketStateService } from "../src/market/market-state.service.ts";
import type { AssetSymbol, InputSnapshot, MarketKey, MarketWindow } from "../src/market/market.types.ts";

test("MarketStateService exposes bias regimes before strong breadth exists", () => {
  const marketStateService = new MarketStateService();

  marketStateService.ingestSnapshot(buildSnapshot(1_000, 1));
  marketStateService.ingestSnapshot(buildSnapshot(20_000, 1.004));

  const crossAssetRegime = marketStateService.getCrossAssetRegime("btc:5m");

  assert.notEqual(crossAssetRegime, null);
  assert.equal(crossAssetRegime?.regimeId, "btc_eth_bias_up");
  assert.equal((crossAssetRegime?.breadthParticipation ?? 0) > 0, true);
  assert.equal((crossAssetRegime?.breadthStrength ?? 0) > 0, true);
  assert.equal((crossAssetRegime?.accelerationScore ?? 0) > 0, true);
  assert.equal(Math.abs((crossAssetRegime?.reversalRiskScore ?? 1) - 0.19) > 0.01, true);
});

test("MarketStateService detects anchor-follow breakout triggers outside the half-cross", () => {
  const marketStateService = new MarketStateService();

  marketStateService.ingestSnapshot(
    buildSelectiveSnapshot(1_000, {
      "btc:5m": 0.56,
      "eth:5m": 0.54,
    }),
  );
  marketStateService.ingestSnapshot(
    buildSelectiveSnapshot(3_000, {
      "btc:5m": 0.62,
      "eth:5m": 0.58,
    }),
  );

  const ethSummary = marketStateService.getMarketSummaries(3_000).find((marketSummary) => marketSummary.marketKey === "eth:5m");

  assert.notEqual(ethSummary, undefined);
  assert.equal(ethSummary?.lastTrigger?.triggerType, "anchor_follow_breakout");
});

test("MarketStateService detects pullback-resume triggers without a half-cross", () => {
  const marketStateService = new MarketStateService();

  marketStateService.ingestSnapshot(
    buildSelectiveSnapshot(1_000, {
      "btc:5m": 0.6,
    }),
  );
  marketStateService.ingestSnapshot(
    buildSelectiveSnapshot(2_000, {
      "btc:5m": 0.54,
    }),
  );
  marketStateService.ingestSnapshot(
    buildSelectiveSnapshot(3_000, {
      "btc:5m": 0.56,
    }),
  );
  marketStateService.ingestSnapshot(
    buildSelectiveSnapshot(4_000, {
      "btc:5m": 0.58,
    }),
  );

  const btcSummary = marketStateService.getMarketSummaries(4_000).find((marketSummary) => marketSummary.marketKey === "btc:5m");

  assert.notEqual(btcSummary, undefined);
  assert.equal(btcSummary?.lastTrigger?.triggerType, "pullback_resume");
});

test("MarketStateService detects laggard-release triggers for follower assets", () => {
  const marketStateService = new MarketStateService();

  marketStateService.ingestSnapshot(
    buildSelectiveSnapshot(1_000, {
      "btc:5m": 0.56,
      "eth:5m": 0.55,
      "sol:5m": 0.52,
    }),
  );
  marketStateService.ingestSnapshot(
    buildSelectiveSnapshot(3_000, {
      "btc:5m": 0.66,
      "eth:5m": 0.63,
      "sol:5m": 0.56,
    }),
  );

  const solSummary = marketStateService.getMarketSummaries(3_000).find((marketSummary) => marketSummary.marketKey === "sol:5m");

  assert.notEqual(solSummary, undefined);
  assert.equal(solSummary?.lastTrigger?.triggerType, "laggard_release");
});

function buildSnapshot(generatedAt: number, driftMultiplier: number): Record<string, number | string | null> & { generated_at: number } {
  const snapshot: Record<string, number | string | null> & { generated_at: number } = {
    generated_at: generatedAt,
  };

  appendMarketSnapshot(snapshot, generatedAt, "btc", "5m", 60_000, driftMultiplier, "btc-5m");
  appendMarketSnapshot(snapshot, generatedAt, "btc", "15m", 60_000, driftMultiplier, "btc-15m");
  appendMarketSnapshot(snapshot, generatedAt, "eth", "5m", 3_000, driftMultiplier, "eth-5m");
  appendMarketSnapshot(snapshot, generatedAt, "eth", "15m", 3_000, driftMultiplier, "eth-15m");
  appendMarketSnapshot(snapshot, generatedAt, "sol", "5m", 150, driftMultiplier, "sol-5m");
  appendMarketSnapshot(snapshot, generatedAt, "sol", "15m", 150, driftMultiplier, "sol-15m");
  appendMarketSnapshot(snapshot, generatedAt, "xrp", "5m", 0.6, driftMultiplier, "xrp-5m");
  appendMarketSnapshot(snapshot, generatedAt, "xrp", "15m", 0.6, driftMultiplier, "xrp-15m");

  return snapshot;
}

function buildSelectiveSnapshot(generatedAt: number, upMidpoints: Partial<Record<MarketKey, number>>): InputSnapshot {
  const snapshot: InputSnapshot = {
    generated_at: generatedAt,
  };

  appendSelectiveMarketSnapshot(snapshot, generatedAt, "btc", "5m", upMidpoints["btc:5m"] ?? 0.5, "btc-5m");
  appendSelectiveMarketSnapshot(snapshot, generatedAt, "btc", "15m", upMidpoints["btc:15m"] ?? 0.5, "btc-15m");
  appendSelectiveMarketSnapshot(snapshot, generatedAt, "eth", "5m", upMidpoints["eth:5m"] ?? 0.5, "eth-5m");
  appendSelectiveMarketSnapshot(snapshot, generatedAt, "eth", "15m", upMidpoints["eth:15m"] ?? 0.5, "eth-15m");
  appendSelectiveMarketSnapshot(snapshot, generatedAt, "sol", "5m", upMidpoints["sol:5m"] ?? 0.5, "sol-5m");
  appendSelectiveMarketSnapshot(snapshot, generatedAt, "sol", "15m", upMidpoints["sol:15m"] ?? 0.5, "sol-15m");
  appendSelectiveMarketSnapshot(snapshot, generatedAt, "xrp", "5m", upMidpoints["xrp:5m"] ?? 0.5, "xrp-5m");
  appendSelectiveMarketSnapshot(snapshot, generatedAt, "xrp", "15m", upMidpoints["xrp:15m"] ?? 0.5, "xrp-15m");

  return snapshot;
}

function appendMarketSnapshot(
  snapshot: Record<string, number | string | null>,
  generatedAt: number,
  asset: "btc" | "eth" | "sol" | "xrp",
  window: "5m" | "15m",
  baseSpotPrice: number,
  driftMultiplier: number,
  slug: string,
): void {
  const prefix = `${asset}_${window}`;
  const upPrice = Math.min(0.99, 0.5 * driftMultiplier);
  const downPrice = Math.max(0.01, 1 - upPrice);

  snapshot[`${prefix}_slug`] = slug;
  snapshot[`${prefix}_up_price`] = upPrice;
  snapshot[`${prefix}_down_price`] = downPrice;
  snapshot[`${prefix}_up_event_ts`] = generatedAt;
  snapshot[`${prefix}_down_event_ts`] = generatedAt;

  snapshot[`${asset}_binance_price`] = baseSpotPrice * driftMultiplier;
  snapshot[`${asset}_binance_event_ts`] = generatedAt;
  snapshot[`${asset}_coinbase_price`] = baseSpotPrice * driftMultiplier * 1.0004;
  snapshot[`${asset}_coinbase_event_ts`] = generatedAt;
  snapshot[`${asset}_kraken_price`] = baseSpotPrice * driftMultiplier * 0.9996;
  snapshot[`${asset}_kraken_event_ts`] = generatedAt;
  snapshot[`${asset}_okx_price`] = baseSpotPrice * driftMultiplier * 1.0002;
  snapshot[`${asset}_okx_event_ts`] = generatedAt;
  snapshot[`${asset}_chainlink_price`] = baseSpotPrice * driftMultiplier;
  snapshot[`${asset}_chainlink_event_ts`] = generatedAt;
}

function appendSelectiveMarketSnapshot(
  snapshot: Record<string, number | string | null>,
  generatedAt: number,
  asset: AssetSymbol,
  window: MarketWindow,
  upMidpoint: number,
  slug: string,
): void {
  const prefix = `${asset}_${window}`;
  const downMidpoint = Math.max(0.01, Math.min(0.99, 1 - upMidpoint));
  const baseSpotPriceMap: Record<AssetSymbol, number> = {
    btc: 60_000,
    eth: 3_000,
    sol: 150,
    xrp: 0.6,
  };
  const baseSpotPrice = baseSpotPriceMap[asset];
  const driftMultiplier = upMidpoint / 0.5;

  snapshot[`${prefix}_slug`] = slug;
  snapshot[`${prefix}_up_price`] = upMidpoint;
  snapshot[`${prefix}_down_price`] = downMidpoint;
  snapshot[`${prefix}_up_event_ts`] = generatedAt;
  snapshot[`${prefix}_down_event_ts`] = generatedAt;

  snapshot[`${asset}_binance_price`] = baseSpotPrice * driftMultiplier;
  snapshot[`${asset}_binance_event_ts`] = generatedAt;
  snapshot[`${asset}_coinbase_price`] = baseSpotPrice * driftMultiplier * 1.0004;
  snapshot[`${asset}_coinbase_event_ts`] = generatedAt;
  snapshot[`${asset}_kraken_price`] = baseSpotPrice * driftMultiplier * 0.9996;
  snapshot[`${asset}_kraken_event_ts`] = generatedAt;
  snapshot[`${asset}_okx_price`] = baseSpotPrice * driftMultiplier * 1.0002;
  snapshot[`${asset}_okx_event_ts`] = generatedAt;
  snapshot[`${asset}_chainlink_price`] = baseSpotPrice * driftMultiplier;
  snapshot[`${asset}_chainlink_event_ts`] = generatedAt;
}
