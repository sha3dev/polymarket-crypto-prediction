/**
 * @section imports:internals
 */

import type { ComboGateDecision } from "../combo/combo.types.ts";
import type { ComboBreakdown } from "../combo/combo.types.ts";
import type { SelectedStrategyCombo } from "../combo/combo.types.ts";
import type { ComboSource, PositionSide } from "../execution/execution.types.ts";
import type { AssetSymbol, CrossAssetRegime, MarketBarrierState, MarketKey, MarketTrigger, MarketWindow, PredictionDirection } from "../market/market.types.ts";
import type { StrategySignal } from "../strategy/strategy.types.ts";

/**
 * @section types
 */

export type PredictionOutcomeStatus = "pending" | "ok" | "ko" | "void";
export type PredictionOutcome = {
  status: PredictionOutcomeStatus;
  resolvedAt: number | null;
  resolvedDirection: PredictionDirection | null;
  evaluationPrice: number | null;
  baselinePrice: number | null;
  isFallbackPriceUsed: boolean;
  reason: string | null;
};
export type PredictionRecord = {
  predictionId: string;
  asset: AssetSymbol;
  window: MarketWindow;
  marketKey: MarketKey;
  direction: PredictionDirection;
  confidence: number;
  weightedScore: number;
  baseWeightedScore: number;
  adjustedWeightedScore: number;
  baseConfidence: number;
  adjustedConfidence: number;
  trigger: MarketTrigger;
  createdAt: number;
  evaluationDueAt: number;
  positionSide: PositionSide;
  entryReferencePrice: number | null;
  takeProfitPrice: number | null;
  stopLossPrice: number | null;
  baselineUpPrice: number | null;
  baselineUpMidpoint: number | null;
  strategyBreakdown: StrategySignal[];
  selectedCombo: SelectedStrategyCombo;
  comboBreakdown: ComboBreakdown;
  comboGate: ComboGateDecision;
  crossAssetRegime: CrossAssetRegime;
  barrierState: MarketBarrierState;
  isExecutionEligible: boolean;
  executionBlockingReasons: string[];
  wasExecuted: boolean;
  executionComboSource: ComboSource | null;
  isResolved: boolean;
  outcome: PredictionOutcome;
};
export type PredictionResponse = {
  asset: AssetSymbol;
  window: MarketWindow;
  marketKey: MarketKey;
  direction: PredictionDirection;
  confidence: number;
  weightedScore: number;
  baseWeightedScore: number;
  adjustedWeightedScore: number;
  baseConfidence: number;
  adjustedConfidence: number;
  timestamp: number;
  trigger: MarketTrigger;
  evaluationDueAt: number;
  positionSide: PositionSide;
  entryReferencePrice: number | null;
  takeProfitPrice: number | null;
  stopLossPrice: number | null;
  isResolved: boolean;
  comboGate: ComboGateDecision;
  crossAssetRegime: CrossAssetRegime;
  barrierState: MarketBarrierState;
  isExecutionEligible: boolean;
  executionBlockingReasons: string[];
  wasExecuted: boolean;
  executionComboSource: ComboSource | null;
  result: PredictionOutcome;
  strategyBreakdown: StrategySignal[];
  selectedCombo: SelectedStrategyCombo;
  comboBreakdown: ComboBreakdown;
};
