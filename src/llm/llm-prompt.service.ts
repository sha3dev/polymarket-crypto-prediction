/**
 * @section imports:externals
 */

import { readFileSync } from "node:fs";

/**
 * @section imports:internals
 */

import config from "../config.ts";
import type { ExecutionMode } from "../execution/execution.types.ts";
import { SUPPORTED_ASSETS, SUPPORTED_WINDOWS } from "../market/market.types.ts";
import type { LlmEvent, LlmSummary, LlmTradeClosedEvent } from "./llm.types.ts";

/**
 * @section class
 */

export class LlmPromptService {
  /**
   * @section private:attributes
   */

  private readonly summaryFilePath: string;
  private readonly eventFilePath: string;
  private readonly repositoryUrl: string;
  private readonly executionMode: ExecutionMode;

  /**
   * @section constructor
   */

  public constructor(summaryFilePath: string, eventFilePath: string, repositoryUrl: string, executionMode: ExecutionMode) {
    this.summaryFilePath = summaryFilePath;
    this.eventFilePath = eventFilePath;
    this.repositoryUrl = repositoryUrl;
    this.executionMode = executionMode;
  }

  /**
   * @section private:methods
   */

  private loadSummary(): LlmSummary {
    const llmSummary = JSON.parse(readFileSync(this.summaryFilePath, "utf8")) as LlmSummary;
    return llmSummary;
  }

  private loadRecentEvents(): LlmEvent[] {
    const rawEvents = readFileSync(this.eventFilePath, "utf8");
    const llmEvents = rawEvents
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as LlmEvent)
      .slice(-config.LLM_PROMPT_RECENT_EVENT_LIMIT)
      .reverse();
    return llmEvents;
  }

  private buildTaskSpecificationSection(): string {
    const lines = [
      "## Task Specification",
      "You are improving this repository's prediction engine.",
      "Primary objective: improve prediction accuracy.",
      "Use the README, the codebase, and the runtime evidence together before proposing changes.",
      "Focus mainly on strategy logic, scoring, thresholds, weighting, trigger logic, and evidence interpretation.",
      "Avoid unrelated architectural churn or cosmetic refactors.",
      "Keep current API and behavior stable unless a change is necessary for measurable model improvement.",
      "Preserve the repository standards and run project checks after modifying code.",
    ];
    const taskSpecificationSection = lines.join("\n");
    return taskSpecificationSection;
  }

  private buildContextSection(): string {
    const lines = [
      "## Repository Context",
      `Repository URL: ${this.repositoryUrl}`,
      `Service name: ${config.SERVICE_NAME}`,
      `Execution mode: ${this.executionMode}`,
      `Monitored assets: ${SUPPORTED_ASSETS.join(", ")}`,
      `Monitored windows: ${SUPPORTED_WINDOWS.join(", ")}`,
      `Prediction horizon ms: ${config.PREDICTION_HORIZON_MS}`,
      `Market cooldown ms: ${config.MARKET_COOLDOWN_MS}`,
      "Current emphasis: combo-first model, trigger-based prediction flow, rolling metrics, in-memory state.",
    ];
    const contextSection = lines.join("\n");
    return contextSection;
  }

  private buildGlobalMetricsSection(llmSummary: LlmSummary): string {
    const lines = [
      "## Curated Runtime Evidence",
      "### Global Metrics Snapshot",
      `predictions_created=${llmSummary.counts.predictionsCreated}`,
      `predictions_resolved=${llmSummary.counts.predictionsResolved}`,
      `wins=${llmSummary.counts.wins}`,
      `losses=${llmSummary.counts.losses}`,
      `trades_closed=${llmSummary.counts.tradesClosed}`,
      `resolved_accuracy=${llmSummary.quality.resolvedAccuracy ?? "n/a"}`,
      `average_confidence=${llmSummary.quality.averageConfidence ?? "n/a"}`,
      `average_win_confidence=${llmSummary.quality.averageWinConfidence ?? "n/a"}`,
      `average_loss_confidence=${llmSummary.quality.averageLossConfidence ?? "n/a"}`,
    ];
    const globalMetricsSection = lines.join("\n");
    return globalMetricsSection;
  }

  private buildMarketSummarySection(llmSummary: LlmSummary): string {
    const marketEntries = Object.values(llmSummary.markets).sort((leftMarket, rightMarket) => {
      return rightMarket.predictionCount - leftMarket.predictionCount;
    });
    const lines = ["### Per-Market Performance Summary"];
    if (marketEntries.length === 0) {
      lines.push("no runtime evidence yet");
    } else {
      for (const marketEntry of marketEntries) {
        lines.push(
          `${marketEntry.marketKey}: predictions=${marketEntry.predictionCount}, resolved_accuracy=${marketEntry.resolvedAccuracy ?? "n/a"}, trades=${marketEntry.tradeCount}, cumulative_pnl=${marketEntry.cumulativePnl.toFixed(4)}`,
        );
      }
    }
    const marketSummarySection = lines.join("\n");
    return marketSummarySection;
  }

  private buildStrategySection(llmSummary: LlmSummary): string {
    const strategyEntries = Object.values(llmSummary.strategies).filter((strategySummary) => strategySummary.appearances > 0);
    const strongestStrategies = [...strategyEntries]
      .sort((leftStrategy, rightStrategy) => {
        return (rightStrategy.hitRate ?? -1) - (leftStrategy.hitRate ?? -1) || rightStrategy.appearances - leftStrategy.appearances;
      })
      .slice(0, 5);
    const weakestStrategies = [...strategyEntries]
      .sort((leftStrategy, rightStrategy) => {
        return (leftStrategy.hitRate ?? 2) - (rightStrategy.hitRate ?? 2) || rightStrategy.appearances - leftStrategy.appearances;
      })
      .slice(0, 5);
    const lines = ["### Strongest and Weakest Strategies"];
    if (strategyEntries.length === 0) {
      lines.push("no runtime evidence yet");
    } else {
      lines.push("strongest:");
      for (const strategyEntry of strongestStrategies) {
        lines.push(
          `${strategyEntry.strategyId} ${strategyEntry.name}: hit_rate=${strategyEntry.hitRate ?? "n/a"}, appearances=${strategyEntry.appearances}, average_weight=${strategyEntry.averageWeight ?? "n/a"}`,
        );
      }
      lines.push("weakest:");
      for (const strategyEntry of weakestStrategies) {
        lines.push(
          `${strategyEntry.strategyId} ${strategyEntry.name}: hit_rate=${strategyEntry.hitRate ?? "n/a"}, appearances=${strategyEntry.appearances}, average_weight=${strategyEntry.averageWeight ?? "n/a"}`,
        );
      }
    }
    const strategySection = lines.join("\n");
    return strategySection;
  }

  private buildComboSection(llmSummary: LlmSummary): string {
    const comboEntries = Object.values(llmSummary.combos).filter((comboSummary) => comboSummary.resolvedCount > 0);
    const strongestCombos = [...comboEntries]
      .sort((leftCombo, rightCombo) => {
        return (rightCombo.hitRate ?? -1) - (leftCombo.hitRate ?? -1) || rightCombo.resolvedCount - leftCombo.resolvedCount;
      })
      .slice(0, 5);
    const weakestCombos = [...comboEntries]
      .sort((leftCombo, rightCombo) => {
        return (leftCombo.hitRate ?? 2) - (rightCombo.hitRate ?? 2) || rightCombo.resolvedCount - leftCombo.resolvedCount;
      })
      .slice(0, 5);
    const lines = ["### Strongest and Weakest Combos"];
    if (comboEntries.length === 0) {
      lines.push("no runtime evidence yet");
    } else {
      lines.push("strongest:");
      for (const comboEntry of strongestCombos) {
        lines.push(`${comboEntry.comboKey}: hit_rate=${comboEntry.hitRate ?? "n/a"}, resolved=${comboEntry.resolvedCount}`);
      }
      lines.push("weakest:");
      for (const comboEntry of weakestCombos) {
        lines.push(`${comboEntry.comboKey}: hit_rate=${comboEntry.hitRate ?? "n/a"}, resolved=${comboEntry.resolvedCount}`);
      }
    }
    const comboSection = lines.join("\n");
    return comboSection;
  }

  private buildBlockerSection(llmSummary: LlmSummary): string {
    const blockerEntries = Object.entries(llmSummary.executionBlockers)
      .sort((leftEntry, rightEntry) => rightEntry[1] - leftEntry[1])
      .slice(0, 5);
    const lines = ["### Most Common Execution Blockers"];
    if (blockerEntries.length === 0) {
      lines.push("no runtime evidence yet");
    } else {
      for (const [blockingReason, count] of blockerEntries) {
        lines.push(`${blockingReason}: count=${count}`);
      }
    }
    const blockerSection = lines.join("\n");
    return blockerSection;
  }

  private buildRecentPredictionSection(llmEvents: LlmEvent[]): string {
    const resolvedPredictionEvents = llmEvents.filter((llmEvent) => llmEvent.eventType === "prediction_resolved").slice(0, 10);
    const lines = ["### Recent Resolved Predictions"];
    if (resolvedPredictionEvents.length === 0) {
      lines.push("no runtime evidence yet");
    } else {
      for (const llmEvent of resolvedPredictionEvents) {
        lines.push(
          `${llmEvent.marketKey} prediction=${llmEvent.predictionId} direction=${llmEvent.direction} confidence=${llmEvent.confidence} outcome=${llmEvent.outcomeStatus} reason=${llmEvent.outcomeReason ?? "n/a"} combo=${llmEvent.selectedComboKey}`,
        );
      }
    }
    const recentPredictionSection = lines.join("\n");
    return recentPredictionSection;
  }

  private buildRecentTradeSection(llmEvents: LlmEvent[], shouldSelectLosses: boolean): string {
    const tradeEvents = llmEvents
      .filter((llmEvent) => {
        const typedTradeEvent = llmEvent.eventType === "trade_closed" ? llmEvent : null;
        const isMatchingTrade =
          typedTradeEvent !== null && (shouldSelectLosses ? typedTradeEvent.realizedPnlAfterCosts < 0 : typedTradeEvent.realizedPnlAfterCosts >= 0);
        return isMatchingTrade;
      })
      .map((llmEvent) => llmEvent as LlmTradeClosedEvent)
      .slice(0, 8);
    const sectionTitle = shouldSelectLosses ? "### Recent Losing Trades" : "### Recent Winning Trades";
    const lines = [sectionTitle];
    if (tradeEvents.length === 0) {
      lines.push("no runtime evidence yet");
    } else {
      for (const llmEvent of tradeEvents) {
        lines.push(
          `${llmEvent.marketKey} trade=${llmEvent.positionId} pnl=${llmEvent.realizedPnlAfterCosts.toFixed(4)} hold_ms=${llmEvent.holdTimeMs} exit_reason=${llmEvent.exitReason} fallback=${llmEvent.hasTakerFallbackUsed}`,
        );
      }
    }
    const recentTradeSection = lines.join("\n");
    return recentTradeSection;
  }

  private buildEvidenceSections(llmSummary: LlmSummary, llmEvents: LlmEvent[]): string[] {
    const evidenceSections = [
      this.buildGlobalMetricsSection(llmSummary),
      this.buildMarketSummarySection(llmSummary),
      this.buildStrategySection(llmSummary),
      this.buildComboSection(llmSummary),
      this.buildBlockerSection(llmSummary),
      this.buildRecentPredictionSection(llmEvents),
      this.buildRecentTradeSection(llmEvents, true),
      this.buildRecentTradeSection(llmEvents, false),
    ];
    return evidenceSections;
  }

  /**
   * @section public:methods
   */

  public buildPrompt(): string {
    const llmSummary = this.loadSummary();
    const llmEvents = this.loadRecentEvents();
    const includedSections = [this.buildTaskSpecificationSection(), this.buildContextSection()];
    let prompt = includedSections.join("\n\n");
    for (const evidenceSection of this.buildEvidenceSections(llmSummary, llmEvents)) {
      const nextPrompt = `${prompt}\n\n${evidenceSection}`;
      if (nextPrompt.length <= config.LLM_PROMPT_MAX_CHARS) {
        prompt = nextPrompt;
      }
    }
    return prompt;
  }
}
