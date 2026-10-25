# Feature list & status

Legend: ✅ implemented and exercised in the build sandbox · 🔌 adapter implemented; needs external service/credentials to go live (fallback active meanwhile) · 🔄 deliberate substitution · 🔭 future (not built, by design)

## A. Data foundation
| # | Feature | Status | Where |
|---|---|---|---|
| A1 | CSV upload (drag & drop, multi-file, auto-detect file type) | ✅ | `components/UploadForm`, `api/import`, `server/ingest` |
| A2 | Column detection with aliases (sku, qty, units, stock…) | ✅ | `ingest.ts` ALIASES |
| A3 | Row validation: invalid date / quantity / price / ids rejected & reported | ✅ | `ingest.ts` |
| A4 | Duplicate detection (transaction-id aware; identical rows reported as info) | ✅ | `ingest.ts` |
| A5 | Cross-table checks: missing supplier, missing lead time, conflicts, negative stock, missing inventory, unknown products | ✅ | `refreshCrossQuality` |
| A6 | "Data understanding" summary (records / products / suppliers / warnings) | ✅ | `/import`, Overview |
| A7 | Sample CSV downloads + demo dataset with deliberate edge cases | ✅ | `demo-data.ts`, `api/samples` |
| A8 | Persistence (PostgreSQL/Drizzle; JSONB documents) | ✅🔄 | `db/schema.ts` |

## B. Intelligence
| # | Feature | Status |
|---|---|---|
| B1 | Demand forecast: 7-day expected, range, confidence, trend | ✅ (local ensemble) |
| B2 | TabPFN structured prediction with quantiles + auto-fallback. Weights pinned to the v2 line for licensing; **Rules & settings probes the running service** instead of trusting the env var | 🔌 `services/tabpfn`, `forecast-service.ts` |
| B3 | Forecast evaluation: rolling-origin MAE/RMSE vs naive baseline, interval coverage | ✅ `/forecasts`, `/api/evaluation` |
| B4 | Inventory risk engine: SAFE/WATCH/HIGH/CRITICAL, stockout probability, days of cover. Band cut points are **owner-tunable rules** (Settings; sorted defensively so misconfiguration cannot create inconsistent banding) | ✅ |
| B5 | Signals: stockout risk, slow-moving, demand surge, supplier saving | ✅ |
| B6 | Inferred historical stockouts (explicitly labelled "inferred") | ✅ |
| B7 | Inbound-order awareness (approved orders count as stock until delivered) | ✅ |
| B8 | **Decision simulator**: 400 seeded futures per candidate quantity → post-delivery stockout risk, overstock risk, unmet demand, pre-delivery loss, leftover, cash committed, net cash. Realism the owner's own data supports: weekday demand multipliers from recent sales (when a stable pattern exists) and supplier-delay variability (1.4826 × MAD of measured order→receipt gaps) — both degrade to the simple model when the data is absent, and the stated limitations say which happened | ✅ `simulate.ts` |
| B10 | **Lead-time learning**: supplier lead time is measured from the owner's own order→delivery pairs (median, MAD, range, n) and replaces the spreadsheet promise — but only at n≥3 (provisional, never used to shorten the plan) and n≥10 (measured). Pairs dated the wrong way round are dropped, not clamped. Shown per supplier on **/suppliers** with MEASURED / PROVISIONAL / TOO FEW TO TRUST labels | ✅ `leadtime.ts` |
| B11 | **Whole-shop outlook** (`shop-sim.ts`): paired shop futures over the whole basket — funded orders carry their quantity, deferred ones zero, so the cost of deferral is visible as units. Reports expected total unmet demand (plus p50/p90), leftover, cash committed and expected net cash, with stated limitations. Returned with the batch approval | ✅ `shop-sim.ts` |
| B9 | **Simulation limitations stated in the product**, not hidden — and now per-product honest: the constant-rate and no-supplier-delay limitations are replaced with what the data actually supports (weekday pattern / measured delay) or kept when it doesn't; fixed price and pre-delivery-loss caveats always remain | ✅ `SimulationTable` |

## B2. Operational event ledger & capture
| # | Feature | Status |
|---|---|---|
| J1 | Append-only `ledger_events`: `stock_count` / `sale` / `receipt` / `adjustment` / `return`, with source and note | ✅ `ledger.ts`, `schema.ts` |
| J2 | Deterministic reducer: current quantity = fold over events in `(at, id)` order, with a running-balance trail | ✅ `reduceEvents` |
| J3 | No update/delete path: corrections are new events; duplicate event ids are rejected | ✅ `server/ledger.ts` |
| J4 | Conflict detection: two sources reporting the same movement differently → both kept, owner asked | ✅ `detectConflicts` |
| J5 | Future-dated events flagged so a wrongly-dated snapshot cannot silently discard history | ✅ `summarise(events, asOf)` |
| J6 | Inventory CSV export recorded as a dated `stock_count` baseline instead of an overwrite | ✅ `ingest.ts` |
| J7 | `/ledger` page: derived state per product, balance trail, conflicts, negative stock, recent events | ✅ |
| J8 | Typed + spoken capture ("Kal 30 blue shirt aaya aur 3 shirt bik gaye"), Hindi/Urdu + English number words. Devanagari script tokenises correctly now (marks kept with their consonant). Browser speech recognition is **single-language** — pick English(India) or हिन्दी per session; Hindi-English mixes get numbers wrong, so the transcript is editable before parsing. **Model-assisted segmentation is implemented behind the grounding gate** (`parseSource` on every parse): when Gemma is configured it may only propose *verbatim spans* (movement segments + product words); anything not copied word-for-word from the message is discarded, the model never states a quantity or classifies the movement, and its involvement shows as an INFERRED `product_span` claim. Rules-only while Gemma is not configured | ✅ / 🔌 `capture.ts`, `server/capture.ts` |
| J9 | **Claim labels** on every extracted fact: CONFIRMED / INFERRED / MISSING / CONFLICTING, with the reason shown verbatim | ✅ `ClaimStatusBadge` |
| J10 | Human confirmation gate: a MISSING or CONFLICTING line is refused, not filled in; per-line corrections supported | ✅ `confirmCapture` |
| J11 | Unmatched text is surfaced to the owner instead of being dropped silently | ✅ |
| J12 | Claim labels on recommendation evidence rows (stockout risk = INFERRED, supplier conflict = CONFLICTING, inventory = CONFIRMED) | ✅ `EvidenceList` |
| J13 | Simulated deliveries/sales also appended as ledger events so derived state and inventory cannot drift | ✅ `simulateDays` |

## C. Decision engine
| # | Feature | Status |
|---|---|---|
| C1 | Recommendation object: type, evidence, action, confidence, risks, alternatives, status, validation, calculation | ✅ |
| C2 | Types: reorder, supplier_change, inventory_warning, slow_moving, opportunity | ✅ |
| C3 | Deterministic order quantity (demand + buffer − stock, MOQ floor) with visible arithmetic | ✅ |
| C4 | Alternatives: minimal order, cheaper supplier, owner's usual adjustment, forecast-bias-adjusted, limit-capped | ✅ |
| C5 | Evidence drawer (bars, source tags INTERNAL/EXTERNAL, raw data inspection) | ✅ |
| C6 | Explanation: deterministic template; Gemma rephrase gated by numeric grounding | ✅ / 🔌 Gemma |
| C7 | Ask Why ("Why 18?") answered from stored calculation | ✅ |
| C8 | Uncertainty: abstain / DATA_ERROR / FLAG_CONFLICT / LOW_CONFIDENCE | ✅ |
| C9 | Deterministic safety layer: max order, MOQ, cash limit, capacity, margin, allowed supplier, plausibility | ✅ |
| C10 | Dedupe/update on re-analysis; stale items expire | ✅ |
| C11 | **Whole-shop cash plan**: pending orders ranked urgent-first (severity → post-delivery stockout risk → expected unmet demand → cost) and funded greedily against the cash limit. When cash binds, an order is downsized to the largest smaller quantity its own simulation table scored (extra unmet demand stated) or deferred with the shortfall stated. Every figure comes from the recommendations' own action/simulation data. Shown in the briefing and on the Overview when the limit binds | ✅ `budget.ts`, `briefing.ts`, Overview |

## D. Human loop & memory
| # | Feature | Status |
|---|---|---|
| D1 | Approve / Modify (quantity, supplier) / Reject with reason | ✅ |
| D1b | **Approve the funded cash plan in one click** (`/api/recommendations/batch` + Overview button): one human approval for the whole basket, but every order still passes the individual `decide()` gate — quantities re-validated against current rules at approval time, blocked orders refused, warnings never auto-confirmed (skipped for individual approval), downsized quantities recorded as `modified` with the trade-off in the decision reason. Deferred orders stay pending | ✅ `memory.ts`, Overview |
| D2 | Live re-validation while editing; block → refuse, warn → explicit confirm | ✅ |
| D3 | Order message draft (copy) — Sahaay never contacts suppliers | ✅ |
| D4 | "I placed this order" → EXECUTED + an append-only `order_placed` event (commits cash, moves **no** stock; id derived from the decision so a double click cannot order twice) | ✅ |
| D4b | "Goods arrived" → RECEIVED + a correlated `receipt` event, with the date and the units that actually landed (partial/over delivery supported). The order→receipt gap is the raw material for learned lead time | ✅ |
| D5 | Decision lifecycle visible in UI — only stages that genuinely happened are stamped (an abstaining rec shows no SIMULATED/VALIDATED chip) | ✅ |
| D6 | Decision history: recommended vs human vs outcome | ✅ |
| D7 | Outcome monitoring: actual vs forecast, verdicts, comparison of owner's edit vs recommendation. Windows where the available stock all sold are **censored** (recorded sales understate demand), so those get an `indeterminate` verdict and are excluded from forecast-bias learning | ✅ `outcomes-core.ts` |
| D8 | Preference learning (order-size ratio, reason themes, forecast bias) → shown, only influences alternatives | ✅ |
| D9 | North-star metrics (decisions with measurable outcomes) | ✅ |
| D10 | Demo time-machine (simulate N days, deliveries, outcome measurement). Gated behind `DEMO_MODE=1`: it appends synthetic sales/receipts to the **real** ledger, so it is off wherever real data lives | ✅ (SIMULATION) |

## E. Assistant
| # | Feature | Status |
|---|---|---|
| E1 | Natural-language investigation: attention, inventory, reorder, why, overstock, sales decline, cheaper supplier, last decision | ✅ |
| E2 | Context carry-over (follow-up "Why 18?" on a decision page) | ✅ |
| E3 | Gemma intent fallback + grounded phrasing | 🔌 |
| E4 | Voice question input (browser SpeechRecognition) | ✅ (browser support varies) |
| E5 | Trace per answer | ✅ |

## F. External research
| # | Feature | Status |
|---|---|---|
| F1 | SerpApi supplier research with source, timestamp, query, relevance | 🔌 (needs `SERPAPI_KEY`) |
| F2 | Simulated candidates when no key — loudly labelled | ✅ |
| F3 | INTERNAL vs EXTERNAL separation in UI and data model | ✅ |
| F4 | Privacy: only product name leaves the system | ✅ |

## G. Automation & infrastructure
| # | Feature | Status |
|---|---|---|
| G1 | Workflows: weekly review, morning briefing, monthly slow-movers, outcome check | ✅ |
| G2 | Persisted step state + retries with backoff + failure capture | ✅ |
| G3 | Schedules + `/api/cron/tick` (Render cron / any scheduler) | ✅ |
| G4 | Temporal worker | 🔭 reference code in `services/worker`, **not deployed** — the in-app durable runner (G1–G3) is what actually runs schedules |
| G5 | Morning briefing (text) with attention-time estimate, per-order cost, and the whole-shop cash check (what fits, what is downsized — with the simulation trade-off — and what is deferred) | ✅ |
| G6 | Voice briefing: ElevenLabs TTS / browser fallback | 🔌 / ✅ |
| G7 | Observability: per-run spans in-app (agent_runs) | ✅ |
| G8 | Sentry error forwarding | 🔌 adapter exists; deliberately off — forwarding errors would ship the owner's business data to a third party |
| G9 | Owner auth (access code, signed cookie) + open-mode warning. `SESSION_SECRET` missing in production is a hard error rather than the published dev fallback, and `/api/cron/tick` requires `CRON_SECRET` instead of falling back to session auth | ✅ |
| G10 | Render blueprint, Dockerfile, docker-compose. Paid Postgres plan (free plan self-deletes at 30 days); migrations committed under `drizzle/` and applied with `drizzle-kit migrate`, never from `buildCommand` | ✅ (files) |
| G11 | `/api/health` | ✅ |
| G12 | **Data ownership export** (`/api/export`): every business table plus the full decision memory as one JSON download (`sahaay-export/v1`), linked from Settings. The ledger is the source of record; nothing is locked in | ✅ |

## H. Quality
| # | Feature | Status |
|---|---|---|
| H1 | Safety suite S1–S11 (spec tests 1–5 + extras) | ✅ |
| H2 | Math suite M1–M3 | ✅ |
| H3 | Grounding suite G1–G3 | ✅ |
| H4 | Forecast backtest test vs baseline | ✅ |
| H5 | Live evaluation page | ✅ `/system` |
| H6 | Event ledger suite (reducer, baseline, conflicts, future-dated, claim labels) | ✅ `tests/ledger` |
| H7 | Capture parser suite (quantity extraction, missing quantity, unknown product, negation, damage sign) | ✅ `tests/ledger` |
| H8 | Simulator suite (reproducibility, ranges, monotonicity, trade-off, order credited once) | ✅ `tests/ledger` |
| H9 | Budget allocation suite (cash binding, downsize trade-off, MOQ-blocked options refused, blocked orders deferred, determinism) | ✅ `tests/budget` |
| H10 | Simulator realism suite (weekday effect, malformed-factor degradation, delay pushing unmet demand up, deep-stock insensitivity, determinism and monotonicity with all inputs on) | ✅ `tests/simulator` |
| H11 | Risk-band suite (defaults unchanged, custom bands flow through, misconfiguration sorted/clamped) | ✅ `tests/risk` |
| H12 | Model-span capture gate (verbatim-only application, no partial trust, hints cannot inject quantities, fallback equals rules parse) | ✅ `tests/capture` |
| H13 | Whole-shop outlook suite (funded vs deferral unmet demand, portfolio totals, quantile ordering, determinism) | ✅ `tests/simulator/shop-sim` |

## I. Future (explicitly out of MVP scope)
🔭 WhatsApp Business API ingestion · receipt/photo OCR (the UdharBook lesson) · POS / Shopify / WooCommerce / Square / Razorpay / Google Sheets sync · multi-product and cash-constrained simulation (today's simulator is per-product) · model-assisted capture parsing behind the numeric-grounding gate · payment & cash-flow-aware decisions · supplier integrations · autonomous procurement · mobile app · Arduino UNO Q inventory device · multi-business · vertical packs · MongoDB Atlas adapter.
