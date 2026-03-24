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
      .dashboard-layout {
        display: grid;
        grid-template-columns: minmax(0, 1.55fr) minmax(360px, 0.95fr);
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
      .panel-tall { min-height: 300px; }
      .panel-medium { min-height: 220px; }
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
      .hint-label {
        color: inherit;
        border-bottom: 1px dashed rgba(107, 114, 128, 0.65);
        cursor: pointer;
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
      .code-chip {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 38px;
        min-height: 24px;
        padding: 3px 8px;
        border: 1px solid rgba(13, 27, 42, 0.14);
        border-radius: 999px;
        background: rgba(13, 27, 42, 0.04);
        color: var(--text);
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.04em;
        cursor: pointer;
      }
      .code-chip:hover {
        background: rgba(13, 27, 42, 0.08);
      }
      .code-chip-group {
        display: inline-flex;
        flex-wrap: nowrap;
        gap: 4px;
        align-items: center;
        white-space: nowrap;
        max-width: 100%;
        overflow: hidden;
      }
      .info-popover {
        position: fixed;
        z-index: 20;
        max-width: min(280px, calc(100vw - 24px));
        padding: 10px 12px;
        border: 1px solid rgba(13, 27, 42, 0.12);
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.98);
        box-shadow: 0 18px 30px rgba(7, 17, 31, 0.2);
      }
      .info-popover strong {
        display: block;
        margin-bottom: 4px;
        font-size: 12px;
      }
      .info-popover p {
        margin: 0;
        font-size: 12px;
        line-height: 1.45;
        color: var(--muted);
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
      .engine-matrix {
        overflow: auto;
      }
      .engine-matrix-table {
        width: 100%;
        min-width: 720px;
        border-collapse: separate;
        border-spacing: 4px;
      }
      .engine-matrix-table th,
      .engine-matrix-table td {
        border-bottom: 0;
        padding: 0;
        white-space: nowrap;
      }
      .engine-matrix-market {
        min-width: 76px;
        padding: 8px 6px;
      }
      .engine-matrix-cell {
        display: grid;
        place-items: center;
        min-width: 44px;
        min-height: 36px;
        border: 1px solid rgba(13, 27, 42, 0.12);
        border-radius: 12px;
        background: rgba(13, 27, 42, 0.04);
        color: var(--text);
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.04em;
        cursor: pointer;
      }
      .engine-matrix-cell:hover {
        transform: translateY(-1px);
        box-shadow: 0 6px 12px rgba(7, 17, 31, 0.12);
      }
      .engine-matrix-cell.up {
        color: var(--success);
      }
      .engine-matrix-cell.down {
        color: var(--danger);
      }
      .engine-matrix-cell.muted {
        color: var(--muted);
      }
      .proximity-list {
        display: grid;
        gap: 10px;
      }
      .proximity-row {
        display: grid;
        grid-template-columns: 78px minmax(0, 1fr) 64px;
        gap: 12px;
        align-items: center;
      }
      .proximity-eq {
        display: grid;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        gap: 8px;
        align-items: end;
        min-height: 78px;
        padding: 8px 10px;
        border: 1px solid rgba(13, 27, 42, 0.08);
        border-radius: 14px;
        background: rgba(13, 27, 42, 0.03);
      }
      .proximity-band {
        display: grid;
        gap: 6px;
        justify-items: center;
      }
      .proximity-bar {
        position: relative;
        width: 100%;
        max-width: 28px;
        height: 44px;
        border-radius: 10px;
        background: rgba(13, 27, 42, 0.08);
        overflow: hidden;
      }
      .proximity-bar-fill {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        border-radius: 10px;
        background: linear-gradient(180deg, var(--accent-2), var(--accent));
      }
      .proximity-band-label {
        font-size: 10px;
        color: var(--muted);
        letter-spacing: 0.04em;
      }
      .proximity-score {
        text-align: right;
      }
      .proximity-score strong {
        display: block;
        font-size: 18px;
      }
      .proximity-trend {
        display: inline-flex;
        align-items: end;
        gap: 2px;
        margin-top: 4px;
        min-height: 20px;
      }
      .proximity-trend-bar {
        width: 5px;
        border-radius: 999px;
        background: linear-gradient(180deg, rgba(31, 162, 255, 0.9), rgba(255, 122, 24, 0.85));
        opacity: 0.9;
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
        .hero-head { grid-template-columns: 1fr; }
        .dashboard-layout { grid-template-columns: 1fr; }
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
                Live ensemble monitor
              </div>
              <h1>Polymarket 5m / 15m predictor</h1>
              <p>Event-driven crypto prediction surface with rolling weights, market quality scoring, strategy attribution, and paper execution across BTC, ETH, SOL, and XRP.</p>
            </div>
            <div class="kpi-strip" id="kpis"></div>
          </div>
        </article>
      </section>
      <section class="dashboard-layout">
        <div class="stack">
          <article class="panel panel-compact">
            <h2><span class="hint-label" data-full-label="Global Regime" data-description="Dominant cross-asset context across the monitored markets." aria-label="Global Regime. Dominant cross-asset context across the monitored markets.">Global Regime</span></h2>
            <p class="tiny panel-intro">This panel explains the current market-wide context: whether breadth is directional, which markets are leading, which ones are lagging, and whether continuation or reversal setups should dominate.</p>
            <div id="global-regime" class="loading">Loading global regime…</div>
          </article>
          <article class="panel panel-compact">
            <h2><span class="hint-label" data-full-label="Markets" data-description="Current state for all eight monitored markets, including token midpoints, cooldown, and data quality." aria-label="Markets. Current state for all eight monitored markets, including token midpoints, cooldown, and data quality.">Markets</span></h2>
            <p class="tiny panel-intro">Snapshot of the monitored markets right now. It now highlights the active regime and the dominant setup per market, so you can see which markets look structurally interesting before looking at execution.</p>
            <div id="markets" class="loading panel-scroll">Loading market state…</div>
          </article>
          <article class="panel panel-medium">
            <h2><span class="hint-label" data-full-label="Execution Now" data-description="Current executable entry decision per market: side, TP, SL, and maker versus taker choice." aria-label="Execution Now. Current executable entry decision per market: side, TP, SL, and maker versus taker choice.">Execution Now</span></h2>
            <p class="tiny panel-intro">This is the actual trading gate. It shows the winning setup, the winning engine combo, and which setup-specific rule is blocking entry when no trade should be taken.</p>
            <div id="execution" class="loading panel-scroll">Loading execution decisions…</div>
          </article>
          <article class="panel panel-medium">
            <h2><span class="hint-label" data-full-label="Trade Proximity" data-description="How close each market is to becoming executable, shown as a compact equalizer of key execution ingredients." aria-label="Trade Proximity. How close each market is to becoming executable, shown as a compact equalizer of key execution ingredients.">Trade Proximity</span></h2>
            <p class="tiny panel-intro">Equalizer view of how near each market is to a real trade. Each row compresses setup, combo, score, quality, and regime support so you can see what is almost ready and what is still structurally blocked.</p>
            <div id="trade-proximity" class="loading panel-scroll">Loading trade proximity…</div>
          </article>
          <article class="panel panel-medium">
            <h2><span class="hint-label" data-full-label="Winning Combination" data-description="Winning setup and engine combination for the latest ideas." aria-label="Winning Combination. Winning setup and engine combination for the latest ideas.">Winning Combination</span></h2>
            <p class="tiny panel-intro">The prediction layer now works by selecting a setup and a combo of engines. This panel shows that winning narrative directly instead of only the old raw strategy-level combo details.</p>
            <div id="winning-combinations" class="loading panel-scroll">Loading winning combinations…</div>
          </article>
          <article class="panel panel-tall">
            <h2><span class="hint-label" data-full-label="Resolved Predictions" data-description="Most recent predictions that completed through a paper-trade TP or SL exit." aria-label="Resolved Predictions. Most recent predictions that completed through a paper-trade TP or SL exit.">Resolved Predictions</span></h2>
            <p class="tiny panel-intro">Recent predictions that already finished their lifecycle. It now shows which setup and which engine combo produced each idea, so you can judge the mechanism, not just the final direction.</p>
            <div id="predictions" class="loading panel-scroll">Loading resolved predictions…</div>
          </article>
          <article class="panel panel-medium">
            <h2><span class="hint-label" data-full-label="Recent Trades" data-description="Most recent closed paper trades, including maker/taker styles and exit reasons." aria-label="Recent Trades. Most recent closed paper trades, including maker/taker styles and exit reasons.">Recent Trades</span></h2>
            <p class="tiny panel-intro">Closed paper trades only. It shows what the system really executed, how those trades ended, and whether execution quality is matching what the research layer suggests.</p>
            <div id="trades" class="loading panel-scroll">Loading recent trades…</div>
          </article>
          <article class="panel panel-medium">
            <h2><span class="hint-label" data-full-label="Open Positions" data-description="Simulated open positions with their TP/SL levels and current marked value." aria-label="Open Positions. Simulated open positions with their TP/SL levels and current marked value.">Open Positions</span></h2>
            <p class="tiny panel-intro">Current paper positions that are still alive. Use this panel to understand active exposure, where TP and SL sit, and what risk is still on the table right now.</p>
            <div id="positions" class="loading panel-scroll">Loading open positions…</div>
          </article>
        </div>
        <div class="stack">
          <article class="panel panel-tall">
            <h2><span class="hint-label" data-full-label="Engine Board" data-description="Active engines for the selected market, including state, score, confidence, and regime fit." aria-label="Engine Board. Active engines for the selected market, including state, score, confidence, and regime fit.">Engine Board</span></h2>
            <p class="tiny panel-intro">This is the new center of the model. Strategies now act as sensors inside engines, and this board shows which engines are active, why they are trusted, and which ones are being silenced by the current regime.</p>
            <div id="engine-board" class="loading panel-scroll">Loading engine board…</div>
          </article>
          <article class="panel panel-medium">
            <h2><span class="hint-label" data-full-label="Engine Grid" data-description="Matrix view of all markets versus all engines, colored by current state and signed score." aria-label="Engine Grid. Matrix view of all markets versus all engines, colored by current state and signed score.">Engine Grid</span></h2>
            <p class="tiny panel-intro">Market-by-engine snapshot. Each cell compresses direction, state, and strength so you can see where engines are waking up, fading out, or lining up across several markets at once.</p>
            <div id="engine-grid" class="loading panel-scroll">Loading engine grid…</div>
          </article>
          <article class="panel panel-medium">
            <h2><span class="hint-label" data-full-label="Market PnL" data-description="Per-market paper trading PnL, hit rate, and drawdown so you can see which markets are actually worth trading." aria-label="Market PnL. Per-market paper trading PnL, hit rate, and drawdown so you can see which markets are actually worth trading.">Market PnL</span></h2>
            <p class="tiny panel-intro">Performance summary by market. It helps separate markets that look interesting for research from markets that are actually proving they deserve execution capital.</p>
            <div id="market-pnl" class="loading panel-scroll">Loading market pnl…</div>
          </article>
          <article class="panel panel-medium">
            <h2><span class="hint-label" data-full-label="Discovery Board" data-description="What the system is learning about engine combos and setups from recent resolved predictions." aria-label="Discovery Board. What the system is learning about engine combos and setups from recent resolved predictions.">Discovery Board</span></h2>
            <p class="tiny panel-intro">Compact learning board for the new mechanism. It summarizes which engine combos and setup narratives are resolving well, which helps you see whether the engine discovery layer is learning anything useful.</p>
            <div id="discovery" class="loading panel-scroll">Loading discovery board…</div>
          </article>
          <article class="panel panel-compact">
            <h2><span class="hint-label" data-full-label="Health" data-description="Ingestion freshness and service runtime health indicators." aria-label="Health. Ingestion freshness and service runtime health indicators.">Health</span></h2>
            <p class="tiny panel-intro">Operational status of the feed and the service itself. If another panel looks suspicious, check here first to confirm the data is fresh and the runtime is behaving normally.</p>
            <div id="health" class="loading">Loading service health…</div>
          </article>
        </div>
      </section>
    </div>
    <script>
      const pollIntervalMs = ${config.DASHBOARD_POLL_INTERVAL_MS};
      const maxTradeProximityHistory = 18;
      let activeInfoPopover = null;
      const tradeProximityHistory = new Map();

      const typedCodeCatalog = {
        setup: {
          broad_continuation: { code: 'BRC', label: 'Broad Continuation', description: 'Directional market-wide continuation supported by breadth plus local follow-through.' },
          leader_laggard_catchup: { code: 'LLC', label: 'Leader-Laggard Catch-Up', description: 'A lagging asset is expected to follow the leaders in the dominant market-wide move.' },
          local_breakout_confirmed: { code: 'LBC', label: 'Local Breakout Confirmed', description: 'Continuation is driven mainly by local momentum and local microstructure confirmation.' },
          mispricing_repricing: { code: 'MPR', label: 'Mispricing Repricing', description: 'The edge comes from basis, barrier, or stale-price dislocation rather than pure trend continuation.' },
          fade_failed_cross: { code: 'FFC', label: 'Fade Failed Cross', description: 'The 0.5 cross looks exhausted or invalidated, so fade logic dominates continuation logic.' },
          research_probe: { code: 'RSP', label: 'Research Probe', description: 'Fallback research-only narrative used when no stronger setup dominates clearly enough.' },
        },
        regime: {
          neutral: { code: 'NEU', label: 'Neutral', description: 'No coherent cross-asset directional structure is dominant.' },
          broad_up_weak: { code: 'BUW', label: 'Broad Up Weak', description: 'The monitored assets lean up together, but the move is not yet strong enough to be treated as fully confirmed breadth.' },
          broad_up_strong: { code: 'BUS', label: 'Broad Up Strong', description: 'A strong market-wide upward move is in force across the monitored assets.' },
          broad_down_weak: { code: 'BDW', label: 'Broad Down Weak', description: 'The monitored assets lean down together, but the move is still weak.' },
          broad_down_strong: { code: 'BDS', label: 'Broad Down Strong', description: 'A strong market-wide downward move is in force across the monitored assets.' },
          leader_laggard_up: { code: 'LLU', label: 'Leader/Laggard Up', description: 'Some assets are clearly leading an upward move while others are lagging behind.' },
          leader_laggard_down: { code: 'LLD', label: 'Leader/Laggard Down', description: 'Some assets are clearly leading a downward move while others are lagging behind.' },
          fragmented: { code: 'FRG', label: 'Fragmented', description: 'The monitored assets are not telling one coherent directional story.' },
          reversal_risk: { code: 'REV', label: 'Reversal Risk', description: 'Continuation is becoming stretched enough that reversal or fade logic deserves more trust.' },
        },
        engine: {
          breadth_engine: { code: 'BRD', label: 'Breadth Engine', description: 'Cross-asset direction and synchrony engine.' },
          propagation_engine: { code: 'PRP', label: 'Propagation Engine', description: 'Leader-laggard and cross-asset catch-up engine.' },
          local_momentum_engine: { code: 'MOM', label: 'Local Momentum Engine', description: 'Local continuation and breakout-confirmation engine.' },
          local_microstructure_engine: { code: 'MIC', label: 'Local Microstructure Engine', description: 'Order-book pressure and local token-structure engine.' },
          mispricing_engine: { code: 'MIS', label: 'Mispricing Engine', description: 'Basis, barrier mismatch, and repricing-dislocation engine.' },
          reversion_engine: { code: 'REV', label: 'Reversion Engine', description: 'Mean reversion and failed-continuation engine.' },
          meta_engine: { code: 'MET', label: 'Meta Engine', description: 'Meta-stability and trust-conditioning engine.' },
        },
        engineState: {
          inactive: { code: 'INA', label: 'Inactive', description: 'The engine is currently not contributing meaningful directional information.' },
          weak: { code: 'WEK', label: 'Weak', description: 'The engine is active but not strong enough to dominate the narrative.' },
          active: { code: 'ACT', label: 'Active', description: 'The engine is materially contributing to the market narrative.' },
          dominant: { code: 'DOM', label: 'Dominant', description: 'The engine is one of the main drivers of the selected setup.' },
          avoid: { code: 'AVD', label: 'Avoid', description: 'The current regime says this engine should not be trusted right now.' },
        },
        executionStyle: {
          maker: { code: 'MAK', label: 'Maker', description: 'Passive order placement preferred to earn spread or avoid crossing immediately.' },
          taker: { code: 'TAK', label: 'Taker', description: 'Immediate liquidity-taking order preferred because urgency or fill risk is high.' },
        },
        tradeExitReason: {
          take_profit_hit: { code: 'TPF', label: 'Take Profit Hit', description: 'The position closed because the take-profit level was reached.' },
          stop_loss_hit: { code: 'STP', label: 'Stop Loss Hit', description: 'The position closed because the stop-loss level was reached.' },
        },
        reason: {
          READY: { code: 'RDY', label: 'Ready', description: 'No blocking reason is active.' },
          NPR: { code: 'NPR', label: 'No Prediction', description: 'No valid prediction exists for this market right now.' },
          OPN: { code: 'OPN', label: 'Open Position', description: 'A position is already open, so the engine will not open another one.' },
          DIR: { code: 'DIR', label: 'Invalid Direction', description: 'The prediction direction could not be converted into a valid trading side.' },
          REF: { code: 'REF', label: 'Reference Missing', description: 'The execution layer could not determine a valid reference token price.' },
          LIV: { code: 'LIV', label: 'Market Not Live', description: 'The market is not currently considered live enough for execution.' },
          QLT: { code: 'QLT', label: 'Quality Too Low', description: 'The market quality score is below the execution threshold.' },
          CNF: { code: 'CNF', label: 'Confidence Too Low', description: 'The selected setup is not confident enough for execution.' },
          CMB: { code: 'CMB', label: 'Combo Gate Failed', description: 'The legacy strategy combo gate is still blocking execution.' },
          XRG: { code: 'XRG', label: 'Regime Conflict', description: 'The local prediction fights the active cross-asset regime.' },
          EXE: { code: 'EXE', label: 'Execution Score Low', description: 'The execution score is below the minimum threshold.' },
          HIS: { code: 'HIS', label: 'History Thin', description: 'There is not enough execution history yet.' },
          BST: { code: 'BST', label: 'Bootstrap Low', description: 'The bootstrap-discounted execution score is still too low.' },
          SDR: { code: 'SDR', label: 'Setup Needs Regime', description: 'This setup requires a directional regime and does not have one.' },
          SRV: { code: 'SRV', label: 'Reversal Risk', description: 'This setup is blocked because reversal risk is too high.' },
          SLG: { code: 'SLG', label: 'Needs Laggard', description: 'The setup needs a leader-laggard structure and it is not present.' },
          SLD: { code: 'SLD', label: 'Needs Leader', description: 'The setup needs a clear leader market and none is available.' },
          SMO: { code: 'SMO', label: 'Needs Momentum', description: 'The setup needs stronger local momentum confirmation.' },
          SBS: { code: 'SBS', label: 'Needs Basis', description: 'The setup needs basis or repricing divergence that is not present.' },
          SFD: { code: 'SFD', label: 'Fade Conflict', description: 'Fade logic is blocked because strong breadth still dominates.' },
          BND: { code: 'BND', label: 'Entry Band', description: 'The reference token price is too far from the preferred entry band.' },
          SPR: { code: 'SPR', label: 'Spread Wide', description: 'The spread is too wide for execution.' },
          MSC: { code: 'MSC', label: 'Market Score', description: 'The market score is too low for execution.' },
          WRM: { code: 'WRM', label: 'Warming Up', description: 'The market is still warming up and has not earned execution trust yet.' },
          MAK: { code: 'MAK', label: 'Maker Preferred', description: 'Execution is allowed, and the engine prefers maker-style entry.' },
          TSP: { code: 'TSP', label: 'Tight Spread', description: 'Execution prefers taking liquidity because the spread is already tight.' },
          URG: { code: 'URG', label: 'Urgent', description: 'Execution prefers taking liquidity because urgency is high.' },
          FIL: { code: 'FIL', label: 'Fill Risk', description: 'Maker fill probability is too low, so crossing is preferred.' },
          DRF: { code: 'DRF', label: 'Book Drift', description: 'The order book is drifting away, making passive entry unattractive.' },
        },
      };

      function formatNumber(value, digits = 2) {
        return value === null || value === undefined ? "—" : Number(value).toFixed(digits);
      }

      function formatTimestamp(value) {
        return value ? new Date(value).toLocaleTimeString() : "—";
      }

      function renderHintLabel(label, hint) {
        const labelMarkup =
          '<span class="label-with-hint"><span class="hint-label" data-full-label="' +
          escapeHtml(label) +
          '" data-description="' +
          escapeHtml(hint) +
          '" aria-label="' +
          escapeHtml(label + '. ' + hint) +
          '">' +
          escapeHtml(label) +
          '</span></span>';
        return labelMarkup;
      }

      function escapeHtml(value) {
        return String(value)
          .replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;')
          .replaceAll('"', '&quot;')
          .replaceAll("'", '&#39;');
      }

      function lookupTypedCode(type, value) {
        const typedEntry = typedCodeCatalog[type]?.[value] ?? null;
        return typedEntry;
      }

      function renderInfoCode(type, value, fallbackLabel) {
        const typedEntry = value === null || value === undefined ? null : lookupTypedCode(type, value);
        const codeLabel = typedEntry?.code ?? fallbackLabel ?? '—';
        const fullLabel = typedEntry?.label ?? fallbackLabel ?? String(value ?? 'unknown');
        const description = typedEntry?.description ?? 'No extra description available.';
        const markup =
          '<button type="button" class="code-chip" data-full-label="' +
          escapeHtml(fullLabel) +
          '" data-description="' +
          escapeHtml(description) +
          '" aria-label="' +
          escapeHtml(fullLabel + '. ' + description) +
          '">' +
          escapeHtml(codeLabel) +
          '</button>';
        return markup;
      }

      function renderEngineComboCodes(engineIds) {
        const comboMarkup = renderCodeListGroup('engine', engineIds, 3);
        return comboMarkup;
      }

      function renderReasonCodeGroup(reasonCodes) {
        const reasonMarkup = reasonCodes.length === 0
          ? renderInfoCode('reason', 'READY', 'RDY')
          : renderCodeListGroup('reason', reasonCodes, 4);
        return reasonMarkup;
      }

      function renderOverflowCode(hiddenCount, hiddenLabels, hiddenDescriptions) {
        const overflowMarkup = renderInfoCode(
          'overflow',
          'overflow',
          '+' + hiddenCount,
        ).replace(
          'data-full-label="overflow"',
          'data-full-label="' + escapeHtml('Hidden items (' + hiddenCount + ')') + '"',
        ).replace(
          'data-description="No extra description available."',
          'data-description="' + escapeHtml(hiddenLabels.join(', ') + '. ' + hiddenDescriptions.join(' ')) + '"',
        );
        return overflowMarkup;
      }

      function renderCodeListGroup(type, values, maxVisible) {
        let groupMarkup = '—';
        if (values.length > 0) {
          const visibleValues = values.slice(0, maxVisible);
          const hiddenValues = values.slice(maxVisible);
          const visibleMarkup = visibleValues.map((value) => renderInfoCode(type, value, value)).join('');
          const hiddenLabels = hiddenValues.map((value) => lookupTypedCode(type, value)?.label ?? String(value));
          const hiddenDescriptions = hiddenValues.map((value) => lookupTypedCode(type, value)?.description ?? 'No description available.');
          const overflowMarkup = hiddenValues.length === 0 ? '' : renderOverflowCode(hiddenValues.length, hiddenLabels, hiddenDescriptions);
          groupMarkup = '<span class="code-chip-group">' + visibleMarkup + overflowMarkup + '</span>';
        }
        return groupMarkup;
      }

      function closeInfoPopover() {
        if (activeInfoPopover !== null) {
          activeInfoPopover.remove();
          activeInfoPopover = null;
        }
      }

      function openInfoPopover(targetElement) {
        closeInfoPopover();
        const fullLabel = targetElement.getAttribute('data-full-label') ?? 'Unknown';
        const description = targetElement.getAttribute('data-description') ?? 'No description available.';
        const popoverElement = document.createElement('div');
        popoverElement.className = 'info-popover';
        popoverElement.innerHTML = '<strong>' + escapeHtml(fullLabel) + '</strong><p>' + escapeHtml(description) + '</p>';
        document.body.appendChild(popoverElement);
        const targetBounds = targetElement.getBoundingClientRect();
        const popoverBounds = popoverElement.getBoundingClientRect();
        const leftOffset = Math.max(12, Math.min(window.innerWidth - popoverBounds.width - 12, targetBounds.left));
        const topOffset = targetBounds.bottom + 8 + popoverBounds.height > window.innerHeight
          ? Math.max(12, targetBounds.top - popoverBounds.height - 8)
          : targetBounds.bottom + 8;
        popoverElement.style.left = leftOffset + 'px';
        popoverElement.style.top = topOffset + 'px';
        activeInfoPopover = popoverElement;
      }

      function renderTableShell(tableHtml) {
        return '<div class="panel-scroll">' + tableHtml + '</div>';
      }

      function replaceStaticContent(elementId, html) {
        const element = document.getElementById(elementId);
        const previousHtml = element?.dataset.renderedHtml ?? null;
        if (element && previousHtml !== html) {
          element.classList.remove("loading");
          element.innerHTML = html;
          element.dataset.renderedHtml = html;
        }
      }

      function replacePanelContent(panelId, html) {
        const panelElement = document.getElementById(panelId);
        const previousHtml = panelElement?.dataset.renderedHtml ?? null;
        const previousScrollElement = panelElement ? panelElement.querySelector('.panel-scroll') : null;
        const previousScrollTop = previousScrollElement ? previousScrollElement.scrollTop : 0;
        const previousScrollLeft = previousScrollElement ? previousScrollElement.scrollLeft : 0;
        if (panelElement && previousHtml !== html) {
          panelElement.classList.remove("loading");
          panelElement.innerHTML = html;
          panelElement.dataset.renderedHtml = html;
          const nextScrollElement = panelElement.querySelector('.panel-scroll');
          if (nextScrollElement) {
            nextScrollElement.scrollTop = previousScrollTop;
            nextScrollElement.scrollLeft = previousScrollLeft;
          }
        }
      }

      function renderConvictionLabel(positionSizeSuggestion) {
        let convictionLabel = '<span class="pill">LO</span>';
        if (positionSizeSuggestion >= 0.7) {
          convictionLabel = '<span class="pill up">HI</span>';
        } else {
          if (positionSizeSuggestion >= 0.45) {
            convictionLabel = '<span class="pill">MD</span>';
          }
        }
        return convictionLabel;
      }

      function renderDirectionPill(direction) {
        const directionClass = direction === "UP" || direction === "up" ? "up" : "down";
        const directionLabel = direction === "UP" || direction === "up" ? "U" : "D";
        return '<span class="pill ' + directionClass + '">' + directionLabel + '</span>';
      }

      function renderPositionSideLabel(positionSide) {
        const positionSideLabel = positionSide === "up" ? "U" : "D";
        return positionSideLabel;
      }

      function renderActionLabel(decision) {
        let actionLabel = '<span class="pill down">NO</span>';
        if (decision.isEntryAllowed && decision.positionSide === 'up') {
          actionLabel = '<span class="pill up">BU</span>';
        }
        if (decision.isEntryAllowed && decision.positionSide === 'down') {
          actionLabel = '<span class="pill down">BD</span>';
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
        if (reasonCode === 'live_mode_not_initialized') {
          humanReason = 'live mode not initialized';
        }
        if (reasonCode === 'live_market_unresolved') {
          humanReason = 'live market unresolved';
        }
        if (reasonCode === 'live_balance_unavailable') {
          humanReason = 'live balance unavailable';
        }
        if (reasonCode === 'live_order_post_failed') {
          humanReason = 'live order post failed';
        }
        if (reasonCode === 'live_entry_not_confirmed') {
          humanReason = 'live entry not confirmed';
        }
        if (reasonCode === 'live_exit_not_confirmed') {
          humanReason = 'live exit not confirmed';
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
        if (reasonCode === 'setup_requires_directional_regime') {
          humanReason = 'setup needs directional regime';
        }
        if (reasonCode === 'setup_reversal_risk') {
          humanReason = 'setup blocked by reversal risk';
        }
        if (reasonCode === 'setup_needs_laggard') {
          humanReason = 'setup needs laggard structure';
        }
        if (reasonCode === 'setup_needs_leader') {
          humanReason = 'setup needs clear leader';
        }
        if (reasonCode === 'setup_needs_momentum') {
          humanReason = 'setup needs momentum';
        }
        if (reasonCode === 'setup_needs_basis') {
          humanReason = 'setup needs basis divergence';
        }
        if (reasonCode === 'setup_fade_conflicts_with_breadth') {
          humanReason = 'fade conflicts with strong breadth';
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
        let reasonCodes = renderInfoCode('reason', 'READY', 'RDY');
        if (decision.isEntryAllowed) {
          if (decision.executionReason !== null) {
            reasonCodes = renderReasonCodeGroup([renderReasonCode(humanizeReason(decision.executionReason))]);
          }
        } else {
          if (decision.gateFailures.length > 0) {
            reasonCodes = renderReasonCodeGroup(
              decision.gateFailures.map((reasonCode) => renderReasonCode(humanizeReason(reasonCode))),
            );
          }
        }
        return reasonCodes;
      }

      function renderTriggerCode(triggerType) {
        let triggerCode = triggerType;
        if (triggerType === 'crossed_half') {
          triggerCode = 'XH';
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
        if (reasonCode === 'live mode not initialized') {
          reasonShortCode = 'LNI';
        }
        if (reasonCode === 'live market unresolved') {
          reasonShortCode = 'LMR';
        }
        if (reasonCode === 'live balance unavailable') {
          reasonShortCode = 'LBA';
        }
        if (reasonCode === 'live order post failed') {
          reasonShortCode = 'LOP';
        }
        if (reasonCode === 'live entry not confirmed') {
          reasonShortCode = 'LEC';
        }
        if (reasonCode === 'live exit not confirmed') {
          reasonShortCode = 'LXC';
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
        if (reasonCode === 'setup needs directional regime') {
          reasonShortCode = 'SDR';
        }
        if (reasonCode === 'setup blocked by reversal risk') {
          reasonShortCode = 'SRV';
        }
        if (reasonCode === 'setup needs laggard structure') {
          reasonShortCode = 'SLG';
        }
        if (reasonCode === 'setup needs clear leader') {
          reasonShortCode = 'SLD';
        }
        if (reasonCode === 'setup needs momentum') {
          reasonShortCode = 'SMO';
        }
        if (reasonCode === 'setup needs basis divergence') {
          reasonShortCode = 'SBS';
        }
        if (reasonCode === 'fade conflicts with strong breadth') {
          reasonShortCode = 'SFD';
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

      function createMarketSummaryMap(summary) {
        const marketSummaryMap = {};
        for (const market of summary.markets) {
          marketSummaryMap[market.marketKey] = market;
        }
        return marketSummaryMap;
      }

      function renderCrossAssetLabel(crossAssetRegime) {
        let crossAssetLabel = 'NEU';
        if (crossAssetRegime && crossAssetRegime.breadthDirection !== 'NEUTRAL') {
          const strengthLabel = formatNumber(crossAssetRegime.breadthStrength, 2);
          crossAssetLabel = crossAssetRegime.breadthDirection + (crossAssetRegime.hasStrongBreadth ? ' STR ' : ' WK ') + strengthLabel;
        }
        return crossAssetLabel;
      }

      function renderCrossAssetHover(crossAssetRegime) {
        let crossAssetHover = 'neutral cross-asset regime';
        if (crossAssetRegime && crossAssetRegime.breadthDirection !== 'NEUTRAL') {
          crossAssetHover =
            (crossAssetRegime.hasStrongBreadth ? 'strong ' : 'weak ') +
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

      function renderRegimeName(crossAssetRegime) {
        let regimeName = 'Neutral';
        if (crossAssetRegime) {
          if (crossAssetRegime.regimeId === 'broad_up_weak') {
            regimeName = 'Broad Up';
          }
          if (crossAssetRegime.regimeId === 'broad_up_strong') {
            regimeName = 'Broad Up Strong';
          }
          if (crossAssetRegime.regimeId === 'broad_down_weak') {
            regimeName = 'Broad Down';
          }
          if (crossAssetRegime.regimeId === 'broad_down_strong') {
            regimeName = 'Broad Down Strong';
          }
          if (crossAssetRegime.regimeId === 'leader_laggard_up') {
            regimeName = 'Leader/Laggard Up';
          }
          if (crossAssetRegime.regimeId === 'leader_laggard_down') {
            regimeName = 'Leader/Laggard Down';
          }
          if (crossAssetRegime.regimeId === 'fragmented') {
            regimeName = 'Fragmented';
          }
          if (crossAssetRegime.regimeId === 'reversal_risk') {
            regimeName = 'Reversal Risk';
          }
        }
        return regimeName;
      }

      function renderRegimeCode(crossAssetRegime) {
        const regimeMarkup =
          crossAssetRegime === null || crossAssetRegime === undefined
            ? '—'
            : renderInfoCode('regime', crossAssetRegime.regimeId, renderRegimeName(crossAssetRegime)) +
              '<span class="tiny" style="margin-left:6px">' +
              formatNumber(crossAssetRegime.breadthStrength, 2) +
              '</span>';
        return regimeMarkup;
      }

      function renderRegimeCompactCode(regimeId, breadthStrength) {
        const regimeMarkup =
          regimeId === null || regimeId === undefined
            ? '—'
            : renderInfoCode('regime', regimeId, regimeId) +
              '<span class="tiny" style="margin-left:6px">' +
              formatNumber(breadthStrength ?? 0, 2) +
              '</span>';
        return regimeMarkup;
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
        const executionPerformance = summary.executionPerformance ?? summary.paperExecutionPerformance;
        const entries = [
          ["Mode", "Current execution backend. PAPER means simulated trading. REAL means live account execution.", String(summary.executionMode).toUpperCase()],
          ["Exe", "Markets that currently pass the entry gate and would allow a new trade.", executionPerformance.executableEntryCount],
          ["Open pos", "Positions currently open or pending maker exit in the active execution backend.", executionPerformance.openPositionCount],
          [summary.executionMode === "real" ? "PnL R" : "PnL P", "Cumulative net PnL for the active execution backend.", formatNumber(executionPerformance.cumulativeNetPnl)],
          ["Max DD", "Maximum rolling drawdown of the active execution curve.", formatNumber(executionPerformance.maxDrawdown)],
          ["Mkr %", "Share of trades where maker logic achieved a passive fill on at least one side.", (executionPerformance.makerFillRate * 100).toFixed(1) + "%"],
        ];
        if (summary.executionMode === "real") {
          entries.push(["Bal", "Live Polymarket collateral balance refreshed from the configured wallet.", summary.account.balanceUsd === null ? "—" : "$" + formatNumber(summary.account.balanceUsd, 2)]);
        }
        replaceStaticContent("kpis", entries.map(([label, hint, value]) => '<div class="kpi"><div class="tiny">' + renderHintLabel(label, hint) + '</div><strong>' + value + '</strong></div>').join(""));
      }

      function renderGlobalRegime(summary) {
        const globalRegime = summary.globalRegime;
        const markup = globalRegime === null
          ? '<div class="tiny">No global regime detected yet.</div>'
          : '<div class="health-grid">' +
              '<div class="health-item"><strong>' + renderInfoCode('regime', globalRegime.regimeId, renderRegimeName(globalRegime)) + '</strong><div class="tiny">' + renderHintLabel('Class', 'Regime class derived from breadth, leader/laggard structure, fragmentation, and reversal risk.') + '</div></div>' +
              '<div class="health-item"><strong>' + renderCrossAssetLabel(globalRegime) + '</strong><div class="tiny">' + renderHintLabel('Breadth', 'Compact breadth label with weak or strong strength marker.') + '</div></div>' +
              '<div class="health-item"><strong>' + formatNumber(globalRegime.breadthParticipation, 2) + '</strong><div class="tiny">' + renderHintLabel('Participation', 'Share of qualifying markets moving in the dominant direction.') + '</div></div>' +
              '<div class="health-item"><strong>' + formatNumber(globalRegime.synchronyScore, 2) + '</strong><div class="tiny">' + renderHintLabel('Synchrony', 'How tightly the monitored assets are moving together right now.') + '</div></div>' +
              '<div class="health-item"><strong>' + escapeHtml(globalRegime.leaderGroup.join(', ') || '—') + '</strong><div class="tiny">' + renderHintLabel('Leaders', 'Markets currently leading the global move.') + '</div></div>' +
              '<div class="health-item"><strong>' + (globalRegime.laggardGroup.join(', ') || '—') + '</strong><div class="tiny">' + renderHintLabel('Laggards', 'Markets lagging behind the dominant move and therefore candidates for propagation setups.') + '</div></div>' +
              '<div class="health-item"><strong>' + formatNumber(globalRegime.accelerationScore, 2) + '</strong><div class="tiny">' + renderHintLabel('Accel', 'Speed at which the cross-asset move is broadening or strengthening.') + '</div></div>' +
              '<div class="health-item"><strong>' + formatNumber(globalRegime.reversalRiskScore, 2) + '</strong><div class="tiny">' + renderHintLabel('Rev risk', 'Estimated risk that continuation setups are already too stretched.') + '</div></div>' +
            '</div>';
        replaceStaticContent("global-regime", markup);
      }

      function renderMarkets(summary) {
        const marketPerformanceMap = createMarketPerformanceMap(summary);
        const executionDecisionMap = createExecutionDecisionMap(summary);
        const latestPredictionMap = buildLatestPredictionMap(summary);
        const rows = summary.markets.map((market) => {
          const qualityWidth = Math.max(0, Math.min(100, market.quality.score * 100));
          const qualityDetails = 'score ' + formatNumber(market.quality.score, 2) + (market.quality.issues.length === 0 ? ' · healthy' : ' · ' + market.quality.issues.join(', '));
          const marketPerformance = marketPerformanceMap[market.marketKey];
          const executionDecision = executionDecisionMap[market.marketKey];
          const latestPrediction = latestPredictionMap[market.marketKey];
          const marketScore = marketPerformance ? formatNumber(marketPerformance.score, 2) : '—';
          const marketStatus = marketPerformance ? marketPerformance.status.replace('_', ' ') : 'warming up';
          const regimeLabel =
            latestPrediction === undefined
              ? '—'
              : renderRegimeCode(latestPrediction.crossAssetRegime);
          const regimeHover =
            latestPrediction === undefined
              ? 'no execution decision yet'
              : renderCrossAssetHover(latestPrediction.crossAssetRegime);
          const setupLabel = latestPrediction ? renderInfoCode('setup', latestPrediction.winningSetupType) : '—';
          return '<tr>' +
            '<td><strong>' + market.asset.toUpperCase() + '</strong> <span class="tiny">' + market.window + '</span></td>' +
            '<td>' + formatNumber(market.latestUpMidpoint) + '</td>' +
            '<td>' + formatNumber(market.latestDownMidpoint) + '</td>' +
            '<td>' + formatNumber(market.cooldownRemainingMs, 0) + '</td>' +
            '<td><span title="' + marketStatus + '">' + marketScore + '</span></td>' +
            '<td><span title="' + regimeHover + '">' + regimeLabel + '</span></td>' +
            '<td>' + setupLabel + '</td>' +
            '<td><span class="quality-cell" title="' + qualityDetails + '"><span>' + formatNumber(market.quality.score, 2) + '</span><div class="quality-bar"><span style="width:' + qualityWidth + '%"></span></div></span></td>' +
            '</tr>';
        }).join("");
        replacePanelContent("markets", renderTableShell('<table><thead><tr><th>' + renderHintLabel('Market', 'Asset and resolution window for the monitored Polymarket contract.') + '</th><th>' + renderHintLabel('UP', 'Current midpoint for the UP token. This panel shows the midpoint directly, without the longer mid suffix.') + '</th><th>' + renderHintLabel('DOWN', 'Current midpoint for the DOWN token.') + '</th><th>' + renderHintLabel('Cooldown', 'Milliseconds remaining before this market can emit another prediction.') + '</th><th>' + renderHintLabel('Mkt score', 'Recent trading score for this market only. It reflects local hit rate, PnL, drawdown, and sample size over the rolling market-score window.') + '</th><th>' + renderHintLabel('Regime', 'Cross-asset regime for this market or its latest resolved idea.') + '</th><th>' + renderHintLabel('Setup', 'Dominant setup attached to the latest resolved prediction for this market.') + '</th><th>' + renderHintLabel('Quality', 'Continuous data quality score. It penalizes stale token timestamps, weak spot coverage, wide spreads, midpoint fallbacks, stale chainlink, and venue dispersion.') + '</th></tr></thead><tbody>' + rows + '</tbody></table>'));
      }

      function renderPredictions(summary) {
        const rows = summary.latestPredictions.map((prediction) => {
          const triggerLabel = humanizeReason(prediction.trigger.triggerType) === prediction.trigger.triggerType
            ? prediction.trigger.triggerType.replace('_', ' ')
            : humanizeReason(prediction.trigger.triggerType);
          return '<tr>' +
            '<td><strong>' + prediction.asset.toUpperCase() + '</strong> <span class="tiny">' + prediction.window + '</span></td>' +
            '<td>' + renderDirectionPill(prediction.direction) + '</td>' +
            '<td>' + formatNumber(prediction.confidence) + '</td>' +
            '<td><span title="' + triggerLabel + '">' + renderTriggerCode(prediction.trigger.triggerType) + '</span></td>' +
            '<td>' + renderInfoCode('setup', prediction.winningSetupType) + '</td>' +
            '<td><span title="' + prediction.winningEngineIds.join(', ') + '">' + renderEngineComboCodes(prediction.winningEngineIds) + '</span></td>' +
            '<td>' + renderResultBadge(prediction.result) + '</td>' +
            '<td>' + formatTimestamp(prediction.timestamp) + '</td>' +
            '</tr>';
        }).join("");
        replacePanelContent("predictions", renderTableShell('<table><thead><tr><th>' + renderHintLabel('Market', 'Asset and resolution window for this prediction.') + '</th><th>' + renderHintLabel('Dir', 'Final direction chosen by the winning engine combination.') + '</th><th>' + renderHintLabel('Conf', 'Normalized confidence attached to the winning setup.') + '</th><th>' + renderHintLabel('Trig', 'Compact trigger code. XH = crossed half.') + '</th><th>' + renderHintLabel('Setup', 'Winning setup type selected by the new combination engine.') + '</th><th>' + renderHintLabel('Eng combo', 'Winning engine combo key for this prediction.') + '</th><th>' + renderHintLabel('Result', 'OK means the trade hit take profit. KO means it hit stop loss.') + '</th><th>' + renderHintLabel('At', 'Prediction creation timestamp.') + '</th></tr></thead><tbody>' + rows + '</tbody></table>'));
      }

      function renderEngineBoard(summary) {
        const selectedBoard = summary.engineBoards.find((engineBoard) => engineBoard.marketKey === summary.selectedStrategyMarketKey) ?? summary.engineBoards[0];
        const latestPredictionMap = buildLatestPredictionMap(summary);
        const selectedPrediction = selectedBoard ? latestPredictionMap[selectedBoard.marketKey] : null;
        const rows = (selectedBoard?.engines ?? []).map((engine) => {
          return '<tr>' +
            '<td><strong>' + renderInfoCode('engine', engine.engineId, engine.name) + '</strong></td>' +
            '<td>' + renderInfoCode('engineState', engine.state, engine.state.toUpperCase()) + '</td>' +
            '<td>' + renderDirectionPill(engine.direction) + '</td>' +
            '<td>' + formatNumber(engine.score, 2) + '</td>' +
            '<td>' + formatNumber(engine.confidence, 2) + '</td>' +
            '<td>' + formatNumber(engine.regimeFit, 2) + '</td>' +
            '<td><span title="' + (engine.activationReason ?? engine.blockingReason ?? 'no reason') + '">' + renderInfoCode('setup', engine.setupType) + '</span></td>' +
            '</tr>';
        }).join("");
        replacePanelContent("engine-board",
          '<div class="tiny" style="margin-bottom:8px">' +
            renderHintLabel('Sel mkt', 'The engine board is shown for one market at a time.') +
            ': ' +
            (selectedBoard?.marketKey ?? '—') +
            '</div>' +
          '<div class="tiny" style="margin-bottom:10px">' +
            renderHintLabel('Win cmb', 'Latest winning engine combo for the selected market if one exists.') +
            ': ' +
            (selectedPrediction?.winningEngineIds ? renderEngineComboCodes(selectedPrediction.winningEngineIds) : '—') +
            ' · setup ' +
            (selectedPrediction?.winningSetupType ? renderInfoCode('setup', selectedPrediction.winningSetupType) : '—') +
            '</div>' +
          renderTableShell('<table><thead><tr><th>' + renderHintLabel('Engine', 'Engine name plus compact id and source scope.') + '</th><th>' + renderHintLabel('State', 'Inactive, weak, active, dominant, or avoid.') + '</th><th>' + renderHintLabel('Dir', 'Direction currently implied by the engine.') + '</th><th>' + renderHintLabel('Score', 'Signed engine score after regime fit.') + '</th><th>' + renderHintLabel('Conf', 'Engine confidence.') + '</th><th>' + renderHintLabel('Fit', 'Regime fit score for this engine.') + '</th><th>' + renderHintLabel('Role', 'Default setup/narrative attached to the engine.') + '</th></tr></thead><tbody>' + rows + '</tbody></table>'));
      }

      function renderEngineGrid(summary) {
        const engineOrder = ['breadth_engine', 'propagation_engine', 'local_momentum_engine', 'local_microstructure_engine', 'mispricing_engine', 'reversion_engine', 'meta_engine'];
        const engineHeaderMarkup = engineOrder.map((engineId) => {
          return '<th>' + renderInfoCode('engine', engineId, engineId) + '</th>';
        }).join('');
        const rows = summary.engineBoards.map((engineBoard) => {
          const engineMap = {};
          for (const engine of engineBoard.engines) {
            engineMap[engine.engineId] = engine;
          }
          const cellMarkup = engineOrder.map((engineId) => {
            const engine = engineMap[engineId] ?? null;
            const engineStateCode = engine === null ? '—' : (lookupTypedCode('engineState', engine.state)?.code ?? engine.state.toUpperCase());
            const directionClass = engine === null ? 'muted' : engine.direction === 'UP' ? 'up' : 'down';
            const intensity = engine === null ? 0.08 : Math.max(0.12, Math.min(0.92, Math.abs(engine.score) * 0.55 + engine.confidence * 0.25));
            const borderOpacity = engine === null ? 0.12 : engine.isActive ? 0.32 : 0.16;
            const backgroundColor =
              engine === null
                ? 'rgba(13, 27, 42, 0.04)'
                : engine.direction === 'UP'
                  ? 'rgba(15, 157, 88, ' + intensity + ')'
                  : 'rgba(192, 57, 43, ' + intensity + ')';
            const engineDescription =
              engine === null
                ? 'No engine data available for this market.'
                : 'State: ' + engine.state + '. Direction: ' + engine.direction + '. Score: ' + formatNumber(engine.score, 2) + '. Confidence: ' + formatNumber(engine.confidence, 2) + '. Regime fit: ' + formatNumber(engine.regimeFit, 2) + '. ' + (engine.activationReason ?? engine.blockingReason ?? 'No extra reason available.');
            return '<td><button type="button" class="engine-matrix-cell ' + directionClass + '" style="background:' + backgroundColor + ';border-color:rgba(13, 27, 42, ' + borderOpacity + ')" data-full-label="' + escapeHtml((engineBoard.marketKey + ' · ' + (lookupTypedCode('engine', engineId)?.label ?? engineId))) + '" data-description="' + escapeHtml(engineDescription) + '" aria-label="' + escapeHtml((engineBoard.marketKey + '. ' + engineDescription)) + '">' + engineStateCode + '</button></td>';
          }).join('');
          return '<tr><td class="engine-matrix-market"><strong>' + engineBoard.marketKey.replace(':', ' ') + '</strong></td>' + cellMarkup + '</tr>';
        }).join('');
        const tableMarkup =
          '<div class="engine-matrix"><table class="engine-matrix-table"><thead><tr><th class="engine-matrix-market">' +
          renderHintLabel('Mkt', 'Market key for the row.') +
          '</th>' +
          engineHeaderMarkup +
          '</tr></thead><tbody>' +
          rows +
          '</tbody></table></div>';
        replacePanelContent('engine-grid', tableMarkup);
      }

      function renderExecution(summary) {
        const rows = summary.executionNow.map((marketExecution) => {
          const whyNot = renderWhyNot(marketExecution.decision);
          const reasonCodes = renderReasonCodes(marketExecution.decision);
          const comboHover = marketExecution.decision.winningEngineIds.length === 0 ? 'no winning engine combo selected' : marketExecution.decision.winningEngineIds.join(', ');
          const marketScoreLabel =
            marketExecution.decision.marketScore === null
              ? '—'
              : formatNumber(marketExecution.decision.marketScore, 2) + ' / ' + marketExecution.decision.marketTradeCount;
          const scoreLabel =
            marketExecution.decision.researchScore === null
              ? '—'
              : formatNumber(marketExecution.decision.researchScore, 2) + ' / ' + formatNumber(marketExecution.decision.executionScore) + ' / ' + formatNumber(marketExecution.decision.effectiveExecutionScore, 2);
          const comboGateLabel = marketExecution.decision.hasComboGatePassed ? '<span class="pill up">OPN</span>' : '<span class="pill down">BLK</span>';
          const breadthLabel = marketExecution.decision.regimeId === null
            ? '—'
            : renderRegimeCompactCode(marketExecution.decision.regimeId, marketExecution.decision.breadthStrength);
          const breadthHover =
            marketExecution.decision.breadthDirection === 'NEUTRAL'
              ? 'neutral cross-asset regime'
              : (marketExecution.decision.hasStrongBreadth ? 'strong ' : 'weak ') + marketExecution.decision.breadthDirection.toLowerCase() + ' breadth, strength ' + formatNumber(marketExecution.decision.breadthStrength, 2);
          return '<tr>' +
            '<td><strong>' + marketExecution.asset.toUpperCase() + '</strong> <span class="tiny">' + marketExecution.window + '</span></td>' +
            '<td>' + renderActionLabel(marketExecution.decision) + '</td>' +
            '<td>' + (marketExecution.decision.winningSetupType === null ? '—' : renderInfoCode('setup', marketExecution.decision.winningSetupType)) + '</td>' +
            '<td><span title="' + comboHover + '">' + renderEngineComboCodes(marketExecution.decision.winningEngineIds) + '</span></td>' +
            '<td>' + scoreLabel + '</td>' +
            '<td><span title="' + breadthHover + '">' + breadthLabel + '</span></td>' +
            '<td>' + marketScoreLabel + '</td>' +
            '<td>' + comboGateLabel + '</td>' +
            '<td>' + renderConvictionLabel(marketExecution.decision.positionSizeSuggestion) + '</td>' +
            '<td><span class="truncate-cell" title="' + whyNot + '">' + reasonCodes + '</span></td>' +
            '</tr>';
        }).join("");
        replacePanelContent("execution", renderTableShell('<table><thead><tr><th>' + renderHintLabel('Market', 'Asset and resolution window for the execution decision.') + '</th><th>' + renderHintLabel('Act', 'BU = buy UP, BD = buy DOWN, NO = no trade.') + '</th><th>' + renderHintLabel('Setup', 'Winning setup type currently driving the decision.') + '</th><th>' + renderHintLabel('Eng combo', 'Winning engine combo key for the market.') + '</th><th>' + renderHintLabel('Scores', 'Research / execution / effective execution score for this market.') + '</th><th>' + renderHintLabel('Regime', 'Cross-asset breadth regime for this window.') + '</th><th>' + renderHintLabel('Mkt score', 'Effective execution score followed by recent trade count.') + '</th><th>' + renderHintLabel('Gate', 'OPN = open, BLK = blocked for the legacy combo gate.') + '</th><th>' + renderHintLabel('Cnv', 'HI/MD/LO conviction from confidence, quality, and book risk.') + '</th><th>' + renderHintLabel('Why', 'Compact reason code. Hover each cell for the full explanation.') + '</th></tr></thead><tbody>' + rows + '</tbody></table>'));
      }

      function clamp01(value) {
        return Math.max(0, Math.min(1, value));
      }

      function computeTradeProximity(decision, market) {
        const setupStrength = decision.winningSetupType === null ? 0 : clamp01((decision.winningEngineComboScore ?? 0.35) * 1.1);
        const comboStrength = decision.hasComboGatePassed ? 1 : 0;
        const scoreStrength = decision.effectiveExecutionScore === null ? 0 : clamp01(decision.effectiveExecutionScore);
        const qualityStrength = clamp01(market?.quality?.score ?? 0);
        let regimeStrength = 0.45;
        if (decision.regimeId !== null) {
          regimeStrength = decision.hasBreadthAlignment ? (decision.hasStrongBreadth ? 1 : 0.72) : 0.18;
        }
        const weightedBase =
          setupStrength * 0.24 +
          comboStrength * 0.18 +
          scoreStrength * 0.22 +
          qualityStrength * 0.18 +
          regimeStrength * 0.18;
        let proximity = decision.isEntryAllowed ? 1 : weightedBase;
        if (decision.gateFailures.includes('combo_gate_failed')) {
          proximity *= 0.58;
        }
        if (decision.gateFailures.includes('cross_asset_regime_conflict')) {
          proximity *= 0.42;
        }
        if (decision.gateFailures.includes('market_warming_up')) {
          proximity *= 0.62;
        }
        if (decision.gateFailures.includes('bootstrap_discount_too_low') || decision.gateFailures.includes('insufficient_execution_history')) {
          proximity *= 0.74;
        }
        if (decision.gateFailures.includes('quality_too_low')) {
          proximity *= 0.68;
        }
        if (decision.gateFailures.includes('outside_entry_band') || decision.gateFailures.includes('spread_too_wide')) {
          proximity *= 0.82;
        }
        return {
          proximity: clamp01(proximity),
          setupStrength,
          comboStrength,
          scoreStrength,
          qualityStrength,
          regimeStrength,
        };
      }

      function renderProximityBand(label, value, description) {
        return '<button type="button" class="proximity-band" data-full-label="' +
          escapeHtml(label) +
          '" data-description="' +
          escapeHtml(description + ' Current value: ' + formatNumber(value, 2)) +
          '" aria-label="' +
          escapeHtml(label + '. ' + description) +
          '">' +
          '<span class="proximity-bar"><span class="proximity-bar-fill" style="height:' + Math.round(clamp01(value) * 100) + '%"></span></span>' +
          '<span class="proximity-band-label">' + escapeHtml(label) + '</span>' +
          '</button>';
      }

      function pushTradeProximityHistory(marketKey, proximityValue) {
        const previousHistory = tradeProximityHistory.get(marketKey) ?? [];
        const nextHistory = [...previousHistory, proximityValue].slice(-maxTradeProximityHistory);
        tradeProximityHistory.set(marketKey, nextHistory);
        return nextHistory;
      }

      function renderTradeProximityTrend(historyValues) {
        const trendMarkup = historyValues.map((historyValue) => {
          const barHeight = Math.max(4, Math.round(clamp01(historyValue) * 20));
          return '<span class="proximity-trend-bar" style="height:' + barHeight + 'px"></span>';
        }).join('');
        return '<div class="proximity-trend">' + trendMarkup + '</div>';
      }

      function renderTradeProximity(summary) {
        const executionDecisionMap = createExecutionDecisionMap(summary);
        const marketSummaryMap = createMarketSummaryMap(summary);
        const rows = summary.executionNow.map((marketExecution) => {
          const decision = executionDecisionMap[marketExecution.marketKey];
          const market = marketSummaryMap[marketExecution.marketKey];
          const proximity = computeTradeProximity(decision, market);
          const proximityLabel = decision.isEntryAllowed ? 'RDY' : proximity.proximity >= 0.75 ? 'HOT' : proximity.proximity >= 0.5 ? 'MID' : 'COLD';
          const equalizerMarkup =
            renderProximityBand('STP', proximity.setupStrength, 'How strong the active setup and winning engine combo look for this market.') +
            renderProximityBand('CMB', proximity.comboStrength, 'Whether the combo gate is already open.') +
            renderProximityBand('SCR', proximity.scoreStrength, 'Effective execution score contribution.') +
            renderProximityBand('QLT', proximity.qualityStrength, 'Current market data quality contribution.') +
            renderProximityBand('REG', proximity.regimeStrength, 'Cross-asset regime support contribution.');
          const historyValues = pushTradeProximityHistory(marketExecution.marketKey, proximity.proximity);
          return '<div class="proximity-row">' +
            '<div><strong>' + marketExecution.marketKey.replace(':', ' ') + '</strong></div>' +
            '<div class="proximity-eq">' + equalizerMarkup + '</div>' +
            '<div class="proximity-score"><strong>' + Math.round(proximity.proximity * 100) + '%</strong><span class="tiny">' + proximityLabel + '</span>' + renderTradeProximityTrend(historyValues) + '</div>' +
            '</div>';
        }).join('');
        replacePanelContent('trade-proximity', '<div class="proximity-list">' + rows + '</div>');
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
        replacePanelContent('market-pnl', renderTableShell('<table><thead><tr><th>' + renderHintLabel('Mkt', 'Market key.') + '</th><th>' + renderHintLabel('Trd', 'Number of recent closed paper trades in this market.') + '</th><th>' + renderHintLabel('Hit', 'Recent paper trade hit rate in this market.') + '</th><th>' + renderHintLabel('PnL', 'Cumulative recent paper net PnL for this market.') + '</th><th>' + renderHintLabel('Avg', 'Average net PnL per trade in this market.') + '</th><th>' + renderHintLabel('DD', 'Maximum rolling drawdown proxy for this market.') + '</th><th>' + renderHintLabel('Scr', 'Research / execution / effective execution score.') + '</th><th>' + renderHintLabel('St', 'Market status. WRM = warming up, RSC = research only, TRD = tradable, AVD = avoid.') + '</th></tr></thead><tbody>' + rows + '</tbody></table>'));
      }

      function renderWinningCombinations(summary) {
        const rows = summary.winningCombinations.map((prediction) => {
          return '<tr>' +
            '<td><strong>' + prediction.marketKey.replace(':', ' ') + '</strong></td>' +
            '<td>' + renderInfoCode('setup', prediction.winningSetupType) + '</td>' +
            '<td><span title="' + prediction.winningEngineIds.join(', ') + '">' + renderEngineComboCodes(prediction.winningEngineIds) + '</span></td>' +
            '<td>' + formatNumber(prediction.winningEngineComboScore, 2) + '</td>' +
            '<td>' + formatNumber(prediction.confidence, 2) + '</td>' +
            '<td>' + renderRegimeCode(prediction.crossAssetRegime) + '</td>' +
            '<td><span class="truncate-cell" title="' + prediction.combinationReason + '">' + prediction.combinationReason + '</span></td>' +
            '</tr>';
        }).join('');
        replacePanelContent('winning-combinations', summary.winningCombinations.length === 0
          ? '<div class="tiny">No winning combinations yet.</div>'
          : renderTableShell('<table><thead><tr><th>' + renderHintLabel('Mkt', 'Market key for the prediction.') + '</th><th>' + renderHintLabel('Setup', 'Winning setup selected by the combination engine.') + '</th><th>' + renderHintLabel('Combo', 'Winning combo of engines for the setup.') + '</th><th>' + renderHintLabel('Score', 'Winning engine combo score.') + '</th><th>' + renderHintLabel('Conf', 'Final confidence for the chosen setup.') + '</th><th>' + renderHintLabel('Regime', 'Regime attached to the prediction when it was created.') + '</th><th>' + renderHintLabel('Narrative', 'Short reason for why this combination won.') + '</th></tr></thead><tbody>' + rows + '</tbody></table>'));
      }

      function renderDiscoveryBoard(summary) {
        const rows = summary.discoveryBoard.map((discoveryEntry) => {
          return '<tr>' +
            '<td><strong>' + renderInfoCode('setup', discoveryEntry.setupType) + '</strong></td>' +
            '<td><span title="' + discoveryEntry.markets.join(', ') + '">' + renderEngineComboCodes(discoveryEntry.comboKey.split('+')) + '</span></td>' +
            '<td>' + formatNumber(discoveryEntry.hitRate, 2) + '</td>' +
            '<td>' + formatNumber(discoveryEntry.averageConfidence, 2) + '</td>' +
            '<td>' + discoveryEntry.sampleCount + '</td>' +
            '<td><span title="' + discoveryEntry.markets.join(', ') + '">' + discoveryEntry.markets.join(', ') + '</span></td>' +
            '</tr>';
        }).join('');
        replacePanelContent('discovery', summary.discoveryBoard.length === 0
          ? '<div class="tiny">No engine-combo learning history yet.</div>'
          : renderTableShell('<table><thead><tr><th>' + renderHintLabel('Setup', 'Setup narrative tracked by the prediction layer.') + '</th><th>' + renderHintLabel('Combo', 'Engine combo key being learned.') + '</th><th>' + renderHintLabel('Hit', 'Resolved hit rate for that combo/setup.') + '</th><th>' + renderHintLabel('Avg conf', 'Average confidence for that combo/setup.') + '</th><th>' + renderHintLabel('N', 'Number of resolved predictions inside the dashboard window.') + '</th><th>' + renderHintLabel('Markets', 'Markets where this combo/setup has recently appeared.') + '</th></tr></thead><tbody>' + rows + '</tbody></table>'));
      }

      function renderPositions(summary) {
        const rows = summary.openPositions.map((position) => {
          return '<tr>' +
            '<td><strong>' + position.asset.toUpperCase() + '</strong> <span class="tiny">' + position.window + '</span></td>' +
            '<td>' + renderPositionSideLabel(position.positionSide) + '</td>' +
            '<td><span title="' + position.status.replaceAll('_', ' ') + '">' + renderStatusCode(position.status) + '</span></td>' +
            '<td>' + position.shareCount + '</td>' +
            '<td>' + formatNumber(position.entryFillPrice) + '</td>' +
            '<td>' + formatNumber(position.liveTokenPrice) + '</td>' +
            '<td>' + formatNumber(position.unrealizedPnlTokenPrice) + '</td>' +
            '<td>' + formatNumber(position.takeProfitPrice) + '</td>' +
            '<td>' + formatNumber(position.stopLossPrice) + '</td>' +
            '</tr>';
        }).join("");
        replacePanelContent("positions", summary.openPositions.length === 0
          ? '<div class="tiny">No open paper positions.</div>'
          : renderTableShell('<table><thead><tr><th>' + renderHintLabel('Market', 'Asset and window of the open paper position.') + '</th><th>' + renderHintLabel('Side', 'Token currently held: U or D. Use the hint to read the full meaning.') + '</th><th>' + renderHintLabel('Status', 'Position lifecycle state, including maker-pending statuses.') + '</th><th>' + renderHintLabel('Qty', 'Position size in shares. The execution overlay respects the 5-share minimum.') + '</th><th>' + renderHintLabel('Entry fill', 'Simulated fill price used to open the position.') + '</th><th>' + renderHintLabel('Live px', 'Current token midpoint or fallback price for mark-to-market.') + '</th><th>' + renderHintLabel('uPnL', 'Unrealized token-price PnL after scaling by the current share count, before paper execution costs.') + '</th><th>' + renderHintLabel('TP', 'Take-profit target for this open position.') + '</th><th>' + renderHintLabel('SL', 'Stop-loss level for this open position.') + '</th></tr></thead><tbody>' + rows + '</tbody></table>'));
      }

      function renderTrades(summary) {
        const rows = summary.recentTrades.map((trade) => {
          return '<tr>' +
            '<td><strong>' + trade.asset.toUpperCase() + '</strong> <span class="tiny">' + trade.window + '</span></td>' +
            '<td>' + renderPositionSideLabel(trade.positionSide) + '</td>' +
            '<td>' + trade.shareCount + '</td>' +
            '<td>' + renderInfoCode('executionStyle', trade.entryExecutionStyle, renderExecutionStyleCode(trade.entryExecutionStyle)) + '</td>' +
            '<td>' + renderInfoCode('executionStyle', trade.exitExecutionStyle, renderExecutionStyleCode(trade.exitExecutionStyle)) + '</td>' +
            '<td>' + renderInfoCode('tradeExitReason', trade.exitReason, renderReasonCode(trade.exitReason)) + '</td>' +
            '<td>' + formatNumber(trade.realizedPnlAfterCosts) + '</td>' +
            '<td>' + formatNumber(trade.holdTimeMs, 0) + '</td>' +
            '</tr>';
        }).join("");
        replacePanelContent("trades", summary.recentTrades.length === 0
          ? '<div class="tiny">No closed paper trades yet.</div>'
          : renderTableShell('<table><thead><tr><th>' + renderHintLabel('Market', 'Asset and window of the closed paper trade.') + '</th><th>' + renderHintLabel('Side', 'Token that was bought for the trade. U = UP, D = DOWN.') + '</th><th>' + renderHintLabel('Qty', 'Filled share count used for the trade. Polymarket minimums require at least 5 shares and at least $1 of notional.') + '</th><th>' + renderHintLabel('In', 'Entry execution code. M = maker, T = taker.') + '</th><th>' + renderHintLabel('Out', 'Exit execution code. M = maker, T = taker.') + '</th><th>' + renderHintLabel('Exit', 'Exit reason code. TP = take profit, SL = stop loss.') + '</th><th>' + renderHintLabel('Net PnL', 'Realized simulated PnL after proxy entry and exit costs, scaled by the executed share count.') + '</th><th>' + renderHintLabel('Hold time', 'Milliseconds between entry fill and exit fill.') + '</th></tr></thead><tbody>' + rows + '</tbody></table>'));
      }

      function renderHealth(summary) {
        replaceStaticContent("health",
          '<div class="health-grid">' +
            '<div class="health-item"><strong>' + summary.health.serviceName + '</strong><div class="tiny">' + renderHintLabel('Started', 'Timestamp when the current service runtime booted.') + ': ' + formatTimestamp(summary.health.startedAt) + '</div></div>' +
            '<div class="health-item"><strong>' + formatNumber(summary.health.snapshotAgeMs, 0) + ' ms</strong><div class="tiny">' + renderHintLabel('Snap age', 'Milliseconds since the last snapshot was processed by the service.') + '</div></div>' +
            '<div class="health-item"><strong>' + summary.health.isSnapshotHealthy + '</strong><div class="tiny">' + renderHintLabel('Healthy', 'True when the latest snapshot is fresh enough according to configured freshness thresholds.') + '</div></div>' +
            '<div class="health-item"><strong>' + String(summary.executionMode).toUpperCase() + '</strong><div class="tiny">' + renderHintLabel('Exec mode', 'Current execution backend used for orders and operational stats.') + '</div></div>' +
            '<div class="health-item"><strong>' + summary.health.pendingEvaluationCount + '</strong><div class="tiny">' + renderHintLabel('Act trd', 'Number of active positions still open or waiting on maker fills in the current execution backend.') + '</div></div>' +
            '<div class="health-item"><strong>' + (summary.account.balanceUsd === null ? '—' : '$' + formatNumber(summary.account.balanceUsd, 2)) + '</strong><div class="tiny">' + renderHintLabel('Balance', 'Current account balance for real mode. Empty in paper mode.') + '</div></div>' +
            '<div class="health-item"><strong>' + (summary.account.lastBalanceRefreshAt === null ? '—' : formatNumber(summary.generatedAt - summary.account.lastBalanceRefreshAt, 0) + ' ms') + '</strong><div class="tiny">' + renderHintLabel('Bal age', 'Milliseconds since the last account balance refresh.') + '</div></div>' +
            '<div class="health-item"><strong>' + (summary.makerTakerStats.makerUsageRatio * 100).toFixed(1) + '%</strong><div class="tiny">' + renderHintLabel('Mkr use', 'Share of recent trades opened as maker.') + '</div></div>' +
            '<div class="health-item"><strong>' + (summary.makerTakerStats.takerUsageRatio * 100).toFixed(1) + '%</strong><div class="tiny">' + renderHintLabel('Tkr use', 'Share of recent trades opened as taker.') + '</div></div>' +
            '<div class="health-item"><strong>' + (summary.account.lastBalanceError ?? 'none') + '</strong><div class="tiny">' + renderHintLabel('Bal err', 'Last account-balance refresh error if one occurred.') + '</div></div>' +
          '</div>');
      }

      async function refresh() {
        const response = await fetch('/v1/dashboard/summary', { headers: { accept: 'application/json' } });
        const summary = await response.json();
        renderKpis(summary);
        renderGlobalRegime(summary);
        renderMarkets(summary);
        renderPredictions(summary);
        renderExecution(summary);
        renderTradeProximity(summary);
        renderWinningCombinations(summary);
        renderEngineBoard(summary);
        renderEngineGrid(summary);
        renderMarketPnl(summary);
        renderDiscoveryBoard(summary);
        renderPositions(summary);
        renderTrades(summary);
        renderHealth(summary);
      }

      document.addEventListener('click', (event) => {
        const targetElement = event.target instanceof HTMLElement ? event.target.closest('.code-chip, .hint-label') : null;
        if (targetElement instanceof HTMLElement) {
          event.preventDefault();
          event.stopPropagation();
          if (activeInfoPopover !== null && activeInfoPopover.getAttribute('data-owner') === targetElement.getAttribute('aria-label')) {
            closeInfoPopover();
          } else {
            openInfoPopover(targetElement);
            if (activeInfoPopover !== null) {
              activeInfoPopover.setAttribute('data-owner', targetElement.getAttribute('aria-label') ?? '');
            }
          }
        } else {
          closeInfoPopover();
        }
      });

      window.addEventListener('resize', () => {
        closeInfoPopover();
      });

      window.addEventListener('scroll', () => {
        closeInfoPopover();
      }, true);

      refresh();
      setInterval(refresh, pollIntervalMs);
    </script>
  </body>
</html>`;
    return html;
  }
}
