/**
 * @section imports:internals
 */

import type { ComboSource } from "../execution/execution.types.ts";
import type { AssetSymbol, MarketKey, MarketTrigger, MarketWindow, TriggerType, TriggeredToken } from "../market/market.types.ts";
import type { StrategyTier } from "../strategy/strategy.types.ts";

/**
 * @section consts
 */

export const WINDOW_PHASES = ["opening", "middle", "late", "final"] as const;
export const OPPORTUNITY_FACTOR_SCOPES = ["reachability", "microstructure", "pricing", "anchor", "timing"] as const;

/**
 * @section types
 */

export type OpportunitySide = "up" | "down";
export type WindowPhase = (typeof WINDOW_PHASES)[number];
export type OpportunityFactorScope = (typeof OPPORTUNITY_FACTOR_SCOPES)[number];
export type WindowState = {
  marketStart: string | null;
  marketEnd: string | null;
  elapsedMs: number | null;
  remainingMs: number | null;
  elapsedRatio: number | null;
  phase: WindowPhase;
};
export type BarrierReachabilityState = {
  priceToBeat: number | null;
  referencePrice: number | null;
  referenceSource: "chainlink" | "spot" | "none";
  signedBarrierDistance: number | null;
  barrierDistanceRatio: number | null;
  dominantResolutionSide: OpportunitySide | null;
  contestabilityScore: number;
  requiredMovePerSecond: number | null;
  isReachable: boolean;
  isEffectivelyDecided: boolean;
  reason: string;
};
export type AnchorContextState = {
  btcSide: OpportunitySide | null;
  ethSide: OpportunitySide | null;
  anchorStrength: number;
  followerSupport: number;
  isHardConflict: boolean;
  reason: string | null;
};
export type TokenOpportunityState = {
  side: OpportunitySide;
  livePrice: number | null;
  entryQualityScore: number;
  tpDistance: number | null;
  slDistance: number | null;
  tpBeforeSlScore: number;
  lateEntryPenalty: number;
  affordabilityScore: number;
  microstructureScore: number;
  expectedPathScore: number;
};
export type MarketOpportunityState = {
  marketKey: MarketKey;
  asset: AssetSymbol;
  window: MarketWindow;
  windowState: WindowState;
  barrierReachability: BarrierReachabilityState;
  anchorContext: AnchorContextState;
  upOpportunity: TokenOpportunityState;
  downOpportunity: TokenOpportunityState;
  recommendedSide: OpportunitySide | null;
  recommendedSideScore: number;
  hasOpportunity: boolean;
  reason: string;
};
export type OpportunityFactorSignal = {
  factorId: string;
  marketKey: MarketKey;
  name: string;
  tier: StrategyTier;
  scope: OpportunityFactorScope;
  targetSide: OpportunitySide;
  edgeScore: number;
  confidence: number;
  weight: number;
  reason: string | null;
  debug: Record<string, number | string | boolean | null>;
};
export type SelectedOpportunityCombo = {
  comboKey: string;
  marketKey: MarketKey;
  memberFactorIds: string[];
  targetSide: OpportunitySide;
  edgeScore: number;
  tpBeforeSlScore: number;
  contestabilityScore: number;
  anchorAlignmentScore: number;
  microstructureScore: number;
  sampleCount: number;
  selectionReason: string;
  selectionSource: ComboSource | null;
};
export type OpportunityOutcomeStatus = "pending" | "tp" | "sl" | "void";
export type OpportunityOutcome = {
  status: OpportunityOutcomeStatus;
  resolvedAt: number | null;
  closeTokenPrice: number | null;
  reason: string | null;
};
export type OpportunityTrigger = {
  triggerType: TriggerType;
  triggeredToken: TriggeredToken;
  triggeredAt: number;
};
export type OpportunityResponse = {
  opportunityId: string;
  asset: AssetSymbol;
  window: MarketWindow;
  marketKey: MarketKey;
  targetSide: OpportunitySide;
  timestamp: number;
  evaluationDueAt: number;
  trigger: OpportunityTrigger;
  entryTokenPrice: number | null;
  closeTokenPrice: number | null;
  windowState: WindowState;
  barrierReachability: BarrierReachabilityState;
  anchorContext: AnchorContextState;
  tokenOpportunity: TokenOpportunityState;
  upOpportunity: TokenOpportunityState;
  downOpportunity: TokenOpportunityState;
  recommendedSideScore: number;
  contestabilityScore: number;
  tpBeforeSlScore: number;
  entryQualityScore: number;
  hasExecutionOpportunity: boolean;
  executionBlockingReasons: string[];
  wasExecuted: boolean;
  selectedOpportunityCombo: SelectedOpportunityCombo | null;
  factors: OpportunityFactorSignal[];
  result: OpportunityOutcome;
};
export type MarketOpportunitySummary = {
  marketKey: MarketKey;
  asset: AssetSymbol;
  window: MarketWindow;
  windowState: WindowState;
  barrierReachability: BarrierReachabilityState;
  anchorContext: AnchorContextState;
  recommendedSide: OpportunitySide | null;
  recommendedSideScore: number;
  hasOpportunity: boolean;
  reason: string;
  currentTokenPrice: number | null;
  tpDistance: number | null;
  slDistance: number | null;
  tpBeforeSlScore: number;
  contestabilityScore: number;
  entryQualityScore: number;
  selectedOpportunityCombo: SelectedOpportunityCombo | null;
};
export type OpportunityFactorSummary = OpportunityFactorSignal;
export type OpportunityFactorBoard = {
  marketKey: MarketKey;
  factors: OpportunityFactorSignal[];
};
export type OpportunityLiveState = {
  market: MarketOpportunitySummary;
  state: MarketOpportunityState;
  factorBoard: OpportunityFactorBoard;
};
export type OpportunityDebugSnapshot = {
  marketKey: MarketKey;
  selectedOpportunityCombo: SelectedOpportunityCombo | null;
  trigger: MarketTrigger | null;
};
