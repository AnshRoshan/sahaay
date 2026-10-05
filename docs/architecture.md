# Architecture

```
Next.js UI (server components + small client islands)
        │
        ▼
API routes  ── handle(): auth → try/catch → Sentry
        │
        ▼
Capture ──► Verify ──► Understand ──► Predict ──► Simulate ──► Explain ──► Approve ──► Act ──► Monitor ──► Learn
   │           │            │            │          │            │          │          │        │           │
   │           │            │            │          │            │          │          │        │           └─ outcomes.ts → preferences
   │           │            │            │          │            │          │          │        └─ simulateDays writes ledger events
   │           │            │            │          │            │          │          └─ decisions + order draft
   │           │            │            │          │            │          └─ DecisionPanel (validate, approve, modify, reject)
   │           │            │            │          │            └─ explain.ts (templates) + llm.ts (Gemma) + grounding.ts (gate)
   │           │            │            │          └─ simulate.ts: N futures × candidate quantities
   │           │            │            └─ forecast-core.ts (pure) + forecast-service.ts (TabPFN client, fallback)
   │           │            └─ ledger.ts (pure): reduceEvents over ledger_events
   │           └─ capture.ts (pure parser) → claims → human confirm → ledger.ts (server: append only)
   └─ csv.ts → ingest.ts → quality report; inventory export becomes a stock_count event

Orchestrator (agent.ts) / Engine (engine.ts) / Workflows (workflows.ts)
   ├─ Ingestion      csv.ts → ingest.ts → quality report → count baseline event
   ├─ Capture        capture.ts (pure) + server/capture.ts (propose → confirm → append)
   ├─ Event ledger   ledger.ts (pure reducer/conflicts) + server/ledger.ts (append-only writes)
   ├─ Forecasting    forecast-core.ts (pure) + forecast-service.ts (TabPFN client, fallback)
   ├─ Risk           risk.ts (pure)
   ├─ Simulation     simulate.ts (pure, seeded Monte Carlo)
   ├─ Guards         guards.ts (pure): ABSTAIN / DATA_ERROR / FLAG_CONFLICT / LOW_CONFIDENCE
   ├─ Recommendation analysis.ts (pure): signals, evidence, calculation, alternatives, simulation
   ├─ Validation     validation.ts (pure): block / warn / pass
   ├─ Explanation    explain.ts (templates) + llm.ts (Gemma) + grounding.ts (gate)
   ├─ Research       research.ts (SerpApi; external only)
   ├─ Memory         memory.ts (decide, learn) + outcomes.ts (measure)
   └─ Observability  observability.ts (spans → agent_runs, Sentry envelope)
        │
        ▼
PostgreSQL (Drizzle; JSONB documents)
```

## Why an event ledger

Business quantities are **never written directly**. `ledger_events` is append-only: a
`stock_count` sets an absolute baseline, and `sale` / `receipt` / `adjustment` / `return` apply
as signed deltas. `reduceEvents` folds them in `(at, id)` order to produce the current quantity,
so the answer to "why is stock 33?" is always reconstructable. A correction is *another* event,
which is why there is no update or delete path in `server/ledger.ts` — only `appendEvents`, which
also refuses a duplicate id so a double-apply is impossible.

Consequences that matter:

- **The model cannot rewrite business reality.** It can only propose an event, and only after the
  owner confirms it.
- **Provenance is first-class.** An inventory CSV is a snapshot, so it becomes a `stock_count`
  event dated at the latest sale date (never later — a future-dated baseline would outrank real
  movements and silently discard them).
- **Disagreements stay disagreements.** Two sources reporting the same movement differently produce
  a `LedgerConflict`; both are kept and the owner is asked.

## Why claims are labelled

Every extracted fact carries a status: **CONFIRMED** (a source of record or the owner's own
confirmation), **INFERRED** (computed or worked out), **MISSING** (absent), **CONFLICTING**
(sources disagree; the pessimistic value is used). This is enforced in `ledger.validateClaim` and
layered with capture-specific detail in `capture.parseCapture`. A line with a MISSING or
CONFLICTING claim cannot be written: `confirmCapture` refuses it rather than filling in a guess.

## Why simulate instead of predicting once

A single stockout probability hides the trade-off. `simulate.ts` runs `SIM_RUNS` (400) futures per
candidate quantity and reports post-delivery stockout risk, overstock risk, unmet demand, leftover
stock, cash committed and net cash. Two deliberate honesty rules:

- The order is credited **once**, on the day it arrives after the lead time.
- Stockout risk counts only days **after** delivery, because that is the period the order size
  controls. Shortages during the lead time are reported separately as
  `expectedPreDeliveryLostUnits` — no order quantity can undo a stock level that is already low.

The simulator is seeded per product, so the table is reproducible and testable. Its limitations are
stored with it and rendered in the UI rather than hidden.

## Data flow: "Should I order Blue Shirt M?"
1. `user.request` span → load context.
2. Intent `reorder_advice`; product resolved by fuzzy name match (`findProduct`).
3. Tool: read the pending recommendation produced by the last analysis (forecast → risk → quantity → validation all computed by code).
4. Facts text assembled; Gemma (if configured) rephrases; `checkGrounding` rejects any unseen number; else template.
5. Response with cards, trace; run stored in `agent_runs`.

## Data flow: analysis run
`loadInputs` (sales → daily series per product, inventory, offers, memory, inbound, ledger-derived stock) → `forecastAll` → `analyzeProduct` per product (+ `supplierOpportunities`) → `persistRecs` (update matching pending by `dedupeKey`, insert new, expire stale) → forecasts/signals snapshots saved.

## Data flow: capture a spoken update
`POST /api/capture` → `parseCapture` (pure: intent, date, product match, quantity, per-field claim labels) → owner reviews the proposed lines → `confirmCapture` (refuses any MISSING/CONFLICTING line, applies corrections) → `appendEvents` → the fold in `reduceEvents` changes the derived quantity → analysis picks it up on the next run.

## Data flow: "should I order 30 or 50?"
Deterministic quantity (`computeOrderQuantity`) → `simulateDecision` over the candidate set → each row re-validated by `validateOrder` → stored on the recommendation as `simulation` → rendered as a comparison table → the owner edits the quantity and the same validation gate applies as for any other order.

## Why a pure core?
`src/lib/*.ts` has no DB/network imports so the same code is: unit-tested, executed live by `/api/evaluation`, and reusable in a worker or CLI.

## Tables
products, suppliers, supplier_offers, sales, inventory, imports, data_quality_issues · **ledger_events** (append-only), **captures** (raw owner messages + parse result) · forecasts, signals, recommendations · decisions, outcomes, preferences, business_rules · workflow_runs, workflow_schedules, agent_runs.

## Deployment
Render web service (build runs `npm ci && next build`; migrations are applied separately with `npx drizzle-kit migrate`, never from the build container), Render Postgres (paid plan — the free plan is deleted 30 days after creation), Render Cron hitting `POST /api/cron/tick` with the `CRON_SECRET` bearer token. Optional: Gemma (Ollama/vLLM) and TabPFN (`services/tabpfn`) as private services.
