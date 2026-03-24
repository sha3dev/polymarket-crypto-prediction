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
- Creates predictions only on confirmed `0.5` crosses instead of emitting a view on every snapshot.
- Uses the whole monitored crypto set as context, not just the local market.
- Reorganizes the twenty-two raw strategies into explicit `signal engines`.
- Chooses a `winning setup` and a `winning engine combination` instead of relying on a flat strategy average.
- Keeps `research` and `execution` separate so the system can learn broadly without forcing capital deployment.
- Preserves the legacy strategy combo gate as a secondary execution filter.
- Exposes a dashboard built around regime, engines, winning combinations, and execution state.

## System Overview

The runtime now works as a five-step decision chain:

1. `Market ingestion`
   Reads Polymarket token state plus spot and Chainlink context from `@sha3/polymarket-snapshot`.

2. `Regime engine`
   Measures whether the monitored assets are neutral, broadly directional, fragmented, leader/laggard, or at reversal risk.

3. `Signal engines`
   The twenty-two raw strategies are treated as sensors and grouped into higher-level engines such as breadth, propagation, momentum, microstructure, mispricing, reversion, and meta.

4. `Combination engine`
   Evaluates plausible engine combinations, scores them by diversity plus regime fit, and chooses a single winning narrative.

5. `Execution overlay`
   Applies stricter, setup-specific rules plus market-quality and scoring gates before any paper or real trade is allowed.

The important architectural change is this:

- the raw strategies still exist
- the raw strategy metrics still matter
- but the final decision is no longer “what does the weighted strategy average say?”
- it is now “which setup supported by which engine combination best fits the current regime?”

## Core Concepts

### Research vs Execution

`Research` is the broad learning layer.

- A prediction can be created.
- It can later resolve as `ok` or `ko`.
- It can improve market and strategy learning.
- It does not need to become a trade.

`Execution` is the capital-allocation layer.

- It only sees predictions that already have a winning setup.
- It still blocks most of them unless the full operational gate passes.
- Only executed trades affect execution PnL and execution score.

This is the key split:

- `research` asks: “is this idea directionally interesting?”
- `execution` asks: “is this idea clean enough to deserve capital right now?”

### Scores

The service tracks three market-level score families:

- `researchScore`
  Derived from resolved predictions. It reflects directional quality, rolling edge, and sample size.

- `executionScore`
  Derived only from closed trades. It reflects realized trade quality after costs and drawdown.

- `effectiveExecutionScore`
  The score the execution gate actually uses.
  - if there is not enough trade history, it bootstraps from discounted `researchScore`
  - once trade history exists, it becomes conservative and favors the weaker of execution reality and discounted research optimism

Under the new architecture, these market scores are no longer the top of the hierarchy. They are downstream trust signals that sit below:

1. regime
2. winning setup
3. winning engine combination
4. market score
5. execution score

### Cross-Asset Regime

The new model treats cross-asset context as structural, not decorative.

For each `5m` or `15m` window, the regime engine measures:

- `breadthDirection`
  `UP`, `DOWN`, or `NEUTRAL`

- `breadthStrength`
  How strong the dominant cross-asset move is

- `breadthParticipation`
  What fraction of qualifying markets is aligned with that move

- `leaderMarketKey`
  Which market currently leads the impulse

- `leaderGroup`
  Top leading markets by signed move

- `laggardGroup`
  Markets lagging the dominant move and therefore relevant for catch-up setups

- `synchronyScore`
  How synchronized the monitored assets are

- `accelerationScore`
  Whether the move is broadening or gaining force

- `exhaustionScore`
  Whether the move is looking stretched

- `reversalRiskScore`
  Whether continuation logic is now at material risk of failing

The regime engine then classifies the state as one of:

- `neutral`
- `broad_up_weak`
- `broad_up_strong`
- `broad_down_weak`
- `broad_down_strong`
- `leader_laggard_up`
- `leader_laggard_down`
- `fragmented`
- `reversal_risk`

That regime classification is used everywhere:

- it changes which engines are allowed to become strong
- it changes which setups are plausible
- it changes which engine combinations rank highest
- it changes whether execution allows continuation or blocks it

### Engines

The raw strategies are now grouped into explicit engines.

The goal is to stop treating twenty-two partially correlated features as twenty-two independent votes.

The current engines are:

- `breadth_engine`
  Cross-asset direction and synchrony

- `propagation_engine`
  Leader/laggard and catch-up behavior

- `local_momentum_engine`
  Continuation and local breakout confirmation

- `local_microstructure_engine`
  Order-book pressure and local token structure

- `mispricing_engine`
  Basis, barrier mismatch, freshness and repricing

- `reversion_engine`
  Failed continuation, fade, exhaustion, and mean reversion

- `meta_engine`
  Quality and stabilizing meta influence

Each engine emits:

- direction
- score
- confidence
- state
- regime fit
- member strategies
- explanation

And each engine is explicitly tagged as:

- `inactive`
- `weak`
- `active`
- `dominant`
- `avoid`

This is the main interpretability improvement of the redesign.

### Winning Setup and Winning Combination

The prediction layer now produces a single winning narrative, not just a signed score.

Important fields:

- `winningSetupType`
  The narrative class selected by the combination engine

- `winningEngineIds`
  The engines that support that narrative

- `winningEngineComboKey`
  Stable combo key such as `breadth_engine+propagation_engine+local_momentum_engine`

- `winningEngineComboScore`
  The signed score of the winning combination after diversity and regime-fit adjustment

- `combinationReason`
  Human-readable reason for why that combination won

Current setup types:

- `broad_continuation`
- `leader_laggard_catchup`
- `local_breakout_confirmed`
- `mispricing_repricing`
- `fade_failed_cross`
- `research_probe`

The selection logic prefers:

- combinations whose engines agree on direction
- combinations that mix different information sources
- combinations that fit the current regime
- combinations that tell a coherent story instead of stacking redundant micro-signals

### Legacy Strategy Combos

The project still keeps the older strategy pair/trio combo engine.

That layer now has a narrower role:

- it remains a secondary gate for execution
- it still tracks historical lift of strategy pairs and trios
- it can still boost or penalize research confidence

But it is no longer the main narrative-selection mechanism.

The main narrative now comes from engine combinations.

## Strategy Model

The twenty-two strategies are still present, but they should now be understood as feature sensors inside engines, not as the top-level decision-makers.

At a high level:

- low tier strategies are still cheap and broad
- medium tier strategies are still more structural or conditional
- high tier strategies are still meta and escalation-only

What changed is not the existence of the strategies, but their role:

- before: strategies competed directly for the final prediction
- now: strategies mostly contribute to engines, and engines compete for the final prediction

## Strategy Reference

The easiest way to understand the strategy catalog now is by engine family.

### `local_momentum_engine`

This engine is the continuation engine. It is strongest when the regime is directional and not yet exhausted.

Main member strategies:

- `s01` Momentum EWMA
- `s09` Spot Consensus Momentum
- `s12` Volatility Breakout
- `s17` Regime Switch

Interpretation:

- if this engine dominates, the model believes the move is real and still traveling
- if it is weak while breadth is strong, the system may still prefer propagation instead of local continuation

### `local_microstructure_engine`

This engine is the local pressure engine. It answers: “what is the token and spot microstructure saying right now?”

Main member strategies:

- `s02` Token Microprice
- `s03` Token Imbalance Band
- `s05` Order Book Churn
- `s07` Spread Compression
- `s10` Spot Micropressure
- `s13` Spot Slippage Skew

Interpretation:

- if this engine is strong and aligned with momentum, local continuation is healthier
- if this engine fights the global regime, the market may still be noisy or early

### `mispricing_engine`

This engine handles “the market price looks wrong” situations rather than pure continuation.

Main member strategies:

- `s06` No-Arb Consistency
- `s08` Barrier Timing
- `s14` Chainlink Basis
- `s15` Theoretical Probability Gap
- `s16` Freshness Gap

Interpretation:

- a strong mispricing engine means the edge is repricing, not trend-following
- these setups can still be valid when global breadth is weak or mixed

### `breadth_engine`

This is the structural market-wide direction engine. It is deliberately central in the new design.

Main member strategies:

- `s07` Spread Compression
- `s17` Regime Switch
- `s21` Cross-Asset Breadth Impulse

Interpretation:

- if this engine is dominant, the whole market is moving together
- this engine often drives `broad_continuation`
- when it is strong, isolated local contrarian calls should be treated skeptically

### `propagation_engine`

This is the leader/laggard engine. It tries to exploit the case where some assets have already moved and others are likely to follow.

Main member strategies:

- `s04` Wall Proximity
- `s16` Freshness Gap
- `s22` Leader-Laggard Catch-Up

Interpretation:

- if BTC and ETH are leading while SOL or XRP are lagging, this engine can become more important than the local engine
- this is one of the most important additions of the redesign

### `reversion_engine`

This engine handles “the continuation case is failing” logic.

Main member strategies:

- `s11` Spot Dispersion
- `s13` Spot Slippage Skew
- `s18` Liquidity Shock Fade

Interpretation:

- strong reversion while regime shows `reversal_risk` is meaningful
- strong reversion against `broad_up_strong` or `broad_down_strong` should usually be filtered out operationally

### `meta_engine`

This engine is not a primary directional engine. It stabilizes and conditions trust.

Main member strategies:

- `s19` Recent Performance Hedge
- `s20` Online Logistic Blend

Interpretation:

- use it as “how much should I trust the rest?”
- not as the first directional story by itself

### Full Strategy Reference by Id

The raw ids still map to these niches:

- `s01` Momentum EWMA: short local continuation
- `s02` Token Microprice: immediate token book pressure
- `s03` Token Imbalance Band: multi-level token depth skew
- `s04` Wall Proximity: liquidity barrier bias
- `s05` Order Book Churn: token-book rotation pressure
- `s06` No-Arb Consistency: internal UP/DOWN consistency check
- `s07` Spread Compression: liquidity improvement aligned with flow
- `s08` Barrier Timing: Chainlink versus barrier timing
- `s09` Spot Consensus Momentum: cross-venue spot drift
- `s10` Spot Micropressure: spot top-of-book skew
- `s11` Spot Dispersion: consensus versus noise
- `s12` Volatility Breakout: normalized local breakout
- `s13` Spot Slippage Skew: execution-friction slope
- `s14` Chainlink Basis: oracle catch-up / basis
- `s15` Theoretical Probability Gap: token-versus-barrier mispricing
- `s16` Freshness Gap: stale token versus fresher spot
- `s17` Regime Switch: adaptive continuation/fade
- `s18` Liquidity Shock Fade: short mean reversion
- `s19` Recent Performance Hedge: meta damping
- `s20` Online Logistic Blend: blended meta read
- `s21` Cross-Asset Breadth Impulse: synchronized market-wide flow
- `s22` Leader-Laggard Catch-Up: propagation into lagging assets

## Prediction Lifecycle

The new lifecycle is:

1. A token crosses `0.5`.
2. The trigger is held in a pending state.
3. The trigger must confirm after a delay:
   - still on the new side of `0.5`
   - sufficiently away from `0.5`
   - enough momentum
   - enough market quality
   - enough breadth confirmation
4. A `PredictionContext` is built.
5. The `regime engine` classifies the market-wide context.
6. The twenty-two strategies run through the tiered evaluation path.
7. Their outputs are grouped into engines.
8. Every engine gets a direction, score, confidence, state, and regime fit.
9. The combination engine evaluates plausible setup narratives.
10. One setup and one engine combo win.
11. The legacy strategy combo engine still computes its own combo gate.
12. A research prediction is stored with:
    - setup
    - regime
    - engine breakdown
    - winning engine combo
13. Execution evaluates whether that prediction is tradable.
14. If traded, the position resolves only on TP or SL.
15. Research metrics update from resolved predictions.
16. Execution metrics update only from executed trades.

## Execution Gate

Execution now operates on the winning setup, not just on a generic prediction score.

First, the generic operational filters still apply:

- live market required
- sufficient market quality
- minimum confidence
- reference token price available
- spread not too wide
- minimum order size
- market score / execution score good enough
- no open position already blocking the market

Then the setup-specific filters apply.

### `broad_continuation`

Requires:

- directional regime
- no excessive reversal risk
- no strong conflict with cross-asset direction

### `leader_laggard_catchup`

Requires:

- a clear leader
- laggard structure present
- meaningful lag ratio

### `local_breakout_confirmed`

Requires:

- local momentum still present
- local continuation not already dead

### `mispricing_repricing`

Requires:

- basis or repricing evidence still present

### `fade_failed_cross`

Requires:

- a regime where fade is not obviously suicidal
- no strong breadth continuation still in force

The legacy strategy combo gate still sits on top of all this as an extra safety filter.

This means a prediction can be blocked for three very different reasons:

- the regime does not support the setup
- the market does not support execution
- the legacy strategy combo gate still does not trust it

## Dashboard Semantics

The dashboard is now meant to answer six operational questions:

1. What is the global market context?
2. Which markets are structurally interesting?
3. Which setup is winning on each market?
4. Which engines are driving that setup?
5. Why is execution still blocked?
6. Is the discovery layer actually learning useful combinations?

### `Global Regime`

This is the starting panel.

Read it first when the system feels wrong.

It shows:

- regime name
- breadth label
- participation
- synchrony
- leader group
- laggard group
- acceleration
- reversal risk

Interpretation:

- `Broad Up Strong` or `Broad Down Strong`
  Continuation setups should dominate. Contrarian local calls should be rare and heavily filtered.

- `Leader/Laggard Up` or `Leader/Laggard Down`
  Catch-up setups are the most interesting. Look at laggards, not just leaders.

- `Fragmented`
  The assets are not telling one coherent story. You should expect fewer executable trades.

- `Reversal Risk`
  A broad move may still exist, but continuation is getting stretched. Reversion and fade logic matter more.

### `Markets`

This is the compact market map.

It shows:

- token midpoints
- cooldown
- market score
- regime
- dominant setup
- quality

How to use it:

- high quality + directional regime + meaningful setup
  worth looking at

- low quality
  ignore almost everything downstream

- setup is `—`
  no recent resolved narrative yet for that market

- cooldown is high
  the engine recently emitted a prediction and cannot re-emit immediately

### `Execution Now`

This is the real go/no-go panel.

It shows:

- action
- winning setup
- winning engine combo
- market scores
- regime
- market score / trade count
- combo gate status
- conviction
- reason codes

How to interpret it:

- `NO TRADE` with a good-looking setup is normal if execution trust is still low
- `combo gate BLOCK` means the old strategy-combo layer still vetoed the trade
- `SDR`, `SRV`, `SLG`, `SLD`, `SMO`, `SBS`, `SFD`
  are setup-specific blocks:
  - `SDR`: setup needs directional regime
  - `SRV`: reversal risk too high
  - `SLG`: no laggard structure
  - `SLD`: no clear leader
  - `SMO`: local momentum too weak
  - `SBS`: repricing evidence missing
  - `SFD`: fade conflicts with strong breadth

This panel tells you whether the system is not trading because:

- it dislikes the market
- it dislikes the setup
- or the legacy combo gate still does not trust the idea

### `Winning Combination`

This is the best short explanation of the new prediction mechanism.

For each recent idea it shows:

- market
- setup
- engine combo
- combo score
- confidence
- regime
- narrative reason

Read this panel when you want to know:

- which mechanism is actually producing ideas
- whether the system is overusing one setup
- whether breadth is central or still underused

If this panel is dominated by:

- `breadth_engine+propagation_engine+local_momentum_engine`
  the system is leaning into market-wide propagation

- `mispricing_engine+meta_engine`
  the system is seeing repricing rather than continuation

- `reversion_engine+...`
  the market may be stretched or noisy

### `Resolved Predictions`

This is not the same as execution performance.

It shows resolved research ideas, including:

- direction
- confidence
- trigger
- winning setup
- winning engine combo
- final result

Use it to judge:

- whether a setup is directionally useful at all
- whether a given engine combo is repeatedly wrong

Do not confuse it with actual execution PnL.

The correct reading is:

- `Resolved Predictions` = research quality
- `Recent Trades` + `Market PnL` = execution quality

### `Engine Board`

This is the most important panel for understanding why the model thinks what it thinks.

For the selected market it shows:

- engine
- state
- direction
- score
- confidence
- regime fit
- role / setup

How to read it:

- `dominant`
  this engine is driving the market narrative

- `active`
  meaningful support, but not primary

- `weak`
  present, but not strong enough to dominate

- `avoid`
  the current regime says this engine should not be trusted now

The real question to ask here is not “which strategy is best?” but:

- are the active engines diverse?
- are they all saying the same thing?
- does the dominant engine make sense given the regime?

### `Market PnL`

This is still the market-level execution scorecard.

Use it to separate:

- markets that produce interesting research ideas
- from markets that are actually earning execution trust

If a market has:

- decent research score
- poor execution score

that usually means the ideas are interesting but operationally messy.

### `Discovery Board`

This is the compact learning panel for the new mechanism.

It groups recent resolved predictions by:

- setup type
- engine combo

and shows:

- hit rate
- average confidence
- sample count
- markets where that combo recently appeared

This panel answers:

- is the engine-combination layer learning anything yet?
- are some setups overrepresented but weak?
- are some combos good on one market family only?

### `Recent Trades`

Closed executed trades only.

Use it to confirm:

- the system is actually trading
- exits are happening through TP/SL as expected
- maker/taker mix looks sane

### `Open Positions`

Current live or paper positions still open.

Use it to understand:

- current exposure
- where TP and SL are
- whether you are already committed on a market that looks interesting again

### `Health`

Use this panel before trusting any other panel.

If the dashboard looks strange, check:

- snapshot freshness
- runtime health
- execution mode
- balance status
- maker/taker usage

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
