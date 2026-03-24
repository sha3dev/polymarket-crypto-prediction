/**
 * @section consts
 */

export const SUPPORTED_ASSETS = ["btc", "eth", "sol", "xrp"] as const;
export const SUPPORTED_WINDOWS = ["5m", "15m"] as const;
export const SPOT_VENUES = ["binance", "coinbase", "kraken", "okx"] as const;

/**
 * @section types
 */

export type AssetSymbol = (typeof SUPPORTED_ASSETS)[number];
export type MarketWindow = (typeof SUPPORTED_WINDOWS)[number];
export type SpotVenue = (typeof SPOT_VENUES)[number];
export type MarketKey = `${AssetSymbol}:${MarketWindow}`;
export type TriggeredToken = "up" | "down";
export type TriggerType = "near_half" | "crossed_half";
export type PredictionDirection = "UP" | "DOWN";
export type SnapshotValue = number | string | null;
export type InputSnapshot = { generated_at: number } & Record<string, SnapshotValue>;
export type OrderBookLevel = { price: number; size: number };
export type ParsedOrderBook = { bids: OrderBookLevel[]; asks: OrderBookLevel[] };
export type TokenMetrics = {
  price: number | null;
  midpoint: number | null;
  spread: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  depthTop: number;
  imbalance: number;
  distanceToHalf: number | null;
  eventTs: number | null;
  ageMs: number | null;
};
export type SpotVenueMetrics = {
  venue: SpotVenue;
  price: number | null;
  eventTs: number | null;
  ageMs: number | null;
  midpoint: number | null;
  spread: number | null;
  imbalance: number;
};
export type MarketQuality = {
  score: number;
  hasLiveMarket: boolean;
  hasFreshTokens: boolean;
  hasFreshSpot: boolean;
  issues: string[];
};
export type MarketSnapshotSlice = {
  asset: AssetSymbol;
  window: MarketWindow;
  marketKey: MarketKey;
  generatedAt: number;
  slug: string | null;
  marketStart: string | null;
  marketEnd: string | null;
  priceToBeat: number | null;
  up: TokenMetrics;
  down: TokenMetrics;
  spotVenues: SpotVenueMetrics[];
  spotConsensusPrice: number | null;
  spotMomentum: number;
  spotDispersion: number;
  chainlinkPrice: number | null;
  chainlinkAgeMs: number | null;
  quality: MarketQuality;
};
export type MarketHistoryEntry = {
  generatedAt: number;
  upMidpoint: number | null;
  downMidpoint: number | null;
  upPrice: number | null;
  downPrice: number | null;
  spotConsensusPrice: number | null;
  priceToBeat: number | null;
  qualityScore: number;
};
export type MarketTrigger = {
  marketKey: MarketKey;
  asset: AssetSymbol;
  window: MarketWindow;
  triggeredToken: TriggeredToken;
  triggerType: TriggerType;
  previousPrice: number | null;
  currentPrice: number | null;
  distanceToHalf: number | null;
  triggeredAt: number;
};
export type MarketUpdateResult = {
  generatedAt: number;
  triggeredMarkets: MarketTrigger[];
};
export type MarketEvaluationPrice = {
  marketKey: MarketKey;
  midpoint: number | null;
  fallbackPrice: number | null;
  isFallbackPriceUsed: boolean;
  observedAt: number | null;
};
export type MarketSummary = {
  asset: AssetSymbol;
  window: MarketWindow;
  marketKey: MarketKey;
  isLive: boolean;
  latestUpPrice: number | null;
  latestDownPrice: number | null;
  latestUpMidpoint: number | null;
  latestDownMidpoint: number | null;
  upDistanceToHalf: number | null;
  downDistanceToHalf: number | null;
  lastTrigger: MarketTrigger | null;
  lastPredictionTimestamp: number | null;
  cooldownRemainingMs: number;
  snapshotAgeMs: number | null;
  quality: MarketQuality;
};
export type PredictionContext = {
  marketKey: MarketKey;
  asset: AssetSymbol;
  window: MarketWindow;
  triggeredAt: number;
  trigger: MarketTrigger;
  current: MarketSnapshotSlice;
  previous: MarketSnapshotSlice | null;
  history: MarketHistoryEntry[];
};
