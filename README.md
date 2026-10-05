# Sahaay — your business's decision engine

> **Know what needs attention. Know why. Decide with confidence.**

Sahaay is an open-source-first AI **operational decision engine** built around one real small-business owner (a friend who runs a garment/retail shop). It is **not a chatbot**. It reads sales, inventory and supplier data, predicts demand, finds operational risks, produces **explainable, rule-validated recommendations**, lets the owner **approve / modify / reject**, then **measures what actually happened** so future advice improves.

```
Capture → Verify → Understand → Predict → Simulate → Explain → Approve → Act → Monitor → Learn
```
**AI proposes → deterministic systems verify → human approves → system acts → outcome is measured → future recommendations improve.**

Three ideas carry most of the weight:

1. **Business truth is an event log, not a number.** Stock is never written directly. `ledger_events`
   is append-only and the current quantity is a deterministic fold over those events, so the reason a
   number is what it is is always reconstructable — and a model can propose an event but can never
   rewrite one.
2. **Every claim says how much it can be trusted.** CONFIRMED (a recorded fact), INFERRED (computed),
   MISSING, or CONFLICTING (sources disagree). Capture refuses to complete a line it could only guess at.
3. **A decision is simulated, not asserted.** 400 seeded futures per candidate quantity, so
   "if I order 10, 20 or 30" is answered with stockout risk, overstock risk and cash side by side —
   with the model's limitations stated rather than hidden.

## Quick start
```bash
npm install
cp .env.example .env            # DATABASE_URL is the only required value
npx drizzle-kit push            # create tables
npm run dev                     # http://localhost:3000
```
Open the app → **Load demo shop** (a realistic garment store with deliberately messy data), or upload your own CSVs on **Import data**.

Tests: `npx tsx --test tests/**/*.test.ts` (safety, grounding, math, forecasting, event ledger, capture parser, simulator). The same safety cases run live on the **Architecture** page.

## What's in the box
| Screen | Purpose |
|---|---|
| **Overview** | "What needs my attention?" — top decisions, voice briefing, north-star metrics, learned preferences, demo time-machine |
| **Decisions** / detail | Every recommendation: evidence drawer with claim labels, lifecycle, deterministic calculation, **simulated-futures comparison table**, safety checks, risks, alternatives, approve/modify/reject, order draft, research, Ask-why |
| **Import data** | Drag-drop CSVs, column detection, row validation, data-quality report |
| **Capture** | Type or speak what happened ("Kal 30 blue shirt aaya") → labelled claims → you confirm → immutable events |
| **Event ledger** | Append-only movements, derived quantity per product, balance trail, conflicts |
| **Inventory** | SAFE / WATCH / HIGH / CRITICAL (+ ABSTAIN / DATA ERROR) with stockout probability |
| **Forecasts** | 7-day ranges + confidence + backtest MAE/RMSE vs naive baseline |
| **Suppliers** | Internal supplier comparison and savings opportunities |
| **Decision history** | Recommended vs human decision vs outcome; learned preferences |
| **Ask Sahaay** | Investigation layer (text + voice input) with traces |
| **Workflows** | Weekly review, morning briefing, monthly slow-movers, outcome checks |
| **Rules & settings** | max order, cash limit, margin, capacity, allowed suppliers; integration status |
| **Architecture & traces** | Pipeline, why each technology exists, live safety test results, agent traces |

## Technology roles — and honest status
| Tech | Role | Status in this repo |
|---|---|---|
| **Gemma** (open model) | Phrases explanations/answers; intent fallback | 🔌 Client for any OpenAI-compatible server (Ollama etc.). Without `GEMMA_BASE_URL`, deterministic templates are used. Output is blocked if it contains an ungrounded number. |
| **TabPFN** | Structured demand prediction with quantiles | 🔌 `services/tabpfn` FastAPI service + Node client with automatic fallback. Without `TABPFN_URL`, a built-in statistical ensemble runs (beats naive baseline in backtest). |
| **PostgreSQL** (spec said MongoDB) | Operational data + decision memory (JSONB documents) | ✅ Live. See `docs/decisions.md` ADR-001. |
| **Temporal** | Durable workflows | 🔌 `services/worker` (workflows, activities, schedules). In-app durable runner + `/api/cron/tick` works without it. |
| **Sentry** | Observability | ✅ In-app span traces always on; 🔌 errors forwarded to Sentry when `SENTRY_DSN` set (dependency-free envelope client). |
| **SerpApi** | External research, kept separate from internal data | 🔌 Live with `SERPAPI_KEY`; otherwise clearly-labelled **SIMULATED** candidates. |
| **ElevenLabs** | Optional voice | 🔌 Server TTS with key; otherwise browser speech synthesis. |
| **Render** | Deployment | ✅ `render.yaml` blueprint (web + Postgres + cron). |

Legend: ✅ implemented and exercised here · 🔌 adapter implemented, needs external service/credentials (not verified live in the build sandbox).

## Safety principles
- The LLM never calculates, forecasts, simulates, decides permissions, or executes.
- Every quantity (engine **and** human edit) passes `validateOrder`: max order, MOQ, cash limit, capacity, margin, allowed supplier, plausibility.
- Inventory is derived from an append-only event log; there is no update or delete path, and a duplicate event id is rejected so nothing can be applied twice.
- Capture **proposes**; the owner **confirms**. A line with a missing quantity is refused rather than completed with a guess, and unmatched text is shown back to you instead of dropped.
- Sahaay **abstains** (missing lead time / supplier / stock), flags **data errors** (negative stock), flags **conflicts**, and lowers confidence on thin history.
- Sahaay never contacts suppliers or spends money; it drafts a message for you to send.
- Simulation figures are labelled as a model with its limitations listed, not presented as predictions of fact.
- Web research sends only a product name; results are labelled EXTERNAL and never merged into internal evidence.

## Docs
- [`AGENTS.md`](AGENTS.md) — instructions for AI coding agents working on this repo
- [`CONTEXT.md`](CONTEXT.md) — product + engineering context, glossary, invariants
- [`docs/FEATURES.md`](docs/FEATURES.md) — complete feature list with status
- [`docs/TASKS.md`](docs/TASKS.md) — task tracker by phase
- [`docs/architecture.md`](docs/architecture.md) · [`docs/decisions.md`](docs/decisions.md) · [`docs/evaluation.md`](docs/evaluation.md) · [`docs/security.md`](docs/security.md) · [`docs/api.md`](docs/api.md)
- [`docs/friend-interview.md`](docs/friend-interview.md) · [`docs/demo-script.md`](docs/demo-script.md) · [`docs/article-outline.md`](docs/article-outline.md)

## Why open source
Small businesses should be able to own and inspect the intelligence layer that influences their decisions: swap the model, run it locally, read every rule, and keep data on their own machine.
