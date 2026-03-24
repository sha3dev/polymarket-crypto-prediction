/**
 * @section imports:internals
 */

import config from "../config.ts";

/**
 * @section class
 */

export class DashboardViewService {
  /**
   * @section public:methods
   */

  public buildHtml(): string {
    const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${config.SERVICE_NAME}</title>
    <style>
      :root {
        --bg: linear-gradient(180deg, #07111f 0%, #0d1b2a 42%, #f1efe5 42%, #f1efe5 100%);
        --panel: rgba(255, 255, 255, 0.92);
        --panel-dark: rgba(7, 17, 31, 0.84);
        --text: #0d1b2a;
        --text-light: #f8fafc;
        --accent: #ff7a18;
        --accent-2: #1fa2ff;
        --success: #0f9d58;
        --danger: #c0392b;
        --muted: #6b7280;
        --border: rgba(13, 27, 42, 0.1);
        --shadow: 0 16px 40px rgba(7, 17, 31, 0.18);
        font-family: "IBM Plex Sans", "Avenir Next", sans-serif;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        background: var(--bg);
        color: var(--text);
      }
      .shell {
        width: min(1600px, calc(100vw - 32px));
        margin: 0 auto;
        padding: 24px 0 32px;
      }
      .hero {
        margin-bottom: 18px;
      }
      .hero-card, .panel {
        border-radius: 18px;
        box-shadow: var(--shadow);
        overflow: hidden;
      }
      .hero-card {
        background: var(--panel-dark);
        color: var(--text-light);
        padding: 22px 24px;
      }
      .hero-head {
        display: grid;
        grid-template-columns: minmax(0, 1.4fr) minmax(320px, 0.8fr);
        gap: 22px;
        align-items: start;
      }
      .hero-copy {
        display: grid;
        gap: 10px;
      }
      .hero-card h1 {
        margin: 0 0 8px;
        font-size: clamp(28px, 3vw, 40px);
      }
      .hero-card p {
        margin: 0;
        opacity: 0.84;
        max-width: 54ch;
      }
      .kpi-strip {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
      }
      .kpi {
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 14px;
        padding: 14px;
        min-height: 78px;
      }
      .kpi strong {
        display: block;
        font-size: 24px;
      }
      .grid {
        display: grid;
        grid-template-columns: minmax(0, 1.75fr) minmax(360px, 1.05fr);
        gap: 18px;
        align-items: start;
      }
      .stack {
        display: grid;
        gap: 18px;
        align-content: start;
      }
      .panel {
        background: var(--panel);
        padding: 18px;
      }
      .panel-tall { min-height: 420px; }
      .panel-medium { min-height: 308px; }
      .panel-compact { min-height: 132px; }
      .panel-scroll {
        overflow: auto;
        max-height: 100%;
        padding-right: 4px;
      }
      .panel-scroll::-webkit-scrollbar {
        width: 10px;
        height: 10px;
      }
      .panel-scroll::-webkit-scrollbar-thumb {
        background: rgba(13, 27, 42, 0.16);
        border-radius: 999px;
      }
      h2 {
        margin: 0 0 12px;
        font-size: 15px;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }
      .label-with-hint {
        display: inline-flex;
        align-items: center;
      }
      .hint-text {
        border-bottom: 1px dashed rgba(107, 114, 128, 0.65);
        cursor: help;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
      }
      th, td {
        padding: 8px 6px;
        border-bottom: 1px solid var(--border);
        text-align: left;
        white-space: nowrap;
      }
      th { color: var(--muted); font-weight: 600; }
      tbody tr:last-child td { border-bottom: 0; }
      .pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        padding: 4px 10px;
        font-size: 12px;
        font-weight: 700;
      }
      .up { background: rgba(15, 157, 88, 0.12); color: var(--success); }
      .down { background: rgba(192, 57, 43, 0.12); color: var(--danger); }
      .muted { color: var(--muted); }
      .quality-bar {
        width: 100px;
        height: 8px;
        border-radius: 999px;
        background: rgba(13, 27, 42, 0.08);
        overflow: hidden;
      }
      .quality-cell {
        display: inline-flex;
        align-items: center;
        gap: 8px;
      }
      .quality-bar span {
        display: block;
        height: 100%;
        background: linear-gradient(90deg, var(--accent), var(--accent-2));
      }
      .tiny {
        font-size: 11px;
        color: var(--muted);
      }
      .health-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px 16px;
      }
      .health-item {
        min-width: 0;
      }
      .health-item strong {
        display: block;
        margin-bottom: 2px;
        font-size: 16px;
      }
      .truncate-cell {
        display: inline-block;
        max-width: 230px;
        overflow: hidden;
        text-overflow: ellipsis;
        vertical-align: bottom;
      }
      .loading {
        animation: pulse 1.6s ease-in-out infinite;
      }
      @keyframes pulse {
        0%, 100% { opacity: 0.6; }
        50% { opacity: 1; }
      }
      @media (max-width: 1100px) {
        .hero-head, .grid { grid-template-columns: 1fr; }
        .kpi-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .panel-tall, .panel-medium, .panel-compact { min-height: 0; }
        .panel-scroll { max-height: none; }
      }
      @media (max-width: 700px) {
        .shell { width: min(100vw - 20px, 1600px); }
        .kpi-strip { grid-template-columns: 1fr; }
        .health-grid { grid-template-columns: 1fr; }
        table { font-size: 12px; }
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <section class="hero">
        <article class="hero-card">
          <div class="hero-head">
            <div class="hero-copy">
              <div class="tiny">
                <span class="label-with-hint">
                  <span class="hint-text" title="Compact live operator view for the ensemble, market state, strategy health, and execution overlay.">Live ensemble monitor</span>
                </span>
              </div>
              <h1>Polymarket 5m / 15m predictor</h1>
              <p>Event-driven crypto prediction surface with rolling weights, market quality scoring, strategy attribution, and paper execution across BTC, ETH, SOL, and XRP.</p>
            </div>
            <div class="kpi-strip" id="kpis"></div>
          </div>
        </article>
      </section>
      <section class="grid">
        <div class="stack">
          <article class="panel panel-compact">
            <h2><span class="label-with-hint"><span class="hint-text" title="Current state for all eight monitored markets, including token midpoints, cooldown, and data quality.">Markets</span></span></h2>
            <div id="markets" class="loading panel-scroll">Loading market state…</div>
          </article>
          <article class="panel panel-medium">
            <h2><span class="label-with-hint"><span class="hint-text" title="Current executable entry decision per market: side, TP, SL, and maker versus taker choice.">Execution Now</span></span></h2>
            <div id="execution" class="loading panel-scroll">Loading execution decisions…</div>
          </article>
          <article class="panel panel-tall">
            <h2><span class="label-with-hint"><span class="hint-text" title="Newest ensemble calls with their trigger, confidence, and realized outcome when available.">Latest Predictions</span></span></h2>
            <div id="predictions" class="loading panel-scroll">Loading prediction history…</div>
          </article>
        </div>
        <div class="stack">
          <article class="panel panel-tall">
            <h2><span class="label-with-hint"><span class="hint-text" title="Rolling ranking of strategies by adaptive weight and recent online performance.">Strategies</span></span></h2>
            <div id="strategies" class="loading panel-scroll">Loading strategy ranking…</div>
          </article>
          <article class="panel panel-medium">
            <h2><span class="label-with-hint"><span class="hint-text" title="Most recent closed paper trades, including maker/taker styles and exit reasons.">Recent Trades</span></span></h2>
            <div id="trades" class="loading panel-scroll">Loading recent trades…</div>
          </article>
          <article class="panel panel-compact">
            <h2><span class="label-with-hint"><span class="hint-text" title="Simulated open positions with their TP/SL levels and current marked value.">Open Positions</span></span></h2>
            <div id="positions" class="loading panel-scroll">Loading open positions…</div>
          </article>
          <article class="panel panel-compact">
            <h2><span class="label-with-hint"><span class="hint-text" title="Ingestion freshness and service runtime health indicators.">Health</span></span></h2>
            <div id="health" class="loading">Loading service health…</div>
          </article>
        </div>
      </section>
    </div>
    <script>
      const pollIntervalMs = ${config.DASHBOARD_POLL_INTERVAL_MS};

      function formatNumber(value, digits = 3) {
        return value === null || value === undefined ? "—" : Number(value).toFixed(digits);
      }

      function formatTimestamp(value) {
        return value ? new Date(value).toLocaleTimeString() : "—";
      }

      function renderHintLabel(label, hint) {
        return '<span class="label-with-hint"><span class="hint-text" title="' + hint + '">' + label + '</span></span>';
      }

      function renderTableShell(tableHtml) {
        return '<div class="panel-scroll">' + tableHtml + '</div>';
      }

      function renderConvictionLabel(positionSizeSuggestion) {
        let convictionLabel = '<span class="pill">LOW</span>';
        if (positionSizeSuggestion >= 0.7) {
          convictionLabel = '<span class="pill up">HIGH</span>';
        } else {
          if (positionSizeSuggestion >= 0.45) {
            convictionLabel = '<span class="pill">MED</span>';
          }
        }
        return convictionLabel;
      }

      function renderActionLabel(decision) {
        let actionLabel = '<span class="pill down">NO TRADE</span>';
        if (decision.isEntryAllowed && decision.positionSide === 'up') {
          actionLabel = '<span class="pill up">BUY UP</span>';
        }
        if (decision.isEntryAllowed && decision.positionSide === 'down') {
          actionLabel = '<span class="pill down">BUY DOWN</span>';
        }
        return actionLabel;
      }

      function humanizeReason(reasonCode) {
        let humanReason = reasonCode;
        if (reasonCode === 'no_prediction') {
          humanReason = 'no valid prediction';
        }
        if (reasonCode === 'position_already_open') {
          humanReason = 'position already open';
        }
        if (reasonCode === 'invalid_direction') {
          humanReason = 'invalid direction';
        }
        if (reasonCode === 'no_reference_price') {
          humanReason = 'missing reference price';
        }
        if (reasonCode === 'market_not_live') {
          humanReason = 'market not live';
        }
        if (reasonCode === 'quality_too_low') {
          humanReason = 'data quality too low';
        }
        if (reasonCode === 'confidence_too_low') {
          humanReason = 'prediction too weak';
        }
        if (reasonCode === 'outside_entry_band') {
          humanReason = 'price too far from 0.5';
        }
        if (reasonCode === 'spread_too_wide') {
          humanReason = 'spread too wide';
        }
        if (reasonCode === 'market_score_too_low') {
          humanReason = 'market score too low';
        }
        if (reasonCode === 'order_notional_too_low') {
          humanReason = 'order below $1 minimum';
        }
        if (reasonCode === 'order_share_count_too_low') {
          humanReason = 'order below 5-share minimum';
        }
        if (reasonCode === 'maker_preferred') {
          humanReason = 'passive entry preferred';
        }
        if (reasonCode === 'tight_spread_take_liquidity') {
          humanReason = 'tight spread, cross now';
        }
        if (reasonCode === 'urgency_take_liquidity') {
          humanReason = 'urgent move, do not wait';
        }
        if (reasonCode === 'low_fill_probability') {
          humanReason = 'maker fill unlikely';
        }
        if (reasonCode === 'book_drift_take_liquidity') {
          humanReason = 'book moving away';
        }
        return humanReason;
      }

      function renderWhyNot(decision) {
        let whyNot = 'ready to trade';
        if (decision.isEntryAllowed) {
          if (decision.executionReason !== null) {
            whyNot = humanizeReason(decision.executionReason);
          }
        } else {
          if (decision.gateFailures.length > 0) {
            whyNot = decision.gateFailures.map((reasonCode) => humanizeReason(reasonCode)).join(', ');
          }
        }
        return whyNot;
      }

      function renderTriggerCode(triggerType) {
        let triggerCode = triggerType;
        if (triggerType === 'crossed_half') {
          triggerCode = 'XH';
        }
        if (triggerType === 'near_half') {
          triggerCode = 'NH';
        }
        return triggerCode;
      }

      function renderExecutionStyleCode(executionStyle) {
        let executionStyleCode = '—';
        if (executionStyle === 'maker') {
          executionStyleCode = 'M';
        }
        if (executionStyle === 'taker') {
          executionStyleCode = 'T';
        }
        return executionStyleCode;
      }

      function renderReasonCode(reasonCode) {
        let reasonShortCode = reasonCode;
        if (reasonCode === 'ready to trade') {
          reasonShortCode = 'READY';
        }
        if (reasonCode === 'no valid prediction') {
          reasonShortCode = 'NP';
        }
        if (reasonCode === 'position already open') {
          reasonShortCode = 'OPEN';
        }
        if (reasonCode === 'invalid direction') {
          reasonShortCode = 'DIR';
        }
        if (reasonCode === 'missing reference price') {
          reasonShortCode = 'NOREF';
        }
        if (reasonCode === 'market not live') {
          reasonShortCode = 'LIVE';
        }
        if (reasonCode === 'data quality too low') {
          reasonShortCode = 'QUAL';
        }
        if (reasonCode === 'prediction too weak') {
          reasonShortCode = 'CONF';
        }
        if (reasonCode === 'price too far from 0.5') {
          reasonShortCode = 'BAND';
        }
        if (reasonCode === 'spread too wide') {
          reasonShortCode = 'SPR';
        }
        if (reasonCode === 'market score too low') {
          reasonShortCode = 'MS';
        }
        if (reasonCode === 'order below $1 minimum') {
          reasonShortCode = 'MIN$';
        }
        if (reasonCode === 'order below 5-share minimum') {
          reasonShortCode = 'MIN5';
        }
        if (reasonCode === 'passive entry preferred') {
          reasonShortCode = 'M';
        }
        if (reasonCode === 'tight spread, cross now') {
          reasonShortCode = 'T-SPR';
        }
        if (reasonCode === 'urgent move, do not wait') {
          reasonShortCode = 'T-URG';
        }
        if (reasonCode === 'maker fill unlikely') {
          reasonShortCode = 'T-FILL';
        }
        if (reasonCode === 'book moving away') {
          reasonShortCode = 'T-DRIFT';
        }
        if (reasonCode === 'take_profit_hit') {
          reasonShortCode = 'TP';
        }
        if (reasonCode === 'stop_loss_hit') {
          reasonShortCode = 'SL';
        }
        return reasonShortCode;
      }

      function createMarketPerformanceMap(summary) {
        const marketPerformanceMap = {};
        for (const marketPerformance of summary.marketPerformance) {
          marketPerformanceMap[marketPerformance.marketKey] = marketPerformance;
        }
        return marketPerformanceMap;
      }

      function renderResultBadge(result) {
        let resultBadge = '<span class="pill">' + result.status.toUpperCase() + '</span>';
        if (result.status === "ok") {
          resultBadge = '<span class="pill up">OK</span>';
        }
        if (result.status === "ko") {
          resultBadge = '<span class="pill down">KO</span>';
        }
        return resultBadge;
      }

      function renderKpis(summary) {
        const entries = [
          ["Executable", "Markets that currently pass the entry gate and would allow a new paper trade.", summary.paperExecutionPerformance.executableEntryCount],
          ["Open pos", "Paper positions currently open or pending maker exit.", summary.paperExecutionPerformance.openPositionCount],
          ["Paper PnL", "Cumulative simulated net PnL after proxy execution costs.", formatNumber(summary.paperExecutionPerformance.cumulativeNetPnl)],
          ["Max DD", "Maximum rolling drawdown of the paper execution curve.", formatNumber(summary.paperExecutionPerformance.maxDrawdown)],
          ["Maker fill %", "Share of simulated trades where maker logic achieved a passive fill on at least one side.", (summary.paperExecutionPerformance.makerFillRate * 100).toFixed(1) + "%"],
        ];
        document.getElementById("kpis").innerHTML = entries.map(([label, hint, value]) => '<div class="kpi"><div class="tiny">' + renderHintLabel(label, hint) + '</div><strong>' + value + '</strong></div>').join("");
      }

      function renderMarkets(summary) {
        const marketPerformanceMap = createMarketPerformanceMap(summary);
        const rows = summary.markets.map((market) => {
          const qualityWidth = Math.max(0, Math.min(100, market.quality.score * 100));
          const qualityDetails = 'score ' + formatNumber(market.quality.score, 3) + (market.quality.issues.length === 0 ? ' · healthy' : ' · ' + market.quality.issues.join(', '));
          const marketPerformance = marketPerformanceMap[market.marketKey];
          const marketScore = marketPerformance ? formatNumber(marketPerformance.score, 2) : '—';
          const marketStatus = marketPerformance ? marketPerformance.status.replace('_', ' ') : 'warming up';
          return '<tr>' +
            '<td><strong>' + market.asset.toUpperCase() + '</strong> <span class="tiny">' + market.window + '</span></td>' +
            '<td>' + formatNumber(market.latestUpMidpoint) + '</td>' +
            '<td>' + formatNumber(market.latestDownMidpoint) + '</td>' +
            '<td>' + formatNumber(market.cooldownRemainingMs, 0) + '</td>' +
            '<td><span title="' + marketStatus + '">' + marketScore + '</span></td>' +
            '<td><span class="quality-cell" title="' + qualityDetails + '"><span>' + formatNumber(market.quality.score, 2) + '</span><div class="quality-bar"><span style="width:' + qualityWidth + '%"></span></div></span></td>' +
            '</tr>';
        }).join("");
        document.getElementById("markets").classList.remove("loading");
        document.getElementById("markets").innerHTML = renderTableShell('<table><thead><tr><th>' + renderHintLabel('Market', 'Asset and resolution window for the monitored Polymarket contract.') + '</th><th>' + renderHintLabel('UP mid', 'Current midpoint for the UP token. Falls back to price only outside the midpoint field, not in this display.') + '</th><th>' + renderHintLabel('DOWN mid', 'Current midpoint for the DOWN token.') + '</th><th>' + renderHintLabel('Cooldown', 'Milliseconds remaining before this market can emit another prediction.') + '</th><th>' + renderHintLabel('Mkt score', 'Recent trading score for this market only. It reflects local hit rate, PnL, drawdown, and sample size over the rolling market-score window.') + '</th><th>' + renderHintLabel('Quality', 'Continuous data quality score. It penalizes stale token timestamps, weak spot coverage, wide spreads, midpoint fallbacks, stale chainlink, and venue dispersion.') + '</th></tr></thead><tbody>' + rows + '</tbody></table>');
      }

      function renderPredictions(summary) {
        const rows = summary.latestPredictions.map((prediction) => {
          const directionClass = prediction.direction === "UP" ? "up" : "down";
          const triggerLabel = humanizeReason(prediction.trigger.triggerType) === prediction.trigger.triggerType
            ? prediction.trigger.triggerType.replace('_', ' ')
            : humanizeReason(prediction.trigger.triggerType);
          return '<tr>' +
            '<td><strong>' + prediction.asset.toUpperCase() + '</strong> <span class="tiny">' + prediction.window + '</span></td>' +
            '<td><span class="pill ' + directionClass + '">' + prediction.direction + '</span></td>' +
            '<td>' + formatNumber(prediction.confidence) + '</td>' +
            '<td><span title="' + triggerLabel + '">' + renderTriggerCode(prediction.trigger.triggerType) + '</span></td>' +
            '<td>' + renderResultBadge(prediction.result) + '</td>' +
            '<td>' + formatTimestamp(prediction.timestamp) + '</td>' +
            '</tr>';
        }).join("");
        document.getElementById("predictions").classList.remove("loading");
        document.getElementById("predictions").innerHTML = renderTableShell('<table><thead><tr><th>' + renderHintLabel('Market', 'Asset and resolution window for this prediction.') + '</th><th>' + renderHintLabel('Dir', 'Final ensemble direction predicted for the next 30 seconds.') + '</th><th>' + renderHintLabel('Conf', 'Normalized ensemble confidence between 0 and 1.') + '</th><th>' + renderHintLabel('Trig', 'Compact trigger code. NH = near half, XH = crossed half.') + '</th><th>' + renderHintLabel('Result', 'Pending until resolved, then OK for a win, KO for a loss, or VOID if data was insufficient.') + '</th><th>' + renderHintLabel('At', 'Prediction creation timestamp.') + '</th></tr></thead><tbody>' + rows + '</tbody></table>');
      }

      function renderStrategies(summary) {
        const rows = summary.strategies.map((strategy) => {
          return '<tr>' +
            '<td><strong title="' + strategy.description + '">' + strategy.name + '</strong><div class="tiny"><span class="hint-text" title="' + strategy.description + '">' + strategy.strategyId + ' · ' + strategy.tier + '</span></div></td>' +
            '<td>' + formatNumber(strategy.weight) + '</td>' +
            '<td>' + formatNumber(strategy.hitRate) + '</td>' +
            '<td>' + strategy.recentStreak + '</td>' +
            '</tr>';
        }).join("");
        document.getElementById("strategies").classList.remove("loading");
        document.getElementById("strategies").innerHTML = renderTableShell('<table><thead><tr><th>' + renderHintLabel('Strategy', 'Strategy name, internal id, cost tier, and hover hint with its role in the ensemble.') + '</th><th>' + renderHintLabel('Weight', 'Current adaptive ensemble weight after rolling online evaluation.') + '</th><th>' + renderHintLabel('Hit rate', 'Share of resolved predictions this strategy got right inside the rolling window.') + '</th><th>' + renderHintLabel('Streak', 'Positive for consecutive wins, negative for consecutive losses.') + '</th></tr></thead><tbody>' + rows + '</tbody></table>');
      }

      function renderExecution(summary) {
        const rows = summary.executionNow.map((marketExecution) => {
          const whyNot = renderWhyNot(marketExecution.decision);
          const reasonCode = renderReasonCode(whyNot);
          const marketScoreLabel =
            marketExecution.decision.marketScore === null
              ? '—'
              : formatNumber(marketExecution.decision.marketScore, 2) + ' / ' + marketExecution.decision.marketTradeCount;
          return '<tr>' +
            '<td><strong>' + marketExecution.asset.toUpperCase() + '</strong> <span class="tiny">' + marketExecution.window + '</span></td>' +
            '<td>' + renderActionLabel(marketExecution.decision) + '</td>' +
            '<td>' + formatNumber(marketExecution.decision.entryReferencePrice) + '</td>' +
            '<td>' + marketExecution.decision.orderShareCount + ' sh / ' + formatNumber(marketExecution.decision.orderNotionalUsd, 2) + '</td>' +
            '<td>' + formatNumber(marketExecution.decision.takeProfitPrice) + '</td>' +
            '<td>' + formatNumber(marketExecution.decision.stopLossPrice) + '</td>' +
            '<td><span title="' + (marketExecution.decision.executionStyle === null ? 'no execution style' : marketExecution.decision.executionStyle) + '">' + renderExecutionStyleCode(marketExecution.decision.executionStyle) + '</span></td>' +
            '<td>' + marketScoreLabel + '</td>' +
            '<td>' + renderConvictionLabel(marketExecution.decision.positionSizeSuggestion) + '</td>' +
            '<td><span class="truncate-cell" title="' + whyNot + '">' + reasonCode + '</span></td>' +
            '</tr>';
        }).join("");
        document.getElementById("execution").classList.remove("loading");
        document.getElementById("execution").innerHTML = renderTableShell('<table><thead><tr><th>' + renderHintLabel('Market', 'Asset and resolution window for the execution decision.') + '</th><th>' + renderHintLabel('Action', 'Clear action right now: BUY UP, BUY DOWN, or NO TRADE.') + '</th><th>' + renderHintLabel('Ref px', 'Current token price the execution overlay uses as the reference entry level.') + '</th><th>' + renderHintLabel('Size', 'Planned order size in shares and notional. Polymarket minimums require at least 5 shares and at least $1.') + '</th><th>' + renderHintLabel('Target', 'Take-profit price for this potential trade.') + '</th><th>' + renderHintLabel('Risk', 'Stop-loss price for this potential trade.') + '</th><th>' + renderHintLabel('Exec', 'Compact execution code. M = maker, T = taker.') + '</th><th>' + renderHintLabel('Mkt score', 'Recent market-only score followed by recent trade count. Low scored markets can be blocked even if the signal is valid.') + '</th><th>' + renderHintLabel('Conviction', 'Simplified trade strength derived from confidence, quality, and book risk.') + '</th><th>' + renderHintLabel('Why', 'Compact reason code. Hover each cell for the full explanation.') + '</th></tr></thead><tbody>' + rows + '</tbody></table>');
      }

      function renderPositions(summary) {
        const rows = summary.openPositions.map((position) => {
          return '<tr>' +
            '<td><strong>' + position.asset.toUpperCase() + '</strong> <span class="tiny">' + position.window + '</span></td>' +
            '<td>' + position.positionSide.toUpperCase() + '</td>' +
            '<td>' + position.status + '</td>' +
            '<td>' + position.shareCount + '</td>' +
            '<td>' + formatNumber(position.entryFillPrice) + '</td>' +
            '<td>' + formatNumber(position.liveTokenPrice) + '</td>' +
            '<td>' + formatNumber(position.unrealizedPnlTokenPrice) + '</td>' +
            '<td>' + formatNumber(position.takeProfitPrice) + '</td>' +
            '<td>' + formatNumber(position.stopLossPrice) + '</td>' +
            '</tr>';
        }).join("");
        document.getElementById("positions").classList.remove("loading");
        document.getElementById("positions").innerHTML = summary.openPositions.length === 0
          ? '<div class="tiny">No open paper positions.</div>'
          : renderTableShell('<table><thead><tr><th>' + renderHintLabel('Market', 'Asset and window of the open paper position.') + '</th><th>' + renderHintLabel('Side', 'Token currently held: UP or DOWN.') + '</th><th>' + renderHintLabel('Status', 'Position lifecycle state, including maker-pending statuses.') + '</th><th>' + renderHintLabel('Qty', 'Position size in shares. The execution overlay respects the 5-share minimum.') + '</th><th>' + renderHintLabel('Entry fill', 'Simulated fill price used to open the position.') + '</th><th>' + renderHintLabel('Live px', 'Current token midpoint or fallback price for mark-to-market.') + '</th><th>' + renderHintLabel('uPnL', 'Unrealized token-price PnL after scaling by the current share count, before paper execution costs.') + '</th><th>' + renderHintLabel('TP', 'Take-profit target for this open position.') + '</th><th>' + renderHintLabel('SL', 'Stop-loss level for this open position.') + '</th></tr></thead><tbody>' + rows + '</tbody></table>');
      }

      function renderTrades(summary) {
        const rows = summary.recentTrades.map((trade) => {
          return '<tr>' +
            '<td><strong>' + trade.asset.toUpperCase() + '</strong> <span class="tiny">' + trade.window + '</span></td>' +
            '<td>' + trade.positionSide.toUpperCase() + '</td>' +
            '<td>' + trade.shareCount + '</td>' +
            '<td><span title="' + trade.entryExecutionStyle + '">' + renderExecutionStyleCode(trade.entryExecutionStyle) + '</span></td>' +
            '<td><span title="' + trade.exitExecutionStyle + '">' + renderExecutionStyleCode(trade.exitExecutionStyle) + '</span></td>' +
            '<td><span title="' + trade.exitReason.replace('_', ' ') + '">' + renderReasonCode(trade.exitReason) + '</span></td>' +
            '<td>' + formatNumber(trade.realizedPnlAfterCosts) + '</td>' +
            '<td>' + formatNumber(trade.holdTimeMs, 0) + '</td>' +
            '</tr>';
        }).join("");
        document.getElementById("trades").classList.remove("loading");
        document.getElementById("trades").innerHTML = summary.recentTrades.length === 0
          ? '<div class="tiny">No closed paper trades yet.</div>'
          : renderTableShell('<table><thead><tr><th>' + renderHintLabel('Market', 'Asset and window of the closed paper trade.') + '</th><th>' + renderHintLabel('Side', 'Token that was bought for the trade.') + '</th><th>' + renderHintLabel('Qty', 'Filled share count used for the trade. Polymarket minimums require at least 5 shares and at least $1 of notional.') + '</th><th>' + renderHintLabel('In', 'Entry execution code. M = maker, T = taker.') + '</th><th>' + renderHintLabel('Out', 'Exit execution code. M = maker, T = taker.') + '</th><th>' + renderHintLabel('Exit', 'Exit reason code. TP = take profit, SL = stop loss.') + '</th><th>' + renderHintLabel('Net PnL', 'Realized simulated PnL after proxy entry and exit costs, scaled by the executed share count.') + '</th><th>' + renderHintLabel('Hold time', 'Milliseconds between entry fill and exit fill.') + '</th></tr></thead><tbody>' + rows + '</tbody></table>');
      }

      function renderHealth(summary) {
        document.getElementById("health").classList.remove("loading");
        document.getElementById("health").innerHTML =
          '<div class="health-grid">' +
            '<div class="health-item"><strong>' + summary.health.serviceName + '</strong><div class="tiny">' + renderHintLabel('Started', 'Timestamp when the current service runtime booted.') + ': ' + formatTimestamp(summary.health.startedAt) + '</div></div>' +
            '<div class="health-item"><strong>' + formatNumber(summary.health.snapshotAgeMs, 0) + ' ms</strong><div class="tiny">' + renderHintLabel('Snapshot age', 'Milliseconds since the last snapshot was processed by the service.') + '</div></div>' +
            '<div class="health-item"><strong>' + summary.health.isSnapshotHealthy + '</strong><div class="tiny">' + renderHintLabel('Healthy', 'True when the latest snapshot is fresh enough according to configured freshness thresholds.') + '</div></div>' +
            '<div class="health-item"><strong>' + summary.health.pendingEvaluationCount + '</strong><div class="tiny">' + renderHintLabel('Pending evals', 'Number of predictions still waiting for automatic 30-second resolution.') + '</div></div>' +
            '<div class="health-item"><strong>' + (summary.makerTakerStats.makerUsageRatio * 100).toFixed(1) + '%</strong><div class="tiny">' + renderHintLabel('Maker usage', 'Share of recent trades opened as maker.') + '</div></div>' +
            '<div class="health-item"><strong>' + (summary.makerTakerStats.takerUsageRatio * 100).toFixed(1) + '%</strong><div class="tiny">' + renderHintLabel('Taker usage', 'Share of recent trades opened as taker.') + '</div></div>' +
          '</div>';
      }

      async function refresh() {
        const response = await fetch('/v1/dashboard/summary', { headers: { accept: 'application/json' } });
        const summary = await response.json();
        renderKpis(summary);
        renderMarkets(summary);
        renderPredictions(summary);
        renderExecution(summary);
        renderStrategies(summary);
        renderPositions(summary);
        renderTrades(summary);
        renderHealth(summary);
      }

      refresh();
      setInterval(refresh, pollIntervalMs);
    </script>
  </body>
</html>`;
    return html;
  }
}
