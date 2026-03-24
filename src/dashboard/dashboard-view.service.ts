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
      .panel-intro {
        margin: -2px 0 12px;
        max-width: 58ch;
        line-height: 1.45;
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
            <p class="tiny panel-intro">Snapshot of the monitored markets right now. It lets you check price level, data freshness, and whether the market quality is good enough to trust what comes later.</p>
            <div id="markets" class="loading panel-scroll">Loading market state…</div>
          </article>
          <article class="panel panel-medium">
            <h2><span class="label-with-hint"><span class="hint-text" title="Current executable entry decision per market: side, TP, SL, and maker versus taker choice.">Execution Now</span></span></h2>
            <p class="tiny panel-intro">This is the actual trading gate. It shows which markets are executable, what side and levels the engine prefers, and which rule is blocking entry when no trade should be taken.</p>
            <div id="execution" class="loading panel-scroll">Loading execution decisions…</div>
          </article>
          <article class="panel panel-tall">
            <h2><span class="label-with-hint"><span class="hint-text" title="Most recent predictions that completed through a paper-trade TP or SL exit.">Resolved Predictions</span></span></h2>
            <p class="tiny panel-intro">Recent predictions that already finished their lifecycle. Use it to judge whether the engine is reading direction well once ideas are forced to end as TP or SL outcomes.</p>
            <div id="predictions" class="loading panel-scroll">Loading resolved predictions…</div>
          </article>
          <article class="panel panel-medium">
            <h2><span class="label-with-hint"><span class="hint-text" title="How much recent predictions changed after combo boosts or combo disagreement penalties.">Combo Influence</span></span></h2>
            <p class="tiny panel-intro">Shows how dynamic pairs and trios are altering the base signal. If confidence moves a lot here, combos are heavily shaping the final view instead of just the standalone strategies.</p>
            <div id="combo-influence" class="loading panel-scroll">Loading combo influence…</div>
          </article>
        </div>
        <div class="stack">
          <article class="panel panel-tall">
            <h2><span class="label-with-hint"><span class="hint-text" title="Per-market strategy board. The selected market uses local weights and local rolling performance, not the global aggregate.">Strategies</span></span></h2>
            <p class="tiny panel-intro">Breakdown of the individual strategies behind the ensemble for the selected market. It tells you who is contributing, with what weight, and which signals are actually earning trust.</p>
            <div id="strategies" class="loading panel-scroll">Loading strategy ranking…</div>
          </article>
          <article class="panel panel-medium">
            <h2><span class="label-with-hint"><span class="hint-text" title="Per-market paper trading PnL, hit rate, and drawdown so you can see which markets are actually worth trading.">Market PnL</span></span></h2>
            <p class="tiny panel-intro">Performance summary by market. It helps separate markets that look interesting for research from markets that are actually proving they deserve execution capital.</p>
            <div id="market-pnl" class="loading panel-scroll">Loading market pnl…</div>
          </article>
          <article class="panel panel-medium">
            <h2><span class="label-with-hint"><span class="hint-text" title="Best current pairs and trios by market, ranked by combo score and lift over their best member.">Top Combos</span></span></h2>
            <p class="tiny panel-intro">Best dynamic pairs and trios discovered by the engine. This is the fast way to see which combinations are strong enough to open the combo gate and support a real execution decision.</p>
            <div id="combos" class="loading panel-scroll">Loading combo ranking…</div>
          </article>
          <article class="panel panel-medium">
            <h2><span class="label-with-hint"><span class="hint-text" title="Most recent closed paper trades, including maker/taker styles and exit reasons.">Recent Trades</span></span></h2>
            <p class="tiny panel-intro">Closed paper trades only. It shows what the system really executed, how those trades ended, and whether execution quality is matching what the research layer suggests.</p>
            <div id="trades" class="loading panel-scroll">Loading recent trades…</div>
          </article>
          <article class="panel panel-compact">
            <h2><span class="label-with-hint"><span class="hint-text" title="Simulated open positions with their TP/SL levels and current marked value.">Open Positions</span></span></h2>
            <p class="tiny panel-intro">Current paper positions that are still alive. Use this panel to understand active exposure, where TP and SL sit, and what risk is still on the table right now.</p>
            <div id="positions" class="loading panel-scroll">Loading open positions…</div>
          </article>
          <article class="panel panel-compact">
            <h2><span class="label-with-hint"><span class="hint-text" title="Ingestion freshness and service runtime health indicators.">Health</span></span></h2>
            <p class="tiny panel-intro">Operational status of the feed and the service itself. If another panel looks suspicious, check here first to confirm the data is fresh and the runtime is behaving normally.</p>
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
        if (reasonCode === 'combo_gate_failed') {
          humanReason = 'combo gate failed';
        }
        if (reasonCode === 'cross_asset_regime_conflict') {
          humanReason = 'cross-asset regime conflict';
        }
        if (reasonCode === 'execution_score_too_low') {
          humanReason = 'execution score too low';
        }
        if (reasonCode === 'insufficient_execution_history') {
          humanReason = 'insufficient execution history';
        }
        if (reasonCode === 'bootstrap_discount_too_low') {
          humanReason = 'bootstrap discount too low';
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
        if (reasonCode === 'market_warming_up') {
          humanReason = 'market still warming up';
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

      function renderReasonCodes(decision) {
        let reasonCodes = 'READY';
        if (decision.isEntryAllowed) {
          if (decision.executionReason !== null) {
            reasonCodes = renderReasonCode(humanizeReason(decision.executionReason));
          }
        } else {
          if (decision.gateFailures.length > 0) {
            reasonCodes = decision.gateFailures
              .map((reasonCode) => renderReasonCode(humanizeReason(reasonCode)))
              .join('+');
          }
        }
        return reasonCodes;
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

      function renderStatusCode(status) {
        let statusCode = status;
        if (status === 'entry_pending_maker') {
          statusCode = 'EPM';
        }
        if (status === 'open') {
          statusCode = 'OPN';
        }
        if (status === 'exit_pending_maker') {
          statusCode = 'XPM';
        }
        if (status === 'closed') {
          statusCode = 'CLD';
        }
        if (status === 'idle') {
          statusCode = 'IDL';
        }
        return statusCode;
      }

      function renderReasonCode(reasonCode) {
        let reasonShortCode = reasonCode;
        if (reasonCode === 'ready to trade') {
          reasonShortCode = 'RDY';
        }
        if (reasonCode === 'no valid prediction') {
          reasonShortCode = 'NPR';
        }
        if (reasonCode === 'position already open') {
          reasonShortCode = 'OPN';
        }
        if (reasonCode === 'invalid direction') {
          reasonShortCode = 'DIR';
        }
        if (reasonCode === 'missing reference price') {
          reasonShortCode = 'REF';
        }
        if (reasonCode === 'market not live') {
          reasonShortCode = 'LIV';
        }
        if (reasonCode === 'data quality too low') {
          reasonShortCode = 'QLT';
        }
        if (reasonCode === 'prediction too weak') {
          reasonShortCode = 'CNF';
        }
        if (reasonCode === 'combo gate failed') {
          reasonShortCode = 'CMB';
        }
        if (reasonCode === 'cross-asset regime conflict') {
          reasonShortCode = 'XRG';
        }
        if (reasonCode === 'execution score too low') {
          reasonShortCode = 'EXE';
        }
        if (reasonCode === 'insufficient execution history') {
          reasonShortCode = 'HIS';
        }
        if (reasonCode === 'bootstrap discount too low') {
          reasonShortCode = 'BST';
        }
        if (reasonCode === 'price too far from 0.5') {
          reasonShortCode = 'BND';
        }
        if (reasonCode === 'spread too wide') {
          reasonShortCode = 'SPR';
        }
        if (reasonCode === 'market score too low') {
          reasonShortCode = 'MSC';
        }
        if (reasonCode === 'market still warming up') {
          reasonShortCode = 'WRM';
        }
        if (reasonCode === 'order below $1 minimum') {
          reasonShortCode = 'MIN$';
        }
        if (reasonCode === 'order below 5-share minimum') {
          reasonShortCode = 'MIN5';
        }
        if (reasonCode === 'passive entry preferred') {
          reasonShortCode = 'MAK';
        }
        if (reasonCode === 'tight spread, cross now') {
          reasonShortCode = 'TSP';
        }
        if (reasonCode === 'urgent move, do not wait') {
          reasonShortCode = 'URG';
        }
        if (reasonCode === 'maker fill unlikely') {
          reasonShortCode = 'FIL';
        }
        if (reasonCode === 'book moving away') {
          reasonShortCode = 'DRF';
        }
        if (reasonCode === 'take_profit_hit') {
          reasonShortCode = 'TP';
        }
        if (reasonCode === 'stop_loss_hit') {
          reasonShortCode = 'SL';
        }
        return reasonShortCode;
      }

      function renderMarketStatusCode(status) {
        let marketStatusCode = 'WRM';
        if (status === 'research_only') {
          marketStatusCode = 'RSC';
        }
        if (status === 'tradable') {
          marketStatusCode = 'TRD';
        }
        if (status === 'avoid') {
          marketStatusCode = 'AVD';
        }
        return marketStatusCode;
      }

      function buildLatestPredictionMap(summary) {
        const latestPredictionMap = {};
        for (const prediction of summary.latestPredictions) {
          if (latestPredictionMap[prediction.marketKey] === undefined) {
            latestPredictionMap[prediction.marketKey] = prediction;
          }
        }
        return latestPredictionMap;
      }

      function createMarketPerformanceMap(summary) {
        const marketPerformanceMap = {};
        for (const marketPerformance of summary.marketPerformance) {
          marketPerformanceMap[marketPerformance.marketKey] = marketPerformance;
        }
        return marketPerformanceMap;
      }

      function createExecutionDecisionMap(summary) {
        const executionDecisionMap = {};
        for (const marketExecution of summary.executionNow) {
          executionDecisionMap[marketExecution.marketKey] = marketExecution.decision;
        }
        return executionDecisionMap;
      }

      function renderCrossAssetLabel(crossAssetRegime) {
        let crossAssetLabel = 'NEU';
        if (crossAssetRegime && crossAssetRegime.hasStrongBreadth && crossAssetRegime.breadthDirection !== 'NEUTRAL') {
          crossAssetLabel = crossAssetRegime.breadthDirection + ' ' + formatNumber(crossAssetRegime.breadthStrength, 2);
        }
        return crossAssetLabel;
      }

      function renderCrossAssetHover(crossAssetRegime) {
        let crossAssetHover = 'no strong cross-asset breadth regime';
        if (crossAssetRegime && crossAssetRegime.hasStrongBreadth && crossAssetRegime.breadthDirection !== 'NEUTRAL') {
          crossAssetHover =
            'strong ' +
            crossAssetRegime.breadthDirection.toLowerCase() +
            ' breadth, strength ' +
            formatNumber(crossAssetRegime.breadthStrength, 2) +
            ', participation ' +
            formatNumber(crossAssetRegime.breadthParticipation, 2) +
            ', leader ' +
            (crossAssetRegime.leaderMarketKey ?? 'unknown');
        }
        return crossAssetHover;
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
        const executionDecisionMap = createExecutionDecisionMap(summary);
        const rows = summary.markets.map((market) => {
          const qualityWidth = Math.max(0, Math.min(100, market.quality.score * 100));
          const qualityDetails = 'score ' + formatNumber(market.quality.score, 3) + (market.quality.issues.length === 0 ? ' · healthy' : ' · ' + market.quality.issues.join(', '));
          const marketPerformance = marketPerformanceMap[market.marketKey];
          const executionDecision = executionDecisionMap[market.marketKey];
          const marketScore = marketPerformance ? formatNumber(marketPerformance.score, 2) : '—';
          const marketStatus = marketPerformance ? marketPerformance.status.replace('_', ' ') : 'warming up';
          const regimeLabel =
            executionDecision === undefined
              ? 'NEU'
              : renderCrossAssetLabel({
                  breadthDirection: executionDecision.breadthDirection,
                  breadthStrength: executionDecision.breadthStrength,
                  breadthParticipation: 0,
                  leaderMarketKey: null,
                  hasStrongBreadth: executionDecision.hasStrongBreadth,
                });
          const regimeHover =
            executionDecision === undefined
              ? 'no execution decision yet'
              : executionDecision.hasStrongBreadth
                ? 'strong ' + executionDecision.breadthDirection.toLowerCase() + ' breadth, strength ' + formatNumber(executionDecision.breadthStrength, 2)
                : 'no strong cross-asset breadth regime';
          return '<tr>' +
            '<td><strong>' + market.asset.toUpperCase() + '</strong> <span class="tiny">' + market.window + '</span></td>' +
            '<td>' + formatNumber(market.latestUpMidpoint) + '</td>' +
            '<td>' + formatNumber(market.latestDownMidpoint) + '</td>' +
            '<td>' + formatNumber(market.cooldownRemainingMs, 0) + '</td>' +
            '<td><span title="' + marketStatus + '">' + marketScore + '</span></td>' +
            '<td><span title="' + regimeHover + '">' + regimeLabel + '</span></td>' +
            '<td><span class="quality-cell" title="' + qualityDetails + '"><span>' + formatNumber(market.quality.score, 2) + '</span><div class="quality-bar"><span style="width:' + qualityWidth + '%"></span></div></span></td>' +
            '</tr>';
        }).join("");
        document.getElementById("markets").classList.remove("loading");
        document.getElementById("markets").innerHTML = renderTableShell('<table><thead><tr><th>' + renderHintLabel('Market', 'Asset and resolution window for the monitored Polymarket contract.') + '</th><th>' + renderHintLabel('UP mid', 'Current midpoint for the UP token. Falls back to price only outside the midpoint field, not in this display.') + '</th><th>' + renderHintLabel('DOWN mid', 'Current midpoint for the DOWN token.') + '</th><th>' + renderHintLabel('Cooldown', 'Milliseconds remaining before this market can emit another prediction.') + '</th><th>' + renderHintLabel('Mkt score', 'Recent trading score for this market only. It reflects local hit rate, PnL, drawdown, and sample size over the rolling market-score window.') + '</th><th>' + renderHintLabel('Regime', 'Current cross-asset breadth regime for this window. It tells you whether the whole crypto set is moving together.') + '</th><th>' + renderHintLabel('Quality', 'Continuous data quality score. It penalizes stale token timestamps, weak spot coverage, wide spreads, midpoint fallbacks, stale chainlink, and venue dispersion.') + '</th></tr></thead><tbody>' + rows + '</tbody></table>');
      }

      function renderPredictions(summary) {
        const rows = summary.latestPredictions.map((prediction) => {
          const directionClass = prediction.direction === "UP" ? "up" : "down";
          const triggerLabel = humanizeReason(prediction.trigger.triggerType) === prediction.trigger.triggerType
            ? prediction.trigger.triggerType.replace('_', ' ')
            : humanizeReason(prediction.trigger.triggerType);
          const regimeLabel = renderCrossAssetLabel(prediction.crossAssetRegime);
          const regimeHover = renderCrossAssetHover(prediction.crossAssetRegime);
          const leadLabel =
            prediction.crossAssetRegime.hasLeaderLaggardOpportunity
              ? 'LAG ' + formatNumber(prediction.crossAssetRegime.lagRatio, 2)
              : prediction.crossAssetRegime.leaderMarketKey === null
                ? '—'
                : prediction.crossAssetRegime.leaderMarketKey.toUpperCase();
          return '<tr>' +
            '<td><strong>' + prediction.asset.toUpperCase() + '</strong> <span class="tiny">' + prediction.window + '</span></td>' +
            '<td><span class="pill ' + directionClass + '">' + prediction.direction + '</span></td>' +
            '<td>' + formatNumber(prediction.confidence) + '</td>' +
            '<td><span title="' + triggerLabel + '">' + renderTriggerCode(prediction.trigger.triggerType) + '</span></td>' +
            '<td><span title="' + regimeHover + '">' + regimeLabel + '</span></td>' +
            '<td><span title="' + (prediction.crossAssetRegime.leaderMarketKey ?? 'no clear leader market') + '">' + leadLabel + '</span></td>' +
            '<td>' + renderResultBadge(prediction.result) + '</td>' +
            '<td>' + formatTimestamp(prediction.timestamp) + '</td>' +
            '</tr>';
        }).join("");
        document.getElementById("predictions").classList.remove("loading");
        document.getElementById("predictions").innerHTML = renderTableShell('<table><thead><tr><th>' + renderHintLabel('Market', 'Asset and resolution window for this prediction.') + '</th><th>' + renderHintLabel('Dir', 'Final ensemble direction that was traded.') + '</th><th>' + renderHintLabel('Conf', 'Normalized ensemble confidence between 0 and 1.') + '</th><th>' + renderHintLabel('Trig', 'Compact trigger code. NH = near half, XH = crossed half.') + '</th><th>' + renderHintLabel('Regime', 'Cross-asset breadth regime attached to this prediction at creation time.') + '</th><th>' + renderHintLabel('Lead', 'Leader market or lag marker. LAG means this market looked like a catch-up candidate.') + '</th><th>' + renderHintLabel('Result', 'OK means the trade hit take profit. KO means it hit stop loss.') + '</th><th>' + renderHintLabel('At', 'Prediction creation timestamp.') + '</th></tr></thead><tbody>' + rows + '</tbody></table>');
      }

      function renderStrategies(summary) {
        const selectedBoard = summary.strategyBoards.find((strategyBoard) => strategyBoard.marketKey === summary.selectedStrategyMarketKey) ?? summary.strategyBoards[0];
        const comboBoard = summary.comboBoards.find((marketComboBoard) => marketComboBoard.marketKey === selectedBoard?.marketKey);
        const latestPredictionMap = buildLatestPredictionMap(summary);
        const selectedPrediction = selectedBoard ? latestPredictionMap[selectedBoard.marketKey] : null;
        const comboMemberMap = {};
        if (comboBoard) {
          for (const comboSummary of [...comboBoard.topPairs, ...comboBoard.topTrios]) {
            if (comboSummary.status === 'good') {
              for (const memberStrategyId of comboSummary.memberStrategyIds) {
                comboMemberMap[memberStrategyId] = comboSummary.size === 2 ? 'C2' : 'C3';
              }
            }
          }
        }
        const rows = (selectedBoard?.strategies ?? []).map((strategy) => {
          const comboCode = comboMemberMap[strategy.strategyId] ?? '—';
          return '<tr>' +
            '<td><strong title="' + strategy.description + '">' + strategy.name + '</strong><div class="tiny"><span class="hint-text" title="' + strategy.description + '">' + strategy.strategyId + ' · ' + strategy.tier + '</span></div></td>' +
            '<td>' + formatNumber(strategy.weight) + '</td>' +
            '<td>' + formatNumber(strategy.hitRate) + '</td>' +
            '<td>' + formatNumber(strategy.cumulativePnlProxy) + '</td>' +
            '<td>' + formatNumber(strategy.averagePnlProxy) + ' / ' + formatNumber(strategy.executionAveragePnlProxy) + '</td>' +
            '<td>' + strategy.recentStreak + '</td>' +
            '<td><span title="' + (comboCode === '—' ? 'no current strong combo' : 'member of a strong combo on this market') + '">' + comboCode + '</span></td>' +
            '</tr>';
        }).join("");
        document.getElementById("strategies").classList.remove("loading");
        document.getElementById("strategies").innerHTML =
          '<div class="tiny" style="margin-bottom:8px">' +
            renderHintLabel('Selected market', 'This strategy board uses local weights and local rolling performance for one market only.') +
            ': ' +
            (selectedBoard?.marketKey ?? '—') +
            '</div>' +
          '<div class="tiny" style="margin-bottom:10px">' +
            renderHintLabel('Cross-asset regime', 'Latest breadth regime attached to the selected market. This helps explain why the new global strategies may be active.') +
            ': ' +
            (selectedPrediction ? renderCrossAssetLabel(selectedPrediction.crossAssetRegime) : 'NEU') +
            ' · leader ' +
            (selectedPrediction?.crossAssetRegime.leaderMarketKey ?? '—') +
            ' · lag ' +
            (selectedPrediction ? formatNumber(selectedPrediction.crossAssetRegime.lagRatio, 2) : '—') +
            '</div>' +
          renderTableShell('<table><thead><tr><th>' + renderHintLabel('Str', 'Strategy name, internal id, cost tier, and hover hint with its role in the ensemble.') + '</th><th>' + renderHintLabel('Wgt', 'Current market-local adaptive ensemble weight.') + '</th><th>' + renderHintLabel('Hit', 'Share of resolved research predictions this strategy got right inside the rolling time window for the selected market.') + '</th><th>' + renderHintLabel('PnL', 'Cumulative research PnL proxy for the selected market.') + '</th><th>' + renderHintLabel('Avg', 'Average research / execution PnL proxy per resolved signal.') + '</th><th>' + renderHintLabel('Stk', 'Positive for consecutive wins, negative for consecutive losses.') + '</th><th>' + renderHintLabel('Cx', 'Combo marker. C2 means the strategy belongs to a strong pair, C3 to a strong trio.') + '</th></tr></thead><tbody>' + rows + '</tbody></table>');
      }

      function renderExecution(summary) {
        const rows = summary.executionNow.map((marketExecution) => {
          const whyNot = renderWhyNot(marketExecution.decision);
          const reasonCodes = renderReasonCodes(marketExecution.decision);
          const comboCode = marketExecution.decision.selectedComboKey ?? '—';
          const comboHover =
            marketExecution.decision.selectedComboKey === null
              ? 'no execution combo selected'
              : marketExecution.decision.selectedComboKey + ' via ' + (marketExecution.decision.selectedComboSource ?? 'unknown');
          const marketScoreLabel =
            marketExecution.decision.marketScore === null
              ? '—'
              : formatNumber(marketExecution.decision.marketScore, 2) + ' / ' + marketExecution.decision.marketTradeCount;
          const scoreLabel =
            marketExecution.decision.researchScore === null
              ? '—'
              : formatNumber(marketExecution.decision.researchScore, 2) + ' / ' + formatNumber(marketExecution.decision.executionScore) + ' / ' + formatNumber(marketExecution.decision.effectiveExecutionScore, 2);
          const comboGateLabel = marketExecution.decision.hasComboGatePassed ? '<span class="pill up">OPEN</span>' : '<span class="pill down">BLOCK</span>';
          const breadthLabel =
            !marketExecution.decision.hasStrongBreadth || marketExecution.decision.breadthDirection === 'NEUTRAL'
              ? 'NEU'
              : marketExecution.decision.breadthDirection + ' ' + formatNumber(marketExecution.decision.breadthStrength, 2);
          const breadthHover =
            !marketExecution.decision.hasStrongBreadth || marketExecution.decision.breadthDirection === 'NEUTRAL'
              ? 'no strong cross-asset breadth regime'
              : 'strong ' + marketExecution.decision.breadthDirection.toLowerCase() + ' breadth, strength ' + formatNumber(marketExecution.decision.breadthStrength, 2);
          return '<tr>' +
            '<td><strong>' + marketExecution.asset.toUpperCase() + '</strong> <span class="tiny">' + marketExecution.window + '</span></td>' +
            '<td>' + renderActionLabel(marketExecution.decision) + '</td>' +
            '<td>' + formatNumber(marketExecution.decision.entryReferencePrice) + '</td>' +
            '<td>' + marketExecution.decision.orderShareCount + ' sh / ' + formatNumber(marketExecution.decision.orderNotionalUsd, 2) + '</td>' +
            '<td>' + formatNumber(marketExecution.decision.takeProfitPrice) + '</td>' +
            '<td>' + formatNumber(marketExecution.decision.stopLossPrice) + '</td>' +
            '<td><span title="' + (marketExecution.decision.executionStyle === null ? 'no execution style' : marketExecution.decision.executionStyle) + '">' + renderExecutionStyleCode(marketExecution.decision.executionStyle) + '</span></td>' +
            '<td>' + scoreLabel + '</td>' +
            '<td><span title="' + breadthHover + '">' + breadthLabel + '</span></td>' +
            '<td>' + comboGateLabel + '</td>' +
            '<td><span title="' + comboHover + '">' + comboCode + '</span></td>' +
            '<td>' + marketScoreLabel + '</td>' +
            '<td>' + renderConvictionLabel(marketExecution.decision.positionSizeSuggestion) + '</td>' +
            '<td><span class="truncate-cell" title="' + whyNot + '">' + reasonCodes + '</span></td>' +
            '</tr>';
        }).join("");
        document.getElementById("execution").classList.remove("loading");
        document.getElementById("execution").innerHTML = renderTableShell('<table><thead><tr><th>' + renderHintLabel('Market', 'Asset and resolution window for the execution decision.') + '</th><th>' + renderHintLabel('Action', 'Clear action right now: BUY UP, BUY DOWN, or NO TRADE.') + '</th><th>' + renderHintLabel('Ref px', 'Current token price the execution overlay uses as the reference entry level.') + '</th><th>' + renderHintLabel('Size', 'Planned order size in shares and notional. Polymarket minimums require at least 5 shares and at least $1.') + '</th><th>' + renderHintLabel('Target', 'Take-profit price for this potential trade.') + '</th><th>' + renderHintLabel('Risk', 'Stop-loss price for this potential trade.') + '</th><th>' + renderHintLabel('Exec', 'Compact execution code. M = maker, T = taker.') + '</th><th>' + renderHintLabel('Scores', 'Research / execution / effective execution score for this market.') + '</th><th>' + renderHintLabel('Regime', 'Cross-asset breadth regime for this window. Strong aligned market-wide moves are shown as UP or DOWN plus strength.') + '</th><th>' + renderHintLabel('Combo', 'Whether the combo gate is open or blocked.') + '</th><th>' + renderHintLabel('Combo key', 'Selected pair or trio used by the execution gate.') + '</th><th>' + renderHintLabel('Mkt score', 'Effective execution score followed by recent trade count.') + '</th><th>' + renderHintLabel('Conviction', 'Simplified trade strength derived from confidence, quality, and book risk.') + '</th><th>' + renderHintLabel('Why', 'Compact reason code. Hover each cell for the full explanation.') + '</th></tr></thead><tbody>' + rows + '</tbody></table>');
      }

      function renderMarketPnl(summary) {
        const rows = summary.marketPnlTable.map((marketPerformance) => {
          return '<tr>' +
            '<td><strong>' + marketPerformance.marketKey.replace(':', ' ') + '</strong></td>' +
            '<td>' + marketPerformance.tradeCount + '</td>' +
            '<td>' + formatNumber(marketPerformance.winRate, 2) + '</td>' +
            '<td>' + formatNumber(marketPerformance.cumulativeNetPnl) + '</td>' +
            '<td>' + formatNumber(marketPerformance.averageNetPnlPerTrade) + '</td>' +
            '<td>' + formatNumber(marketPerformance.maxDrawdown) + '</td>' +
            '<td>' + formatNumber(marketPerformance.researchScore, 2) + ' / ' + formatNumber(marketPerformance.executionScore) + ' / ' + formatNumber(marketPerformance.effectiveExecutionScore, 2) + '</td>' +
            '<td><span title="' + marketPerformance.status.replace('_', ' ') + '">' + renderMarketStatusCode(marketPerformance.status) + '</span></td>' +
            '</tr>';
        }).join('');
        document.getElementById('market-pnl').classList.remove('loading');
        document.getElementById('market-pnl').innerHTML = renderTableShell('<table><thead><tr><th>' + renderHintLabel('Mkt', 'Market key.') + '</th><th>' + renderHintLabel('Trd', 'Number of recent closed paper trades in this market.') + '</th><th>' + renderHintLabel('Hit', 'Recent paper trade hit rate in this market.') + '</th><th>' + renderHintLabel('PnL', 'Cumulative recent paper net PnL for this market.') + '</th><th>' + renderHintLabel('Avg', 'Average net PnL per trade in this market.') + '</th><th>' + renderHintLabel('DD', 'Maximum rolling drawdown proxy for this market.') + '</th><th>' + renderHintLabel('Scr', 'Research / execution / effective execution score.') + '</th><th>' + renderHintLabel('St', 'Market status. WRM = warming up, RSC = research only, TRD = tradable, AVD = avoid.') + '</th></tr></thead><tbody>' + rows + '</tbody></table>');
      }

      function renderCombos(summary) {
        const rows = summary.comboLeaders.map((comboSummary) => {
          return '<tr>' +
            '<td><strong>' + comboSummary.marketKey.replace(':', ' ') + '</strong></td>' +
            '<td><span title="' + comboSummary.memberStrategyIds.join(', ') + '">' + comboSummary.comboKey + '</span></td>' +
            '<td>' + comboSummary.size + '</td>' +
            '<td>' + formatNumber(comboSummary.comboScore, 2) + ' / ' + formatNumber(comboSummary.effectiveComboScore, 2) + '</td>' +
            '<td>' + formatNumber(comboSummary.liftVsBestMemberPnl, 2) + '</td>' +
            '<td>' + formatNumber(comboSummary.cumulativePnlProxy) + '</td>' +
            '<td>' + formatNumber(comboSummary.hitRate, 2) + '</td>' +
            '<td>' + comboSummary.sampleCount + '</td>' +
            '<td><span title="' + comboSummary.status + '">' + renderMarketStatusCode(comboSummary.status) + '</span></td>' +
            '</tr>';
        }).join('');
        document.getElementById('combos').classList.remove('loading');
        document.getElementById('combos').innerHTML = summary.comboLeaders.length === 0
          ? '<div class="tiny">No combo history yet.</div>'
          : renderTableShell('<table><thead><tr><th>' + renderHintLabel('Mkt', 'Market key for the combo.') + '</th><th>' + renderHintLabel('Combo', 'Pair or trio of strategies tracked together.') + '</th><th>' + renderHintLabel('Sz', 'Combo size: 2 or 3.') + '</th><th>' + renderHintLabel('Score', 'Research score / effective execution score for the combo.') + '</th><th>' + renderHintLabel('Lift', 'Average PnL lift over the best member of the combo.') + '</th><th>' + renderHintLabel('PnL', 'Cumulative combo PnL proxy in the rolling window.') + '</th><th>' + renderHintLabel('Hit', 'Combo hit rate in the rolling window.') + '</th><th>' + renderHintLabel('N', 'Number of combo observations in the rolling window.') + '</th><th>' + renderHintLabel('St', 'Combo status. WRM = warming up, RSC/TRD = execution source, AVD = avoid.') + '</th></tr></thead><tbody>' + rows + '</tbody></table>');
      }

      function renderComboInfluence(summary) {
        const rows = summary.latestComboInfluence.map((prediction) => {
          const comboLabel =
            prediction.comboBreakdown.appliedBoostCombos[0]?.comboKey ??
            prediction.comboBreakdown.appliedDisagreementCombos[0]?.comboKey ??
            prediction.comboBreakdown.activeCombos[0]?.comboKey ??
            '—';
          return '<tr>' +
            '<td><strong>' + prediction.marketKey.replace(':', ' ') + '</strong></td>' +
            '<td>' + formatNumber(prediction.baseWeightedScore) + '</td>' +
            '<td>' + formatNumber(prediction.adjustedWeightedScore) + '</td>' +
            '<td>' + formatNumber(prediction.comboBreakdown.totalBoostApplied) + '</td>' +
            '<td>' + formatNumber(prediction.comboBreakdown.totalConfidencePenaltyApplied) + '</td>' +
            '<td><span title="' + comboLabel + '">' + comboLabel + '</span></td>' +
            '<td>' + prediction.direction + '</td>' +
            '</tr>';
        }).join('');
        document.getElementById('combo-influence').classList.remove('loading');
        document.getElementById('combo-influence').innerHTML = summary.latestComboInfluence.length === 0
          ? '<div class="tiny">No combo-influenced predictions yet.</div>'
          : renderTableShell('<table><thead><tr><th>' + renderHintLabel('Mkt', 'Market key for the prediction.') + '</th><th>' + renderHintLabel('Base', 'Weighted score before combo logic.') + '</th><th>' + renderHintLabel('Adj', 'Weighted score after combo logic.') + '</th><th>' + renderHintLabel('Bst', 'Total score boost from agreeing combos.') + '</th><th>' + renderHintLabel('Pen', 'Total confidence penalty from disagreeing combos.') + '</th><th>' + renderHintLabel('Combo', 'Combo with the strongest visible effect on this prediction.') + '</th><th>' + renderHintLabel('Dir', 'Final post-combo prediction direction.') + '</th></tr></thead><tbody>' + rows + '</tbody></table>');
      }

      function renderPositions(summary) {
        const rows = summary.openPositions.map((position) => {
          return '<tr>' +
            '<td><strong>' + position.asset.toUpperCase() + '</strong> <span class="tiny">' + position.window + '</span></td>' +
            '<td>' + position.positionSide.toUpperCase() + '</td>' +
            '<td><span title="' + position.status.replaceAll('_', ' ') + '">' + renderStatusCode(position.status) + '</span></td>' +
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
            '<div class="health-item"><strong>' + summary.health.pendingEvaluationCount + '</strong><div class="tiny">' + renderHintLabel('Active trades', 'Number of paper positions still open or waiting on maker fills before TP or SL resolution.') + '</div></div>' +
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
        renderMarketPnl(summary);
        renderCombos(summary);
        renderComboInfluence(summary);
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
