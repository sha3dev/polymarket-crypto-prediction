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

test("MarketStateService exposes btc-eth bias when anchor token momentum aligns before breadth wakes up", () => {
  const marketStateService = new MarketStateService();

  marketStateService.ingestSnapshot(buildAnchorBiasSnapshot(1_000));
  marketStateService.ingestSnapshot(buildAnchorBiasSnapshot(20_000));

  const crossAssetRegime = marketStateService.getCrossAssetRegime("btc:5m");

  assert.notEqual(crossAssetRegime, null);
  assert.equal(crossAssetRegime?.regimeId, "btc_eth_bias_down");
  assert.equal((crossAssetRegime?.breadthStrength ?? 1) < 0.04, true);
  assert.equal((crossAssetRegime?.breadthParticipation ?? 0) >= 0.55, true);
});

test("MarketStateService ignores follower-only moves when building anchor breadth", () => {
  const marketStateService = new MarketStateService();

  marketStateService.ingestSnapshot(buildFollowerOnlySnapshot(1_000));
  marketStateService.ingestSnapshot(buildFollowerOnlySnapshot(20_000));

  const crossAssetRegime = marketStateService.getCrossAssetRegime("btc:5m");

  assert.notEqual(crossAssetRegime, null);
  assert.equal(crossAssetRegime?.regimeId, "neutral");
  assert.equal(crossAssetRegime?.breadthDirection, "NEUTRAL");
  assert.equal(crossAssetRegime?.breadthStrength, 0);
  assert.equal((crossAssetRegime?.followerParticipation ?? 0) > 0, false);
});

test("MarketStateService no longer emits anchor-follow breakout triggers", () => {
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
  assert.equal(ethSummary?.lastTrigger, null);
});

test("MarketStateService detects btc local reversal triggers for btc markets", () => {
  const marketStateService = new MarketStateService();

  marketStateService.ingestSnapshot(
    buildSelectiveSnapshot(1_000, {
      "btc:5m": 0.6,
    }),
  );
  marketStateService.ingestSnapshot(
    buildSelectiveSnapshot(2_000, {
      "btc:5m": 0.42,
    }),
  );
  marketStateService.ingestSnapshot(
    buildSelectiveSnapshot(3_000, {
      "btc:5m": 0.44,
    }),
  );
  marketStateService.ingestSnapshot(
    buildSelectiveSnapshot(4_000, {
      "btc:5m": 0.58,
    }),
  );

  const btcSlice = marketStateService.getLatestSlice("btc:5m");
  const detectLocalReversal = Reflect.get(marketStateService, "detectBtcLocalReversalTrigger") as
    | ((currentSlice: NonNullable<ReturnType<MarketStateService["getLatestSlice"]>>, tokenSide: "up" | "down", currentPrice: number | null) => string | null)
    | undefined;

  assert.notEqual(btcSlice, null);
  assert.notEqual(detectLocalReversal, undefined);
  if (btcSlice === null || detectLocalReversal === undefined) {
    throw new Error("expected btc local reversal helpers");
  }
  assert.equal(detectLocalReversal.call(marketStateService, btcSlice, "up", btcSlice.up.midpoint ?? btcSlice.up.price ?? null), "btc_local_reversal");
});

test("MarketStateService no longer emits laggard-release triggers for follower assets", () => {
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
  assert.equal(solSummary?.lastTrigger, null);
});

test("MarketStateService detects btc trend reversal triggers for followers", () => {
  const marketStateService = new MarketStateService();

  marketStateService.ingestSnapshot(
    buildSelectiveSnapshot(1_000, {
      "btc:5m": 0.44,
      "eth:5m": 0.51,
    }),
  );
  marketStateService.ingestSnapshot(
    buildSelectiveSnapshot(3_000, {
      "btc:5m": 0.52,
      "eth:5m": 0.53,
    }),
  );

  const ethSummary = marketStateService.getMarketSummaries(3_000).find((marketSummary) => marketSummary.marketKey === "eth:5m");

  assert.notEqual(ethSummary, undefined);
  assert.equal(ethSummary?.lastTrigger?.triggerType, "btc_trend_reversal");
});

test("MarketStateService skips triggers when the token price is already too expensive", () => {
  const marketStateService = new MarketStateService();

  marketStateService.ingestSnapshot(
    buildSelectiveSnapshot(1_000, {
      "btc:5m": 0.56,
      "eth:5m": 0.68,
    }),
  );
  marketStateService.ingestSnapshot(
    buildSelectiveSnapshot(3_000, {
      "btc:5m": 0.64,
      "eth:5m": 0.75,
    }),
  );

  const ethSummary = marketStateService.getMarketSummaries(3_000).find((marketSummary) => marketSummary.marketKey === "eth:5m");

  assert.notEqual(ethSummary, undefined);
  assert.equal(ethSummary?.lastTrigger, null);
});

test("MarketStateService computes a usable barrier state from chainlink and price-to-beat", () => {
  const marketStateService = new MarketStateService();

  marketStateService.ingestSnapshot(buildBarrierSnapshot(1_000, 60_060, 60_000, 40_000));

  const latestSlice = marketStateService.getLatestSlice("btc:5m");

  assert.notEqual(latestSlice, null);
  assert.equal(latestSlice?.barrierState.isBarrierDataUsable, true);
  assert.equal(latestSlice?.barrierState.dominantSide, "UP");
  assert.equal((latestSlice?.barrierState.chainlinkDistanceRatio ?? 0) > 0, true);
});

test("MarketStateService marks a market as effectively decided when little time remains and the barrier lead is large", () => {
  const marketStateService = new MarketStateService();

  marketStateService.ingestSnapshot(buildBarrierSnapshot(1_000, 60_900, 60_000, 8_000));

  const latestSlice = marketStateService.getLatestSlice("btc:5m");

  assert.notEqual(latestSlice, null);
  assert.equal(latestSlice?.barrierState.isEffectivelyDecided, true);
});

test("MarketStateService keeps near-barrier markets contestable even late in the window", () => {
  const marketStateService = new MarketStateService();

  marketStateService.ingestSnapshot(buildBarrierSnapshot(1_000, 60_090, 60_000, 8_000));

  const latestSlice = marketStateService.getLatestSlice("btc:5m");

  assert.notEqual(latestSlice, null);
  assert.equal(latestSlice?.barrierState.isNearBarrier, true);
  assert.equal(latestSlice?.barrierState.isEffectivelyDecided, false);
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

function buildAnchorBiasSnapshot(generatedAt: number): InputSnapshot {
  const snapshot: InputSnapshot = {
    generated_at: generatedAt,
  };

  appendCustomMarketSnapshot(snapshot, generatedAt, "btc", "5m", 0.498, 59_982, "btc-5m");
  appendCustomMarketSnapshot(snapshot, generatedAt, "btc", "15m", 0.498, 59_982, "btc-15m");
  appendCustomMarketSnapshot(snapshot, generatedAt, "eth", "5m", 0.4985, 2_999.1, "eth-5m");
  appendCustomMarketSnapshot(snapshot, generatedAt, "eth", "15m", 0.4985, 2_999.1, "eth-15m");
  appendCustomMarketSnapshot(snapshot, generatedAt, "sol", "5m", 0.4998, 149.97, "sol-5m");
  appendCustomMarketSnapshot(snapshot, generatedAt, "sol", "15m", 0.4998, 149.97, "sol-15m");
  appendCustomMarketSnapshot(snapshot, generatedAt, "xrp", "5m", 0.4998, 0.59988, "xrp-5m");
  appendCustomMarketSnapshot(snapshot, generatedAt, "xrp", "15m", 0.4998, 0.59988, "xrp-15m");

  if (generatedAt === 1_000) {
    appendCustomMarketSnapshot(snapshot, generatedAt, "btc", "5m", 0.5, 60_000, "btc-5m");
    appendCustomMarketSnapshot(snapshot, generatedAt, "btc", "15m", 0.5, 60_000, "btc-15m");
    appendCustomMarketSnapshot(snapshot, generatedAt, "eth", "5m", 0.5, 3_000, "eth-5m");
    appendCustomMarketSnapshot(snapshot, generatedAt, "eth", "15m", 0.5, 3_000, "eth-15m");
    appendCustomMarketSnapshot(snapshot, generatedAt, "sol", "5m", 0.5, 150, "sol-5m");
    appendCustomMarketSnapshot(snapshot, generatedAt, "sol", "15m", 0.5, 150, "sol-15m");
    appendCustomMarketSnapshot(snapshot, generatedAt, "xrp", "5m", 0.5, 0.6, "xrp-5m");
    appendCustomMarketSnapshot(snapshot, generatedAt, "xrp", "15m", 0.5, 0.6, "xrp-15m");
  }

  return snapshot;
}

function buildFollowerOnlySnapshot(generatedAt: number): InputSnapshot {
  const snapshot: InputSnapshot = {
    generated_at: generatedAt,
  };

  const hasBaselineSnapshot = generatedAt === 1_000;
  appendCustomMarketSnapshot(snapshot, generatedAt, "btc", "5m", hasBaselineSnapshot ? 0.5 : 0.5, 60_000, "btc-5m");
  appendCustomMarketSnapshot(snapshot, generatedAt, "btc", "15m", hasBaselineSnapshot ? 0.5 : 0.5, 60_000, "btc-15m");
  appendCustomMarketSnapshot(snapshot, generatedAt, "eth", "5m", hasBaselineSnapshot ? 0.5 : 0.5, 3_000, "eth-5m");
  appendCustomMarketSnapshot(snapshot, generatedAt, "eth", "15m", hasBaselineSnapshot ? 0.5 : 0.5, 3_000, "eth-15m");
  appendCustomMarketSnapshot(snapshot, generatedAt, "sol", "5m", hasBaselineSnapshot ? 0.5 : 0.58, hasBaselineSnapshot ? 150 : 174, "sol-5m");
  appendCustomMarketSnapshot(snapshot, generatedAt, "sol", "15m", hasBaselineSnapshot ? 0.5 : 0.58, hasBaselineSnapshot ? 150 : 174, "sol-15m");
  appendCustomMarketSnapshot(snapshot, generatedAt, "xrp", "5m", hasBaselineSnapshot ? 0.5 : 0.56, hasBaselineSnapshot ? 0.6 : 0.672, "xrp-5m");
  appendCustomMarketSnapshot(snapshot, generatedAt, "xrp", "15m", hasBaselineSnapshot ? 0.5 : 0.56, hasBaselineSnapshot ? 0.6 : 0.672, "xrp-15m");

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
  snapshot[`${prefix}_market_start`] = new Date(Math.max(0, generatedAt - 60_000)).toISOString();
  snapshot[`${prefix}_market_end`] = new Date(generatedAt + (window === "5m" ? 300_000 : 900_000)).toISOString();
  snapshot[`${prefix}_price_to_beat`] = baseSpotPrice;
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
  snapshot[`${prefix}_market_start`] = new Date(Math.max(0, generatedAt - 60_000)).toISOString();
  snapshot[`${prefix}_market_end`] = new Date(generatedAt + (window === "5m" ? 300_000 : 900_000)).toISOString();
  snapshot[`${prefix}_price_to_beat`] = baseSpotPrice;
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

function appendCustomMarketSnapshot(
  snapshot: Record<string, number | string | null>,
  generatedAt: number,
  asset: AssetSymbol,
  window: MarketWindow,
  upMidpoint: number,
  spotConsensusPrice: number,
  slug: string,
): void {
  const prefix = `${asset}_${window}`;
  const downMidpoint = Math.max(0.01, Math.min(0.99, 1 - upMidpoint));

  snapshot[`${prefix}_slug`] = slug;
  snapshot[`${prefix}_market_start`] = new Date(Math.max(0, generatedAt - 60_000)).toISOString();
  snapshot[`${prefix}_market_end`] = new Date(generatedAt + (window === "5m" ? 300_000 : 900_000)).toISOString();
  snapshot[`${prefix}_price_to_beat`] = spotConsensusPrice;
  snapshot[`${prefix}_up_price`] = upMidpoint;
  snapshot[`${prefix}_down_price`] = downMidpoint;
  snapshot[`${prefix}_up_event_ts`] = generatedAt;
  snapshot[`${prefix}_down_event_ts`] = generatedAt;

  snapshot[`${asset}_binance_price`] = spotConsensusPrice;
  snapshot[`${asset}_binance_event_ts`] = generatedAt;
  snapshot[`${asset}_coinbase_price`] = spotConsensusPrice * 1.0004;
  snapshot[`${asset}_coinbase_event_ts`] = generatedAt;
  snapshot[`${asset}_kraken_price`] = spotConsensusPrice * 0.9996;
  snapshot[`${asset}_kraken_event_ts`] = generatedAt;
  snapshot[`${asset}_okx_price`] = spotConsensusPrice * 1.0002;
  snapshot[`${asset}_okx_event_ts`] = generatedAt;
  snapshot[`${asset}_chainlink_price`] = spotConsensusPrice;
  snapshot[`${asset}_chainlink_event_ts`] = generatedAt;
}

function buildBarrierSnapshot(generatedAt: number, chainlinkPrice: number, priceToBeat: number, timeRemainingMs: number): InputSnapshot {
  const snapshot = buildSelectiveSnapshot(generatedAt, {
    "btc:5m": chainlinkPrice >= priceToBeat ? 0.58 : 0.42,
  });
  snapshot.btc_5m_market_start = new Date(Math.max(0, generatedAt - 120_000)).toISOString();
  snapshot.btc_5m_market_end = new Date(generatedAt + timeRemainingMs).toISOString();
  snapshot.btc_5m_price_to_beat = priceToBeat;
  snapshot.btc_chainlink_price = chainlinkPrice;
  snapshot.btc_binance_price = chainlinkPrice;
  snapshot.btc_coinbase_price = chainlinkPrice;
  snapshot.btc_kraken_price = chainlinkPrice;
  snapshot.btc_okx_price = chainlinkPrice;
  return snapshot;
}
