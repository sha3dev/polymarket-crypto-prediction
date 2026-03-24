# @sha3/polymarket-crypto-prediction

Real-time Node.js service for Polymarket crypto Up/Down markets with three layers in one process:

- market monitoring from `@sha3/polymarket-snapshot`
- event-driven 30-second prediction and rolling strategy scoring
- paper execution overlay for near-`0.5` entries, TP/SL exits, and maker-vs-taker choice

## TL;DR

```bash
npm install
npm run check
npm run start
```

Open:

- `http://localhost:3300/` dashboard
- `http://localhost:3300/v1/healthz` health
- `http://localhost:3300/v1/execution` current paper execution state

## Why

Use this package when you want one service that can answer both:

- “what does the ensemble predict around the 0.5 zone?”
- “if I only wanted to trade those signals near 0.5, would I enter now, with TP/SL, as maker or taker, and how would that policy have performed recently?”

## Main Capabilities

- Watches BTC, ETH, SOL, and XRP on `5m` and `15m` Polymarket markets.
- Triggers predictions only on proximity or crosses around `0.5`.
- Scores twenty strategies and adapts ensemble weights online.
- Simulates execution for token entries near `0.5` with token-price TP/SL.
- Decides `maker` vs `taker` from order-book conditions and urgency.
- Sizes paper trades so they respect Polymarket minimums of `5` shares and `$1` notional.
- Warms up each market with a few predictions before the paper execution overlay is allowed to trade it.
- Exposes REST APIs plus a single-screen Hono dashboard with hover hints.

## Installation

```bash
npm install
```

## Setup

Minimal example:

```bash
PORT=3300
SNAPSHOT_INTERVAL_MS=500
ENTRY_TARGET_PRICE=0.5
ENTRY_BAND_HALF_WIDTH=0.02
MIN_ORDER_USD=1
MIN_ORDER_SHARES=5
TAKE_PROFIT_DELTA=0.2
STOP_LOSS_DELTA=0.2
```

## Running Locally

```bash
npm run start
```

The default runtime serves the dashboard and APIs on `http://localhost:3300`.

## Usage

### Start the default runtime

```ts
import { ServiceRuntime } from "@sha3/polymarket-crypto-prediction";

const serviceRuntime = ServiceRuntime.createDefault();
serviceRuntime.startServer();
```

### Build the server without listening

```ts
import { ServiceRuntime } from "@sha3/polymarket-crypto-prediction";

const serviceRuntime = ServiceRuntime.createDefault();
const server = serviceRuntime.buildServer();
```

### Inject deterministic snapshots

```ts
import { ServiceRuntime } from "@sha3/polymarket-crypto-prediction";

const serviceRuntime = ServiceRuntime.createDefault();

serviceRuntime.ingestSnapshot({
  generated_at: Date.now(),
  btc_5m_slug: "btc-up-or-down",
  btc_5m_up_price: 0.5,
  btc_5m_down_price: 0.5,
});
```

### Stop the runtime

```ts
await serviceRuntime.stop();
```

## Examples

Latest prediction:

```bash
curl "http://localhost:3300/v1/predict?asset=btc&window=5m"
```

Current execution decisions and open positions:

```bash
curl "http://localhost:3300/v1/execution"
```

Recent paper trades:

```bash
curl "http://localhost:3300/v1/trades?limit=10"
```

Dashboard summary payload:

```bash
curl "http://localhost:3300/v1/dashboard/summary"
```

## HTTP API

### `GET /`

Returns the single-screen HTML dashboard.

- status: `200`
- response: `text/html`

### `GET /v1/healthz`

Returns runtime and ingestion health.

### `GET /v1/predict?asset={btc|eth|sol|xrp}&window={5m|15m}`

Returns the latest prediction for one market.

- status: `200`
- validation failure: `400`
- not found: `404`

Response is `PredictionResponse`.

### `GET /v1/predictions?asset={btc|eth|sol|xrp}&window={5m|15m}&limit=N`

Returns recent prediction history for one market.

- status: `200`
- validation failure: `400`

### `GET /v1/strategies`

Returns all strategies with rolling metrics and adaptive weights.

- status: `200`

### `GET /v1/markets`

Returns current market summaries for the eight supported markets.

- status: `200`

### `GET /v1/dashboard/summary`

Returns the aggregate payload used by the dashboard.

- status: `200`

Includes:

- health
- KPI strip data
- market summaries
- latest predictions
- strategy summaries
- execution decisions now
- open paper positions
- recent paper trades
- paper execution performance
- maker/taker usage stats

### `GET /v1/execution`

Returns the current paper execution state.

- status: `200`

Includes:

- `executionNow`
- `openPositions`
- `paperExecutionPerformance`

### `GET /v1/trades?limit=N`

Returns recent closed paper trades.

- status: `200`
- validation failure: `400`

### Error shape

Validation and not-found responses use:

```json
{
  "code": "invalid_request",
  "message": "Human-readable explanation"
}
```

## Public API

### `ServiceRuntime`

Public runtime entrypoint.

#### `createDefault()`

Creates the fully wired service runtime with snapshot ingestion, prediction engine, paper execution overlay, dashboard summary service, and HTTP server.

Returns:

- `ServiceRuntime`

#### `buildServer()`

Builds the Node `ServerType` without binding a port.

Returns:

- `ServerType`

#### `startServer()`

Starts snapshot ingestion and binds the HTTP server on `config.DEFAULT_PORT`.

Returns:

- `ServerType`

#### `ingestSnapshot()`

Injects a flat snapshot into the runtime for deterministic tests or local simulation.

Returns:

- `void`

#### `stop()`

Stops the HTTP server and disconnects the underlying snapshot service.

Returns:

- `Promise<void>`

### `HealthPayload`

Public type used by `GET /v1/healthz`.

### `DashboardSummaryPayload`

Public type used by `GET /v1/dashboard/summary`.

Contains the top-level dashboard sections including:

- market state
- predictions
- strategy ranking
- execution decisions
- open positions
- recent trades
- paper execution performance

### `MarketSummary`

Public type used by `GET /v1/markets`.

Represents one `(asset, window)` market with:

- live token prices and midpoints
- trigger proximity to `0.5`
- cooldown state
- quality diagnostics

### `PredictionResponse`

Public type used by `GET /v1/predict` and `GET /v1/predictions`.

Includes:

- direction
- confidence
- trigger origin
- resolution status
- full strategy breakdown

### `StrategySummary`

Public type used by `GET /v1/strategies`.

Includes:

- adaptive weight
- hit rate
- calibration
- streak
- recent participation

### `ExecutionDecision`

Public type describing whether a paper entry is currently allowed for a market.

Includes:

- buy side (`up` or `down`)
- entry reference near `0.5`
- TP and SL prices
- chosen `maker` or `taker` style
- urgency score
- maker fill probability
- gate failures when blocked

### `MarketExecutionSummary`

Public type for one market’s execution state.

Includes:

- current `ExecutionDecision`
- current `OpenPositionSummary` if a position is open

### `OpenPositionSummary`

Public type for simulated live positions.

Includes:

- side held
- lifecycle status
- entry fill
- live token price
- unrealized token-price PnL
- TP / SL
- time remaining until forced flatten

### `PaperPosition`

Public type representing the full internal paper position lifecycle.

Includes:

- entry and exit style
- posted and filled prices
- TP / SL
- flatten deadline
- realized PnL
- maker attempts
- taker fallback flag

### `PaperTrade`

Public type representing a closed paper trade.

Includes:

- market and side
- maker/taker on entry and exit
- exit reason
- hold time
- realized PnL

### `PortfolioExecutionSummary`

Public type summarizing the rolling paper execution overlay.

Includes:

- open position count
- executable entry count
- cumulative net PnL
- average net PnL per trade
- max drawdown
- maker fill rate
- forced flatten rate
- maker/taker usage ratios
- trade count

## Dashboard

The dashboard is served directly from `GET /` and polls `/v1/dashboard/summary`.

Main sections:

- top execution KPI strip
- market state table
- latest predictions
- current execution decisions
- strategy ranking
- open positions
- recent trades
- health and maker/taker usage

Every operational label shown in the dashboard includes a hover hint.

## Configuration

Configuration lives in [`src/config.ts`](/Users/jc/Documents/GitHub/polymarket-crypto-prediction/src/config.ts).

- `RESPONSE_CONTENT_TYPE`: JSON content type used for REST responses.
- `DEFAULT_PORT`: local port used by `startServer()`.
- `SERVICE_NAME`: service name shown in health and dashboard payloads.
- `SNAPSHOT_INTERVAL_MS`: snapshot interval passed to `SnapshotService`.
- `CROSS_THRESHOLD`: tolerance around `0.5` for trigger detection.
- `MARKET_COOLDOWN_MS`: minimum time between raw predictions for the same market.
- `PREDICTION_HORIZON_MS`: delay before prediction resolution.
- `SHORT_HISTORY_SECONDS`: short rolling horizon for recent feature context.
- `LONG_HISTORY_SECONDS`: long rolling horizon for market memory.
- `MAX_PREDICTION_HISTORY_PER_MARKET`: max stored prediction history per market.
- `MAX_PREDICTION_QUERY_LIMIT`: max `limit` accepted on history endpoints.
- `TOKEN_MAX_AGE_MS`: freshness cutoff for market token events.
- `SPOT_MAX_AGE_MS`: freshness cutoff for spot venue events.
- `CHAINLINK_MAX_AGE_MS`: freshness cutoff for Chainlink values.
- `ENSEMBLE_MEDIUM_CONFIDENCE_THRESHOLD`: confidence threshold for escalating beyond low-cost strategies.
- `ENSEMBLE_HIGH_CONFIDENCE_THRESHOLD`: high-confidence reference threshold for ensemble interpretation.
- `ENSEMBLE_SCORE_ESCALATION_THRESHOLD`: absolute weighted-score threshold for ambiguity escalation.
- `STRATEGY_ROLLING_WINDOW_SECONDS`: rolling time window in seconds used to score each strategy from recent outcomes only.
- `DASHBOARD_POLL_INTERVAL_MS`: dashboard polling interval.
- `MARKET_SCORE_WINDOW_SECONDS`: rolling time window in seconds used to score each market from recent paper trades.
- `MIN_MARKET_TRADES_FOR_SCORING`: minimum recent trade count before a market score is considered actionable.
- `MIN_MARKET_SCORE_FOR_ENTRY`: minimum market score required before new entries are allowed in that market.
- `MIN_MARKET_PREDICTIONS_BEFORE_ENTRY`: minimum prediction count required before a market leaves warm-up and paper trading is allowed.
- `ENTRY_TARGET_PRICE`: preferred entry anchor for the paper execution overlay.
- `ENTRY_BAND_HALF_WIDTH`: allowed deviation around `ENTRY_TARGET_PRICE`.
- `MIN_ORDER_USD`: minimum notional per paper trade so entries respect Polymarket sizing rules.
- `MIN_ORDER_SHARES`: minimum share count per paper trade so entries respect Polymarket sizing rules.
- `TAKE_PROFIT_DELTA`: token-price distance from entry to TP.
- `STOP_LOSS_DELTA`: token-price distance from entry to SL.
- `MIN_ENTRY_CONFIDENCE`: minimum ensemble confidence required for a paper entry.
- `MIN_MARKET_QUALITY_FOR_ENTRY`: minimum market-quality score required for a paper entry.
- `MIN_SPREAD_FOR_MAKER`: minimum spread where maker posting is preferred.
- `MAX_SPREAD_FOR_ENTRY`: maximum spread tolerated for a new paper entry.
- `MAKER_ENTRY_TIMEOUT_MS`: max time a maker entry may wait before fallback/cancel.
- `MAKER_EXIT_TIMEOUT_MS`: max time a maker exit may wait before taker fallback.
- `MIN_DEPTH_FOR_MAKER`: minimum top-of-book depth required to prefer maker.
- `MAKER_DRIFT_LIMIT`: maximum tolerated drift before maker becomes unattractive.
- `TAKER_URGENCY_THRESHOLD`: urgency threshold where taker execution becomes preferred.
- `LOW_DEPTH_SLIPPAGE_PROXY`: extra proxy slippage used in thin books.
- `MAX_OPEN_POSITIONS_GLOBAL`: portfolio-wide cap for simultaneous open paper positions.

## Scripts

- `npm run start`: start the service with `tsx`
- `npm run build`: compile the package to `dist/`
- `npm run standards:check`: contract verification
- `npm run lint`: Biome checks
- `npm run format:check`: formatter verification
- `npm run typecheck`: TypeScript verification
- `npm run test`: Node test suite
- `npm run check`: full blocking validation pipeline

## Structure

- `src/app/`: runtime composition
- `src/market/`: market normalization and rolling state
- `src/strategy/`: strategy execution and weighting
- `src/prediction/`: prediction lifecycle and history
- `src/execution/`: maker/taker policy and paper execution overlay
- `src/dashboard/`: dashboard summary and HTML view
- `src/http/`: Hono transport layer
- `test/`: deterministic runtime tests

## Compatibility

- Node.js `20+`
- ESM consumers
- strict TypeScript projects

## Troubleshooting

### No execution decisions are tradable

Check:

- `MIN_MARKET_PREDICTIONS_BEFORE_ENTRY`
- `MIN_ENTRY_CONFIDENCE`
- `MIN_MARKET_QUALITY_FOR_ENTRY`
- `ENTRY_BAND_HALF_WIDTH`
- `MAX_SPREAD_FOR_ENTRY`

### Positions never close

Check whether TP/SL levels are reachable under your chosen deltas and whether maker exits have enough time to complete:

- `TAKE_PROFIT_DELTA`
- `STOP_LOSS_DELTA`
- maker exit timeout values

### Maker usage is too high or too low

Review:

- `MIN_SPREAD_FOR_MAKER`
- `MIN_DEPTH_FOR_MAKER`
- `MAKER_DRIFT_LIMIT`
- `TAKER_URGENCY_THRESHOLD`
- maker timeout values

### `npm run check` fails

Run the stages separately:

```bash
npm run standards:check
npm run lint
npm run format:check
npm run typecheck
npm run test
```

## AI Workflow

- Read `AGENTS.md`, `ai/contract.json`, and the active adapter before editing code.
- Keep managed files under `ai/`, `prompts/`, and `skills/` read-only during feature work.
- Update tests, docs, public exports, and HTTP notes in the same change whenever behavior changes.
- Finish with `npm run check`.
