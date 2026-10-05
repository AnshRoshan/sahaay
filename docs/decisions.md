# Architecture Decision Records

## ADR-001 — PostgreSQL (JSONB) instead of MongoDB
**Context:** The product spec names MongoDB for operational + decision memory. The build platform provides PostgreSQL via Drizzle.
**Decision:** Use PostgreSQL. Document-shaped data (evidence, lifecycle, spans, calculations, research) is stored as JSONB; relational data (sales, inventory) benefits from SQL aggregates.
**Consequences:** Same decision-memory semantics. A MongoDB Atlas adapter is a future task; the read/write surface is concentrated in `src/lib/server/*`, so it is replaceable.

## ADR-002 — Pure core / impure shell
**Decision:** All forecasting, risk, guard, validation, recommendation and grounding logic is pure (`src/lib/*.ts`).
**Why:** Testability, live evaluation, determinism, and the principle "the model explains; the system calculates".

## ADR-003 — LLM output is untrusted
**Decision:** Gemma only rephrases facts. `checkGrounding` rejects any number not present in the facts; fallback is a deterministic template; the rejection is recorded in the trace.
**Why:** Prevents invented figures — the core failure mode of business chatbots.

## ADR-004 — Built-in forecast engine + TabPFN adapter
**Decision:** Ship a transparent statistical ensemble that is backtested against a naive baseline, and use TabPFN (pooled tabular regression with quantiles) when `TABPFN_URL` is set, with automatic fallback.
**Why:** The app must work and be honest without a GPU service; TabPFN improves uncertainty when available. TabPFN features/training rows are strictly past-only to avoid leakage.

## ADR-005 — Abstention is a feature
**Decision:** Missing lead time/supplier/stock produce an ABSTAIN recommendation with *no quantity*; negative stock → DATA_ERROR; conflicts → pessimistic values + FLAG_CONFLICT; thin history → LOW_CONFIDENCE.
**Why:** Trust. Tests S1–S5, S11 enforce it.

## ADR-006 — Human approval required; Sahaay never acts externally
**Decision:** Approval creates a record and an order *draft*. No supplier contact, no payments.
**Why:** Spec principle + the friend's likely answer to "what would you never allow automatically?" (verify in interview).

## ADR-007 — Durable workflows: in-app runner + Temporal worker
**Decision:** Persisted-step runner with retries and `/api/cron/tick` keeps the product functional anywhere; `services/worker` provides real Temporal schedules whose activities call the same endpoints.
**Why:** Avoids making a Temporal cluster a hard dependency for a small shop, while keeping the production path.

## ADR-008 — Sentry via envelope API + in-app traces
**Decision:** No SDK dependency; spans are stored in `agent_runs` and shown in the UI; errors are POSTed to Sentry when `SENTRY_DSN` is set.
**Why:** Visible traces for demos and zero build risk. Replace with `@sentry/nextjs` for performance monitoring/source maps when deploying seriously.

## ADR-009 — Preference learning is deterministic and transparent
**Decision:** Patterns (order-size ratio, reason themes, forecast bias) are mined by code, displayed to the owner, and only add *alternatives* — they never silently change the recommended quantity.
**Why:** Learning should be inspectable and reversible.

## ADR-010 — Primary supplier = fastest delivery
**Decision:** Until real order history exists, the "current" supplier is the one with the shortest lead time (ties → cheaper), restricted to allowed suppliers.
**Why:** Stockout risk is lead-time driven. Flagged as an open question for the friend.

## ADR-011 — "As-of date" instead of wall-clock today
**Decision:** All time logic uses the latest sale date.
**Why:** Works with historical uploads and makes the simulated time-machine coherent.

## ADR-012 — Duplicates are reported, not removed (without transaction IDs)
**Decision:** Identical sales rows are normal in retail; they're kept and reported as info. With a transaction-ID column, repeats are warnings.
**Why:** Silently dropping data would understate demand; silently keeping duplicates must be disclosed.

## ADR-013 — Inventory is an append-only event ledger, not a mutable quantity
**Decision:** `ledger_events` is insert-only. A `stock_count` sets an absolute baseline; `sale` / `receipt` / `adjustment` / `return` apply as signed deltas. Current stock is `reduceEvents` folding them in `(at, id)` order. There is no update or delete path, and a duplicate event id is rejected. The `inventory` table remains a projection that imports and the demo time-machine keep in sync.
**Why:** A single mutable `current_stock` column cannot answer "why is this 33?", and any writer — including a model — can silently destroy a correction. Making the log the source of truth means the *history of why* survives, and the owner's real-world corrections become first-class data instead of manual edits.
**Cost:** An extra table and a fold on every read. Accepted — the fold is trivial at shop scale, and the ledger doubles as the capture/provenance layer.
**Rejected:** Optimistic-locking a mutable column (still no provenance); letting the LLM write state with a confirmation step (confirmation is UI-level, not a database guarantee).

## ADR-014 — Stockout risk is measured only after the delivery window
**Decision:** The simulator's `stockoutRisk` counts days on which stock ran out *after* a new order landed. Units lost during the lead time are reported separately as `expectedPreDeliveryLostUnits`, and are labelled as a function of stock already held.
**Why:** Ordered units cannot arrive in time to prevent a shortage during the lead time. Including those days reported 100% risk for every candidate quantity, which made the column useless for the decision it exists to inform. Found by inspecting real output, not by reasoning ahead of time.
**Cost:** Two columns instead of one, and a risk figure that is narrower than "will I stock out". The narrower claim is the defensible one, and the method string in the UI states the window explicitly.

## ADR-015 — Capture parsing is deterministic rules, not a model call
**Decision:** `parseCapture` is pure regex/keyword logic (Hindi/Urdu + English number words, product-name matching, intent verbs). Gemma is not used to parse, and no dependency was added.
**Why:** The numbers here become business facts. A model parse would make every captured quantity probabilistic at exactly the moment we claim it is CONFIRMED, and it could not be exhaustively unit-tested. Rules keep the claim labels meaningful and the tests sharp; a model path can be added later behind the existing grounding gate.
**Trade-off, stated plainly:** coverage is narrower than an LLM would be. Unknown vocabulary falls through to `unresolved` and is shown to the owner rather than guessed at. This is a deliberate accuracy-over-recall choice for the one place where the system writes to the ledger.

## ADR-016 — A quantity must sit next to its product to count
**Decision:** `quantityNearProduct` accepts a number as a quantity only when it is adjacent to a product name or packaging word ("20 carton basmati", "teen basmati aaya"). Elsewhere ("size 32", "3 colours") it is ignored and the line is reported MISSING.
**Why:** The first parser took the first number in the clause, so "size 32 jeans" would have recorded a 32-unit movement — inventing inventory from a size. In a system whose differentiator is trustworthy capture, a wrong-but-plausible write is the worst possible failure.
