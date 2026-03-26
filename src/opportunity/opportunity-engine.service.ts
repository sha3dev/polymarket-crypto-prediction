/**
 * @section imports:internals
 */

import type { ComboSearchSnapshot, ComboUsage, SelectedStrategyCombo } from "../combo/combo.types.ts";
import config from "../config.ts";
import type { MarketStateService } from "../market/market-state.service.ts";
import type { AssetSymbol, MarketKey, MarketTrigger, MarketWindow, PredictionDirection } from "../market/market.types.ts";
import { SUPPORTED_ASSETS, SUPPORTED_WINDOWS } from "../market/market.types.ts";
import type { PredictionEngineService } from "../prediction/prediction-engine.service.ts";
import type { PredictionResponse } from "../prediction/prediction.types.ts";
import type { StrategyEngineService } from "../strategy/strategy-engine.service.ts";
import type { StrategySignal } from "../strategy/strategy.types.ts";
import type { OpportunityStateService } from "./opportunity-state.service.ts";
import type { OpportunityStoreService } from "./opportunity-store.service.ts";
import type {
  AnchorContextState,
  BarrierReachabilityState,
  MarketOpportunityState,
  MarketOpportunitySummary,
  OpportunityFactorBoard,
  OpportunityFactorSignal,
  OpportunityFactorSummary,
  OpportunityOutcome,
  OpportunityResponse,
  OpportunitySide,
  OpportunityTrigger,
  SelectedOpportunityCombo,
  TokenOpportunityState,
  WindowState,
} from "./opportunity.types.ts";

/**
 * @section class
 */

export class OpportunityEngineService {
  /**
   * @section private:attributes
   */

  private readonly marketStateService: MarketStateService;
  private readonly predictionEngineService: PredictionEngineService;
  private readonly strategyEngineService: StrategyEngineService;
  private readonly opportunityStateService: OpportunityStateService;
  private readonly opportunityStoreService: OpportunityStoreService;

  /**
   * @section constructor
   */

  public constructor(
    marketStateService: MarketStateService,
    predictionEngineService: PredictionEngineService,
    strategyEngineService: StrategyEngineService,
    opportunityStateService: OpportunityStateService,
    opportunityStoreService: OpportunityStoreService,
  ) {
    this.marketStateService = marketStateService;
    this.predictionEngineService = predictionEngineService;
    this.strategyEngineService = strategyEngineService;
    this.opportunityStateService = opportunityStateService;
    this.opportunityStoreService = opportunityStoreService;
  }

  /**
   * @section private:methods
   */

  private clamp(rawValue: number, minValue: number, maxValue: number): number {
    const clampedValue = Math.max(minValue, Math.min(maxValue, rawValue));
    return clampedValue;
  }

  private buildMarketKey(asset: AssetSymbol, window: MarketWindow): MarketKey {
    const marketKey: MarketKey = `${asset}:${window}`;
    return marketKey;
  }

  private resolveOpportunitySide(direction: PredictionDirection): OpportunitySide {
    const opportunitySide: OpportunitySide = direction === "UP" ? "up" : "down";
    return opportunitySide;
  }

  private resolveOpportunityOutcomeStatus(predictionResponse: PredictionResponse): OpportunityOutcome["status"] {
    let opportunityOutcomeStatus: OpportunityOutcome["status"] = "void";
    if (predictionResponse.result.status === "pending") {
      opportunityOutcomeStatus = "pending";
    }
    if (predictionResponse.result.status === "ok") {
      opportunityOutcomeStatus = "tp";
    }
    if (predictionResponse.result.status === "ko") {
      opportunityOutcomeStatus = "sl";
    }
    return opportunityOutcomeStatus;
  }

  private resolveFactorScope(strategySignal: StrategySignal): OpportunityFactorSignal["scope"] {
    let factorScope: OpportunityFactorSignal["scope"] = "timing";
    if (strategySignal.family === "microstructure") {
      factorScope = "microstructure";
    }
    if (strategySignal.family === "cross_asset") {
      factorScope = "anchor";
    }
    if (strategySignal.family === "pricing") {
      factorScope =
        strategySignal.strategyId === "s08" || strategySignal.strategyId === "s14" || strategySignal.strategyId === "s15" ? "reachability" : "pricing";
    }
    return factorScope;
  }

  private buildFactorSignals(marketKey: MarketKey, strategyBreakdown: StrategySignal[]): OpportunityFactorSignal[] {
    const factorSignals = strategyBreakdown.map((strategySignal) => {
      const targetSide: OpportunitySide = strategySignal.direction === "UP" ? "up" : "down";
      return {
        factorId: strategySignal.strategyId,
        marketKey,
        name: strategySignal.name,
        tier: strategySignal.tier,
        scope: this.resolveFactorScope(strategySignal),
        targetSide,
        edgeScore: this.clamp(Math.abs(strategySignal.score), 0, 1),
        confidence: strategySignal.confidence,
        weight: strategySignal.weight,
        reason: strategySignal.reason,
        debug: strategySignal.debug,
      };
    });
    return factorSignals;
  }

  private resolveAverageEdgeForScope(factors: OpportunityFactorSignal[], targetSide: OpportunitySide, scope?: OpportunityFactorSignal["scope"]): number {
    const scopedFactors = factors.filter((factor) => {
      const isSideMatch = factor.targetSide === targetSide;
      const isScopeMatch = scope === undefined || factor.scope === scope;
      return isSideMatch && isScopeMatch;
    });
    const weightSum = scopedFactors.reduce((aggregatedWeight, factor) => aggregatedWeight + factor.weight, 0);
    const averageEdgeForScope =
      weightSum === 0
        ? 0.5
        : this.clamp(scopedFactors.reduce((aggregatedEdge, factor) => aggregatedEdge + factor.edgeScore * factor.weight, 0) / weightSum, 0, 1);
    return averageEdgeForScope;
  }

  private resolveWindowPhaseFromRemaining(remainingMs: number | null): WindowState["phase"] {
    let phase: WindowState["phase"] = "middle";
    if (remainingMs !== null && remainingMs <= config.BARRIER_FORCE_DECIDED_TIME_MS) {
      phase = "final";
    } else {
      if (remainingMs !== null && remainingMs <= config.PREDICTION_HORIZON_MS) {
        phase = "late";
      }
    }
    return phase;
  }

  private buildWindowStateFromPrediction(predictionResponse: PredictionResponse): WindowState {
    const remainingMs = predictionResponse.barrierState.timeRemainingMs;
    const windowState: WindowState = {
      marketStart: null,
      marketEnd: predictionResponse.barrierState.marketEnd,
      elapsedMs: null,
      remainingMs,
      elapsedRatio: null,
      phase: this.resolveWindowPhaseFromRemaining(remainingMs),
    };
    return windowState;
  }

  private buildBarrierReachabilityFromPrediction(predictionResponse: PredictionResponse): BarrierReachabilityState {
    const referencePrice = predictionResponse.barrierState.chainlinkPrice ?? predictionResponse.barrierState.spotConsensusPrice;
    const referenceSource =
      predictionResponse.barrierState.chainlinkPrice !== null ? "chainlink" : predictionResponse.barrierState.spotConsensusPrice !== null ? "spot" : "none";
    const signedBarrierDistance =
      referencePrice === null || predictionResponse.barrierState.priceToBeat === null ? null : referencePrice - predictionResponse.barrierState.priceToBeat;
    const barrierDistanceRatio = predictionResponse.barrierState.chainlinkDistanceRatio ?? predictionResponse.barrierState.spotDistanceRatio ?? null;
    let contestabilityScore =
      barrierDistanceRatio === null ? 0.5 : this.clamp(1 - barrierDistanceRatio / Math.max(config.BARRIER_DECIDED_RATIO, 0.000_001), 0, 1);
    if (predictionResponse.barrierState.isNearBarrier) {
      contestabilityScore = Math.max(contestabilityScore, 0.85);
    }
    if (predictionResponse.barrierState.isEffectivelyDecided) {
      contestabilityScore = 0.05;
    }
    const barrierReachability: BarrierReachabilityState = {
      priceToBeat: predictionResponse.barrierState.priceToBeat,
      referencePrice,
      referenceSource,
      signedBarrierDistance,
      barrierDistanceRatio,
      dominantResolutionSide:
        predictionResponse.barrierState.dominantSide === "UP" ? "up" : predictionResponse.barrierState.dominantSide === "DOWN" ? "down" : null,
      contestabilityScore,
      requiredMovePerSecond:
        signedBarrierDistance === null || predictionResponse.barrierState.timeRemainingMs === null || predictionResponse.barrierState.timeRemainingMs <= 0
          ? null
          : Math.abs(signedBarrierDistance) / Math.max(1, predictionResponse.barrierState.timeRemainingMs / 1_000),
      isReachable: !predictionResponse.barrierState.isEffectivelyDecided && contestabilityScore >= 0.2,
      isEffectivelyDecided: predictionResponse.barrierState.isEffectivelyDecided,
      reason: predictionResponse.barrierState.decisionReason ?? "missing_barrier_inputs",
    };
    return barrierReachability;
  }

  private buildAnchorContextFromPrediction(predictionResponse: PredictionResponse): AnchorContextState {
    const btcSide =
      predictionResponse.crossAssetRegime.btcDirection === "UP" ? "up" : predictionResponse.crossAssetRegime.btcDirection === "DOWN" ? "down" : null;
    const ethSide =
      predictionResponse.crossAssetRegime.ethDirection === "UP" ? "up" : predictionResponse.crossAssetRegime.ethDirection === "DOWN" ? "down" : null;
    let isHardConflict = false;
    let reason: string | null = null;
    if (predictionResponse.asset === "eth" && btcSide !== null && this.resolveOpportunitySide(predictionResponse.direction) !== btcSide) {
      isHardConflict = true;
      reason = "eth_anchor_conflict";
    }
    if (
      (predictionResponse.asset === "sol" || predictionResponse.asset === "xrp") &&
      (btcSide === null || ethSide === null || btcSide !== ethSide || this.resolveOpportunitySide(predictionResponse.direction) !== btcSide)
    ) {
      isHardConflict = true;
      reason = "alt_anchor_conflict";
    }
    const anchorContext: AnchorContextState = {
      btcSide,
      ethSide,
      anchorStrength: this.clamp((predictionResponse.crossAssetRegime.breadthStrength + predictionResponse.crossAssetRegime.synchronyScore) / 2, 0, 1),
      followerSupport: this.clamp(
        (predictionResponse.crossAssetRegime.followerParticipation + predictionResponse.crossAssetRegime.breadthParticipation) / 2,
        0,
        1,
      ),
      isHardConflict,
      reason,
    };
    return anchorContext;
  }

  private buildHistoricalTokenOpportunity(
    predictionResponse: PredictionResponse,
    side: OpportunitySide,
    windowState: WindowState,
    barrierReachability: BarrierReachabilityState,
    factors: OpportunityFactorSignal[],
  ): TokenOpportunityState {
    const isTargetSide = side === this.resolveOpportunitySide(predictionResponse.direction);
    const livePrice = isTargetSide ? predictionResponse.entryReferencePrice : null;
    const entryQualityScore = isTargetSide
      ? this.clamp(predictionResponse.selectedCombo.marketQualityScore * 0.7 + predictionResponse.selectedCombo.affordabilityScore * 0.3, 0, 1)
      : this.clamp(this.resolveAverageEdgeForScope(factors, side), 0.25, 0.7);
    const microstructureScore = this.resolveAverageEdgeForScope(factors, side, "microstructure");
    const affordabilityScore = isTargetSide ? predictionResponse.selectedCombo.affordabilityScore : this.clamp(1 - entryQualityScore * 0.35, 0.1, 0.8);
    const lateEntryPenalty = windowState.phase === "final" ? 0.32 : windowState.phase === "late" ? 0.18 : 0.05;
    const expectedPathBase = isTargetSide
      ? this.clamp(
          predictionResponse.confidence * 0.58 + Math.abs(predictionResponse.weightedScore) * 0.22 + barrierReachability.contestabilityScore * 0.2,
          0,
          1,
        )
      : this.clamp((1 - predictionResponse.confidence) * 0.4 + barrierReachability.contestabilityScore * 0.2 + 0.2, 0, 0.7);
    const tpBeforeSlScore = this.clamp(expectedPathBase + microstructureScore * 0.12 + entryQualityScore * 0.08 - lateEntryPenalty * 0.4, 0, 1);
    const tokenOpportunity: TokenOpportunityState = {
      side,
      livePrice,
      entryQualityScore,
      tpDistance: isTargetSide ? predictionResponse.takeProfitPrice : null,
      slDistance: isTargetSide ? predictionResponse.stopLossPrice : null,
      tpBeforeSlScore,
      lateEntryPenalty,
      affordabilityScore,
      microstructureScore,
      expectedPathScore: expectedPathBase,
    };
    return tokenOpportunity;
  }

  private buildSelectedOpportunityComboFromSelected(
    selectedCombo: SelectedStrategyCombo,
    targetSide: OpportunitySide,
    tokenOpportunity: TokenOpportunityState,
    barrierReachability: BarrierReachabilityState,
  ): SelectedOpportunityCombo {
    const selectedOpportunityCombo: SelectedOpportunityCombo = {
      comboKey: selectedCombo.comboKey,
      marketKey: selectedCombo.marketKey,
      memberFactorIds: selectedCombo.memberStrategyIds,
      targetSide,
      edgeScore: this.clamp(selectedCombo.comboScore, 0, 1),
      tpBeforeSlScore: tokenOpportunity.tpBeforeSlScore,
      contestabilityScore: barrierReachability.contestabilityScore,
      anchorAlignmentScore: selectedCombo.anchorFitScore,
      microstructureScore: tokenOpportunity.microstructureScore,
      sampleCount: selectedCombo.sampleCount,
      selectionReason: selectedCombo.selectionReason,
      selectionSource: selectedCombo.selectionSource,
    };
    return selectedOpportunityCombo;
  }

  private buildSelectedOpportunityComboFromUsage(
    comboUsage: ComboUsage,
    state: MarketOpportunityState,
    selectionSource: SelectedOpportunityCombo["selectionSource"],
  ): SelectedOpportunityCombo {
    const targetSide = comboUsage.direction === "DOWN" ? "down" : "up";
    const tokenOpportunity = targetSide === "up" ? state.upOpportunity : state.downOpportunity;
    const selectedOpportunityCombo: SelectedOpportunityCombo = {
      comboKey: comboUsage.comboKey,
      marketKey: comboUsage.marketKey,
      memberFactorIds: comboUsage.memberStrategyIds,
      targetSide,
      edgeScore: this.clamp(comboUsage.effectiveComboScore, 0, 1),
      tpBeforeSlScore: tokenOpportunity.tpBeforeSlScore,
      contestabilityScore: state.barrierReachability.contestabilityScore,
      anchorAlignmentScore: targetSide === state.barrierReachability.dominantResolutionSide ? 1 : 0.35,
      microstructureScore: tokenOpportunity.microstructureScore,
      sampleCount: comboUsage.sampleCount,
      selectionReason: comboUsage.reason,
      selectionSource,
    };
    return selectedOpportunityCombo;
  }

  private resolveSelectedComboFromSnapshot(
    comboSearchSnapshot: ComboSearchSnapshot,
    state: MarketOpportunityState,
    latestPrediction: PredictionResponse | null,
  ): SelectedOpportunityCombo | null {
    const selectedUsage =
      comboSearchSnapshot.activeCombosNow.find((comboUsage) => comboUsage.comboKey === comboSearchSnapshot.selectedComboKey) ??
      comboSearchSnapshot.lastAppliedCombos.find((comboUsage) => comboUsage.comboKey === comboSearchSnapshot.selectedComboKey) ??
      comboSearchSnapshot.activeCombosNow[0] ??
      comboSearchSnapshot.lastAppliedCombos[0] ??
      null;
    const selectedOpportunityCombo =
      selectedUsage !== null
        ? this.buildSelectedOpportunityComboFromUsage(selectedUsage, state, comboSearchSnapshot.selectedComboSource)
        : latestPrediction !== null
          ? this.buildSelectedOpportunityComboFromSelected(
              latestPrediction.selectedCombo,
              this.resolveOpportunitySide(latestPrediction.direction),
              this.resolveOpportunitySide(latestPrediction.direction) === "up" ? state.upOpportunity : state.downOpportunity,
              state.barrierReachability,
            )
          : null;
    return selectedOpportunityCombo;
  }

  private buildOpportunityOutcome(predictionResponse: PredictionResponse): OpportunityOutcome {
    const opportunityOutcome: OpportunityOutcome = {
      status: this.resolveOpportunityOutcomeStatus(predictionResponse),
      resolvedAt: predictionResponse.result.resolvedAt,
      closeTokenPrice: predictionResponse.result.evaluationPrice,
      reason: predictionResponse.result.reason,
    };
    return opportunityOutcome;
  }

  private buildOpportunityTrigger(marketTrigger: MarketTrigger): OpportunityTrigger {
    const opportunityTrigger: OpportunityTrigger = {
      triggerType: marketTrigger.triggerType,
      triggeredToken: marketTrigger.triggeredToken,
      triggeredAt: marketTrigger.triggeredAt,
    };
    return opportunityTrigger;
  }

  private buildHistoricalOpportunityResponse(predictionResponse: PredictionResponse): OpportunityResponse {
    const liveState = this.opportunityStoreService.getLiveState(predictionResponse.marketKey);
    const factors = this.buildFactorSignals(predictionResponse.marketKey, predictionResponse.strategyBreakdown);
    const windowState = this.buildWindowStateFromPrediction(predictionResponse);
    const barrierReachability = this.buildBarrierReachabilityFromPrediction(predictionResponse);
    const anchorContext = this.buildAnchorContextFromPrediction(predictionResponse);
    const upOpportunity =
      liveState?.state.upOpportunity ?? this.buildHistoricalTokenOpportunity(predictionResponse, "up", windowState, barrierReachability, factors);
    const downOpportunity =
      liveState?.state.downOpportunity ?? this.buildHistoricalTokenOpportunity(predictionResponse, "down", windowState, barrierReachability, factors);
    const targetSide = this.resolveOpportunitySide(predictionResponse.direction);
    const tokenOpportunity = targetSide === "up" ? upOpportunity : downOpportunity;
    const opportunityResponse: OpportunityResponse = {
      opportunityId: `${predictionResponse.marketKey}:${predictionResponse.timestamp}`,
      asset: predictionResponse.asset,
      window: predictionResponse.window,
      marketKey: predictionResponse.marketKey,
      targetSide,
      timestamp: predictionResponse.timestamp,
      evaluationDueAt: predictionResponse.evaluationDueAt,
      trigger: this.buildOpportunityTrigger(predictionResponse.trigger),
      entryTokenPrice: predictionResponse.entryReferencePrice,
      closeTokenPrice: predictionResponse.result.evaluationPrice,
      windowState,
      barrierReachability,
      anchorContext,
      tokenOpportunity,
      upOpportunity,
      downOpportunity,
      recommendedSideScore: tokenOpportunity.tpBeforeSlScore,
      contestabilityScore: barrierReachability.contestabilityScore,
      tpBeforeSlScore: tokenOpportunity.tpBeforeSlScore,
      entryQualityScore: tokenOpportunity.entryQualityScore,
      hasExecutionOpportunity: predictionResponse.isExecutionEligible,
      executionBlockingReasons: predictionResponse.executionBlockingReasons,
      wasExecuted: predictionResponse.wasExecuted,
      selectedOpportunityCombo: this.buildSelectedOpportunityComboFromSelected(
        predictionResponse.selectedCombo,
        targetSide,
        tokenOpportunity,
        barrierReachability,
      ),
      factors,
      result: this.buildOpportunityOutcome(predictionResponse),
    };
    return opportunityResponse;
  }

  private buildMarketOpportunitySummary(state: MarketOpportunityState, selectedOpportunityCombo: SelectedOpportunityCombo | null): MarketOpportunitySummary {
    const selectedTokenOpportunity =
      state.recommendedSide === "down"
        ? state.downOpportunity
        : state.recommendedSide === "up"
          ? state.upOpportunity
          : state.upOpportunity.tpBeforeSlScore >= state.downOpportunity.tpBeforeSlScore
            ? state.upOpportunity
            : state.downOpportunity;
    const marketOpportunitySummary: MarketOpportunitySummary = {
      marketKey: state.marketKey,
      asset: state.asset,
      window: state.window,
      windowState: state.windowState,
      barrierReachability: state.barrierReachability,
      anchorContext: state.anchorContext,
      recommendedSide: state.recommendedSide,
      recommendedSideScore: state.recommendedSideScore,
      hasOpportunity: state.hasOpportunity,
      reason: state.reason,
      currentTokenPrice: selectedTokenOpportunity.livePrice,
      tpDistance: selectedTokenOpportunity.tpDistance,
      slDistance: selectedTokenOpportunity.slDistance,
      tpBeforeSlScore: selectedTokenOpportunity.tpBeforeSlScore,
      contestabilityScore: state.barrierReachability.contestabilityScore,
      entryQualityScore: selectedTokenOpportunity.entryQualityScore,
      selectedOpportunityCombo,
    };
    return marketOpportunitySummary;
  }

  /**
   * @section public:methods
   */

  public handleSnapshot(): void {
    const marketKeys = SUPPORTED_ASSETS.flatMap((asset) => SUPPORTED_WINDOWS.map((window) => this.buildMarketKey(asset, window)));
    const comboBoards = this.predictionEngineService.getMarketComboBoards(marketKeys);
    const comboBoardsByMarketKey = new Map(comboBoards.map((comboBoard) => [comboBoard.marketKey, comboBoard]));
    for (const marketKey of marketKeys) {
      const predictionContext = this.marketStateService.getContinuousPredictionContext(marketKey);
      if (predictionContext !== null) {
        const evaluationResult = this.strategyEngineService.evaluate(predictionContext);
        const factors = this.opportunityStateService.buildFactorSignals(predictionContext, evaluationResult.strategyBreakdown);
        const state = this.opportunityStateService.buildMarketOpportunityState(predictionContext, factors);
        const latestPrediction = this.predictionEngineService.getLatestPrediction(predictionContext.asset, predictionContext.window);
        const comboBoard = comboBoardsByMarketKey.get(marketKey) ?? null;
        const selectedOpportunityCombo =
          comboBoard === null ? null : this.resolveSelectedComboFromSnapshot(comboBoard.comboSearchSnapshot, state, latestPrediction);
        this.opportunityStoreService.setLiveState(marketKey, {
          market: this.buildMarketOpportunitySummary(state, selectedOpportunityCombo),
          state,
          factorBoard: { marketKey, factors },
        });
      } else {
        this.opportunityStoreService.setLiveState(marketKey, null);
      }
    }
  }

  public getMarketOpportunitySummaries(): MarketOpportunitySummary[] {
    const marketOpportunitySummaries = this.opportunityStoreService.getMarketSummaries();
    return marketOpportunitySummaries;
  }

  public getFactorBoards(): OpportunityFactorBoard[] {
    const factorBoards = this.opportunityStoreService.getFactorBoards();
    return factorBoards;
  }

  public getOpportunityFactorSummaries(marketKey?: MarketKey): OpportunityFactorSummary[] {
    const opportunityFactorSummaries = this.getFactorBoards()
      .filter((factorBoard) => marketKey === undefined || factorBoard.marketKey === marketKey)
      .flatMap((factorBoard) => factorBoard.factors);
    return opportunityFactorSummaries;
  }

  public getLatestOpportunity(asset: AssetSymbol, window: MarketWindow): OpportunityResponse | null {
    const latestPrediction = this.predictionEngineService.getLatestPrediction(asset, window);
    const latestOpportunity = latestPrediction === null ? null : this.buildHistoricalOpportunityResponse(latestPrediction);
    return latestOpportunity;
  }

  public getOpportunities(asset: AssetSymbol, window: MarketWindow, limit: number): OpportunityResponse[] {
    const opportunities = this.predictionEngineService
      .getPredictions(asset, window, limit)
      .map((predictionResponse) => this.buildHistoricalOpportunityResponse(predictionResponse));
    return opportunities;
  }

  public getRecentOpportunities(limit: number): OpportunityResponse[] {
    const opportunities = this.predictionEngineService
      .getRecentPredictions(limit)
      .map((predictionResponse) => this.buildHistoricalOpportunityResponse(predictionResponse));
    return opportunities;
  }

  public getRecentResolvedOpportunities(limit: number): OpportunityResponse[] {
    const opportunities = this.predictionEngineService
      .getRecentResolvedPredictions(limit)
      .map((predictionResponse) => this.buildHistoricalOpportunityResponse(predictionResponse));
    return opportunities;
  }
}
