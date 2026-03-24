# @sha3/polymarket-crypto-prediction

Real-time Node.js service for Polymarket crypto Up/Down markets. It ingests market snapshots, runs a twenty-two-strategy ensemble, discovers dynamic pairs and trios, separates `research` from `execution`, and simulates a conservative paper-trading layer with TP/SL exits.

## TL;DR

```bash
npm install
npm run check
npm run start
```

Open:

- `http://localhost:3300/` dashboard
- `http://localhost:3300/v1/healthz` health
- `http://localhost:3300/v1/execution` execution gate state
- `http://localhost:3300/v1/dashboard/summary` full dashboard payload

## Why This Exists

This service answers two different questions and keeps them separated:

- `research`: what does the ensemble believe about a Polymarket market right now?
- `execution`: which of those signals are good enough to deserve capital, given recent trade quality, combo quality, market quality, and execution constraints?

That split is the core design choice of the project:

- all resolved predictions can improve `research`
- only execution-approved trades affect paper PnL
- combos and trios are not cosmetic boosts anymore; they are part of the execution gate

## Main Capabilities

- Watches BTC, ETH, SOL, and XRP on `5m` and `15m` Polymarket markets.
- Generates event-driven predictions around the `0.5` zone instead of continuously spamming every tick.
- Adapts twenty-two strategy weights online from rolling research outcomes.
- Builds dynamic strategy pairs and trios per market.
- Requires a combo or trio gate before execution is allowed.
- Separates research quality from execution quality through distinct market scores.
- Simulates conservative paper trading with TP/SL, maker/taker choice, and position caps.
- Exposes REST endpoints plus a single-screen operator dashboard.

## System Overview

The runtime has four layers:

1. `Market ingestion`
   Reads Polymarket token state plus spot and Chainlink context from `@sha3/polymarket-snapshot`.

2. `Research prediction engine`
   Generates predictions on trigger events around `0.5`, scores strategies, and tracks rolling prediction quality.

3. `Combo intelligence`
   Builds dynamic pairs and trios from currently participating strategies, scores them, and decides whether any combo is good enough to unlock execution.

4. `Execution overlay`
   Applies a stricter gate based on:
   - market quality
   - prediction confidence
   - combo gate
   - `research score`
   - `execution score`
   - discounted bootstrap logic when there is not enough real trade history yet

## Core Concepts

### Research vs Execution

`Research` is the broad learning layer. A prediction can be generated and later resolved even if it never became a trade.

`Execution` is the capital-allocation layer. A prediction only becomes executable when all hard gates pass, especially:

- market quality
- price proximity to the preferred entry anchor
- spread and depth constraints
- minimum effective execution score
- combo or trio gate approval

Only executed trades affect paper PnL. This keeps the model from confusing “interesting signal” with “tradable signal.”

### Scores

The service tracks three market-level notions of score:

- `researchScore`
  Derived from resolved predictions. It measures signal quality, signed edge, calibration, and sample size.

- `executionScore`
  Derived only from closed paper trades. It measures actual realized trade quality after costs and drawdown.

- `effectiveExecutionScore`
  The score used by the execution gate.
  - if there are not enough trades yet, it uses discounted `researchScore`
  - once trade history exists, it uses the more conservative of:
    - the real `executionScore`
    - the discounted `researchScore`

This design avoids cold-start paralysis without letting early optimistic research metrics immediately become full execution trust.

### Cross-Asset Regime

The engine also measures whether the whole crypto complex is moving together inside the same window.

For each `5m` or `15m` slice it computes:

- directional breadth across BTC, ETH, SOL, and XRP
- breadth strength from participation plus move magnitude
- whether the current market is lagging a broader impulse led by peers

This information is used in two places:

- `research`
  Through dedicated strategies that reward broad synchronous moves and leader-laggard catch-up setups.

- `execution`
  Through a hard block when a local signal fights a strong market-wide breadth regime.

### Combos and Trios

Combos are dynamic pairs or trios of strategies built from the highest-weight participating strategies on the current market.

For every active pair or trio, the engine tracks:

- sample count
- agreement purity
- hit rate
- PnL proxy
- lift versus the best member
- drawdown proxy
- recent streak
- calibration error

Combos serve two roles:

- `research role`
  Agreement combos can still boost score and disagreement combos can still reduce confidence.

- `execution role`
  A combo or trio must be historically strong enough to pass the combo gate, or the prediction is not tradable.

The execution gate prefers the best eligible combo by:

- effective combo score
- sample size
- lower drawdown
- lift over the best member

If no combo or trio is good enough, the prediction may still exist in research, but execution is blocked.

## Strategy Model

The ensemble contains twenty-two strategies arranged in three escalation tiers:

- `low`
  Cheap, fast features that always run first.

- `medium`
  Activated when the low-tier aggregate is not confident enough.

- `high`
  Activated when the low+medium aggregate is still ambiguous.

Each strategy emits:

- direction
- score
- confidence
- current market-local adaptive weight
- debug context

The final ensemble decision is a weighted aggregate of participating strategies. Strategy weights adapt online from rolling research outcomes, not from raw static constants.

## Strategy Reference

### Low Tier

#### `s01` Momentum EWMA

Looks at recent `up` midpoint drift over the last few slices and measures short continuation pressure.

Use it for:

- local short-term trend continuation
- confirming whether a move around `0.5` has momentum behind it

#### `s02` Token Microprice

Uses token imbalance and distance-to-half to approximate top-of-book pressure.

Use it for:

- immediate book-pressure reads
- deciding whether local order-book shape favors `UP` or `DOWN`

#### `s06` No-Arb Consistency

Checks whether `UP` and `DOWN` probabilities make sense together.

Use it for:

- identifying inconsistent token pricing
- catching imbalance created by token-side mispricing rather than directional conviction

#### `s07` Spread Compression

Combines relative token spread pressure with spot momentum.

Use it for:

- situations where improved liquidity is aligning with directional spot flow

#### `s08` Barrier Timing

Compares Chainlink price with the market’s `priceToBeat`.

Use it for:

- “who is on the correct side of the barrier” logic
- detecting when the barrier itself is misread by token pricing

#### `s09` Spot Consensus Momentum

Direct spot-consensus drift signal.

Use it for:

- fast cross-venue directional confirmation

#### `s14` Chainlink Basis

Measures the gap between spot consensus and Chainlink.

Use it for:

- oracle catch-up and basis normalization effects

#### `s16` Freshness Gap

Compares token staleness with the freshest spot venues and projects spot momentum into stale-token situations.

Use it for:

- lead-lag opportunities caused by slower token updates

### Medium Tier

#### `s03` Token Imbalance Band

Uses relative depth between `UP` and `DOWN`.

Use it for:

- multi-level token book skew
- asymmetric local liquidity

#### `s04` Wall Proximity

Looks at relative spreads and depth to infer liquidity barriers.

Use it for:

- wall-based directional bias
- barrier pressure near relevant token levels

#### `s05` Order Book Churn

Measures recent change in `UP` vs `DOWN` midpoint dynamics.

Use it for:

- microstructure rotation
- unstable local directional handoff

#### `s10` Spot Micropressure

Averages order-book imbalance across spot venues.

Use it for:

- cross-venue microstructure confirmation

#### `s11` Spot Dispersion

Penalizes noisy multi-venue moves, especially when spot momentum and venue dispersion disagree.

Use it for:

- avoiding weak consensus moves
- preferring coordinated spot action

#### `s12` Volatility Breakout

Normalizes recent momentum by recent average absolute movement.

Use it for:

- regime transitions
- detecting when a move is large relative to recent volatility

#### `s13` Spot Slippage Skew

Uses spread conditions across spot venues as a slope and friction proxy.

Use it for:

- rough directional pressure from venue execution friction

#### `s15` Theoretical Probability Gap

Compares a simple theoretical barrier probability with observed token probability.

Use it for:

- token-versus-barrier dislocations

#### `s17` Regime Switch

Switches between continuation and fade logic depending on available liquidity.

Use it for:

- adapting behavior to deep versus thin books

#### `s18` Liquidity Shock Fade

Mean-reversion signal based on distance-to-half asymmetry.

Use it for:

- short shock-fade behavior
- snapping back after abrupt local dislocations

#### `s21` Cross-Asset Breadth Impulse

Measures whether the whole monitored crypto set is moving together in the same direction on the same window.

Use it for:

- confirming local signals with market-wide synchronous flow
- penalizing isolated calls that fight a strong cross-asset move

### High Tier

#### `s19` Recent Performance Hedge

Reads bias from prior signals already emitted in the current evaluation path.

Use it for:

- meta-layer correction
- damping overconfident one-sided internal consensus

#### `s20` Online Logistic Blend

Weighted blend of several core features plus prior-signal bias.

Uses:

- momentum
- spot consensus momentum
- token microprice
- barrier timing
- prior-signal bias

Use it for:

- final blended decision when the cheaper tiers still disagree or remain weak

#### `s22` Leader-Laggard Catch-Up

Looks for markets that are moving in the same direction as the broader regime but have not yet caught up to the leaders.

Use it for:

- follow-through entries in lagging assets after BTC, ETH, or another peer already accelerated
- exploiting delayed propagation across correlated crypto assets

## Prediction Lifecycle

1. A market event triggers near `0.5` or across `0.5`.
2. The strategy engine evaluates low-tier strategies first.
3. If confidence is weak, medium tier is added.
4. If still ambiguous, high tier is added.
5. The ensemble aggregates a base direction and confidence.
6. Active combos and trios are built from the currently participating strategies.
7. The cross-asset regime is measured for breadth and leader-laggard context.
8. Combo research effects may still boost score or penalize confidence.
9. The best eligible combo gate candidate is selected.
10. A prediction is stored as a research prediction.
11. Execution decides whether that prediction is tradable.
12. If a trade is opened, TP/SL and maker-vs-taker logic manage the position.
13. Research metrics update from resolved predictions.
14. Execution metrics update only from closed trades.

## Execution Gate

A prediction is blocked from trading when any of these classes of checks fail:

- no prediction context
- position already open
- invalid direction
- no reference price
- combo gate failed
- market not live
- quality too low
- confidence too low
- price too far from `0.5`
- spread too wide
- market still warming up
- insufficient execution history
- bootstrap discount too low
- execution score too low
- order below minimum notional or share count

This is intentionally conservative. Research may say “interesting”; execution still says “not yet.”

## Dashboard Semantics

The dashboard is designed for operator review, not just pretty metrics.

Key panels:

- `Markets`
  Live token state, quality, cooldown, and market-level effective score context.

- `Execution Now`
  The current go/no-go decision for each market, including:
  - research score
  - execution score
  - effective execution score
  - selected combo
  - combo gate state
  - exact reason codes when blocked

- `Resolved Predictions`
  Predictions that have completed through TP/SL-style resolution.

- `Strategies`
  Market-local research weights plus research and execution proxy behavior.

- `Top Combos`
  Best dynamic pairs and trios, including research score and effective execution score.

- `Market PnL`
  Closed-trade execution performance per market.

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
ENTRY_BAND_HALF_WIDTH=0.01
MIN_ENTRY_CONFIDENCE=0.72
MIN_EXECUTION_SCORE_FOR_ENTRY=0.68
MIN_COMBO_EXECUTION_SCORE=0.68
MAX_OPEN_POSITIONS_GLOBAL=3
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

Latest prediction for one market:

```bash
curl "http://localhost:3300/v1/predict?asset=btc&window=5m"
```

Execution gate state:

```bash
curl "http://localhost:3300/v1/execution"
```

Recent trades:

```bash
curl "http://localhost:3300/v1/trades?limit=10"
```

Dashboard payload:

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

Returns rolling strategy summaries with market-local adaptive weights.

- status: `200`

If `asset` and `window` are provided together, the endpoint returns the local market board for that market instead of the global aggregate.

### `GET /v1/combos?asset={btc|eth|sol|xrp}&window={5m|15m}&limit=N`

Returns pair and trio combo summaries.

- status: `200`
- validation failure: `400`

Without `asset` and `window`, the endpoint returns the recent global combo leaderboard across markets.

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
- resolved predictions
- global strategy summaries
- per-market strategy boards
- market PnL table
- combo boards
- combo leaders
- recent combo influence
- execution decisions now
- execution mode
- active account summary
- open positions for the active backend
- recent trades for the active backend
- execution performance
- legacy `paperExecutionPerformance` compatibility field
- maker/taker usage stats

### `GET /v1/execution`

Returns the current execution gate plus open positions.

- status: `200`

Includes:

- `executionMode`
- `account`
- `executionNow`
- `openPositions`
- `executionPerformance`
- `paperExecutionPerformance`

### `GET /v1/trades?limit=N`

Returns recent closed trades from the active execution backend.

- status: `200`
- validation failure: `400`

### Error Shape

Validation and not-found responses use:

```json
{
  "code": "invalid_request",
  "message": "Human-readable explanation"
}
```

## Public API

### `ServiceRuntime`

Main runtime entrypoint.

#### `createDefault(): ServiceRuntime`

Creates the fully wired service runtime with:

- snapshot ingestion
- market state
- strategy engine
- combo engine
- prediction engine
- execution backend selected by `EXECUTION_MODE`
- dashboard summary service
- HTTP server

#### `buildServer(): ServerType`

Builds the Hono-backed HTTP server without binding a port.

Behavior notes:

- does not start listening
- useful for tests or custom orchestration

#### `startServer(): ServerType`

Attaches snapshot ingestion and starts the HTTP server on `DEFAULT_PORT`.

Behavior notes:

- binds the port immediately
- logs the listening address

#### `stop(): Promise<void>`

Stops the HTTP server and disconnects snapshot ingestion.

Behavior notes:

- safe for controlled shutdown in tests and local runs

#### `ingestSnapshot(snapshot: InputSnapshot): void`

Injects one snapshot directly into the runtime.

Behavior notes:

- useful for deterministic tests
- triggers market update, prediction generation, and execution handling

### `ComboBreakdown`

Describes the combo activity attached to one prediction.

Includes:

- `activeCombos`
- `appliedBoostCombos`
- `appliedDisagreementCombos`
- `totalBoostApplied`
- `totalConfidencePenaltyApplied`

Use it when you need to explain how combos changed an ensemble decision.

### `ComboSummary`

Rolling summary for one strategy pair or trio on one market.

Includes:

- sample count
- agreement purity
- hit rate
- cumulative and average PnL proxy
- combo score
- effective combo score
- source of score trust
- execution eligibility

Use it when ranking combos or debugging why a combo gate passed or failed.

### `ComboUsage`

Per-prediction record of one combo that was active during evaluation.

Includes:

- combo key and members
- size
- direction
- whether members agreed
- score and confidence effects
- reason code

Use it when you want to inspect the exact combo footprint of a single prediction.

### `MarketComboBoard`

Market-level combo dashboard payload.

Includes:

- top pairs
- top trios
- active combos now
- last applied combos
- combo boost share
- combo confidence penalty share
- actionable-combo flag

Use it to render market-local combo boards or compare pair/trio strength by market.

### `DashboardSummaryPayload`

Top-level payload used by the HTML dashboard.

Includes:

- health
- KPIs
- execution mode
- account summary
- markets
- latest resolved predictions
- strategy boards
- execution decisions
- combo boards
- open positions
- recent trades
- portfolio stats

Use it when integrating an external UI that wants the same operator view as the built-in dashboard.

### `ExecutionMode`

Execution backend selector.

Allowed values:

- `paper`
- `real`

Use it to branch UI copy, safety controls, and operational expectations.

### `ExecutionAccountSummary`

Operational account summary for the active execution backend.

Includes:

- `mode`
- `balanceUsd`
- `lastBalanceRefreshAt`
- `isBalanceStale`
- `lastBalanceError`

In paper mode the balance fields remain empty. In real mode they expose the cached live collateral view.

### `HealthPayload`

Lightweight service health payload.

Includes:

- `ok`
- `serviceName`
- `snapshotAgeMs`
- `isSnapshotHealthy`
- `pendingEvaluationCount`
- `monitoredMarketCount`
- `startedAt`

Use it for probes, dashboards, and ingestion-lag alerts.

### `ExecutionDecision`

Decision object for one market at one moment.

Includes:

- tradability flag
- prediction direction
- reference entry
- TP and SL
- execution style
- research, execution, and effective execution scores
- combo gate decision
- reason codes when blocked

Use it when you need a machine-readable explanation of why a market is or is not tradable.

### `MarketExecutionSummary`

Execution summary for one market.

Includes:

- market identity
- `decision`
- optional `openPosition`

Use it for execution tables or market-by-market operator reviews.

### `OpenPositionSummary`

Current mark-to-market view of one open paper position.

Includes:

- side
- status
- entry fill
- live token price
- unrealized PnL
- TP and SL

Use it to render open exposure and exit risk.

### `PaperPosition`

Internal-style detail shape for an open or lifecycle-managed paper position.

Includes full entry, exit, maker/taker, and realized-PnL fields.

Use it if you need the detailed position state rather than the compressed summary view.

### `ExecutionTrade`

Closed trade record for the active execution backend.

Includes:

- entry and exit styles
- fill prices
- notional
- realized PnL
- hold time
- exit reason

Use it for trade logs, performance analysis, and PnL attribution.

### `PaperTrade`

Backward-compatible alias of `ExecutionTrade`.

Use it only for older callers that still depend on the legacy export name.

### `PortfolioExecutionSummary`

Portfolio-level paper execution metrics.

Includes:

- open position count
- executable entry count
- cumulative net PnL
- average net PnL per trade
- max drawdown
- maker/taker usage
- trade count

Use it for top-line execution monitoring.

### `MarketSummary`

Live market-state summary from the market-normalization layer.

Includes token prices, midpoint freshness, cooldown, and quality information for one monitored market.

Use it when building market dashboards or alerting on degraded market quality.

### `PredictionResponse`

Prediction payload returned by `/v1/predict` and prediction-history endpoints.

Includes:

- direction
- confidence
- base and adjusted score
- trigger information
- TP and SL context
- combo gate state
- execution eligibility
- execution gate failures
- final result when resolved

Use it when analyzing the lifecycle of one signal from research through execution eligibility.

### `StrategySummary`

Rolling summary for one strategy.

Includes:

- adaptive research weight
- total resolved research signals
- execution resolved count
- hit rates
- PnL proxies
- calibration
- recent streak
- combo marker

Use it when ranking strategies or auditing which strategies are driving a market.

## Configuration

Configuration lives in [src/config.ts](/Users/jc/Documents/GitHub/polymarket-crypto-prediction/src/config.ts).

- `RESPONSE_CONTENT_TYPE`: content type used by JSON endpoints.
- `DEFAULT_PORT`: HTTP port used by `startServer()`.
- `SERVICE_NAME`: service identifier shown in health and dashboard payloads.
- `SNAPSHOT_INTERVAL_MS`: polling interval passed to `SnapshotService`.
- `CROSS_THRESHOLD`: legacy tolerance around `0.5`, retained for compatibility. Prediction creation now triggers only on real half-crosses.
- `MARKET_COOLDOWN_MS`: minimum time between raw predictions on the same market. Default is `30_000 ms`.
- `TRIGGER_CONFIRMATION_DELAY_MS`: minimum delay between the half-cross and prediction creation. The market must still look valid after this wait.
- `MIN_TRIGGER_DISTANCE_FROM_HALF`: minimum confirmed distance from `0.5` after the delay. This prevents firing on tiny post-cross noise.
- `MIN_TRIGGER_SPOT_MOMENTUM`: minimum signed token momentum required after the delay, aligned with the crossed side.
- `MIN_RESEARCH_MARKET_QUALITY`: minimum market-quality score required before a research prediction can be emitted.
- `MIN_WEAK_BREADTH_STRENGTH_FOR_PREDICTION`: minimum weak breadth strength accepted for non-neutral cross-asset confirmation during prediction creation.
- `PREDICTION_HORIZON_MS`: legacy prediction horizon field kept in the payload shape.
- `SHORT_HISTORY_SECONDS`: short rolling history used by feature extraction.
- `LONG_HISTORY_SECONDS`: long rolling history used by market memory.
- `MAX_PREDICTION_HISTORY_PER_MARKET`: maximum stored prediction history per market.
- `MAX_PREDICTION_QUERY_LIMIT`: maximum accepted `limit` for list endpoints.
- `TOKEN_MAX_AGE_MS`: freshness cutoff for Polymarket token events.
- `SPOT_MAX_AGE_MS`: freshness cutoff for spot venue events.
- `CHAINLINK_MAX_AGE_MS`: freshness cutoff for Chainlink values.
- `ENSEMBLE_MEDIUM_CONFIDENCE_THRESHOLD`: confidence threshold that triggers escalation into medium-tier strategies.
- `ENSEMBLE_HIGH_CONFIDENCE_THRESHOLD`: high-confidence reference level used by the ensemble.
- `ENSEMBLE_SCORE_ESCALATION_THRESHOLD`: absolute weighted-score threshold used to decide whether the current tier is still too ambiguous.
- `STRATEGY_ROLLING_WINDOW_SECONDS`: rolling research window used for strategy metrics and adaptive weights.
- `COMBO_ROLLING_WINDOW_SECONDS`: rolling window used for pair/trio combo metrics.
- `COMBO_TOP_STRATEGIES_FOR_PAIRS`: number of top-weight participating strategies considered when building active pairs.
- `COMBO_TOP_STRATEGIES_FOR_TRIOS`: number of top-weight participating strategies considered when building active trios.
- `MIN_COMBO_SAMPLES_PAIR`: minimum pair sample count before a pair can leave warm-up in research scoring.
- `MIN_COMBO_SAMPLES_TRIO`: minimum trio sample count before a trio can leave warm-up in research scoring.
- `MIN_COMBO_EXECUTION_SAMPLES_PAIR`: minimum pair sample count before a pair is eligible to unlock execution.
- `MIN_COMBO_EXECUTION_SAMPLES_TRIO`: minimum trio sample count before a trio is eligible to unlock execution.
- `MIN_COMBO_LIFT_PNL`: minimum lift in PnL proxy versus the best member before a combo can be considered useful.
- `MIN_COMBO_LIFT_HIT`: minimum hit-rate lift versus the best member before a combo can be considered useful.
- `MIN_COMBO_SCORE_FOR_BOOST`: minimum research combo score before agreement can influence the ensemble.
- `MIN_COMBO_EXECUTION_SCORE`: minimum effective combo score required by the combo execution gate.
- `MIN_COMBO_AGREEMENT_PURITY_FOR_PENALTY`: minimum historical agreement purity required before disagreement can reduce confidence.
- `MAX_PAIR_BOOST_ABS`: maximum absolute score boost from a single pair.
- `MAX_TRIO_BOOST_ABS`: maximum absolute score boost from a single trio.
- `MAX_TOTAL_COMBO_BOOST_ABS`: global cap on total combo score boost for one prediction.
- `MAX_TOTAL_COMBO_CONFIDENCE_PENALTY`: global cap on total combo disagreement penalty for one prediction.
- `ENABLE_COMBO_BOOST`: enables or disables research-time combo boosts while keeping combo analytics available.
- `DASHBOARD_POLL_INTERVAL_MS`: browser polling interval for the dashboard.
- `MARKET_SCORE_WINDOW_SECONDS`: rolling window used by market-level research and execution scoring.
- `MIN_MARKET_TRADES_FOR_SCORING`: minimum recent trade count before execution score is considered properly established.
- `MIN_MARKET_SCORE_FOR_ENTRY`: legacy market score threshold retained for compatibility.
- `MIN_EXECUTION_SCORE_FOR_ENTRY`: effective execution score threshold used by the execution gate.
- `MIN_RESEARCH_SCORE_FOR_BOOTSTRAP`: minimum research score required before discounted research may bootstrap execution trust.
- `MIN_MARKET_PREDICTIONS_BEFORE_ENTRY`: minimum raw prediction count before a market can leave initial warm-up.
- `MIN_RESEARCH_PREDICTIONS_FOR_BOOTSTRAP`: minimum resolved research prediction count before research can bootstrap execution.
- `ENTRY_TARGET_PRICE`: preferred entry anchor for the execution overlay.
- `ENTRY_BAND_HALF_WIDTH`: allowed deviation around `ENTRY_TARGET_PRICE`.
- `MIN_ORDER_USD`: minimum notional per paper trade.
- `MIN_ORDER_SHARES`: minimum share count per paper trade.
- `TAKE_PROFIT_DELTA`: TP distance from entry price.
- `STOP_LOSS_DELTA`: SL distance from entry price.
- `MIN_ENTRY_CONFIDENCE`: minimum confidence required before a prediction can be considered for execution.
- `MIN_MARKET_QUALITY_FOR_ENTRY`: minimum live market-quality score required for execution.
- `MIN_SPREAD_FOR_MAKER`: minimum spread where maker posting remains attractive.
- `MAX_SPREAD_FOR_ENTRY`: maximum tolerated spread for a new trade.
- `MAKER_ENTRY_TIMEOUT_MS`: maximum wait time for a maker entry before fallback or cancel.
- `MAKER_EXIT_TIMEOUT_MS`: maximum wait time for a maker exit before taker fallback.
- `MIN_DEPTH_FOR_MAKER`: minimum top-of-book depth required to prefer maker.
- `MAKER_DRIFT_LIMIT`: maximum tolerated book drift before maker becomes unattractive.
- `TAKER_URGENCY_THRESHOLD`: urgency level where taker becomes preferred.
- `LOW_DEPTH_SLIPPAGE_PROXY`: extra slippage proxy applied to thin books.
- `MAX_OPEN_POSITIONS_GLOBAL`: portfolio-wide cap for simultaneous open positions.
- `CROSS_ASSET_BREADTH_MOVE_THRESHOLD`: minimum normalized move required for one market to count toward the cross-asset breadth calculation.
- `CROSS_ASSET_BREADTH_MIN_PARTICIPATION`: minimum share of qualifying markets that must agree before breadth is treated as a real regime.
- `CROSS_ASSET_BREADTH_MIN_STRENGTH`: minimum breadth-strength score required before execution treats the regime as strong.
- `CROSS_ASSET_LAGGARD_THRESHOLD`: minimum lag ratio required before the leader-laggard catch-up strategy activates.
- `EXECUTION_BOOTSTRAP_MIN_DISCOUNT`: lowest discount applied to research score while bootstrapping execution trust.
- `EXECUTION_BOOTSTRAP_MAX_DISCOUNT`: highest bootstrap discount allowed even after research quality improves.
- `EXECUTION_MODE`: selects `paper` or `real` execution. `real` enables live order placement through `@sha3/polymarket`.
- `REAL_BALANCE_REFRESH_MS`: cache TTL for the real account balance shown in the dashboard and HTTP payloads.
- `POLYMARKET_PRIVATE_KEY`: required private key for `EXECUTION_MODE=real`. Startup fails hard when it is missing.
- `POLYMARKET_FUNDER_ADDRESS`: optional funder address forwarded to the live Polymarket client.
- `POLYMARKET_SIGNATURE_TYPE`: optional signature type forwarded to the live Polymarket client.
- `POLYMARKET_MAX_ALLOWED_SLIPPAGE`: optional max slippage forwarded to the live Polymarket client during initialization.

## Scripts

- `npm run start`: start the service with `tsx`
- `npm run build`: compile to `dist/`
- `npm run standards:check`: contract verification
- `npm run lint`: Biome checks
- `npm run format:check`: formatter verification
- `npm run typecheck`: TypeScript verification
- `npm run test`: Node test suite
- `npm run check`: full blocking validation pipeline

## Structure

- `src/app/`: runtime composition
- `src/market/`: market normalization and rolling state
- `src/strategy/`: strategy execution and rolling strategy metrics
- `src/combo/`: dynamic pair/trio discovery and combo scoring
- `src/prediction/`: prediction lifecycle and history
- `src/execution/`: execution gate and paper-trading overlay
- `src/dashboard/`: dashboard summary payloads and HTML view
- `src/http/`: Hono transport layer
- `test/`: deterministic runtime and metrics tests

## Compatibility

- Node.js `20+`
- ESM consumers
- strict TypeScript projects

## Troubleshooting

### No markets are tradable

Check these first:

- `MIN_EXECUTION_SCORE_FOR_ENTRY`
- `MIN_RESEARCH_SCORE_FOR_BOOTSTRAP`
- `MIN_RESEARCH_PREDICTIONS_FOR_BOOTSTRAP`
- `MIN_MARKET_QUALITY_FOR_ENTRY`
- `ENTRY_BAND_HALF_WIDTH`
- `MAX_SPREAD_FOR_ENTRY`
- combo execution thresholds

If research is moving but execution stays blocked, the likely reason is that the combo gate or execution bootstrap is intentionally refusing to trust the market yet.

### Predictions exist but no trades happen

Check:

- `combo_gate_failed`
- `insufficient_execution_history`
- `bootstrap_discount_too_low`
- `execution_score_too_low`

in `/v1/execution` or in the dashboard `Execution Now` panel.

### Combos never become actionable

Review:

- `COMBO_TOP_STRATEGIES_FOR_PAIRS`
- `COMBO_TOP_STRATEGIES_FOR_TRIOS`
- `MIN_COMBO_EXECUTION_SAMPLES_PAIR`
- `MIN_COMBO_EXECUTION_SAMPLES_TRIO`
- `MIN_COMBO_EXECUTION_SCORE`
- `MIN_COMBO_LIFT_PNL`
- `MIN_COMBO_LIFT_HIT`

### Positions never close

Check whether TP/SL levels are reachable and whether maker exits are being given too much or too little time:

- `TAKE_PROFIT_DELTA`
- `STOP_LOSS_DELTA`
- `MAKER_EXIT_TIMEOUT_MS`

### Maker usage is too high or too low

Review:

- `MIN_SPREAD_FOR_MAKER`
- `MIN_DEPTH_FOR_MAKER`
- `MAKER_DRIFT_LIMIT`
- `TAKER_URGENCY_THRESHOLD`
- maker timeout values

### `npm run check` fails

Run stages separately:

```bash
npm run standards:check
npm run lint
npm run format:check
npm run typecheck
npm run test
```

## AI Workflow

The repository uses a strict coding contract defined in:

- [AGENTS.md](/Users/jc/Documents/GitHub/polymarket-crypto-prediction/AGENTS.md)
- [ai/contract.json](/Users/jc/Documents/GitHub/polymarket-crypto-prediction/ai/contract.json)

Important expectations:

- keep implementation in TypeScript
- respect class-first structure and section markers
- avoid editing managed AI contract files unless the task is explicitly about standards
- run `npm run standards:check` and `npm run check` before finishing behavior changes
- keep README aligned with the actual package surface and configuration keys
