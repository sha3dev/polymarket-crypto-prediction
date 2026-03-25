import * as assert from "node:assert/strict";
import { test } from "node:test";

import { MarketStateService } from "../src/market/market-state.service.ts";

test("MarketStateService exposes soft cross-asset regime metrics before strong breadth exists", () => {
  const marketStateService = new MarketStateService();

  marketStateService.ingestSnapshot(buildSnapshot(1_000, 1));
  marketStateService.ingestSnapshot(buildSnapshot(20_000, 1.004));

  const crossAssetRegime = marketStateService.getCrossAssetRegime("btc:5m");

  assert.notEqual(crossAssetRegime, null);
  assert.equal(crossAssetRegime?.regimeId, "neutral");
  assert.equal((crossAssetRegime?.breadthParticipation ?? 0) > 0, true);
  assert.equal((crossAssetRegime?.breadthStrength ?? 0) > 0, true);
  assert.equal((crossAssetRegime?.accelerationScore ?? 0) > 0, true);
  assert.equal(Math.abs((crossAssetRegime?.reversalRiskScore ?? 1) - 0.19) > 0.01, true);
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
