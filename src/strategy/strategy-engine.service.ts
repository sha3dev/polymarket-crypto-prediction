/**
 * @section imports:internals
 */

import config from "../config.ts";
import type { PredictionContext, PredictionDirection } from "../market/market.types.ts";
import type { StrategyMetricsService } from "./strategy-metrics.service.ts";
import type {
  EngineCombinationResult,
  EngineId,
  EngineSourceScope,
  SetupType,
  SignalEngineContribution,
  SignalEngineResult,
  StrategyDefinition,
  StrategyEvaluationResult,
  StrategySignal,
  StrategyTier,
} from "./strategy.types.ts";

/**
 * @section class
 */

export class StrategyEngineService {
  /**
   * @section private:attributes
   */

  private readonly strategyMetricsService: StrategyMetricsService;
  private readonly strategyDefinitions: StrategyDefinition[];

  /**
   * @section constructor
   */

  public constructor(strategyMetricsService: StrategyMetricsService) {
    this.strategyMetricsService = strategyMetricsService;
    this.strategyDefinitions = this.createDefinitions();
  }

  /**
   * @section private:methods
   */

  private createDefinitions(): StrategyDefinition[] {
    const strategyDefinitions: StrategyDefinition[] = [
      // --- low tier: always evaluated ---
      { strategyId: "s01", name: "Momentum EWMA", tier: "low", family: "momentum", description: "Short drift continuation.", isComboEligible: true },
      { strategyId: "s02", name: "Token Microprice", tier: "low", family: "microstructure", description: "Top-of-book pressure.", isComboEligible: true },
      { strategyId: "s06", name: "No-Arb Consistency", tier: "low", family: "pricing", description: "Up+down deviation from unity.", isComboEligible: true },
      {
        strategyId: "s07",
        name: "Spread Compression",
        tier: "low",
        family: "microstructure",
        description: "Spread diff plus spot drift.",
        isComboEligible: true,
      },
      { strategyId: "s09", name: "Spot Consensus Momentum", tier: "low", family: "momentum", description: "Cross-venue spot drift.", isComboEligible: true },
      {
        strategyId: "s10",
        name: "Spot Micropressure",
        tier: "low",
        family: "microstructure",
        description: "Aggregated venue imbalance.",
        isComboEligible: true,
      },
      { strategyId: "s14", name: "Chainlink Basis", tier: "low", family: "pricing", description: "Oracle catch-up.", isComboEligible: true },
      {
        strategyId: "s15",
        name: "Theoretical Probability Gap",
        tier: "low",
        family: "pricing",
        description: "Oracle-implied vs observed gap.",
        isComboEligible: true,
      },
      { strategyId: "s16", name: "Freshness Gap", tier: "low", family: "pricing", description: "Spot leads stale token.", isComboEligible: true },
      // --- medium tier: evaluated on escalation ---
      {
        strategyId: "s03",
        name: "Token Imbalance Band",
        tier: "medium",
        family: "microstructure",
        description: "Depth ratio pressure.",
        isComboEligible: true,
      },
      { strategyId: "s04", name: "Wall Proximity", tier: "medium", family: "microstructure", description: "Spread-depth wall signal.", isComboEligible: true },
      { strategyId: "s05", name: "Order Book Churn", tier: "medium", family: "microstructure", description: "Book rotation pressure.", isComboEligible: true },
      {
        strategyId: "s08",
        name: "Barrier Timing",
        tier: "medium",
        family: "pricing",
        description: "Chainlink vs price-to-beat proximity.",
        isComboEligible: true,
      },
      {
        strategyId: "s11",
        name: "Spot Dispersion",
        tier: "medium",
        family: "reversion",
        description: "Cross-venue price spread as reversion.",
        isComboEligible: true,
      },
      { strategyId: "s12", name: "Volatility Breakout", tier: "medium", family: "momentum", description: "Regime breakout.", isComboEligible: false },
      {
        strategyId: "s13",
        name: "Spot Slippage Skew",
        tier: "medium",
        family: "microstructure",
        description: "Venue spread skew direction.",
        isComboEligible: true,
      },
      {
        strategyId: "s17",
        name: "Regime Switch",
        tier: "medium",
        family: "momentum",
        description: "Conditional momentum or reversion.",
        isComboEligible: true,
      },
      { strategyId: "s18", name: "Liquidity Shock Fade", tier: "medium", family: "reversion", description: "Short mean reversion.", isComboEligible: true },
      {
        strategyId: "s21",
        name: "Cross-Asset Breadth Impulse",
        tier: "medium",
        family: "cross_asset",
        description: "Market-wide breadth confirmation, not primary conviction.",
        isComboEligible: false,
      },
      // --- high tier: evaluated only on strong escalation ---
      {
        strategyId: "s19",
        name: "Recent Performance Hedge",
        tier: "high",
        family: "momentum",
        description: "Meta signal from prior strategy consensus.",
        isComboEligible: false,
      },
      {
        strategyId: "s20",
        name: "Online Logistic Blend",
        tier: "high",
        family: "momentum",
        description: "Weighted blend of core strategies plus prior bias.",
        isComboEligible: false,
      },
      {
        strategyId: "s22",
        name: "Anchor Follow Catch-Up",
        tier: "high",
        family: "cross_asset",
        description: "Follow lagging asset after BTC and ETH impulse.",
        isComboEligible: false,
      },
      {
        strategyId: "s23",
        name: "BTC Trend Reversal Confirmation",
        tier: "high",
        family: "momentum",
        description: "BTC flips and followers start confirming the new side.",
        isComboEligible: false,
      },
      // --- new: spot-token divergence ---
      {
        strategyId: "s24",
        name: "Spot-Token Divergence",
        tier: "low",
        family: "pricing",
        description: "Spot price moved but token midpoint lags behind.",
        isComboEligible: true,
      },
    ];
    return strategyDefinitions;
  }

  private isDirectionAlignedWithAnchor(direction: PredictionDirection, context: PredictionContext): boolean {
    const breadthDirection = context.crossAssetRegime.breadthDirection;
    const isDirectionAlignedWithAnchor = breadthDirection === "NEUTRAL" || breadthDirection === direction;
    return isDirectionAlignedWithAnchor;
  }

  private computeSnapshotUtility(rawScore: number, confidence: number, weight: number, direction: PredictionDirection, context: PredictionContext): number {
    const anchorAlignmentMultiplier = this.isDirectionAlignedWithAnchor(direction, context) ? 1 : 0.55;
    const normalizedMagnitude = Math.max(0, Math.min(1, Math.abs(rawScore)));
    const normalizedWeight = Math.max(0, Math.min(1, weight));
    const snapshotUtility =
      (normalizedMagnitude * 0.45 + confidence * 0.25 + normalizedWeight * 0.2 + context.current.quality.score * 0.1) * anchorAlignmentMultiplier;
    return snapshotUtility;
  }

  private evaluateTier(tier: StrategyTier, context: PredictionContext, priorSignals: StrategySignal[]): StrategySignal[] {
    const strategySignals: StrategySignal[] = [];
    for (const definition of this.strategyDefinitions.filter((strategyDefinition) => strategyDefinition.tier === tier)) {
      strategySignals.push(this.evaluateDefinition(definition, context, priorSignals));
    }
    return strategySignals;
  }

  private evaluateDefinition(definition: StrategyDefinition, context: PredictionContext, priorSignals: StrategySignal[]): StrategySignal {
    const rawScore = this.computeScore(definition.strategyId, context, priorSignals);
    const qualityFactor = context.current.quality.score;
    const weightedScore = rawScore * qualityFactor;
    const direction: PredictionDirection = weightedScore >= 0 ? "UP" : "DOWN";
    const rawConfidence = 0.5 + Math.min(0.49, Math.abs(weightedScore));
    const confidence = Math.max(0.5, Math.min(0.99, rawConfidence));
    const weight = this.strategyMetricsService.getMarketWeight(definition.strategyId, context.marketKey);
    const snapshotUtility = this.computeSnapshotUtility(weightedScore, confidence, weight, direction, context);
    return {
      strategyId: definition.strategyId,
      name: definition.name,
      tier: definition.tier,
      family: definition.family,
      direction,
      score: weightedScore,
      confidence,
      weight,
      snapshotUtility,
      qualityFactor,
      didRun: qualityFactor > 0,
      didParticipate: qualityFactor > 0,
      isComboEligible: definition.isComboEligible,
      reason: qualityFactor > 0 ? null : "quality_gate",
      debug: this.buildDebug(definition.strategyId, context, priorSignals, weightedScore),
    };
  }

  private aggregateSignals(
    strategySignals: StrategySignal[],
    qualityScore: number,
  ): Pick<StrategyEvaluationResult, "finalDirection" | "finalConfidence" | "weightedScore" | "strategyBreakdown"> {
    const participantSignals = strategySignals.filter((strategySignal) => strategySignal.didParticipate);
    const totalWeight = participantSignals.reduce((aggregatedWeight, strategySignal) => aggregatedWeight + strategySignal.weight, 0);
    const weightedScore =
      totalWeight === 0
        ? 0
        : participantSignals.reduce((aggregatedScore, strategySignal) => aggregatedScore + strategySignal.score * strategySignal.weight, 0) / totalWeight;
    const finalDirection: PredictionDirection = weightedScore >= 0 ? "UP" : "DOWN";
    const rawConfidence = 0.5 + Math.min(0.49, Math.abs(weightedScore) * Math.max(0.2, qualityScore));
    const finalConfidence = Math.max(0.5, Math.min(0.99, rawConfidence));
    return { finalDirection, finalConfidence, weightedScore, strategyBreakdown: strategySignals };
  }

  private buildEngineStrategyIds(engineId: EngineId): string[] {
    let memberStrategyIds: string[] = [];
    if (engineId === "breadth_engine") {
      memberStrategyIds = ["s07", "s17", "s21"];
    }
    if (engineId === "propagation_engine") {
      memberStrategyIds = ["s04", "s16", "s22"];
    }
    if (engineId === "local_momentum_engine") {
      memberStrategyIds = ["s01", "s09", "s12", "s17"];
    }
    if (engineId === "local_microstructure_engine") {
      memberStrategyIds = ["s02", "s03", "s05", "s07", "s10", "s13"];
    }
    if (engineId === "mispricing_engine") {
      memberStrategyIds = ["s06", "s08", "s14", "s15", "s16", "s24"];
    }
    if (engineId === "reversion_engine") {
      memberStrategyIds = ["s11", "s13", "s18"];
    }
    if (engineId === "meta_engine") {
      memberStrategyIds = ["s19", "s20"];
    }
    return memberStrategyIds;
  }

  private buildEngineName(engineId: EngineId): string {
    let engineName = "Meta Engine";
    if (engineId === "breadth_engine") {
      engineName = "Cross-Asset Breadth";
    }
    if (engineId === "propagation_engine") {
      engineName = "Leader-Laggard Propagation";
    }
    if (engineId === "local_momentum_engine") {
      engineName = "Local Momentum";
    }
    if (engineId === "local_microstructure_engine") {
      engineName = "Local Microstructure";
    }
    if (engineId === "mispricing_engine") {
      engineName = "Mispricing / Basis";
    }
    if (engineId === "reversion_engine") {
      engineName = "Mean Reversion";
    }
    return engineName;
  }

  private buildDefaultSetup(engineId: EngineId): SetupType {
    let setupType: SetupType = "research_probe";
    if (engineId === "breadth_engine") {
      setupType = "broad_continuation";
    }
    if (engineId === "propagation_engine") {
      setupType = "leader_laggard_catchup";
    }
    if (engineId === "local_momentum_engine") {
      setupType = "local_breakout_confirmed";
    }
    if (engineId === "mispricing_engine") {
      setupType = "mispricing_repricing";
    }
    if (engineId === "reversion_engine") {
      setupType = "fade_failed_cross";
    }
    return setupType;
  }

  private buildSourceScope(engineId: EngineId): EngineSourceScope {
    let sourceScope: EngineSourceScope = "meta";
    if (engineId === "breadth_engine" || engineId === "propagation_engine") {
      sourceScope = "cross_asset";
    }
    if (
      engineId === "local_momentum_engine" ||
      engineId === "local_microstructure_engine" ||
      engineId === "mispricing_engine" ||
      engineId === "reversion_engine"
    ) {
      sourceScope = "local";
    }
    return sourceScope;
  }

  private computeMemberContributions(memberSignals: StrategySignal[]): SignalEngineContribution[] {
    const totalWeight = memberSignals.reduce((aggregatedWeight, strategySignal) => aggregatedWeight + strategySignal.weight, 0);
    const memberContributions = memberSignals.map((strategySignal) => {
      const signedContribution = totalWeight === 0 ? 0 : (strategySignal.score * strategySignal.weight) / totalWeight;
      return {
        strategyId: strategySignal.strategyId,
        strategyName: strategySignal.name,
        score: strategySignal.score,
        weight: strategySignal.weight,
        signedContribution,
      };
    });
    return memberContributions;
  }

  private computeEngineBias(engineId: EngineId, context: PredictionContext): number {
    const directionSign = context.crossAssetRegime.breadthDirection === "UP" ? 1 : context.crossAssetRegime.breadthDirection === "DOWN" ? -1 : 0;
    let engineBias = 0;
    if (engineId === "breadth_engine") {
      // Synchrony + acceleration amplify breadth signal; exhaustion dampens it
      const exhaustionDampen = Math.max(0.35, 1 - context.crossAssetRegime.exhaustionScore * 0.5);
      engineBias =
        directionSign *
        (context.crossAssetRegime.breadthStrength * 0.45 +
          context.crossAssetRegime.synchronyScore * 0.25 +
          context.crossAssetRegime.accelerationScore * 0.15 +
          context.crossAssetRegime.followerParticipation * 0.1) *
        exhaustionDampen;
    }
    if (engineId === "propagation_engine") {
      // Follower participation confirms the catch-up thesis
      const followerConfirmation = 1 + context.crossAssetRegime.followerParticipation * 0.3;
      engineBias =
        context.crossAssetRegime.hasEthAlignment && context.crossAssetRegime.lagRatio >= config.CROSS_ASSET_LAGGARD_THRESHOLD && directionSign !== 0
          ? directionSign * (context.crossAssetRegime.lagRatio * 0.8 + context.crossAssetRegime.breadthStrength * 0.4) * followerConfirmation
          : 0;
    }
    if (engineId === "local_momentum_engine") {
      engineBias = context.current.spotMomentum * 8;
    }
    if (engineId === "local_microstructure_engine") {
      engineBias = context.current.up.imbalance - context.current.down.imbalance;
    }
    if (engineId === "mispricing_engine") {
      // Bias should REINFORCE the pricing signal, not invert it
      engineBias = this.scoreChainlinkBasis(context) * 1.2 + this.scoreTheoreticalProbabilityGap(context) * 0.7;
    }
    if (engineId === "reversion_engine") {
      engineBias = this.scoreLiquidityShockFade(context) + context.crossAssetRegime.reversalRiskScore * 0.25;
    }
    if (engineId === "meta_engine") {
      engineBias = context.current.quality.score - 0.5;
    }
    return engineBias;
  }

  private computeEngineRegimeFit(engineId: EngineId, context: PredictionContext, direction: PredictionDirection): number {
    const crossAssetRegime = context.crossAssetRegime;
    const isDirectionAligned = crossAssetRegime.breadthDirection === "NEUTRAL" ? true : crossAssetRegime.breadthDirection === direction;
    let regimeFit = 0.85;
    if (engineId === "breadth_engine") {
      // High synchrony + follower participation make breadth more reliable
      regimeFit = crossAssetRegime.isDirectional
        ? 0.88 + crossAssetRegime.breadthStrength * 0.2 + crossAssetRegime.synchronyScore * 0.12 + crossAssetRegime.followerParticipation * 0.08
        : 0.35;
    }
    if (engineId === "propagation_engine") {
      regimeFit =
        crossAssetRegime.hasEthAlignment && crossAssetRegime.lagRatio >= config.CROSS_ASSET_LAGGARD_THRESHOLD
          ? 1.1 + crossAssetRegime.lagRatio * 0.35
          : crossAssetRegime.isDirectional
            ? 0.7
            : 0.3;
    }
    if (engineId === "local_momentum_engine") {
      // Exhaustion dampens momentum engine: fading breadth makes momentum less reliable
      const exhaustionDampen = crossAssetRegime.exhaustionScore > 0.6 ? 0.85 : 1;
      regimeFit =
        crossAssetRegime.regimeClass === "reversal" ? 0.55 : isDirectionAligned ? (1 + crossAssetRegime.breadthStrength * 0.2) * exhaustionDampen : 0.72;
    }
    if (engineId === "local_microstructure_engine") {
      regimeFit = context.current.quality.score >= 0.75 ? 0.95 : 0.65;
    }
    if (engineId === "mispricing_engine") {
      regimeFit = (crossAssetRegime.regimeClass === "anchor" || crossAssetRegime.regimeClass === "aligned") && isDirectionAligned ? 0.78 : 1.02;
    }
    if (engineId === "reversion_engine") {
      // Reversion should only be active in reversal/fragmented regimes; strongly suppress in trending markets
      regimeFit =
        crossAssetRegime.regimeClass === "reversal" || crossAssetRegime.regimeClass === "fragmented" ? 1.15 : crossAssetRegime.hasStrongBreadth ? 0.3 : 0.4;
    }
    if (engineId === "meta_engine") {
      regimeFit = 0.92 + context.current.quality.score * 0.12;
    }
    return regimeFit;
  }

  private resolveEngineState(score: number, confidence: number, regimeFit: number): SignalEngineResult["state"] {
    let state: SignalEngineResult["state"] = "inactive";
    if (regimeFit < 0.4 || confidence < 0.52) {
      state = "avoid";
    } else {
      if (Math.abs(score) >= 0.34 && confidence >= 0.66) {
        state = "dominant";
      } else {
        if (Math.abs(score) >= 0.18 && confidence >= 0.58) {
          state = "active";
        } else {
          if (Math.abs(score) >= 0.08) {
            state = "weak";
          }
        }
      }
    }
    return state;
  }

  private buildEngineResult(engineId: EngineId, strategySignals: StrategySignal[], context: PredictionContext): SignalEngineResult {
    const memberStrategyIds = this.buildEngineStrategyIds(engineId);
    const memberSignals = strategySignals.filter((strategySignal) => memberStrategyIds.includes(strategySignal.strategyId));
    const totalWeight = memberSignals.reduce((aggregatedWeight, strategySignal) => aggregatedWeight + strategySignal.weight, 0);
    const baseScore =
      totalWeight === 0
        ? 0
        : memberSignals.reduce((aggregatedScore, strategySignal) => aggregatedScore + strategySignal.score * strategySignal.weight, 0) / totalWeight;
    const biasedScore = baseScore + this.computeEngineBias(engineId, context);
    const direction: PredictionDirection = biasedScore >= 0 ? "UP" : "DOWN";
    const regimeFit = this.computeEngineRegimeFit(engineId, context, direction);
    const score = biasedScore * regimeFit;
    const confidence = Math.max(0.5, Math.min(0.99, 0.5 + Math.abs(score) * 0.45));
    const state = this.resolveEngineState(score, confidence, regimeFit);
    const isActive = state === "weak" || state === "active" || state === "dominant";
    return {
      engineId,
      name: this.buildEngineName(engineId),
      setupType: this.buildDefaultSetup(engineId),
      direction,
      score,
      confidence,
      isActive,
      state,
      activationReason: isActive ? `${context.crossAssetRegime.regimeId} fit ${regimeFit.toFixed(2)}` : null,
      blockingReason: isActive ? null : `regime fit ${regimeFit.toFixed(2)} too weak`,
      regimeFit,
      memberStrategyIds,
      memberContributions: this.computeMemberContributions(memberSignals),
      sourceScope: this.buildSourceScope(engineId),
    };
  }

  private buildEngineBreakdown(strategySignals: StrategySignal[], context: PredictionContext): SignalEngineResult[] {
    const engineIds: EngineId[] = [
      "breadth_engine",
      "propagation_engine",
      "local_momentum_engine",
      "local_microstructure_engine",
      "mispricing_engine",
      "reversion_engine",
      "meta_engine",
    ];
    const engineBreakdown = engineIds.map((engineId) => this.buildEngineResult(engineId, strategySignals, context));
    return engineBreakdown;
  }

  private requireEngineResult(engineBreakdown: SignalEngineResult[], engineId: EngineId): SignalEngineResult | null {
    const signalEngineResult = engineBreakdown.find((engineResult) => engineResult.engineId === engineId) ?? null;
    return signalEngineResult;
  }

  private buildCombinationCandidates(engineBreakdown: SignalEngineResult[], context: PredictionContext): EngineCombinationResult[] {
    const candidateProfiles: Array<{ setupType: SetupType; engineIds: EngineId[]; reason: string }> = [
      {
        setupType: "broad_continuation",
        engineIds: ["breadth_engine", "local_momentum_engine", "local_microstructure_engine"],
        reason: "global breadth leads continuation",
      },
      {
        setupType: "leader_laggard_catchup",
        engineIds: ["breadth_engine", "propagation_engine", "local_momentum_engine"],
        reason: "leaders move first, laggard catches up",
      },
      {
        setupType: "local_breakout_confirmed",
        engineIds: ["local_momentum_engine", "local_microstructure_engine", "meta_engine"],
        reason: "local continuation confirmed by structure",
      },
      { setupType: "mispricing_repricing", engineIds: ["mispricing_engine", "meta_engine"], reason: "basis and theoretical gap point to repricing" },
      {
        setupType: "fade_failed_cross",
        engineIds: ["reversion_engine", "local_microstructure_engine", "meta_engine"],
        reason: "cross looks exhausted and fades",
      },
    ];
    const candidateResults: EngineCombinationResult[] = [];
    for (const candidateProfile of candidateProfiles) {
      const memberEngines = candidateProfile.engineIds
        .map((engineId) => this.requireEngineResult(engineBreakdown, engineId))
        .filter((engineResult) => engineResult?.isActive) as SignalEngineResult[];
      if (memberEngines.length >= Math.min(2, candidateProfile.engineIds.length)) {
        candidateResults.push(this.buildCombinationResult(candidateProfile.setupType, memberEngines, candidateProfile.reason, context));
      }
    }
    if (candidateResults.length === 0) {
      const fallbackEngine = [...engineBreakdown].sort((leftEngine, rightEngine) => Math.abs(rightEngine.score) - Math.abs(leftEngine.score))[0];
      if (fallbackEngine) {
        candidateResults.push(this.buildCombinationResult("research_probe", [fallbackEngine], "fallback research probe", context));
      }
    }
    return candidateResults;
  }

  private computeDiversityScore(memberEngines: SignalEngineResult[]): number {
    const sourceScopes = [...new Set(memberEngines.map((engineResult) => engineResult.sourceScope))];
    const diversityScore = sourceScopes.length / Math.max(1, memberEngines.length);
    return diversityScore;
  }

  private computeSetupRegimeFit(setupType: SetupType, context: PredictionContext, direction: PredictionDirection): number {
    const crossAssetRegime = context.crossAssetRegime;
    const isDirectionAligned = crossAssetRegime.breadthDirection === "NEUTRAL" ? true : crossAssetRegime.breadthDirection === direction;
    let regimeFitScore = 0.8;
    if (setupType === "broad_continuation") {
      regimeFitScore =
        (crossAssetRegime.regimeClass === "anchor" || crossAssetRegime.regimeClass === "aligned") && isDirectionAligned
          ? 1.1 + crossAssetRegime.breadthStrength * 0.35
          : 0.3;
    }
    if (setupType === "leader_laggard_catchup") {
      regimeFitScore =
        crossAssetRegime.hasEthAlignment && crossAssetRegime.lagRatio >= config.CROSS_ASSET_LAGGARD_THRESHOLD ? 1.15 + crossAssetRegime.lagRatio * 0.2 : 0.35;
    }
    if (setupType === "local_breakout_confirmed") {
      regimeFitScore = crossAssetRegime.regimeClass === "reversal" ? 0.45 : isDirectionAligned ? 1 : 0.75;
    }
    if (setupType === "mispricing_repricing") {
      regimeFitScore = (crossAssetRegime.regimeClass === "anchor" || crossAssetRegime.regimeClass === "aligned") && !isDirectionAligned ? 0.68 : 1;
    }
    if (setupType === "fade_failed_cross") {
      regimeFitScore = crossAssetRegime.regimeClass === "reversal" || crossAssetRegime.regimeClass === "fragmented" ? 1.08 : 0.55;
    }
    return regimeFitScore;
  }

  private buildCombinationResult(
    setupType: SetupType,
    memberEngines: SignalEngineResult[],
    reason: string,
    context: PredictionContext,
  ): EngineCombinationResult {
    const rawScore = memberEngines.reduce((aggregatedScore, engineResult) => aggregatedScore + engineResult.score, 0) / Math.max(1, memberEngines.length);
    const direction: PredictionDirection = rawScore >= 0 ? "UP" : "DOWN";
    const diversityScore = this.computeDiversityScore(memberEngines);
    const regimeFitScore = this.computeSetupRegimeFit(setupType, context, direction);
    const score = rawScore * (0.85 + diversityScore * 0.3) * regimeFitScore;
    const confidence = Math.max(0.5, Math.min(0.99, 0.5 + Math.abs(score) * 0.42));
    const comboKey = memberEngines.map((engineResult) => engineResult.engineId).join("+");
    return {
      comboKey,
      engineIds: memberEngines.map((engineResult) => engineResult.engineId),
      setupType,
      direction,
      score,
      confidence,
      diversityScore,
      regimeFitScore,
      reason,
    };
  }

  private selectWinningCombination(candidateResults: EngineCombinationResult[]): EngineCombinationResult {
    const winningCombination = [...candidateResults].sort((leftCandidate, rightCandidate) => {
      const scoreDelta = Math.abs(rightCandidate.score) - Math.abs(leftCandidate.score);
      let comparatorResult = rightCandidate.diversityScore - leftCandidate.diversityScore;
      if (scoreDelta !== 0) {
        comparatorResult = scoreDelta;
      }
      return comparatorResult;
    })[0] as EngineCombinationResult;
    return winningCombination;
  }

  private shouldEscalate(finalConfidence: number, weightedScore: number): boolean {
    const shouldEscalate =
      finalConfidence < config.ENSEMBLE_MEDIUM_CONFIDENCE_THRESHOLD || Math.abs(weightedScore) < config.ENSEMBLE_SCORE_ESCALATION_THRESHOLD;
    return shouldEscalate;
  }

  private buildDebug(
    strategyId: string,
    context: PredictionContext,
    priorSignals: StrategySignal[],
    weightedScore: number,
  ): Record<string, number | string | boolean | null> {
    const latestHistory = context.history[context.history.length - 1] ?? null;
    return {
      qualityScore: context.current.quality.score,
      upMidpoint: context.current.up.midpoint,
      downMidpoint: context.current.down.midpoint,
      spotConsensusPrice: context.current.spotConsensusPrice,
      priceToBeat: context.current.priceToBeat,
      historySize: context.history.length,
      priorSignalCount: priorSignals.length,
      lastQualityScore: latestHistory?.qualityScore ?? null,
      breadthDirection: context.crossAssetRegime.breadthDirection,
      breadthStrength: context.crossAssetRegime.breadthStrength,
      lagRatio: context.crossAssetRegime.lagRatio,
      normalizedAffordability: this.computeNormalizedAffordability(context),
      finalScoreHint: weightedScore,
      strategyId,
    };
  }

  private computeScore(strategyId: string, context: PredictionContext, priorSignals: StrategySignal[]): number {
    let score = 0;
    if (strategyId === "s01") {
      score = this.scoreMomentumEwma(context);
    }
    if (strategyId === "s02") {
      score = this.scoreTokenMicroprice(context);
    }
    if (strategyId === "s03") {
      score = this.scoreTokenImbalanceBand(context);
    }
    if (strategyId === "s04") {
      score = this.scoreWallProximity(context);
    }
    if (strategyId === "s05") {
      score = this.scoreOrderBookChurn(context);
    }
    if (strategyId === "s06") {
      score = this.scoreNoArbConsistency(context);
    }
    if (strategyId === "s07") {
      score = this.scoreSpreadCompression(context);
    }
    if (strategyId === "s08") {
      score = this.scoreBarrierTiming(context);
    }
    if (strategyId === "s09") {
      score = this.scoreSpotConsensusMomentum(context);
    }
    if (strategyId === "s10") {
      score = this.scoreSpotMicropressure(context);
    }
    if (strategyId === "s11") {
      score = this.scoreSpotDispersion(context);
    }
    if (strategyId === "s12") {
      score = this.scoreVolatilityBreakout(context);
    }
    if (strategyId === "s13") {
      score = this.scoreSpotSlippageSkew(context);
    }
    if (strategyId === "s14") {
      score = this.scoreChainlinkBasis(context);
    }
    if (strategyId === "s15") {
      score = this.scoreTheoreticalProbabilityGap(context);
    }
    if (strategyId === "s16") {
      score = this.scoreFreshnessGap(context);
    }
    if (strategyId === "s17") {
      score = this.scoreRegimeSwitch(context);
    }
    if (strategyId === "s18") {
      score = this.scoreLiquidityShockFade(context);
    }
    if (strategyId === "s19") {
      score = this.scoreRecentPerformanceHedge(priorSignals);
    }
    if (strategyId === "s20") {
      score = this.scoreOnlineLogisticBlend(context, priorSignals);
    }
    if (strategyId === "s21") {
      score = this.scoreCrossAssetBreadthImpulse(context);
    }
    if (strategyId === "s22") {
      score = this.scoreLeaderLaggardCatchUp(context);
    }
    if (strategyId === "s23") {
      score = this.scoreBtcTrendReversalConfirmation(context);
    }
    if (strategyId === "s24") {
      score = this.scoreSpotTokenDivergence(context);
    }
    return score;
  }

  private scoreMomentumEwma(context: PredictionContext): number {
    const triggerSide = context.trigger.triggeredToken;
    const recentPrices = context.history
      .slice(-8)
      .map((entry) => (triggerSide === "up" ? (entry.upMidpoint ?? entry.upPrice) : (entry.downMidpoint ?? entry.downPrice)))
      .filter((value): value is number => value !== null);
    let score = 0;
    if (recentPrices.length >= 2) {
      const firstPrice = recentPrices[0] ?? 0;
      const lastPrice = recentPrices[recentPrices.length - 1] ?? 0;
      const averagePrice = recentPrices.reduce((aggregatedPrice, price) => aggregatedPrice + price, 0) / recentPrices.length;
      const rawDrift = averagePrice === 0 ? 0 : (lastPrice - firstPrice) / averagePrice;
      // For "up" token, positive drift means UP; for "down" token, positive drift means DOWN
      // Normalize to UP=positive convention
      score = triggerSide === "up" ? rawDrift : rawDrift * -1;
    }
    score *= this.computeContinuationValidityFactor(context);
    return score;
  }

  private scoreTokenMicroprice(context: PredictionContext): number {
    const score =
      context.current.up.imbalance -
      context.current.down.imbalance +
      (context.current.up.distanceToHalf ?? 0) * -0.2 +
      (context.current.down.distanceToHalf ?? 0) * 0.2;
    return score;
  }

  private scoreTokenImbalanceBand(context: PredictionContext): number {
    const score = (context.current.up.depthTop - context.current.down.depthTop) / Math.max(1, context.current.up.depthTop + context.current.down.depthTop);
    return score;
  }

  private scoreWallProximity(context: PredictionContext): number {
    const score = (context.current.down.spread ?? 0) - (context.current.up.spread ?? 0) + (context.current.up.depthTop - context.current.down.depthTop) * 0.001;
    return score;
  }

  private scoreOrderBookChurn(context: PredictionContext): number {
    const previousEntry = context.history[context.history.length - 2] ?? null;
    const upMidpointChange =
      previousEntry?.upMidpoint === null || previousEntry?.upMidpoint === undefined || context.current.up.midpoint === null
        ? 0
        : context.current.up.midpoint - previousEntry.upMidpoint;
    const downMidpointChange =
      previousEntry?.downMidpoint === null || previousEntry?.downMidpoint === undefined || context.current.down.midpoint === null
        ? 0
        : context.current.down.midpoint - previousEntry.downMidpoint;
    // Self-contained: use imbalance shift as confirmation instead of calling other strategies
    const imbalanceShift = context.current.up.imbalance - context.current.down.imbalance;
    const midpointDelta = upMidpointChange - downMidpointChange;
    const isImbalanceConfirming = Math.sign(midpointDelta) === Math.sign(imbalanceShift) || imbalanceShift === 0;
    const confirmationFactor = isImbalanceConfirming ? Math.max(0.4, Math.min(1, Math.abs(imbalanceShift) + 0.4)) : 0.2;
    const score = midpointDelta * confirmationFactor;
    return score;
  }

  private scoreNoArbConsistency(context: PredictionContext): number {
    const upProbability = context.current.up.midpoint ?? context.current.up.price ?? 0.5;
    const downProbability = context.current.down.midpoint ?? context.current.down.price ?? 0.5;
    const score = 1 - downProbability - upProbability;
    return score * -1;
  }

  private scoreSpreadCompression(context: PredictionContext): number {
    // Spot momentum multiplier reduced from 40 to 12 to stay proportional
    const score = (context.current.down.spread ?? 0) - (context.current.up.spread ?? 0) + context.current.spotMomentum * 12;
    return score;
  }

  private scoreBarrierTiming(context: PredictionContext): number {
    const chainlinkPrice = context.current.chainlinkPrice;
    const priceToBeat = context.current.priceToBeat;
    let score = 0;
    if (chainlinkPrice !== null && priceToBeat !== null && priceToBeat !== 0) {
      score = (chainlinkPrice - priceToBeat) / priceToBeat;
    }
    return score;
  }

  private scoreSpotConsensusMomentum(context: PredictionContext): number {
    // Scale factor reduced from 100 to 18 to keep scores in a comparable range with other strategies
    const score = context.current.spotMomentum * 18 * this.computeContinuationValidityFactor(context);
    return score;
  }

  private scoreSpotMicropressure(context: PredictionContext): number {
    const aggregatedImbalance =
      context.current.spotVenues.reduce((totalImbalance, spotVenue) => totalImbalance + spotVenue.imbalance, 0) /
      Math.max(1, context.current.spotVenues.length);
    return aggregatedImbalance;
  }

  private scoreSpotDispersion(context: PredictionContext): number {
    const score = context.current.spotMomentum >= 0 ? context.current.spotDispersion * -1 : context.current.spotDispersion;
    return score;
  }

  private scoreVolatilityBreakout(context: PredictionContext): number {
    const triggerSide = context.trigger.triggeredToken;
    const recentChanges = context.history.slice(-12).map((entry, index, entries) => {
      const previousEntry = index === 0 ? null : entries[index - 1];
      let change = 0;
      if (triggerSide === "up") {
        if (previousEntry?.upMidpoint !== null && previousEntry?.upMidpoint !== undefined && entry.upMidpoint !== null) {
          change = entry.upMidpoint - previousEntry.upMidpoint;
        }
      } else {
        if (previousEntry?.downMidpoint !== null && previousEntry?.downMidpoint !== undefined && entry.downMidpoint !== null) {
          change = entry.downMidpoint - previousEntry.downMidpoint;
        }
      }
      return change;
    });
    const averageAbsChange = recentChanges.reduce((totalChange, change) => totalChange + Math.abs(change), 0) / Math.max(1, recentChanges.length);
    // Clamp to [-2, 2] to prevent extreme ratios when volatility is tiny
    const rawScore = averageAbsChange === 0 ? 0 : this.scoreMomentumEwma(context) / averageAbsChange;
    const score = Math.max(-2, Math.min(2, rawScore));
    return score;
  }

  private scoreSpotSlippageSkew(context: PredictionContext): number {
    // Compute directional skew: venues with tighter ask-side spreads favor UP, tighter bid-side favor DOWN
    const venueImbalances = context.current.spotVenues.filter((spotVenue) => spotVenue.imbalance !== 0).map((spotVenue) => spotVenue.imbalance);
    const averageImbalance = venueImbalances.length === 0 ? 0 : venueImbalances.reduce((total, imb) => total + imb, 0) / venueImbalances.length;
    const totalSpread = context.current.spotVenues.reduce((total, spotVenue) => total + (spotVenue.spread ?? 0), 0);
    // Combine venue imbalance direction with spread magnitude as a dampener
    const spreadDampen = Math.max(0.3, 1 - totalSpread * 2);
    const score = averageImbalance * spreadDampen;
    return score;
  }

  private scoreChainlinkBasis(context: PredictionContext): number {
    let score = 0;
    if (context.current.chainlinkPrice !== null && context.current.spotConsensusPrice !== null && context.current.chainlinkPrice !== 0) {
      score = ((context.current.spotConsensusPrice - context.current.chainlinkPrice) / context.current.chainlinkPrice) * 12;
    }
    return score;
  }

  private scoreTheoreticalProbabilityGap(context: PredictionContext): number {
    let theoreticalProbability = 0.5;
    if (context.current.chainlinkPrice !== null && context.current.priceToBeat !== null) {
      theoreticalProbability = context.current.chainlinkPrice >= context.current.priceToBeat ? 0.55 : 0.45;
    }
    const observedProbability = context.current.up.midpoint ?? context.current.up.price ?? 0.5;
    return theoreticalProbability - observedProbability;
  }

  private scoreFreshnessGap(context: PredictionContext): number {
    const tokenAge = Math.max(context.current.up.ageMs ?? 0, context.current.down.ageMs ?? 0);
    const bestSpotAge = Math.min(
      ...context.current.spotVenues
        .map((spotVenue) => spotVenue.ageMs)
        .filter((ageMs) => ageMs !== null)
        .map((ageMs) => ageMs as number),
      config.SPOT_MAX_AGE_MS,
    );
    const freshnessGap = tokenAge - bestSpotAge;
    const score = freshnessGap <= 0 ? 0 : context.current.spotMomentum * Math.min(8, freshnessGap / 1000);
    return score;
  }

  private scoreRegimeSwitch(context: PredictionContext): number {
    const isLiquidityStrong = context.current.up.depthTop + context.current.down.depthTop > 40;
    const score = isLiquidityStrong ? this.scoreMomentumEwma(context) : this.scoreLiquidityShockFade(context);
    return score;
  }

  private scoreLiquidityShockFade(context: PredictionContext): number {
    const distanceBias = (context.current.up.distanceToHalf ?? 0.5) - (context.current.down.distanceToHalf ?? 0.5);
    const recentRange = this.computeRecentTriggeredRange(context);
    const moveExtension = this.computeTriggeredMoveExtension(context);
    const affordabilityPenalty = 1 - this.computeNormalizedAffordability(context);
    const reversalBoost = context.crossAssetRegime.reversalRiskScore;
    const hasCrossedHalfTrigger = context.trigger.triggerType === "crossed_half";
    const triggerDirectionSign = context.trigger.triggeredToken === "up" ? 1 : -1;
    const triggeredTokenPrice = this.resolveTriggeredTokenPrice(context);
    // Both up and down tokens trade above 0.50 when winning
    const centeredExtension = Math.max(0, triggeredTokenPrice - 0.5);
    let score = triggerDirectionSign * -1 * (centeredExtension + moveExtension * 0.2) + distanceBias * -0.35;
    if (hasCrossedHalfTrigger) {
      score *= 1.3 + affordabilityPenalty * 0.6 + reversalBoost * 0.45 + Math.min(0.35, recentRange + moveExtension);
    }
    return score;
  }

  private scoreRecentPerformanceHedge(priorSignals: StrategySignal[]): number {
    const averageWeightedConfidence =
      priorSignals.length === 0
        ? 0
        : priorSignals.reduce(
            (aggregatedConfidence, strategySignal) =>
              aggregatedConfidence + (strategySignal.direction === "UP" ? strategySignal.confidence : strategySignal.confidence * -1),
            0,
          ) / priorSignals.length;
    return averageWeightedConfidence;
  }

  private scoreOnlineLogisticBlend(context: PredictionContext, priorSignals: StrategySignal[]): number {
    const priorSignalBias =
      priorSignals.length === 0 ? 0 : priorSignals.reduce((aggregatedScore, strategySignal) => aggregatedScore + strategySignal.score, 0) / priorSignals.length;
    const score =
      this.scoreMomentumEwma(context) * 0.3 +
      this.scoreSpotConsensusMomentum(context) * 0.25 +
      this.scoreTokenMicroprice(context) * 0.2 +
      this.scoreBarrierTiming(context) * 0.15 +
      priorSignalBias * 0.1;
    return score;
  }

  private scoreCrossAssetBreadthImpulse(context: PredictionContext): number {
    const crossAssetRegime = context.crossAssetRegime;
    let score = 0;
    if (crossAssetRegime.breadthDirection !== "NEUTRAL") {
      const breadthDirectionSign = crossAssetRegime.breadthDirection === "UP" ? 1 : -1;
      const alignmentBias =
        Math.sign(crossAssetRegime.targetSignedMove) === 0 ? 0.45 : Math.sign(crossAssetRegime.targetSignedMove) === breadthDirectionSign ? 0.55 : -0.2;
      // Synchrony amplifies: synchronized markets give a stronger signal
      const synchronyMultiplier = 1 + crossAssetRegime.synchronyScore * 0.35;
      // Acceleration boosts: strengthening breadth is more actionable
      const accelerationMultiplier = 1 + crossAssetRegime.accelerationScore * 0.2;
      // Exhaustion dampens: fading breadth reduces the impulse
      const exhaustionDampen = Math.max(0.4, 1 - crossAssetRegime.exhaustionScore * 0.45);
      if (crossAssetRegime.hasStrongBreadth) {
        // Strong breadth: full signal with enriched metrics
        score = breadthDirectionSign * crossAssetRegime.breadthStrength * 0.3 * alignmentBias * synchronyMultiplier * accelerationMultiplier * exhaustionDampen;
      } else {
        // Weak but directional breadth: attenuated signal still provides a directional hint
        score = breadthDirectionSign * crossAssetRegime.breadthStrength * 0.12 * Math.max(0, alignmentBias) * synchronyMultiplier * exhaustionDampen;
      }
    }
    return score;
  }

  private scoreLeaderLaggardCatchUp(context: PredictionContext): number {
    const crossAssetRegime = context.crossAssetRegime;
    let score = 0;
    if (
      crossAssetRegime.hasEthAlignment &&
      crossAssetRegime.lagRatio >= config.CROSS_ASSET_LAGGARD_THRESHOLD &&
      crossAssetRegime.breadthDirection !== "NEUTRAL"
    ) {
      const breadthDirectionSign = crossAssetRegime.breadthDirection === "UP" ? 1 : -1;
      score = breadthDirectionSign * Math.min(1, crossAssetRegime.breadthStrength * Math.max(0.6, crossAssetRegime.lagRatio * 1.4));
    }
    return score;
  }

  private scoreBtcTrendReversalConfirmation(context: PredictionContext): number {
    const currentTriggerType = context.trigger.triggerType;
    const crossAssetRegime = context.crossAssetRegime;
    const btcTriggeredMomentum = context.trigger.triggeredToken === "up" ? crossAssetRegime.btcUpTokenMomentum : crossAssetRegime.btcDownTokenMomentum;
    const btcOppositeMomentum = context.trigger.triggeredToken === "up" ? crossAssetRegime.btcDownTokenMomentum : crossAssetRegime.btcUpTokenMomentum;
    const assetMultiplier = context.asset === "btc" ? 0.55 : context.asset === "eth" ? 1 : 1.1;
    const reversalEdge = Math.max(0, btcTriggeredMomentum - btcOppositeMomentum);
    let score = 0;
    if (currentTriggerType === "btc_trend_reversal" || currentTriggerType === "btc_local_reversal") {
      score = reversalEdge * 28 * assetMultiplier;
    }
    return score;
  }

  private scoreSpotTokenDivergence(context: PredictionContext): number {
    // Detects when spot consensus has moved but the up-token midpoint hasn't caught up
    const spotPrice = context.current.spotConsensusPrice;
    const priceToBeat = context.current.priceToBeat;
    const upTokenMidpoint = context.current.up.midpoint ?? context.current.up.price;
    let score = 0;
    if (spotPrice !== null && priceToBeat !== null && upTokenMidpoint !== null && priceToBeat !== 0) {
      // Implied probability from spot: if spot > priceToBeat, up-token should trade higher
      const spotImpliedDirection = spotPrice >= priceToBeat ? 1 : -1;
      const spotDistanceFromBarrier = Math.abs(spotPrice - priceToBeat) / priceToBeat;
      // How far is the token from reflecting the spot signal
      const tokenDeviation = spotImpliedDirection === 1 ? Math.max(0, 0.55 - upTokenMidpoint) : Math.max(0, upTokenMidpoint - 0.45);
      // Only fire if there's meaningful spot movement AND the token hasn't caught up
      const hasSpotSignal = spotDistanceFromBarrier >= 0.002;
      const hasTokenLag = tokenDeviation >= 0.01;
      if (hasSpotSignal && hasTokenLag) {
        score = spotImpliedDirection * Math.min(0.6, spotDistanceFromBarrier * 8 + tokenDeviation * 3);
      }
    }
    return score;
  }

  private resolveTriggeredTokenPrice(context: PredictionContext): number {
    const triggerSide = context.trigger.triggeredToken;
    const tokenPrice =
      triggerSide === "up"
        ? (context.current.up.midpoint ?? context.current.up.price ?? 0.5)
        : (context.current.down.midpoint ?? context.current.down.price ?? 0.5);
    return tokenPrice;
  }

  private computeNormalizedAffordability(context: PredictionContext): number {
    const tokenPrice = this.resolveTriggeredTokenPrice(context);
    const idealEntryFloor = 0.2;
    // Fixed ceiling independent of TP delta — tokens above 0.75 are genuinely too expensive
    const affordableCeiling = 0.75;
    const affordableRange = Math.max(0.01, affordableCeiling - idealEntryFloor);
    const normalizedAffordability = Math.max(0, Math.min(1, (affordableCeiling - tokenPrice) / affordableRange));
    return normalizedAffordability;
  }

  private computeRecentTriggeredRange(context: PredictionContext): number {
    const triggerSide = context.trigger.triggeredToken;
    const recentTriggeredPrices = context.history
      .slice(-8)
      .map((historyEntry) => {
        return triggerSide === "up" ? (historyEntry.upMidpoint ?? historyEntry.upPrice) : (historyEntry.downMidpoint ?? historyEntry.downPrice);
      })
      .filter((historyPrice) => historyPrice !== null) as number[];
    let recentTriggeredRange = 0;
    if (recentTriggeredPrices.length >= 2) {
      const minimumTriggeredPrice = Math.min(...recentTriggeredPrices);
      const maximumTriggeredPrice = Math.max(...recentTriggeredPrices);
      recentTriggeredRange = maximumTriggeredPrice - minimumTriggeredPrice;
    }
    return recentTriggeredRange;
  }

  private computeTriggeredMoveExtension(context: PredictionContext): number {
    const triggerSide = context.trigger.triggeredToken;
    const currentTriggeredDistance = triggerSide === "up" ? (context.current.up.distanceToHalf ?? 0) : (context.current.down.distanceToHalf ?? 0);
    // Fixed threshold independent of TP delta — a 12-cent move from 0.50 is genuinely extended
    const extensionThreshold = 0.12;
    const normalizedExtension = Math.max(0, Math.min(1, currentTriggeredDistance / extensionThreshold));
    return normalizedExtension;
  }

  private computeContinuationValidityFactor(context: PredictionContext): number {
    const affordability = this.computeNormalizedAffordability(context);
    const reversalPenalty = Math.max(0.3, 1 - context.crossAssetRegime.reversalRiskScore * 0.7);
    const moveExtensionPenalty = Math.max(0.3, 1 - this.computeTriggeredMoveExtension(context) * 0.5);
    // Exhaustion penalty: fading breadth means continuation is less reliable
    const exhaustionPenalty = Math.max(0.4, 1 - context.crossAssetRegime.exhaustionScore * 0.55);
    // Acceleration boost: accelerating breadth strengthens continuation signals
    const accelerationBoost = 1 + context.crossAssetRegime.accelerationScore * 0.2;
    let continuationValidityFactor = (reversalPenalty * 0.3 + moveExtensionPenalty * 0.25 + exhaustionPenalty * 0.2 + affordability * 0.25) * accelerationBoost;
    if (context.trigger.triggerType === "crossed_half") {
      continuationValidityFactor *= Math.max(0.3, 1 - context.crossAssetRegime.reversalRiskScore * 0.35);
    }
    continuationValidityFactor = Math.max(0.15, Math.min(1, continuationValidityFactor));
    return continuationValidityFactor;
  }

  /**
   * @section public:methods
   */

  public getDefinitions(): StrategyDefinition[] {
    return [...this.strategyDefinitions];
  }

  public evaluate(context: PredictionContext): StrategyEvaluationResult {
    const lowSignals = this.evaluateTier("low", context, []);
    const lowAggregate = this.aggregateSignals(lowSignals, context.current.quality.score);
    const shouldEscalateToMedium = this.shouldEscalate(lowAggregate.finalConfidence, lowAggregate.weightedScore);
    const mediumSignals = shouldEscalateToMedium ? this.evaluateTier("medium", context, lowSignals) : [];
    const mediumAggregate = this.aggregateSignals([...lowSignals, ...mediumSignals], context.current.quality.score);
    const shouldEscalateToHigh = this.shouldEscalate(mediumAggregate.finalConfidence, mediumAggregate.weightedScore);
    const highSignals = shouldEscalateToHigh ? this.evaluateTier("high", context, [...lowSignals, ...mediumSignals]) : [];
    const strategyBreakdown = [...lowSignals, ...mediumSignals, ...highSignals];
    const engineBreakdown = this.buildEngineBreakdown(strategyBreakdown, context);
    const candidateResults = this.buildCombinationCandidates(engineBreakdown, context);
    const winningCombination = this.selectWinningCombination(candidateResults);
    return {
      marketKey: context.marketKey,
      finalDirection: winningCombination.direction,
      finalConfidence: winningCombination.confidence,
      weightedScore: winningCombination.score,
      baseWeightedScore: winningCombination.score,
      adjustedWeightedScore: winningCombination.score,
      baseConfidence: winningCombination.confidence,
      adjustedConfidence: winningCombination.confidence,
      strategyBreakdown,
      engineBreakdown,
      winningCombination,
      winningSetupType: winningCombination.setupType,
      winningEngineIds: winningCombination.engineIds,
      winningEngineComboKey: winningCombination.comboKey,
      winningEngineComboScore: winningCombination.score,
      combinationReason: winningCombination.reason,
      qualityScore: context.current.quality.score,
      escalatedToMedium: shouldEscalateToMedium,
      escalatedToHigh: shouldEscalateToHigh,
      context,
    };
  }
}
