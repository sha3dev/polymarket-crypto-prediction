/**
 * @section imports:internals
 */

import type { MarketKey, PredictionDirection } from "../market/market.types.ts";

/**
 * @section types
 */

export type ComboSize = 2 | 3;
export type ComboStatus = "warming_up" | "good" | "neutral" | "avoid";
export type ComboDefinition = {
  comboKey: string;
  marketKey: MarketKey;
  memberStrategyIds: string[];
  size: ComboSize;
};
export type ComboUsage = {
  comboKey: string;
  marketKey: MarketKey;
  memberStrategyIds: string[];
  size: ComboSize;
  direction: PredictionDirection | null;
  isAgreement: boolean;
  comboScore: number;
  boostApplied: number;
  confidencePenaltyApplied: number;
  didAffectFinalScore: boolean;
  didAffectFinalConfidence: boolean;
  reason: string;
};
export type ComboSummary = {
  comboKey: string;
  marketKey: MarketKey;
  memberStrategyIds: string[];
  size: ComboSize;
  sampleCount: number;
  agreementCount: number;
  disagreementCount: number;
  agreementPurity: number;
  hitRate: number;
  averagePnlProxy: number;
  cumulativePnlProxy: number;
  averageCalibrationError: number;
  recentStreak: number;
  maxDrawdownProxy: number;
  liftVsBestMemberHitRate: number;
  liftVsBestMemberPnl: number;
  comboScore: number;
  status: ComboStatus;
  lastResolvedAt: number | null;
};
export type MarketComboBoard = {
  marketKey: MarketKey;
  topPairs: ComboSummary[];
  topTrios: ComboSummary[];
  activeCombosNow: ComboUsage[];
  lastAppliedCombos: ComboUsage[];
  comboBoostShare: number;
  comboConfidencePenaltyShare: number;
  hasActionableCombos: boolean;
};
export type ComboBreakdown = {
  activeCombos: ComboUsage[];
  appliedBoostCombos: ComboUsage[];
  appliedDisagreementCombos: ComboUsage[];
  totalBoostApplied: number;
  totalConfidencePenaltyApplied: number;
};
