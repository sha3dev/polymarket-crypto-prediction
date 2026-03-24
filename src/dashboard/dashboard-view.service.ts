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
        display: grid;
        grid-template-columns: 1.5fr 1fr;
        gap: 18px;
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
      .hero-card h1 {
        margin: 0 0 8px;
        font-size: clamp(28px, 3vw, 40px);
      }
      .hero-card p {
        margin: 0;
        opacity: 0.84;
        max-width: 60ch;
      }
      .kpi-strip {
        display: grid;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        gap: 12px;
      }
      .kpi {
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 14px;
        padding: 14px;
      }
      .kpi strong {
        display: block;
        font-size: 24px;
      }
      .grid {
        display: grid;
        grid-template-columns: 1.6fr 1fr;
        gap: 18px;
      }
      .stack {
        display: grid;
        gap: 18px;
      }
      .panel {
        background: var(--panel);
        padding: 18px;
      }
      h2 {
        margin: 0 0 12px;
        font-size: 15px;
        letter-spacing: 0.06em;
        text-transform: uppercase;
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
      .loading {
        animation: pulse 1.6s ease-in-out infinite;
      }
      @keyframes pulse {
        0%, 100% { opacity: 0.6; }
        50% { opacity: 1; }
      }
      @media (max-width: 1100px) {
        .hero, .grid { grid-template-columns: 1fr; }
        .kpi-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      }
      @media (max-width: 700px) {
        .shell { width: min(100vw - 20px, 1600px); }
        .kpi-strip { grid-template-columns: 1fr; }
        table { font-size: 12px; }
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <section class="hero">
        <article class="hero-card">
          <div class="tiny">Live ensemble monitor</div>
          <h1>Polymarket 5m / 15m predictor</h1>
          <p>Event-driven crypto prediction surface with rolling weights, market quality scoring, and per-strategy attribution across BTC, ETH, SOL, and XRP.</p>
        </article>
        <div class="kpi-strip" id="kpis"></div>
      </section>
      <section class="grid">
        <div class="stack">
          <article class="panel">
            <h2>Markets</h2>
            <div id="markets" class="loading">Loading market state…</div>
          </article>
          <article class="panel">
            <h2>Latest Predictions</h2>
            <div id="predictions" class="loading">Loading prediction history…</div>
          </article>
        </div>
        <div class="stack">
          <article class="panel">
            <h2>Strategies</h2>
            <div id="strategies" class="loading">Loading strategy ranking…</div>
          </article>
          <article class="panel">
            <h2>Health</h2>
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

      function renderKpis(summary) {
        const entries = [
          ["Live", summary.kpis.liveMarkets],
          ["Pending", summary.kpis.pendingEvaluations],
          ["Predictions", summary.kpis.totalPredictions],
          ["Accuracy", (summary.kpis.resolvedAccuracy * 100).toFixed(1) + "%"],
          ["Avg conf", summary.kpis.averageConfidence.toFixed(3)],
        ];
        document.getElementById("kpis").innerHTML = entries.map(([label, value]) => '<div class="kpi"><div class="tiny">' + label + '</div><strong>' + value + '</strong></div>').join("");
      }

      function renderMarkets(summary) {
        const rows = summary.markets.map((market) => {
          const qualityWidth = Math.max(0, Math.min(100, market.quality.score * 100));
          return '<tr>' +
            '<td><strong>' + market.asset.toUpperCase() + '</strong> <span class="tiny">' + market.window + '</span></td>' +
            '<td>' + formatNumber(market.latestUpMidpoint) + '</td>' +
            '<td>' + formatNumber(market.latestDownMidpoint) + '</td>' +
            '<td>' + formatNumber(market.upDistanceToHalf) + '</td>' +
            '<td>' + formatNumber(market.downDistanceToHalf) + '</td>' +
            '<td>' + formatNumber(market.cooldownRemainingMs, 0) + '</td>' +
            '<td><div class="quality-bar" title="' + market.quality.issues.join(", ") + '"><span style="width:' + qualityWidth + '%"></span></div></td>' +
            '</tr>';
        }).join("");
        document.getElementById("markets").classList.remove("loading");
        document.getElementById("markets").innerHTML = '<table><thead><tr><th>Market</th><th>UP mid</th><th>DOWN mid</th><th>UP dist</th><th>DOWN dist</th><th>Cooldown</th><th>Quality</th></tr></thead><tbody>' + rows + '</tbody></table>';
      }

      function renderPredictions(summary) {
        const rows = summary.latestPredictions.map((prediction) => {
          const directionClass = prediction.direction === "UP" ? "up" : "down";
          return '<tr>' +
            '<td><strong>' + prediction.asset.toUpperCase() + '</strong> <span class="tiny">' + prediction.window + '</span></td>' +
            '<td><span class="pill ' + directionClass + '">' + prediction.direction + '</span></td>' +
            '<td>' + formatNumber(prediction.confidence) + '</td>' +
            '<td>' + prediction.trigger.triggerType + '</td>' +
            '<td>' + prediction.result.status + '</td>' +
            '<td>' + formatTimestamp(prediction.timestamp) + '</td>' +
            '</tr>';
        }).join("");
        document.getElementById("predictions").classList.remove("loading");
        document.getElementById("predictions").innerHTML = '<table><thead><tr><th>Market</th><th>Dir</th><th>Conf</th><th>Trigger</th><th>Result</th><th>At</th></tr></thead><tbody>' + rows + '</tbody></table>';
      }

      function renderStrategies(summary) {
        const rows = summary.strategies.map((strategy) => {
          return '<tr>' +
            '<td><strong>' + strategy.name + '</strong><div class="tiny">' + strategy.strategyId + ' · ' + strategy.tier + '</div></td>' +
            '<td>' + formatNumber(strategy.weight) + '</td>' +
            '<td>' + formatNumber(strategy.hitRate) + '</td>' +
            '<td>' + strategy.recentStreak + '</td>' +
            '</tr>';
        }).join("");
        document.getElementById("strategies").classList.remove("loading");
        document.getElementById("strategies").innerHTML = '<table><thead><tr><th>Strategy</th><th>Weight</th><th>Hit rate</th><th>Streak</th></tr></thead><tbody>' + rows + '</tbody></table>';
      }

      function renderHealth(summary) {
        document.getElementById("health").classList.remove("loading");
        document.getElementById("health").innerHTML =
          '<div><strong>' + summary.health.serviceName + '</strong></div>' +
          '<div class="tiny">Started: ' + formatTimestamp(summary.health.startedAt) + '</div>' +
          '<div class="tiny">Snapshot age: ' + formatNumber(summary.health.snapshotAgeMs, 0) + ' ms</div>' +
          '<div class="tiny">Healthy: ' + summary.health.isSnapshotHealthy + '</div>' +
          '<div class="tiny">Pending evals: ' + summary.health.pendingEvaluationCount + '</div>';
      }

      async function refresh() {
        const response = await fetch('/v1/dashboard/summary', { headers: { accept: 'application/json' } });
        const summary = await response.json();
        renderKpis(summary);
        renderMarkets(summary);
        renderPredictions(summary);
        renderStrategies(summary);
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
