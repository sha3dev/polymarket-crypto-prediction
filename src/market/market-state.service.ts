/**
 * @section imports:internals
 */

import config from "../config.ts";
import logger from "../logger.ts";
import type {
  AssetSymbol,
  CrossAssetRegime,
  InputSnapshot,
  MarketEvaluationPrice,
  MarketHistoryEntry,
  MarketKey,
  MarketQuality,
  MarketSnapshotSlice,
  MarketSummary,
  MarketTrigger,
  MarketUpdateResult,
  MarketWindow,
  ParsedOrderBook,
  PredictionContext,
  SpotVenueMetrics,
  TokenMetrics,
  TriggerType,
  TriggeredToken,
} from "./market.types.ts";
import { SPOT_VENUES, SUPPORTED_ASSETS, SUPPORTED_WINDOWS } from "./market.types.ts";

/**
 * @section types
 */

type MarketRecord = {
  latest: MarketSnapshotSlice | null;
  previous: MarketSnapshotSlice | null;
  history: MarketHistoryEntry[];
  lastTrigger: MarketTrigger | null;
  lastPredictionTimestamp: number | null;
};

/**
 * @section class
 */

export class MarketStateService {
  /**
   * @section private:attributes
   */

  private readonly marketRecords: Map<MarketKey, MarketRecord>;
  private latestSnapshotAt: number | null;

  /**
   * @section constructor
   */

  public constructor() {
    this.marketRecords = this.createInitialRecords();
    this.latestSnapshotAt = null;
  }

  /**
   * @section private:methods
   */

  private createInitialRecords(): Map<MarketKey, MarketRecord> {
    const initialRecords = new Map<MarketKey, MarketRecord>();
    for (const asset of SUPPORTED_ASSETS) {
      for (const window of SUPPORTED_WINDOWS) {
        const marketKey = this.buildMarketKey(asset, window);
        initialRecords.set(marketKey, {
          latest: null,
          previous: null,
          history: [],
          lastTrigger: null,
          lastPredictionTimestamp: null,
        });
      }
    }
    return initialRecords;
  }

  private buildMarketKey(asset: AssetSymbol, window: MarketWindow): MarketKey {
    const marketKey: MarketKey = `${asset}:${window}`;
    return marketKey;
  }

  private extractAssetFromMarketKey(marketKey: MarketKey): AssetSymbol {
    const [asset] = marketKey.split(":");
    return asset as AssetSymbol;
  }

  private resolveCrossAssetWeight(marketKey: MarketKey): number {
    const asset = this.extractAssetFromMarketKey(marketKey);
    let crossAssetWeight = 1;
    if (asset === "btc") {
      crossAssetWeight = 2.4;
    }
    if (asset === "eth") {
      crossAssetWeight = 1.6;
    }
    return crossAssetWeight;
  }

  private requireMarketRecord(marketKey: MarketKey): MarketRecord {
    const marketRecord = this.marketRecords.get(marketKey);
    if (!marketRecord) {
      throw new Error(`Missing market record for ${marketKey}`);
    }
    return marketRecord;
  }

  private buildSlice(snapshot: InputSnapshot, asset: AssetSymbol, window: MarketWindow): MarketSnapshotSlice {
    const prefix = `${asset}_${window}`;
    const generatedAt = snapshot.generated_at;
    const slug = this.readString(snapshot, `${prefix}_slug`);
    const spotVenues = this.buildSpotVenues(snapshot, asset, generatedAt);
    const spotConsensusPrice = this.computeSpotConsensusPrice(spotVenues);
    const chainlinkPrice = this.readNumber(snapshot, `${asset}_chainlink_price`);
    const chainlinkEventTs = this.readNumber(snapshot, `${asset}_chainlink_event_ts`);
    const chainlinkAgeMs = chainlinkEventTs === null ? null : Math.max(0, generatedAt - chainlinkEventTs);
    const up = this.buildTokenMetrics(snapshot, generatedAt, prefix, "up");
    const down = this.buildTokenMetrics(snapshot, generatedAt, prefix, "down");
    const quality = this.buildQuality(slug, up, down, spotVenues, chainlinkAgeMs);
    const previousSpotConsensus = this.requireMarketRecord(this.buildMarketKey(asset, window)).latest?.spotConsensusPrice ?? null;
    const spotMomentum = this.computeSignedChange(previousSpotConsensus, spotConsensusPrice);
    const spotDispersion = this.computeSpotDispersion(spotVenues, spotConsensusPrice);
    return {
      asset,
      window,
      marketKey: this.buildMarketKey(asset, window),
      generatedAt,
      slug,
      marketStart: this.readString(snapshot, `${prefix}_market_start`),
      marketEnd: this.readString(snapshot, `${prefix}_market_end`),
      priceToBeat: this.readNumber(snapshot, `${prefix}_price_to_beat`),
      up,
      down,
      spotVenues,
      spotConsensusPrice,
      spotMomentum,
      spotDispersion,
      chainlinkPrice,
      chainlinkAgeMs,
      quality,
    };
  }

  private buildTokenMetrics(snapshot: InputSnapshot, generatedAt: number, prefix: string, tokenSide: TriggeredToken): TokenMetrics {
    const price = this.readNumber(snapshot, `${prefix}_${tokenSide}_price`);
    const orderBook = this.parseOrderBook(this.readString(snapshot, `${prefix}_${tokenSide}_order_book_json`));
    const bestBid = orderBook?.bids[0]?.price ?? null;
    const bestAsk = orderBook?.asks[0]?.price ?? null;
    const midpoint = this.computeMidpoint(bestBid, bestAsk);
    const spread = bestBid === null || bestAsk === null ? null : bestAsk - bestBid;
    const depthTop = this.computeDepthTop(orderBook);
    const imbalance = this.computeImbalance(orderBook);
    const eventTs = this.readNumber(snapshot, `${prefix}_${tokenSide}_event_ts`);
    const ageMs = eventTs === null ? null : Math.max(0, generatedAt - eventTs);
    return {
      price,
      midpoint,
      spread,
      bestBid,
      bestAsk,
      depthTop,
      imbalance,
      distanceToHalf: midpoint === null ? null : Math.abs(midpoint - 0.5),
      eventTs,
      ageMs,
    };
  }

  private buildSpotVenues(snapshot: InputSnapshot, asset: AssetSymbol, generatedAt: number): SpotVenueMetrics[] {
    const spotVenues: SpotVenueMetrics[] = [];
    for (const venue of SPOT_VENUES) {
      const price = this.readNumber(snapshot, `${asset}_${venue}_price`);
      const eventTs = this.readNumber(snapshot, `${asset}_${venue}_event_ts`);
      const ageMs = eventTs === null ? null : Math.max(0, generatedAt - eventTs);
      const orderBook = this.parseOrderBook(this.readString(snapshot, `${asset}_${venue}_order_book_json`));
      const bestBid = orderBook?.bids[0]?.price ?? null;
      const bestAsk = orderBook?.asks[0]?.price ?? null;
      const midpoint = this.computeMidpoint(bestBid, bestAsk);
      const spread = bestBid === null || bestAsk === null ? null : bestAsk - bestBid;
      spotVenues.push({
        venue,
        price,
        eventTs,
        ageMs,
        midpoint,
        spread,
        imbalance: this.computeImbalance(orderBook),
      });
    }
    return spotVenues;
  }

  private buildQuality(
    slug: string | null,
    up: TokenMetrics,
    down: TokenMetrics,
    spotVenues: SpotVenueMetrics[],
    chainlinkAgeMs: number | null,
  ): MarketQuality {
    const qualityIssues: string[] = [];
    const hasFreshTokens = this.hasFreshToken(up.ageMs) && this.hasFreshToken(down.ageMs);
    const hasFreshSpot = spotVenues.some((spotVenue) => this.hasFreshSpot(spotVenue.ageMs));
    const freshSpotVenues = spotVenues.filter((spotVenue) => this.hasFreshSpot(spotVenue.ageMs));
    const freshSpotCoverage = spotVenues.length === 0 ? 0 : freshSpotVenues.length / spotVenues.length;
    const worstTokenAge = Math.max(up.ageMs ?? config.TOKEN_MAX_AGE_MS * 3, down.ageMs ?? config.TOKEN_MAX_AGE_MS * 3);
    const tokenAgePenalty = Math.min(0.28, (worstTokenAge / config.TOKEN_MAX_AGE_MS) * 0.14);
    const averageFreshSpotAge =
      freshSpotVenues.length === 0
        ? config.SPOT_MAX_AGE_MS * 3
        : freshSpotVenues.reduce((aggregatedAge, spotVenue) => aggregatedAge + (spotVenue.ageMs ?? config.SPOT_MAX_AGE_MS * 3), 0) / freshSpotVenues.length;
    const spotAgePenalty = Math.min(0.14, (averageFreshSpotAge / config.SPOT_MAX_AGE_MS) * 0.08);
    const spotCoveragePenalty = (1 - freshSpotCoverage) * 0.18;
    const upSpreadPenalty = this.computeTokenSpreadPenalty(up.spread);
    const downSpreadPenalty = this.computeTokenSpreadPenalty(down.spread);
    const midpointPenalty = this.computeMidpointPenalty(up.midpoint, down.midpoint);
    const chainlinkPenalty = this.computeChainlinkPenalty(chainlinkAgeMs);
    const dispersionPenalty = this.computeSpotDispersionPenalty(spotVenues);
    let score = slug ? 0.96 : 0;
    if (!slug) {
      qualityIssues.push("market_inactive");
    }
    if (!hasFreshTokens) {
      qualityIssues.push("token_stale");
    }
    if (!hasFreshSpot) {
      qualityIssues.push("spot_stale");
    }
    if (freshSpotCoverage < 0.75) {
      qualityIssues.push("spot_sparse");
    }
    if (Math.max(upSpreadPenalty, downSpreadPenalty) >= 0.08) {
      qualityIssues.push("wide_spread");
    }
    if (dispersionPenalty >= 0.06) {
      qualityIssues.push("spot_dispersion");
    }
    if (chainlinkPenalty > 0.04) {
      qualityIssues.push("chainlink_stale");
    }
    if (up.midpoint === null || down.midpoint === null) {
      qualityIssues.push("midpoint_fallback");
    }
    score -=
      tokenAgePenalty + spotAgePenalty + spotCoveragePenalty + upSpreadPenalty + downSpreadPenalty + midpointPenalty + chainlinkPenalty + dispersionPenalty;
    return {
      score: Math.max(0, Math.min(1, score)),
      hasLiveMarket: Boolean(slug),
      hasFreshTokens,
      hasFreshSpot,
      issues: qualityIssues,
    };
  }

  private computeTokenSpreadPenalty(spread: number | null): number {
    let spreadPenalty = 0.16;
    if (spread !== null) {
      spreadPenalty = Math.min(0.16, (spread / 0.08) * 0.16);
    }
    return spreadPenalty;
  }

  private computeMidpointPenalty(upMidpoint: number | null, downMidpoint: number | null): number {
    let midpointPenalty = 0;
    if (upMidpoint === null) {
      midpointPenalty += 0.08;
    }
    if (downMidpoint === null) {
      midpointPenalty += 0.08;
    }
    return midpointPenalty;
  }

  private computeChainlinkPenalty(chainlinkAgeMs: number | null): number {
    let chainlinkPenalty = 0.05;
    if (chainlinkAgeMs !== null) {
      chainlinkPenalty = Math.min(0.12, (chainlinkAgeMs / config.CHAINLINK_MAX_AGE_MS) * 0.06);
    }
    return chainlinkPenalty;
  }

  private computeSpotDispersionPenalty(spotVenues: SpotVenueMetrics[]): number {
    const pricedSpotVenues = spotVenues.filter((spotVenue) => spotVenue.price !== null).map((spotVenue) => spotVenue.price as number);
    let dispersionPenalty = 0;
    if (pricedSpotVenues.length >= 2) {
      const minimumSpotPrice = Math.min(...pricedSpotVenues);
      const maximumSpotPrice = Math.max(...pricedSpotVenues);
      const averageSpotPrice = pricedSpotVenues.reduce((aggregatedPrice, spotPrice) => aggregatedPrice + spotPrice, 0) / pricedSpotVenues.length;
      const normalizedDispersion = averageSpotPrice === 0 ? 0 : (maximumSpotPrice - minimumSpotPrice) / averageSpotPrice;
      dispersionPenalty = Math.min(0.12, normalizedDispersion * 12);
    }
    return dispersionPenalty;
  }

  private appendHistory(marketRecord: MarketRecord, latestSlice: MarketSnapshotSlice): void {
    marketRecord.history.push({
      generatedAt: latestSlice.generatedAt,
      upMidpoint: latestSlice.up.midpoint,
      downMidpoint: latestSlice.down.midpoint,
      upPrice: latestSlice.up.price,
      downPrice: latestSlice.down.price,
      spotConsensusPrice: latestSlice.spotConsensusPrice,
      priceToBeat: latestSlice.priceToBeat,
      qualityScore: latestSlice.quality.score,
    });
    const maxEntries = Math.max(1, Math.ceil((config.LONG_HISTORY_SECONDS * 1000) / config.SNAPSHOT_INTERVAL_MS));
    if (marketRecord.history.length > maxEntries) {
      marketRecord.history.splice(0, marketRecord.history.length - maxEntries);
    }
  }

  private collectTokenTrigger(
    triggeredMarkets: MarketTrigger[],
    marketRecord: MarketRecord,
    currentSlice: MarketSnapshotSlice,
    tokenSide: TriggeredToken,
  ): void {
    const previousPrice = marketRecord.previous ? this.resolveTriggerPrice(marketRecord.previous, tokenSide) : null;
    const currentPrice = this.resolveTriggerPrice(currentSlice, tokenSide);
    const crossAssetRegime = this.buildCrossAssetRegime(currentSlice.marketKey, currentSlice.window);
    const triggerType = this.detectTriggerType(marketRecord, currentSlice, tokenSide, previousPrice, currentPrice, crossAssetRegime);
    if (triggerType && currentPrice !== null) {
      const trigger: MarketTrigger = {
        marketKey: currentSlice.marketKey,
        asset: currentSlice.asset,
        window: currentSlice.window,
        triggeredToken: tokenSide,
        triggerType,
        previousPrice,
        currentPrice,
        distanceToHalf: Math.abs(currentPrice - 0.5),
        triggeredAt: currentSlice.generatedAt,
      };
      const marketRecord = this.requireMarketRecord(currentSlice.marketKey);
      marketRecord.lastTrigger = trigger;
      triggeredMarkets.push(trigger);
    }
  }

  private resolveTriggerPrice(slice: MarketSnapshotSlice, tokenSide: TriggeredToken): number | null {
    const tokenMetrics = tokenSide === "up" ? slice.up : slice.down;
    const resolvedPrice = tokenMetrics.midpoint ?? tokenMetrics.price;
    return resolvedPrice;
  }

  private buildSyntheticTrigger(
    marketKey: MarketKey,
    latestSlice: MarketSnapshotSlice,
    previousSlice: MarketSnapshotSlice | null,
    triggerType: TriggerType,
  ): MarketTrigger {
    const upPrice = this.resolveTriggerPrice(latestSlice, "up") ?? 0.5;
    const downPrice = this.resolveTriggerPrice(latestSlice, "down") ?? 0.5;
    const triggeredToken: TriggeredToken = upPrice >= downPrice ? "up" : "down";
    const currentPrice = this.resolveTriggerPrice(latestSlice, triggeredToken);
    const previousPrice = previousSlice === null ? null : this.resolveTriggerPrice(previousSlice, triggeredToken);
    const distanceToHalf = currentPrice === null ? null : Math.abs(currentPrice - 0.5);
    const syntheticTrigger: MarketTrigger = {
      marketKey,
      asset: latestSlice.asset,
      window: latestSlice.window,
      triggeredToken,
      triggerType,
      previousPrice,
      currentPrice,
      distanceToHalf,
      triggeredAt: latestSlice.generatedAt,
    };
    return syntheticTrigger;
  }

  private computeSignedTokenChange(previousPrice: number | null, currentPrice: number | null, _tokenSide: TriggeredToken): number {
    // Token prices always rise when the triggered side is winning, regardless of up/down
    const signedTokenChange = this.computeSignedChange(previousPrice, currentPrice);
    return signedTokenChange;
  }

  private isPriceOnTriggeredSide(currentPrice: number | null, _tokenSide: TriggeredToken): boolean {
    // Both up and down tokens trade above 0.50 when their side is winning
    const isPriceOnTriggeredSide = currentPrice !== null && currentPrice > 0.5 + config.MIN_TRIGGER_DISTANCE_FROM_HALF;
    return isPriceOnTriggeredSide;
  }

  private resolveTriggerPriceCeiling(): number {
    // Fixed ceiling independent of TP delta — tokens above 0.72 are genuinely too expensive
    const triggerPriceCeiling = 0.72;
    return triggerPriceCeiling;
  }

  private isTriggerPriceAffordable(currentPrice: number | null): boolean {
    const triggerPriceCeiling = this.resolveTriggerPriceCeiling();
    const isTriggerPriceAffordable = currentPrice !== null && currentPrice <= triggerPriceCeiling;
    return isTriggerPriceAffordable;
  }

  private hasAnchorSupportForTrigger(currentSlice: MarketSnapshotSlice, tokenSide: TriggeredToken, crossAssetRegime: CrossAssetRegime): boolean {
    const anchorThreshold = config.CROSS_ASSET_BREADTH_MOVE_THRESHOLD * 0.35;
    const requiredBtcMomentum = tokenSide === "up" ? crossAssetRegime.btcUpTokenMomentum : crossAssetRegime.btcDownTokenMomentum;
    const requiredEthMomentum = tokenSide === "up" ? crossAssetRegime.ethUpTokenMomentum : crossAssetRegime.ethDownTokenMomentum;
    let hasAnchorSupportForTrigger = true;
    if (currentSlice.asset === "eth") {
      hasAnchorSupportForTrigger = requiredBtcMomentum >= anchorThreshold;
    }
    if (currentSlice.asset === "sol" || currentSlice.asset === "xrp") {
      hasAnchorSupportForTrigger = requiredBtcMomentum >= anchorThreshold && requiredEthMomentum >= anchorThreshold;
    }
    return hasAnchorSupportForTrigger;
  }

  private readRecentTokenHistoryPrices(marketRecord: MarketRecord, tokenSide: TriggeredToken, limit: number): number[] {
    const recentHistoryEntries = marketRecord.history.slice(
      Math.max(0, marketRecord.history.length - (limit + 1)),
      Math.max(0, marketRecord.history.length - 1),
    );
    const recentTokenHistoryPrices = recentHistoryEntries
      .map((historyEntry) => this.resolveHistoryTriggerPrice(historyEntry, tokenSide))
      .filter((historyPrice): historyPrice is number => historyPrice !== null);
    return recentTokenHistoryPrices;
  }

  private detectCrossedHalfTrigger(
    marketRecord: MarketRecord,
    _currentSlice: MarketSnapshotSlice,
    previousPrice: number | null,
    currentPrice: number | null,
    tokenSide: TriggeredToken,
  ): TriggerType | null {
    let triggerType: TriggerType | null = null;
    const hasDominanceCross =
      previousPrice !== null &&
      currentPrice !== null &&
      previousPrice < 0.5 &&
      currentPrice >= 0.5 &&
      this.isPriceOnTriggeredSide(currentPrice, tokenSide) &&
      this.isTriggerPriceAffordable(currentPrice);
    const signedTokenChange = this.computeSignedTokenChange(previousPrice, currentPrice, tokenSide);
    const recentTokenHistoryPrices = this.readRecentTokenHistoryPrices(marketRecord, tokenSide, 4);
    const persistenceCount = recentTokenHistoryPrices.filter((historyPrice) => this.isPriceOnTriggeredSide(historyPrice, tokenSide)).length;
    const hasPersistentHold = persistenceCount >= 2;
    const hasMeaningfulMove = signedTokenChange >= config.MIN_TRIGGER_SPOT_MOMENTUM * 1.5;
    const triggerPriceCeiling = this.resolveTriggerPriceCeiling();
    const hasRoomToTarget = currentPrice !== null && currentPrice <= triggerPriceCeiling;
    if (hasDominanceCross && hasPersistentHold && hasMeaningfulMove && hasRoomToTarget) {
      triggerType = "crossed_half";
    }
    return triggerType;
  }

  private detectBtcTrendReversalTrigger(
    currentSlice: MarketSnapshotSlice,
    tokenSide: TriggeredToken,
    currentPrice: number | null,
    crossAssetRegime: CrossAssetRegime,
  ): TriggerType | null {
    const btcMarketRecord = this.requireMarketRecord(this.buildMarketKey("btc", currentSlice.window));
    const btcLatestSlice = btcMarketRecord.latest;
    const btcPreviousSlice = btcMarketRecord.previous;
    const btcCurrentTriggeredPrice = btcLatestSlice === null ? null : this.resolveTriggerPrice(btcLatestSlice, tokenSide);
    const btcPreviousTriggeredPrice = btcPreviousSlice === null ? null : this.resolveTriggerPrice(btcPreviousSlice, tokenSide);
    const btcCurrentOppositePrice = btcLatestSlice === null ? null : this.resolveTriggerPrice(btcLatestSlice, tokenSide === "up" ? "down" : "up");
    const btcPreviousOppositePrice = btcPreviousSlice === null ? null : this.resolveTriggerPrice(btcPreviousSlice, tokenSide === "up" ? "down" : "up");
    const signedBtcTriggeredChange = this.computeSignedTokenChange(btcPreviousTriggeredPrice, btcCurrentTriggeredPrice, tokenSide);
    const hasOppositeDominanceRecently = btcPreviousOppositePrice !== null && btcPreviousOppositePrice >= 0.5 + config.MIN_TRIGGER_DISTANCE_FROM_HALF * 0.5;
    const hasOppositeSideFading = btcPreviousOppositePrice !== null && btcCurrentOppositePrice !== null && btcCurrentOppositePrice < btcPreviousOppositePrice;
    const hasTriggeredSideRecovery =
      btcCurrentTriggeredPrice !== null &&
      btcPreviousTriggeredPrice !== null &&
      btcCurrentTriggeredPrice > btcPreviousTriggeredPrice &&
      signedBtcTriggeredChange >= config.MIN_TRIGGER_SPOT_MOMENTUM;
    const hasTargetAnchorSupport = this.hasAnchorSupportForTrigger(currentSlice, tokenSide, crossAssetRegime);
    const isFollowerMarket = currentSlice.asset !== "btc";
    let triggerType: TriggerType | null = null;
    if (
      isFollowerMarket &&
      hasTargetAnchorSupport &&
      hasOppositeDominanceRecently &&
      hasOppositeSideFading &&
      hasTriggeredSideRecovery &&
      this.isPriceOnTriggeredSide(currentPrice, tokenSide)
    ) {
      triggerType = "btc_trend_reversal";
    }
    return triggerType;
  }

  private detectTriggerType(
    marketRecord: MarketRecord,
    currentSlice: MarketSnapshotSlice,
    tokenSide: TriggeredToken,
    previousPrice: number | null,
    currentPrice: number | null,
    crossAssetRegime: CrossAssetRegime,
  ): TriggerType | null {
    const crossedHalfTrigger = this.detectCrossedHalfTrigger(marketRecord, currentSlice, previousPrice, currentPrice, tokenSide);
    const btcTrendReversalTrigger = this.detectBtcTrendReversalTrigger(currentSlice, tokenSide, currentPrice, crossAssetRegime);
    let triggerType: TriggerType | null = null;
    const isTriggerAffordable = this.isTriggerPriceAffordable(currentPrice);
    if (crossedHalfTrigger !== null && isTriggerAffordable) {
      triggerType = crossedHalfTrigger;
    }
    if (triggerType === null && btcTrendReversalTrigger !== null && isTriggerAffordable) {
      triggerType = btcTrendReversalTrigger;
    }
    return triggerType;
  }

  private buildMarketSummary(marketKey: MarketKey, marketRecord: MarketRecord, nowTimestamp: number): MarketSummary {
    const latestSlice = marketRecord.latest;
    const lastPredictionTimestamp = marketRecord.lastPredictionTimestamp;
    const cooldownRemainingMs = lastPredictionTimestamp === null ? 0 : Math.max(0, config.MARKET_COOLDOWN_MS - (nowTimestamp - lastPredictionTimestamp));
    return {
      asset: latestSlice?.asset ?? this.readKeyAsset(marketKey),
      window: latestSlice?.window ?? this.readKeyWindow(marketKey),
      marketKey,
      isLive: Boolean(latestSlice?.slug),
      latestUpPrice: latestSlice?.up.price ?? null,
      latestDownPrice: latestSlice?.down.price ?? null,
      latestUpMidpoint: latestSlice?.up.midpoint ?? null,
      latestDownMidpoint: latestSlice?.down.midpoint ?? null,
      upDistanceToHalf: latestSlice?.up.distanceToHalf ?? null,
      downDistanceToHalf: latestSlice?.down.distanceToHalf ?? null,
      lastTrigger: marketRecord.lastTrigger,
      lastPredictionTimestamp,
      cooldownRemainingMs,
      snapshotAgeMs: latestSlice === null ? null : Math.max(0, nowTimestamp - latestSlice.generatedAt),
      quality: latestSlice?.quality ?? {
        score: 0,
        hasLiveMarket: false,
        hasFreshTokens: false,
        hasFreshSpot: false,
        issues: ["market_unseen"],
      },
    };
  }

  private readKeyAsset(marketKey: MarketKey): AssetSymbol {
    const [asset] = marketKey.split(":");
    return asset as AssetSymbol;
  }

  private readKeyWindow(marketKey: MarketKey): MarketWindow {
    const [, window] = marketKey.split(":");
    return window as MarketWindow;
  }

  private parseOrderBook(serializedOrderBook: string | null): ParsedOrderBook | null {
    let parsedOrderBook: ParsedOrderBook | null = null;
    if (serializedOrderBook) {
      try {
        const rawOrderBook = JSON.parse(serializedOrderBook) as {
          bids?: Array<Record<string, unknown>>;
          asks?: Array<Record<string, unknown>>;
        };
        const bids = this.normalizeLevels(rawOrderBook.bids, "desc");
        const asks = this.normalizeLevels(rawOrderBook.asks, "asc");
        if (bids.length > 0 || asks.length > 0) {
          parsedOrderBook = { bids, asks };
        }
      } catch (error) {
        logger.warn(`failed to parse order book: ${error instanceof Error ? error.message : "unknown error"}`);
        parsedOrderBook = null;
      }
    }
    return parsedOrderBook;
  }

  private normalizeLevels(rawLevels: Array<Record<string, unknown>> | undefined, direction: "asc" | "desc"): Array<{ price: number; size: number }> {
    const normalizedLevels: Array<{ price: number; size: number }> = [];
    for (const rawLevel of rawLevels ?? []) {
      const price = this.normalizeLevelNumber(rawLevel.price ?? rawLevel.px);
      const size = this.normalizeLevelNumber(rawLevel.size ?? rawLevel.qty ?? rawLevel.quantity);
      if (price !== null && size !== null && size > 0) {
        normalizedLevels.push({ price, size });
      }
    }
    normalizedLevels.sort((leftLevel, rightLevel) => {
      const comparator = leftLevel.price - rightLevel.price;
      return direction === "asc" ? comparator : comparator * -1;
    });
    return normalizedLevels;
  }

  private normalizeLevelNumber(rawValue: unknown): number | null {
    let normalizedNumber: number | null = null;
    if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
      normalizedNumber = rawValue;
    }
    if (typeof rawValue === "string") {
      const parsedNumber = Number(rawValue);
      if (Number.isFinite(parsedNumber)) {
        normalizedNumber = parsedNumber;
      }
    }
    return normalizedNumber;
  }

  private computeMidpoint(bestBid: number | null, bestAsk: number | null): number | null {
    let midpoint: number | null = null;
    if (bestBid !== null && bestAsk !== null) {
      midpoint = (bestBid + bestAsk) / 2;
    }
    return midpoint;
  }

  private computeDepthTop(orderBook: ParsedOrderBook | null): number {
    let depthTop = 0;
    if (orderBook) {
      for (const level of orderBook.bids.slice(0, 5)) {
        depthTop += level.size;
      }
      for (const level of orderBook.asks.slice(0, 5)) {
        depthTop += level.size;
      }
    }
    return depthTop;
  }

  private computeImbalance(orderBook: ParsedOrderBook | null): number {
    let imbalance = 0;
    if (orderBook) {
      const bidDepth = orderBook.bids.slice(0, 5).reduce((totalDepth, level) => totalDepth + level.size, 0);
      const askDepth = orderBook.asks.slice(0, 5).reduce((totalDepth, level) => totalDepth + level.size, 0);
      const totalDepth = bidDepth + askDepth;
      imbalance = totalDepth === 0 ? 0 : (bidDepth - askDepth) / totalDepth;
    }
    return imbalance;
  }

  private computeSpotConsensusPrice(spotVenues: SpotVenueMetrics[]): number | null {
    const freshPrices = spotVenues
      .filter((spotVenue) => spotVenue.price !== null && this.hasFreshSpot(spotVenue.ageMs))
      .map((spotVenue) => spotVenue.price as number);
    let consensusPrice: number | null = null;
    if (freshPrices.length > 0) {
      const totalPrice = freshPrices.reduce((sumPrice, price) => sumPrice + price, 0);
      consensusPrice = totalPrice / freshPrices.length;
    }
    return consensusPrice;
  }

  private computeSpotDispersion(spotVenues: SpotVenueMetrics[], consensusPrice: number | null): number {
    let dispersion = 0;
    if (consensusPrice !== null) {
      const distances = spotVenues.filter((spotVenue) => spotVenue.price !== null).map((spotVenue) => Math.abs((spotVenue.price as number) - consensusPrice));
      if (distances.length > 0) {
        const totalDistance = distances.reduce((sumDistance, distance) => sumDistance + distance, 0);
        dispersion = totalDistance / distances.length;
      }
    }
    return dispersion;
  }

  private computeSignedChange(previousValue: number | null, nextValue: number | null): number {
    let signedChange = 0;
    if (previousValue !== null && nextValue !== null && previousValue !== 0) {
      signedChange = (nextValue - previousValue) / previousValue;
    }
    return signedChange;
  }

  private resolveReferencePrice(marketSlice: MarketSnapshotSlice | null): number | null {
    const referencePrice = marketSlice?.spotConsensusPrice ?? marketSlice?.up.midpoint ?? marketSlice?.up.price ?? null;
    return referencePrice;
  }

  private resolveHistoryReferencePrice(historyEntry: MarketHistoryEntry | null): number | null {
    const referencePrice = historyEntry?.spotConsensusPrice ?? historyEntry?.upMidpoint ?? historyEntry?.upPrice ?? null;
    return referencePrice;
  }

  private resolveHistoryTriggerPrice(historyEntry: MarketHistoryEntry | null, tokenSide: TriggeredToken): number | null {
    let triggerPrice: number | null = null;
    if (tokenSide === "up") {
      triggerPrice = historyEntry?.upMidpoint ?? historyEntry?.upPrice ?? null;
    }
    if (tokenSide === "down") {
      triggerPrice = historyEntry?.downMidpoint ?? historyEntry?.downPrice ?? null;
    }
    return triggerPrice;
  }

  private findLookbackHistoryEntry(marketRecord: MarketRecord, latestGeneratedAt: number): MarketHistoryEntry | null {
    const targetGeneratedAt = latestGeneratedAt - config.CROSS_ASSET_LOOKBACK_MS;
    let lookbackHistoryEntry: MarketHistoryEntry | null = null;
    for (let historyIndex = marketRecord.history.length - 1; historyIndex >= 0; historyIndex -= 1) {
      const historyEntry = marketRecord.history[historyIndex] ?? null;
      if (historyEntry !== null && historyEntry.generatedAt < latestGeneratedAt && historyEntry.generatedAt <= targetGeneratedAt) {
        lookbackHistoryEntry = historyEntry;
        break;
      }
    }
    if (lookbackHistoryEntry === null) {
      for (let historyIndex = marketRecord.history.length - 1; historyIndex >= 0; historyIndex -= 1) {
        const historyEntry = marketRecord.history[historyIndex] ?? null;
        if (historyEntry !== null && historyEntry.generatedAt < latestGeneratedAt) {
          lookbackHistoryEntry = historyEntry;
          break;
        }
      }
    }
    return lookbackHistoryEntry;
  }

  private resolveSignedMove(currentSlice: MarketSnapshotSlice | null, previousSlice: MarketSnapshotSlice | null): number {
    const previousReferencePrice = this.resolveReferencePrice(previousSlice);
    const currentReferencePrice = this.resolveReferencePrice(currentSlice);
    const signedMove = this.computeSignedChange(previousReferencePrice, currentReferencePrice);
    return signedMove;
  }

  private resolveSignedMoveFromLookback(marketRecord: MarketRecord): number {
    const latestSlice = marketRecord.latest;
    const latestGeneratedAt = latestSlice?.generatedAt ?? null;
    const lookbackHistoryEntry = latestGeneratedAt === null ? null : this.findLookbackHistoryEntry(marketRecord, latestGeneratedAt);
    const previousReferencePrice =
      lookbackHistoryEntry === null ? this.resolveReferencePrice(marketRecord.previous) : this.resolveHistoryReferencePrice(lookbackHistoryEntry);
    const currentReferencePrice = this.resolveReferencePrice(latestSlice);
    const signedMove = this.computeSignedChange(previousReferencePrice, currentReferencePrice);
    return signedMove;
  }

  private resolveTokenMomentumFromLookback(marketRecord: MarketRecord, tokenSide: TriggeredToken): number {
    const latestSlice = marketRecord.latest;
    const latestGeneratedAt = latestSlice?.generatedAt ?? null;
    const lookbackHistoryEntry = latestGeneratedAt === null ? null : this.findLookbackHistoryEntry(marketRecord, latestGeneratedAt);
    const previousTokenPrice =
      lookbackHistoryEntry === null
        ? marketRecord.previous === null
          ? null
          : this.resolveTriggerPrice(marketRecord.previous, tokenSide)
        : this.resolveHistoryTriggerPrice(lookbackHistoryEntry, tokenSide);
    const currentTokenPrice = latestSlice === null ? null : this.resolveTriggerPrice(latestSlice, tokenSide);
    const tokenMomentum = this.computeSignedChange(previousTokenPrice, currentTokenPrice);
    return tokenMomentum;
  }

  private buildWindowMarketKeys(window: MarketWindow): MarketKey[] {
    const marketKeys: MarketKey[] = [];
    for (const asset of SUPPORTED_ASSETS) {
      marketKeys.push(this.buildMarketKey(asset, window));
    }
    return marketKeys;
  }

  private buildAnchorMarketKeys(window: MarketWindow): MarketKey[] {
    const marketKeys: MarketKey[] = [this.buildMarketKey("btc", window), this.buildMarketKey("eth", window)];
    return marketKeys;
  }

  private buildFollowerMarketKeys(window: MarketWindow): MarketKey[] {
    const marketKeys: MarketKey[] = [this.buildMarketKey("sol", window), this.buildMarketKey("xrp", window)];
    return marketKeys;
  }

  private computeSynchronyScore(alignedMarketCount: number, qualifyingMarketCount: number): number {
    const synchronyScore = qualifyingMarketCount === 0 ? 0 : alignedMarketCount / qualifyingMarketCount;
    return synchronyScore;
  }

  private computeFollowerParticipation(
    followerLiveMoves: Array<{ marketKey: MarketKey; signedMove: number; softStrength: number }>,
    breadthDirection: CrossAssetRegime["breadthDirection"],
  ): number {
    let followerParticipation = 0;
    if (breadthDirection !== "NEUTRAL" && followerLiveMoves.length > 0) {
      const alignedFollowerStrength = followerLiveMoves
        .filter((followerMove) => {
          return breadthDirection === "UP" ? followerMove.signedMove > 0 : followerMove.signedMove < 0;
        })
        .reduce((aggregatedStrength, followerMove) => aggregatedStrength + followerMove.softStrength, 0);
      const totalFollowerStrength = followerLiveMoves.reduce((aggregatedStrength, followerMove) => aggregatedStrength + followerMove.softStrength, 0);
      followerParticipation = totalFollowerStrength === 0 ? 0 : alignedFollowerStrength / totalFollowerStrength;
    }
    return followerParticipation;
  }

  private computeSoftMoveStrength(signedMove: number): number {
    const softMoveStrength = Math.max(0, Math.min(1, Math.abs(signedMove) / Math.max(config.CROSS_ASSET_BREADTH_MOVE_THRESHOLD, 0.0001)));
    return softMoveStrength;
  }

  private computeAccelerationScore(qualifyingMoves: Array<{ marketKey: MarketKey; signedMove: number }>, averageSignedMove: number): number {
    const absoluteMoves = qualifyingMoves.map((qualifyingMove) => Math.abs(qualifyingMove.signedMove));
    const latestMoveMagnitude = Math.abs(averageSignedMove);
    const averageMagnitude =
      absoluteMoves.length === 0 ? 0 : absoluteMoves.reduce((aggregatedMagnitude, magnitude) => aggregatedMagnitude + magnitude, 0) / absoluteMoves.length;
    const accelerationScore =
      averageMagnitude === 0 ? 0 : Math.max(0, Math.min(1, (latestMoveMagnitude - averageMagnitude * 0.5) / Math.max(averageMagnitude, 0.0001)));
    return accelerationScore;
  }

  private computeExhaustionScore(breadthStrength: number, lagRatio: number, targetSignedMove: number, peerAverageSignedMove: number): number {
    const hasTinyBreadthContext = breadthStrength < 0.05 && Math.abs(peerAverageSignedMove) < config.CROSS_ASSET_BREADTH_MOVE_THRESHOLD * 0.5;
    const leaderOvershoot = hasTinyBreadthContext ? 0 : Math.max(0, Math.abs(targetSignedMove) - Math.abs(peerAverageSignedMove));
    const followerGapPressure = hasTinyBreadthContext ? 0 : breadthStrength >= 0.4 ? Math.max(0, 0.35 - lagRatio) : 0;
    const exhaustionScore = hasTinyBreadthContext ? 0 : Math.max(0, Math.min(1, breadthStrength * 0.6 + leaderOvershoot * 12 + followerGapPressure));
    return exhaustionScore;
  }

  private computeReversalRiskScore(
    breadthDirection: CrossAssetRegime["breadthDirection"],
    targetSignedMove: number,
    peerAverageSignedMove: number,
    breadthStrength: number,
    exhaustionScore: number,
  ): number {
    const directionSign = breadthDirection === "UP" ? 1 : breadthDirection === "DOWN" ? -1 : 0;
    const isTargetAgainstBreadth = directionSign !== 0 && Math.sign(targetSignedMove) !== 0 && Math.sign(targetSignedMove) !== directionSign;
    const signedConflict = isTargetAgainstBreadth ? 0.45 : 0;
    const peerOvershoot = Math.max(0, Math.abs(peerAverageSignedMove) - Math.abs(targetSignedMove));
    const reversalRiskScore = Math.max(0, Math.min(1, exhaustionScore * 0.55 + breadthStrength * 0.2 + peerOvershoot * 10 + signedConflict));
    return reversalRiskScore;
  }

  private resolveRegimeId(
    breadthDirection: CrossAssetRegime["breadthDirection"],
    hasStrongBreadth: boolean,
    hasEthAlignment: boolean,
    hasBtcBiasSupport: boolean,
    hasEthBiasSupport: boolean,
    breadthParticipation: number,
    breadthStrength: number,
    qualifyingMarketCount: number,
    reversalRiskScore: number,
  ): CrossAssetRegime["regimeId"] {
    let regimeId: CrossAssetRegime["regimeId"] = "neutral";
    // Bias should wake up before strong breadth does. A BTC-backed move can be useful
    // with only modest breadth, and aligned BTC+ETH anchors should count even earlier.
    const hasSoftDirectionalBias = breadthDirection !== "NEUTRAL" && hasBtcBiasSupport && breadthParticipation >= 0.55 && breadthStrength >= 0.04;
    const hasAlignedAnchorBias = breadthDirection !== "NEUTRAL" && hasBtcBiasSupport && hasEthBiasSupport && breadthParticipation >= 0.55;
    const hasDirectionalBias = hasSoftDirectionalBias || hasAlignedAnchorBias;
    if (qualifyingMarketCount >= 2 && breadthDirection === "NEUTRAL") {
      regimeId = "fragmented";
    }
    if (hasDirectionalBias) {
      regimeId = hasEthBiasSupport
        ? breadthDirection === "UP"
          ? "btc_eth_bias_up"
          : "btc_eth_bias_down"
        : breadthDirection === "UP"
          ? "btc_bias_up"
          : "btc_bias_down";
    }
    if (breadthDirection === "UP" && hasStrongBreadth) {
      regimeId = hasEthAlignment ? "btc_eth_up" : "btc_up";
    }
    if (breadthDirection === "DOWN" && hasStrongBreadth) {
      regimeId = hasEthAlignment ? "btc_eth_down" : "btc_down";
    }
    if (reversalRiskScore >= 0.72 && breadthDirection !== "NEUTRAL") {
      regimeId = "reversal_risk";
    }
    return regimeId;
  }

  private resolveRegimeClass(regimeId: CrossAssetRegime["regimeId"]): CrossAssetRegime["regimeClass"] {
    let regimeClass: CrossAssetRegime["regimeClass"] = "neutral";
    if (regimeId === "btc_bias_up" || regimeId === "btc_bias_down" || regimeId === "btc_up" || regimeId === "btc_down") {
      regimeClass = "anchor";
    }
    if (regimeId === "btc_eth_bias_up" || regimeId === "btc_eth_bias_down" || regimeId === "btc_eth_up" || regimeId === "btc_eth_down") {
      regimeClass = "aligned";
    }
    if (regimeId === "fragmented") {
      regimeClass = "fragmented";
    }
    if (regimeId === "reversal_risk") {
      regimeClass = "reversal";
    }
    return regimeClass;
  }

  private resolveDirectionalMove(window: MarketWindow, asset: AssetSymbol): CrossAssetRegime["btcDirection"] {
    const marketRecord = this.requireMarketRecord(this.buildMarketKey(asset, window));
    const signedMove = this.resolveSignedMoveFromLookback(marketRecord);
    let directionalMove: CrossAssetRegime["btcDirection"] = "NEUTRAL";
    if (marketRecord.latest?.quality.hasLiveMarket && Math.abs(signedMove) >= config.CROSS_ASSET_BREADTH_MOVE_THRESHOLD) {
      directionalMove = signedMove > 0 ? "UP" : "DOWN";
    }
    return directionalMove;
  }

  private resolveTokenMomentum(window: MarketWindow, asset: AssetSymbol, tokenSide: TriggeredToken): number {
    const marketRecord = this.requireMarketRecord(this.buildMarketKey(asset, window));
    const tokenMomentum = this.resolveTokenMomentumFromLookback(marketRecord, tokenSide);
    return tokenMomentum;
  }

  private buildCrossAssetRegime(marketKey: MarketKey, window: MarketWindow): CrossAssetRegime {
    const anchorLiveMoves: Array<{ marketKey: MarketKey; signedMove: number; softStrength: number }> = [];
    const anchorQualifyingMoves: Array<{ marketKey: MarketKey; signedMove: number }> = [];
    const followerLiveMoves: Array<{ marketKey: MarketKey; signedMove: number; softStrength: number }> = [];
    const targetMarketRecord = this.requireMarketRecord(marketKey);
    const targetSignedMove = this.resolveSignedMoveFromLookback(targetMarketRecord);
    for (const anchorMarketKey of this.buildAnchorMarketKeys(window)) {
      const anchorMarketRecord = this.requireMarketRecord(anchorMarketKey);
      const signedMove = this.resolveSignedMoveFromLookback(anchorMarketRecord);
      if (anchorMarketRecord.latest?.quality.hasLiveMarket) {
        const softStrength = this.computeSoftMoveStrength(signedMove);
        anchorLiveMoves.push({ marketKey: anchorMarketKey, signedMove, softStrength });
        if (Math.abs(signedMove) >= config.CROSS_ASSET_BREADTH_MOVE_THRESHOLD) {
          anchorQualifyingMoves.push({ marketKey: anchorMarketKey, signedMove });
        }
      }
    }
    for (const followerMarketKey of this.buildFollowerMarketKeys(window)) {
      const followerMarketRecord = this.requireMarketRecord(followerMarketKey);
      const signedMove = this.resolveSignedMoveFromLookback(followerMarketRecord);
      if (followerMarketRecord.latest?.quality.hasLiveMarket) {
        const softStrength = this.computeSoftMoveStrength(signedMove);
        followerLiveMoves.push({ marketKey: followerMarketKey, signedMove, softStrength });
      }
    }
    const positiveLiveMoves = anchorLiveMoves.filter((liveMove) => liveMove.signedMove > 0);
    const negativeLiveMoves = anchorLiveMoves.filter((liveMove) => liveMove.signedMove < 0);
    const weightedSoftPositiveBias = positiveLiveMoves.reduce(
      (aggregatedBias, positiveMove) => aggregatedBias + this.resolveCrossAssetWeight(positiveMove.marketKey) * positiveMove.softStrength,
      0,
    );
    const weightedSoftNegativeBias = negativeLiveMoves.reduce(
      (aggregatedBias, negativeMove) => aggregatedBias + this.resolveCrossAssetWeight(negativeMove.marketKey) * negativeMove.softStrength,
      0,
    );
    const positiveMoves = anchorQualifyingMoves.filter((qualifyingMove) => qualifyingMove.signedMove > 0);
    const negativeMoves = anchorQualifyingMoves.filter((qualifyingMove) => qualifyingMove.signedMove < 0);
    const breadthDirection =
      anchorLiveMoves.length === 0 || weightedSoftPositiveBias === weightedSoftNegativeBias
        ? "NEUTRAL"
        : weightedSoftPositiveBias > weightedSoftNegativeBias
          ? "UP"
          : "DOWN";
    const dominantMoves = breadthDirection === "DOWN" ? negativeMoves : breadthDirection === "UP" ? positiveMoves : [];
    const dominantLiveMoves = breadthDirection === "DOWN" ? negativeLiveMoves : breadthDirection === "UP" ? positiveLiveMoves : [];
    const alignedMarketCount = dominantMoves.length;
    const qualifyingMarketCount = anchorQualifyingMoves.length;
    const btcDirection = this.resolveDirectionalMove(window, "btc");
    const ethDirection = this.resolveDirectionalMove(window, "eth");
    const btcUpTokenMomentum = this.resolveTokenMomentum(window, "btc", "up");
    const btcDownTokenMomentum = this.resolveTokenMomentum(window, "btc", "down");
    const ethUpTokenMomentum = this.resolveTokenMomentum(window, "eth", "up");
    const ethDownTokenMomentum = this.resolveTokenMomentum(window, "eth", "down");
    const biasMomentumThreshold = config.CROSS_ASSET_BREADTH_MOVE_THRESHOLD * 0.2;
    const btcNetMomentum = btcUpTokenMomentum - btcDownTokenMomentum;
    const ethNetMomentum = ethUpTokenMomentum - ethDownTokenMomentum;
    const hasBtcBiasSupport =
      breadthDirection === "UP" ? btcNetMomentum >= biasMomentumThreshold : breadthDirection === "DOWN" ? btcNetMomentum <= biasMomentumThreshold * -1 : false;
    const hasEthBiasSupport =
      breadthDirection === "UP" ? ethNetMomentum >= biasMomentumThreshold : breadthDirection === "DOWN" ? ethNetMomentum <= biasMomentumThreshold * -1 : false;
    const totalSoftBias = weightedSoftPositiveBias + weightedSoftNegativeBias;
    const breadthParticipation = totalSoftBias === 0 ? 0 : Math.max(weightedSoftPositiveBias, weightedSoftNegativeBias) / totalSoftBias;
    const followerParticipation = this.computeFollowerParticipation(followerLiveMoves, breadthDirection);
    const averageSignedMove =
      dominantLiveMoves.length === 0
        ? 0
        : dominantLiveMoves.reduce((aggregatedMove, dominantMove) => aggregatedMove + dominantMove.signedMove, 0) / dominantLiveMoves.length;
    const peerAlignedMoves = dominantLiveMoves.filter((dominantMove) => dominantMove.marketKey !== marketKey).map((dominantMove) => dominantMove.signedMove);
    const peerAverageSignedMove =
      peerAlignedMoves.length === 0
        ? averageSignedMove
        : peerAlignedMoves.reduce((aggregatedMove, signedMove) => aggregatedMove + signedMove, 0) / peerAlignedMoves.length;
    const lagRatio =
      breadthDirection === "NEUTRAL" || peerAverageSignedMove === 0
        ? 0
        : Math.max(0, (Math.abs(peerAverageSignedMove) - Math.abs(targetSignedMove)) / Math.abs(peerAverageSignedMove));
    const normalizedMoveStrength = Math.max(0, Math.min(1, Math.abs(averageSignedMove) / Math.max(config.CROSS_ASSET_BREADTH_MOVE_THRESHOLD, 0.0001)));
    const synchronyScore = this.computeSynchronyScore(dominantLiveMoves.length, anchorLiveMoves.length);
    const breadthStrength = breadthParticipation * normalizedMoveStrength;
    const hasStrongBreadth =
      breadthDirection !== "NEUTRAL" &&
      alignedMarketCount >= 2 &&
      breadthParticipation >= config.CROSS_ASSET_BREADTH_MIN_PARTICIPATION &&
      breadthStrength >= config.CROSS_ASSET_BREADTH_MIN_STRENGTH;
    const hasEthAlignment =
      btcDirection !== "NEUTRAL" &&
      ethDirection !== "NEUTRAL" &&
      btcDirection === ethDirection &&
      Math.abs(btcUpTokenMomentum) + Math.abs(btcDownTokenMomentum) > 0 &&
      Math.abs(ethUpTokenMomentum) + Math.abs(ethDownTokenMomentum) > 0;
    const accelerationScore = this.computeAccelerationScore(
      anchorLiveMoves.map((liveMove) => {
        return { marketKey: liveMove.marketKey, signedMove: liveMove.signedMove };
      }),
      averageSignedMove,
    );
    const exhaustionScore = this.computeExhaustionScore(breadthStrength, lagRatio, targetSignedMove, peerAverageSignedMove);
    const reversalRiskScore = this.computeReversalRiskScore(breadthDirection, targetSignedMove, peerAverageSignedMove, breadthStrength, exhaustionScore);
    const regimeId = this.resolveRegimeId(
      breadthDirection,
      hasStrongBreadth,
      hasEthAlignment,
      hasBtcBiasSupport,
      hasEthBiasSupport,
      breadthParticipation,
      breadthStrength,
      qualifyingMarketCount,
      reversalRiskScore,
    );
    const regimeClass = this.resolveRegimeClass(regimeId);
    return {
      regimeId,
      regimeClass,
      breadthDirection,
      btcDirection,
      ethDirection,
      btcUpTokenMomentum,
      btcDownTokenMomentum,
      ethUpTokenMomentum,
      ethDownTokenMomentum,
      hasBtcAnchor: btcDirection !== "NEUTRAL",
      hasEthAlignment,
      breadthStrength,
      breadthParticipation,
      followerParticipation,
      averageSignedMove,
      targetSignedMove,
      peerAverageSignedMove,
      lagRatio,
      alignedMarketCount,
      qualifyingMarketCount,
      synchronyScore,
      accelerationScore,
      exhaustionScore,
      reversalRiskScore,
      isDirectional: breadthDirection !== "NEUTRAL",
      isTradableGlobalContext: regimeId !== "neutral" && regimeId !== "fragmented",
      hasStrongBreadth,
    };
  }

  private hasFreshToken(ageMs: number | null): boolean {
    const isFresh = ageMs !== null && ageMs <= config.TOKEN_MAX_AGE_MS;
    return isFresh;
  }

  private hasFreshSpot(ageMs: number | null): boolean {
    const isFresh = ageMs !== null && ageMs <= config.SPOT_MAX_AGE_MS;
    return isFresh;
  }

  private readNumber(snapshot: InputSnapshot, key: string): number | null {
    const rawValue = snapshot[key];
    let parsedValue: number | null = null;
    if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
      parsedValue = rawValue;
    }
    if (typeof rawValue === "string") {
      const normalizedValue = Number(rawValue);
      if (Number.isFinite(normalizedValue)) {
        parsedValue = normalizedValue;
      }
    }
    return parsedValue;
  }

  private readString(snapshot: InputSnapshot, key: string): string | null {
    const rawValue = snapshot[key];
    const parsedValue = typeof rawValue === "string" ? rawValue : null;
    return parsedValue;
  }

  /**
   * @section public:methods
   */

  public ingestSnapshot(snapshot: InputSnapshot): MarketUpdateResult {
    const triggeredMarkets: MarketTrigger[] = [];
    this.latestSnapshotAt = snapshot.generated_at;
    for (const asset of SUPPORTED_ASSETS) {
      for (const window of SUPPORTED_WINDOWS) {
        const marketKey = this.buildMarketKey(asset, window);
        const marketRecord = this.requireMarketRecord(marketKey);
        const nextSlice = this.buildSlice(snapshot, asset, window);
        marketRecord.previous = marketRecord.latest;
        marketRecord.latest = nextSlice;
      }
    }
    for (const asset of SUPPORTED_ASSETS) {
      for (const window of SUPPORTED_WINDOWS) {
        const marketKey = this.buildMarketKey(asset, window);
        const marketRecord = this.requireMarketRecord(marketKey);
        const nextSlice = marketRecord.latest;
        if (nextSlice?.slug) {
          this.appendHistory(marketRecord, nextSlice);
          this.collectTokenTrigger(triggeredMarkets, marketRecord, nextSlice, "up");
          this.collectTokenTrigger(triggeredMarkets, marketRecord, nextSlice, "down");
        }
      }
    }
    return { generatedAt: snapshot.generated_at, triggeredMarkets };
  }

  public getPredictionContext(marketKey: MarketKey): PredictionContext | null {
    const marketRecord = this.requireMarketRecord(marketKey);
    const latestSlice = marketRecord.latest;
    let predictionContext: PredictionContext | null = null;
    if (latestSlice && marketRecord.lastTrigger) {
      predictionContext = {
        marketKey,
        asset: latestSlice.asset,
        window: latestSlice.window,
        triggeredAt: marketRecord.lastTrigger.triggeredAt,
        trigger: marketRecord.lastTrigger,
        current: latestSlice,
        previous: marketRecord.previous,
        history: [...marketRecord.history],
        crossAssetRegime: this.buildCrossAssetRegime(marketKey, latestSlice.window),
      };
    }
    return predictionContext;
  }

  public getContinuousPredictionContext(marketKey: MarketKey, triggerType: TriggerType = "combo_state_shift"): PredictionContext | null {
    const marketRecord = this.requireMarketRecord(marketKey);
    const latestSlice = marketRecord.latest;
    let predictionContext: PredictionContext | null = null;
    if (latestSlice !== null) {
      predictionContext = {
        marketKey,
        asset: latestSlice.asset,
        window: latestSlice.window,
        triggeredAt: latestSlice.generatedAt,
        trigger: marketRecord.lastTrigger ?? this.buildSyntheticTrigger(marketKey, latestSlice, marketRecord.previous, triggerType),
        current: latestSlice,
        previous: marketRecord.previous,
        history: [...marketRecord.history],
        crossAssetRegime: this.buildCrossAssetRegime(marketKey, latestSlice.window),
      };
    }
    return predictionContext;
  }

  public getCrossAssetRegime(marketKey: MarketKey): CrossAssetRegime | null {
    let crossAssetRegime: CrossAssetRegime | null = null;
    const latestSlice = this.getLatestSlice(marketKey);
    if (latestSlice !== null) {
      crossAssetRegime = this.buildCrossAssetRegime(marketKey, latestSlice.window);
    }
    return crossAssetRegime;
  }

  public getEvaluationPrice(marketKey: MarketKey): MarketEvaluationPrice {
    const marketRecord = this.requireMarketRecord(marketKey);
    const latestSlice = marketRecord.latest;
    const midpoint = latestSlice?.up.midpoint ?? null;
    const fallbackPrice = latestSlice?.up.price ?? null;
    const isFallbackPriceUsed = midpoint === null && fallbackPrice !== null;
    const observedAt = latestSlice?.generatedAt ?? null;
    return { marketKey, midpoint, fallbackPrice, isFallbackPriceUsed, observedAt };
  }

  public getMarketSummaries(nowTimestamp: number): MarketSummary[] {
    const marketSummaries: MarketSummary[] = [];
    for (const asset of SUPPORTED_ASSETS) {
      for (const window of SUPPORTED_WINDOWS) {
        const marketKey = this.buildMarketKey(asset, window);
        const marketRecord = this.requireMarketRecord(marketKey);
        marketSummaries.push(this.buildMarketSummary(marketKey, marketRecord, nowTimestamp));
      }
    }
    return marketSummaries;
  }

  public getLatestSnapshotAge(nowTimestamp: number): number | null {
    let snapshotAgeMs: number | null = null;
    if (this.latestSnapshotAt !== null) {
      snapshotAgeMs = Math.max(0, nowTimestamp - this.latestSnapshotAt);
    }
    return snapshotAgeMs;
  }

  public markPredictionCreated(marketKey: MarketKey, createdAt: number): void {
    const marketRecord = this.requireMarketRecord(marketKey);
    marketRecord.lastPredictionTimestamp = createdAt;
  }

  public getLastPredictionTimestamp(marketKey: MarketKey): number | null {
    const marketRecord = this.requireMarketRecord(marketKey);
    return marketRecord.lastPredictionTimestamp;
  }

  public getLatestSlice(marketKey: MarketKey): MarketSnapshotSlice | null {
    const marketRecord = this.requireMarketRecord(marketKey);
    return marketRecord.latest;
  }
}
