# CONTEXT.md — Sahaay product & engineering context

## One-paragraph summary
Sahaay is an AI operational decision engine for a small garment/retail business. It converts messy CSV data into **ranked, explainable, rule-validated decisions** (mainly: what to reorder, what is overstocked, which supplier is cheaper), asks the owner to approve/modify/reject, records the decision and reason as **decision memory**, and later **measures the outcome** to improve future advice.

## The user
One real person: a friend who runs a small shop. Pain: frequent stockouts of popular items, over-ordering slow items, manual supplier price checks, spreadsheets and memory instead of analysis. Wants *simple recommendations*, not analytics. Requirements come from the interview in `docs/friend-interview.md` — **update product behaviour from those answers**.

## Core loop
`Capture → Verify → Understand → Predict → Simulate → Explain → Approve → Act → Monitor → Learn`

Lifecycle states (visible in UI): DETECTED → ANALYZED → RECOMMENDED → SIMULATED → VALIDATED → PENDING_APPROVAL → APPROVED/MODIFIED/REJECTED → EXECUTED → MONITORED → OUTCOME_RECORDED (or EXPIRED).

## Business truth is an event log
The current stock level is **never written directly**. `ledger_events` is append-only; a
`stock_count` sets an absolute baseline and `sale`/`receipt`/`adjustment`/`return` apply as signed
deltas. `reduceEvents` folds them in `(at, id)` order. A correction is another event, so
"why is stock 33?" is always answerable, and no model can rewrite it.

## Claims carry a status
Every extracted fact is labelled **CONFIRMED** (source of record or owner-confirmed), **INFERRED**
(computed), **MISSING** (absent) or **CONFLICTING** (sources disagree). A capture line with MISSING
or CONFLICTING is refused rather than completed with a guess.

## Glossary
- **As-of date**: latest sale date in data. All "today" logic uses it, so uploaded history works and the demo time-machine can advance it.
- **Prediction vs recommendation**: forecast says what's likely; the decision engine says what to do. Different modules.
- **Stockout risk**: P(demand during supplier lead time > on-hand + inbound) via normal approximation (`src/lib/risk.ts`).
- **Order quantity**: `max(MOQ, ceil(rate×(lead+review) + buffer − stock))` — MOQ is a floor, buffer is `safetyBufferPct`.
- **Primary supplier**: fastest delivery (ties → cheaper), restricted to allowed suppliers. Documented assumption until real order history exists.
- **Guard verdicts**: OK, LOW_CONFIDENCE, FLAG_CONFLICT, ABSTAIN, DATA_ERROR.
- **Validation status**: pass / warn (needs explicit confirm) / block (cannot proceed).
- **Evidence**: `{source, label, value, explanation, timestamp}`; sources: sales, inventory, forecast, supplier, rules, memory, web (extended from spec's five).
- **Decision memory**: `recommendations` + `decisions` + `outcomes` + `preferences` tables.
- **Decision simulator**: 400 seeded futures per candidate quantity. Reports post-delivery
  stockout risk, overstock risk, unmet demand, pre-delivery loss, leftover, cash committed, net
  cash. Seeded per product → reproducible. Limitations are stored and shown, not hidden.
- **Preference learning**: deterministic pattern mining (order-size ratio, reason themes, forecast bias) — no LLM, always shown to the user, never silently applied; it only adds *alternatives*.
- **Demo time-machine**: simulation tool that advances the clock with forecast-driven synthetic sales so the outcome loop is demonstrable. Labelled SIMULATION. Never for real data.

## Technology substitutions & fallbacks (be honest)
- MongoDB → PostgreSQL JSONB (platform constraint). Rationale in `docs/decisions.md` ADR-001.
- TabPFN / Gemma / Temporal / SerpApi / ElevenLabs / Sentry: adapters exist; each has a defined, visible fallback when not configured. Status is shown on **Rules & settings** and **Architecture**.

## Current state
See `docs/FEATURES.md` (what exists) and `docs/TASKS.md` (what's done / next). The hackathon cut line (CSV → inventory → forecast → risk → recommendation → evidence → approval → history) and all nice-to-haves are implemented; external integrations need credentials to go live.

## Data conventions
- Dates `YYYY-MM-DD` or day-first `DD/MM/YYYY`; unparseable → rejected + reported.
- Money in INR (₹) displayed with Indian grouping.
- Each CSV upload of a type **replaces** that table (full-export semantics), products upsert.
- Sales rows identical to another row are *kept* (normal retail) and reported as info; use `transaction_id` for exact dedupe warnings.

## Open questions (resolve with the friend)
1. Which supplier does he actually use by default? (replace "fastest" assumption)
2. His real max order / cash limit / storage capacity.
3. Preferred briefing time and channel (WhatsApp vs app vs voice).
4. How does he want to confirm an order was placed?
