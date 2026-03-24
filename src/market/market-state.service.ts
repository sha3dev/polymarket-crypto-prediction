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
    previousSlice: MarketSnapshotSlice | null,
    currentSlice: MarketSnapshotSlice,
    tokenSide: TriggeredToken,
  ): void {
    const previousPrice = previousSlice ? this.resolveTriggerPrice(previousSlice, tokenSide) : null;
    const currentPrice = this.resolveTriggerPrice(currentSlice, tokenSide);
    const triggerType = this.detectTriggerType(previousPrice, currentPrice);
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

  private detectTriggerType(previousPrice: number | null, currentPrice: number | null): TriggerType | null {
    let triggerType: TriggerType | null = null;
    if (previousPrice !== null && currentPrice !== null && ((previousPrice < 0.5 && currentPrice >= 0.5) || (previousPrice > 0.5 && currentPrice <= 0.5))) {
      triggerType = "crossed_half";
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

  private resolveSignedMove(currentSlice: MarketSnapshotSlice | null, previousSlice: MarketSnapshotSlice | null): number {
    const previousReferencePrice = this.resolveReferencePrice(previousSlice);
    const currentReferencePrice = this.resolveReferencePrice(currentSlice);
    const signedMove = this.computeSignedChange(previousReferencePrice, currentReferencePrice);
    return signedMove;
  }

  private buildWindowMarketKeys(window: MarketWindow): MarketKey[] {
    const marketKeys: MarketKey[] = [];
    for (const asset of SUPPORTED_ASSETS) {
      marketKeys.push(this.buildMarketKey(asset, window));
    }
    return marketKeys;
  }

  private buildCrossAssetRegime(marketKey: MarketKey, window: MarketWindow): CrossAssetRegime {
    const qualifyingMoves: Array<{ marketKey: MarketKey; signedMove: number }> = [];
    const targetMarketRecord = this.requireMarketRecord(marketKey);
    const targetSignedMove = this.resolveSignedMove(targetMarketRecord.latest, targetMarketRecord.previous);
    for (const peerMarketKey of this.buildWindowMarketKeys(window)) {
      const peerMarketRecord = this.requireMarketRecord(peerMarketKey);
      const signedMove = this.resolveSignedMove(peerMarketRecord.latest, peerMarketRecord.previous);
      if (peerMarketRecord.latest?.quality.hasLiveMarket && Math.abs(signedMove) >= config.CROSS_ASSET_BREADTH_MOVE_THRESHOLD) {
        qualifyingMoves.push({ marketKey: peerMarketKey, signedMove });
      }
    }
    const positiveMoves = qualifyingMoves.filter((qualifyingMove) => qualifyingMove.signedMove > 0);
    const negativeMoves = qualifyingMoves.filter((qualifyingMove) => qualifyingMove.signedMove < 0);
    const dominantMoves = positiveMoves.length >= negativeMoves.length ? positiveMoves : negativeMoves;
    const breadthDirection =
      qualifyingMoves.length === 0
        ? "NEUTRAL"
        : positiveMoves.length === negativeMoves.length
          ? "NEUTRAL"
          : positiveMoves.length > negativeMoves.length
            ? "UP"
            : "DOWN";
    const alignedMarketCount = dominantMoves.length;
    const qualifyingMarketCount = qualifyingMoves.length;
    const breadthParticipation = qualifyingMarketCount === 0 ? 0 : alignedMarketCount / qualifyingMarketCount;
    const averageSignedMove =
      dominantMoves.length === 0
        ? 0
        : dominantMoves.reduce((aggregatedMove, dominantMove) => aggregatedMove + dominantMove.signedMove, 0) / dominantMoves.length;
    const peerAlignedMoves = dominantMoves.filter((dominantMove) => dominantMove.marketKey !== marketKey).map((dominantMove) => dominantMove.signedMove);
    const peerAverageSignedMove =
      peerAlignedMoves.length === 0
        ? averageSignedMove
        : peerAlignedMoves.reduce((aggregatedMove, signedMove) => aggregatedMove + signedMove, 0) / peerAlignedMoves.length;
    const lagRatio =
      breadthDirection === "NEUTRAL" || peerAverageSignedMove === 0
        ? 0
        : Math.max(0, (Math.abs(peerAverageSignedMove) - Math.abs(targetSignedMove)) / Math.abs(peerAverageSignedMove));
    const normalizedMoveStrength = Math.max(0, Math.min(1, Math.abs(averageSignedMove) / Math.max(config.CROSS_ASSET_BREADTH_MOVE_THRESHOLD * 3, 0.0001)));
    const breadthStrength = breadthParticipation * normalizedMoveStrength;
    const hasStrongBreadth =
      breadthDirection !== "NEUTRAL" &&
      alignedMarketCount >= 3 &&
      breadthParticipation >= config.CROSS_ASSET_BREADTH_MIN_PARTICIPATION &&
      breadthStrength >= config.CROSS_ASSET_BREADTH_MIN_STRENGTH;
    const hasLeaderLaggardOpportunity =
      hasStrongBreadth && Math.sign(targetSignedMove || 0) !== (breadthDirection === "UP" ? -1 : 1) && lagRatio >= config.CROSS_ASSET_LAGGARD_THRESHOLD;
    const leaderMarketKey =
      dominantMoves.length === 0
        ? null
        : ([...dominantMoves].sort((leftMove, rightMove) => Math.abs(rightMove.signedMove) - Math.abs(leftMove.signedMove))[0]?.marketKey ?? null);
    return {
      breadthDirection,
      breadthStrength,
      breadthParticipation,
      averageSignedMove,
      targetSignedMove,
      peerAverageSignedMove,
      lagRatio,
      alignedMarketCount,
      qualifyingMarketCount,
      leaderMarketKey,
      hasStrongBreadth,
      hasLeaderLaggardOpportunity,
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
        if (nextSlice.slug) {
          this.appendHistory(marketRecord, nextSlice);
          this.collectTokenTrigger(triggeredMarkets, marketRecord.previous, nextSlice, "up");
          this.collectTokenTrigger(triggeredMarkets, marketRecord.previous, nextSlice, "down");
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
