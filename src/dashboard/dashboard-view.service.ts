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
            <h2><span class="label-with-hint"><span class="hint-text" title="Simulated open positions, their TP/SL levels, and time left before forced flatten.">Open Positions</span></span></h2>
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
          ["Flatten %", "Share of closed trades that were forced out near market expiry.", (summary.paperExecutionPerformance.forcedFlattenRate * 100).toFixed(1) + "%"],
        ];
        document.getElementById("kpis").innerHTML = entries.map(([label, hint, value]) => '<div class="kpi"><div class="tiny">' + renderHintLabel(label, hint) + '</div><strong>' + value + '</strong></div>').join("");
      }

      function renderMarkets(summary) {
        const rows = summary.markets.map((market) => {
          const qualityWidth = Math.max(0, Math.min(100, market.quality.score * 100));
          return '<tr>' +
            '<td><strong>' + market.asset.toUpperCase() + '</strong> <span class="tiny">' + market.window + '</span></td>' +
            '<td>' + formatNumber(market.latestUpMidpoint) + '</td>' +
            '<td>' + formatNumber(market.latestDownMidpoint) + '</td>' +
            '<td>' + formatNumber(market.cooldownRemainingMs, 0) + '</td>' +
            '<td><div class="quality-bar" title="' + market.quality.issues.join(", ") + '"><span style="width:' + qualityWidth + '%"></span></div></td>' +
            '</tr>';
        }).join("");
        document.getElementById("markets").classList.remove("loading");
        document.getElementById("markets").innerHTML = renderTableShell('<table><thead><tr><th>' + renderHintLabel('Market', 'Asset and resolution window for the monitored Polymarket contract.') + '</th><th>' + renderHintLabel('UP mid', 'Current midpoint for the UP token. Falls back to price only outside the midpoint field, not in this display.') + '</th><th>' + renderHintLabel('DOWN mid', 'Current midpoint for the DOWN token.') + '</th><th>' + renderHintLabel('Cooldown', 'Milliseconds remaining before this market can emit another prediction.') + '</th><th>' + renderHintLabel('Quality', 'Aggregate data quality score based on freshness, spreads, and market availability.') + '</th></tr></thead><tbody>' + rows + '</tbody></table>');
      }

      function renderPredictions(summary) {
        const rows = summary.latestPredictions.map((prediction) => {
          const directionClass = prediction.direction === "UP" ? "up" : "down";
          return '<tr>' +
            '<td><strong>' + prediction.asset.toUpperCase() + '</strong> <span class="tiny">' + prediction.window + '</span></td>' +
            '<td><span class="pill ' + directionClass + '">' + prediction.direction + '</span></td>' +
            '<td>' + formatNumber(prediction.confidence) + '</td>' +
            '<td>' + prediction.trigger.triggerType + '</td>' +
            '<td>' + renderResultBadge(prediction.result) + '</td>' +
            '<td>' + formatTimestamp(prediction.timestamp) + '</td>' +
            '</tr>';
        }).join("");
        document.getElementById("predictions").classList.remove("loading");
        document.getElementById("predictions").innerHTML = renderTableShell('<table><thead><tr><th>' + renderHintLabel('Market', 'Asset and resolution window for this prediction.') + '</th><th>' + renderHintLabel('Dir', 'Final ensemble direction predicted for the next 30 seconds.') + '</th><th>' + renderHintLabel('Conf', 'Normalized ensemble confidence between 0 and 1.') + '</th><th>' + renderHintLabel('Trigger', 'Reason the prediction fired: proximity to 0.5 or a cross through that zone.') + '</th><th>' + renderHintLabel('Result', 'Pending until resolved, then OK for a win, KO for a loss, or VOID if data was insufficient.') + '</th><th>' + renderHintLabel('At', 'Prediction creation timestamp.') + '</th></tr></thead><tbody>' + rows + '</tbody></table>');
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
          const sideLabel = marketExecution.decision.positionSide === null ? '—' : marketExecution.decision.positionSide.toUpperCase();
          const styleLabel = marketExecution.decision.executionStyle === null ? '—' : marketExecution.decision.executionStyle.toUpperCase();
          const allowedLabel = marketExecution.decision.isEntryAllowed ? '<span class="pill up">YES</span>' : '<span class="pill down">NO</span>';
          const blockReason = marketExecution.decision.gateFailures.length === 0 ? '—' : marketExecution.decision.gateFailures.join(', ');
          return '<tr>' +
            '<td><strong>' + marketExecution.asset.toUpperCase() + '</strong> <span class="tiny">' + marketExecution.window + '</span></td>' +
            '<td>' + allowedLabel + '</td>' +
            '<td>' + sideLabel + '</td>' +
            '<td>' + formatNumber(marketExecution.decision.entryReferencePrice) + '</td>' +
            '<td>' + formatNumber(marketExecution.decision.takeProfitPrice) + '</td>' +
            '<td>' + formatNumber(marketExecution.decision.stopLossPrice) + '</td>' +
            '<td>' + styleLabel + '</td>' +
            '<td>' + formatNumber(marketExecution.decision.urgencyScore) + '</td>' +
            '<td><span class="truncate-cell" title="' + blockReason + '">' + blockReason + '</span></td>' +
            '</tr>';
        }).join("");
        document.getElementById("execution").classList.remove("loading");
        document.getElementById("execution").innerHTML = renderTableShell('<table><thead><tr><th>' + renderHintLabel('Market', 'Asset and resolution window for the execution decision.') + '</th><th>' + renderHintLabel('Executable', 'Whether the current market passes all entry gates right now.') + '</th><th>' + renderHintLabel('Side', 'Which token would be bought now: UP or DOWN.') + '</th><th>' + renderHintLabel('Entry', 'Reference price used for a potential entry near the 0.5 zone.') + '</th><th>' + renderHintLabel('TP', 'Take-profit token price for the simulated trade.') + '</th><th>' + renderHintLabel('SL', 'Stop-loss token price for the simulated trade.') + '</th><th>' + renderHintLabel('Style', 'Preferred execution style: maker or taker.') + '</th><th>' + renderHintLabel('Urgency', 'Higher values mean the model prefers not to wait passively.') + '</th><th>' + renderHintLabel('Reason', 'If blocked, the gate failure list. If active, the execution rationale.') + '</th></tr></thead><tbody>' + rows + '</tbody></table>');
      }

      function renderPositions(summary) {
        const rows = summary.openPositions.map((position) => {
          return '<tr>' +
            '<td><strong>' + position.asset.toUpperCase() + '</strong> <span class="tiny">' + position.window + '</span></td>' +
            '<td>' + position.positionSide.toUpperCase() + '</td>' +
            '<td>' + position.status + '</td>' +
            '<td>' + formatNumber(position.entryFillPrice) + '</td>' +
            '<td>' + formatNumber(position.liveTokenPrice) + '</td>' +
            '<td>' + formatNumber(position.unrealizedPnlTokenPrice) + '</td>' +
            '<td>' + formatNumber(position.takeProfitPrice) + '</td>' +
            '<td>' + formatNumber(position.stopLossPrice) + '</td>' +
            '<td>' + formatNumber(position.timeToForcedFlattenMs, 0) + '</td>' +
            '</tr>';
        }).join("");
        document.getElementById("positions").classList.remove("loading");
        document.getElementById("positions").innerHTML = summary.openPositions.length === 0
          ? '<div class="tiny">No open paper positions.</div>'
          : renderTableShell('<table><thead><tr><th>' + renderHintLabel('Market', 'Asset and window of the open paper position.') + '</th><th>' + renderHintLabel('Side', 'Token currently held: UP or DOWN.') + '</th><th>' + renderHintLabel('Status', 'Position lifecycle state, including maker-pending statuses.') + '</th><th>' + renderHintLabel('Entry fill', 'Simulated fill price used to open the position.') + '</th><th>' + renderHintLabel('Live px', 'Current token midpoint or fallback price for mark-to-market.') + '</th><th>' + renderHintLabel('uPnL', 'Unrealized token-price PnL before paper execution costs.') + '</th><th>' + renderHintLabel('TP', 'Take-profit target for this open position.') + '</th><th>' + renderHintLabel('SL', 'Stop-loss level for this open position.') + '</th><th>' + renderHintLabel('Flatten', 'Milliseconds left before forced flatten near expiry.') + '</th></tr></thead><tbody>' + rows + '</tbody></table>');
      }

      function renderTrades(summary) {
        const rows = summary.recentTrades.map((trade) => {
          return '<tr>' +
            '<td><strong>' + trade.asset.toUpperCase() + '</strong> <span class="tiny">' + trade.window + '</span></td>' +
            '<td>' + trade.positionSide.toUpperCase() + '</td>' +
            '<td>' + trade.entryExecutionStyle.toUpperCase() + '</td>' +
            '<td>' + trade.exitExecutionStyle.toUpperCase() + '</td>' +
            '<td>' + trade.exitReason + '</td>' +
            '<td>' + formatNumber(trade.realizedPnlAfterCosts) + '</td>' +
            '<td>' + formatNumber(trade.holdTimeMs, 0) + '</td>' +
            '</tr>';
        }).join("");
        document.getElementById("trades").classList.remove("loading");
        document.getElementById("trades").innerHTML = summary.recentTrades.length === 0
          ? '<div class="tiny">No closed paper trades yet.</div>'
          : renderTableShell('<table><thead><tr><th>' + renderHintLabel('Market', 'Asset and window of the closed paper trade.') + '</th><th>' + renderHintLabel('Side', 'Token that was bought for the trade.') + '</th><th>' + renderHintLabel('Maker in', 'Execution style used on entry.') + '</th><th>' + renderHintLabel('Maker out', 'Execution style used on exit.') + '</th><th>' + renderHintLabel('Exit reason', 'Why the trade closed: TP, SL, flatten, or fallback logic.') + '</th><th>' + renderHintLabel('Net PnL', 'Realized simulated PnL after proxy entry and exit costs.') + '</th><th>' + renderHintLabel('Hold time', 'Milliseconds between entry fill and exit fill.') + '</th></tr></thead><tbody>' + rows + '</tbody></table>');
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
