# @sha3/polymarket-crypto-prediction

Event-driven Polymarket crypto predictor for `btc`, `eth`, `sol`, and `xrp` on `5m` and `15m` markets.

The system is now **combo-first**:

- each strategy is a sensor
- the combo engine searches dynamic **pairs and trios**
- each market gets one **selected strategy combo**
- execution trades only when that combo also passes strict BTC/ETH anchor rules

## TL;DR

- `BTC` is the primary anchor.
- `ETH` can only trade with `BTC`, never against it.
- `SOL` and `XRP` can only trade when `BTC` and `ETH` support the same direction.
- The core decision object is the **selected strategy combo**, not a `setup`.
- The dashboard is operator-focused: regime, markets, execution decisions, combo board, candidates, predictions, trades, positions, and health.
- `paper` and `real` mode share the same decision model. Only the execution backend changes.
- State is still **in-memory** today. Restarting clears local prediction and trade history.

## Why This Exists

Polymarket crypto tokens move fast around `0.5`, but not every `0.5` cross deserves capital.

This project tries to solve that with a smaller and more coherent model:

1. Read local microstructure and momentum.
2. Read cross-asset anchor context from `BTC` and `ETH`.
3. Search dynamic strategy combos for the current market.
4. Select the best combo for research.
5. Allow execution only if the combo also survives market quality, affordability, market-score, and anchor rules.

## Main Capabilities

- Live market monitoring for `btc/eth/sol/xrp` on `5m` and `15m`
- Dynamic combo search across strategy pairs and trios
- Rolling combo metrics: hit rate, pnl proxy, sample count, bootstrap discount, drawdown proxy
- Anchor-first execution rules: `BTC -> ETH -> SOL/XRP`
- Paper execution backend
- Real execution backend via `@sha3/polymarket`
- Minimal dashboard and HTTP API
- Strategy and combo inspection routes

## System Overview

The runtime loop is:

1. ingest snapshots
2. compute per-market state
3. derive the cross-asset anchor regime
4. score strategies
5. search pairs and trios of active strategies
6. select the best combo for each market
7. create a prediction if the combo is research-worthy
8. evaluate execution eligibility with anchor and operational gates
9. route the decision to `paper` or `real`

## Combo-First Model

The most important concepts are:

- `strategy`
  Individual sensor such as momentum, microprice, breadth impulse, or basis dislocation.
- `combo`
  A pair or trio of strategies evaluated together for one market and one moment.
- `selected combo`
  The winning combo for that market and snapshot.
- `prediction`
  Research record built directly from the selected combo.
- `execution`
  Separate operational decision: should this combo get capital right now?

The model no longer asks:

- “which setup won?”

It now asks:

- “which concrete strategy combo won?”

### How combos are selected

For each market:

1. the engine collects active strategy signals
2. it generates all eligible pairs
3. it generates all eligible trios
4. it scores each candidate by:
   - agreement
   - historical hit rate
   - historical pnl proxy
   - sample count
   - drawdown penalty
   - diversity
   - family redundancy penalty
   - semantic overlap penalty
   - anchor fit
   - affordability
5. it picks one `selectedCombo`

The selected combo exposes:

- `comboKey`
- `memberStrategyIds`
- `direction`
- `comboScore`
- `comboConfidence`
- `historicalHitRate`
- `historicalPnlProxy`
- `sampleCount`
- `diversityScore`
- `familyRedundancyPenalty`
- `semanticOverlapPenalty`
- `anchorFitScore`
- `marketQualityScore`
- `affordabilityScore`
- `selectionReason`

### Why `setup` disappeared

`setup` had become a narrative layer between evidence and decision.

That created several problems:

- it hid the actual strategy combination that won
- it duplicated reasoning already present in combos
- it made the dashboard harder to read
- it encouraged fixed narrative templates instead of live combination search

The system is now simpler:

- strategy signals in
- best combo out

## Core Concepts

### Research vs Execution

Research and execution share the same combo engine, but they do not have the same threshold.

Research asks:

- “is this combo interesting enough to record?”

Execution asks:

- “is this combo strong enough, clean enough, and anchor-aligned enough to risk capital?”

That means a combo can be:

- good enough for research
- still blocked for execution

This is expected and healthy.

### Scores

The important score layers are:

- `strategy score`
  Signed contribution from one strategy.
- `combo score`
  Final score for the selected pair or trio.
- `marketScore`
  Market-level predictive trust built only from resolved research predictions.

### Cross-Asset Anchor Regime

The regime is anchor-first, not generic “leader/laggard”.

The hierarchy is:

- `BTC` is the primary anchor
- `ETH` is secondary and can only reinforce `BTC`
- `SOL` and `XRP` are followers only

Current regime ids are:

- `neutral`
- `btc_bias_up`
- `btc_bias_down`
- `btc_eth_bias_up`
- `btc_eth_bias_down`
- `btc_up`
- `btc_down`
- `btc_eth_up`
- `btc_eth_down`
- `fragmented`
- `reversal_risk`

Important regime fields:

- `btcDirection`
- `ethDirection`
- `btcUpTokenMomentum`
- `btcDownTokenMomentum`
- `ethUpTokenMomentum`
- `ethDownTokenMomentum`
- `breadthStrength`
- `breadthParticipation`
- `followerParticipation`
- `synchronyScore`
- `accelerationScore`
- `reversalRiskScore`
- `hasBtcAnchor`
- `hasEthAlignment`
- `isDirectional`
- `isTradableGlobalContext`

`breadthStrength` and `breadthParticipation` are anchor-only metrics built from `BTC` and `ETH`. `SOL` and `XRP` do not define regime breadth anymore; they only appear as followers through `followerParticipation`.

### Hard Anchor Rules

These are not soft hints. They are hard execution rules.

#### ETH

- `ETH UP` is blocked unless `BTC UP` token momentum supports `UP`
- `ETH DOWN` is blocked unless `BTC DOWN` token momentum supports `DOWN`

#### SOL and XRP

- `SOL/XRP UP` are blocked unless both `BTC UP` and `ETH UP` support `UP`
- `SOL/XRP DOWN` are blocked unless both `BTC DOWN` and `ETH DOWN` support `DOWN`

This is the practical meaning of the anchor model:

- `BTC` moves first
- `ETH` may reinforce
- alts may follow
- nothing should trade cleanly against that stack

## Strategy Model

The combo engine still works over the full strategy catalog, but some strategies are primary and some are auxiliary.

The most important visible strategies today are:

- `s01` Momentum EWMA
- `s02` Token Microprice
- `s05` Order Book Churn
- `s09` Spot Consensus Momentum
- `s12` Volatility Breakout
- `s14` Chainlink Basis
- `s16` Freshness Gap
- `s18` Liquidity Shock Fade
- `s21` Cross-Asset Breadth Impulse
- `s22` Anchor Follow Catch-Up
- `s23` BTC Trend Reversal Confirmation

Affordability is still part of the system, but it is no longer modeled as a strategy. It now acts as a direct entry filter and combo penalty instead of appearing as a combo member.

The combo engine is now deliberately pruned. These strategies are no longer first-class combo members:

- `s03`
- `s04`
- `s06`
- `s07`
- `s08`
- `s10`
- `s11`
- `s13`
- `s15`
- `s17`
- `s19`
- `s20`

They may still survive as supporting ideas in the codebase, but they do not compete as primary combo members. The goal is:

- fewer redundant votes
- more orthogonal pairs and trios
- less optimistic continuation bias
- better correlation between combo score and real outcomes

## Prediction Lifecycle

1. A market produces a trigger.
2. Trigger confirmation logic waits for post-trigger confirmation.
3. Strategies score the market.
4. The combo engine searches pairs and trios.
5. One combo is selected.
6. A prediction is stored with that combo.
7. Later the prediction resolves through TP/SL outcome or fallback resolution.
8. Strategy and combo metrics update from the result.

Prediction records now describe:

- direction
- confidence
- selected combo
- cross-asset regime
- combo breakdown
- execution eligibility
- result

Current triggers are:

- `XH` = `crossed_half`
- `BTR` = `btc_trend_reversal`
- `CSS` = `combo_state_shift`
- `RSS` = `regime_state_shift`

The first five are market-event triggers.
`CSS` and `RSS` are model-state triggers:

- `CSS` fires when the best combo changes meaningfully
- `RSS` fires when the cross-asset regime changes meaningfully and that change improves the current combo state

## Execution Gate

Execution is no longer driven by `setup`.

It is driven by:

- selected combo strength
- combo confidence
- anchor fit
- market quality
- market score
- affordability
- price band
- spread
- live-market status
- BTC/ETH structural rules

Typical blocking reasons:

- `no_prediction`
- `position_already_open`
- `cross_asset_regime_conflict`
- `quality_too_low`
- `confidence_too_low`
- `combo_score_too_low`
- `anchor_fit_too_low`
- `outside_entry_band`
- `spread_too_wide`
- `market_warming_up`
- `market_score_too_low`

## Dashboard

The dashboard is now meant for operators, not model archaeology.

The `Global Regime` panel uses a short rolling lookback, not a single-snapshot delta. With a `500 ms` feed, one-snapshot momentum is too flat and too noisy to explain what BTC and ETH are really doing. The regime therefore measures anchor motion and breadth over a configurable time window.

### Global Regime

Shows the broad cross-asset context for `5m` and `15m`:

- regime id
- breadth
- participation
- acceleration
- reversal risk
- BTC token momentum
- ETH token momentum
- short regime memory chart

Read it as:

- what are `BTC` and `ETH` doing?
- are they aligned?
- are followers allowed right now?

### Markets

Snapshot of all monitored markets.

Use it to see:

- current token prices
- cooldown
- market score
- regime
- current best combo
- quality

### Execution Now

Current trade/no-trade decision per market.

This is the real gate.

Each row shows:

- action
- selected combo
- combo score
- affordability
- regime
- market score
- blocking reason

### Trade Candidates

Sorted list of markets by operational priority.

This panel is the fastest way to answer:

- which market is closest to a trade?
- what is still blocking it?
- is it improving or fading?

### Combo Board

Recent winning combos from the prediction layer.

It tells you:

- which combo won
- combo score
- affordability
- why it beat alternatives

### Resolved Predictions

Recent finished predictions.

This is the best panel for judging research quality:

- market
- direction
- trigger
- combo
- combo score
- final result

### Discovery Board

Rolling learning surface for combos.

It groups recent resolved predictions by combo and shows:

- hit rate
- average combo score
- average affordability
- average confidence
- sample count
- markets where the combo appeared

### Market PnL

Per-market performance summary:

- trade count
- hit rate
- pnl
- average pnl
- drawdown
- scores
- status

### Recent Trades

Closed trades from the active execution backend.

This is what the system actually executed.

### Open Positions

Live exposure in the active execution backend.

### Health

Runtime and account health:

- snapshot age
- execution mode
- active trades
- balance age
- maker/taker usage
- balance refresh errors

## Installation

```bash
npm install
```

## Setup

Create a `.env` file or export environment variables before starting the runtime.

Minimal example:

```bash
PORT=3300
EXECUTION_MODE=paper
npm start
```

Real mode example:

```bash
PORT=3300
EXECUTION_MODE=real
POLYMARKET_PRIVATE_KEY=0xyour_private_key
POLYMARKET_FUNDER_ADDRESS=0xyour_funder_address
npm start
```

If `EXECUTION_MODE=real` and the Polymarket credentials are invalid or missing, startup should fail instead of silently downgrading to paper.

## Running Locally

### Start the default runtime

```bash
npm start
```

### Build the package

```bash
npm run build
```

### Run the full gate

```bash
npm run check
```

## Usage

### Build the server without listening

```ts
import { ServiceRuntime } from "@sha3/polymarket-crypto-prediction";

const runtime = ServiceRuntime.createDefault();
const server = runtime.buildServer();
server.listen(3300);
```

### Inject deterministic snapshots

```ts
import { ServiceRuntime } from "@sha3/polymarket-crypto-prediction";

const runtime = ServiceRuntime.createDefault();

runtime.ingestSnapshot({
  generated_at: Date.now(),
  btc_binance_price: 60000,
});
```

### Stop the runtime

```ts
await runtime.stop();
```

## Examples

### Inspect the latest BTC 5m prediction

```bash
curl "http://127.0.0.1:3300/v1/predict?asset=btc&window=5m"
```

### Inspect execution decisions for all markets

```bash
curl "http://127.0.0.1:3300/v1/execution"
```

### Inspect dashboard summary JSON

```bash
curl "http://127.0.0.1:3300/v1/dashboard/summary"
```

## HTTP API

### `GET /`

Returns the operator dashboard HTML.

### `GET /v1/healthz`

Returns runtime health and monitored market count.

### `GET /v1/predict?asset={btc|eth|sol|xrp}&window={5m|15m}`

Returns the latest prediction for one market.

Important fields:

- `direction`
- `confidence`
- `crossAssetRegime`
- `selectedCombo`
- `comboBreakdown`
- `strategyBreakdown`
- `isExecutionEligible`

### `GET /v1/predictions?asset={btc|eth|sol|xrp}&window={5m|15m}&limit=N`

Returns recent predictions for one market.

### `GET /v1/strategies`

Returns rolling strategy summaries, globally or for one market.

### `GET /v1/combos?asset={btc|eth|sol|xrp}&window={5m|15m}&limit=N`

Returns rolling combo summaries, globally or for one market.

### `GET /v1/markets`

Returns current market summaries for all monitored markets.

### `GET /v1/dashboard/summary`

Returns the JSON payload used by the dashboard.

Key fields:

- `globalRegime`
- `globalRegimes`
- `markets`
- `latestPredictions`
- `winningCombinations`
- `executionNow`
- `tradeCandidates`
- `discoveryBoard`
- `marketPnlTable`
- `recentTrades`
- `openPositions`
- `health`
- `account`

### `GET /v1/execution`

Returns execution-facing state.

Key fields:

- `executionMode`
- `account`
- `executionNow`
- `openPositions`
- `executionPerformance`
- `paperExecutionPerformance`

### `GET /v1/trades?limit=N`

Returns recent closed trades from the active backend.

### Error Shape

HTTP validation errors use a stable JSON error format.

## Public API

### `ServiceRuntime`

Main composition root.

#### `createDefault(): ServiceRuntime`

Builds the runtime with default services and default configuration.

#### `buildServer(): ServerType`

Builds the HTTP server without starting it.

#### `startServer(): ServerType`

Starts the HTTP server using the configured port.

#### `stop(): Promise<void>`

Stops the runtime and closes open resources.

#### `ingestSnapshot(snapshot: InputSnapshot): void`

Injects one snapshot into the runtime. Useful for tests and deterministic replay.

### `ComboBreakdown`

Per-prediction view of combo boost and penalty effects.

### `ComboSummary`

Rolling summary for one combo:

- market key
- combo key
- member strategies
- hit rate
- pnl proxy
- sample counts

### `ComboUsage`

Usage counters and last-seen information for one combo.

### `MarketComboBoard`

Top combos currently associated with one market.

### `DashboardSummaryPayload`

Dashboard JSON model used by `GET /v1/dashboard/summary`.

### `ExecutionMode`

`"paper" | "real"`

### `ExecutionAccountSummary`

Operational account summary:

- mode
- balance
- balance freshness
- refresh errors

### `HealthPayload`

Service health summary returned in dashboard payloads.

### `ExecutionDecision`

Current decision for one market.

Important fields:

- `isEntryAllowed`
- `marketScore`
- `selectedComboKey`
- `selectedComboStrategyIds`
- `selectedComboScore`
- `selectedComboAffordabilityScore`
- `selectedComboConfidence`
- `blockingReasons`

### `MarketExecutionSummary`

One market plus its current `ExecutionDecision`.

### `OpenPositionSummary`

Current open position state for one market.

### `PaperPosition`

Internal paper position record exported for convenience.

### `ExecutionTrade`

Closed trade summary from the active backend.

### `PaperTrade`

Backward-compatible alias shape for execution trades.

### `PortfolioExecutionSummary`

Portfolio-level execution statistics:

- trade count
- win rate
- pnl
- drawdown
- maker/taker usage

### `MarketSummary`

Current market snapshot summary for one monitored market.

### `PredictionResponse`

Prediction payload returned by prediction endpoints.

Important fields:

- `direction`
- `confidence`
- `crossAssetRegime`
- `selectedCombo`
- `strategyBreakdown`
- `comboBreakdown`
- `result`

### `StrategySummary`

Rolling summary for one strategy.

## Configuration

Every top-level key from `src/config.ts` is documented below.

### Service and transport

- `RESPONSE_CONTENT_TYPE`: default HTTP response content type
- `DEFAULT_PORT`: server port
- `SERVICE_NAME`: service name exposed in health and dashboard
- `EXECUTION_MODE`: `paper` or `real`

### Snapshot cadence and prediction trigger

- `SNAPSHOT_INTERVAL_MS`: expected snapshot interval
- `CROSS_THRESHOLD`: half-cross threshold around `0.5`
- `MARKET_COOLDOWN_MS`: per-market cooldown between predictions
- `TRIGGER_CONFIRMATION_DELAY_MS`: delay before confirming a trigger
- `MIN_TRIGGER_DISTANCE_FROM_HALF`: minimum post-cross distance from `0.5`
- `MIN_TRIGGER_SPOT_MOMENTUM`: minimum local spot momentum for trigger confirmation
- `MIN_RESEARCH_MARKET_QUALITY`: minimum quality for research predictions
- `MIN_WEAK_BREADTH_STRENGTH_FOR_PREDICTION`: minimum weak breadth support for prediction creation
- `PREDICTION_HORIZON_MS`: prediction resolution horizon

### History and query limits

- `SHORT_HISTORY_SECONDS`: short rolling history window
- `LONG_HISTORY_SECONDS`: long rolling history window
- `MAX_PREDICTION_HISTORY_PER_MARKET`: in-memory prediction cap per market
- `MAX_PREDICTION_QUERY_LIMIT`: max API query limit for predictions

### Freshness checks

- `TOKEN_MAX_AGE_MS`: max token quote age
- `SPOT_MAX_AGE_MS`: max spot age
- `CHAINLINK_MAX_AGE_MS`: max chainlink age

### Ensemble and strategy scoring

- `ENSEMBLE_MEDIUM_CONFIDENCE_THRESHOLD`
- `ENSEMBLE_HIGH_CONFIDENCE_THRESHOLD`
- `ENSEMBLE_SCORE_ESCALATION_THRESHOLD`
- `STRATEGY_ROLLING_WINDOW_SECONDS`

These still affect the underlying strategy layer even though the final decision is combo-first.

### Combo engine

- `COMBO_ROLLING_WINDOW_SECONDS`
- `COMBO_TOP_STRATEGIES_FOR_PAIRS`
- `COMBO_TOP_STRATEGIES_FOR_TRIOS`
- `COMBO_MAX_CANDIDATE_STRATEGIES`
- `MIN_STRATEGY_SCORE_FOR_COMBO`
- `MIN_STRATEGY_CONFIDENCE_FOR_COMBO`
- `MIN_COMBO_SAMPLES_PAIR`
- `MIN_COMBO_SAMPLES_TRIO`
- `MIN_COMBO_EXECUTION_SAMPLES_PAIR`
- `MIN_COMBO_EXECUTION_SAMPLES_TRIO`
- `MIN_COMBO_LIFT_PNL`
- `MIN_COMBO_LIFT_HIT`
- `MIN_COMBO_SCORE_FOR_BOOST`
- `MIN_COMBO_EXECUTION_SCORE`
- `MIN_COMBO_AGREEMENT_PURITY_FOR_PENALTY`
- `MAX_PAIR_BOOST_ABS`
- `MAX_TRIO_BOOST_ABS`
- `MAX_TOTAL_COMBO_BOOST_ABS`
- `MAX_TOTAL_COMBO_CONFIDENCE_PENALTY`
- `ENABLE_COMBO_BOOST`

### Dashboard

- `DASHBOARD_POLL_INTERVAL_MS`: dashboard polling interval
- `CROSS_ASSET_LOOKBACK_MS`: rolling lookback used by the cross-asset regime so BTC/ETH momentum and breadth are measured over a short interval instead of one snapshot

### Market scoring and bootstrap

- `MARKET_SCORE_WINDOW_SECONDS`
- `MIN_MARKET_TRADES_FOR_SCORING`
- `MIN_MARKET_SCORE_FOR_ENTRY`
- `MIN_MARKET_PREDICTIONS_BEFORE_ENTRY`
- `MIN_RESEARCH_PREDICTIONS_FOR_BOOTSTRAP`

### Entry and risk

- `ENTRY_TARGET_PRICE`
- `ENTRY_BAND_HALF_WIDTH`
- `MIN_ORDER_USD`
- `MIN_ORDER_SHARES`
- `TAKE_PROFIT_DELTA`
- `STOP_LOSS_DELTA`
- `MIN_ENTRY_CONFIDENCE`
- `MIN_MARKET_QUALITY_FOR_ENTRY`
- `MIN_SPREAD_FOR_MAKER`
- `MAX_SPREAD_FOR_ENTRY`
- `MAKER_ENTRY_TIMEOUT_MS`
- `MAKER_EXIT_TIMEOUT_MS`
- `MIN_DEPTH_FOR_MAKER`
- `MAKER_DRIFT_LIMIT`
- `TAKER_URGENCY_THRESHOLD`
- `LOW_DEPTH_SLIPPAGE_PROXY`
- `MAX_OPEN_POSITIONS_GLOBAL`

### Real-mode account

- `REAL_BALANCE_REFRESH_MS`
- `POLYMARKET_PRIVATE_KEY`
- `POLYMARKET_FUNDER_ADDRESS`
- `POLYMARKET_SIGNATURE_TYPE`
- `POLYMARKET_MAX_ALLOWED_SLIPPAGE`

### Cross-asset anchor thresholds

- `CROSS_ASSET_BREADTH_MOVE_THRESHOLD`
- `CROSS_ASSET_BREADTH_MIN_PARTICIPATION`
- `CROSS_ASSET_BREADTH_MIN_STRENGTH`
- `CROSS_ASSET_LAGGARD_THRESHOLD`

## Scripts

- `npm start`: run the service
- `npm run build`: build TypeScript output
- `npm run lint`: biome checks
- `npm run lint:fix`: biome auto-fix
- `npm run format:check`: biome formatting check
- `npm run format:write`: biome formatting write
- `npm run typecheck`: TypeScript check
- `npm run test`: node:test suite
- `npm run standards:check`: code-standards verify
- `npm run check`: full blocking gate

## Structure

- `src/app`: runtime composition
- `src/combo`: combo metrics and combo selection
- `src/dashboard`: dashboard summary and HTML rendering
- `src/execution`: execution policy plus paper/real backends
- `src/http`: HTTP server
- `src/market`: market state and cross-asset regime
- `src/prediction`: prediction lifecycle
- `src/strategy`: strategy scoring and strategy metrics
- `test`: node:test coverage

## Compatibility

- `paper` mode preserves simulated trading
- `real` mode uses `@sha3/polymarket`
- there is no persistence layer yet
- restart clears in-memory prediction, combo, and trade state

## Troubleshooting

### No markets are tradable

Check:

- `Global Regime` is not fragmented or heavily reversal-risk
- the selected combo is non-empty
- `marketScore` is not below the trading threshold
- `cross_asset_regime_conflict` is not blocking the market
- the selected combo still has enough score and affordability

### Predictions exist but no trades happen

That is normal when:

- combos are good enough for research
- but anchor fit, affordability, market quality, or combo score are still below threshold

Read:

- `Execution Now`
- `Trade Candidates`
- `Discovery Board`

### Combos never become actionable

Check:

- combo sample counts
- combo score distribution
- market quality
- bootstrap discount
- spread and entry band blockers

### Real mode fails on startup

Check:

- `EXECUTION_MODE=real`
- `POLYMARKET_PRIVATE_KEY`
- optional signer/funder settings

The runtime should not silently downgrade to paper.

### `npm run check` fails

Run the steps individually:

```bash
npm run standards:check
npm run lint
npm run format:check
npm run typecheck
npm run test
```

## AI Workflow

This repo carries an AI coding contract in:

- `AGENTS.md`
- `ai/contract.json`

Normal workflow:

1. inspect the current code before changing behavior
2. keep changes simple and class-first
3. add or update tests for behavior changes
4. update the README when behavior or public API changes
5. finish with `npm run check`
