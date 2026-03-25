/**
 * @section imports:internals
 */

import config from "../config.ts";
import type { ComboSource } from "../execution/execution.types.ts";
import type { CrossAssetRegime, MarketKey, PredictionDirection } from "../market/market.types.ts";
import type { StrategySignal, StrategySummary } from "../strategy/strategy.types.ts";
import type {
  ComboBreakdown,
  ComboDefinition,
  ComboGateDecision,
  ComboSize,
  ComboSummary,
  ComboUsage,
  MarketComboBoard,
  SelectedStrategyCombo,
} from "./combo.types.ts";

/**
 * @section types
 */

type MetricsSource = "research" | "execution";
type ComboOutcomeEntry = {
  predictionId: string;
  resolvedAt: number | null;
  isAgreement: boolean;
  direction: PredictionDirection | null;
  wasCorrect: boolean | null;
  comboConfidence: number;
  comboPnlProxy: number;
  calibrationError: number;
  bestMemberHitRate: number;
  bestMemberPnlProxy: number;
};

type ActiveComboCandidate = {
  comboDefinition: ComboDefinition;
  comboConfidence: number;
  agreementScore: number;
  isAgreement: boolean;
  direction: PredictionDirection | null;
  memberSignals: StrategySignal[];
};

/**
 * @section class
 */

export class ComboMetricsService {
  /**
   * @section private:attributes
   */

  private readonly researchComboOutcomes: Map<string, ComboOutcomeEntry[]>;
  private readonly executionComboOutcomes: Map<string, ComboOutcomeEntry[]>;
  private readonly latestActiveCombos: Map<MarketKey, ComboUsage[]>;
  private readonly latestAppliedCombos: Map<MarketKey, ComboUsage[]>;
  private readonly latestExecutionComboDecision: Map<MarketKey, ComboGateDecision>;

  /**
   * @section constructor
   */

  public constructor() {
    this.researchComboOutcomes = new Map<string, ComboOutcomeEntry[]>();
    this.executionComboOutcomes = new Map<string, ComboOutcomeEntry[]>();
    this.latestActiveCombos = new Map<MarketKey, ComboUsage[]>();
    this.latestAppliedCombos = new Map<MarketKey, ComboUsage[]>();
    this.latestExecutionComboDecision = new Map<MarketKey, ComboGateDecision>();
  }

  /**
   * @section private:methods
   */

  private createComboStorageKey(marketKey: MarketKey, comboKey: string): string {
    const comboStorageKey = `${marketKey}:${comboKey}`;
    return comboStorageKey;
  }

  private normalizeMemberStrategyIds(memberStrategyIds: string[]): string[] {
    const normalizedMemberStrategyIds = [...memberStrategyIds].sort((leftStrategyId, rightStrategyId) => {
      return leftStrategyId.localeCompare(rightStrategyId);
    });
    return normalizedMemberStrategyIds;
  }

  private createComboKey(memberStrategyIds: string[]): string {
    const comboKey = this.normalizeMemberStrategyIds(memberStrategyIds).join("+");
    return comboKey;
  }

  private createComboDefinition(marketKey: MarketKey, memberStrategyIds: string[]): ComboDefinition {
    const normalizedMemberStrategyIds = this.normalizeMemberStrategyIds(memberStrategyIds);
    const size = normalizedMemberStrategyIds.length as ComboSize;
    return {
      comboKey: this.createComboKey(normalizedMemberStrategyIds),
      marketKey,
      memberStrategyIds: normalizedMemberStrategyIds,
      size,
    };
  }

  private resolveOutcomeStore(source: MetricsSource): Map<string, ComboOutcomeEntry[]> {
    const outcomeStore = source === "research" ? this.researchComboOutcomes : this.executionComboOutcomes;
    return outcomeStore;
  }

  private requireComboOutcomes(marketKey: MarketKey, comboKey: string, source: MetricsSource): ComboOutcomeEntry[] {
    const comboStorageKey = this.createComboStorageKey(marketKey, comboKey);
    const outcomeStore = this.resolveOutcomeStore(source);
    let comboOutcomeEntries = outcomeStore.get(comboStorageKey);
    if (!comboOutcomeEntries) {
      comboOutcomeEntries = [];
      outcomeStore.set(comboStorageKey, comboOutcomeEntries);
    }
    return comboOutcomeEntries;
  }

  private buildActiveComboCandidates(marketKey: MarketKey, strategySignals: StrategySignal[]): ActiveComboCandidate[] {
    const participantSignals = strategySignals
      .filter((strategySignal) => strategySignal.didParticipate)
      .sort((leftSignal, rightSignal) => rightSignal.weight - leftSignal.weight);
    const pairSignals = participantSignals.slice(0, config.COMBO_TOP_STRATEGIES_FOR_PAIRS);
    const trioSignals = participantSignals.slice(0, config.COMBO_TOP_STRATEGIES_FOR_TRIOS);
    const activeComboCandidates: ActiveComboCandidate[] = [];
    activeComboCandidates.push(...this.buildSizeCandidates(marketKey, pairSignals, 2));
    activeComboCandidates.push(...this.buildSizeCandidates(marketKey, trioSignals, 3));
    return activeComboCandidates;
  }

  private buildSizeCandidates(marketKey: MarketKey, sourceSignals: StrategySignal[], comboSize: ComboSize): ActiveComboCandidate[] {
    const activeComboCandidates: ActiveComboCandidate[] = [];
    if (comboSize === 2) {
      for (let firstIndex = 0; firstIndex < sourceSignals.length; firstIndex += 1) {
        for (let secondIndex = firstIndex + 1; secondIndex < sourceSignals.length; secondIndex += 1) {
          const memberSignals = [sourceSignals[firstIndex], sourceSignals[secondIndex]].filter(Boolean) as StrategySignal[];
          activeComboCandidates.push(this.buildCandidateFromMembers(marketKey, memberSignals));
        }
      }
    }
    if (comboSize === 3) {
      for (let firstIndex = 0; firstIndex < sourceSignals.length; firstIndex += 1) {
        for (let secondIndex = firstIndex + 1; secondIndex < sourceSignals.length; secondIndex += 1) {
          for (let thirdIndex = secondIndex + 1; thirdIndex < sourceSignals.length; thirdIndex += 1) {
            const memberSignals = [sourceSignals[firstIndex], sourceSignals[secondIndex], sourceSignals[thirdIndex]].filter(Boolean) as StrategySignal[];
            activeComboCandidates.push(this.buildCandidateFromMembers(marketKey, memberSignals));
          }
        }
      }
    }
    return activeComboCandidates;
  }

  private buildCandidateFromMembers(marketKey: MarketKey, memberSignals: StrategySignal[]): ActiveComboCandidate {
    const directionTallies = new Map<PredictionDirection, number>();
    for (const memberSignal of memberSignals) {
      directionTallies.set(memberSignal.direction, (directionTallies.get(memberSignal.direction) ?? 0) + 1);
    }
    const tallies = [...directionTallies.entries()].sort((leftEntry, rightEntry) => rightEntry[1] - leftEntry[1]);
    const dominantEntry = tallies[0] ?? null;
    const direction = dominantEntry?.[0] ?? null;
    const agreementScore = memberSignals.length === 0 || dominantEntry === null ? 0 : dominantEntry[1] / memberSignals.length;
    const isAgreement = agreementScore === 1;
    const comboConfidence =
      memberSignals.length === 0
        ? 0.5
        : memberSignals.reduce((aggregatedConfidence, strategySignal) => aggregatedConfidence + strategySignal.confidence * strategySignal.weight, 0) /
          Math.max(
            1,
            memberSignals.reduce((aggregatedWeight, strategySignal) => aggregatedWeight + strategySignal.weight, 0),
          );
    return {
      comboDefinition: this.createComboDefinition(
        marketKey,
        memberSignals.map((strategySignal) => strategySignal.strategyId),
      ),
      comboConfidence,
      agreementScore,
      isAgreement,
      direction,
      memberSignals,
    };
  }

  private resolveStrategyFamily(strategyId: string): string {
    let strategyFamily = "meta";
    if (["s01", "s09", "s12", "s17"].includes(strategyId)) {
      strategyFamily = "momentum";
    }
    if (["s02", "s03", "s04", "s05", "s07", "s10", "s13"].includes(strategyId)) {
      strategyFamily = "microstructure";
    }
    if (["s06", "s08", "s14", "s15", "s16"].includes(strategyId)) {
      strategyFamily = "pricing";
    }
    if (["s18"].includes(strategyId)) {
      strategyFamily = "reversion";
    }
    if (["s19", "s20"].includes(strategyId)) {
      strategyFamily = "meta";
    }
    if (["s21", "s22"].includes(strategyId)) {
      strategyFamily = "cross_asset";
    }
    return strategyFamily;
  }

  private computeCandidateDiversityScore(activeComboCandidate: ActiveComboCandidate): number {
    const distinctFamilies = [...new Set(activeComboCandidate.memberSignals.map((memberSignal) => this.resolveStrategyFamily(memberSignal.strategyId)))];
    const diversityScore = distinctFamilies.length / Math.max(1, activeComboCandidate.memberSignals.length);
    return diversityScore;
  }

  private computeAnchorFitScore(marketKey: MarketKey, crossAssetRegime: CrossAssetRegime, direction: PredictionDirection | null): number {
    const asset = marketKey.split(":")[0];
    const predictedDirection = direction ?? "UP";
    const isUpDirection = predictedDirection === "UP";
    const btcMomentum = isUpDirection ? crossAssetRegime.btcUpTokenMomentum : crossAssetRegime.btcDownTokenMomentum;
    const ethMomentum = isUpDirection ? crossAssetRegime.ethUpTokenMomentum : crossAssetRegime.ethDownTokenMomentum;
    let anchorFitScore = 0.75;
    if (asset === "btc") {
      anchorFitScore = 0.9 + crossAssetRegime.breadthStrength * 0.1;
    }
    if (asset === "eth") {
      anchorFitScore = crossAssetRegime.btcDirection === predictedDirection && btcMomentum >= config.CROSS_ASSET_BREADTH_MOVE_THRESHOLD ? 1 : 0.15;
    }
    if (asset === "sol" || asset === "xrp") {
      anchorFitScore =
        crossAssetRegime.btcDirection === predictedDirection &&
        crossAssetRegime.ethDirection === predictedDirection &&
        btcMomentum >= config.CROSS_ASSET_BREADTH_MOVE_THRESHOLD &&
        ethMomentum >= config.CROSS_ASSET_BREADTH_MOVE_THRESHOLD
          ? 1
          : 0.05;
    }
    return anchorFitScore;
  }

  private computeMarketQualityScore(marketQualityScore: number): number {
    const normalizedMarketQualityScore = Math.max(0, Math.min(1, marketQualityScore));
    return normalizedMarketQualityScore;
  }

  private computeExecutionReadinessScore(executionScore: number | null): number {
    const normalizedExecutionReadinessScore = executionScore === null ? 0.35 : Math.max(0, Math.min(1, executionScore));
    return normalizedExecutionReadinessScore;
  }

  private buildSelectedStrategyCombo(
    activeComboCandidate: ActiveComboCandidate,
    comboSummary: ComboSummary,
    crossAssetRegime: CrossAssetRegime,
    marketQualityScore: number,
    executionScore: number | null,
    selectionSource: ComboSource,
  ): SelectedStrategyCombo | null {
    const direction = activeComboCandidate.direction;
    const agreementScore = activeComboCandidate.agreementScore;
    const diversityScore = this.computeCandidateDiversityScore(activeComboCandidate);
    const anchorFitScore = this.computeAnchorFitScore(activeComboCandidate.comboDefinition.marketKey, crossAssetRegime, direction);
    const normalizedQualityScore = this.computeMarketQualityScore(marketQualityScore);
    const executionReadinessScore = this.computeExecutionReadinessScore(executionScore);
    const sampleFloor = activeComboCandidate.comboDefinition.size === 2 ? config.MIN_COMBO_SAMPLES_PAIR : config.MIN_COMBO_SAMPLES_TRIO;
    const sampleScore = Math.max(0, Math.min(1, comboSummary.sampleCount / Math.max(1, sampleFloor)));
    const historicalHitScore = Math.max(0, Math.min(1, comboSummary.hitRate));
    const historicalPnlScore = Math.max(0, Math.min(1, 0.5 + comboSummary.averagePnlProxy));
    const drawdownPenalty = Math.max(0, Math.min(1, comboSummary.maxDrawdownProxy));
    const finalComboScore =
      agreementScore * 0.22 +
      historicalHitScore * 0.14 +
      historicalPnlScore * 0.2 +
      sampleScore * 0.1 +
      diversityScore * 0.08 +
      anchorFitScore * 0.14 +
      normalizedQualityScore * 0.06 +
      executionReadinessScore * 0.06 +
      Math.max(0, comboSummary.effectiveComboScore) * 0.08 -
      drawdownPenalty * 0.08;
    const isResearchEligible = direction !== null && agreementScore >= 0.67 && activeComboCandidate.comboConfidence >= 0.55 && finalComboScore >= 0.45;
    const isExecutionEligible = isResearchEligible && anchorFitScore >= 0.9 && executionReadinessScore >= 0.45 && normalizedQualityScore >= 0.75;
    let selectedStrategyCombo: SelectedStrategyCombo | null = null;
    if (direction !== null) {
      selectedStrategyCombo = {
        comboKey: activeComboCandidate.comboDefinition.comboKey,
        marketKey: activeComboCandidate.comboDefinition.marketKey,
        memberStrategyIds: activeComboCandidate.comboDefinition.memberStrategyIds,
        size: activeComboCandidate.comboDefinition.size,
        direction,
        comboConfidence: activeComboCandidate.comboConfidence,
        comboScore: finalComboScore,
        agreementScore,
        historicalHitRate: comboSummary.hitRate,
        historicalPnlProxy: comboSummary.averagePnlProxy,
        sampleCount: comboSummary.sampleCount,
        drawdownProxy: comboSummary.maxDrawdownProxy,
        diversityScore,
        anchorFitScore,
        marketQualityScore: normalizedQualityScore,
        executionReadinessScore,
        selectionReason: `${selectionSource} ${comboSummary.status} agr ${agreementScore.toFixed(2)} fit ${anchorFitScore.toFixed(2)}`,
        isResearchEligible,
        isExecutionEligible,
        selectionSource,
      };
    }
    return selectedStrategyCombo;
  }

  private compareSelectedCombos(leftCombo: SelectedStrategyCombo, rightCombo: SelectedStrategyCombo): number {
    let comparatorResult = rightCombo.comboScore - leftCombo.comboScore;
    if (comparatorResult === 0) {
      comparatorResult = rightCombo.anchorFitScore - leftCombo.anchorFitScore;
    }
    if (comparatorResult === 0) {
      comparatorResult = rightCombo.diversityScore - leftCombo.diversityScore;
    }
    if (comparatorResult === 0) {
      comparatorResult = rightCombo.sampleCount - leftCombo.sampleCount;
    }
    return comparatorResult;
  }

  private selectBestComboForMarketInternal(
    _marketKey: MarketKey,
    activeComboCandidates: ActiveComboCandidate[],
    crossAssetRegime: CrossAssetRegime,
    marketQualityScore: number,
    executionScore: number | null,
  ): SelectedStrategyCombo | null {
    const scoredCombos: SelectedStrategyCombo[] = [];
    for (const activeComboCandidate of activeComboCandidates) {
      const executionSummary = this.buildSummaryFromDefinition(activeComboCandidate.comboDefinition, "execution");
      const researchSummary = this.buildSummaryFromDefinition(activeComboCandidate.comboDefinition, "research");
      const source = executionSummary.sampleCount > 0 ? "execution" : "research";
      const comboSummary = source === "execution" ? executionSummary : researchSummary;
      const selectedStrategyCombo = this.buildSelectedStrategyCombo(
        activeComboCandidate,
        comboSummary,
        crossAssetRegime,
        marketQualityScore,
        executionScore,
        source,
      );
      if (selectedStrategyCombo?.isResearchEligible) {
        scoredCombos.push(selectedStrategyCombo);
      }
    }
    const selectedStrategyCombo = [...scoredCombos].sort((leftCombo, rightCombo) => this.compareSelectedCombos(leftCombo, rightCombo))[0] ?? null;
    return selectedStrategyCombo;
  }

  private readRollingCutoff(comboOutcomeEntries: ComboOutcomeEntry[]): number | null {
    const latestResolvedAt = comboOutcomeEntries.length === 0 ? null : (comboOutcomeEntries[comboOutcomeEntries.length - 1]?.resolvedAt ?? null);
    const rollingCutoff = latestResolvedAt === null ? null : latestResolvedAt - config.COMBO_ROLLING_WINDOW_SECONDS * 1_000;
    return rollingCutoff;
  }

  private readWindowedOutcomes(comboOutcomeEntries: ComboOutcomeEntry[]): ComboOutcomeEntry[] {
    const rollingCutoff = this.readRollingCutoff(comboOutcomeEntries);
    const windowedOutcomes =
      rollingCutoff === null
        ? [...comboOutcomeEntries]
        : comboOutcomeEntries.filter((comboOutcomeEntry) => comboOutcomeEntry.resolvedAt === null || comboOutcomeEntry.resolvedAt >= rollingCutoff);
    return windowedOutcomes;
  }

  private computeRecentStreak(comboOutcomeEntries: ComboOutcomeEntry[]): number {
    let recentStreak = 0;
    for (let index = comboOutcomeEntries.length - 1; index >= 0; index -= 1) {
      const comboOutcomeEntry = comboOutcomeEntries[index];
      if (!comboOutcomeEntry || comboOutcomeEntry.wasCorrect === null) {
        continue;
      }
      if (comboOutcomeEntry.wasCorrect) {
        if (recentStreak >= 0) {
          recentStreak += 1;
        } else {
          break;
        }
      }
      if (comboOutcomeEntry.wasCorrect === false) {
        if (recentStreak <= 0) {
          recentStreak -= 1;
        } else {
          break;
        }
      }
    }
    return recentStreak;
  }

  private computeDrawdownProxy(comboOutcomeEntries: ComboOutcomeEntry[]): number {
    let runningPnlProxy = 0;
    let peakPnlProxy = 0;
    let maxDrawdownProxy = 0;
    for (const comboOutcomeEntry of comboOutcomeEntries) {
      runningPnlProxy += comboOutcomeEntry.comboPnlProxy;
      if (runningPnlProxy > peakPnlProxy) {
        peakPnlProxy = runningPnlProxy;
      }
      const drawdownProxy = peakPnlProxy - runningPnlProxy;
      if (drawdownProxy > maxDrawdownProxy) {
        maxDrawdownProxy = drawdownProxy;
      }
    }
    return maxDrawdownProxy;
  }

  private normalizeLiftPnl(liftPnl: number): number {
    const normalizedLiftPnl = Math.max(-1, Math.min(1, liftPnl / 0.5));
    return normalizedLiftPnl;
  }

  private normalizeLiftHit(liftHit: number): number {
    const normalizedLiftHit = Math.max(-1, Math.min(1, liftHit / 0.2));
    return normalizedLiftHit;
  }

  private normalizeComboPnl(averagePnlProxy: number): number {
    const normalizedComboPnl = Math.max(-1, Math.min(1, averagePnlProxy / 0.5));
    return normalizedComboPnl;
  }

  private normalizeComboHit(hitRate: number): number {
    const normalizedComboHit = Math.max(-1, Math.min(1, (hitRate - 0.5) / 0.5));
    return normalizedComboHit;
  }

  private computeBootstrapDiscount(sampleCount: number, minimumSampleCount: number): number {
    const sampleProgress = Math.max(0, Math.min(1, sampleCount / Math.max(1, minimumSampleCount)));
    const bootstrapDiscount =
      config.EXECUTION_BOOTSTRAP_MIN_DISCOUNT + (config.EXECUTION_BOOTSTRAP_MAX_DISCOUNT - config.EXECUTION_BOOTSTRAP_MIN_DISCOUNT) * sampleProgress;
    return bootstrapDiscount;
  }

  private buildSummaryFromDefinition(comboDefinition: ComboDefinition, source: MetricsSource): ComboSummary {
    const comboOutcomeEntries = this.readWindowedOutcomes(this.requireComboOutcomes(comboDefinition.marketKey, comboDefinition.comboKey, source));
    const resolvedOutcomes = comboOutcomeEntries.filter((comboOutcomeEntry) => comboOutcomeEntry.wasCorrect !== null);
    const agreementCount = comboOutcomeEntries.filter((comboOutcomeEntry) => comboOutcomeEntry.isAgreement).length;
    const disagreementCount = comboOutcomeEntries.length - agreementCount;
    const sampleCount = comboOutcomeEntries.length;
    const hitCount = resolvedOutcomes.filter((comboOutcomeEntry) => comboOutcomeEntry.wasCorrect).length;
    const hitRate = resolvedOutcomes.length === 0 ? 0.5 : hitCount / resolvedOutcomes.length;
    const cumulativePnlProxy = resolvedOutcomes.reduce((aggregatedPnlProxy, comboOutcomeEntry) => aggregatedPnlProxy + comboOutcomeEntry.comboPnlProxy, 0);
    const averagePnlProxy = resolvedOutcomes.length === 0 ? 0 : cumulativePnlProxy / resolvedOutcomes.length;
    const averageCalibrationError =
      comboOutcomeEntries.length === 0
        ? 0.5
        : comboOutcomeEntries.reduce((aggregatedError, comboOutcomeEntry) => aggregatedError + comboOutcomeEntry.calibrationError, 0) /
          comboOutcomeEntries.length;
    const averageBestMemberHitRate =
      comboOutcomeEntries.length === 0
        ? 0.5
        : comboOutcomeEntries.reduce((aggregatedHitRate, comboOutcomeEntry) => aggregatedHitRate + comboOutcomeEntry.bestMemberHitRate, 0) /
          comboOutcomeEntries.length;
    const averageBestMemberPnlProxy =
      comboOutcomeEntries.length === 0
        ? 0
        : comboOutcomeEntries.reduce((aggregatedPnlProxy, comboOutcomeEntry) => aggregatedPnlProxy + comboOutcomeEntry.bestMemberPnlProxy, 0) /
          comboOutcomeEntries.length;
    const liftVsBestMemberHitRate = hitRate - averageBestMemberHitRate;
    const liftVsBestMemberPnl = averagePnlProxy - averageBestMemberPnlProxy;
    const agreementPurity = sampleCount === 0 ? 0 : agreementCount / sampleCount;
    const maxDrawdownProxy = this.computeDrawdownProxy(resolvedOutcomes);
    const stabilityAdjusted = 1 - Math.max(0, Math.min(1, maxDrawdownProxy / 1));
    const minimumSampleCount = comboDefinition.size === 2 ? config.MIN_COMBO_SAMPLES_PAIR : config.MIN_COMBO_SAMPLES_TRIO;
    const sampleTrust = Math.min(1, sampleCount / Math.max(1, minimumSampleCount * 2));
    const comboScore =
      0.4 * this.normalizeLiftPnl(liftVsBestMemberPnl) +
      0.2 * this.normalizeLiftHit(liftVsBestMemberHitRate) +
      0.15 * this.normalizeComboPnl(averagePnlProxy) +
      0.1 * this.normalizeComboHit(hitRate) +
      0.1 * stabilityAdjusted +
      0.05 * sampleTrust;
    let status: ComboSummary["status"] = "warming_up";
    if (sampleCount >= minimumSampleCount) {
      status = "neutral";
      if (liftVsBestMemberPnl < 0 || comboScore < 0) {
        status = "avoid";
      }
      if (
        comboScore >= config.MIN_COMBO_SCORE_FOR_BOOST &&
        liftVsBestMemberPnl > config.MIN_COMBO_LIFT_PNL &&
        liftVsBestMemberHitRate >= config.MIN_COMBO_LIFT_HIT
      ) {
        status = "good";
      }
    }
    const executionMinimumSampleCount = comboDefinition.size === 2 ? config.MIN_COMBO_EXECUTION_SAMPLES_PAIR : config.MIN_COMBO_EXECUTION_SAMPLES_TRIO;
    const effectiveComboScore =
      source === "execution" && sampleCount < executionMinimumSampleCount
        ? comboScore * this.computeBootstrapDiscount(sampleCount, executionMinimumSampleCount)
        : comboScore;
    const isExecutionEligible =
      status === "good" &&
      agreementPurity >= config.MIN_COMBO_AGREEMENT_PURITY_FOR_PENALTY &&
      maxDrawdownProxy < 0.8 &&
      effectiveComboScore >= config.MIN_COMBO_EXECUTION_SCORE &&
      sampleCount >= executionMinimumSampleCount;
    return {
      comboKey: comboDefinition.comboKey,
      marketKey: comboDefinition.marketKey,
      memberStrategyIds: comboDefinition.memberStrategyIds,
      size: comboDefinition.size,
      sampleCount,
      agreementCount,
      disagreementCount,
      agreementPurity,
      hitRate,
      averagePnlProxy,
      cumulativePnlProxy,
      averageCalibrationError,
      recentStreak: this.computeRecentStreak(resolvedOutcomes),
      maxDrawdownProxy,
      liftVsBestMemberHitRate,
      liftVsBestMemberPnl,
      comboScore,
      effectiveComboScore,
      status,
      scoreSource: source,
      isExecutionEligible,
      lastResolvedAt: comboOutcomeEntries.length === 0 ? null : (comboOutcomeEntries[comboOutcomeEntries.length - 1]?.resolvedAt ?? null),
    };
  }

  private buildUsageFromCandidate(activeComboCandidate: ActiveComboCandidate, comboSummary: ComboSummary): ComboUsage {
    return {
      comboKey: activeComboCandidate.comboDefinition.comboKey,
      marketKey: activeComboCandidate.comboDefinition.marketKey,
      memberStrategyIds: activeComboCandidate.comboDefinition.memberStrategyIds,
      size: activeComboCandidate.comboDefinition.size,
      direction: activeComboCandidate.direction,
      isAgreement: activeComboCandidate.isAgreement,
      comboScore: comboSummary.comboScore,
      boostApplied: 0,
      confidencePenaltyApplied: 0,
      didAffectFinalScore: false,
      didAffectFinalConfidence: false,
      reason: comboSummary.status,
    };
  }

  private clampConfidence(rawConfidence: number): number {
    const clampedConfidence = Math.max(0.5, Math.min(0.99, rawConfidence));
    return clampedConfidence;
  }

  private compareComboSummaries(leftSummary: ComboSummary, rightSummary: ComboSummary): number {
    let comparison = rightSummary.effectiveComboScore - leftSummary.effectiveComboScore;
    if (comparison === 0) {
      comparison = rightSummary.sampleCount - leftSummary.sampleCount;
    }
    if (comparison === 0) {
      comparison = leftSummary.maxDrawdownProxy - rightSummary.maxDrawdownProxy;
    }
    if (comparison === 0) {
      comparison = rightSummary.liftVsBestMemberPnl - leftSummary.liftVsBestMemberPnl;
    }
    return comparison;
  }

  private buildAllKnownSummaries(source: MetricsSource, marketKey?: MarketKey): ComboSummary[] {
    const comboSummaries: ComboSummary[] = [];
    for (const comboStorageKey of this.resolveOutcomeStore(source).keys()) {
      const [asset, window, ...comboKeyParts] = comboStorageKey.split(":");
      const normalizedMarketKey = `${asset}:${window}` as MarketKey;
      const comboKey = comboKeyParts.join(":");
      if (marketKey === undefined || normalizedMarketKey === marketKey) {
        const memberStrategyIds = comboKey.split("+");
        comboSummaries.push(this.buildSummaryFromDefinition(this.createComboDefinition(normalizedMarketKey, memberStrategyIds), source));
      }
    }
    return comboSummaries.sort((leftSummary, rightSummary) => {
      return this.compareComboSummaries(leftSummary, rightSummary);
    });
  }

  private buildMarketComboBoard(marketKey: MarketKey): MarketComboBoard {
    const comboSummaries = this.getComboSummaries(marketKey);
    const topPairs = comboSummaries.filter((comboSummary) => comboSummary.size === 2).slice(0, 6);
    const topTrios = comboSummaries.filter((comboSummary) => comboSummary.size === 3).slice(0, 6);
    const activeCombosNow = this.latestActiveCombos.get(marketKey) ?? [];
    const lastAppliedCombos = this.latestAppliedCombos.get(marketKey) ?? [];
    const comboBoostShare = lastAppliedCombos.reduce((aggregatedBoost, comboUsage) => aggregatedBoost + Math.abs(comboUsage.boostApplied), 0);
    const comboConfidencePenaltyShare = lastAppliedCombos.reduce((aggregatedPenalty, comboUsage) => aggregatedPenalty + comboUsage.confidencePenaltyApplied, 0);
    return {
      marketKey,
      topPairs,
      topTrios,
      activeCombosNow,
      lastAppliedCombos,
      comboBoostShare,
      comboConfidencePenaltyShare,
      hasActionableCombos: comboSummaries.some((comboSummary) => comboSummary.isExecutionEligible),
    };
  }

  private createExecutionComboDecision(
    _marketKey: MarketKey,
    activeComboCandidate: ActiveComboCandidate | null,
    comboSummary: ComboSummary | null,
    source: ComboSource | null,
    gateReason: string | null,
  ): ComboGateDecision {
    return {
      hasComboGatePassed: activeComboCandidate !== null && comboSummary !== null && comboSummary.isExecutionEligible,
      selectedComboKey: activeComboCandidate?.comboDefinition.comboKey ?? null,
      selectedComboSize: activeComboCandidate?.comboDefinition.size ?? null,
      selectedComboSource: source,
      effectiveComboScore: comboSummary?.effectiveComboScore ?? null,
      gateReason,
    };
  }

  private findCandidate(activeComboCandidates: ActiveComboCandidate[], comboKey: string): ActiveComboCandidate | null {
    const activeComboCandidate = activeComboCandidates.find((candidate) => candidate.comboDefinition.comboKey === comboKey) ?? null;
    return activeComboCandidate;
  }

  private chooseBestExecutionCombo(marketKey: MarketKey, activeComboCandidates: ActiveComboCandidate[]): ComboGateDecision {
    const researchCandidates = activeComboCandidates
      .map((activeComboCandidate) => {
        return {
          activeComboCandidate,
          comboSummary: this.buildSummaryFromDefinition(activeComboCandidate.comboDefinition, "research"),
        };
      })
      .filter((candidate) => candidate.activeComboCandidate.isAgreement && candidate.activeComboCandidate.direction !== null);
    const executionCandidates = activeComboCandidates
      .map((activeComboCandidate) => {
        return {
          activeComboCandidate,
          comboSummary: this.buildSummaryFromDefinition(activeComboCandidate.comboDefinition, "execution"),
        };
      })
      .filter((candidate) => candidate.activeComboCandidate.isAgreement && candidate.activeComboCandidate.direction !== null);
    const eligibleExecutionCandidate = executionCandidates
      .filter((candidate) => candidate.comboSummary.isExecutionEligible)
      .sort((leftCandidate, rightCandidate) => this.compareComboSummaries(leftCandidate.comboSummary, rightCandidate.comboSummary))[0];
    const eligibleResearchCandidate = researchCandidates
      .map((candidate) => {
        const minimumSampleCount = candidate.comboSummary.size === 2 ? config.MIN_COMBO_EXECUTION_SAMPLES_PAIR : config.MIN_COMBO_EXECUTION_SAMPLES_TRIO;
        const discountedScore = candidate.comboSummary.comboScore * this.computeBootstrapDiscount(candidate.comboSummary.sampleCount, minimumSampleCount);
        return {
          activeComboCandidate: candidate.activeComboCandidate,
          comboSummary: {
            ...candidate.comboSummary,
            effectiveComboScore: discountedScore,
            isExecutionEligible:
              candidate.comboSummary.status === "good" &&
              candidate.comboSummary.agreementPurity >= config.MIN_COMBO_AGREEMENT_PURITY_FOR_PENALTY &&
              discountedScore >= config.MIN_COMBO_EXECUTION_SCORE,
          },
        };
      })
      .filter((candidate) => candidate.comboSummary.isExecutionEligible)
      .sort((leftCandidate, rightCandidate) => this.compareComboSummaries(leftCandidate.comboSummary, rightCandidate.comboSummary))[0];
    let comboGateDecision = this.createExecutionComboDecision(marketKey, null, null, null, "combo_gate_failed");
    if (eligibleExecutionCandidate) {
      comboGateDecision = this.createExecutionComboDecision(
        marketKey,
        eligibleExecutionCandidate.activeComboCandidate,
        eligibleExecutionCandidate.comboSummary,
        "execution",
        null,
      );
    } else {
      if (eligibleResearchCandidate) {
        comboGateDecision = this.createExecutionComboDecision(
          marketKey,
          eligibleResearchCandidate.activeComboCandidate,
          eligibleResearchCandidate.comboSummary,
          "research",
          null,
        );
      }
    }
    return comboGateDecision;
  }

  /**
   * @section public:methods
   */

  public applyComboEffects(
    marketKey: MarketKey,
    strategySignals: StrategySignal[],
    strategySummaries: StrategySummary[],
    baseWeightedScore: number,
    baseConfidence: number,
    crossAssetRegime: CrossAssetRegime,
    marketQualityScore: number,
    executionScore: number | null,
  ): {
    adjustedWeightedScore: number;
    adjustedConfidence: number;
    comboBreakdown: ComboBreakdown;
    comboGate: ComboGateDecision;
    selectedCombo: SelectedStrategyCombo | null;
  } {
    const activeComboCandidates = this.buildActiveComboCandidates(marketKey, strategySignals);
    const strategySummaryMap = new Map<string, StrategySummary>();
    for (const strategySummary of strategySummaries) {
      strategySummaryMap.set(strategySummary.strategyId, strategySummary);
    }
    const activeCombos: ComboUsage[] = [];
    const appliedBoostCombos: ComboUsage[] = [];
    const appliedDisagreementCombos: ComboUsage[] = [];
    let totalBoostApplied = 0;
    let totalConfidencePenaltyApplied = 0;
    for (const activeComboCandidate of activeComboCandidates) {
      const comboSummary = this.buildSummaryFromDefinition(activeComboCandidate.comboDefinition, "research");
      const comboUsage = this.buildUsageFromCandidate(activeComboCandidate, comboSummary);
      if (activeComboCandidate.isAgreement && config.ENABLE_COMBO_BOOST && comboSummary.status === "good") {
        const comboStrength =
          activeComboCandidate.memberSignals.reduce(
            (aggregatedStrength, strategySignal) => aggregatedStrength + strategySignal.confidence * strategySignal.weight,
            0,
          ) /
          Math.max(
            1,
            activeComboCandidate.memberSignals.reduce((aggregatedWeight, strategySignal) => aggregatedWeight + strategySignal.weight, 0),
          );
        const rawBoostMagnitude =
          comboSummary.comboScore * comboStrength * Math.max(0, comboSummary.liftVsBestMemberPnl + comboSummary.liftVsBestMemberHitRate);
        const boostCap = comboSummary.size === 2 ? config.MAX_PAIR_BOOST_ABS : config.MAX_TRIO_BOOST_ABS;
        const remainingBoostBudget = Math.max(0, config.MAX_TOTAL_COMBO_BOOST_ABS - Math.abs(totalBoostApplied));
        const boostMagnitude = Math.min(boostCap, remainingBoostBudget, Math.abs(rawBoostMagnitude));
        comboUsage.boostApplied = activeComboCandidate.direction === "DOWN" ? boostMagnitude * -1 : boostMagnitude;
        comboUsage.didAffectFinalScore = comboUsage.boostApplied !== 0;
        comboUsage.reason = "agreement_boost";
        totalBoostApplied += comboUsage.boostApplied;
        if (comboUsage.didAffectFinalScore) {
          appliedBoostCombos.push(comboUsage);
        }
      }
      if (
        !activeComboCandidate.isAgreement &&
        comboSummary.status === "good" &&
        comboSummary.agreementPurity >= config.MIN_COMBO_AGREEMENT_PURITY_FOR_PENALTY &&
        totalConfidencePenaltyApplied < config.MAX_TOTAL_COMBO_CONFIDENCE_PENALTY
      ) {
        const disagreementFactor = 1 - comboSummary.agreementPurity;
        const confidencePenaltyApplied = Math.min(
          config.MAX_TOTAL_COMBO_CONFIDENCE_PENALTY - totalConfidencePenaltyApplied,
          comboSummary.comboScore * Math.max(0.1, disagreementFactor),
        );
        comboUsage.confidencePenaltyApplied = confidencePenaltyApplied;
        comboUsage.didAffectFinalConfidence = confidencePenaltyApplied > 0;
        comboUsage.reason = "disagreement_penalty";
        totalConfidencePenaltyApplied += confidencePenaltyApplied;
        if (comboUsage.didAffectFinalConfidence) {
          appliedDisagreementCombos.push(comboUsage);
        }
      }
      activeCombos.push(comboUsage);
      for (const memberStrategyId of comboUsage.memberStrategyIds) {
        const strategySummary = strategySummaryMap.get(memberStrategyId);
        if (strategySummary) {
          strategySummary.comboCode = comboUsage.size === 2 ? "C2" : "C3";
        }
      }
    }
    const comboGate = this.chooseBestExecutionCombo(marketKey, activeComboCandidates);
    const selectedCombo = this.selectBestComboForMarketInternal(marketKey, activeComboCandidates, crossAssetRegime, marketQualityScore, executionScore);
    this.latestExecutionComboDecision.set(marketKey, comboGate);
    const adjustedWeightedScore = baseWeightedScore + totalBoostApplied;
    const adjustedConfidence = this.clampConfidence(baseConfidence + Math.min(Math.abs(totalBoostApplied) * 0.5, 0.08) - totalConfidencePenaltyApplied);
    this.latestActiveCombos.set(marketKey, activeCombos);
    this.latestAppliedCombos.set(marketKey, [...appliedBoostCombos, ...appliedDisagreementCombos]);
    return {
      adjustedWeightedScore,
      adjustedConfidence,
      comboBreakdown: {
        activeCombos,
        appliedBoostCombos,
        appliedDisagreementCombos,
        totalBoostApplied,
        totalConfidencePenaltyApplied,
      },
      comboGate,
      selectedCombo,
    };
  }

  public selectBestComboForMarket(input: {
    marketKey: MarketKey;
    strategySignals: StrategySignal[];
    crossAssetRegime: CrossAssetRegime;
    marketQualityScore: number;
    executionScore: number | null;
  }): SelectedStrategyCombo | null {
    const activeComboCandidates = this.buildActiveComboCandidates(input.marketKey, input.strategySignals);
    const selectedStrategyCombo = this.selectBestComboForMarketInternal(
      input.marketKey,
      activeComboCandidates,
      input.crossAssetRegime,
      input.marketQualityScore,
      input.executionScore,
    );
    return selectedStrategyCombo;
  }

  public recordResolution(
    marketKey: MarketKey,
    predictionId: string,
    comboUsages: ComboUsage[],
    strategySignals: StrategySignal[],
    strategySummaries: StrategySummary[],
    resolvedDirection: PredictionDirection | null,
    resolvedAt: number | null,
    source: MetricsSource,
  ): void {
    const strategySummaryMap = new Map<string, StrategySummary>();
    for (const strategySummary of strategySummaries) {
      strategySummaryMap.set(strategySummary.strategyId, strategySummary);
    }
    for (const comboUsage of comboUsages) {
      const comboOutcomeEntries = this.requireComboOutcomes(marketKey, comboUsage.comboKey, source);
      const memberSignals = strategySignals.filter((strategySignal) => comboUsage.memberStrategyIds.includes(strategySignal.strategyId));
      const bestMemberSummary = [...comboUsage.memberStrategyIds]
        .map((strategyId) => strategySummaryMap.get(strategyId))
        .filter(Boolean)
        .sort((leftSummary, rightSummary) => (rightSummary?.averagePnlProxy ?? 0) - (leftSummary?.averagePnlProxy ?? 0))[0];
      const wasCorrect = comboUsage.direction === null || resolvedDirection === null ? null : comboUsage.direction === resolvedDirection;
      const comboConfidence =
        memberSignals.length === 0
          ? 0.5
          : memberSignals.reduce((aggregatedConfidence, strategySignal) => aggregatedConfidence + strategySignal.confidence, 0) / memberSignals.length;
      const comboPnlProxy = wasCorrect === null ? 0 : wasCorrect ? comboConfidence : comboConfidence * -1;
      const targetConfidence = wasCorrect === null ? comboConfidence : wasCorrect ? 1 : 0;
      const calibrationError = Math.abs(comboConfidence - targetConfidence);
      comboOutcomeEntries.push({
        predictionId,
        resolvedAt,
        isAgreement: comboUsage.isAgreement,
        direction: comboUsage.direction,
        wasCorrect,
        comboConfidence,
        comboPnlProxy,
        calibrationError,
        bestMemberHitRate: bestMemberSummary?.hitRate ?? 0.5,
        bestMemberPnlProxy: bestMemberSummary?.averagePnlProxy ?? 0,
      });
      const rollingCutoff = this.readRollingCutoff(comboOutcomeEntries);
      if (rollingCutoff !== null) {
        const filteredComboOutcomeEntries = comboOutcomeEntries.filter(
          (comboOutcomeEntry) => comboOutcomeEntry.resolvedAt === null || comboOutcomeEntry.resolvedAt >= rollingCutoff,
        );
        comboOutcomeEntries.splice(0, comboOutcomeEntries.length, ...filteredComboOutcomeEntries);
      }
    }
  }

  public getComboSummaries(marketKey?: MarketKey): ComboSummary[] {
    const researchSummaries = this.buildAllKnownSummaries("research", marketKey);
    const comboSummaries = researchSummaries.map((researchSummary) => {
      const executionSummary = this.buildSummaryFromDefinition(
        this.createComboDefinition(researchSummary.marketKey, researchSummary.memberStrategyIds),
        "execution",
      );
      let comboSummary = { ...researchSummary };
      if (executionSummary.sampleCount > 0) {
        comboSummary = {
          ...executionSummary,
          scoreSource: "execution",
        };
      }
      return comboSummary;
    });
    return comboSummaries.sort((leftSummary, rightSummary) => {
      return this.compareComboSummaries(leftSummary, rightSummary);
    });
  }

  public getMarketComboBoards(marketKeys: MarketKey[]): MarketComboBoard[] {
    const marketComboBoards = marketKeys.map((marketKey) => this.buildMarketComboBoard(marketKey));
    return marketComboBoards;
  }
}
