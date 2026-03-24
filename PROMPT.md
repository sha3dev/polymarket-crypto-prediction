# Sequential LLM Workflow

This repository is prepared for the `init` workflow.
Do not paste this whole file into the LLM.
Use it as the operator checklist and send only the current phase prompt plus the minimum required context for that phase.

## Execution Order

1. Complete the request section in this file.
2. Start with `prompts/init.prompt.md` and stop after that phase output.
3. Continue with `prompts/init-phase-2-implement.md` only after phase 1 is complete.
4. Finish with `prompts/init-phase-3-verify.md` to validate, close gaps, and prepare the final response.
5. Load optional skills only when their trigger condition actually applies.

## Always True

- You MUST implement the task without editing managed files unless this is a standards update.
- Managed files are ignored by Biome by default; do not remove those ignores during normal feature work.
- `single-return` stays strict outside `src/http/**`; in HTTP transport files, early returns are allowed when they keep validation and response flow clearer.
- You MUST execute `npm run check` yourself before finishing.
- If `npm run check` fails, you MUST fix the issues and rerun it until it passes.
- As the final step, you MUST create or update `SCAFFOLD-FEEDBACK.md` in the project root with concrete feedback on scaffold issues, ambiguities, friction, and improvements.

## Phase Files

- `prompts/init.prompt.md`
- `prompts/init-phase-2-implement.md`
- `prompts/init-phase-3-verify.md`

## Phase 1 Entry Prompt

This is phase 1 of the init workflow. Do not implement yet.

Read only the minimum context needed to produce an execution plan:

- `PROMPT.md`
- `AGENTS.md`
- `ai/contract.json`
- `ai/rules.md`
- `skills/init-workflow/SKILL.md`
- `skills/feature-shaping/SKILL.md`
- `skills/simplicity-audit/SKILL.md`
- `skills/change-synchronization/SKILL.md`
- the assistant-specific adapter in `ai/`, if present

Load optional skills only if the request in `PROMPT.md` triggers them:

- `skills/test-scope-selection/SKILL.md` for meaningful behavior changes
- `skills/readme-authoring/SKILL.md` when `README.md` must change
- `skills/http-api-conventions/SKILL.md` for `node-service` projects or HTTP endpoint work

Return only:

1. A compact implementation plan with the minimum files that need inspection next.
2. Open questions or assumptions that could change the design.
3. A short list named `Phase 2 reads` with only the files the LLM should load for implementation.

Do not edit files, do not run verification, and do not restate the full contract.
Phase 2 continues in `prompts/init-phase-2-implement.md`.

## Implementation Request

Complete this section before starting phase 1.
Describe the behavior you want to implement, the expected public API, runtime constraints, and any explicit non-goals.

### Task:

Crear un servicio Node.js (ESM, Node 20+) que monitorice en tiempo real todos los mercados “Up/Down” de 5m y 15m de BTC, ETH, SOL y XRP usando un único SnapshotService. El servicio no debe lanzar predicciones cada 30s de forma periódica, sino cuando detecte un evento de cruce por la zona de 0.5 en cualquiera de los tokens UP o DOWN de un mercado.

Se considerará evento válido de predicción cuando:

el precio de UP o DOWN sea 0.5 o muy cercano a 0.5, o
el precio cruce esa zona entre dos snapshots consecutivos, por ejemplo pasando de 0.49 a 0.51, o de 0.4 a 0.5.

En ese momento, el sistema deberá ejecutar las estrategias y generar una predicción a horizonte de 30s (UP o DOWN) junto con una confidence entre 0 y 1.

Para evitar sobre-disparar predicciones, el sistema debe aplicar un cooldown mínimo de 5 segundos por mercado (asset + window), de forma que entre dos predicciones consecutivas del mismo mercado deban pasar al menos 5 segundos, aunque se detecten múltiples cruces o permanencias alrededor de 0.5.

Además, el servicio debe mantener memoria rolling del histórico reciente, evaluar el rendimiento de cada estrategia en una ventana móvil, ajustar pesos dinámicamente según su comportamiento reciente, y exponer un dashboard web donde se visualicen predicciones, resultados reales, ranking de estrategias, evolución de pesos, calidad de datos y rendimiento agregado del ensemble.

El dashboard debe tener un estilo moderno, compacto y muy visual, pensado para que la mayor cantidad posible de información relevante sea visible de un solo vistazo en una única pantalla, sin necesidad de navegar entre múltiples vistas. Debe priorizar densidad de información, jerarquía visual clara y actualización en tiempo real. Se pueden usar tooltips, iconos de ayuda o microinteracciones para explicar métricas, campos, scores, pesos y cualquier otro dato técnico sin recargar visualmente la pantalla principal.

El servicio debe implementar las estrategias definidas en STRATEGIES.md

### Public API:

Definir rutas RESTful que incluyan al menos:

GET /v1/predict?asset={btc|eth|sol|xrp}&window={5m|15m} – devuelve la última predicción disponible para ese mercado, incluyendo direction, confidence, timestamp, trigger que la originó y desglose de estrategias.
GET /v1/predictions?asset={btc|eth|sol|xrp}&window={5m|15m}&limit=N – devuelve el historial reciente de predicciones generadas para ese mercado, indicando cuáles acertaron y cuáles fallaron.
GET /v1/strategies – lista las estrategias disponibles con sus pesos actuales, tier de coste, métricas de rendimiento rolling y estado.
GET /v1/markets – resumen del estado actual de todos los mercados monitorizados, incluyendo último precio UP/DOWN, proximidad a 0.5, última predicción y cooldown restante.
GET /v1/healthz – reporta estado del servicio, edad del último snapshot y salud general de la ingesta.

Opcionalmente, el sistema puede incluir:

GET /v1/dashboard/summary
WS /ws o SSE /v1/stream

para alimentar el dashboard en tiempo real sin polling intensivo.

El dashboard front-end debe consumir estos endpoints y presentar la información principal en una única vista principal, con diseño responsive de escritorio, paneles compactos, tablas densas, indicadores visuales claros y tooltips contextuales para definir cada campo o métrica sin sacrificar simplicidad visual.

### Runtime constraints:

Servicio Node.js (v20+) en formato ESM.
Usar @sha3/polymarket-snapshot como única fuente de datos de mercado en tiempo real.
Mantener en memoria buffers rolling por (asset, window) con varios minutos de snapshots recientes para cálculo de features, triggers, evaluación y scoring.
El motor debe detectar cruces o proximidad a 0.5 comparando snapshots consecutivos y aplicando una tolerancia configurable, por ejemplo cross_threshold = 0.02.
Debe existir un cooldown mínimo de 5 segundos por mercado entre predicciones consecutivas.
Las estrategias deben organizarse por niveles de coste (low, medium, high): primero se ejecutan las baratas; si el resultado sigue siendo ambiguo o insuficiente, se escalan las de coste medio; y solo en último caso las caras.
El sistema debe mantener métricas rolling y pesos adaptativos basados en rendimiento reciente, sin depender de memoria histórica infinita.
La evaluación debe resolverse automáticamente 30s después de cada predicción, comparando el estado real observado frente al predicho.
Debe priorizarse baja latencia, tolerancia a snapshots incompletos y simplicidad operativa.

### Non-goals:
No implementar trading real, envío de órdenes ni integración con wallets o contratos.
No usar otras fuentes de datos distintas de polymarket-snapshot para esta primera versión.
No convertir esta versión en un sistema de entrenamiento ML pesado u offline; el foco es evaluación online de estrategias ya definidas.
No almacenar histórico infinito ni construir una plataforma de backtesting completa.
No soportar mercados distintos de BTC, ETH, SOL y XRP en ventanas de 5m y 15m.
No reimplementar en esta sección el detalle interno de las 20 estrategias, ya descritas en el documento anterior.