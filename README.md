# @sha3/polymarket-crypto-prediction

Real-time Node.js service for monitoring Polymarket crypto Up/Down markets, generating event-driven 30-second predictions around the `0.5` zone, adapting strategy weights online, and exposing both a compact dashboard and REST API from a single Hono process.

## TL;DR

```bash
npm install
npm run check
npm run start
```

Open:

- `http://localhost:3000/` for the dashboard
- `http://localhost:3000/v1/healthz` for service health

## Why

Use this package when you want one process that:

- subscribes to one live `SnapshotService` stream from `@sha3/polymarket-snapshot`
- watches BTC, ETH, SOL, and XRP on `5m` and `15m` markets
- triggers predictions only when token pricing reaches or crosses the `0.5` area
- evaluates every prediction automatically after 30 seconds
- tracks rolling strategy quality and adjusts ensemble weights in memory
- exposes a dense operator dashboard without a separate frontend build

## Main Capabilities

- Event-driven trigger engine with per-market cooldowns.
- Rolling in-memory market history and strategy performance windows.
- Twenty ensemble strategies with per-strategy attribution on every prediction.
- REST endpoints for current prediction state, market summaries, strategy rankings, and dashboard summary data.
- Single-screen HTML dashboard served directly by Hono with polling-based live refresh.

## Installation

```bash
npm install
```

## Setup

Create a `.env` file only if you need to override defaults:

```bash
PORT=3000
SNAPSHOT_INTERVAL_MS=500
CROSS_THRESHOLD=0.02
MARKET_COOLDOWN_MS=5000
PREDICTION_HORIZON_MS=30000
```

## Running Locally

```bash
npm run start
```

The default runtime serves the dashboard and API on `http://localhost:3000`.

## Usage

### Start the default runtime

```ts
import { ServiceRuntime } from "@sha3/polymarket-crypto-prediction";

const serviceRuntime = ServiceRuntime.createDefault();
serviceRuntime.startServer();
```

### Build the server without binding

```ts
import { ServiceRuntime } from "@sha3/polymarket-crypto-prediction";

const serviceRuntime = ServiceRuntime.createDefault();
const server = serviceRuntime.buildServer();
```

### Feed deterministic snapshots during tests or local simulation

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

### Stop the runtime cleanly

```ts
await serviceRuntime.stop();
```

## Examples

Fetch the latest BTC 5m prediction:

```bash
curl "http://localhost:3000/v1/predict?asset=btc&window=5m"
```

Fetch recent ETH 15m predictions:

```bash
curl "http://localhost:3000/v1/predictions?asset=eth&window=15m&limit=5"
```

Fetch strategy ranking data for the dashboard:

```bash
curl "http://localhost:3000/v1/strategies"
```

## HTTP API

### `GET /`

Serves the single-screen HTML dashboard.

- status: `200`
- response: `text/html`

### `GET /v1/healthz`

Returns runtime and ingestion health.

Response shape:

```json
{
  "ok": true,
  "serviceName": "@sha3/polymarket-crypto-prediction",
  "snapshotAgeMs": 120,
  "isSnapshotHealthy": true,
  "pendingEvaluationCount": 2,
  "monitoredMarketCount": 8,
  "startedAt": 1735689600000
}
```

### `GET /v1/predict?asset={btc|eth|sol|xrp}&window={5m|15m}`

Returns the latest prediction for one market.

- success status: `200`
- not found: `404`
- validation failure: `400`

Response shape:

```json
{
  "asset": "btc",
  "window": "5m",
  "marketKey": "btc:5m",
  "direction": "UP",
  "confidence": 0.71,
  "weightedScore": 0.21,
  "timestamp": 1735689600000,
  "trigger": {
    "marketKey": "btc:5m",
    "asset": "btc",
    "window": "5m",
    "triggeredToken": "up",
    "triggerType": "crossed_half",
    "previousPrice": 0.49,
    "currentPrice": 0.51,
    "distanceToHalf": 0.01,
    "triggeredAt": 1735689600000
  },
  "evaluationDueAt": 1735689630000,
  "isResolved": false,
  "result": {
    "status": "pending",
    "resolvedAt": null,
    "resolvedDirection": null,
    "evaluationPrice": null,
    "baselinePrice": 0.51,
    "isFallbackPriceUsed": false,
    "reason": null
  },
  "strategyBreakdown": []
}
```

### `GET /v1/predictions?asset={btc|eth|sol|xrp}&window={5m|15m}&limit=N`

Returns recent prediction history for one market, newest first.

- success status: `200`
- validation failure: `400`
- `limit` must be an integer between `1` and `MAX_PREDICTION_QUERY_LIMIT`

Each entry is a full `PredictionResponse`, including whether the result is `pending`, `correct`, `incorrect`, or `void`.

### `GET /v1/strategies`

Returns the current strategy ranking and rolling metrics.

- success status: `200`

Each item includes:

- `strategyId`
- `name`
- `tier`
- `weight`
- `isEnabled`
- `totalResolved`
- `wins`
- `losses`
- `voids`
- `hitRate`
- `averageSignedEdge`
- `averageCalibrationError`
- `recentStreak`
- `lastResolvedAt`
- `lastParticipatedAt`

### `GET /v1/markets`

Returns the current status for all eight monitored markets.

- success status: `200`

Each item includes:

- `asset`
- `window`
- `marketKey`
- `isLive`
- `latestUpPrice`
- `latestDownPrice`
- `latestUpMidpoint`
- `latestDownMidpoint`
- `upDistanceToHalf`
- `downDistanceToHalf`
- `lastTrigger`
- `lastPredictionTimestamp`
- `cooldownRemainingMs`
- `snapshotAgeMs`
- `quality`

### `GET /v1/dashboard/summary`

Returns the aggregate payload used by the dashboard.

- success status: `200`

Includes:

- `generatedAt`
- `pollIntervalMs`
- `health`
- `kpis`
- `markets`
- `latestPredictions`
- `strategies`

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

The public runtime entrypoint for composing, booting, feeding, and stopping the service.

#### `createDefault()`

Creates a fully wired runtime with:

- one `SnapshotService`
- one in-memory market state service
- one strategy metrics service
- one strategy engine service
- one prediction store
- one prediction engine
- one dashboard summary service
- one Hono HTTP server service

Returns:

- a ready-to-use `ServiceRuntime`

#### `buildServer()`

Builds the Hono-backed `ServerType` without binding to a port.

Returns:

- a Node `ServerType`

Behavior notes:

- useful for tests or external process orchestration
- does not attach a listening socket

#### `startServer()`

Attaches the live snapshot listener and starts listening on `config.DEFAULT_PORT`.

Returns:

- the listening Node `ServerType`

Behavior notes:

- starts real-time ingestion before binding the HTTP server
- logs the listening address through the package logger

#### `ingestSnapshot()`

Injects one snapshot object into the runtime.

Parameters:

- one flat snapshot object with `generated_at` and the market columns you want to simulate

Returns:

- `void`

Behavior notes:

- intended for tests, deterministic simulations, and local dry runs
- runs market updates, trigger detection, prediction creation, and pending-evaluation resolution

#### `stop()`

Stops the HTTP server if it was started and disconnects the live `SnapshotService`.

Returns:

- `Promise<void>`

Behavior notes:

- safe to call during shutdown hooks or tests
- resets the internal snapshot listener state

### `HealthPayload`

Public type for `GET /v1/healthz`.

```ts
type HealthPayload = {
  ok: true;
  serviceName: string;
  snapshotAgeMs: number | null;
  isSnapshotHealthy: boolean;
  pendingEvaluationCount: number;
  monitoredMarketCount: number;
  startedAt: number;
};
```

### `DashboardSummaryPayload`

Public type for `GET /v1/dashboard/summary`.

```ts
type DashboardSummaryPayload = {
  generatedAt: number;
  pollIntervalMs: number;
  health: HealthPayload;
  kpis: {
    liveMarkets: number;
    pendingEvaluations: number;
    totalPredictions: number;
    resolvedAccuracy: number;
    averageConfidence: number;
  };
  markets: MarketSummary[];
  latestPredictions: PredictionResponse[];
  strategies: StrategySummary[];
};
```

### `MarketSummary`

Public type for entries returned by `GET /v1/markets`.

Behavior notes:

- represents one of the eight monitored `(asset, window)` markets
- includes live token prices, proximity to `0.5`, cooldown, and quality diagnostics

### `PredictionResponse`

Public type for `GET /v1/predict` and `GET /v1/predictions`.

Behavior notes:

- includes final ensemble direction and confidence
- includes the exact trigger that created the prediction
- includes resolution status and full per-strategy breakdown

### `StrategySummary`

Public type for `GET /v1/strategies`.

Behavior notes:

- exposes rolling online performance and adaptive weight state for each strategy
- intended for dashboards, debugging, and strategy ranking views

## Dashboard

The dashboard is served directly from `GET /` and uses polling against `/v1/dashboard/summary`.

It is designed to keep the main operating picture on one screen:

- KPI strip for live markets, pending evaluations, prediction count, accuracy, and mean confidence
- market table for current UP/DOWN midpoint state and cooldowns
- recent predictions table
- strategy ranking table
- health panel

No WebSocket or SSE transport is required in this version.

## Configuration

Configuration lives in [`src/config.ts`](./src/config.ts).

- `RESPONSE_CONTENT_TYPE`: JSON response content-type used for REST endpoints.
- `DEFAULT_PORT`: port used by `startServer()`.
- `SERVICE_NAME`: service label exposed in health payloads and dashboard chrome.
- `SNAPSHOT_INTERVAL_MS`: polling interval passed to `SnapshotService`.
- `CROSS_THRESHOLD`: tolerance band around `0.5` for trigger detection.
- `MARKET_COOLDOWN_MS`: minimum time between predictions for the same market.
- `PREDICTION_HORIZON_MS`: delay between prediction creation and automatic evaluation.
- `SHORT_HISTORY_SECONDS`: short rolling horizon for recent features and diagnostics.
- `LONG_HISTORY_SECONDS`: long rolling horizon retained in market memory.
- `MAX_PREDICTION_HISTORY_PER_MARKET`: maximum in-memory history length per market.
- `MAX_PREDICTION_QUERY_LIMIT`: hard cap for the `limit` query parameter on history endpoints.
- `TOKEN_MAX_AGE_MS`: freshness cutoff for UP/DOWN token events.
- `SPOT_MAX_AGE_MS`: freshness cutoff for spot venue updates.
- `CHAINLINK_MAX_AGE_MS`: freshness cutoff for Chainlink values.
- `ENSEMBLE_MEDIUM_CONFIDENCE_THRESHOLD`: confidence threshold below which the engine escalates beyond low-cost strategies.
- `ENSEMBLE_HIGH_CONFIDENCE_THRESHOLD`: reserved high-confidence threshold for ensemble interpretation and docs alignment.
- `ENSEMBLE_SCORE_ESCALATION_THRESHOLD`: absolute weighted-score threshold for ambiguity escalation.
- `STRATEGY_ROLLING_WINDOW_SIZE`: number of resolved outcomes retained per strategy.
- `DASHBOARD_POLL_INTERVAL_MS`: browser polling interval for `/v1/dashboard/summary`.

## Scripts

- `npm run start`: start the live service with `tsx`
- `npm run build`: compile TypeScript to `dist/`
- `npm run standards:check`: run project contract verification
- `npm run lint`: run Biome checks
- `npm run format:check`: verify formatter output
- `npm run typecheck`: run TypeScript without emit
- `npm run test`: run the Node test suite
- `npm run check`: run the full blocking validation pipeline

## Structure

- `src/app/`: runtime composition
- `src/market/`: snapshot normalization, rolling market state, and trigger detection inputs
- `src/strategy/`: strategy execution and adaptive weighting
- `src/prediction/`: prediction history, cooldowns, and automatic evaluation
- `src/dashboard/`: dashboard summary shaping and HTML view
- `src/http/`: Hono transport and route validation
- `test/`: deterministic runtime and API tests

## Compatibility

- Node.js `20+`
- ESM package consumers
- Strict TypeScript projects

## Troubleshooting

### `GET /v1/predict` returns `404`

No prediction has been generated yet for that market. Wait for a real trigger around the `0.5` band or inject a deterministic snapshot in tests.

### Dashboard looks stale

Check `GET /v1/healthz`. A large `snapshotAgeMs` or `isSnapshotHealthy: false` means the live snapshot stream is not updating within freshness thresholds.

### Predictions are not being generated often enough

Review:

- `CROSS_THRESHOLD`
- `MARKET_COOLDOWN_MS`
- current market quality in `/v1/markets`

### `npm run check` fails

Run the individual steps to isolate the failure:

```bash
npm run standards:check
npm run lint
npm run format:check
npm run typecheck
npm run test
```

## AI Workflow

- Read `AGENTS.md`, `ai/contract.json`, and the active adapter before modifying source.
- Keep managed files under `ai/`, `prompts/`, and `skills/` read-only during normal feature work.
- Update tests, README, public exports, and HTTP documentation in the same change whenever behavior changes.
- Finish with `npm run check`.
